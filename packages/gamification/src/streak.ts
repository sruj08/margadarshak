// Weekly repairable streaks (GAMIFICATION_ENGINE §7). Weeks are ISO weeks on
// the IST calendar (Monday 00:00 – Sunday 23:59 IST). Freeze tokens apply
// silently; a missed week with no token can be repaired with goal + 2
// sessions the next week; a break is silent; the streak is archived on DL test
// day and is never a lifetime streak. A streak never triggers a notification.
//
// State machine (E-22 `streak`):
//   active(w, t) + goal met          → active(w + 1, min(2, t + 1))
//   active(w, t) + missed, t > 0     → active(w, t − 1)            silently
//   active(w, 0) + missed            → repairable(w)
//   repairable(w) + ≥ goal + 2       → active(w + 1, …)
//   repairable(w) + fewer            → active(0, …)                silently

import type { EpochMs } from "./time.ts";
import { istDate, istWeek, nextWeekKey, parseWeekKey } from "./time.ts";

export const STREAK_GOAL_MIN = 2;
export const STREAK_GOAL_MAX = 6;
export const STREAK_GOAL_DEFAULT = 4;
export const MAX_FREEZE_TOKENS = 2;
export const REPAIR_EXTRA_SESSIONS = 2;
export const REVIEWS_PER_STREAK_SESSION = 10;

export type StreakStatus = "active" | "repairable" | "archived";

export interface StreakState {
  readonly status: StreakStatus;
  /** Completed weeks in the current run. */
  readonly weeks: number;
  /** Banked freeze tokens (0–2). */
  readonly tokens: number;
  /** Weekly goal in sessions (2–6). */
  readonly goal: number;
  /** ISO week key (IST) of the last week closed, e.g. "2026-W43"; null before the first close. */
  readonly lastClosedWeek: string | null;
  /** IST date of DL test day ("YYYY-MM-DD") once archived. */
  readonly archivedOn?: string;
}

export function initialStreak(goal = STREAK_GOAL_DEFAULT): StreakState {
  return { status: "active", weeks: 0, tokens: 0, goal: clampGoal(goal), lastClosedWeek: null };
}

export function clampGoal(goal: number): number {
  if (!Number.isFinite(goal)) return STREAK_GOAL_DEFAULT;
  return Math.min(STREAK_GOAL_MAX, Math.max(STREAK_GOAL_MIN, Math.round(goal)));
}

/**
 * Sessions that count toward the weekly goal (§7): each verified scored game
 * session counts as one, and each review sitting with ≥ 10 due reviews counts
 * as one.
 */
export function countStreakSessions(input: {
  readonly verifiedScoredSessions: number;
  readonly dueReviewsPerSitting?: readonly number[];
}): number {
  const games = Math.max(0, Math.floor(input.verifiedScoredSessions));
  const sittings = (input.dueReviewsPerSitting ?? []).filter(
    (n) => n >= REVIEWS_PER_STREAK_SESSION,
  ).length;
  return games + sittings;
}

export type StreakEvent =
  | "goal_met"
  | "token_applied"
  | "became_repairable"
  | "repaired"
  | "reset"
  | "archived";

export interface WeekClose {
  /** ISO week key (IST) of the week being closed. */
  readonly weekKey: string;
  /** Counted sessions in that week (see countStreakSessions). */
  readonly sessions: number;
  /** E-11 `test_passed` time, when DL test day fell in or before the end of this week. */
  readonly testPassedAt?: EpochMs;
}

export interface StreakTransition {
  readonly state: StreakState;
  /** Ledger events for E-22 (never user-facing copy). */
  readonly events: readonly StreakEvent[];
  /** Always false: a streak alone never triggers a notification (§7, DP-10). */
  readonly notify: false;
}

function closeOne(
  s: StreakState,
  sessions: number,
  weekKey: string,
): { state: StreakState; events: StreakEvent[] } {
  const met = sessions >= s.goal;
  // "+1 per completed week, max 2 banked": every week whose goal is met earns a token.
  const earned = met ? Math.min(MAX_FREEZE_TOKENS, s.tokens + 1) : s.tokens;
  if (s.status === "repairable") {
    if (sessions >= s.goal + REPAIR_EXTRA_SESSIONS) {
      return {
        state: {
          ...s,
          status: "active",
          weeks: s.weeks + 1,
          tokens: earned,
          lastClosedWeek: weekKey,
        },
        events: ["repaired"],
      };
    }
    return {
      state: { ...s, status: "active", weeks: 0, tokens: earned, lastClosedWeek: weekKey },
      events: ["reset"],
    };
  }
  if (met) {
    return {
      state: { ...s, weeks: s.weeks + 1, tokens: earned, lastClosedWeek: weekKey },
      events: ["goal_met"],
    };
  }
  if (s.tokens > 0) {
    return {
      state: { ...s, tokens: s.tokens - 1, lastClosedWeek: weekKey },
      events: ["token_applied"],
    };
  }
  return {
    state: { ...s, status: "repairable", lastClosedWeek: weekKey },
    events: ["became_repairable"],
  };
}

/**
 * Closes one week. Idempotent: a week at or before `lastClosedWeek` returns
 * the state unchanged. Weeks skipped since `lastClosedWeek` (the user didn't
 * open the app) are closed first with 0 sessions, in order. With
 * `testPassedAt` the streak is archived: the closing week counts only if its
 * goal was met (a week cut short by test day isn't held against anyone).
 * Archived streaks don't change.
 */
export function streakTransition(state: StreakState, week: WeekClose): StreakTransition {
  if (state.status === "archived") return { state, events: [], notify: false };
  const target = parseWeekKey(week.weekKey);
  if (target === null) throw new RangeError(`invalid week key: ${week.weekKey}`);
  let s: StreakState = { ...state, goal: clampGoal(state.goal) };
  const events: StreakEvent[] = [];
  if (s.lastClosedWeek !== null) {
    const last = parseWeekKey(s.lastClosedWeek);
    if (last === null) throw new RangeError(`invalid week key: ${s.lastClosedWeek}`);
    if (target <= last) return { state, events: [], notify: false };
    let k = nextWeekKey(s.lastClosedWeek);
    while (k !== null && k !== week.weekKey) {
      const r = closeOne(s, 0, k);
      s = r.state;
      events.push(...r.events);
      k = nextWeekKey(k);
    }
  }
  const sessions = Math.max(0, Math.floor(week.sessions));
  if (week.testPassedAt !== undefined) {
    const weekMet = sessions >= s.goal + (s.status === "repairable" ? REPAIR_EXTRA_SESSIONS : 0);
    const weeks = weekMet ? s.weeks + 1 : s.weeks;
    const archived: StreakState = {
      ...s,
      status: "archived",
      weeks,
      lastClosedWeek: week.weekKey,
      archivedOn: istDate(week.testPassedAt),
    };
    return { state: archived, events: [...events, "archived"], notify: false };
  }
  const r = closeOne(s, sessions, week.weekKey);
  return { state: r.state, events: [...events, ...r.events], notify: false };
}

/**
 * Archives immediately on the E-11 `test_passed` event, mid-week, without
 * closing the current week ("Prep streak: N weeks").
 */
export function archiveStreak(state: StreakState, testPassedAt: EpochMs): StreakState {
  if (state.status === "archived") return state;
  return { ...state, status: "archived", archivedOn: istDate(testPassedAt) };
}

/** Changes the weekly goal (2–6). Takes effect for the week being closed next. */
export function setStreakGoal(state: StreakState, goal: number): StreakState {
  return { ...state, goal: clampGoal(goal) };
}

export interface StreakView {
  /** ISO week (IST) containing `now`. */
  readonly weekKey: string;
  /** Road-dots: one per goal session (goal + 2 while repairing). */
  readonly dots: number;
  readonly filled: number;
  /** A missed week shows a pothole you can "fill" by repairing. */
  readonly pothole: boolean;
  readonly weeks: number;
  readonly archived: boolean;
}

/**
 * What the weekly card renders ("New week: 0/4"). Neutral data only: no
 * guilt copy, no sad states (§7 "On break").
 */
export function streakView(state: StreakState, sessionsThisWeek: number, now: EpochMs): StreakView {
  const repairing = state.status === "repairable";
  const dots = state.goal + (repairing ? REPAIR_EXTRA_SESSIONS : 0);
  return {
    weekKey: istWeek(now).key,
    dots,
    filled: Math.min(dots, Math.max(0, Math.floor(sessionsThisWeek))),
    pothole: repairing,
    weeks: state.weeks,
    archived: state.status === "archived",
  };
}
