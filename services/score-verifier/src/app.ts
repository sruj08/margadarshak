// The verifier HTTP server (node:http, no framework): a private, stateless compute service the Go
// API calls (D1). Every POST is HMAC-signed and stateless; Go keeps auth, persistence and
// orchestration.
//   GET  /healthz                  liveness (unauthenticated; the container healthcheck calls it)
//   GET  /versions                 supported scoring versions per game
//   POST /verify                   replays a session, returns the authoritative SessionResult
//   POST /learn/answers            routes/learn.ts: LL answers → correctness, FSRS ratings, due dates
//   POST /learn/state              routes/learn.ts: cards, mastery, nodes, queue, readiness, calibration
//   POST /gamification/evaluate    routes/learn.ts: XP, rank, streak, badges
//   POST /clip/agreement           routes/clip.ts: two-rater agreement, adjudication, scoring clip
//   POST /clip/manifests           routes/clip.ts: bank and client manifests
// Errors are RFC 9457 application/problem+json. Request bodies are capped and never logged.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { GAME_CORE_VERSION, ReplayError } from "@margdarshak/game-core";
import { SCORING_VERSIONS, SUPPORTED_GAMES } from "@margdarshak/game-core/scoring";
import type { VerifierConfig } from "./config.ts";
import type { ContentStore } from "./content-store.ts";
import { ReplayCache, verify as verifySignature } from "./hmac.ts";
import {
  HttpProblem,
  issueList,
  type Logger,
  type Problem,
  sendJson,
  sendProblem,
} from "./http-util.ts";
import { clipRoutes } from "./routes/clip.ts";
import { learnRoutes } from "./routes/learn.ts";
import { type PostRoute, postRoute, type RouteMap } from "./routes/types.ts";
import { isSupported, VerifyRequest, verifySession } from "./verify.ts";

export const SERVICE_VERSION = "0.1.0";

export interface AppDeps {
  config: VerifierConfig;
  store: ContentStore;
  logger: Logger;
  /** Unix seconds; injectable for signature tests. */
  now?: () => number;
}

const REPLAY_PROBLEM: Record<string, Omit<Problem, "detail" | "code">> = {
  UNSUPPORTED_GAME: { type: "unsupported-game", title: "No scorer for this game yet", status: 422 },
  UNSUPPORTED_VERSION: {
    type: "unsupported-version",
    title: "Scoring version not loaded",
    status: 422,
  },
  CONTEXT_MISMATCH: {
    type: "context-mismatch",
    title: "Session context does not match",
    status: 422,
  },
  CONTENT_MISMATCH: {
    type: "content-mismatch",
    title: "Content does not match the session",
    status: 422,
  },
  CONTENT_NOT_FOUND: { type: "content-not-found", title: "Scoring content not found", status: 422 },
  BAD_REPLAY: { type: "bad-replay", title: "Replay could not be decoded", status: 422 },
  DIGEST_MISMATCH: { type: "digest-mismatch", title: "Events digest does not match", status: 422 },
  BAD_EVENTS: { type: "bad-events", title: "Event stream is invalid", status: 422 },
};

/** POST /verify, kept on its original contract (schema failures are 422). */
const verifyRoutes: RouteMap = {
  "/verify": postRoute({
    request: VerifyRequest,
    invalidStatus: 422,
    contract: "Request does not match the /verify contract",
    handle: (body, ctx) => {
      ctx.fields["gameId"] = body.gameId;
      ctx.fields["sid"] = body.sid;
      const supported = isSupported(body);
      if (supported !== "ok") {
        const p = REPLAY_PROBLEM[
          supported === "game" ? "UNSUPPORTED_GAME" : "UNSUPPORTED_VERSION"
        ] as Problem;
        throw new HttpProblem({ ...p, detail: `${body.gameId} scoring ${body.scoringVersion}` });
      }
      return verifySession(body, ctx.deps.store);
    },
  }),
};

/** Mounts route modules; a path registered twice is a startup error. */
export function buildRegistry(...maps: RouteMap[]): ReadonlyMap<string, PostRoute> {
  const out = new Map<string, PostRoute>();
  for (const m of maps) {
    for (const [path, r] of Object.entries(m)) {
      if (out.has(path) || path === "/healthz" || path === "/versions") {
        throw new Error(`route ${path} registered twice`);
      }
      out.set(path, r);
    }
  }
  return out;
}

/** Every signed POST route, in mount order. */
export const POST_ROUTES = buildRegistry(verifyRoutes, learnRoutes, clipRoutes);
const GET_ROUTES = new Set(["/healthz", "/versions"]);

/** Reads the raw body up to the limit; rejects with 413 beyond it. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const tooLarge = (): HttpProblem =>
      new HttpProblem({ type: "payload-too-large", title: "Request body too large", status: 413 });
    const declared = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(tooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!failed) resolveBody(Buffer.concat(chunks));
    });
    req.on("error", (e) => {
      if (!failed) reject(e);
    });
  });
}

function sigProblem(reason: string): Problem {
  return {
    type: "unauthorized",
    title: "Missing or invalid Margdarshak-Signature",
    status: 401,
    code: `signature_${reason}`,
  };
}

/** The shared signed-POST pipeline (see routes/types.ts). */
async function handlePost(
  req: IncomingMessage,
  route: PostRoute,
  deps: AppDeps,
  cache: ReplayCache,
  fields: Record<string, string>,
): Promise<unknown> {
  const ctype = req.headers["content-type"] ?? "";
  if (!/^application\/json\b/i.test(ctype)) {
    throw new HttpProblem({
      type: "unsupported-media-type",
      title: "Use application/json",
      status: 415,
    });
  }
  const raw = await readBody(req, deps.config.bodyLimitBytes);
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const header = req.headers["margdarshak-signature"];
  const sig = verifySignature(
    deps.config.secret,
    Array.isArray(header) ? header[0] : header,
    raw,
    now,
    deps.config.signatureWindowS,
  );
  if (!sig.ok) throw new HttpProblem(sigProblem(sig.reason));
  if (!cache.accept(sig.sig, now)) throw new HttpProblem(sigProblem("replayed"));

  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpProblem({ type: "bad-request", title: "Body is not valid JSON", status: 400 });
  }
  const parsed = route.request.safeParse(json);
  if (!parsed.success) {
    throw new HttpProblem({
      type: "validation-failed",
      title: route.contract,
      status: route.invalidStatus ?? 400,
      errors: issueList(parsed.error.issues),
    });
  }
  const out = await route.handle(parsed.data, { deps, fields });
  if (route.response === undefined) return out;
  const checked = route.response.safeParse(out);
  if (!checked.success) {
    // Our own output broke its contract: a bug, never the caller's fault.
    deps.logger.error("response_contract", {
      issue: issueList(checked.error.issues)
        .slice(0, 3)
        .map((i) => i.path)
        .join(","),
    });
    throw new HttpProblem({ type: "internal", title: "Internal error", status: 500 });
  }
  return checked.data;
}

interface RequestState {
  reqId: string;
  path: string;
  fields: Record<string, string>;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppDeps,
  cache: ReplayCache,
  st: RequestState,
): Promise<void> {
  const post = POST_ROUTES.get(st.path);
  const allowed = post !== undefined ? "POST" : GET_ROUTES.has(st.path) ? "GET" : undefined;
  if (allowed === undefined) {
    req.resume();
    sendProblem(res, { type: "not-found", title: "Not found", status: 404 }, st.path);
    return;
  }
  if (req.method !== allowed) {
    req.resume();
    const p: Problem = { type: "method-not-allowed", title: "Method not allowed", status: 405 };
    sendProblem(res, p, st.path, { allow: allowed });
    return;
  }
  if (post !== undefined) {
    sendJson(res, 200, await handlePost(req, post, deps, cache, st.fields));
  } else if (st.path === "/healthz") {
    sendJson(res, 200, {
      status: "ok",
      service: "score-verifier",
      version: SERVICE_VERSION,
      content: deps.store.kind,
    });
  } else {
    sendJson(res, 200, {
      gameCore: GAME_CORE_VERSION,
      scoringVersions: SCORING_VERSIONS,
      games: SUPPORTED_GAMES,
      routes: [...POST_ROUTES.keys()],
    });
  }
}

/** Maps any thrown error to problem+json; unexpected errors are logged by name only. */
function sendError(res: ServerResponse, e: unknown, deps: AppDeps, st: RequestState): void {
  if (e instanceof HttpProblem) {
    st.fields["code"] = e.problem.code ?? e.problem.type;
    sendProblem(res, e.problem, st.path, e.problem.status === 413 ? { connection: "close" } : {});
    return;
  }
  if (e instanceof ReplayError) {
    st.fields["code"] = e.code;
    const p = REPLAY_PROBLEM[e.code] ?? {
      type: "unprocessable",
      title: "Replay failed",
      status: 422,
    };
    sendProblem(res, { ...p, detail: e.message, code: e.code }, st.path);
    return;
  }
  deps.logger.error("unhandled", { reqId: st.reqId, err: e instanceof Error ? e.name : "unknown" });
  if (!res.headersSent) {
    sendProblem(res, { type: "internal", title: "Internal error", status: 500 }, st.path);
  }
}

export function createVerifierServer(deps: AppDeps): Server {
  const cache = new ReplayCache(deps.config.replayCacheSize, 2 * deps.config.signatureWindowS);
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const started = process.hrtime.bigint();
    const st: RequestState = {
      reqId: randomUUID(),
      path: (req.url ?? "/").split("?")[0] ?? "/",
      fields: {},
    };
    res.setHeader("x-request-id", st.reqId);
    try {
      await route(req, res, deps, cache, st);
    } catch (e) {
      sendError(res, e, deps, st);
    } finally {
      deps.logger.info("request", {
        reqId: st.reqId,
        method: req.method,
        path: st.path,
        status: res.statusCode,
        durMs: Number((process.hrtime.bigint() - started) / 1000n) / 1000,
        gameId: st.fields["gameId"],
        sid: st.fields["sid"],
        code: st.fields["code"],
      });
    }
  });
  server.requestTimeout = deps.config.requestTimeoutMs;
  server.headersTimeout = Math.min(deps.config.requestTimeoutMs, 10_000);
  server.keepAliveTimeout = 5_000;
  return server;
}
