import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mediaObjectKey,
  ScoringClipSchema,
  toClientManifestEntry,
  toScoringClip,
} from "../src/projection.ts";
import type { Clip } from "../src/schema.ts";
import { allKeys, clipWith, specClip } from "./helpers.ts";

/** Keys that would reveal where or what the hazards are, or server-only data. */
const FORBIDDEN_KEY =
  /window|aMs|bMs|hazard|quiet|cue|onset|delta|rater|adjudicat|occlusion|blurAudit|auditor|empirical|irt|nTakers|speed|capturedMonth/i;

function allNumbers(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (Array.isArray(v)) return v.flatMap(allNumbers);
  if (v !== null && typeof v === "object") return Object.values(v).flatMap(allNumbers);
  return [];
}

function assertNoLeak(clip: Clip, entry: unknown): void {
  for (const k of allKeys(entry)) assert.doesNotMatch(k, FORBIDDEN_KEY, `leaked key ${k}`);
  const numbers = new Set(allNumbers(entry));
  const json = JSON.stringify(entry);
  for (const h of clip.hazards) {
    for (const v of [h.window.aMs, h.window.bMs])
      assert.ok(!numbers.has(v), `window value ${v} leaked`);
    assert.ok(!json.includes(h.cueText.en), "cue text leaked");
  }
  for (const q of clip.quietSegments) assert.ok(!numbers.has(q.toMs), "quiet segment leaked");
}

describe("toScoringClip", () => {
  it("returns exactly the scorer's subset with clip.json field names", () => {
    const s = toScoringClip(specClip());
    assert.deepEqual(s, {
      clipId: "JMU-0012",
      version: 3,
      speedKmhEst: 40,
      durationMs: 38000,
      hazards: [
        { hazardId: "h1", hazardType: "bus_stop_pedestrian", window: { aMs: 12400, bMs: 16900 } },
      ],
      quietSegments: [{ fromMs: 0, toMs: 9000 }],
    });
    assert.ok(ScoringClipSchema.safeParse(s).success);
  });

  it("refuses a clip without a speed estimate (game-core needs it for metres)", () => {
    const c = clipWith({ speedKmhEst: null, speedSource: "not_logged" });
    assert.throws(() => toScoringClip(c), /no speed estimate/);
  });

  it("sorts hazards by onset and serves retired clips for old-session replays", () => {
    const h = specClip().hazards[0];
    assert.ok(h);
    const two = clipWith({
      status: "retired",
      hazards: [
        { ...h, hazardId: "h2", window: { aMs: 25000, bMs: 28000 } },
        { ...h, hazardId: "h1", window: { aMs: 12400, bMs: 16900 } },
      ],
    });
    assert.deepEqual(
      toScoringClip(two).hazards.map((x) => x.hazardId),
      ["h1", "h2"],
    );
  });

  it("refuses clips that are not final", () => {
    assert.throws(() => toScoringClip(clipWith({ status: "rated" })), /published or retired/);
  });
});

describe("toClientManifestEntry (API-37)", () => {
  it("never carries hazard windows or hints, for mock and practice clips", () => {
    for (const mockEligible of [true, false]) {
      const clip = specClip();
      const e = toClientManifestEntry(clip, { mockEligible });
      assertNoLeak(clip, e);
      assert.equal(e.ref, "clip:JMU-0012@3");
      assert.equal(e.totalBytes, 1840000 + 2900000);
      assert.equal(e.media[0]?.url, mediaObjectKey("JMU-0012", 3, "360p"));
    }
  });

  it("omits the curator level for mock-eligible clips only", () => {
    assert.ok(!("curatorDifficulty" in toClientManifestEntry(specClip(), { mockEligible: true })));
    assert.equal(toClientManifestEntry(specClip(), { mockEligible: false }).curatorDifficulty, 3);
  });

  it("does not leak across many generated clips", () => {
    const base = specClip();
    const h = base.hazards[0];
    assert.ok(h);
    for (let k = 0; k < 40; k++) {
      const a = 10_000 + k * 137;
      const two = k % 2 === 0;
      const clip = clipWith({
        durationMs: 50_000,
        blurAudit: { ...base.blurAudit, framesChecked: 1500 } as Clip["blurAudit"],
        hazards: [
          { ...h, window: { aMs: a, bMs: a + 3_331 } },
          ...(two ? [{ ...h, hazardId: "h2", window: { aMs: a + 20_011, bMs: a + 24_007 } }] : []),
        ],
        quietSegments: [{ fromMs: 0, toMs: 9_001 + k }],
      });
      assertNoLeak(
        clip,
        toClientManifestEntry(clip, {
          mockEligible: k % 3 === 0,
          urlFor: (id, v, r) => `https://cdn.example/${id}/${v}/${r}.mp4`,
        }),
      );
    }
  });

  it("only exposes published clips", () => {
    assert.throws(
      () => toClientManifestEntry(clipWith({ status: "retired" }), { mockEligible: false }),
      /only published/,
    );
  });
});
