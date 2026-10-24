// Determinism of the simulation kernel: PRNG, sub-streams, deterministic math, fixed step, physics.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { driveTrack, TRACK_GENERIC_8 } from "../src/fixtures/track-twin.ts";
import { simulateTrack } from "../src/scoring/index.ts";
import {
  convexOverlap,
  createFixedStepLoop,
  datan2,
  dcos,
  dexp,
  dlog,
  dpow,
  dsin,
  dtan,
  hash32,
  impactSpeed,
  kmhToMps,
  maxSafeOptionKmh,
  maxSafeSpeed,
  mpsToKmh,
  mulberry32,
  rect,
  shuffle,
  stepIndexAt,
  subStream,
  totalStoppingDistance,
  whoBand,
} from "../src/sim/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const bits = (x: number): string => {
  const d = new DataView(new ArrayBuffer(8));
  d.setFloat64(0, x);
  return d.getBigUint64(0).toString(16);
};

describe("prng", () => {
  it("mulberry32 is pinned", () => {
    const r = mulberry32(42);
    assert.deepEqual(
      [r(), r(), r()],
      [0.6011037519201636, 0.44829055899754167, 0.8524657934904099],
    );
  });
  it("hash32 and sub-streams are pinned", () => {
    assert.equal(hash32(42, "traffic"), 2456675306);
    assert.equal(hash32(0, ""), 1234692987);
    assert.equal(hash32(4294967295, "items"), 1318274638);
    const s = subStream(42, "traffic");
    assert.deepEqual([s(), s()], [0.9131494218017906, 0.8552958266809583]);
  });
  it("sub-streams are independent: adding a concern never shifts another", () => {
    const draw = (labels: string[]): number[] => {
      const streams = new Map(labels.map((l) => [l, subStream(7, l)]));
      const out: number[] = [];
      for (let i = 0; i < 5; i++)
        for (const l of labels) {
          const v = (streams.get(l) as () => number)();
          if (l === "traffic") out.push(v);
        }
      return out;
    };
    assert.deepEqual(draw(["traffic"]), draw(["items", "traffic", "layout", "glare"]));
    assert.notDeepEqual(
      draw(["traffic"]),
      (() => {
        const s = subStream(7, "items");
        return [s(), s(), s(), s(), s()];
      })(),
    );
  });
  it("same seed gives the same shuffle; outputs stay in [0, 1)", () => {
    assert.deepEqual(
      shuffle(mulberry32(9), [1, 2, 3, 4, 5, 6]),
      shuffle(mulberry32(9), [1, 2, 3, 4, 5, 6]),
    );
    const r = mulberry32(123);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1);
    }
  });
});

describe("dmath", () => {
  it("is accurate to a few ulp against Math on the sim domains", () => {
    let worst = { sin: 0, cos: 0, atan2: 0, exp: 0, log: 0, pow: 0, tan: 0 };
    for (let i = 0; i < 20000; i++) {
      const x = (i / 20000 - 0.5) * 50;
      const y = dsin(i * 0.37) * 7;
      const z = dcos(i * 0.11) * 7;
      const e = (i / 20000 - 0.5) * 80;
      const l = (i + 1) / 97;
      const tx = (i / 20000 - 0.5) * 3;
      worst = {
        sin: Math.max(worst.sin, Math.abs(dsin(x) - Math.sin(x))),
        cos: Math.max(worst.cos, Math.abs(dcos(x) - Math.cos(x))),
        atan2: Math.max(worst.atan2, Math.abs(datan2(y, z) - Math.atan2(y, z))),
        exp: Math.max(worst.exp, Math.abs(dexp(e) / Math.exp(e) - 1)),
        log: Math.max(worst.log, Math.abs(dlog(l) - Math.log(l))),
        pow: Math.max(worst.pow, Math.abs(dpow(l, 0.37) / l ** 0.37 - 1)),
        tan: Math.max(
          worst.tan,
          Math.abs(dtan(tx) - Math.tan(tx)) / Math.max(1, Math.abs(Math.tan(tx))),
        ),
      };
    }
    assert.ok(worst.sin < 1e-15, `sin ${worst.sin}`);
    assert.ok(worst.cos < 1e-15, `cos ${worst.cos}`);
    assert.ok(worst.atan2 < 1e-15, `atan2 ${worst.atan2}`);
    assert.ok(worst.exp < 1e-15, `exp ${worst.exp}`);
    assert.ok(worst.log < 1e-14, `log ${worst.log}`);
    assert.ok(worst.pow < 1e-14, `pow ${worst.pow}`);
    assert.ok(worst.tan < 1e-14, `tan ${worst.tan}`);
  });
  it("produces pinned bit patterns (the cross-engine contract)", () => {
    assert.equal(bits(dsin(1)), "3feaed548f090cee");
    assert.equal(bits(dcos(1)), "3fe14a280fb5068c");
    assert.equal(bits(datan2(1, 2)), "3fddac670561bb4f");
    assert.equal(bits(dexp(1)), "4005bf0a8b14576a");
    assert.equal(bits(dpow(2, 0.5)), "3ff6a09e667f3bcc");
    assert.equal(bits(dlog(10)), "40026bb1bbb55516");
  });
  it("handles special values", () => {
    assert.equal(datan2(0, 0), 0);
    assert.equal(datan2(1, 0), Math.PI / 2);
    assert.equal(dexp(0), 1);
    assert.equal(dexp(1000), Number.POSITIVE_INFINITY);
    assert.equal(dlog(0), Number.NEGATIVE_INFINITY);
    assert.ok(Number.isNaN(dlog(-1)));
    assert.equal(dpow(3, 4), 81);
    assert.equal(dpow(2, -2), 0.25);
    assert.throws(() => dsin(1e7), RangeError);
  });
});

describe("forbidden APIs in sim and scoring", () => {
  it("src/sim and src/scoring use no wall clock, Math.random or engine transcendentals", () => {
    const banned = [
      /\bMath\.random\b/,
      /\bDate\.now\b/,
      /\bperformance\.now\b/,
      /\bnew\s+Date\b/,
      /\bMath\.(sin|cos|tan|atan2|atan|asin|acos|exp|expm1|pow|log|log2|log10|log1p|sinh|cosh|tanh|cbrt|hypot)\b/,
    ];
    const offenders: string[] = [];
    for (const sub of ["sim", "scoring"]) {
      const dir = join(here, "..", "src", sub);
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
        // Strip comments: the rules may be named in prose.
        const code = readFileSync(join(dir, f), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
        for (const re of banned) if (re.test(code)) offenders.push(`${sub}/${f}: ${re}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe("fixed-step loop", () => {
  it("accumulates exactly: 30 fps and 60 fps produce the same steps", () => {
    const a = createFixedStepLoop({ hz: 60 });
    const b = createFixedStepLoop({ hz: 60 });
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < 300; i++) sa += a.advance(i % 3 === 0 ? 34 : 33).steps; // ~30 fps, 10 000 ms
    for (let i = 0; i < 600; i++) sb += b.advance(i % 3 === 0 ? 17 : i % 3 === 1 ? 16 : 17).steps; // ~60 fps, 10 000 ms
    assert.equal(sa, 600);
    assert.equal(sb, 600);
    assert.equal(a.totalSteps, b.totalSteps);
  });
  it("stepIndexAt is ⌊t·hz/1000⌋", () => {
    assert.equal(stepIndexAt(0), 0);
    assert.equal(stepIndexAt(16), 0);
    assert.equal(stepIndexAt(17), 1);
    assert.equal(stepIndexAt(50), 3);
    assert.equal(stepIndexAt(1000), 60);
  });
});

describe("track sim determinism", () => {
  it("same inputs give an identical trace", () => {
    const plan = { speed: () => 2, lookaheadM: 1.6, untilS: 20 };
    const a = driveTrack(TRACK_GENERIC_8, plan);
    const b = driveTrack(TRACK_GENERIC_8, plan);
    assert.deepEqual(a, b);
    const ra = simulateTrack(TRACK_GENERIC_8, a);
    const rb = simulateTrack(TRACK_GENERIC_8, b);
    assert.deepEqual(ra, rb);
    assert.equal(bits(ra.final.x), bits(rb.final.x));
  });
});

describe("stopping physics (GAME_DESIGN §3.7 checks)", () => {
  const near = (a: number, b: number, tol = 0.05): void =>
    assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  it("total stopping distances: 40 dry 25.7, 60 dry 45.2, 60 wet 60.4 (braking 35.4), 80 dry 69.3", () => {
    near(totalStoppingDistance(kmhToMps(40), 1.5, 0.7), 25.7);
    near(totalStoppingDistance(kmhToMps(60), 1.5, 0.7), 45.2);
    near(totalStoppingDistance(kmhToMps(60), 1.5, 0.4), 60.4);
    near(totalStoppingDistance(kmhToMps(60), 1.5, 0.4) - kmhToMps(60) * 1.5, 35.4);
    near(totalStoppingDistance(kmhToMps(80), 1.5, 0.7), 69.3);
  });
  it("max safe speed for 40 m: dry 15.3 m/s ≈ 55 km/h, wet 12.8 m/s ≈ 46 km/h; options in 5 km/h steps", () => {
    near(maxSafeSpeed(40, 1.5, 0.7), 15.3);
    near(maxSafeSpeed(40, 1.5, 0.4), 12.8);
    near(mpsToKmh(maxSafeSpeed(40, 1.5, 0.7)), 55, 0.2);
    assert.equal(maxSafeOptionKmh(40, 1.5, 0.7), 55);
    assert.equal(maxSafeOptionKmh(40, 1.5, 0.4), 45);
    near(totalStoppingDistance(maxSafeSpeed(40, 1.5, 0.7), 1.5, 0.7), 40, 1e-9);
  });
  it("impact speed and the two-point WHO band", () => {
    assert.equal(impactSpeed(10, 1.5, 0.7, 12), 10); // D ≤ v·rt: full speed
    near(impactSpeed(16.667, 1.5, 0.7, 30), 14.46, 0.01);
    assert.equal(impactSpeed(5, 1, 0.7, 50), 0);
    assert.equal(whoBand(49.9), "below_50");
    assert.equal(whoBand(50), "between_50_80");
    assert.equal(whoBand(79.9), "between_50_80");
    assert.equal(whoBand(80), "80_plus");
  });
});

describe("geometry", () => {
  it("convex overlap treats touching edges as outside", () => {
    assert.equal(convexOverlap(rect(0, 0, 1, 1), rect(2, 0, 1, 1)), false);
    assert.equal(convexOverlap(rect(0, 0, 1, 1), rect(1.999, 0, 1, 1)), true);
    assert.equal(convexOverlap(rect(0, 0, 1, 1), rect(0, 0, 0.1, 0.1)), true);
  });
});
