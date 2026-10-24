"use client";

import { useSyncExternalStore } from "react";
import type { Case } from "@/lib/journey/api-types";
import type { PersonaId } from "@/lib/journey/personas";
import type { PlanAnswers } from "@/lib/journey/plan-model";
import { KEYS, readJson, subscribe, writeJson } from "@/lib/journey/storage";

/**
 * The case this device is working on (one at a time; family cases switch here). The server case
 * (E-02) holds non-identifying facts; the plan answers (with the date of birth) and the last known
 * Case live on this device so the home and the plan card work offline (SCR-060 "Updated {ago}").
 */

export interface ActiveCase {
  caseId: string;
  planId: string | null;
  /** Family-mode member (a child, a parent) when the case is not the account holder's own. */
  memberId: string | null;
  memberLabel: string | null;
  minor: boolean;
  persona: PersonaId | null;
  /** True while the case exists only on this device (create failed or offline). */
  local: boolean;
}

const FACTS = "md.case.facts.v1";
const CACHE = "md.case.cache.v1";

export function getActiveCase(): ActiveCase | null {
  return readJson<ActiveCase | null>(KEYS.activeCase, null);
}

export function setActiveCase(c: ActiveCase | null): void {
  writeJson(KEYS.activeCase, c);
}

export function useActiveCase(): ActiveCase | null {
  return useSyncExternalStore(
    (l) => subscribe(KEYS.activeCase, l),
    () => getActiveCase(),
    () => null,
  );
}

/** Plan answers behind a case (on device only: they include the date of birth). */
export function getCaseFacts(caseId: string): PlanAnswers | null {
  return readJson<Record<string, PlanAnswers>>(FACTS, {})[caseId] ?? null;
}

export function setCaseFacts(caseId: string, answers: PlanAnswers): void {
  const all = readJson<Record<string, PlanAnswers>>(FACTS, {});
  writeJson(FACTS, { ...all, [caseId]: answers });
}

export function getCachedCase(caseId: string): (Case & { cached_at?: string }) | null {
  return readJson<Record<string, Case & { cached_at?: string }>>(CACHE, {})[caseId] ?? null;
}

export function cacheCase(c: Case): void {
  const all = readJson<Record<string, Case>>(CACHE, {});
  writeJson(CACHE, { ...all, [c.case_id]: { ...c, cached_at: new Date().toISOString() } });
}

export function useCachedCase(
  caseId: string | null | undefined,
): (Case & { cached_at?: string }) | null {
  return useSyncExternalStore(
    (l) => subscribe(CACHE, l),
    () => (caseId ? getCachedCase(caseId) : null),
    () => null,
  );
}

/** Forget every case on this device (after delete, or "Clear this device"). */
export function forgetCases(): void {
  writeJson(KEYS.activeCase, null);
  writeJson(FACTS, null);
  writeJson(CACHE, null);
}

export const CASE_KEYS = [FACTS, CACHE] as const;
