"use client";

import { findPii } from "@/lib/redact/redact";
import type { AnalyticsEvent } from "./api";

/**
 * Privacy-preserving product analytics (API-63, MD-136, D-13 revised), client side.
 *
 *  - Allowlist only: a fixed set of event names (a subset of the API's taxonomy) with allowlisted
 *    properties whose values are enums, small integers or code-like tokens. Anything else is
 *    dropped here, so no free text, no identifier and no personal value can leave the phone.
 *  - Only with the `analytics` consent (API-60) granted. Unknown consent = ask once; revoked = the
 *    queue is dropped.
 *  - Never about a minor family member's case: those events are not even queued (the API drops
 *    them too, using the case_id sent with the batch).
 *  - Batched (debounced, at most 20 per request) and dropped on failure: never retried, never
 *    stored on the device.
 */

type Check = (v: unknown) => boolean;

const oneOf =
  (...vals: string[]): Check =>
  (v) =>
    typeof v === "string" && vals.includes(v);
const TOKEN = /^[A-Za-z0-9_.-]{1,48}$/;
const token: Check = (v) => typeof v === "string" && TOKEN.test(v) && findPii(v).length === 0;
const smallInt: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000;
const confidence = oneOf("high", "medium", "low");

/** Event name -> allowed properties (mirrors services/api/internal/analytics Registry). */
export const ALLOWLIST: Record<string, Record<string, Check>> = {
  all_services_opened: {},
  plan_viewed: {
    classes_count: smallInt,
    blockers_count: smallInt,
    min_confidence: confidence,
    rulepack_version: token,
  },
  blocker_shown: { rule_id: token, severity: oneOf("info", "warn", "high") },
  application_started: { path: oneOf("aadhaar", "non_aadhaar") },
  check_answers_viewed: {},
  handoff_opened: { mode: oneOf("A", "B") },
  payment_pending_reported: {},
  consent_changed: { purpose: token, action: oneOf("grant", "revoke") },
};

const COMMON: Record<string, Check> = { locale: oneOf("en", "hi") };

/** The event as it may be sent, or null when its name or any property is not allowlisted. */
export function sanitize(
  name: string,
  props: Record<string, unknown> = {},
  at: string = new Date().toISOString(),
): AnalyticsEvent | null {
  const spec = ALLOWLIST[name];
  if (!spec) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    const check = spec[k] ?? COMMON[k];
    if (!check?.(v)) return null;
    out[k] = v as string | number | boolean;
  }
  return Object.keys(out).length > 0 ? { name, at, props: out } : { name, at };
}

export interface CaseView {
  caseId: string | null;
  /** The case is a minor family member's: nothing about it is ever sent. */
  minor: boolean;
}

export interface AnalyticsDeps {
  enabled: () => boolean;
  /** true / false when known, null when the consents were not read yet. */
  consent: () => boolean | null;
  /** Reads the consents (API-60) and returns whether analytics is granted. */
  refreshConsent: () => Promise<boolean>;
  activeCase: () => CaseView;
  send: (events: AnalyticsEvent[], caseId?: string) => Promise<boolean>;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
}

export const BATCH = 20;
export const DEBOUNCE_MS = 2000;

export function createAnalytics(deps: AnalyticsDeps) {
  let queue: AnalyticsEvent[] = [];
  let queueCase: string | null = null;
  let timer: unknown = null;
  let flushing: Promise<void> | null = null;

  const deliver = async (batch: AnalyticsEvent[], caseId: string | null): Promise<void> => {
    let granted = deps.consent();
    if (granted === null) granted = await deps.refreshConsent().catch(() => false);
    if (!granted || !deps.enabled()) return;
    for (let i = 0; i < batch.length; i += BATCH) {
      // Dropped on failure: analytics are never retried or kept on the phone.
      const ok = await deps.send(batch.slice(i, i + BATCH), caseId ?? undefined).catch(() => false);
      if (!ok) return;
    }
  };

  /** Takes the queue now (synchronously) and sends it after any batch already on its way. */
  const flushNow = (): Promise<void> => {
    if (timer !== null) {
      deps.cancel(timer);
      timer = null;
    }
    if (queue.length === 0) return flushing ?? Promise.resolve();
    const batch = queue;
    const caseId = queueCase;
    queue = [];
    queueCase = null;
    const prev = flushing ?? Promise.resolve();
    flushing = prev.then(() => deliver(batch, caseId));
    return flushing;
  };

  /** Queues one event if it is allowlisted, consented and not about a minor's case. */
  const track = (name: string, props?: Record<string, unknown>): boolean => {
    if (!deps.enabled() || deps.consent() === false) return false;
    const c = deps.activeCase();
    if (c.minor) return false;
    const ev = sanitize(name, props);
    if (!ev) return false;
    // One case per batch, so the API can check (and drop) the batch for that case.
    if (queue.length > 0 && queueCase !== c.caseId) void flushNow();
    queue.push(ev);
    queueCase = c.caseId;
    if (queue.length >= BATCH) void flushNow();
    else {
      if (timer !== null) deps.cancel(timer);
      timer = deps.schedule(() => {
        timer = null;
        void flushNow();
      }, DEBOUNCE_MS);
    }
    return true;
  };

  /** Drops whatever is queued (consent revoked, account deleted). */
  const reset = (): void => {
    queue = [];
    queueCase = null;
    if (timer !== null) deps.cancel(timer);
    timer = null;
  };

  return { track, flush: flushNow, reset, pending: () => queue.length };
}
