// Client vs server comparison (GAME_SDK §6.3) and the "what counts where" table (§6.4).
import type { IntegrityFlag, SessionResult } from "../schema/result.ts";
import { computeTrust, mergeFlags, TRUST_PRACTICE_ONLY_BELOW } from "./trust.ts";

/** Percentage-point tolerance before a client preview counts as a mismatch. */
export const REPLAY_TOLERANCE_PCT = 0.5;

export interface ComparisonResult {
  match: boolean;
  clientPct: number;
  serverPct: number;
  deltaPct: number;
  findingIdsMatch: boolean;
}

type Comparable = { score: { pct: number }; findings: readonly { findingId: string }[] };

const idSet = (r: Comparable): string[] => [...new Set(r.findings.map((f) => f.findingId))].sort();

/** Match iff |Δpct| ≤ 0.5 and the same set of finding IDs. The server result always wins. */
export function compareResults(client: Comparable, server: Comparable): ComparisonResult {
  const deltaPct = Math.round(Math.abs(client.score.pct - server.score.pct) * 10000) / 10000;
  const a = idSet(client);
  const b = idSet(server);
  const findingIdsMatch = a.length === b.length && a.every((id, i) => id === b[i]);
  return {
    match: deltaPct <= REPLAY_TOLERANCE_PCT && findingIdsMatch,
    clientPct: client.score.pct,
    serverPct: server.score.pct,
    deltaPct,
    findingIdsMatch,
  };
}

/** Returns a copy of `result` with extra flags merged and trust recomputed. */
export function withIntegrityFlags(
  result: SessionResult,
  extra: readonly IntegrityFlag[],
): SessionResult {
  const flags = mergeFlags(result.integrity.flags as IntegrityFlag[], extra);
  return { ...result, integrity: { ...result.integrity, flags, trust: computeTrust(flags) } };
}

export type EligibilityPurpose =
  | "fsrs"
  | "xp"
  | "readiness"
  | "nazar_score"
  | "percentile"
  | "badge"
  | "field_study";

export interface EligibilityContext {
  /** Verified mocks in the percentile baseline (needs ≥ 200). */
  baselineCount?: number;
  /** Field study: cohort, consent and age band of the participant. */
  cohort?: string;
  consented?: boolean;
  userBand?: "u18" | "adult";
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export const PERCENTILE_BASELINE_MIN = 200;

/** May this session count for `purpose`? Reasons list every unmet requirement (stable codes). */
export function eligibility(
  result: SessionResult,
  purpose: EligibilityPurpose,
  ctx: EligibilityContext = {},
): EligibilityResult {
  const reasons: string[] = [];
  const verified = !result.integrity.provisional;
  if (!verified) reasons.push("not_verified");
  const nazarScoreReasons = (): void => {
    if (result.gameId !== "nazar") reasons.push("not_nazar");
    if (result.mode !== "mock") reasons.push("not_mock");
    if (result.seedOrigin !== "server") reasons.push("offline_seed");
    if (result.integrity.flags.includes("INT_SEEN_CLIP")) reasons.push("seen_clip");
    if (result.integrity.trust < TRUST_PRACTICE_ONLY_BELOW) reasons.push("low_trust");
    if (result.integrity.timingMode !== "rvfc") reasons.push("timing_not_rvfc");
  };
  switch (purpose) {
    case "fsrs":
    case "xp":
    case "readiness":
    case "badge":
      break;
    case "nazar_score":
      nazarScoreReasons();
      break;
    case "percentile":
      nazarScoreReasons();
      if ((ctx.baselineCount ?? 0) < PERCENTILE_BASELINE_MIN) reasons.push("baseline_too_small");
      break;
    case "field_study":
      if (ctx.cohort !== "field_test") reasons.push("not_field_cohort");
      if (ctx.consented !== true) reasons.push("no_consent");
      if (ctx.userBand !== "adult") reasons.push("not_adult");
      if (result.integrity.trust < TRUST_PRACTICE_ONLY_BELOW) reasons.push("low_trust");
      break;
  }
  return { eligible: reasons.length === 0, reasons };
}
