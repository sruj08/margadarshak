// FSRS wrapper (GAMIFICATION_ENGINE §4): pinned parameters, determinism,
// review-log replay, maximum interval, mastery with the evidence floor, and
// the review queue.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { default_w } from "ts-fsrs";
import { masteryByTopic, reviewQueue, topicMastery, topicOfCard } from "../src/mastery.ts";
import type { CardState } from "../src/scheduler.ts";
import {
  acceptReviewTime,
  createScheduler,
  FSRS_PARAMS,
  FSRS_WEIGHTS,
  pinnedScheduler,
  replayReviewLog,
} from "../src/scheduler.ts";
import { DAY_MS, HOUR_MS } from "../src/time.ts";
import type { ReviewLogEntry, ReviewRating } from "../src/types.ts";
import { ist } from "./helpers.ts";

/** Runs `fn` with Date.now, zero-argument `new Date()` and Math.random all throwing. */
function withoutClock<T>(fn: () => T): T {
  const RealDate = globalThis.Date;
  const realRandom = Math.random;
  class GuardDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error("clock read: new Date()");
      if (args.length > 1) throw new Error("unexpected multi-arg Date");
      super(args[0] as number);
    }
    static override now(): number {
      throw new Error("clock read: Date.now()");
    }
  }
  globalThis.Date = GuardDate as DateConstructor;
  Math.random = () => {
    throw new Error("randomness: Math.random()");
  };
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
    Math.random = realRandom;
  }
}

const T0 = ist(2026, 10, 1, 10, 0);

function log(cardId: string, ratings: ReviewRating[], start = T0, gapDays = 3): ReviewLogEntry[] {
  return ratings.map((rating, i) => ({
    cardId,
    rating,
    reviewedAt: start + i * gapDays * DAY_MS,
    sourceSid: `s-${cardId}-${i}`,
  }));
}

describe("pinned parameters (§4.1)", () => {
  it("request_retention 0.9, maximum_interval 60, enable_fuzz false, FSRS-6 default weights", () => {
    const p = createScheduler().params;
    assert.equal(p.request_retention, 0.9);
    assert.equal(p.maximum_interval, 60);
    assert.equal(p.enable_fuzz, false);
    assert.equal(p.w.length, 21);
    assert.deepEqual([...p.w], [...FSRS_WEIGHTS]);
    assert.equal(FSRS_PARAMS.enable_fuzz, false);
  });
  it("our pinned weights equal ts-fsrs 5.4.2 defaults (fails loudly on a library bump)", () => {
    assert.deepEqual([...FSRS_WEIGHTS], [...default_w]);
  });
  it("maximum_interval can be lowered, never raised past 60; fuzz can't be turned on", () => {
    assert.equal(createScheduler({ maximum_interval: 30 }).params.maximum_interval, 30);
    assert.equal(createScheduler({ maximum_interval: 365 }).params.maximum_interval, 60);
    assert.throws(() => createScheduler({ w: [1, 2, 3] }), RangeError);
    assert.throws(() => createScheduler({ request_retention: 1.2 }), RangeError);
  });
});

describe("determinism", () => {
  const full: ReviewLogEntry[] = [
    ...log("C-LL1-001", [3, 3, 4, 2, 3]),
    ...log("C-LL1-002", [1, 1, 3, 3]),
    ...log("C-LL2-007", [4, 4, 4]),
  ];

  it("the same log replayed twice gives identical states", () => {
    const a = replayReviewLog(full);
    const b = replayReviewLog(full);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
  it("two independent schedulers agree (no fuzz, no hidden state)", () => {
    assert.deepEqual(
      replayReviewLog(full, createScheduler()),
      replayReviewLog(full, createScheduler()),
    );
  });
  it("interleaving of different cards in the log doesn't matter; output is sorted by cardId", () => {
    const shuffled = [...full].reverse();
    assert.deepEqual(replayReviewLog(shuffled), replayReviewLog(full));
    assert.deepEqual(
      replayReviewLog(full).map((c) => c.cardId),
      ["C-LL1-001", "C-LL1-002", "C-LL2-007"],
    );
  });
  it("never reads the clock or Math.random (replay, retrievability, mastery, queue)", () => {
    withoutClock(() => {
      const s = createScheduler();
      const cards = replayReviewLog(full, s);
      topicMastery(cards, T0 + 30 * DAY_MS, { scheduler: s });
      reviewQueue(cards, T0 + 30 * DAY_MS, { scheduler: s, newCandidates: ["C-LL1-003"] });
    });
  });
  it("replay matches step-by-step scheduling", () => {
    const s = pinnedScheduler();
    let c = s.newCard("C-M1-001", T0);
    const entries = log("C-M1-001", [3, 2, 3]);
    for (const e of entries) c = s.review(c, e.rating, e.reviewedAt);
    assert.deepEqual(replayReviewLog(entries), [c]);
  });
});

describe("review log replay (§4.2)", () => {
  it("counts reviews, Good/Easy, first and last review", () => {
    const [c] = replayReviewLog(log("C-LL3-001", [1, 3, 2]));
    assert.ok(c);
    assert.equal(c.reviews, 3);
    assert.equal(c.goodOrEasy, 1);
    assert.equal(c.firstReview, T0);
    assert.equal(c.lastReview, T0 + 6 * DAY_MS);
    assert.equal(c.lapses >= 0, true);
  });
  it("one review per card per session: same sourceSid collapses to the worst rating at the earliest time", () => {
    const collapsed = replayReviewLog([
      { cardId: "C-LL1-010", rating: 4, reviewedAt: T0 + 60_000, sourceSid: "sid-1" },
      { cardId: "C-LL1-010", rating: 1, reviewedAt: T0 + 120_000, sourceSid: "sid-1" },
      { cardId: "C-LL1-010", rating: 3, reviewedAt: T0, sourceSid: "sid-1" },
    ]);
    const single = replayReviewLog([{ cardId: "C-LL1-010", rating: 1, reviewedAt: T0 }]);
    assert.deepEqual(collapsed, single);
    assert.equal(collapsed[0]?.reviews, 1);
  });
  it("ties on reviewedAt keep log order", () => {
    const a = replayReviewLog([
      { cardId: "C-LL1-020", rating: 1, reviewedAt: T0 },
      { cardId: "C-LL1-020", rating: 4, reviewedAt: T0 },
    ]);
    const b = replayReviewLog([
      { cardId: "C-LL1-020", rating: 4, reviewedAt: T0 },
      { cardId: "C-LL1-020", rating: 1, reviewedAt: T0 },
    ]);
    assert.notDeepEqual(a, b);
  });
  it("rejects ratings outside 1–4 and non-finite times", () => {
    assert.throws(
      () => replayReviewLog([{ cardId: "x", rating: 0 as ReviewRating, reviewedAt: T0 }]),
      RangeError,
    );
    assert.throws(
      () => replayReviewLog([{ cardId: "x", rating: 3, reviewedAt: Number.NaN }]),
      RangeError,
    );
  });
  it("maximum_interval 60 is respected even for a long run of Easy (ts-fsrs alone overshoots to 62)", () => {
    const s = pinnedScheduler();
    let c = s.newCard("C-M4-001", T0);
    let t = T0;
    for (let i = 0; i < 15; i++) {
      c = s.review(c, 4, t);
      assert.ok(c.scheduledDays <= 60, `scheduledDays ${c.scheduledDays}`);
      assert.ok(c.due - t <= 60 * DAY_MS);
      t = c.due;
    }
    assert.equal(c.scheduledDays, 60);
  });
  it("EC-15: device review time accepted within ±24 h and monotonic per card, else receipt time", () => {
    const rx = T0 + 10 * HOUR_MS;
    assert.equal(acceptReviewTime(T0, rx, null), T0);
    assert.equal(acceptReviewTime(rx - 25 * HOUR_MS, rx, null), rx);
    assert.equal(acceptReviewTime(rx + 25 * HOUR_MS, rx, null), rx);
    assert.equal(acceptReviewTime(T0, rx, T0 + HOUR_MS), rx);
    assert.equal(acceptReviewTime(T0, rx, T0), T0);
  });
});

describe("topicMastery (§4.4)", () => {
  const now = T0 + 20 * DAY_MS;
  it("no cards seen → 0", () => {
    const m = topicMastery([], now, { conceptCount: 10 });
    assert.deepEqual(m, {
      mastery: 0,
      coverage: 0,
      meanRetrievability: null,
      conceptCount: 10,
      seen: 0,
      covered: 0,
    });
  });
  it("evidence floor: R capped at 0.6 under 2 reviews, and such a card isn't covered", () => {
    const s = pinnedScheduler();
    const [c] = replayReviewLog([{ cardId: "C-LL1-001", rating: 4, reviewedAt: now - HOUR_MS }]);
    assert.ok(c);
    assert.ok(s.retrievability(c, now) > 0.6);
    const m = topicMastery([c], now, { conceptCount: 1 });
    assert.equal(m.meanRetrievability, 0.6);
    assert.equal(m.coverage, 0);
    assert.equal(m.mastery, 0);
  });
  it("coverage needs ≥ 2 reviews and at least one Good/Easy", () => {
    const cards = replayReviewLog([
      ...log("C-LL2-001", [3, 3], now - 4 * DAY_MS, 1), // covered
      ...log("C-LL2-002", [1, 2], now - 4 * DAY_MS, 1), // 2 reviews, no Good/Easy
      ...log("C-LL2-003", [3], now - 4 * DAY_MS, 1), // 1 review (floored)
    ]);
    const s = pinnedScheduler();
    const m = topicMastery(cards, now, { conceptCount: 4 });
    assert.equal(m.seen, 3);
    assert.equal(m.covered, 1);
    assert.equal(m.coverage, 0.25);
    const rs = cards.map((c) =>
      c.reviews < 2 ? Math.min(0.6, s.retrievability(c, now)) : s.retrievability(c, now),
    );
    const expected = 0.25 * (rs.reduce((a, b) => a + b, 0) / rs.length);
    assert.ok(Math.abs(m.mastery - expected) < 1e-9);
  });
  it("retrievability decays with time, so mastery does too", () => {
    const cards = replayReviewLog(log("C-LL4-001", [3, 3, 3], T0, 2));
    const soon = topicMastery(cards, T0 + 5 * DAY_MS).mastery;
    const later = topicMastery(cards, T0 + 90 * DAY_MS).mastery;
    assert.ok(soon > later);
  });
  it("topicOfCard and masteryByTopic group by module", () => {
    assert.equal(topicOfCard("C-LL1-042"), "LL1");
    assert.equal(topicOfCard("C-M14-003"), "M14");
    assert.equal(topicOfCard("Q-C-LL1-042:v4"), null);
    const cards = replayReviewLog([...log("C-LL1-001", [3, 3]), ...log("C-LL2-001", [3, 3])]);
    const by = masteryByTopic(cards, T0 + 7 * DAY_MS, { LL1: 2, LL2: 1, LL3: 5 });
    assert.deepEqual(Object.keys(by), ["LL1", "LL2", "LL3"]);
    assert.equal(by["LL1"]?.coverage, 0.5);
    assert.equal(by["LL2"]?.coverage, 1);
    assert.equal(by["LL3"]?.mastery, 0);
  });
});

describe("reviewQueue (§4.5)", () => {
  it("due cards first by lowest retrievability, max 20 per sitting", () => {
    const s = pinnedScheduler();
    const entries: ReviewLogEntry[] = [];
    for (let i = 0; i < 25; i++) {
      const id = `C-LL1-${String(i).padStart(3, "0")}`;
      entries.push({ cardId: id, rating: i % 2 === 0 ? 3 : 1, reviewedAt: T0 + i * HOUR_MS });
    }
    const cards = replayReviewLog(entries, s);
    const now = T0 + 40 * DAY_MS;
    const q = reviewQueue(cards, now, { newCandidates: ["C-LL1-900"] });
    assert.equal(q.due.length, 20);
    assert.equal(q.dueRemaining, 5);
    assert.deepEqual(q.fresh, []);
    for (let i = 1; i < q.due.length; i++) {
      const prev = q.due[i - 1];
      const cur = q.due[i];
      assert.ok(prev && cur && prev.retrievability <= cur.retrievability);
    }
  });
  it("new concepts capped at 8 per IST day, counting ones already introduced today", () => {
    const now = ist(2026, 10, 24, 18, 0);
    const introduced = replayReviewLog([
      { cardId: "C-LL3-001", rating: 3, reviewedAt: ist(2026, 10, 24, 0, 5) }, // today
      { cardId: "C-LL3-002", rating: 3, reviewedAt: ist(2026, 10, 24, 9, 0) }, // today
      { cardId: "C-LL3-003", rating: 3, reviewedAt: ist(2026, 10, 23, 23, 59) }, // yesterday (IST)
    ]);
    const candidates = Array.from({ length: 12 }, (_, i) => `C-LL3-${String(100 + i)}`);
    const q = reviewQueue(introduced, now, { newCandidates: candidates });
    assert.equal(q.newIntroducedToday, 2);
    assert.equal(q.fresh.length, 6);
    assert.deepEqual(q.fresh, candidates.slice(0, 6));
  });
  it("candidates already reviewed aren't offered as new; never-reviewed cards are", () => {
    const now = T0 + 1 * DAY_MS;
    const cards: CardState[] = [
      ...replayReviewLog([{ cardId: "C-LL1-001", rating: 3, reviewedAt: T0 - 5 * DAY_MS }]),
      pinnedScheduler().newCard("C-LL1-002", T0),
    ];
    const q = reviewQueue(cards, now, { newCandidates: ["C-LL1-001", "C-LL1-003"] });
    assert.deepEqual(q.fresh, ["C-LL1-003", "C-LL1-002"]);
  });
  it("due cards leave room for new ones only up to 20 in total", () => {
    const entries: ReviewLogEntry[] = Array.from({ length: 18 }, (_, i) => ({
      cardId: `C-LL2-${String(i).padStart(3, "0")}`,
      rating: 3 as const,
      reviewedAt: T0,
    }));
    const cards = replayReviewLog(entries);
    const q = reviewQueue(cards, T0 + 30 * DAY_MS, {
      newCandidates: ["C-LL2-500", "C-LL2-501", "C-LL2-502"],
    });
    assert.equal(q.due.length, 18);
    assert.equal(q.fresh.length, 2);
  });
});
