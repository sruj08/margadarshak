// Golden replay vectors: every vector replays to its expected SessionResult, plus hand-checked
// numbers from the specs so the expected file cannot silently encode a bug.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixtureContentDocs, fixtureFormats, goldenVectors } from "../src/fixtures/index.ts";
import type { SessionResult } from "../src/schema/index.ts";
import {
  assembleContent,
  replay,
  replayAsync,
  requiredFormats,
  SUPPORTED_GAMES,
} from "../src/scoring/index.ts";
import { canonicalDigest, decodeReplay, encodeReplayGzip } from "../src/sdk/index.ts";

const byName = new Map(goldenVectors().map((v) => [v.name, v]));
const result = (name: string): SessionResult => {
  const v = byName.get(name);
  if (v === undefined) throw new Error(name);
  return replay(v.manifest, v.ctx, v.replayPackage, v.content);
};
const ids = (r: SessionResult): string[] => r.findings.map((f) => f.findingId);
const fact = (r: SessionResult, id: string, key: string): unknown =>
  r.findings.find((f) => f.findingId === id)?.facts[key];

describe("golden vectors", () => {
  it("has at least 5 vectors per implemented game", () => {
    for (const g of SUPPORTED_GAMES) {
      const n = goldenVectors().filter((v) => v.ctx.gameId === g).length;
      assert.ok(n >= 5, `${g}: ${n} vectors`);
    }
  });

  for (const v of goldenVectors()) {
    it(`${v.name} replays to the expected result`, () => {
      const r = replay(v.manifest, v.ctx, v.replayPackage, v.content);
      assert.deepEqual(r, v.expectedResult);
      assert.equal(canonicalDigest(r), canonicalDigest(v.expectedResult));
      // raw = Σ components (2 dp)
      const sum = r.score.components.reduce((s, c) => s + c.value, 0);
      assert.ok(Math.abs(r.score.raw - sum) < 1e-9, `${v.name}: raw ${r.score.raw} vs Σ ${sum}`);
    });
  }

  it("the fixture content store assembles exactly the vectors' content", () => {
    const docs = fixtureContentDocs();
    const formats = fixtureFormats();
    for (const v of goldenVectors()) {
      const raw = {
        items: v.ctx.items.map((i) => docs[i.ref]),
        formats: Object.fromEntries(requiredFormats(v.ctx).map((id) => [id, formats[id]])),
      };
      assert.deepEqual(assembleContent(v.ctx, raw), v.content, v.name);
    }
  });

  it("replayAsync with gzip gives the same result", async () => {
    const v = byName.get("nazar-voided");
    assert.ok(v !== undefined);
    const gz = await encodeReplayGzip(decodeReplay(v.replayPackage), v.ctx.seed);
    const r = await replayAsync(v.manifest, v.ctx, gz, v.content);
    assert.deepEqual({ ...r, replay: v.expectedResult.replay }, v.expectedResult);
  });
});

describe("hand-checked numbers", () => {
  it("Nazar Kerala marks, late facts and pass rule", () => {
    const strong = result("nazar-strong");
    assert.equal(strong.score.raw, 100);
    assert.equal(strong.score.passed, true);
    assert.deepEqual(strong.score.passRule, { source: "rule_pack", ref: "HPT-KL" });
    const med = result("nazar-medium");
    // Bands 2,3,2,(1+4),3,2,5,(2+miss),3,3 → 8+6+8+7+6+8+2+4+6+6 = 61.
    assert.deepEqual(
      med.score.components.map((c) => c.value),
      [8, 6, 8, 7, 6, 8, 2, 4, 6, 6],
    );
    assert.equal(med.score.passed, true);
    // Truck clip: window [18000, 22500], band 5 at 30% → τ = 21870; band-1 end 18900; late 2.97 s → 3.0 s.
    assert.equal(fact(med, "NAZ_LATE_RESPONSE", "late_s"), 3);
    assert.equal(fact(med, "NAZ_LATE_RESPONSE", "metres"), 25); // 3.0 × 30 / 3.6
    const weak = result("nazar-weak");
    assert.equal(weak.score.raw, 25);
    assert.equal(weak.score.passed, false);
    assert.equal(ids(weak).at(-1), "NAZ_BELOW_KERALA_MARK", "informational finding ranks last");
    assert.deepEqual(weak.findings.find((f) => f.findingId === "NAZ_OVERCONFIDENT")?.facts, {
      actual_pass: 2,
      predicted_pass: 8,
    });
  });

  it("Nazar voids: pattern clips and a hidden-tab clip score 0 in a mock; drift voids and halves trust", () => {
    const v = result("nazar-voided");
    assert.deepEqual(
      v.score.components.map((c) => c.value),
      [8, 8, 0, 8, 0, 8, 0, 8, 8, 8],
    );
    assert.equal(fact(v, "NAZ_PATTERN_CLICK", "pattern_clips"), 2);
    assert.equal(fact(v, "NAZ_PATTERN_CLICK", "taps_in_1s"), 4);
    assert.deepEqual(v.integrity.flags, ["INT_TAB_HIDDEN"]);
    assert.equal(v.integrity.trust, 0.9);
    const d = result("nazar-fallback-drift");
    assert.equal(d.score.components[1]?.value, 0);
    assert.deepEqual(d.integrity.flags, ["INT_CLOCK_DRIFT", "INT_TIMING_FALLBACK"]);
    assert.equal(d.integrity.trust, 0.5);
    assert.equal(d.integrity.timingMode, "fallback");
  });

  it("Nazar practice edges: onset = 5, overlapping windows credit the earlier onset, tap at b = 1", () => {
    const p = result("nazar-edge-practice");
    assert.deepEqual(
      p.score.components.map((c) => [c.id, c.value]),
      [
        ["c1_h1", 5],
        ["c2_h1", 2],
        ["c2_h2", 1],
        ["c4_h1", 4],
      ],
    );
    assert.equal(p.score.passed, null);
    assert.equal(p.score.passRule, null);
  });

  it("Stopping Distance components", () => {
    const s = result("sd-strong");
    assert.deepEqual(
      s.score.components.map((c) => c.id),
      ["estimation", "no_collision", "speed_for_sight"],
    );
    assert.equal(s.score.components[1]?.value, 20);
    assert.equal(s.score.components[2]?.value, 50);
    const w = result("sd-weak");
    // Sight 60 m dry: v_max 20.2 m/s = 72.7 km/h → option 70; chosen 85 → 3 steps over → 40% of 25.
    assert.equal(fact(w, "SD_OVERSPEED_FOR_SIGHT", "max_safe_kmh"), 70);
    assert.equal(fact(w, "SD_OVERSPEED_FOR_SIGHT", "over_kmh"), 15);
    assert.equal(w.score.components[2]?.value, 20);
    assert.equal(fact(w, "SD_UNDERESTIMATE", "true_m"), 60.4);
    const c = result("sd-collision");
    assert.equal(fact(c, "SD_COLLISION", "impact_band"), "between_50_80");
    assert.equal(c.findings.find((f) => f.findingId === "SD_COLLISION")?.severity, 1);
    const e = result("sd-edge");
    assert.deepEqual(e.integrity.flags, ["INT_RT_ANTICIPATORY"]);
    assert.equal(e.integrity.trust, 1);
  });

  it("Blind Spot: left overtake zeroes Part B and ranks first", () => {
    const r = result("bs-left-overtake");
    assert.equal(r.findings[0]?.findingId, "BS_LEFT_OVERTAKE");
    assert.equal(r.findings[0]?.critical, true);
    assert.deepEqual(
      r.score.components.map((c) => c.value),
      [30, 0, 0, 0],
    );
    assert.equal(r.score.capApplied, "critical_left_overtake_part_b_0");
    assert.equal(result("bs-strong").score.raw, 100);
    assert.equal(fact(result("bs-medium"), "BS_NOZONE_TIME", "share_pct"), 14);
  });

  it("Junction Scan: mean of items, critical cap 20, scan window edges", () => {
    assert.equal(result("js-strong").score.pct, 100);
    assert.equal(result("js-medium").score.pct, 75); // (20+20+15+15 + 10+40+15+15) / 2
    const c = result("js-critical");
    assert.equal(c.score.pct, 20);
    assert.equal(c.score.capApplied, "critical_fault_cap_20");
    assert.deepEqual(ids(c).slice(0, 2), ["JS_COLLISION", "JS_NO_SCAN_THREAT_SIDE"]);
    // Edge: a look at exactly 3.000 s counts, 3.001 s does not → right only → 10 + 40 + 15 + 15.
    assert.deepEqual(
      result("js-edge").score.components.map((c) => c.value),
      [0, 40],
    );
  });

  it("Track Twin demerit sheet", () => {
    assert.equal(result("tt-strong").score.pct, 100);
    assert.equal(result("tt-medium").score.pct, 60); // 2 line touches × 4 → 100 − 5·8
    const w = result("tt-weak");
    assert.equal(w.score.passed, false); // 2 foot-downs (20) + 1 overtime block (4) = 24 > 20
    assert.equal(fact(w, "TT_FOOT_DOWN", "count"), 2);
    const o = result("tt-off-track");
    assert.equal(o.findings[0]?.findingId, "TT_IMMEDIATE_FAIL");
    assert.ok(o.score.pct <= 40);
    const e = result("tt-edge-overtime");
    assert.equal(e.score.pct, 80);
    assert.equal(e.score.passed, true);
    assert.deepEqual(e.score.passRule, { source: "design", ref: "track:generic-8@1" });
  });

  it("LL mock pass rule from the rule pack, default assumption otherwise", () => {
    const s = result("ll-mock-strong");
    assert.equal(s.score.passed, true);
    assert.deepEqual(s.score.passRule, { source: "rule_pack", ref: "LLT-JK" });
    const m = result("ll-mock-pass-mark");
    assert.equal(m.score.raw, 6);
    assert.equal(m.score.passed, true);
    const w = result("ll-mock-weak");
    assert.equal(w.score.passed, false);
    assert.equal(fact(w, "LL_TIMEOUTS", "timeouts"), 2);
    const d = result("ll-mock-default-format");
    assert.deepEqual(d.score.passRule, { source: "design", ref: "LLT-DEFAULT" });
    assert.equal(d.score.raw, 9);
    assert.equal(d.score.passed, true); // 9 ≥ ⌈60% × 15⌉ = 9
    const p = result("ll-practice-overconfident");
    assert.equal(p.score.passed, null);
    assert.deepEqual(p.calibration, { n: 10, brier: 0.3625, overconfidence: 0.25 });
    assert.equal(p.evidence.filter((e) => e.overconfident).length, 3);
  });
});
