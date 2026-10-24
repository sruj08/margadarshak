// @margdarshak/gamification/gamification: XP, ranks, weekly streaks, squads,
// badges, share-card and family-mode guards, and the dark-pattern lint spec
// (GAMIFICATION_ENGINE §1, §2, §3.2, §7–§10, §12, §13).
// biome-ignore-all lint/performance/noBarrelFile: subpath entry point (package.json "exports").

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
export type { Access, AgeBand, AgeInput, Feature } from "./family.ts";
export { ageBand, featureAccess, ownAccountOffer } from "./family.ts";
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
export type {
  ParentConsents,
  Profile,
  ProfileKind,
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
