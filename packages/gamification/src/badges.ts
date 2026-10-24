// Badges (GAMIFICATION_ENGINE §9): nine, road-sign shaped, deterministic.
// Criteria live in BADGES so the UI can show them *before* the user starts
// (CCPA bait-and-switch, DP-07: badge copy is generated from this config).
// Badges can't be bought, gifted or earned by sharing; self-declared badges
// need an account and carry a "your word" flag; revoking a self-declaration
// removes the badge silently (it simply stops evaluating as earned).

import { isCalibrated } from "./calibration.ts";
import type { NodeState, NodeStates } from "./skilltree.ts";
import type { EpochMs } from "./time.ts";
import { istDay } from "./time.ts";
import type { RatedAnswer, SessionResultLike } from "./types.ts";

export type BadgeId = "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7" | "B8" | "B9";
export type BadgeShape = "rectangle" | "circle" | "triangle" | "octagon";
export type BadgeVerifier = "self_declared" | "server" | "self_check";
/** Label keys (i18n is the caller's). "Verified" is never used for user records (PROJECT_BRIEF §15). */
export type BadgeLabel = "your_word" | "self_checked" | "counted_sessions" | null;

export interface BadgeDef {
  readonly id: BadgeId;
  readonly key: string;
  readonly name: string;
  readonly shape: BadgeShape;
  readonly verifiedBy: BadgeVerifier;
  readonly label: BadgeLabel;
  /** Machine-readable criterion; the shown criterion text is generated from it. */
  readonly criterion: Readonly<Record<string, number | string | boolean>>;
}

export const BADGES: readonly BadgeDef[] = [
  {
    id: "B1",
    key: "khud_licence",
    name: "Khud Licence",
    shape: "rectangle",
    verifiedBy: "self_declared",
    label: "your_word",
    criterion: { declaration: "dl_without_agent", needsDlIssueDate: true },
  },
  {
    id: "B2",
    key: "pehli_baar_pass",
    name: "Pehli Baar Pass",
    shape: "rectangle",
    verifiedBy: "self_declared",
    label: "your_word",
    criterion: { declaration: "first_attempt_dl_pass" },
  },
  {
    id: "B3",
    key: "nazar_90",
    name: "Nazar 90",
    shape: "circle",
    verifiedBy: "server",
    label: "counted_sessions",
    criterion: { minNazarScore: 90, minEligibleMocks: 3 },
  },
  {
    id: "B4",
    key: "calibrated",
    name: "Calibrated",
    shape: "circle",
    verifiedBy: "server",
    label: null,
    criterion: { maxBrier: 0.18, minItems: 40, maxGapIn100Bin: 0.1 },
  },
  {
    id: "B5",
    key: "no_zone_navigator",
    name: "No-Zone Navigator",
    shape: "triangle",
    verifiedBy: "server",
    label: null,
    criterion: { gameId: "blind_spot", minPct: 85, times: 2, minDaysApart: 2 },
  },
  {
    id: "B6",
    key: "strap_streak",
    name: "Strap Streak",
    shape: "circle",
    verifiedBy: "self_check",
    label: "self_checked",
    criterion: { helmetSelfChecks: 7, withinDays: 14 },
  },
  {
    id: "B7",
    key: "night_ready",
    name: "Night Ready",
    shape: "triangle",
    verifiedBy: "server",
    label: null,
    criterion: { node: "SK-M8", state: "mastered" },
  },
  {
    id: "B8",
    key: "ghat_ready",
    name: "Ghat Ready",
    shape: "triangle",
    verifiedBy: "server",
    label: null,
    criterion: { node: "SK-M14", state: "mastered" },
  },
  {
    id: "B9",
    key: "golden_hour_ready",
    name: "Golden Hour Ready",
    shape: "octagon",
    verifiedBy: "server",
    label: null,
    criterion: {
      gameId: "golden_hour",
      minPct: 80,
      noCriticalError: true,
      needsMedicalSignOff: true,
    },
  },
];

/** A verified session with its completion time (SessionResult has no timestamp of its own). */
export interface BadgeSession extends SessionResultLike {
  readonly completedAt: EpochMs;
}

export interface BadgeHistory {
  /** Has an account (self-declared badges need one: no anonymous claims). */
  readonly hasAccount: boolean;
  readonly declarations?: {
    /** B1: "I got my DL without an agent", with the DL issue date. */
    readonly khudLicence?: { readonly dlIssueDate: string } | null;
    /** B2: first-attempt DL pass. */
    readonly firstAttemptPass?: boolean;
  };
  /** Nazar Score and the number of eligible mocks behind it (NAZAR.md computes it). */
  readonly nazar?: { readonly score: number | null; readonly eligibleMocks: number };
  /** Confidence-rated answers, oldest first (for B4). */
  readonly answers?: readonly RatedAnswer[];
  /** Verified scored sessions (for B5, B9). */
  readonly sessions?: readonly BadgeSession[];
  /** Helmet self-check times (for B6). */
  readonly helmetSelfChecks?: readonly EpochMs[];
  readonly nodeStates?: NodeStates;
  /** Phase 1–2 route to B7: night-tagged Nazar hazard types mastered. */
  readonly nightNazarTypesMastered?: boolean;
  /** CURRICULUM M19 medical sign-off; B9 is unavailable without it. */
  readonly goldenHourMedicalSignOff?: boolean;
}

export interface BadgeStatus {
  readonly id: BadgeId;
  readonly key: string;
  readonly shape: BadgeShape;
  readonly earned: boolean;
  /** False when the badge can't be earned yet (B9 before medical sign-off, self-declared without an account). */
  readonly available: boolean;
  /** Self-declared: shown as "Your word" / "आपका वचन", never as a government check. */
  readonly yourWord: boolean;
  readonly verifiedBy: BadgeVerifier;
  readonly label: BadgeLabel;
  /** For B3's "n counted sessions" label. */
  readonly count?: number;
}

const TRUST_MIN = 0.6;
const countable = (s: BadgeSession): boolean => s.integrity.trust >= TRUST_MIN;
/** A mastered node stays earned for badges once it fades: the badge was earned at mastery. */
const wasMastered = (s: NodeState | undefined): boolean => s === "mastered" || s === "fading";

function noZoneNavigator(sessions: readonly BadgeSession[]): boolean {
  const days = sessions
    .filter((s) => s.gameId === "blind_spot" && countable(s) && s.score.pct >= 85)
    .map((s) => istDay(s.completedAt));
  if (days.length < 2) return false;
  return Math.max(...days) - Math.min(...days) >= 2;
}

function strapStreak(checks: readonly EpochMs[]): boolean {
  // Distinct IST days, so 7 taps in a minute aren't 7 checks; any 14-day window.
  const days = [...new Set(checks.map(istDay))].sort((a, b) => a - b);
  for (let i = 0; i + 6 < days.length; i++) {
    const first = days[i];
    const seventh = days[i + 6];
    if (first !== undefined && seventh !== undefined && seventh - first <= 13) return true;
  }
  return false;
}

function goldenHourReady(sessions: readonly BadgeSession[]): boolean {
  return sessions.some(
    (s) =>
      s.gameId === "golden_hour" &&
      countable(s) &&
      s.score.pct >= 80 &&
      !(s.findings ?? []).some((f) => f.critical) &&
      (s.score.capApplied ?? null) === null,
  );
}

/** Evaluates all nine badges from history. Pure: the backend persists the result (E-22). */
export function evaluateBadges(history: BadgeHistory): BadgeStatus[] {
  const sessions = history.sessions ?? [];
  const nodes = history.nodeStates ?? {};
  const decl = history.declarations ?? {};
  const nazar = history.nazar;
  const medical = history.goldenHourMedicalSignOff === true;

  const earned: Record<BadgeId, boolean> = {
    B1:
      history.hasAccount &&
      typeof decl.khudLicence?.dlIssueDate === "string" &&
      decl.khudLicence.dlIssueDate !== "",
    B2: history.hasAccount && decl.firstAttemptPass === true,
    B3:
      nazar !== undefined && nazar.score !== null && nazar.score >= 90 && nazar.eligibleMocks >= 3,
    B4: isCalibrated(history.answers ?? []),
    B5: noZoneNavigator(sessions),
    B6: strapStreak(history.helmetSelfChecks ?? []),
    B7: wasMastered(nodes["SK-M8"]) || history.nightNazarTypesMastered === true,
    B8: wasMastered(nodes["SK-M14"]),
    B9: medical && goldenHourReady(sessions),
  };

  return BADGES.map((def) => {
    const selfDeclared = def.verifiedBy === "self_declared";
    const available = def.id === "B9" ? medical : selfDeclared ? history.hasAccount : true;
    const status: BadgeStatus = {
      id: def.id,
      key: def.key,
      shape: def.shape,
      earned: earned[def.id],
      available,
      yourWord: selfDeclared,
      verifiedBy: def.verifiedBy,
      label: def.label,
    };
    return def.id === "B3" && nazar !== undefined
      ? { ...status, count: nazar.eligibleMocks }
      : status;
  });
}
