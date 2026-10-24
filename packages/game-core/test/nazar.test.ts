// Nazar anti-spam rule, band boundaries (NAZAR §2.1–2.3, brief §15) and learn-mode prediction.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goldenVectors } from "../src/fixtures/index.ts";
import type { GameEvent } from "../src/schema/events.ts";
import {
  bandFor,
  linearFraction,
  maxTapsInWindow,
  patternVoids,
  replay,
} from "../src/scoring/index.ts";
import { decodeReplay, encodeReplay } from "../src/sdk/index.ts";

describe("anti-pattern-click rule", () => {
  it("exactly 3 taps in 1 s is allowed; a 4th voids", () => {
    assert.equal(patternVoids([0, 300, 600], 3, 1), false);
    assert.equal(patternVoids([0, 300, 600, 900], 4, 1), true);
    assert.equal(maxTapsInWindow([0, 300, 600, 900]), 4);
  });
  it("the 1 s window is half-open: 4 taps spanning exactly 1000 ms are allowed, 999 ms voids", () => {
    assert.equal(patternVoids([0, 400, 700, 1000], 4, 1), false);
    assert.equal(patternVoids([0, 400, 700, 999], 4, 1), true);
  });
  it("per-clip cap: more than 2 × hazards + 4 taps voids", () => {
    const spread = (n: number): number[] => Array.from({ length: n }, (_, i) => i * 2000);
    assert.equal(patternVoids(spread(6), 6, 1), false); // cap 6 for one hazard
    assert.equal(patternVoids(spread(7), 7, 1), true);
    assert.equal(patternVoids(spread(8), 8, 2), false); // cap 8 for two hazards
    assert.equal(patternVoids(spread(9), 9, 2), true);
    assert.equal(patternVoids(spread(4), 4, 0), false); // quiet clip cap 4
    assert.equal(patternVoids(spread(5), 5, 0), true);
    // Taps without media time still count toward the cap.
    assert.equal(patternVoids(spread(3), 7, 1), true);
  });
});

describe("5-band scoring", () => {
  it("k = min(5, ⌊5(τ − a)/(b − a)⌋ + 1) with exact integer boundaries", () => {
    assert.equal(bandFor(1000, 1000, 6000), 1); // τ = a → 5 points
    assert.equal(bandFor(1999, 1000, 6000), 1);
    assert.equal(bandFor(2000, 1000, 6000), 2); // band boundaries belong to the later band
    assert.equal(bandFor(5999, 1000, 6000), 5);
    assert.equal(bandFor(6000, 1000, 6000), 5); // τ = b → 1 point
    assert.equal(bandFor(12400 + 899, 12400, 16900), 1); // w = 900 ms
    assert.equal(bandFor(12400 + 900, 12400, 16900), 2);
  });
});

describe("field-kit linear rule", () => {
  it("full marks to onset + 2 s, linear to 0 at onset + 5 s, 0 before onset", () => {
    assert.equal(linearFraction(-1), 0);
    assert.equal(linearFraction(0), 1);
    assert.equal(linearFraction(2000), 1);
    assert.equal(linearFraction(3500), 0.5);
    assert.equal(linearFraction(5000), 0);
    assert.equal(linearFraction(5001), 0);
  });
});

describe("learn mode: occlusion and prediction (MD-224)", () => {
  const v = goldenVectors().find((x) => x.name === "nazar-learn-predict");
  if (v === undefined) throw new Error("no nazar-learn-predict vector");
  const scoreWith = (events: GameEvent[]) =>
    replay(v.manifest, v.ctx, encodeReplay(events, v.ctx.seed), v.content);
  const events = decodeReplay(v.replayPackage, v.ctx.sid);

  it("each prediction writes FSRS evidence for its hazard card", () => {
    const r = scoreWith(events);
    const predicted = events.filter((e) => e.type === "prediction").length;
    assert.equal(predicted, 3);
    assert.deepEqual(
      r.evidence.map((e) => [e.cardId, e.correct, e.rating]),
      [
        ["hazard:cattle_animal", true, 3],
        // The tap landed in band 3, but the wrong answer makes the review "Again".
        ["hazard:wrong_side_2w", false, 1],
        ["hazard:bus_stop_pedestrian", true, 3],
      ],
    );
  });

  it("a wrong answer costs the prediction half; skipping never scores more than answering", () => {
    const right = scoreWith(events);
    const wrong = scoreWith(
      events.map((e) => (e.type === "prediction" ? { ...e, p: { choice: "other" as const } } : e)),
    );
    assert.ok(wrong.score.pct < right.score.pct);
    for (const c of wrong.score.components.filter((x) => x.id.endsWith("_predict"))) {
      assert.equal(c.value, 0);
    }
    const early = goldenVectors().find((x) => x.name === "nazar-learn-early");
    assert.ok(early);
    // No answers at all: every prediction component is 0 out of 5.
    const skipped = early.expectedResult.score.components.filter((c) => c.id.endsWith("_predict"));
    assert.ok(skipped.length > 0 && skipped.every((c) => c.value === 0 && c.max === 5));
  });
});
