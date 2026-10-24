// Shared difficulty staircase (GAME_SDK §7). Per (user, gameId, skill): 2 consecutive item passes →
// level + 1; 1 fail → level − 1; floored at 1, capped at 5. This 2-down/1-up rule converges near
// 70.7% success (Levitt 1971). Mock mode never adapts: callers skip the update there.

export const STAIRCASE_MIN = 1;
export const STAIRCASE_MAX = 5;

export interface StaircaseState {
  level: number;
  streakPass: number;
}

export const initialStaircase = (level = 1): StaircaseState => ({
  level: Math.min(STAIRCASE_MAX, Math.max(STAIRCASE_MIN, Math.round(level))),
  streakPass: 0,
});

export function staircase(state: StaircaseState, itemPassed: boolean): StaircaseState {
  if (!itemPassed) {
    return { level: Math.max(STAIRCASE_MIN, state.level - 1), streakPass: 0 };
  }
  const streak = state.streakPass + 1;
  if (streak >= 2) return { level: Math.min(STAIRCASE_MAX, state.level + 1), streakPass: 0 };
  return { level: state.level, streakPass: streak };
}

/** Applies a sequence of item outcomes in order. */
export function runStaircase(state: StaircaseState, passes: readonly boolean[]): StaircaseState {
  return passes.reduce(staircase, state);
}
