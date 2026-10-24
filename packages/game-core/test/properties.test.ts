// Property tests driven by a seeded mulberry32 loop (fast-check is not installed; the generator is
// deterministic, so a failure always reproduces with the printed case number).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ctxFor, StreamBuilder } from "../src/fixtures/builders.ts";
import { JS_T_BUS, JS_T_PED } from "../src/fixtures/junction-scan.ts";
import { HPT_KL, NAZAR_CLIPS, nazarRef } from "../src/fixtures/nazar.ts";
import { SD_ROUNDS } from "../src/fixtures/stopping-distance.ts";
import type { GameEvent, GameMode, NazarClip, SessionResult } from "../src/schema/index.ts";
import {
  finding,
  rankFindings,
  scoreJunctionScan,
  scoreNazarFieldKitLinear,
  scoreNazarKerala5Band,
  scoreStoppingDistance,
} from "../src/scoring/index.ts";
import { mulberry32, randInt } from "../src/sim/index.ts";

const CASES = 150;
const OPTS = { gameVersion: "1.0.0", scoringVersion: "1.0", replayInputs: "" };

function nazarEvents(
  sid: string,
  clips: readonly NazarClip[],
  taps: readonly number[][],
): GameEvent[] {
  const s = new StreamBuilder(sid);
  s.push(
    "session_start",
    { deviceClass: "mid", timingMode: "rvfc", a11yModes: [], orientation: "landscape" },
    { t: 0 },
  );
  clips.forEach((c, item) => {
    const t0 = 1000 + item * 70000;
    s.push("item_start", { ref: nazarRef(c) }, { t: t0, mt: 0, item });
    for (const mt of [...(taps[item] ?? [])].sort((a, b) => a - b))
      s.push("tap", { x: 0.5, y: 0.5 }, { t: t0 + mt, mt, item });
    s.push(
      "item_end",
      { ref: nazarRef(c), reason: "done" },
      { t: t0 + c.durationMs, mt: c.durationMs, item },
    );
  });
  return s.build();
}

function scoreNazar(
  mode: GameMode,
  clips: readonly NazarClip[],
  taps: readonly number[][],
  linear = false,
): SessionResult {
  const ctx = ctxFor({
    n: 900,
    gameId: "nazar",
    mode,
    seed: 1,
    items: clips.map((c) => ({ ref: nazarRef(c), contentVersion: "1" })),
  });
  const content = { gameId: "nazar" as const, clips: [...clips], format: HPT_KL };
  const events = nazarEvents(ctx.sid, clips, taps);
  return (linear ? scoreNazarFieldKitLinear : scoreNazarKerala5Band)(ctx, events, content, OPTS);
}

/** Random taps: a few near hazards, a few anywhere, at least 1.2 s apart unless `burst`. */
function randomTaps(rng: () => number, c: NazarClip): number[] {
  const out: number[] = [];
  for (const h of c.hazards)
    if (rng() < 0.8) out.push(randInt(rng, h.window.aMs - 800, h.window.bMs + 500));
  const extra = randInt(rng, 0, 3);
  for (let i = 0; i < extra; i++) out.push(randInt(rng, 0, c.durationMs - 1));
  return out.map((x) => Math.max(0, Math.min(c.durationMs, x)));
}

/** A tap outside every [a − 1 s, b] band (a false alarm), or null if none fits. */
function falseAlarm(rng: () => number, c: NazarClip): number | null {
  for (let k = 0; k < 50; k++) {
    const t = randInt(rng, 0, c.durationMs);
    if (c.hazards.every((h) => t < h.window.aMs - 1000 || t > h.window.bMs)) return t;
  }
  return null;
}

const sumOk = (r: SessionResult): boolean =>
  Math.abs(r.score.raw - r.score.components.reduce((s, c) => s + c.value, 0)) < 1e-9;

describe("properties", () => {
  it("Nazar: score ∈ [0, max], raw = Σ components, both rules", () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < CASES; i++) {
      const n = randInt(rng, 1, 10);
      const clips = NAZAR_CLIPS.slice(0, n);
      const taps = clips.map((c) => randomTaps(rng, c));
      for (const mode of ["mock", "practice"] as const) {
        for (const linear of [false, true]) {
          const r = scoreNazar(mode, clips, taps, linear);
          assert.ok(r.score.raw >= 0 && r.score.raw <= r.score.max, `case ${i}`);
          assert.ok(r.score.pct >= 0 && r.score.pct <= 100, `case ${i}`);
          assert.ok(sumOk(r), `case ${i}`);
        }
      }
    }
  });

  it("Nazar: an extra false alarm never raises a score", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < CASES; i++) {
      const clips = NAZAR_CLIPS.slice(0, randInt(rng, 1, 10));
      const taps = clips.map((c) => randomTaps(rng, c));
      const k = randInt(rng, 0, clips.length - 1);
      const fa = falseAlarm(rng, clips[k] as NazarClip);
      if (fa === null) continue;
      const more = taps.map((t, j) => (j === k ? [...t, fa] : t));
      for (const mode of ["mock", "practice"] as const) {
        const before = scoreNazar(mode, clips, taps).score.raw;
        const after = scoreNazar(mode, clips, more).score.raw;
        assert.ok(after <= before, `case ${i} ${mode}: ${after} > ${before}`);
      }
    }
  });

  it("Nazar: a pattern-voided clip scores 0, however well the taps are placed", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < CASES; i++) {
      const c = NAZAR_CLIPS[randInt(rng, 0, NAZAR_CLIPS.length - 1)] as NazarClip;
      const a = c.hazards[0]?.window.aMs ?? 0;
      const start = randInt(rng, a, a + 500);
      const burst = rng() < 0.5;
      // Either 4 taps inside 999 ms, or more than 2·|H| + 4 taps spread out.
      const taps = burst
        ? [0, randInt(rng, 1, 300), randInt(rng, 301, 600), randInt(rng, 601, 999)].map(
            (d) => start + d,
          )
        : Array.from({ length: 2 * c.hazards.length + 5 }, (_, j) =>
            Math.min(c.durationMs, 1000 + j * 1100),
          );
      const r = scoreNazar("mock", [c], [taps]);
      assert.equal(r.score.raw, 0, `case ${i}`);
      assert.ok(
        r.findings.some((f) => f.findingId === "NAZ_PATTERN_CLICK"),
        `case ${i}`,
      );
    }
  });

  it("ranking: a critical finding always ranks first; order is total and deterministic", () => {
    const rng = mulberry32(5);
    const idsPool = [
      "BS_LEFT_OVERTAKE",
      "BS_NOZONE_TIME",
      "JS_SHORT_GAP",
      "NAZ_BELOW_KERALA_MARK",
      "NAZ_LATE_RESPONSE",
      "TT_LINE_TOUCH",
    ];
    for (let i = 0; i < CASES; i++) {
      const fs = Array.from({ length: randInt(rng, 1, 6) }, () =>
        finding({
          findingId: idsPool[randInt(rng, 0, idsPool.length - 1)] as string,
          severity: Math.round(rng() * 100) / 100,
          critical: rng() < 0.2,
          skillId: "SK-M4",
          facts: {},
        }),
      );
      const ranked = rankFindings(fs);
      if (fs.some((f) => f.critical)) assert.equal(ranked[0]?.critical, true, `case ${i}`);
      assert.deepEqual(rankFindings([...fs].reverse()), ranked, `case ${i}: order-independent`);
      assert.equal(new Set(ranked.map((f) => f.findingId)).size, ranked.length);
    }
  });

  it("Junction Scan: critical findings rank first, items capped at 20, score ∈ [0, 100]", () => {
    const rng = mulberry32(31);
    for (let i = 0; i < CASES; i++) {
      const specs = [JS_T_BUS, JS_T_PED];
      const ctx = ctxFor({
        n: 901,
        gameId: "junction_scan",
        mode: "practice",
        seed: randInt(rng, 0, 1e6),
        items: [
          { ref: "js:t-bus", contentVersion: "1" },
          { ref: "js:t-ped", contentVersion: "1" },
        ],
      });
      const s = new StreamBuilder(ctx.sid);
      let t0 = 1000;
      specs.forEach((_, item) => {
        s.push("item_start", { ref: item === 0 ? "js:t-bus" : "js:t-ped" }, { t: t0, item });
        const go = t0 + randInt(rng, 3000, 14000);
        for (let k = 0; k < randInt(rng, 0, 4); k++) {
          s.push(
            "scan_look",
            {
              dir: (["right", "left", "ahead"] as const)[randInt(rng, 0, 2)] as "right",
              durMs: 300,
            },
            { t: go - randInt(rng, 0, 4000), item },
          );
        }
        if (rng() < 0.5) s.push("creep", { distDm: randInt(rng, 0, 30) }, { t: go - 500, item });
        s.push("decision", { node: "go", choice: "go" }, { t: go, item });
        s.push(
          "item_end",
          { ref: item === 0 ? "js:t-bus" : "js:t-ped", reason: "done" },
          { t: go + 1000, item },
        );
        t0 = go + 2000;
      });
      const r = scoreJunctionScan(ctx, s.build(), { gameId: "junction_scan", items: specs }, OPTS);
      assert.ok(r.score.pct >= 0 && r.score.pct <= 100, `case ${i}`);
      assert.ok(sumOk(r), `case ${i}`);
      if (r.findings.some((f) => f.critical))
        assert.equal(r.findings[0]?.critical, true, `case ${i}`);
      const crit = r.findings.some((f) => f.critical);
      if (crit)
        assert.ok(
          r.score.components.some((c) => c.value <= 10),
          `case ${i}: a capped item is ≤ 20/2`,
        );
    }
  });

  it("Stopping Distance: score ∈ [0, 100] and raw = Σ components", () => {
    const rng = mulberry32(77);
    for (let i = 0; i < CASES; i++) {
      const ctx = ctxFor({
        n: 902,
        gameId: "stopping_distance",
        mode: "practice",
        seed: randInt(rng, 0, 1e6),
        items: SD_ROUNDS.map((r) => ({ ref: r.id, contentVersion: "1" })),
      });
      const s = new StreamBuilder(ctx.sid);
      let t = 0;
      const tick = (): number => {
        t += 100;
        return t;
      };
      SD_ROUNDS.forEach((r, item) => {
        s.push("item_start", { ref: r.id }, { t: tick(), item });
        if (r.round.round === 1)
          s.push(
            "estimate",
            {
              speedKmh: r.round.speedKmh,
              surface: r.round.surface,
              predictedM: randInt(rng, 0, 1500) / 10,
            },
            { t: tick(), item },
          );
        else
          s.push(
            "speed_choice",
            {
              chosenKmh: 5 * randInt(rng, 2, 20),
              context: r.round.round === 2 ? "street" : "sight",
            },
            { t: tick(), item },
          );
        if (r.round.round === 2)
          s.push("brake", { rtMs: randInt(rng, 50, 3000) }, { t: tick(), item });
        s.push("item_end", { ref: r.id, reason: "done" }, { t: tick(), item });
      });
      const r = scoreStoppingDistance(
        ctx,
        s.build(),
        { gameId: "stopping_distance", rounds: SD_ROUNDS.map((x) => x.round) },
        OPTS,
      );
      assert.ok(r.score.raw >= 0 && r.score.raw <= r.score.max && r.score.max === 100, `case ${i}`);
      assert.ok(sumOk(r), `case ${i}`);
    }
  });
});
