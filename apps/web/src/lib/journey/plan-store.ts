"use client";

import { useSyncExternalStore } from "react";
import type { PlanAnswers, PlanRecord } from "./plan-model";
import { KEYS, readJson, subscribe, writeJson } from "./storage";

/**
 * Plan records on this device (SCR-014 "Saved on this phone"). The last five are kept; the plan
 * card renders from here offline. Records hold the plan answers (including a date of birth if the
 * person gave one), so they never leave the device; the share link carries only an age band.
 */

const MAX = 5;

function all(): PlanRecord[] {
  return readJson<PlanRecord[]>(KEYS.plans, []);
}

export function savePlan(rec: PlanRecord): void {
  const rest = all().filter((p) => p.id !== rec.id);
  writeJson(KEYS.plans, [rec, ...rest].slice(0, MAX));
}

export function getPlan(id: string | null | undefined): PlanRecord | null {
  if (!id) return null;
  return all().find((p) => p.id === id) ?? null;
}

export function latestPlan(): PlanRecord | null {
  return all()[0] ?? null;
}

export function usePlan(id: string | null | undefined): PlanRecord | null {
  return useSyncExternalStore(
    (l) => subscribe(KEYS.plans, l),
    () => getPlan(id),
    () => null,
  );
}

/** The wizard's in-progress answers (survive a reload and the back button). */
export type PlanDraft = Partial<PlanAnswers> & { step?: number | string };

export function readPlanDraft(): PlanDraft {
  return readJson<PlanDraft>(KEYS.planDraft, {});
}

export function writePlanDraft(d: PlanDraft | null): void {
  writeJson(KEYS.planDraft, d);
}
