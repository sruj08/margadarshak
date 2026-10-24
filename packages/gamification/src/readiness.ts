// Test Readiness Score (GAMIFICATION_ENGINE §5, F-21) and Road Readiness (§5.4).
//
//   Knowledge  = round(100 × Σ_t w_t × M_t)               t ∈ {LL1..LL4}
//   OC         = mean(stated confidence) − accuracy        last 40 rated LL answers
//   CalPenalty = min(10, round(40 × max(0, OC − 0.05)))   0 under 15 rated answers
//   Readiness  = max(0, Knowledge − CalPenalty)
//
// Shown as "78 = knowledge 84 − calibration 6". The 85 gate is advisory:
// "Book anyway" is always visible (CCPA interface interference, DP-06).

import { lastRated, overconfidence } from "./calibration.ts";
import { clamp, mean, roundHalfUp, snap } from "./math.ts";
import type { RatedAnswer } from "./types.ts";

export const LL_TOPICS = ["LL1", "LL2", "LL3", "LL4"] as const;
export type LlTopic = (typeof LL_TOPICS)[number];
export type LlMasteries = Readonly<Partial<Record<LlTopic, number>>>;

export const READINESS_GATE = 85;
export const GATE_TOPIC_MIN = 0.7;
export const GATE_MOCK_MARGIN_PP = 10;
export const MIN_CALIBRATION_ANSWERS = 15;
export const OC_TOLERANCE = 0.05;
export const CAL_PENALTY_SLOPE = 40;
export const CAL_PENALTY_MAX = 10;

/** Topic weights. Anything other than equal weights must cite a rule-pack source (§5.1). */
export type ReadinessWeights = Readonly<Record<LlTopic, number>> & { readonly source: string };

export const EQUAL_WEIGHTS: ReadinessWeights = Object.freeze({
  LL1: 0.25,
  LL2: 0.25,
  LL3: 0.25,
  LL4: 0.25,
  source: "equal",
});

export interface GateInput {
  /** Percentages of the user's verified LL mocks, oldest first. */
  readonly llMockPcts: readonly number[];
  /** The state's LL pass mark in percent, from the rule pack (e.g. 60). */
  readonly passMarkPct: number;
}

export type GateReason =
  | "readiness_below_85"
  | "topic_below_0_7"
  | "fewer_than_2_mocks"
  | "mock_below_pass_mark_plus_10"
  | "no_mock_data";

export interface ReadinessGate {
  readonly met: boolean;
  /** Reason codes (i18n keys are the caller's); empty when met. */
  readonly reasons: readonly GateReason[];
  /** LL topics under 0.7, when `topic_below_0_7` is a reason. */
  readonly weakTopics: readonly LlTopic[];
  /** Always true, whatever the score (§5.2). */
  readonly bookAnywayVisible: true;
}

export interface ReadinessTopic {
  readonly topic: LlTopic;
  readonly mastery: number;
  readonly weight: number;
}

export interface Readiness {
  readonly readiness: number;
  readonly knowledge: number;
  readonly calPenalty: number;
  readonly topics: readonly ReadinessTopic[];
  readonly calibration: {
    /** Confidence-rated LL answers in the window (≤ 40). */
    readonly n: number;
    readonly oc: number | null;
    /** False under 15 answers: the chip says "calibration: not enough answers yet". */
    readonly enough: boolean;
  };
  /** "equal" or the rule-pack source of the weights. */
  readonly weightsSource: string;
  readonly gate: ReadinessGate;
}

function checkWeights(w: ReadinessWeights): void {
  let sum = 0;
  for (const t of LL_TOPICS) {
    const v = w[t];
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`weight for ${t} must be ≥ 0`);
    sum += v;
  }
  if (Math.abs(sum - 1) > 1e-9) throw new RangeError("readiness weights must sum to 1");
  if (w.source.trim() === "") throw new RangeError("readiness weights need a source");
}

/** CalPenalty from the rated answers (0 under 15 rated answers). */
export function calibrationPenalty(answers: readonly RatedAnswer[]): {
  penalty: number;
  n: number;
  oc: number | null;
} {
  const rated = lastRated(answers);
  const oc = overconfidence(rated);
  if (rated.length < MIN_CALIBRATION_ANSWERS || oc === null)
    return { penalty: 0, n: rated.length, oc };
  const raw = roundHalfUp(CAL_PENALTY_SLOPE * Math.max(0, snap(oc - OC_TOLERANCE)));
  return { penalty: Math.min(CAL_PENALTY_MAX, raw), n: rated.length, oc };
}

/**
 * Test Readiness (§5.1) with the advisory gate (§5.2). `answers` are the
 * confidence-rated LL answers, oldest first. Without `gateInput` the gate
 * reports `no_mock_data` (and is not met); the score itself is unaffected.
 */
export function readiness(
  masteries: LlMasteries,
  answers: readonly RatedAnswer[],
  weights: ReadinessWeights = EQUAL_WEIGHTS,
  gateInput?: GateInput,
): Readiness {
  checkWeights(weights);
  const topics = LL_TOPICS.map((topic) => ({
    topic,
    mastery: clamp(masteries[topic] ?? 0, 0, 1),
    weight: weights[topic],
  }));
  let weighted = 0;
  for (const t of topics) weighted += t.weight * t.mastery;
  const knowledge = roundHalfUp(100 * weighted);
  const cal = calibrationPenalty(answers);
  const score = Math.max(0, knowledge - cal.penalty);

  const reasons: GateReason[] = [];
  if (score < READINESS_GATE) reasons.push("readiness_below_85");
  const weakTopics = topics.filter((t) => t.mastery < GATE_TOPIC_MIN).map((t) => t.topic);
  if (weakTopics.length > 0) reasons.push("topic_below_0_7");
  if (gateInput === undefined) {
    reasons.push("no_mock_data");
  } else {
    const lastTwo = gateInput.llMockPcts.slice(-2);
    if (lastTwo.length < 2) reasons.push("fewer_than_2_mocks");
    else if (lastTwo.some((p) => p < gateInput.passMarkPct + GATE_MOCK_MARGIN_PP))
      reasons.push("mock_below_pass_mark_plus_10");
  }

  return {
    readiness: score,
    knowledge,
    calPenalty: cal.penalty,
    topics,
    calibration: { n: cal.n, oc: cal.oc, enough: cal.n >= MIN_CALIBRATION_ANSWERS },
    weightsSource: weights.source,
    gate: { met: reasons.length === 0, reasons, weakTopics, bookAnywayVisible: true },
  };
}

// ── Road Readiness (§5.4): separate, never mixed with LL, never a gate. ──────

export const ROAD_MODULES_BASE = ["M1", "M3", "M4", "M6", "M8", "M19"] as const;
export const ROAD_MODULES_HILL = ["M14"] as const;
/** Tenants whose Road Readiness includes the hill module M14. */
export const HILL_TENANTS: readonly string[] = ["JK"];

export interface RoadReadiness {
  /** 0–100, rounded; null while there is no Nazar Score (no eligible mocks yet). */
  readonly score: number | null;
  /** 0.5 × 100 × mean(M_t). */
  readonly knowledgePart: number;
  /** 0.5 × NazarScore; null without a Nazar Score. */
  readonly nazarPart: number | null;
  readonly modules: readonly string[];
}

/**
 * RoadReadiness = 0.5 × 100 × mean(M_t for M1, M3, M4, M6, M8, M19 [+ M14 in
 * the J&K tenant]) + 0.5 × NazarScore [D]. Missing masteries count as 0.
 * Never a gate and never called a "safety score".
 */
export function roadReadiness(
  masteries: Readonly<Record<string, number>>,
  nazarScore: number | null,
  tenant: { readonly stateCode: string },
): RoadReadiness {
  const modules: string[] = [...ROAD_MODULES_BASE];
  if (HILL_TENANTS.includes(tenant.stateCode.toUpperCase())) modules.push(...ROAD_MODULES_HILL);
  const m = mean(modules.map((id) => clamp(masteries[id] ?? 0, 0, 1))) ?? 0;
  const knowledgePart = snap(0.5 * 100 * m);
  if (nazarScore === null || !Number.isFinite(nazarScore)) {
    return { score: null, knowledgePart, nazarPart: null, modules };
  }
  const nazarPart = snap(0.5 * clamp(nazarScore, 0, 100));
  return { score: roundHalfUp(knowledgePart + nazarPart), knowledgePart, nazarPart, modules };
}
