// @margdarshak/gamification/learning: FSRS scheduling, mastery, skill-tree
// node states, readiness and calibration (GAMIFICATION_ENGINE §3.1, §4, §5,
// §6). The evidence → rating table (`ratingFromEvidence`) and the difficulty
// staircase (GAME_SDK §7) live in @margdarshak/game-core/learning.
// biome-ignore-all lint/performance/noBarrelFile: subpath entry point (package.json "exports").

export type { CalibrationBin, ConfidentAnswer } from "./calibration.ts";
export {
  brier,
  CALIBRATION_WINDOW,
  CONFIDENCE_P,
  calibrationBins,
  isCalibrated,
  lastRated,
  overconfidence,
  sureAndWrong,
} from "./calibration.ts";
export type {
  QueuedCard,
  ReviewQueue,
  ReviewQueueLimits,
  TopicMastery,
  TopicMasteryOptions,
} from "./mastery.ts";
export {
  EVIDENCE_FLOOR_R,
  MIN_REVIEWS_FOR_COVERAGE,
  masteryByTopic,
  REVIEW_LIMITS,
  reviewQueue,
  topicMastery,
  topicOfCard,
} from "./mastery.ts";
export type { OutcomePair, PassModel, ReadinessSnapshot } from "./outcomes.ts";
export {
  fitPassModel,
  MIN_N_FOR_COUNT_LINE,
  MIN_PAIRS_FOR_FIT,
  outcomeCountLine,
  PAIRING_WINDOW_DAYS,
  pairOutcome,
  predictionBrier,
} from "./outcomes.ts";
export type {
  GateInput,
  GateReason,
  LlMasteries,
  LlTopic,
  Readiness,
  ReadinessGate,
  ReadinessTopic,
  ReadinessWeights,
  RoadReadiness,
} from "./readiness.ts";
export {
  CAL_PENALTY_MAX,
  CAL_PENALTY_SLOPE,
  calibrationPenalty,
  EQUAL_WEIGHTS,
  GATE_MOCK_MARGIN_PP,
  GATE_TOPIC_MIN,
  HILL_TENANTS,
  LL_TOPICS,
  MIN_CALIBRATION_ANSWERS,
  OC_TOLERANCE,
  READINESS_GATE,
  ROAD_MODULES_BASE,
  ROAD_MODULES_HILL,
  readiness,
  roadReadiness,
} from "./readiness.ts";
export type {
  CardPhase,
  CardState,
  PinnedFsrsParams,
  Scheduler,
  SchedulerOverrides,
} from "./scheduler.ts";
export {
  acceptReviewTime,
  createScheduler,
  FSRS_PARAMS,
  FSRS_WEIGHTS,
  pinnedScheduler,
  replayReviewLog,
} from "./scheduler.ts";
export type {
  ModuleId,
  NodeObservation,
  NodeState,
  NodeStates,
  SkillNodeId,
} from "./skilltree.ts";
export {
  atLeastLearning,
  canStartNode,
  DL_MODULES,
  DL1_REQUIRES,
  LL_MODULES,
  MASTERY_IN,
  MASTERY_OUT,
  nextNodeState,
  nodeState,
  ROAD_MODULES,
  SKILL_EDGES,
  SKILL_NODES,
} from "./skilltree.ts";
export type { ConfidenceLevel, RatedAnswer, ReviewLogEntry, ReviewRating } from "./types.ts";
