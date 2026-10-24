"use client";

import { getActiveCase, getCachedCase } from "@/lib/case/case-store";
import { createAnalytics } from "./analytics";
import { API_MODE, listConsents, sendAnalytics } from "./api";
import { KEYS, readJson } from "./storage";

/**
 * The app's analytics queue (see analytics.ts for the rules). Events go to API-63 only with a real
 * API, the analytics consent granted and an active case that is not a minor family member's.
 */
const analytics = createAnalytics({
  enabled: () => API_MODE === "real" && typeof window !== "undefined",
  consent: () => readJson<boolean | null>(KEYS.analyticsConsent, null),
  refreshConsent: async () => {
    const r = await listConsents();
    return r.data.some((c) => c.purpose === "analytics" && c.status === "active");
  },
  activeCase: () => {
    const a = getActiveCase();
    if (!a) return { caseId: null, minor: false };
    const flags = getCachedCase(a.caseId)?.flags ?? [];
    return {
      caseId: a.local ? null : a.caseId,
      minor: a.minor || flags.includes("for_minor_family_member"),
    };
  },
  send: sendAnalytics,
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

let hooked = false;
function hookPageHide(): void {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  window.addEventListener("pagehide", () => void analytics.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void analytics.flush();
  });
}

/** Queues an allowlisted, PII-free event (dropped without consent or for a minor's case). */
export function track(name: string, props?: Record<string, unknown>): void {
  hookPageHide();
  analytics.track(name, props);
}

/** Drops anything queued (consent revoked, data deleted). */
export function resetAnalytics(): void {
  analytics.reset();
}
