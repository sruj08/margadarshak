// Test Readiness (§5), Road Readiness (§5.4), personal calibration (§6) and
// the score-calibration helpers (§5.3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  brier,
  calibrationBins,
  isCalibrated,
  overconfidence,
  sureAndWrong,
} from "../src/calibration.ts";
import type { OutcomePair } from "../src/outcomes.ts";
import { fitPassModel, outcomeCountLine, pairOutcome } from "../src/outcomes.ts";
import { calibrationPenalty, readiness, roadReadiness } from "../src/readiness.ts";
import { DAY_MS } from "../src/time.ts";
import type { RatedAnswer } from "../src/types.ts";
import { answers, ist } from "./helpers.ts";

const EXAMPLE_MASTERIES = { LL1: 0.9, LL2: 0.85, LL3: 0.8, LL4: 0.81 };
/** 20 answers: 8 at 100% + 12 at 75% → mean confidence 0.85; 13 correct → accuracy 0.65. */
const EXAMPLE_ANSWERS: RatedAnswer[] = [...answers(8, "100", 6), ...answers(12, "75", 7)];

describe("§5.1 golden: 78 = knowledge 84 − calibration 6", () => {
  it("worked example", () => {
    assert.equal(overconfidence(EXAMPLE_ANSWERS), 0.2);
    const r = readiness(EXAMPLE_MASTERIES, EXAMPLE_ANSWERS);
    assert.equal(r.knowledge, 84);
    assert.equal(r.calPenalty, 6);
    assert.equal(r.readiness, 78);
    assert.equal(r.calibration.n, 20);
    assert.equal(r.calibration.enough, true);
    assert.equal(r.weightsSource, "equal");
    assert.deepEqual(
      r.topics.map((t) => [t.topic, t.mastery, t.weight]),
      [
        ["LL1", 0.9, 0.25],
        ["LL2", 0.85, 0.25],
        ["LL3", 0.8, 0.25],
        ["LL4", 0.81, 0.25],
      ],
    );
  });
});

describe("§5.1 calibration penalty", () => {
  it("under 15 rated answers → 0 and 'not enough answers yet'", () => {
    const few = [...answers(14, "100", 0)];
    const r = readiness(EXAMPLE_MASTERIES, few);
    assert.equal(r.calPenalty, 0);
    assert.equal(r.calibration.enough, false);
    assert.equal(r.readiness, 84);
  });
  it("answers without confidence don't count toward the 15", () => {
    const mixed: RatedAnswer[] = [
      ...answers(14, "100", 0),
      ...Array.from({ length: 10 }, () => ({ correct: false })),
    ];
    assert.equal(calibrationPenalty(mixed).n, 14);
    assert.equal(calibrationPenalty(mixed).penalty, 0);
  });
  it("exactly 15 → penalty applies; capped at 10", () => {
    const p = calibrationPenalty(answers(15, "100", 0)); // OC = 1.0 → 38 → cap 10
    assert.equal(p.penalty, 10);
  });
  it("OC ≤ 0.05 → 0 (tolerance); underconfidence → 0", () => {
    assert.equal(calibrationPenalty(answers(20, "75", 14)).penalty, 0); // OC 0.05
    assert.equal(calibrationPenalty(answers(20, "50", 20)).penalty, 0); // OC −0.5
  });
  it("uses only the last 40 rated answers", () => {
    const old = answers(40, "100", 0);
    const recent = answers(40, "75", 30); // OC 0
    assert.equal(calibrationPenalty([...old, ...recent]).penalty, 0);
    assert.equal(calibrationPenalty([...recent, ...old]).penalty, 10);
  });
  it("readiness never below 0", () => {
    const r = readiness({ LL1: 0.02, LL2: 0.02, LL3: 0.02, LL4: 0.02 }, answers(20, "100", 0));
    assert.equal(r.knowledge, 2);
    assert.equal(r.readiness, 0);
  });
});

describe("§5.1 weights", () => {
  it("custom weights need a source and must sum to 1", () => {
    const w = { LL1: 0.4, LL2: 0.3, LL3: 0.2, LL4: 0.1, source: "RP-XX-LLT-1" };
    const r = readiness(EXAMPLE_MASTERIES, [], w);
    assert.equal(r.knowledge, Math.round(100 * (0.36 + 0.255 + 0.16 + 0.081)));
    assert.equal(r.weightsSource, "RP-XX-LLT-1");
    assert.throws(() => readiness(EXAMPLE_MASTERIES, [], { ...w, LL4: 0.2 }), RangeError);
    assert.throws(() => readiness(EXAMPLE_MASTERIES, [], { ...w, source: " " }), RangeError);
    assert.throws(
      () => readiness(EXAMPLE_MASTERIES, [], { ...w, LL1: -0.1, LL2: 0.8 }),
      RangeError,
    );
  });
  it("missing topic masteries count as 0", () => {
    assert.equal(readiness({ LL1: 1 }, []).knowledge, 25);
  });
});

describe("§5.2 the 85 gate is advisory", () => {
  const strong = { LL1: 0.95, LL2: 0.9, LL3: 0.88, LL4: 0.9 };
  it("met with readiness ≥ 85, every topic ≥ 0.7 and the last 2 mocks ≥ pass + 10", () => {
    const r = readiness(strong, [], undefined, { llMockPcts: [40, 72, 70], passMarkPct: 60 });
    assert.equal(r.readiness, 91);
    assert.equal(r.gate.met, true);
    assert.deepEqual(r.gate.reasons, []);
  });
  it("mock below pass + 10 (69 < 70) blocks the lock but not booking", () => {
    const r = readiness(strong, [], undefined, { llMockPcts: [90, 69], passMarkPct: 60 });
    assert.equal(r.gate.met, false);
    assert.deepEqual(r.gate.reasons, ["mock_below_pass_mark_plus_10"]);
    assert.equal(r.gate.bookAnywayVisible, true);
  });
  it("one mock isn't enough; no mock data is reported", () => {
    assert.deepEqual(
      readiness(strong, [], undefined, { llMockPcts: [95], passMarkPct: 60 }).gate.reasons,
      ["fewer_than_2_mocks"],
    );
    assert.deepEqual(readiness(strong, []).gate.reasons, ["no_mock_data"]);
  });
  it("a topic under 0.7 is named even when the total clears 85", () => {
    const r = readiness({ LL1: 1, LL2: 1, LL3: 1, LL4: 0.69 }, [], undefined, {
      llMockPcts: [80, 80],
      passMarkPct: 60,
    });
    assert.equal(r.readiness, 92);
    assert.deepEqual(r.gate.reasons, ["topic_below_0_7"]);
    assert.deepEqual(r.gate.weakTopics, ["LL4"]);
  });
  it("'Book anyway' is visible at Readiness 0, 60 and 84 (DP-06)", () => {
    for (const m of [0, 0.6, 0.84]) {
      const r = readiness({ LL1: m, LL2: m, LL3: m, LL4: m }, []);
      assert.equal(r.gate.bookAnywayVisible, true);
      assert.equal(r.gate.met, false);
      assert.ok(r.gate.reasons.includes("readiness_below_85"));
    }
  });
  it("exactly 85 passes the score condition", () => {
    const r = readiness({ LL1: 0.85, LL2: 0.85, LL3: 0.85, LL4: 0.85 }, [], undefined, {
      llMockPcts: [70, 70],
      passMarkPct: 60,
    });
    assert.equal(r.readiness, 85);
    assert.equal(r.gate.met, true);
  });
});

describe("§5.4 Road Readiness (separate, never a gate)", () => {
  const ms = { M1: 0.8, M3: 0.8, M4: 0.8, M6: 0.8, M8: 0.8, M19: 0.8, M14: 0.2, LL1: 1 };
  it("0.5 × 100 × mean(M1, M3, M4, M6, M8, M19) + 0.5 × NazarScore", () => {
    const r = roadReadiness(ms, 70, { stateCode: "DL" });
    assert.equal(r.knowledgePart, 40);
    assert.equal(r.nazarPart, 35);
    assert.equal(r.score, 75);
    assert.deepEqual(r.modules, ["M1", "M3", "M4", "M6", "M8", "M19"]);
  });
  it("J&K tenant adds M14", () => {
    const r = roadReadiness(ms, 70, { stateCode: "JK" });
    assert.ok(r.modules.includes("M14"));
    assert.equal(r.score, Math.round(50 * ((0.8 * 6 + 0.2) / 7) + 35));
  });
  it("LL masteries never leak in; null without a Nazar Score", () => {
    assert.equal(roadReadiness({ LL1: 1, LL2: 1 }, 0, { stateCode: "DL" }).score, 0);
    const r = roadReadiness(ms, null, { stateCode: "DL" });
    assert.equal(r.score, null);
    assert.equal(r.knowledgePart, 40);
  });
});

describe("§6 personal calibration", () => {
  it("reference: always 50% → Brier 0.25 whatever the accuracy", () => {
    assert.equal(brier(answers(40, "50", 13)), 0.25);
    assert.equal(brier(answers(40, "50", 40)), 0.25);
  });
  it("reference: always 100% at 61% accuracy → 0.39", () => {
    assert.equal(brier(answers(100, "100", 61), 100), 0.39);
  });
  it("Brier uses the last 40 rated answers; null with none", () => {
    assert.equal(brier([]), null);
    assert.equal(brier([...answers(60, "100", 0), ...answers(40, "100", 40)]), 0);
  });
  it("three bins with n and accuracy", () => {
    const bins = calibrationBins([...answers(4, "50", 2), ...answers(8, "100", 6)]);
    assert.deepEqual(bins, [
      { stated: "50", p: 0.5, n: 4, accuracy: 0.5 },
      { stated: "75", p: 0.75, n: 0, accuracy: null },
      { stated: "100", p: 1, n: 8, accuracy: 0.75 },
    ]);
  });
  it("sure and wrong count (private nudge)", () => {
    assert.equal(sureAndWrong([...answers(6, "100", 2), ...answers(5, "75", 0)]), 4);
  });
  it("Calibrated: B ≤ 0.18 over ≥ 40 items and |stated − actual| ≤ 0.10 in the 100% bin", () => {
    // 20 × 100% (19 right) + 20 × 75% (15 right): B = 0.11875, 100% gap 0.05.
    const good = [...answers(20, "100", 19), ...answers(20, "75", 15)];
    assert.equal(brier(good), 0.11875);
    assert.equal(isCalibrated(good), true);
    assert.equal(isCalibrated(good.slice(1)), false); // 39 items
    // 100% bin at 85% accuracy: gap 0.15.
    const overSure = [...answers(20, "100", 17), ...answers(20, "75", 15)];
    assert.equal(isCalibrated(overSure), false);
    // No 100% answers at all → the bin criterion can't be checked.
    assert.equal(isCalibrated(answers(40, "50", 20)), false);
  });
});

describe("§5.3 calibrating the score on real outcomes", () => {
  const testAt = ist(2026, 11, 20, 10);
  it("pairs a result with the latest Readiness shown in the 7 days before the test", () => {
    const shown = [
      { at: testAt - 10 * DAY_MS, readiness: 50 },
      { at: testAt - 6 * DAY_MS, readiness: 80 },
      { at: testAt - 1 * DAY_MS, readiness: 86 },
      { at: testAt + 1, readiness: 99 },
    ];
    assert.deepEqual(pairOutcome(shown, testAt, true), { readiness: 86, passed: true });
    assert.equal(pairOutcome(shown.slice(0, 1), testAt, true), null);
  });
  it("count line only from N ≥ 30, never a percentage", () => {
    const pairs: OutcomePair[] = Array.from({ length: 29 }, (_, i) => ({
      readiness: 90,
      passed: i % 3 !== 0,
    }));
    assert.equal(outcomeCountLine(pairs), null);
    const more = [...pairs, { readiness: 88, passed: true }, { readiness: 60, passed: false }];
    assert.deepEqual(outcomeCountLine(more), { n: 30, k: 20 });
  });
  it("no fit below 100 paired outcomes per tenant", () => {
    assert.equal(
      fitPassModel(Array.from({ length: 99 }, () => ({ readiness: 80, passed: true }))),
      null,
    );
  });
  it("a fit on informative data beats the base rate; deterministic", () => {
    const pairs: OutcomePair[] = Array.from({ length: 200 }, (_, i) => {
      const readiness = i % 100;
      // Pass more often at higher readiness, deterministically.
      return { readiness, passed: (i * 37) % 100 < readiness };
    });
    const m = fitPassModel(pairs);
    assert.ok(m);
    assert.ok(m.b > 0);
    assert.ok(m.brier < m.baseRateBrier);
    assert.equal(m.reviewGate, false);
    assert.deepEqual(fitPassModel(pairs), m);
  });
  it("uninformative data → review the gate (fit no better than base rate within noise)", () => {
    const pairs: OutcomePair[] = Array.from({ length: 120 }, (_, i) => ({
      readiness: 85,
      passed: i % 2 === 0,
    }));
    const m = fitPassModel(pairs);
    assert.ok(m);
    assert.ok(Math.abs(m.brier - m.baseRateBrier) < 1e-9);
  });
  it("perfectly separated data still converges to finite numbers", () => {
    const pairs: OutcomePair[] = Array.from({ length: 100 }, (_, i) => ({
      readiness: i,
      passed: i >= 50,
    }));
    const m = fitPassModel(pairs);
    assert.ok(m && Number.isFinite(m.a) && Number.isFinite(m.b));
  });
});
