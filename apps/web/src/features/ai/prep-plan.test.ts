import { describe, expect, it } from "vitest";
import { buildPrepPlan, topicOfCard } from "./prep-plan";

const NOW = Date.UTC(2026, 9, 25, 12);
const DAY = 86_400_000;
const answers = (topic: "LL1" | "LL2" | "LL3" | "LL4", right: number, wrong: number, at = NOW) => [
  ...Array.from({ length: right }, () => ({ topic, correct: true, at })),
  ...Array.from({ length: wrong }, () => ({ topic, correct: false, at })),
];

describe("buildPrepPlan", () => {
  it("starts a new learner on every topic, then a mock and Nazar, at most four steps", () => {
    const p = buildPrepPlan({ answers: [], mocks: [], nazarAt: [], now: NOW });
    expect(p.activeDays).toBe(0);
    expect(p.recs.map((r) => r.kind)).toEqual(["start", "start", "start", "start"]);
  });

  it("puts the weakest topic first and adapts after more practice", () => {
    const base = [
      ...answers("LL1", 9, 1),
      ...answers("LL2", 2, 8),
      ...answers("LL3", 5, 5),
      ...answers("LL4", 10, 0),
    ];
    const p = buildPrepPlan({ answers: base, mocks: [], nazarAt: [NOW], now: NOW });
    expect(p.recs[0]).toMatchObject({ kind: "review", topic: "LL2", pct: 20 });
    expect(p.recs[1]).toMatchObject({ kind: "review", topic: "LL3", pct: 50 });
    expect(p.recs.at(-1)?.kind).toBe("mock");

    // Twenty newer right answers in LL2 push the old mistakes out of the window.
    const later = buildPrepPlan({
      answers: [...base, ...answers("LL2", 20, 0, NOW + 1)],
      mocks: [],
      nazarAt: [NOW],
      now: NOW + 2,
    });
    expect(later.recs.some((r) => r.kind === "review" && r.topic === "LL2")).toBe(false);
  });

  it("asks for another mock after a failed one and says strong when all is well", () => {
    const strong = [
      ...answers("LL1", 10, 0),
      ...answers("LL2", 10, 0),
      ...answers("LL3", 10, 0),
      ...answers("LL4", 10, 0),
    ];
    const failed = buildPrepPlan({
      answers: strong,
      mocks: [{ at: NOW - DAY, passed: false }],
      nazarAt: [NOW],
      now: NOW,
    });
    expect(failed.recs.map((r) => r.kind)).toEqual(["mockAgain"]);
    const good = buildPrepPlan({
      answers: strong,
      mocks: [{ at: NOW - DAY, passed: true }],
      nazarAt: [NOW - 2 * DAY],
      now: NOW,
    });
    expect(good.recs.map((r) => r.kind)).toEqual(["strong"]);
    expect(good.activeDays).toBe(3);
  });

  it("reads the topic from a card id", () => {
    expect(topicOfCard("C-LL3-014")).toBe("LL3");
    expect(topicOfCard("DR-NAZ")).toBeNull();
  });
});
