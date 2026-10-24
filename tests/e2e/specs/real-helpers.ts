import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { REAL } from "../real-env.mjs";

/**
 * Helpers for the full-stack specs (E2E_MODE=real): the browser talks to the Go API at REAL.apiUrl
 * with the md_sid cookie; `page.request` shares that cookie jar, so API checks run as the same
 * session the UI uses.
 */
export const API = REAL.apiUrl;

/** API JSON as the specs read it (assertions check the shape). */
// biome-ignore lint/suspicious/noExplicitAny: specs assert on arbitrary API JSON
export type Json = any;

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "X-Tenant": "JK",
  "X-Requested-With": "margdarshak",
};

/** The API's clock (GET /v1/health `time`); DEV_CLOCK_OFFSET may shift it at night. */
export async function serverNow(request: APIRequestContext): Promise<Date> {
  const res = await request.get(`${API}/v1/health`, { headers: { "X-Tenant": "JK" } });
  expect(res.ok()).toBe(true);
  return new Date(((await res.json()) as { time: string }).time);
}

/** Runs the browser on the API's clock so device and server agree on "today" and "now". */
export async function useServerClock(page: Page): Promise<void> {
  const now = await serverNow(page.request);
  if (Math.abs(now.getTime() - Date.now()) > 60_000) await page.clock.install({ time: now });
}

export function istDate(d: Date, plusDays = 0): string {
  return new Date(d.getTime() + 5.5 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
}

/** A call to the API as the page's session (cookie), with the CSRF header and a fresh key. */
export async function apiCall(
  page: Page,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) {
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    headers: { ...JSON_HEADERS, "Idempotency-Key": randomUUID() },
    ...(body === undefined ? {} : { data: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: Json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status(), json };
}

/**
 * An internal call as n8n / Render Workflows make it: service bearer token plus
 * `Margdarshak-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)>` (signed with the
 * API's clock, which the 300 s skew window is checked against).
 */
export async function internalCall(request: APIRequestContext, path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const t = Math.floor((await serverNow(request)).getTime() / 1000);
  const sig = createHmac("sha256", REAL.hmacSecret).update(`${t}.${raw}`).digest("hex");
  const res = await request.post(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Tenant": "JK",
      Authorization: `Bearer ${REAL.internalToken}`,
      "Margdarshak-Signature": `t=${t},v1=${sig}`,
      "Idempotency-Key": randomUUID(),
    },
    data: raw,
  });
  return { status: res.status(), json: (await res.json().catch(() => null)) as Json };
}

export interface Envelope {
  event: string;
  event_id: string;
  payload: string;
}

/** W02 envelopes the API logged (N8N_BASE_URL unset, so the envelope is logged, not posted). */
export function loggedEnvelopes(): Envelope[] {
  if (!existsSync(REAL.apiLog)) return [];
  return readFileSync(REAL.apiLog, "utf8")
    .split("\n")
    .filter((l) => l.includes('"n8n envelope (dev only, N8N_BASE_URL unset)"'))
    .map((l) => JSON.parse(l) as Envelope);
}

export async function activeCase(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("md.case.active.v1") ?? "null") as {
        caseId: string;
        local: boolean;
        memberId: string | null;
        persona: string | null;
      } | null,
  );
}

/** Waits for one API response (method + path prefix) while `act` runs; returns its status/body. */
export async function expectApi(
  page: Page,
  method: string,
  path: string | RegExp,
  act: () => Promise<unknown>,
) {
  const wait = page.waitForResponse((r) => {
    if (r.request().method() !== method || !r.url().startsWith(API)) return false;
    const p = new URL(r.url()).pathname;
    return typeof path === "string" ? p === path : path.test(p);
  });
  await act();
  const res = await wait;
  return { status: res.status(), json: (await res.json().catch(() => null)) as Json };
}
