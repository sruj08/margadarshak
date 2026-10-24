"use client";

import type { GameContent, GameId } from "@margdarshak/game-core/schema";
import { isPlaceholderClip } from "@/features/nazar/placeholder";
import type {
  CheckedSessionResult,
  ClipPage,
  DebriefWire,
  FamilyMemberWire,
  GameSessionComplete,
  GameSessionCreate,
  GameSessionReplay,
  GameSessionStart,
  ShareCard,
  ShareCardCreate,
} from "./api-types";
import { PACK_RESOLUTION } from "./api-types";
import type { DeviceItems, StudyForm } from "./types";

/**
 * One facade over the P2 game endpoints (API-34/35/36/37, the replay endpoint, share cards) and
 * their device implementation (mock-api.ts), copying the approach of src/lib/journey/api.ts:
 *
 *  - real API when NEXT_PUBLIC_API_URL (or NEXT_PUBLIC_API_BASE_URL) is set and
 *    NEXT_PUBLIC_API_MOCK is not "1"; the device implementation otherwise;
 *  - when the real API is unreachable or an endpoint is not live yet (network error, 404/405/501,
 *    5xx), a call falls back to the device and says so (`source: "device"`). A device session is
 *    seeded locally (`seedOrigin: client_offline`) and its score is provisional: it never counts.
 *
 * mock-api.ts (and with it game-core's scorers and the fixture clips) is imported lazily, inside
 * the calls that need it, so this file stays small on every page that imports it.
 */

const BASE = process.env["NEXT_PUBLIC_API_URL"] || process.env["NEXT_PUBLIC_API_BASE_URL"] || "";
export const API_MODE: "real" | "mock" =
  process.env["NEXT_PUBLIC_API_MOCK"] === "1" || BASE === "" ? "mock" : "real";

const TENANT = "JK";
const FALLBACK_STATUS = new Set([404, 405, 408, 425, 500, 501, 502, 503, 504]);

/** Network down, endpoint not live, or mock mode: the device stands in. */
export class Unavailable extends Error {
  constructor(public readonly reason: "offline" | "not_live" | "mock" = "not_live") {
    super(reason);
  }
}

/** A problem the server sent back (403 consent, 409 no unseen clips, 422 …): show it. */
export class GameApiError extends Error {
  constructor(
    public readonly status: number,
    title: string,
    public readonly code?: string,
  ) {
    super(title);
  }
}

export const isUnavailable = (e: unknown): e is Unavailable => e instanceof Unavailable;

let locale: "en" | "hi" = "en";
export function setGamesApiLocale(l: string): void {
  locale = l === "hi" ? "hi" : "en";
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

const DEVICE_KEY = "md.device.key.v1";
function deviceKey(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known && known.length >= 16) return known;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    localStorage.setItem(DEVICE_KEY, key);
    return key;
  } catch {
    return `web-${crypto.randomUUID()}`;
  }
}

interface Raw {
  status: number;
  body: unknown;
}

async function send(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { body?: unknown; idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<Raw> {
  const headers: Record<string, string> = {
    Accept: "application/json, application/problem+json",
    "X-Tenant": TENANT,
    "Accept-Language": locale,
    "X-Request-Id": crypto.randomUUID(),
  };
  if (method !== "GET") {
    headers["X-Requested-With"] = "margdarshak";
    headers["Idempotency-Key"] = opts.idempotencyKey ?? crypto.randomUUID();
  }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE.replace(/\/+$/, "")}${path}`, {
    method,
    headers,
    credentials: "include",
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

let session: Promise<void> | null = null;
/** Keeps the browser's `md_sid` session, or asks API-06 for an anonymous device session. */
function ensureSession(): Promise<void> {
  session ??= (async () => {
    try {
      const me = await send("GET", "/v1/me");
      if (me.status >= 200 && me.status < 300) return;
      await send("POST", "/v1/sessions/device", {
        body: { device_public_key: deviceKey(), platform: "pwa", app_version: "0.1.0" },
      });
    } catch {
      // offline: calls fall back to the device
    }
  })();
  return session;
}

function problem(body: unknown): { title: string; code?: string } {
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    const title = typeof o["title"] === "string" ? o["title"] : "Request failed";
    return typeof o["code"] === "string" ? { title, code: o["code"] } : { title };
  }
  return { title: "Request failed" };
}

/** Real call: the body on 2xx; Unavailable to fall back; GameApiError to show a problem. */
async function real<T>(run: () => Promise<Raw>): Promise<T> {
  if (API_MODE !== "real") throw new Unavailable("mock");
  if (!online()) throw new Unavailable("offline");
  await ensureSession();
  let res: Raw;
  try {
    res = await run();
  } catch {
    throw new Unavailable("offline");
  }
  if (res.status >= 200 && res.status < 300) return res.body as T;
  if (FALLBACK_STATUS.has(res.status)) throw new Unavailable("not_live");
  const p = problem(res.body);
  throw new GameApiError(res.status, p.title, p.code);
}

const mockApi = () => import("./mock-api");

// ---------- API-34 start ----------

export interface StartedSession {
  start: GameSessionStart;
  source: "server" | "device";
  media: "video" | "placeholder";
  /** Device sessions only: full scoring content for the provisional preview. */
  deviceContent: GameContent | null;
}

/** A client-safe document for an item the API sent without one (`public`). */
export type PublicDocResolver = (ref: string) => Record<string, unknown> | undefined;

/**
 * The API sends no `public` documents: fill them on the client so the game sees the same items as
 * in a device session. `resolve` is the caller's copy (the LL bank for `q:` items); sims fall back
 * to the game-core fixture scenarios the server deals them from. Clips never carry one.
 */
async function withPublicDocs(
  start: GameSessionStart,
  resolve: PublicDocResolver | undefined,
): Promise<GameSessionStart> {
  const missing = start.items.filter((it) => !it.public && it.kind !== "clip");
  if (missing.length === 0) return start;
  const fixture = missing.some((it) => !resolve?.(it.item_ref))
    ? (await mockApi()).fixturePublicDoc
    : undefined;
  return {
    ...start,
    items: start.items.map((it) => {
      if (it.public || it.kind === "clip") return it;
      const doc = resolve?.(it.item_ref) ?? fixture?.(it.item_ref);
      return doc ? { ...it, public: doc } : it;
    }),
  };
}

export async function startGameSession(
  gameId: GameId,
  body: GameSessionCreate,
  opts: {
    deviceItems?: DeviceItems;
    tenant?: string;
    studyForm?: StudyForm;
    publicDoc?: PublicDocResolver;
  } = {},
): Promise<StartedSession> {
  try {
    const raw = await real<GameSessionStart>(() =>
      send("POST", `/v1/games/${gameId}/sessions`, { body }),
    );
    const start = await withPublicDocs(raw, opts.publicDoc);
    // Sample clips of the dev/demo seed carry the placeholder body: draw the labelled timeline.
    const clips = start.items.filter((it) => it.kind === "clip");
    const media = clips.length > 0 && clips.every(isPlaceholderClip) ? "placeholder" : "video";
    return { start, source: "server", media, deviceContent: null };
  } catch (e) {
    if (!isUnavailable(e)) throw e;
  }
  const mock = await mockApi();
  return mock.deviceStartSession(gameId, body, {
    locale: body.locale ?? locale,
    ...(opts.deviceItems ? { deviceItems: opts.deviceItems } : {}),
    ...(opts.tenant ? { tenant: opts.tenant } : {}),
    ...(opts.studyForm ? { studyForm: opts.studyForm } : {}),
  });
}

// ---------- API-35 complete ----------

export type CompleteOutcome =
  | { status: "accepted"; data: CheckedSessionResult }
  /** Offline, timeout, 429 or 5xx: keep it queued. */
  | { status: "retry"; reason: string }
  /** The server will never take this replay (409 digest, 403 consent, 410, 413, 422). */
  | { status: "rejected"; reason: string }
  /** The endpoint is not live (404/501) or this is a device session: score on the device. */
  | { status: "unavailable" };

export async function completeGameSession(
  sid: string,
  body: GameSessionComplete,
): Promise<CompleteOutcome> {
  if (API_MODE !== "real") return { status: "unavailable" };
  if (!online()) return { status: "retry", reason: "offline" };
  await ensureSession();
  let res: Raw;
  try {
    res = await send("POST", `/v1/games/sessions/${sid}/complete`, {
      body,
      idempotencyKey: sid,
      timeoutMs: 15_000,
    });
  } catch {
    return { status: "retry", reason: "network" };
  }
  if (res.status >= 200 && res.status < 300)
    return { status: "accepted", data: res.body as CheckedSessionResult };
  if (res.status === 404 || res.status === 405 || res.status === 501)
    return { status: "unavailable" };
  if (res.status === 408 || res.status === 429 || res.status >= 500)
    return { status: "retry", reason: `http_${res.status}` };
  const p = problem(res.body);
  return { status: "rejected", reason: p.code ?? `http_${res.status}` };
}

// ---------- replay endpoint ----------

/** Windows + analysed facts after API-35. null = not available here (mock, offline, not live). */
export async function getGameSessionReplay(sid: string): Promise<GameSessionReplay | null> {
  try {
    return await real<GameSessionReplay>(() => send("GET", `/v1/games/sessions/${sid}/replay`));
  } catch (e) {
    if (isUnavailable(e)) return null;
    if (e instanceof GameApiError && e.status === 409) return null;
    throw e;
  }
}

// ---------- API-36 debrief (AI path is P3) ----------

export type DebriefFetch =
  | { kind: "card"; data: DebriefWire }
  | { kind: "none"; reason: "mock" | "offline" | "not_live" | "pending" | "not_found" };

/** Never throws: anything but a ready card keeps the template card on screen (EC-29). */
export async function getServerDebrief(sid: string): Promise<DebriefFetch> {
  if (API_MODE !== "real") return { kind: "none", reason: "mock" };
  if (!online()) return { kind: "none", reason: "offline" };
  try {
    await ensureSession();
    const res = await send("GET", `/v1/games/sessions/${sid}/debrief`, { timeoutMs: 6_000 });
    if (res.status === 200) return { kind: "card", data: res.body as DebriefWire };
    if (res.status === 202) return { kind: "none", reason: "pending" };
    if (res.status === 404) return { kind: "none", reason: "not_found" };
    return { kind: "none", reason: "not_live" };
  } catch {
    return { kind: "none", reason: "offline" };
  }
}

// ---------- API-37 clip manifest (offline pack) ----------

export async function listNazarClips(
  opts: { familyMemberId?: string } = {},
): Promise<ClipPage | null> {
  const q = new URLSearchParams({ exclude_seen: "true", resolution: PACK_RESOLUTION });
  if (opts.familyMemberId) q.set("family_member_id", opts.familyMemberId);
  try {
    return await real<ClipPage>(() => send("GET", `/v1/nazar/clips?${q.toString()}`));
  } catch (e) {
    if (isUnavailable(e)) return (await mockApi()).devicePack();
    throw e;
  }
}

// ---------- share cards (API-57 delta) and the profile they need ----------

export type ShareCreateOutcome =
  | { status: "created"; card: ShareCard }
  | { status: "needs_parent_consent" }
  | { status: "needs_account" }
  | { status: "not_allowed" }
  | { status: "unavailable" };

export async function createShareCard(body: ShareCardCreate): Promise<ShareCreateOutcome> {
  try {
    const card = await real<ShareCard>(() => send("POST", "/v1/share-cards", { body }));
    return { status: "created", card };
  } catch (e) {
    if (isUnavailable(e)) return (await mockApi()).deviceCreateShareCard(body);
    if (e instanceof GameApiError) {
      if (e.code === "PARENT_CONSENT_REQUIRED") return { status: "needs_parent_consent" };
      // 401: no session. 403: an anonymous device session (no account) may not create a card.
      if (e.status === 401 || e.status === 403) return { status: "needs_account" };
      if (e.code === "SHARE_CARD_NOT_ALLOWED" || e.status === 422) return { status: "not_allowed" };
    }
    throw e;
  }
}

export interface LearnerProfileInfo {
  /** "anonymous" = device session only (no account). */
  account: "anonymous" | "signed_in";
  members: FamilyMemberWire[];
}

/** Who is signed in and their family members (API-59), for the share-card consent gate. */
export async function getLearnerProfile(): Promise<LearnerProfileInfo> {
  try {
    // API-59 `Applicant`: `scope` is "user" for an account, "device" for an anonymous session.
    const me = await real<{ scope?: string } | null>(() => send("GET", "/v1/me"));
    const signedIn = me?.scope === "user";
    let members: FamilyMemberWire[] = [];
    if (signedIn) {
      try {
        const page = await real<{ items: FamilyMemberWire[] }>(() =>
          send("GET", "/v1/me/family-members"),
        );
        members = page.items ?? [];
      } catch {
        members = [];
      }
    }
    return { account: signedIn ? "signed_in" : "anonymous", members };
  } catch (e) {
    if (isUnavailable(e)) return (await mockApi()).deviceProfile();
    throw e;
  }
}
