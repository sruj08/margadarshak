// Test helpers: a real verifier on an ephemeral port, signed requests built from golden vectors.
import type { AddressInfo } from "node:net";
import { type GoldenVector, goldenVectors } from "@margdarshak/game-core/fixtures";
import { createVerifierServer } from "../src/app.ts";
import { loadConfig, type VerifierConfig } from "../src/config.ts";
import { type ContentStore, FixtureContentStore } from "../src/content-store.ts";
import { sign } from "../src/hmac.ts";
import type { Logger } from "../src/http-util.ts";

export const SECRET = "test-verifier-secret-0123456789";
export const NOW = 1_793_000_000; // fixed unix seconds for signature tests

export interface Running {
  url: string;
  logs: string[];
  close(): Promise<void>;
}

export async function startVerifier(
  opts: { store?: ContentStore; config?: Partial<VerifierConfig> } = {},
): Promise<Running> {
  const logs: string[] = [];
  const logger: Logger = {
    info: (msg, f) => logs.push(JSON.stringify({ level: "info", msg, ...f })),
    warn: (msg, f) => logs.push(JSON.stringify({ level: "warn", msg, ...f })),
    error: (msg, f) => logs.push(JSON.stringify({ level: "error", msg, ...f })),
  };
  const config = {
    ...loadConfig({ VERIFIER_SHARED_SECRET: SECRET }),
    port: 0,
    host: "127.0.0.1",
    ...opts.config,
  };
  const server = createVerifierServer({
    config,
    store: opts.store ?? new FixtureContentStore(),
    logger,
    now: () => NOW,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    logs,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export const vector = (name: string): GoldenVector => {
  const v = goldenVectors().find((x) => x.name === name);
  if (v === undefined) throw new Error(`no vector ${name}`);
  return v;
};

/** The /verify body for a golden vector (flat ARCHITECTURE §6 shape). */
export function requestFor(
  v: GoldenVector,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sid: v.ctx.sid,
    gameId: v.ctx.gameId,
    gameVersion: v.manifest.version,
    scoringVersion: v.manifest.scoringVersion,
    mode: v.ctx.mode,
    difficulty: v.ctx.difficulty,
    seed: v.ctx.seed,
    seedOrigin: v.ctx.seedOrigin,
    items: v.ctx.items,
    tenant: v.ctx.tenant,
    rulePackVersion: v.ctx.rulePackVersion,
    telemetryVersion: 1,
    encoding: v.replayPackage.encoding,
    inputs: v.replayPackage.inputs,
    digest: v.replayPackage.digest,
    eventCount: v.replayPackage.eventCount,
    context: {
      userBand: v.ctx.userBand,
      locale: v.ctx.locale,
      deviceClass: v.ctx.deviceClass,
      offline: v.ctx.offline,
      serverStartIso: v.ctx.serverStartIso,
    },
    ...extra,
  };
}

/** `NOW` in epoch ms: the `now` the Go API would send with the same request. */
export const NOW_MS = NOW * 1000;

let skew = 0;
/** Signs each call at a distinct second inside the window, so identical bodies never collide. */
export function call(base: string, path: string, body: unknown): Promise<Reply> {
  skew = (skew + 1) % 250;
  return post(base, body, { path, signAt: NOW - skew });
}

export interface Reply {
  status: number;
  type: string;
  body: Record<string, unknown>;
}

export async function post(
  base: string,
  body: unknown,
  opts: {
    signAt?: number;
    secret?: string;
    header?: string | null;
    contentType?: string;
    path?: string;
  } = {},
): Promise<Reply> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/json",
  };
  const header =
    opts.header === undefined ? sign(opts.secret ?? SECRET, opts.signAt ?? NOW, text) : opts.header;
  if (header !== null) headers["Margdarshak-Signature"] = header;
  const res = await fetch(`${base}${opts.path ?? "/verify"}`, {
    method: "POST",
    headers,
    body: text,
  });
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    body: (await res.json()) as Record<string, unknown>,
  };
}
