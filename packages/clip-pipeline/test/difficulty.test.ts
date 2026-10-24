import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  empiricalDifficulty,
  pointsToLevel,
  rubricFactsFromClip,
  type TakerAttempt,
  validateCuratorDifficulty,
} from "../src/difficulty.ts";
import { clipWith, specClip } from "./helpers.ts";

const facts = (over: Partial<ReturnType<typeof rubricFactsFromClip>> = {}) => ({
  hazardCount: 1,
  anyOcclusion: false,
  poorLight: false,
  hazardsClose: null,
  ...over,
});

describe("curator rubric (§7.1)", () => {
  it("derives facts from clip.json", () => {
    const h = specClip().hazards[0];
    assert.ok(h);
    assert.deepEqual(rubricFactsFromClip(specClip()), {
      hazardCount: 1,
      anyOcclusion: true,
      poorLight: false,
      hazardsClose: null,
    });
    const close = clipWith({
      timeOfDay: "dusk",
      hazards: [h, { ...h, hazardId: "h2", window: { aMs: 18000, bMs: 21000 } }],
    });
    assert.deepEqual(rubricFactsFromClip(close, { subtleCues: true }), {
      hazardCount: 2,
      anyOcclusion: true,
      poorLight: true,
      hazardsClose: true,
      subtleCues: true,
    });
    const far = clipWith({
      hazards: [h, { ...h, hazardId: "h2", window: { aMs: 25000, bMs: 28000 } }],
    });
    assert.equal(rubricFactsFromClip(far).hazardsClose, false);
  });

  it("accepts consistent levels", () => {
    assert.ok(validateCuratorDifficulty(1, facts()).valid);
    assert.ok(validateCuratorDifficulty(3, facts({ anyOcclusion: true })).valid);
    assert.ok(validateCuratorDifficulty(3, facts({ hazardCount: 2, hazardsClose: false })).valid);
    assert.ok(validateCuratorDifficulty(4, facts({ hazardCount: 2, hazardsClose: true })).valid);
    assert.ok(
      validateCuratorDifficulty(5, facts({ poorLight: true, subtleCues: true, busyScene: true }))
        .valid,
    );
  });

  it("rejects contradictions", () => {
    assert.match(validateCuratorDifficulty(0, facts()).errors.join(), /integer 1–5/);
    assert.match(validateCuratorDifficulty(2.5, facts()).errors.join(), /integer 1–5/);
    assert.match(
      validateCuratorDifficulty(2, facts({ hazardCount: 2, hazardsClose: false })).errors.join(),
      /single-hazard/,
    );
    assert.match(
      validateCuratorDifficulty(3, facts({ hazardCount: 2, hazardsClose: true })).errors.join(),
      /close together/,
    );
    assert.match(
      validateCuratorDifficulty(1, facts({ anyOcclusion: true })).errors.join(),
      /unoccluded/,
    );
    assert.match(
      validateCuratorDifficulty(1, facts({ poorLight: true })).errors.join(),
      /daylight/,
    );
    assert.match(validateCuratorDifficulty(5, facts()).errors.join(), /poor light/);
    assert.match(
      validateCuratorDifficulty(4, facts({ subtleCues: false })).errors.join(),
      /subtle cues/,
    );
    assert.match(
      validateCuratorDifficulty(3, facts({ distractors: false })).errors.join(),
      /distractor/,
    );
  });

  it("warns where only the curator can confirm, and skips quiet clips", () => {
    const w4 = validateCuratorDifficulty(4, facts());
    assert.ok(w4.valid);
    assert.match(w4.warnings.join(), /confirm: .*subtle cues/);
    const quiet = validateCuratorDifficulty(2, facts({ hazardCount: 0 }));
    assert.ok(quiet.valid);
    assert.match(quiet.warnings.join(), /quiet clip/);
  });
});

describe("empirical difficulty (§7.2)", () => {
  const attempt = (
    i: number,
    points: number[],
    over: Partial<TakerAttempt> = {},
  ): TakerAttempt => ({
    takerId: `u-${i}`,
    attemptedAt: `2026-11-01T10:${String(i % 60).padStart(2, "0")}:00Z`,
    verified: true,
    trust: 0.9,
    unseen: true,
    hazardPoints: points,
    ...over,
  });

  it("is null until 30 eligible takers, then the mean points per hazard", () => {
    const few = Array.from({ length: 29 }, (_, i) => attempt(i, [3]));
    const r29 = empiricalDifficulty(few);
    assert.equal(r29.empirical, null);
    assert.equal(r29.meanPoints, 3);
    assert.equal(r29.nTakers, 29);
    const r30 = empiricalDifficulty([...few, attempt(29, [3])]);
    assert.equal(r30.empirical, 3);
    assert.equal(r30.nTakers, 30);
  });

  it("filters unverified, low-trust and seen attempts and counts each taker once", () => {
    const rows = [
      attempt(1, [5, 3]),
      attempt(2, [0], { verified: false }),
      attempt(3, [0], { trust: 0.59 }),
      attempt(4, [0], { unseen: false }),
      attempt(1, [0], { attemptedAt: "2026-11-02T00:00:00Z" }),
    ];
    const r = empiricalDifficulty(rows, { minTakers: 1 });
    assert.equal(r.nTakers, 1);
    assert.equal(r.empirical, 4);
  });

  it("flags a ≥ 2-level disagreement with the curator on the inverted scale", () => {
    assert.equal(pointsToLevel(5), 1);
    assert.equal(pointsToLevel(0), 5);
    const easy = Array.from({ length: 30 }, (_, i) => attempt(i, [5]));
    assert.equal(empiricalDifficulty(easy, { curator: 4 }).flagged, true);
    assert.equal(empiricalDifficulty(easy, { curator: 2 }).flagged, false);
    assert.throws(() => empiricalDifficulty([attempt(1, [6])]), /0–5/);
  });
});
