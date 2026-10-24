// Evidence → FSRS rating (GAMIFICATION_ENGINE §4.3), calibration (§6) and the staircase (GAME_SDK §7).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  brier,
  calibrationBins,
  collapseEvidence,
  initialStaircase,
  overconfidence,
  RATING,
  ratingFromEvidence,
  runStaircase,
  staircase,
} from "../src/learning/index.ts";

describe("ratingFromEvidence", () => {
  it("follows the table", () => {
    assert.deepEqual(ratingFromEvidence({ correct: false }), {
      rating: RATING.Again,
      overconfident: false,
    });
    assert.deepEqual(ratingFromEvidence({ correct: true, critical: true }), {
      rating: RATING.Again,
      overconfident: false,
    });
    assert.deepEqual(ratingFromEvidence({ correct: false, confidence: "100" }), {
      rating: RATING.Again,
      overconfident: true,
    });
    assert.deepEqual(ratingFromEvidence({ correct: false, confidence: "75" }), {
      rating: RATING.Again,
      overconfident: false,
    });
    assert.equal(ratingFromEvidence({ correct: true, nazarBand: 4 }).rating, RATING.Hard);
    assert.equal(ratingFromEvidence({ correct: true, nazarBand: 5 }).rating, RATING.Hard);
    assert.equal(ratingFromEvidence({ correct: true, confidence: "50" }).rating, RATING.Hard);
    assert.equal(
      ratingFromEvidence({ correct: true, latencyMs: 24001, timerMs: 30000 }).rating,
      RATING.Hard,
    );
    assert.equal(
      ratingFromEvidence({ correct: true, latencyMs: 24000, timerMs: 30000 }).rating,
      RATING.Good,
    );
    assert.equal(ratingFromEvidence({ correct: true }).rating, RATING.Good);
    assert.equal(ratingFromEvidence({ correct: true, nazarBand: 2 }).rating, RATING.Good);
    assert.equal(ratingFromEvidence({ correct: true, confidence: "75" }).rating, RATING.Good);
    assert.equal(ratingFromEvidence({ correct: true, nazarBand: 1 }).rating, RATING.Easy);
    assert.equal(ratingFromEvidence({ correct: true, confidence: "100" }).rating, RATING.Easy);
  });
  it("Hard wins over Easy (sure but slow)", () => {
    assert.equal(
      ratingFromEvidence({ correct: true, confidence: "100", latencyMs: 29000, timerMs: 30000 })
        .rating,
      RATING.Hard,
    );
  });
  it("collapses to the worst rating per card, keeping overconfidence", () => {
    const out = collapseEvidence([
      { cardId: "a", rating: 4, overconfident: false },
      { cardId: "b", rating: 3, overconfident: false },
      { cardId: "a", rating: 1, overconfident: true },
      { cardId: "a", rating: 2, overconfident: false },
    ]);
    assert.deepEqual(out, [
      { cardId: "a", rating: 1, overconfident: true },
      { cardId: "b", rating: 3, overconfident: false },
    ]);
  });
});

describe("calibration", () => {
  it("reference points: always 50% → 0.25; always 100% at 61% accuracy → 0.39", () => {
    const half = Array.from({ length: 10 }, (_, i) => ({
      confidence: "50" as const,
      correct: i % 2 === 0,
    }));
    assert.equal(brier(half), 0.25);
    const sure = Array.from({ length: 100 }, (_, i) => ({
      confidence: "100" as const,
      correct: i < 61,
    }));
    assert.ok(Math.abs((brier(sure) ?? 0) - 0.39) < 1e-12);
    assert.ok(Math.abs((overconfidence(sure) ?? 0) - 0.39) < 1e-12);
    assert.equal(brier([]), null);
    assert.equal(overconfidence([]), null);
  });
  it("bins", () => {
    const bins = calibrationBins([
      { confidence: "100", correct: true },
      { confidence: "100", correct: false },
      { confidence: "75", correct: true },
    ]);
    assert.deepEqual(bins, [
      { confidence: "50", n: 0, accuracy: null },
      { confidence: "75", n: 1, accuracy: 1 },
      { confidence: "100", n: 2, accuracy: 0.5 },
    ]);
  });
});

describe("staircase", () => {
  it("2 passes up, 1 fail down, clamped to 1..5", () => {
    let s = initialStaircase(3);
    s = staircase(s, true);
    assert.deepEqual(s, { level: 3, streakPass: 1 });
    s = staircase(s, true);
    assert.deepEqual(s, { level: 4, streakPass: 0 });
    s = staircase(s, false);
    assert.deepEqual(s, { level: 3, streakPass: 0 });
    assert.deepEqual(runStaircase(initialStaircase(5), [true, true, true, true]), {
      level: 5,
      streakPass: 0,
    });
    assert.deepEqual(runStaircase(initialStaircase(1), [false, false]), {
      level: 1,
      streakPass: 0,
    });
    assert.deepEqual(runStaircase(initialStaircase(1), [true, false, true, true]), {
      level: 2,
      streakPass: 0,
    });
  });
});
