// Edge cases owned by game-core (EDGE_CASES EC-18 and EC-28; GAME_DESIGN §12). The UI halves of
// these cases (preload screen, alt lesson, copy switch) are tested in apps/web; here we pin the
// scoring facts those screens read.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type GoldenVector, goldenVectors } from "../src/fixtures/index.ts";
import { eligibility } from "../src/integrity/index.ts";
import { FormatStatus, type NazarContent } from "../src/schema/content.ts";
import { replay } from "../src/scoring/index.ts";

const vector = (name: string): GoldenVector => {
  const v = goldenVectors().find((x) => x.name === name);
  if (v === undefined) throw new Error(`no vector ${name}`);
  return v;
};

const replayVector = (v: GoldenVector, content = v.content) =>
  replay(v.manifest, v.ctx, v.replayPackage, content);

describe("EC-18 game edge cases", () => {
  it("EC-18: a spam-tapped clip scores 0 and the pattern finding explains why", () => {
    const v = vector("nazar-voided");
    const r = replayVector(v);
    const pattern = r.findings.find((f) => f.findingId === "NAZ_PATTERN_CLICK");
    assert.ok(pattern, "NAZ_PATTERN_CLICK fires");
    assert.ok((pattern.facts["taps_in_1s"] as number) > 3);
    const clip = r.score.components.find((c) => c.id === `clip_${clipOrdinal(v, pattern.itemRef)}`);
    assert.equal(clip?.value, 0);
  });

  it("EC-18: a clip hidden mid-play is voided and flagged, never scored", () => {
    const r = replayVector(vector("nazar-voided"));
    assert.ok(r.integrity.flags.includes("INT_TAB_HIDDEN"));
  });

  it("EC-18: fallback timing (no requestVideoFrameCallback) never counts for the Nazar Score", () => {
    const r = replayVector(vector("nazar-fallback-drift"));
    assert.ok(r.integrity.flags.includes("INT_TIMING_FALLBACK"));
    const e = eligibility(r, "nazar_score");
    assert.equal(e.eligible, false);
    assert.ok(e.reasons.includes("timing_not_rvfc"));
    // It still counts as practice evidence.
    assert.equal(eligibility(r, "fsrs").eligible, true);
  });
});

describe("EC-28 Kerala HPT stayed or postponed", () => {
  const weak = vector("nazar-weak");
  const base = replayVector(weak);
  const content = weak.content as NazarContent;

  for (const status of FormatStatus.options) {
    it(`EC-28: status "${status}" reaches the debrief facts and never changes the score`, () => {
      const r = replayVector(weak, { ...content, format: { ...content.format, status } });
      const below = r.findings.find((f) => f.findingId === "NAZ_BELOW_KERALA_MARK");
      assert.equal(below?.facts["kerala_status"], status);
      assert.deepEqual(r.score, base.score);
      assert.deepEqual(
        r.findings.map((f) => f.findingId),
        base.findings.map((f) => f.findingId),
      );
    });
  }
});

/** 1-based ordinal of the clip a finding points at, from the session's item refs. */
function clipOrdinal(v: GoldenVector, ref: string | undefined): number {
  const i = v.ctx.items.findIndex((x) => x.ref === ref);
  if (i < 0) throw new Error(`no item ${ref}`);
  return i + 1;
}
