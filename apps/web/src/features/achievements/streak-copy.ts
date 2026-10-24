import type { Achievement } from "@/features/learn/api-types";

/**
 * Which streak lines to show (GAMIFICATION_ENGINE §7, UI_SPEC_LEARN_GAMES §7.3, DP-10). A missed
 * week is silent: no "you lost", no sad state, no countdown. After a reset the screen just says
 * "New week, new streak: 0/4"; a repairable week offers the pothole repair as an option, never as a
 * warning. Pure, so a unit test can check that no guilt copy is ever chosen.
 */

export type StreakLine =
  | { key: "week"; d: number; n: number }
  | { key: "new"; n: number }
  | { key: "fill"; w: number; g: number; n: number }
  | { key: "freeze"; k: number }
  | { key: "weeks"; w: number }
  | { key: "archived"; w: number }
  | { key: "end" };

export function streakLines(s: Achievement["streak"]): StreakLine[] {
  if (s.archived || s.status === "archived") return [{ key: "archived", w: s.weeks }];
  const lines: StreakLine[] = [];
  if (s.status === "repairable") {
    lines.push({ key: "week", d: s.this_week, n: s.weekly_goal + 2 });
    lines.push({ key: "fill", w: s.weeks + 1, g: s.weekly_goal + 2, n: s.weekly_goal });
  } else if (s.weeks === 0 && s.this_week === 0) {
    lines.push({ key: "new", n: s.weekly_goal });
  } else {
    lines.push({ key: "week", d: s.this_week, n: s.weekly_goal });
  }
  if (s.weeks > 0) lines.push({ key: "weeks", w: s.weeks });
  lines.push({ key: "freeze", k: s.freeze_tokens });
  lines.push({ key: "end" });
  return lines;
}
