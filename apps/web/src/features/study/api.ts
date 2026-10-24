"use client";

import { formFor, participantCode } from "./forms";
import {
  type ConsentArtefactWire,
  DEFAULT_PHASES,
  type PublicStatsWire,
  type StudyEnrolment,
  type StudyEnrolmentCreate,
  type StudyNearMissCreate,
} from "./types";

/**
 * One facade over the study endpoints and their mock (this browser only), copying the approach of
 * src/lib/journey/api.ts and src/features/games/api.ts:
 *
 *  - real API when NEXT_PUBLIC_API_URL (or NEXT_PUBLIC_API_BASE_URL) is set and NEXT_PUBLIC_API_MOCK
 *    is not "1"; the mock otherwise, or when an endpoint is not live yet (404/405/501);
 *  - **no call here runs before the participant accepts the consent screen**: declining makes no
 *    request at all (not even the anonymous device session, API-06) and stores nothing;
 *  - every write goes through `ensureSession` (the `md_sid` device session) only after consent.
 *
 * Mock enrolment rotates forms A → B → C deterministically by arrival order on this browser.
 */

const BASE = process.env["NEXT_PUBLIC_API_URL"] || process.env["NEXT_PUBLIC_API_BASE_URL"] || "";
export const API_MODE: "real" | "mock" =
  process.env["NEXT_PUBLIC_API_MOCK"] === "1" || BASE === "" ? "mock" : "real";

/** The consent notice this screen shows (FIELD_STUDY §6.1); the Hindi text awaits review (MD-603). */
export const STUDY_NOTICE_VERSION = "study-s2-2026.10.24";

export type Source = "server" | "mock";

export class StudyApiError extends Error {
  constructor(
    public readonly status: number,
    title: string,
    public readonly code?: string,
  ) {
    super(title);
  }
}

/** Network down in real mode: the flow shows the offline state and keeps the answers. */
export class StudyOffline extends Error {}

class NotLive extends Error {}

let locale: "en" | "hi" = "en";
export function setStudyApiLocale(l: string): void {
  locale = l === "hi" ? "hi" : "en";
}

interface Raw {
  status: number;
  body: unknown;
}

async function send(
  method: "GET" | "POST",
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
    signal: AbortSignal.timeout(10_000),
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

let session: Promise<void> | null = null;
/** The browser's `md_sid` (kept, or an anonymous device session from API-06). After consent only. */
function ensureSession(): Promise<void> {
  session ??= (async () => {
    try {
      const me = await send("GET", "/v1/me");
      if (me.status >= 200 && me.status < 300) return;
      const created = await send("POST", "/v1/sessions/device", {
        device_public_key: deviceKey(),
        platform: "pwa",
        app_version: "0.1.0",
      });
      if (created.status >= 300) session = null;
    } catch {
      session = null;
    }
  })();
  return session;
}

async function real<T>(run: () => Promise<Raw>, needsSession = true): Promise<T> {
  if (API_MODE !== "real") throw new NotLive();
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new StudyOffline();
  if (needsSession) await ensureSession();
  let res: Raw;
  try {
    res = await run();
  } catch {
    throw new StudyOffline();
  }
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const o = (typeof res.body === "object" && res.body !== null ? res.body : {}) as Record<
    string,
    unknown
  >;
  const isProblem = typeof o["title"] === "string";
  if (res.status === 405 || res.status === 501 || (res.status === 404 && !isProblem))
    throw new NotLive();
  throw new StudyApiError(
    res.status,
    isProblem ? (o["title"] as string) : `HTTP ${res.status}`,
    typeof o["code"] === "string" ? o["code"] : undefined,
  );
}

async function call<T>(
  realRun: () => Promise<Raw>,
  mockRun: () => T,
): Promise<{ data: T; source: Source }> {
  try {
    return { data: await real<T>(realRun), source: "server" };
  } catch (e) {
    if (!(e instanceof NotLive)) throw e;
  }
  return { data: mockRun(), source: "mock" };
}

// ---------- mock (this browser; written only after consent) ----------

const MOCK_ARRIVALS = "md.study.mock.arrivals.v1";
const MOCK_PARTICIPANT = "md.study.mock.participant.v1";
const MOCK_NEAR_MISS = "md.study.mock.nearmiss.v1";

function readJson<T>(store: Storage | undefined, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: Storage | undefined, key: string, v: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(v));
  } catch {
    // storage blocked: the flow still works for this visit
  }
}

const local = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;
const perVisit = (): Storage | undefined =>
  typeof sessionStorage === "undefined" ? undefined : sessionStorage;

/**
 * Mock enrolment: the n-th arrival on this browser gets `P-<n>` and form `formFor(n)` (A, B, C, A…),
 * the same rotation as the server. Enrolling again in the same visit returns the same participant.
 */
export function mockEnrol(body: StudyEnrolmentCreate, now = new Date()): StudyEnrolment {
  const existing = readJson<StudyEnrolment>(perVisit(), MOCK_PARTICIPANT);
  if (existing && !body.retake_of) return existing;
  const seq = (readJson<number>(local(), MOCK_ARRIVALS) ?? 0) + 1;
  writeJson(local(), MOCK_ARRIVALS, seq);
  const p: StudyEnrolment = {
    participant_code: participantCode(seq),
    form: formFor(seq),
    cohort: "field_test",
    phases: DEFAULT_PHASES,
    ai_debrief: false,
    created_at: now.toISOString(),
  };
  writeJson(perVisit(), MOCK_PARTICIPANT, p);
  return p;
}

// ---------- API-60: the field_study consent (on "I am 18+ and agree" only) ----------

export async function grantStudyConsent(): Promise<{ consentId: string | null; source: Source }> {
  const r = await call<ConsentArtefactWire>(
    () =>
      send("POST", "/v1/me/consents", {
        purpose: "field_study",
        action: "grant",
        notice_version: STUDY_NOTICE_VERSION,
        language: locale,
      }),
    () => ({
      consent_id: `cns_MOCK${Date.now().toString(36).toUpperCase()}`,
      purpose: "field_study",
      status: "active",
      granted_at: new Date().toISOString(),
      notice_version: STUDY_NOTICE_VERSION,
    }),
  );
  return { consentId: r.data?.consent_id ?? null, source: r.source };
}

// ---------- study enrolment and near-miss (P2 delta, API-70 x-proposed) ----------

/** POST /v1/study/nazar/enrolments: participant code and counterbalanced form. */
export async function enrolStudy(
  body: StudyEnrolmentCreate,
  idempotencyKey: string,
): Promise<{ data: StudyEnrolment; source: Source }> {
  const r = await call<StudyEnrolment>(
    () => send("POST", "/v1/study/nazar/enrolments", body, idempotencyKey),
    () => mockEnrol(body),
  );
  const phases = r.data.phases?.length ? r.data.phases : DEFAULT_PHASES;
  return { data: { ...r.data, phases }, source: r.source };
}

/** POST /v1/study/nazar/enrolments/{code}/near-miss (204). The text must be scanned first. */
export async function recordNearMiss(
  participant: string,
  body: StudyNearMissCreate,
  idempotencyKey: string,
): Promise<{ source: Source }> {
  const r = await call<null>(
    () =>
      send(
        "POST",
        `/v1/study/nazar/enrolments/${encodeURIComponent(participant)}/near-miss`,
        body,
        idempotencyKey,
      ),
    () => {
      writeJson(perVisit(), MOCK_NEAR_MISS, { participant, ...body });
      return null;
    },
  );
  return { source: r.source };
}

// ---------- API-71 public counters (read-only, no session) ----------

/** GET /v1/stats/public. Null in mock mode or when the API is unreachable. */
export async function getPublicStats(): Promise<PublicStatsWire | null> {
  if (API_MODE !== "real") return null;
  try {
    return await real<PublicStatsWire>(() => send("GET", "/v1/stats/public"), false);
  } catch {
    return null;
  }
}
