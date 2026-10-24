// @margdarshak/gamification: everything from ./learning and ./gamification,
// plus the IST time helpers and the structural input types. Pure functions;
// nothing here reads the clock, the network or storage.
// biome-ignore-all lint/performance/noBarrelFile: package entry point (package.json "exports").

export type {
  BadgeDef,
  BadgeHistory,
  BadgeId,
  BadgeLabel,
  BadgeSession,
  BadgeShape,
  BadgeStatus,
  BadgeVerifier,
} from "./badges.ts";
export { BADGES, evaluateBadges } from "./badges.ts";
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
export type { Access, AgeBand, AgeInput, Feature } from "./family.ts";
export { ageBand, featureAccess, ownAccountOffer } from "./family.ts";
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
export type { CopyRule, Enforcement, PatternRule } from "./patterns.ts";
export { patternLintSpec, patternRule } from "./patterns.ts";
export type {
  RankDef,
  RankGap,
  RankId,
  RankOptions,
  RankRequirement,
  RankResult,
  RankShape,
} from "./ranks.ts";
export { RANKS, rankFor } from "./ranks.ts";
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
  ShareCardContent,
  ShareCardContext,
  ShareCardViolation,
  ShareDecision,
} from "./share.ts";
export {
  BANNED_DOMAIN_PARTS,
  canCreateShareCard,
  isAllowedShareHost,
  PERCENTILE_MIN_BASELINE,
  percentileVisible,
  SHARE_CARD_TTL_DAYS,
  shareCardLive,
  shareCardViolations,
} from "./share.ts";
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
export type {
  SquadJoinDecision,
  SquadMemberRecord,
  SquadReaction,
  SquadScoreMember,
} from "./squads.ts";
export {
  canJoinSquad,
  canUsePairMode,
  INVITE_TTL_DAYS,
  inviteValid,
  memberView,
  SANGATHAN_WEEKS,
  SESSIONS_PER_MEMBER_GOAL,
  SQUAD_MAX,
  SQUAD_MIN,
  SQUAD_MIN_CONTRIBUTORS,
  SQUAD_REACTIONS,
  sangathanRibbon,
  squadRibbon,
  squadScore,
  squadWeeklyGoal,
} from "./squads.ts";
export type {
  StreakEvent,
  StreakState,
  StreakStatus,
  StreakTransition,
  StreakView,
  WeekClose,
} from "./streak.ts";
export {
  archiveStreak,
  clampGoal,
  countStreakSessions,
  initialStreak,
  MAX_FREEZE_TOKENS,
  REPAIR_EXTRA_SESSIONS,
  REVIEWS_PER_STREAK_SESSION,
  STREAK_GOAL_DEFAULT,
  STREAK_GOAL_MAX,
  STREAK_GOAL_MIN,
  setStreakGoal,
  streakTransition,
  streakView,
} from "./streak.ts";
export type { ActiveInterval, EpochMs, IsoWeek } from "./time.ts";
export {
  civilFromDays,
  DAY_MS,
  daysFromCivil,
  HOUR_MS,
  IST_OFFSET_MS,
  isoWeekday,
  isoWeekOfDay,
  istDate,
  istDay,
  istDayStart,
  istMinutesOnDay,
  istWeek,
  MINUTE_MS,
  nextWeekKey,
  parseWeekKey,
} from "./time.ts";
export type {
  ConfidenceLevel,
  ParentConsents,
  Profile,
  ProfileKind,
  RatedAnswer,
  ReviewLogEntry,
  ReviewRating,
  SessionMode,
  SessionResultLike,
} from "./types.ts";
export type { NoXpAction, XpAward } from "./xp.ts";
export {
  crossedSpacingLine,
  DIMINISH_BANDS,
  diminish,
  LOW_TRUST_FACTOR,
  multiplierAt,
  NO_XP_ACTIONS,
  QUALITY_FLOOR,
  TRUST_THRESHOLD,
  XP_BASE,
  XP_PER_DUE_REVIEW,
  xpForAction,
  xpForReviews,
  xpForSession,
} from "./xp.ts";
