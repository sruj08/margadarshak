"use client";

import type {
  AdminIdentity,
  Clip,
  ClipAdjudicationCreate,
  ClipAdminPage,
  ClipBlurAuditCreate,
  ClipCueTextsUpdate,
  ClipGenerate,
  ClipGenerateAccepted,
  ClipRating,
  ClipRatingCreate,
  ClipRegister,
  ClipStatus,
  ClipSyntheticReviewCreate,
  NazarScene,
} from "./types";

/**
 * One facade over the clip admin endpoints (API-55 + the P2 delta) and the mock store, copying the
 * approach of src/lib/journey/api.ts and src/features/games/api.ts:
 *
 *  - real API when NEXT_PUBLIC_API_URL (or NEXT_PUBLIC_API_BASE_URL) is set and NEXT_PUBLIC_API_MOCK
 *    is not "1"; the mock store (mock-store.ts, this browser only, placeholder media) otherwise;
 *  - when an endpoint is not live yet (404 without a problem body, 405, 501), a call falls back to
 *    the mock store and says so (`source: "mock"`), so the screens can label it;
 *  - a network failure in real mode is "offline" (never a silent switch to mock data);
 *  - 4xx problems (403 not admin, 409 transition refused, 422 invalid) are shown as they are.
 *
 * The admin scope is checked by the server on every call (`userBearer [admin]`); the client gate
 * (AdminGate) only decides what to render.
 */

const BASE = process.env["NEXT_PUBLIC_API_URL"] || process.env["NEXT_PUBLIC_API_BASE_URL"] || "";
export const API_MODE: "real" | "mock" =
  process.env["NEXT_PUBLIC_API_MOCK"] === "1" || BASE === "" ? "mock" : "real";

export type Source = "server" | "mock";
export interface Sourced<T> {
  data: T;
  source: Source;
}

export class CuratorApiError extends Error {
  constructor(
    public readonly status: number,
    title: string,
    public readonly code?: string,
    public readonly detail?: string,
  ) {
    super(title);
  }
}

/** The network is down (real mode): show the offline state. */
export class CuratorOffline extends Error {}

class NotLive extends Error {}

let locale = "en";
export function setCuratorApiLocale(l: string): void {
  locale = l === "hi" ? "hi" : "en";
}

interface Raw {
  status: number;
  body: unknown;
}

async function send(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<Raw> {
  const headers: Record<string, string> = {
    Accept: "application/json, application/problem+json",
    "X-Tenant": "JK",
    "Accept-Language": locale,
    "X-Request-Id": crypto.randomUUID(),
  };
  if (method !== "GET") {
    headers["X-Requested-With"] = "margdarshak";
    headers["Idempotency-Key"] = idempotencyKey ?? crypto.randomUUID();
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE.replace(/\/+$/, "")}${path}`, {
    method,
    headers,
    credentials: "include",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

function problemOf(body: unknown): { title: string; code?: string; detail?: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const o = body as Record<string, unknown>;
  if (typeof o["title"] !== "string") return null;
  return {
    title: o["title"],
    ...(typeof o["code"] === "string" ? { code: o["code"] } : {}),
    ...(typeof o["detail"] === "string" ? { detail: o["detail"] } : {}),
  };
}

async function real<T>(run: () => Promise<Raw>): Promise<T> {
  if (API_MODE !== "real") throw new NotLive();
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new CuratorOffline();
  let res: Raw;
  try {
    res = await run();
  } catch {
    throw new CuratorOffline();
  }
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const p = problemOf(res.body);
  // A route that does not exist yet answers 404 without a problem body, or 405/501.
  if (res.status === 405 || res.status === 501 || (res.status === 404 && !p)) throw new NotLive();
  throw new CuratorApiError(res.status, p?.title ?? `HTTP ${res.status}`, p?.code, p?.detail);
}

const mockStore = () => import("./mock-store");

async function fromMock<T>(run: (m: typeof import("./mock-store")) => T): Promise<T> {
  const m = await mockStore();
  try {
    return run(m);
  } catch (e) {
    if (e instanceof m.MockProblem)
      throw new CuratorApiError(e.status, e.message, e.code, e.detail);
    throw e;
  }
}

async function call<T>(
  realRun: () => Promise<Raw>,
  mockRun: (m: typeof import("./mock-store")) => T,
): Promise<Sourced<T>> {
  try {
    return { data: await real<T>(realRun), source: "server" };
  } catch (e) {
    if (!(e instanceof NotLive)) throw e;
  }
  return { data: await fromMock(mockRun), source: "mock" };
}

const persona = (m: typeof import("./mock-store")) => m.mockPersona();
const enc = encodeURIComponent;

// ---------- identity (GET /v1/me, scope) ----------

/**
 * The clip-team personas of the demo seed (services/api seed.AdminPersonas): in real mode only
 * these persona sessions carry the `admin` scope (a signed-in account never does). The switcher
 * ID uses underscores; the pseudonym the server records uses hyphens.
 */
export const ADMIN_PERSONAS = [
  { id: "curator_01", pseudonym: "curator-01", roles: ["curator"] },
  { id: "rater_01", pseudonym: "rater-01", roles: ["rater"] },
  { id: "rater_02", pseudonym: "rater-02", roles: ["rater"] },
  { id: "rater_03", pseudonym: "rater-03", roles: ["rater"] },
] as const satisfies readonly {
  id: string;
  pseudonym: string;
  roles: readonly AdminIdentity["roles"][number][];
}[];

const REAL_PERSONA_KEY = "md.curator.realPersona.v1";

function rememberRealPersona(pseudonym: string | null): void {
  try {
    if (pseudonym) sessionStorage.setItem(REAL_PERSONA_KEY, pseudonym);
    else sessionStorage.removeItem(REAL_PERSONA_KEY);
  } catch {
    // storage blocked: the gate shows no pseudonym, the server still records it
  }
}

function realPersona(): (typeof ADMIN_PERSONAS)[number] | null {
  try {
    const p = sessionStorage.getItem(REAL_PERSONA_KEY);
    return ADMIN_PERSONAS.find((x) => x.pseudonym === p) ?? null;
  } catch {
    return null;
  }
}

/**
 * Real mode, demo only: sign this browser in as a clip-team persona (POST
 * /v1/demo/personas/{id}/session). The API refuses outside dev/demo tenants.
 */
export async function startAdminPersonaSession(id: (typeof ADMIN_PERSONAS)[number]["id"]) {
  const persona = ADMIN_PERSONAS.find((p) => p.id === id);
  await real<unknown>(() => send("POST", `/v1/demo/personas/${enc(id)}/session`, {}));
  rememberRealPersona(persona?.pseudonym ?? null);
}

/**
 * Real mode: the API session's scope (`admin` only for the clip-team persona sessions; the server
 * checks again on every call). Mock mode: the demo pseudonym picked on this browser.
 */
export async function whoAmI(): Promise<AdminIdentity> {
  try {
    const me = await real<{ scope?: string; subject?: string }>(() => send("GET", "/v1/me"));
    const admin = me?.scope === "admin";
    if (!admin) rememberRealPersona(null);
    const known = admin ? realPersona() : null;
    return {
      admin,
      pseudonym: known?.pseudonym ?? null,
      roles: !admin ? [] : known ? [...known.roles] : ["curator", "rater"],
      source: "server",
    };
  } catch (e) {
    if (e instanceof CuratorApiError) {
      if (e.status === 401 || e.status === 403)
        return { admin: false, pseudonym: null, roles: [], source: "server" };
      throw e;
    }
    if (!(e instanceof NotLive)) throw e;
  }
  return (await mockStore()).mockIdentity();
}

/** Mock mode only: act as one of the demo pseudonyms (or sign out with null). */
export async function chooseMockPersona(pseudonym: string | null): Promise<void> {
  (await mockStore()).setMockPersona(pseudonym);
}

export async function mockPersonas(): Promise<readonly { pseudonym: string; roles: string[] }[]> {
  return (await mockStore()).MOCK_PERSONAS;
}

export async function resetMockBoard(): Promise<void> {
  (await mockStore()).resetMockStore();
}

// ---------- API-55 ----------

/** GET /v1/admin/clips (listClipsAdmin). */
export function listClips(status?: ClipStatus): Promise<Sourced<Clip[]>> {
  return call<Clip[]>(
    async () => {
      const q = status ? `?status=${enc(status)}&limit=100` : "?limit=100";
      const r = await send("GET", `/v1/admin/clips${q}`);
      return { ...r, body: (r.body as ClipAdminPage | null)?.items ?? [] };
    },
    (m) => m.listClips(persona(m), status),
  );
}

/** GET /v1/admin/clips/{clipId} (getClipAdmin). */
export function getClip(id: string): Promise<Sourced<Clip>> {
  return call<Clip>(
    () => send("GET", `/v1/admin/clips/${enc(id)}`),
    (m) => m.getClip(persona(m), id),
  );
}

/** POST /v1/admin/clips (registerClip, 202 + clip_ingest). */
export function registerClip(body: ClipRegister, idempotencyKey: string): Promise<Sourced<Clip>> {
  return call<Clip>(
    () => send("POST", "/v1/admin/clips", body, idempotencyKey),
    (m) => m.registerClip(persona(m), body),
  );
}

/** POST /v1/admin/clips/{clipId}/ratings (rateClip): one blind rating per rater and version. */
export function rateClip(
  id: string,
  body: ClipRatingCreate,
  idempotencyKey: string,
): Promise<Sourced<ClipRating>> {
  return call<ClipRating>(
    () => send("POST", `/v1/admin/clips/${enc(id)}/ratings`, body, idempotencyKey),
    (m) => m.rateClip(persona(m), id, body),
  );
}

/** POST /v1/admin/clips/{clipId}/blur-audit (recordClipBlurAudit). */
export function recordBlurAudit(
  id: string,
  body: ClipBlurAuditCreate,
  idempotencyKey: string,
): Promise<Sourced<Clip>> {
  return call<Clip>(
    () => send("POST", `/v1/admin/clips/${enc(id)}/blur-audit`, body, idempotencyKey),
    (m) => m.recordBlurAudit(persona(m), id, body),
  );
}

/** POST /v1/admin/clips/{clipId}/adjudication (adjudicateClip). */
export function adjudicateClip(
  id: string,
  body: ClipAdjudicationCreate,
  idempotencyKey: string,
): Promise<Sourced<Clip>> {
  return call<Clip>(
    () => send("POST", `/v1/admin/clips/${enc(id)}/adjudication`, body, idempotencyKey),
    (m) => m.adjudicateClip(persona(m), id, body),
  );
}

/**
 * PUT /v1/admin/clips/{clipId}/cue-texts (setClipCueTexts): the bilingual cue per final hazard and
 * the curator difficulty publish requires.
 */
export function setCueTexts(
  id: string,
  body: ClipCueTextsUpdate,
  idempotencyKey: string,
): Promise<Sourced<Clip>> {
  return call<Clip>(
    () => send("PUT", `/v1/admin/clips/${enc(id)}/cue-texts`, body, idempotencyKey),
    (m) => m.setCueTexts(persona(m), id, body),
  );
}

/** POST /v1/admin/clips/{clipId}/publish (publishClip; 409 CLIP_INVALID_TRANSITION when refused). */
export function publishClip(id: string, idempotencyKey: string): Promise<Sourced<Clip>> {
  return call<Clip>(
    () => send("POST", `/v1/admin/clips/${enc(id)}/publish`, {}, idempotencyKey),
    (m) => m.publishClip(persona(m), id),
  );
}

/** Mock mode only: finish the ingest workflow on the placeholder (raw → blurred). */
export async function simulateIngest(id: string): Promise<Sourced<Clip>> {
  return { data: await fromMock((m) => m.simulateIngest(persona(m), id)), source: "mock" };
}

// ---------- AI-generated clips (product decision 2026-10-24; Go operations TBD) ----------

/**
 * `POST /v1/admin/clips/generate {sceneId, version, batchId}`: starts the clip_generate workflow for
 * one scene revision. The 202 body is the run (`ClipGenerateAccepted`): the clip itself is
 * registered later by the task, so `clip` is present only once it exists.
 */
export function generateClip(
  body: ClipGenerate,
  idempotencyKey: string,
): Promise<Sourced<ClipGenerateAccepted>> {
  return call<ClipGenerateAccepted>(
    () => send("POST", "/v1/admin/clips/generate", body, idempotencyKey),
    (m) => m.generateClip(persona(m), body),
  );
}

/**
 * `POST /v1/admin/clips/{clipId}/synthetic-review`: the reviewer's checklist for an AI clip
 * (replaces the blur audit); reviewer pseudonym and time come from the server.
 */
export function recordSyntheticReview(
  id: string,
  body: ClipSyntheticReviewCreate,
  idempotencyKey: string,
): Promise<Sourced<Clip>> {
  return call<Clip>(
    () => send("POST", `/v1/admin/clips/${enc(id)}/synthetic-review`, body, idempotencyKey),
    (m) => m.recordSyntheticReview(persona(m), id, body),
  );
}

/**
 * Generation scenes. Real mode: the `content/nazar/scenes.json` catalogue the page passes in (the
 * same file the API checks the scene revision against). Mock mode: the mock store's labelled sample
 * scenes (`source: "mock"`).
 */
export async function listScenes(
  catalogue: readonly NazarScene[] = [],
): Promise<Sourced<readonly NazarScene[]>> {
  if (API_MODE === "real" && catalogue.length > 0) return { data: catalogue, source: "server" };
  return { data: (await mockStore()).listScenes(), source: "mock" };
}
