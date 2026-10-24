import type { PublicStats } from "./api";

/** k-anonymity threshold (API-71, W13): a count of people below this is never shown. */
export const K_MIN = 5;

export type StatId =
  | "plans_computed"
  | "cases_started"
  | "lab_trials_recorded"
  | "journey_participants"
  | "nazar_participants"
  | "median_portal"
  | "median_margdarshak";

export interface StatCell {
  id: StatId;
  /** The number to show, or null when suppressed (n < 5) or not measured yet. */
  value: number | null;
  suppressed: boolean;
  unit: "count" | "seconds";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function count(id: StatId, v: unknown): StatCell {
  const n = num(v);
  const suppressed = n === null || n < K_MIN;
  return { id, value: suppressed ? null : n, suppressed, unit: "count" };
}

/**
 * The counters for the judges' card and the lab page. Every count under 5 is suppressed on the
 * phone too (the API already suppresses medians with n < 5, as the string "suppressed (n < 5)").
 * A median is shown only when its arm has at least 5 participants.
 */
export function statCells(s: PublicStats): StatCell[] {
  const c = s.counters ?? {};
  const jt = (s.journey_test ?? {}) as Record<string, unknown>;
  const nz = (s.nazar ?? {}) as Record<string, unknown>;
  const participants = num(jt["participants"]) ?? 0;
  const medians = (jt["median_seconds_find_fee_docs"] ?? {}) as Record<string, unknown>;
  const median = (id: StatId, ...arms: string[]): StatCell => {
    const v = arms.map((a) => num(medians[a])).find((x) => x !== null) ?? null;
    const suppressed = v === null || participants < K_MIN;
    return { id, value: suppressed ? null : Math.round(v), suppressed, unit: "seconds" };
  };
  return [
    count("plans_computed", c["plans_computed"]),
    count("cases_started", c["cases_started"]),
    count("lab_trials_recorded", c["lab_trials_recorded"]),
    count("journey_participants", jt["participants"]),
    count("nazar_participants", nz["participants"]),
    median("median_portal", "portal_replica", "portal"),
    median("median_margdarshak", "margdarshak"),
  ];
}
