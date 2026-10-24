import type { NodeStates, RatedAnswer } from "@margdarshak/gamification";
import type {
  Achievement,
  AnswerResult,
  AnswerSubmission,
  KhudLicenceDeclaration,
  LlFormat,
  Readiness,
  ReviewItem,
  ReviewQueueResponse,
  Sourced,
  Squad,
  SquadCreate,
  SquadJoin,
} from "./api-types";
import type { BankItem, LlTopicId } from "./content/bank-types";
import * as mock from "./mock-api";
import type { LearnerProfile } from "./profile";

/**
 * One facade over the Go learning API and its device implementation (pattern of
 * src/lib/journey/api.ts):
 *  - real API when NEXT_PUBLIC_API_URL (or NEXT_PUBLIC_API_BASE_URL) is set and
 *    NEXT_PUBLIC_API_MOCK is not "1"; the device implementation (./mock-api.ts) otherwise;
 *  - when the real endpoint is not live yet or unreachable (network error, 404/405/501/5xx), each
 *    call falls back to the device and says so (`source: "device"`), so the screens can label an
 *    on-device estimate honestly. A 403 PARENT_CONSENT_REQUIRED, 401 or a 409 is never hidden.
 */

const BASE = process.env["NEXT_PUBLIC_API_URL"] || process.env["NEXT_PUBLIC_API_BASE_URL"] || "";
export const LEARN_API_MODE: "real" | "mock" =
  process.env["NEXT_PUBLIC_API_MOCK"] === "1" || BASE === "" ? "mock" : "real";

const FALLBACK = new Set([404, 405, 408, 425, 429, 500, 501, 502, 503, 504]);

class Unavailable extends Error {}

export class LearnApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

let locale = "en";
export function setLearnLocale(l: string): void {
  locale = l;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
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
    return `web-${newId()}`;
  }
}

async function send(method: string, path: string, body?: unknown, idem?: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Tenant": "JK",
    "Accept-Language": locale,
    "X-Request-Id": newId(),
  };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = idem ?? newId();
    headers["X-Requested-With"] = "margdarshak";
  }
  return fetch(`${BASE.replace(/\/+$/, "")}${path}`, {
    method,
    headers,
    credentials: "include",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Makes sure the browser holds an `md_sid` session (API-06 anonymous device session if needed). */
let session: Promise<void> | null = null;
function ensureSession(): Promise<void> {
  session ??= (async () => {
    try {
      const me = await send("GET", "/v1/me");
      if (me.ok) return;
      await send("POST", "/v1/sessions/device", {
        device_public_key: deviceKey(),
        platform: "pwa",
        app_version: "0.1.0",
      });
    } catch {
      // offline: calls fall back to the device
    }
  })();
  return session;
}

async function real<T>(method: string, path: string, body?: unknown, idem?: string): Promise<T> {
  if (LEARN_API_MODE !== "real") throw new Unavailable();
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Unavailable();
  await ensureSession();
  let res: Response;
  try {
    res = await send(method, path, body, idem);
  } catch {
    throw new Unavailable();
  }
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;
  if (FALLBACK.has(res.status)) throw new Unavailable();
  let code: string | undefined;
  try {
    code = ((await res.json()) as { code?: string }).code;
  } catch {
    code = undefined;
  }
  throw new LearnApiError(res.status, code);
}

async function call<T>(
  realRun: () => Promise<T>,
  deviceRun: () => Promise<T> | T,
): Promise<Sourced<T>> {
  try {
    return { data: await realRun(), source: "server" };
  } catch (e) {
    if (!(e instanceof Unavailable)) throw e;
  }
  try {
    return { data: await deviceRun(), source: "device" };
  } catch (e) {
    if (e instanceof mock.MockProblem) throw new LearnApiError(e.status, e.code);
    throw e;
  }
}

/** 401 (no session) or 403 without a consent code (an anonymous device session, no account). */
export function isNoAccount(e: unknown): boolean {
  return (
    e instanceof LearnApiError &&
    (e.status === 401 || (e.status === 403 && e.code !== "PARENT_CONSENT_REQUIRED"))
  );
}

/** True for "the network or the endpoint is not there right now" (show the offline state). */
export function isOffline(e: unknown): boolean {
  return e instanceof Unavailable || e instanceof mock.MockOffline;
}

const member = (p?: LearnerProfile | null) =>
  p?.memberId ? `family_member_id=${encodeURIComponent(p.memberId)}` : "";

// ---------- API-05 LL format ----------

export function getLlFormat(state: string, fallback: LlFormat): Promise<Sourced<LlFormat>> {
  return call(
    () => real<LlFormat>("GET", `/v1/rules/${encodeURIComponent(state)}/ll-format`),
    () => fallback,
  );
}

// ---------- API-31 review queue ----------

export function getReviewQueue(
  items: readonly BankItem[],
  now: number,
  topic?: string | null,
  profile?: LearnerProfile | null,
): Promise<Sourced<ReviewItem[]>> {
  const q = [member(profile), "limit=20"].filter(Boolean).join("&");
  return call(
    async () => {
      const r = await real<ReviewQueueResponse>("GET", `/v1/learn/review-queue?${q}`);
      const due = topic ? r.items.filter((i) => i.topic_id === topic) : r.items;
      // API-31 lists due cards only (card_id = concept; no question or variant): new concepts come
      // from the device's curriculum order, skipping any card the server already schedules. Each
      // card is mapped to a question variant by the caller (variants.ts).
      const known = new Set(due.map((i) => i.card_id));
      const fresh = (await mock.reviewQueue(items, now, topic)).filter(
        (i) => (i.retrievability ?? 0) === 0 && !known.has(i.card_id),
      );
      return [...due, ...fresh];
    },
    () => mock.reviewQueue(items, now, topic),
  );
}

// ---------- API-32 answers (outbox sync) ----------

/**
 * Posts one outbox batch. Idempotency-Key is derived from the answer IDs, so a retried batch is the
 * same request; the server also dedupes each `client_answer_id`.
 */
export async function submitAnswers(
  batch: readonly AnswerSubmission[],
  idem: string,
  profile?: LearnerProfile | null,
): Promise<Sourced<AnswerResult[]>> {
  if (LEARN_API_MODE === "mock") {
    return { data: await mock.submitAnswers(batch), source: "server" };
  }
  return call(
    async () =>
      (
        await real<{ results: AnswerResult[] }>(
          "POST",
          "/v1/learn/answers",
          { ...(profile?.memberId ? { family_member_id: profile.memberId } : {}), answers: batch },
          idem,
        )
      ).results,
    () => {
      // The endpoint is not live: keep the batch in the outbox (nothing is lost).
      throw new Unavailable();
    },
  );
}

// ---------- API-33 readiness ----------

export interface ReadinessView {
  readiness: Readiness;
  source: "server" | "device";
  /** Answers behind a device estimate (null from the server). */
  answered: number | null;
}

export async function getReadiness(
  now: number,
  conceptCounts: Record<LlTopicId, number>,
  profile?: LearnerProfile | null,
): Promise<ReadinessView> {
  const q = member(profile);
  const r = await call<{ data: Readiness; answered: number | null }>(
    async () => ({
      data: await real<Readiness>("GET", `/v1/readiness${q ? `?${q}` : ""}`),
      answered: null,
    }),
    () => mock.readiness(now, conceptCounts),
  );
  return { readiness: r.data.data, answered: r.data.answered, source: r.source };
}

// ---------- API-38 achievements, API-44 Khud Licence ----------

export function getAchievements(
  now: number,
  nodeStates: NodeStates,
  answers: readonly RatedAnswer[],
  profile?: LearnerProfile | null,
): Promise<Sourced<Achievement>> {
  const q = member(profile);
  return call(
    async () => {
      try {
        return await real<Achievement>("GET", `/v1/me/achievements${q ? `?${q}` : ""}`);
      } catch (e) {
        // API-38 needs an account: an anonymous device session (403) or no session (401) keeps
        // XP, rank, streak and badges on this phone (GAMIFICATION_ENGINE §1).
        if (isNoAccount(e)) throw new Unavailable();
        throw e;
      }
    },
    () => mock.achievements(now, nodeStates, answers),
  );
}

export function declareKhudLicence(
  body: KhudLicenceDeclaration | { no: true },
): Promise<Sourced<null>> {
  return call(
    async () => {
      if ("no" in body) {
        // Nothing to store on the server for "No": the badge is simply not claimed.
        mock.declareKhudLicence(body);
        return null;
      }
      await real<Achievement>("POST", "/v1/me/declarations/khud-licence", body);
      mock.declareKhudLicence(body);
      return null;
    },
    () => {
      mock.declareKhudLicence(body);
      return null;
    },
  );
}

// ---------- API-39 squads ----------

export function createSquad(
  body: SquadCreate,
  profile: LearnerProfile,
  now: number,
): Promise<Sourced<Squad>> {
  const q = member(profile);
  return call(
    () => real<Squad>("POST", `/v1/squads${q ? `?${q}` : ""}`, body),
    () => mock.createSquad(body, profile, now),
  );
}

export function getMySquads(profile: LearnerProfile, now: number): Promise<Sourced<Squad[]>> {
  const q = member(profile);
  return call(
    async () => (await real<{ items: Squad[] }>("GET", `/v1/squads/mine${q ? `?${q}` : ""}`)).items,
    () => mock.mySquads(now),
  );
}

export function joinSquad(
  squadId: string,
  body: SquadJoin,
  profile: LearnerProfile,
  now: number,
): Promise<Sourced<Squad>> {
  const q = member(profile);
  return call(
    () =>
      real<Squad>(
        "POST",
        `/v1/squads/${encodeURIComponent(squadId)}/join${q ? `?${q}` : ""}`,
        body,
      ),
    () => mock.joinSquad(squadId, body, profile, now),
  );
}

export function leaveSquad(squadId: string, profile: LearnerProfile): Promise<Sourced<null>> {
  const q = member(profile);
  return call(
    async () => {
      await real<null>(
        "POST",
        `/v1/squads/${encodeURIComponent(squadId)}/leave${q ? `?${q}` : ""}`,
      );
      mock.leaveSquad(squadId);
      return null;
    },
    () => {
      mock.leaveSquad(squadId);
      return null;
    },
  );
}
