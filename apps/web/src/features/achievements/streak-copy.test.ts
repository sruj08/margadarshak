import { initialStreak, streakTransition, streakView } from "@margdarshak/gamification";
import { describe, expect, it } from "vitest";
import type { Achievement } from "@/features/learn/api-types";
import enMe from "../../../messages/en/me.json";
import hiMe from "../../../messages/hi/me.json";
import { type StreakLine, streakLines } from "./streak-copy";

/** Words that must never appear in streak copy (guilt, loss, fear). */
const STREAK_BANNED_WORDS = [
  "lost",
  "lose",
  "broke",
  "broken",
  "missed",
  "fail",
  "sorry",
  "sad",
  "shame",
  "don't let",
  "hurry",
  "last chance",
  "only",
];

function render(line: StreakLine, copy: Record<string, string>): string {
  let s = copy[line.key] ?? "";
  for (const [k, v] of Object.entries(line)) if (k !== "key") s = s.replace(`{${k}}`, String(v));
  return s;
}

function asApi(state: ReturnType<typeof initialStreak>, thisWeek: number): Achievement["streak"] {
  const v = streakView(state, thisWeek, Date.UTC(2026, 9, 20));
  return {
    status: state.status,
    weekly_goal: state.goal,
    this_week: v.filled,
    weeks: state.weeks,
    freeze_tokens: state.tokens,
    archived: v.archived,
  };
}

describe("weekly streak copy is neutral on a break (GAMIFICATION_ENGINE §7, DP-10)", () => {
  // A learner with a 2-week run (2 tokens banked), then missed weeks: both tokens are used
  // silently, the next missed week becomes repairable, then the streak resets.
  let s = initialStreak(4);
  s = streakTransition(s, { weekKey: "2026-W40", sessions: 4 }).state;
  s = streakTransition(s, { weekKey: "2026-W41", sessions: 5 }).state;
  const afterToken = streakTransition(s, { weekKey: "2026-W42", sessions: 0 });
  const secondToken = streakTransition(afterToken.state, { weekKey: "2026-W43", sessions: 0 });
  const repairable = streakTransition(secondToken.state, { weekKey: "2026-W44", sessions: 1 });
  const reset = streakTransition(repairable.state, { weekKey: "2026-W45", sessions: 2 });

  const cases: [string, Achievement["streak"]][] = [
    ["token applied silently", asApi(afterToken.state, 0)],
    ["repairable week", asApi(repairable.state, 1)],
    ["after a reset", asApi(reset.state, 0)],
  ];

  it("the package never asks to notify on a break", () => {
    expect(afterToken.notify).toBe(false);
    expect(repairable.notify).toBe(false);
    expect(reset.notify).toBe(false);
    expect(repairable.state.status).toBe("repairable");
  });

  for (const [name, streak] of cases) {
    it(`${name}: no guilt, loss or fear words in en or hi`, () => {
      const lines = streakLines(streak);
      const en = lines.map((l) => render(l, enMe.streak));
      for (const text of en) {
        for (const word of STREAK_BANNED_WORDS) expect(text.toLowerCase()).not.toContain(word);
        expect(text).not.toMatch(/[😢😞☹]/u);
      }
      const hi = lines.map((l) => render(l, hiMe.streak));
      for (const text of hi) expect(text).not.toMatch(/खो दिया|टूट गई|अफ़सोस|शर्म/);
    });
  }

  it('after a reset the screen just says "New week, new streak: 0/4."', () => {
    const lines = streakLines(asApi(reset.state, 0));
    expect(render(lines[0] as StreakLine, enMe.streak)).toBe("New week, new streak: 0/4.");
  });

  it("a repairable week offers the pothole repair as an option (goal + 2)", () => {
    const lines = streakLines(asApi(repairable.state, 1));
    const fill = lines.find((l) => l.key === "fill");
    expect(fill).toBeDefined();
    expect(render(fill as StreakLine, enMe.streak)).toMatch(
      /^Fill the week \d+ pothole: do 6 sessions/,
    );
  });
});
