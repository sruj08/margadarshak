import {
  type ActiveInterval,
  evaluateBadges,
  initialStreak,
  istDay,
  istMinutesOnDay,
  istWeek,
  multiplierAt,
  type NodeObservation,
  type NodeStates,
  nextWeekKey,
  parseWeekKey,
  type RankId,
  type RatedAnswer,
  rankFor,
  type SessionResultLike,
  type StreakState,
  setStreakGoal,
  streakTransition,
  streakView,
  xpForReviews,
  xpForSession,
} from "@margdarshak/gamification";
import type { Achievement, BadgeKey, RankKey } from "./api-types";
import { LEARN_KEYS, readKv, writeKv } from "./offline/kv";

/**
 * Device-side gamification for mock mode and anonymous sessions (GAMIFICATION_ENGINE §1: XP, rank,
 * streak and badges stay on the device until an account exists). Every number comes from
 * `@margdarshak/gamification`. XP is credited only for learning acts (reviews, lessons, scored
 * sessions); opening, sharing, inviting and joining earn nothing (§2.3).
 */

export interface XpEntry {
  at: number;
  xp: number;
  reason: "review" | "lesson" | "session";
  multiplier: number;
}

export interface WeekLog {
  [weekKey: string]: number;
}

export interface Declarations {
  khudLicence?: { dlIssueDate: string } | null;
  firstAttemptPass?: boolean;
  answeredNo?: boolean;
}

const RANK_KEY: Record<RankId, RankKey> = {
  R1: "gali",
  R2: "mohalla",
  R3: "shehar",
  R4: "highway",
  R5: "ghat",
};
export const RANK_ID: Record<RankKey, RankId> = {
  gali: "R1",
  mohalla: "R2",
  shehar: "R3",
  highway: "R4",
  ghat: "R5",
};

export function rankKey(id: RankId): RankKey {
  return RANK_KEY[id];
}

export function minutesToday(now: number): number {
  return istMinutesOnDay(readKv<ActiveInterval[]>(LEARN_KEYS.activity, []), now);
}

/** Records active learning time (one interval per review sitting, lesson or exam). */
export function recordActivity(start: number, end: number): void {
  if (!(end > start)) return;
  const all = readKv<ActiveInterval[]>(LEARN_KEYS.activity, []);
  // Keep two weeks: enough for "minutes today" and the streak week.
  const cutoff = end - 14 * 24 * 3600_000;
  writeKv(LEARN_KEYS.activity, [...all.filter((i) => i.end >= cutoff), { start, end }]);
}

function credit(entry: XpEntry): XpEntry {
  writeKv(LEARN_KEYS.xp, [...readKv<XpEntry[]>(LEARN_KEYS.xp, []), entry]);
  return entry;
}

/** XP for a review sitting: 5 per due card, diminished after 45/90 minutes today (§2.1–2.2). */
export function awardReviews(
  dueReviewed: number,
  start: number,
  end: number,
): { xp: number; multiplier: number } {
  const before = minutesToday(start);
  const minutes = Math.max(0, (end - start) / 60_000);
  const award = xpForReviews(dueReviewed, before, minutes);
  recordActivity(start, end);
  if (award.xp > 0) credit({ at: end, xp: award.xp, reason: "review", multiplier: award.diminish });
  return { xp: award.xp, multiplier: award.diminish };
}

/** XP for a scored session (LL simulator, lesson check): base × quality × diminish (§2.1). */
export function awardSession(
  result: SessionResultLike,
  start: number,
  end: number,
  reason: "lesson" | "session",
): { xp: number; multiplier: number } {
  const before = minutesToday(start);
  const minutes = Math.max(0, (end - start) / 60_000);
  const award = xpForSession(result, before, minutes);
  recordActivity(start, end);
  if (award.xp > 0) credit({ at: end, xp: award.xp, reason, multiplier: award.diminish });
  return { xp: award.xp, multiplier: award.diminish };
}

/** One counted streak session in the IST week of `at` (§7: a scored session, or ≥ 10 due reviews). */
export function countStreakSession(at: number): void {
  const weeks = readKv<WeekLog>(LEARN_KEYS.weeks, {});
  const key = istWeek(at).key;
  writeKv(LEARN_KEYS.weeks, { ...weeks, [key]: (weeks[key] ?? 0) + 1 });
}

/**
 * Closes every finished week since the last close, with that week's counted sessions
 * (streakTransition is idempotent and closes skipped weeks with 0). Silent: no event becomes a
 * message (§7 "On break": no push, no sad copy).
 */
export function currentStreak(now: number): StreakState {
  const weeks = readKv<WeekLog>(LEARN_KEYS.weeks, {});
  let s = readKv<StreakState | null>(LEARN_KEYS.streak, null) ?? initialStreak();
  const thisWeek = istWeek(now).key;
  const firstWeek = Object.keys(weeks).sort()[0];
  let k = s.lastClosedWeek ? nextWeekKey(s.lastClosedWeek) : (firstWeek ?? null);
  const target = parseWeekKey(thisWeek) ?? 0;
  let guard = 0;
  while (k !== null && (parseWeekKey(k) ?? Number.POSITIVE_INFINITY) < target && guard < 120) {
    s = streakTransition(s, { weekKey: k, sessions: weeks[k] ?? 0 }).state;
    k = nextWeekKey(k);
    guard++;
  }
  writeKv(LEARN_KEYS.streak, s);
  return s;
}

export function setGoal(goal: number, now: number): StreakState {
  const s = setStreakGoal(currentStreak(now), goal);
  writeKv(LEARN_KEYS.streak, s);
  return s;
}

export function sessionsThisWeek(now: number): number {
  return readKv<WeekLog>(LEARN_KEYS.weeks, {})[istWeek(now).key] ?? 0;
}

export function deviceStreakView(now: number) {
  const s = currentStreak(now);
  return { state: s, view: streakView(s, sessionsThisWeek(now), now) };
}

const BADGE_KEY: Record<string, BadgeKey> = {
  B1: "khud_licence",
  B2: "pehli_baar_pass",
  B3: "nazar_90",
  B4: "calibrated",
  B5: "no_zone_navigator",
  B6: "strap_streak",
  B7: "night_ready",
  B8: "ghat_ready",
  B9: "golden_hour_ready",
};

export function nodeStatesFromHistory(
  hist: Record<string, NodeObservation[]>,
  stateOf: (h: NodeObservation[] | undefined) => NodeStates[keyof NodeStates],
): NodeStates {
  const out: Record<string, NodeStates[keyof NodeStates]> = {};
  for (const [k, v] of Object.entries(hist)) out[k] = stateOf(v);
  return out as NodeStates;
}

/** API-38-shaped achievements from this phone. */
export function deviceAchievement(
  now: number,
  nodeStates: NodeStates,
  answers: readonly RatedAnswer[],
  hasAccount: boolean,
): Achievement {
  const ledger = readKv<XpEntry[]>(LEARN_KEYS.xp, []);
  const total = ledger.reduce((s, e) => s + e.xp, 0);
  const today = ledger.filter((e) => istDay(e.at) === istDay(now));
  const held = readKv<RankId | null>(LEARN_KEYS.rank, null);
  const rank = rankFor(total, nodeStates, held ? { currentRank: held } : {});
  if (rank.rank !== held) writeKv(LEARN_KEYS.rank, rank.rank);
  const decl = readKv<Declarations>(LEARN_KEYS.decl, {});
  const badges = evaluateBadges({
    hasAccount,
    declarations: {
      khudLicence: decl.khudLicence ?? null,
      firstAttemptPass: decl.firstAttemptPass === true,
    },
    answers,
    nodeStates,
  });
  const { state, view } = deviceStreakView(now);
  const mult = multiplierAt(minutesToday(now));
  return {
    xp_total: total,
    xp_today: today.reduce((s, e) => s + e.xp, 0),
    xp_multiplier_today: mult === 1 ? 1 : mult === 0.5 ? 0.5 : 0.2,
    rank: rankKey(rank.rank),
    rank_requirements: {
      next: rank.next ? rankKey(rank.next.rank) : null,
      xp_missing: rank.next?.xpMissing ?? 0,
      missing_nodes: rank.next?.nodesMissing.map((n) => n.node) ?? [],
      nazar_mocks_missing: rank.next?.nazarMocksMissing ?? 0,
    },
    badges: badges.map((b) => ({
      badge_id: BADGE_KEY[b.id] ?? "khud_licence",
      awarded_at: b.earned ? new Date(now).toISOString() : null,
      self_declared: b.yourWord,
      ...(b.label ? { label: b.label } : {}),
    })),
    streak: {
      status: state.status,
      weekly_goal: state.goal,
      this_week: view.filled,
      weeks: state.weeks,
      freeze_tokens: state.tokens,
      archived: view.archived,
    },
  };
}
