// Geometry helpers for the top-down sims (metres). Convex polygons for no-zones (SAT overlap),
// polyline projection for path tolerance, keyframe interpolation for scripted agents and
// time-to-arrival at a conflict point. Rotation uses deterministic dmath.
import { dcos, dsin } from "./dmath.ts";

export interface Vec2 {
  x: number;
  y: number;
}
export type Polygon = readonly Vec2[];

export function rotate(p: Vec2, angleRad: number): Vec2 {
  const c = dcos(angleRad);
  const s = dsin(angleRad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Axis-aligned rectangle centred at (cx, cy) as a CCW polygon. */
export function rect(cx: number, cy: number, halfW: number, halfL: number): Polygon {
  return [
    { x: cx - halfW, y: cy - halfL },
    { x: cx + halfW, y: cy - halfL },
    { x: cx + halfW, y: cy + halfL },
    { x: cx - halfW, y: cy + halfL },
  ];
}

/** Even–odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function project(poly: Polygon, ax: number, ay: number): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/**
 * Separating-axis test for two convex polygons. Touching edges (overlap ≤ eps) do not count as
 * intersecting, so a footprint resting on a zone boundary is outside the zone.
 */
export function convexOverlap(a: Polygon, b: Polygon, eps = 1e-9): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Vec2;
      const q = poly[(i + 1) % poly.length] as Vec2;
      const ax = -(q.y - p.y);
      const ay = q.x - p.x;
      const [aLo, aHi] = project(a, ax, ay);
      const [bLo, bHi] = project(b, ax, ay);
      const len = Math.sqrt(ax * ax + ay * ay) || 1;
      if (Math.min(aHi, bHi) - Math.max(aLo, bLo) <= eps * len) return false;
    }
  }
  return true;
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Cumulative arc length at each vertex of a polyline. */
export function cumulativeLengths(points: readonly Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push((out[i - 1] as number) + distance(points[i - 1] as Vec2, points[i] as Vec2));
  }
  return out;
}

export interface PolylineProjection {
  distance: number;
  segment: number;
  arc: number;
}

/**
 * Nearest point on a polyline, searching segments [fromSeg, toSeg). Restricting the window lets a
 * caller follow a self-crossing path (a figure-8) without jumping to the other branch.
 */
export function projectOnPolyline(
  points: readonly Vec2[],
  cum: readonly number[],
  p: Vec2,
  fromSeg = 0,
  toSeg = points.length - 1,
): PolylineProjection {
  let best: PolylineProjection = { distance: Number.POSITIVE_INFINITY, segment: fromSeg, arc: 0 };
  const lo = Math.max(0, fromSeg);
  const hi = Math.min(points.length - 1, toSeg);
  for (let i = lo; i < hi; i++) {
    const a = points[i] as Vec2;
    const b = points[i + 1] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let u = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    u = Math.min(1, Math.max(0, u));
    const q = { x: a.x + u * dx, y: a.y + u * dy };
    const d = distance(p, q);
    if (d < best.distance) {
      best = { distance: d, segment: i, arc: (cum[i] as number) + u * Math.sqrt(len2) };
    }
  }
  return best;
}

/** Linear interpolation over keyframes sorted by `tMs`; clamps outside the range. */
export function interpolate<K extends { tMs: number }>(
  frames: readonly K[],
  tMs: number,
  pickValue: (k: K) => number,
): number {
  const first = frames[0];
  if (first === undefined) throw new RangeError("no keyframes");
  if (tMs <= first.tMs) return pickValue(first);
  for (let i = 1; i < frames.length; i++) {
    const b = frames[i] as K;
    if (tMs <= b.tMs) {
      const a = frames[i - 1] as K;
      const span = b.tMs - a.tMs;
      const u = span === 0 ? 1 : (tMs - a.tMs) / span;
      return pickValue(a) + u * (pickValue(b) - pickValue(a));
    }
  }
  return pickValue(frames[frames.length - 1] as K);
}

/** Seconds until a road user `distM` away at `speedMps` reaches the conflict point. */
export function timeToArrival(distM: number, speedMps: number): number {
  if (speedMps <= 0) return Number.POSITIVE_INFINITY;
  return distM / speedMps;
}
