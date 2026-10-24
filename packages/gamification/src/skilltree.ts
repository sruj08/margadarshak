// Skill tree (GAMIFICATION_ENGINE §3.1, CURRICULUM §1, §4). One node per
// curriculum module; node state follows mastery with hysteresis so a node
// doesn't flicker: in at M_t ≥ 0.8 (plus the module's game criterion), out at
// M_t < 0.7.

export const LL_MODULES = ["LL0", "LL1", "LL2", "LL3", "LL4"] as const;
export const ROAD_MODULES = [
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "M6",
  "M7",
  "M8",
  "M9",
  "M10",
  "M11",
  "M12",
  "M13",
  "M14",
  "M15",
  "M16",
  "M17",
  "M18",
  "M19",
  "M20",
  "M21",
  "M22",
] as const;
export const DL_MODULES = ["DL1"] as const;

export type ModuleId =
  | (typeof LL_MODULES)[number]
  | (typeof ROAD_MODULES)[number]
  | (typeof DL_MODULES)[number];
export type SkillNodeId = `SK-${ModuleId}`;

export const SKILL_NODES: readonly SkillNodeId[] = [
  ...LL_MODULES.map((m) => `SK-${m}` as const),
  ...ROAD_MODULES.map((m) => `SK-${m}` as const),
  ...DL_MODULES.map((m) => `SK-${m}` as const),
];

/**
 * Suggested learning order (the arrows in §3.1 / CURRICULUM §1). Only DL1 has a
 * hard requirement (see DL1_REQUIRES); the other edges are display order and
 * never block a learner from starting a module.
 */
export const SKILL_EDGES: readonly (readonly [SkillNodeId, SkillNodeId])[] = [
  ["SK-LL0", "SK-LL1"],
  ["SK-LL1", "SK-LL2"],
  ["SK-LL2", "SK-LL3"],
  ["SK-LL3", "SK-LL4"],
  ["SK-M1", "SK-M2"],
  ["SK-M2", "SK-M7"],
  ["SK-M7", "SK-M16"],
  ["SK-M3", "SK-M13"],
  ["SK-M4", "SK-M5"],
  ["SK-M6", "SK-M18"],
  ["SK-M8", "SK-M16"],
  ["SK-M14", "SK-M15"],
  ["SK-LL1", "SK-DL1"],
  ["SK-M1", "SK-DL1"],
];

/** "SK-DL1 Track (class-specific) ← requires SK-M1 + SK-LL1 at 'learning'". */
export const DL1_REQUIRES: readonly SkillNodeId[] = ["SK-M1", "SK-LL1"];

export type NodeState = "locked" | "learning" | "mastered" | "fading";
export type NodeStates = Readonly<Partial<Record<SkillNodeId, NodeState>>>;

export const MASTERY_IN = 0.8;
export const MASTERY_OUT = 0.7;

/** One mastery observation for a node, oldest first. */
export interface NodeObservation {
  /** M_t at the time of the observation (0–1). */
  readonly mastery: number;
  /** The module's game criterion (CURRICULUM §6 "module pass"); once met it stays met. */
  readonly gameCriterionMet?: boolean;
  /** Any evidence posted for the node. Defaults to true (an observation implies evidence). */
  readonly hasEvidence?: boolean;
}

/** Single transition of the node state machine. */
export function nextNodeState(
  prev: NodeState,
  obs: NodeObservation,
  criterionEverMet: boolean,
): NodeState {
  const evidence = obs.hasEvidence ?? true;
  const m = Number.isFinite(obs.mastery) ? obs.mastery : 0;
  const criterion = criterionEverMet || obs.gameCriterionMet === true;
  switch (prev) {
    case "locked":
      if (!evidence) return "locked";
      return m >= MASTERY_IN && criterion ? "mastered" : "learning";
    case "learning":
      return m >= MASTERY_IN && criterion ? "mastered" : "learning";
    case "mastered":
      return m < MASTERY_OUT ? "fading" : "mastered";
    case "fading":
      // Re-mastering needs the full 0.8 again: that is the hysteresis.
      return m >= MASTERY_IN ? "mastered" : "fading";
  }
}

/**
 * Folds a node's chronological mastery history into its state (§3.1):
 * locked → learning (any evidence) → mastered (M_t ≥ 0.8 and the module's
 * game criterion) → fading (M_t < 0.7 after mastered) → mastered (M_t ≥ 0.8).
 * A fading node never drops back to "learning"; the UI shows a soft
 * "Refresh" chip.
 */
export function nodeState(history: readonly NodeObservation[]): NodeState {
  let state: NodeState = "locked";
  let criterion = false;
  for (const obs of history) {
    state = nextNodeState(state, obs, criterion);
    if (obs.gameCriterionMet === true) criterion = true;
  }
  return state;
}

/** True when the node is at "learning" or beyond (learning, mastered or fading). */
export function atLeastLearning(state: NodeState | undefined): boolean {
  return state === "learning" || state === "mastered" || state === "fading";
}

/** Whether a learner may start the node. Only SK-DL1 has a prerequisite. */
export function canStartNode(node: SkillNodeId, states: NodeStates): boolean {
  if (node !== "SK-DL1") return true;
  return DL1_REQUIRES.every((n) => atLeastLearning(states[n]));
}
