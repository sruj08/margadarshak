// Track Test Twin golden vectors on a generic 2W figure-8 ("Practice layout, not your RTO's track").
// Input streams are produced by a small pure-pursuit driver that steps the same bicycle model as the
// scorer, so the recorded quantised inputs replay to exactly the run the driver saw.
import type { TrackSpec, TrackTwinContent } from "../schema/content.ts";
import { GAME_CONFIG } from "../scoring/config.ts";
import type { QuantisedInput } from "../sim/bicycle.ts";
import { type BicycleState, stepBicycle } from "../sim/bicycle.ts";
import { datan, datan2, dcos, degToRad, dsin, PI } from "../sim/dmath.ts";
import { cumulativeLengths, projectOnPolyline, type Vec2 } from "../sim/geometry.ts";
import { ctxFor, StreamBuilder, type VectorInput, vector } from "./builders.ts";

const R = 4;

/** Entry (0,−6)→(0,0), a CCW loop round the left circle, a CW loop round the right circle, exit to (0,6). */
function figure8(): { pts: [number, number][]; segments: TrackSpec["segments"] } {
  const pts: [number, number][] = [];
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  for (let y = -6; y < 0; y += 1) pts.push([0, y]);
  const entryEnd = pts.length;
  const steps = 24;
  // Left circle centre (−R, 0): start at angle 0 (the origin), go counter-clockwise.
  for (let k = 0; k < steps; k++) {
    const a = (2 * PI * k) / steps;
    pts.push([r3(-R + R * dcos(a)), r3(R * dsin(a))]);
  }
  const leftEnd = pts.length;
  // Right circle centre (R, 0): start at angle π (the origin), go clockwise.
  for (let k = 0; k < steps; k++) {
    const a = PI - (2 * PI * k) / steps;
    pts.push([r3(R + R * dcos(a)), r3(R * dsin(a))]);
  }
  const rightEnd = pts.length;
  for (let y = 0; y <= 6; y += 1) pts.push([0, y]);
  return {
    pts,
    segments: [
      { fromIndex: 0, toIndex: entryEnd - 1, location: "entry" },
      { fromIndex: entryEnd - 1, toIndex: entryEnd + 1, location: "crossing" },
      { fromIndex: entryEnd + 1, toIndex: leftEnd - 1, location: "loop_left" },
      { fromIndex: leftEnd - 1, toIndex: leftEnd + 1, location: "crossing" },
      { fromIndex: leftEnd + 1, toIndex: rightEnd - 1, location: "loop_right" },
      { fromIndex: rightEnd - 1, toIndex: rightEnd + 1, location: "crossing" },
      { fromIndex: rightEnd + 1, toIndex: pts.length, location: "exit" },
    ],
  };
}

const F8 = figure8();

export const TRACK_GENERIC_8: TrackSpec = {
  trackId: "generic-8",
  version: 1,
  class: "2W",
  source: "design",
  label: "practice_layout",
  timeLimitS: 45,
  passDemerits: 20,
  immediateFailTimeFactor: 1.5,
  demerits: { lineTouch: 4, cone: 8, footDown: 10, stall: 4, rollback: 6, overTimePer10s: 4 },
  halfWidthM: 1,
  offTrackMarginM: 0.8,
  centreline: F8.pts,
  segments: F8.segments,
  cones: [
    { x: -9.1, y: 0, rM: 0.15 },
    { x: 9.1, y: 0, rM: 0.15 },
  ],
  start: { x: 0, y: -6, headingDeg: 90 },
  finishFraction: 0.95,
  finishRadiusM: 1.5,
};

interface DriverPlan {
  /** Target speed (m/s) at time t (s). */
  speed: (tS: number) => number;
  lookaheadM: number;
  /** Extra steer units added at time t (s): a sloppy rider. */
  steerBias?: (tS: number) => number;
  /** Fixed steer units from time t (s), replacing the driver (e.g. 0 = ride straight). */
  steerOverride?: (tS: number) => number | undefined;
  /** Stop recording inputs after this time (s). */
  untilS: number;
}

const HZ = 60;

/** The point at arc length `target` along the centreline, searching forward from segment `seg`. */
function pointAtArc(
  pts: readonly Vec2[],
  cum: readonly number[],
  seg: number,
  target: number,
): Vec2 {
  let j = seg;
  while (j < pts.length - 1 && (cum[j + 1] as number) < target) j++;
  const k = Math.min(j + 1, pts.length - 1);
  const a = pts[j] as Vec2;
  const b = pts[k] as Vec2;
  const segLen = (cum[k] as number) - (cum[j] as number);
  const u = segLen > 0 ? Math.min(1, Math.max(0, (target - (cum[j] as number)) / segLen)) : 0;
  return { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) };
}

/** Wraps an angle into [−π, π]. */
function wrapAngle(x: number): number {
  let a = x;
  while (a > PI) a -= 2 * PI;
  while (a < -PI) a += 2 * PI;
  return a;
}

/** Runs the pure-pursuit driver and returns the input changes it made, keyed by logic step. */
export function driveTrack(
  spec: TrackSpec,
  plan: DriverPlan,
): { step: number; input: QuantisedInput }[] {
  const pts: Vec2[] = spec.centreline.map(([x, y]) => ({ x, y }));
  const cum = cumulativeLengths(pts);
  const v2 = GAME_CONFIG.trackTwin.vehicle2W;
  let s: BicycleState = {
    x: spec.start.x,
    y: spec.start.y,
    headingRad: degToRad(spec.start.headingDeg),
    v: 0,
  };
  let seg = 0;
  const out: { step: number; input: QuantisedInput }[] = [];
  let last = "";
  const steps = Math.round(plan.untilS * HZ);
  for (let step = 0; step < steps; step++) {
    let hi = seg + 1;
    while (hi < pts.length - 1 && (cum[hi] as number) - (cum[seg] as number) < 4) hi++;
    const proj = projectOnPolyline(pts, cum, s, Math.max(0, seg - 1), hi + 1);
    seg = proj.segment;
    const g = pointAtArc(pts, cum, seg, proj.arc + plan.lookaheadM);
    const alpha = wrapAngle(datan2(g.y - s.y, g.x - s.x) - s.headingRad);
    const delta = datan((2 * v2.wheelbaseM * dsin(alpha)) / plan.lookaheadM);
    const tS = step / HZ;
    const bias = plan.steerBias?.(tS) ?? 0;
    const fixed = plan.steerOverride?.(tS);
    const steer =
      fixed ?? Math.max(-127, Math.min(127, Math.round((delta / v2.maxSteerRad) * 127) + bias));
    const want = plan.speed(tS);
    const throttle = s.v < want ? Math.min(255, Math.round((want - s.v) * 400)) : 0;
    const brake = s.v > want + 0.3 ? 120 : 0;
    const input = { steer, throttle, brake };
    const key = `${steer},${throttle},${brake}`;
    if (key !== last) {
      out.push({ step, input });
      last = key;
    }
    s = stepBicycle(s, input, v2, 1 / HZ);
  }
  return out;
}

/** The earliest integer ms whose logic step (⌊t·60/1000⌋) is `step`. */
const msForStep = (step: number): number => Math.ceil((step * 1000) / HZ);

function session(n: number, seed: number, plan: DriverPlan, endEarlyS?: number) {
  const spec = TRACK_GENERIC_8;
  const ref = `track:${spec.trackId}@${spec.version}`;
  const ctx = ctxFor({
    n,
    gameId: "track_twin",
    mode: "practice",
    seed,
    items: [{ ref, contentVersion: String(spec.version) }],
  });
  const s = new StreamBuilder(ctx.sid);
  s.push(
    "session_start",
    { deviceClass: "mid", timingMode: "sim", a11yModes: [], orientation: "landscape" },
    { t: 0 },
  );
  const t0 = 2000;
  s.push("item_start", { ref }, { t: t0, item: 0 });
  for (const { step, input } of driveTrack(spec, plan))
    s.push("input", input, { t: t0 + msForStep(step), item: 0 });
  const endS = endEarlyS ?? plan.untilS;
  s.push("item_end", { ref, reason: "done" }, { t: t0 + Math.round(endS * 1000), item: 0 });
  s.push("session_end", { reason: "completed" }, { t: t0 + Math.round(endS * 1000) + 500 });
  const content: TrackTwinContent = { gameId: "track_twin", tracks: [spec] };
  return { ctx, events: s.build(), content };
}

export function trackTwinVectors(): VectorInput[] {
  return [
    vector({
      name: "tt-strong",
      description: "Steady 2 m/s, smooth figure-8: no faults, inside the time limit",
      tags: ["strong"],
      ...session(501, 9001, { speed: () => 2, lookaheadM: 1.6, untilS: 60 }),
    }),
    vector({
      name: "tt-medium",
      description:
        "Rides straight for 0.9 s in each loop: two line touches (8 demerits), still a pass",
      tags: ["medium"],
      ...session(502, 9002, {
        speed: () => 2.2,
        lookaheadM: 1.6,
        steerOverride: (t) => ((t > 8 && t < 8.9) || (t > 20 && t < 20.9) ? 0 : undefined),
        untilS: 60,
      }),
    }),
    vector({
      name: "tt-weak",
      description:
        "Stops twice in the loops (foot down ×2) and finishes over the time limit: fails",
      tags: ["weak"],
      ...session(503, 9003, {
        speed: (t) => (t > 8 && t < 12 ? 0 : t > 24 && t < 28 ? 0 : 1.6),
        lookaheadM: 1.4,
        untilS: 67,
      }),
    }),
    vector({
      name: "tt-off-track",
      description: "Rides straight out of the left loop and leaves the track: immediate fail",
      tags: ["critical"],
      ...session(504, 9004, {
        speed: () => 2,
        lookaheadM: 1.6,
        steerOverride: (t) => (t > 6 ? 0 : undefined),
        untilS: 20,
      }),
    }),
    vector({
      name: "tt-edge-overtime",
      description:
        "Clean but slow: finishes a few seconds over the 45 s limit (4 demerits), still a pass",
      tags: ["edge"],
      ...session(505, 9005, { speed: () => 1.45, lookaheadM: 1.5, untilS: 67 }),
    }),
    vector({
      name: "tt-edge-release",
      description:
        "The item ends at 12 s: inputs are released (zero), the bike rolls straight off the loop",
      tags: ["edge"],
      ...session(506, 9006, { speed: () => 2, lookaheadM: 1.6, untilS: 12 }, 12),
    }),
  ];
}
