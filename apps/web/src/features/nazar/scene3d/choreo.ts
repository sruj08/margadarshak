import type { PlanHazard, SceneRow } from "./types";

/**
 * Pure choreography for a Nazar 3D scene: where every road user is at media time t. No three.js, no
 * clock, no randomness, so the same t always gives the same frame (replay, tests, pause). The world
 * runs along -z; the learner's vehicle starts at z = 0 in its lane and looks down -z. x is to the
 * right, so the left kerb is negative x (India drives on the left).
 */
export type ActorKind =
  | "ped"
  | "child"
  | "cow"
  | "dog"
  | "goat"
  | "scooter"
  | "cyclist"
  | "car"
  | "auto"
  | "bus"
  | "truck"
  | "van"
  | "cart"
  | "ball"
  | "puddle"
  | "gravel";

export interface Pose {
  id: string;
  kind: ActorKind;
  x: number;
  z: number;
  yaw: number;
  /** Speed in m/s, drives walk cycles and wheel spin. */
  v: number;
  /** Door angle (rad) for a car, indicator (0/1) for a truck. */
  aux: number;
  hazard: boolean;
}

export interface Geometry {
  /** Half road width, m. */
  h: number;
  /** Learner lane centre, oncoming lane centre, left kerb. */
  L: number;
  R: number;
  K: number;
  /** Lane width, and where a vehicle crossing the road ends up (never through the median). */
  lane: number;
  cross: number;
  median: boolean;
}

export interface Gap {
  /** -1 left, +1 right; world z range (z0 > z1, ahead is smaller z). */
  side: -1 | 1;
  z0: number;
  z1: number;
}

type XZ = { x: number; z: number };
type Fn = (dt: number) => XZ;
interface Def {
  id: string;
  kind: ActorKind;
  hazard: boolean;
  fn: Fn;
  yaw?: number;
  aux?: (dt: number) => number;
  /** true: fn already gives absolute world z (ambient traffic). */
  abs?: boolean;
}
type Pt3 = readonly [number, number, number];
type Pt2 = readonly [number, number];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (v: number) => {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
};

/** Piecewise-linear path through [dt ms, x, z] points, clamped at both ends. */
const walk =
  (pts: readonly Pt3[]): Fn =>
  (dt) => {
    const first = pts[0] as Pt3;
    const last = pts[pts.length - 1] as Pt3;
    if (dt <= first[0]) return { x: first[1], z: first[2] };
    for (let i = 1; i < pts.length; i++) {
      const b = pts[i] as Pt3;
      const a = pts[i - 1] as Pt3;
      if (dt <= b[0]) {
        const k = (dt - a[0]) / (b[0] - a[0]);
        return { x: lerp(a[1], b[1], k), z: lerp(a[2], b[2], k) };
      }
    }
    return { x: last[1], z: last[2] };
  };

/** Constant forward speed vz (m/s, negative = away from the learner) with a piecewise lateral path. */
const drive =
  (xs: readonly Pt2[], z0: number, vz: number): Fn =>
  (dt) => {
    const first = xs[0] as Pt2;
    const last = xs[xs.length - 1] as Pt2;
    let x = last[1];
    if (dt <= first[0]) x = first[1];
    else
      for (let i = 1; i < xs.length; i++) {
        const b = xs[i] as Pt2;
        const a = xs[i - 1] as Pt2;
        if (dt <= b[0]) {
          x = lerp(a[1], b[1], (dt - a[0]) / (b[0] - a[0]));
          break;
        }
      }
    return { x, z: z0 + (vz * dt) / 1000 };
  };

const still =
  (x: number, z: number): Fn =>
  () => ({ x, z });
const FAR = -1e5;

/** x of something parked at the kerb: flush with it, but never closer than a metre to the learner's lane. */
const park = (g: Geometry, half: number) => Math.min(g.K + half + 0.3, g.L - half - 1);

interface Ctx {
  g: Geometry;
  v0: number;
  setting: string;
}

/** Hazard builders. dt is ms since the hazard's onset; z is relative to where the learner is at onset. */
const HAZARDS: Record<string, (c: Ctx) => Def[]> = {
  bus_stop_pedestrian: ({ g }) => {
    const bx = park(g, 1.25);
    return [
      { id: "bus", kind: "bus", hazard: false, yaw: 0, fn: still(bx, -30) },
      {
        id: "ped",
        kind: "ped",
        hazard: true,
        fn: walk([
          [FAR, bx, -37],
          [1200, bx, -37],
          [3300, g.L + 0.2, -37.6],
          [5200, g.L + 0.2, -37.6],
          [6600, bx + 1.6, -37],
        ]),
      },
    ];
  },
  door_opening: ({ g }) => [
    {
      id: "door",
      kind: "car",
      hazard: true,
      yaw: 0,
      fn: still(park(g, 0.9), -14),
      aux: (dt) => 1.15 * smooth((dt - 500) / 1500) * (1 - smooth((dt - 5500) / 1500)),
    },
    { id: "p1", kind: "car", hazard: false, yaw: 0, fn: still(park(g, 0.9), -26) },
    { id: "p2", kind: "car", hazard: false, yaw: 0, fn: still(park(g, 0.9), -38) },
  ],
  auto_cut_in: ({ g, v0 }) => [
    {
      id: "auto",
      kind: "auto",
      hazard: true,
      fn: drive(
        [
          [FAR, g.median ? g.L - g.lane : g.K + 1.2],
          [500, g.median ? g.L - g.lane : g.K + 1.2],
          [2400, g.L],
          [60000, g.L],
        ],
        -12,
        -0.85 * v0,
      ),
    },
  ],
  wrong_side_2w: ({ g }) => [
    {
      id: "rider",
      kind: "scooter",
      hazard: true,
      fn: drive(
        [
          [FAR, g.L - 1],
          [60000, g.L - 1],
        ],
        -70,
        7,
      ),
    },
  ],
  cattle_animal: ({ g, setting, v0 }) => {
    const dog = setting === "kerala_rural";
    const d = Math.max(20, v0 * 2.6);
    return [
      {
        id: "animal",
        kind: dog ? "dog" : "cow",
        hazard: true,
        fn: walk([
          [FAR, g.K + 0.6, -d],
          [dog ? 800 : 1000, g.K + 0.6, -d],
          [dog ? 3800 : 4500, g.L, -d - 0.5],
          [dog ? 6500 : 9000, g.R + 1.5, -d - 1],
        ]),
      },
      {
        id: "other",
        kind: dog ? "goat" : "cow",
        hazard: false,
        yaw: 1.2,
        fn: dog
          ? walk([
              [FAR, g.K + 0.2, -d - 2],
              [1800, g.K + 0.2, -d - 2],
              [5200, g.L, -d - 2.5],
              [8000, g.R + 1.5, -d - 3],
            ])
          : still(g.K + 0.2, -d - 7),
      },
    ];
  },
  child_school: ({ g }) => {
    const vx = park(g, 0.95);
    return [
      { id: "van1", kind: "van", hazard: false, yaw: 0, fn: still(vx, -18) },
      { id: "van2", kind: "van", hazard: false, yaw: 0, fn: still(vx, -27) },
      {
        id: "ball",
        kind: "ball",
        hazard: false,
        fn: walk([
          [FAR, vx, -22.5],
          [700, vx, -22.5],
          [2500, vx + 1.5, -22.2],
        ]),
      },
      {
        id: "child",
        kind: "child",
        hazard: true,
        fn: walk([
          [FAR, vx, -22.5],
          [1000, vx, -22.5],
          [2800, vx + 1.3, -22.3],
          [5000, vx + 1.3, -22.3],
          [6500, vx, -22.5],
        ]),
      },
    ];
  },
  pedestrian_median: ({ g, v0 }) => {
    const d = Math.max(24, v0 * 3);
    return [
      {
        id: "man",
        kind: "ped",
        hazard: true,
        fn: walk([
          [FAR, 0, -d],
          [1000, 0, -d],
          [7000, g.K - 0.3, -d],
        ]),
      },
      {
        id: "man2",
        kind: "ped",
        hazard: false,
        fn: walk([
          [FAR, 0.4, -d - 0.8],
          [1200, 0.4, -d - 0.8],
          [7200, g.K - 0.1, -d - 0.8],
        ]),
      },
    ];
  },
  vehicle_pulling_out: ({ g }) => [
    {
      id: "van",
      kind: "van",
      hazard: true,
      fn: walk([
        [FAR, g.K - 2.6, -20],
        [300, g.K - 2.6, -20],
        [1000, g.K + 0.3, -20.8],
        [3200, g.cross, -27],
        [60000, g.cross, -360],
      ]),
    },
  ],
  truck_left_turn: ({ g, v0 }) => [
    {
      id: "truck",
      kind: "truck",
      hazard: true,
      aux: (dt) => (dt > -3000 && dt < 7500 ? 1 : 0),
      fn: drive(
        [
          [FAR, g.L],
          [400, g.L],
          [1400, g.L + 1.3],
          [2400, g.L + 1.3],
          [7500, g.K - 5],
          [60000, g.K - 5],
        ],
        -14,
        -0.5 * v0,
      ),
    },
  ],
  junction_emerging: ({ g }) => [
    {
      id: "rider",
      kind: "scooter",
      hazard: true,
      fn: walk([
        [FAR, g.K - 9, -16],
        [1500, g.K - 9, -16],
        [3200, g.L - 0.4, -16.5],
        [5200, g.L, -28],
        [60000, g.L, -300],
      ]),
    },
  ],
  overtaking_oncoming: ({ g }) => [
    { id: "bus", kind: "bus", hazard: false, fn: drive([[FAR, g.R]], -65, 7) },
    {
      id: "car",
      kind: "car",
      hazard: true,
      fn: drive(
        [
          [FAR, g.R],
          [200, g.R],
          [2200, g.L + 1],
          [4300, g.L + 1],
          [6200, g.R],
          [60000, g.R],
        ],
        -79,
        9,
      ),
    },
  ],
  parked_vehicle_hidden: ({ g }) => {
    const tx = park(g, 1.25);
    return [
      { id: "truck", kind: "truck", hazard: false, yaw: 0, fn: still(tx, -16) },
      {
        id: "rider",
        kind: "scooter",
        hazard: true,
        fn: walk([
          [FAR, tx, -24],
          [1000, tx, -24],
          [3500, g.L - 0.2, -26],
          [6000, g.L, -34],
          [60000, g.L, -300],
        ]),
      },
    ];
  },
  cyclist: ({ g }) => [
    { id: "puddle", kind: "puddle", hazard: false, yaw: 0, fn: still(g.K + 1.4, -24) },
    {
      id: "bike",
      kind: "cyclist",
      hazard: true,
      fn: drive(
        [
          [FAR, g.K + 1.4],
          [300, g.K + 1.4],
          [1800, g.L + 0.5],
          [4500, g.L + 0.5],
          [6200, g.K + 1.4],
          [60000, g.K + 1.4],
        ],
        -16,
        -4.5,
      ),
    },
  ],
  surface_hazard: ({ g }) => [
    { id: "patch", kind: "gravel", hazard: true, yaw: 0, fn: still(g.L - 0.9, -30) },
  ],
  other: ({ g }) => [
    {
      id: "cart",
      kind: "cart",
      hazard: true,
      fn: walk([
        [FAR, g.K + 1, -18],
        [1000, g.K + 1, -18],
        [5200, g.cross, -18.5],
      ]),
    },
    {
      id: "vendor",
      kind: "ped",
      hazard: false,
      fn: walk([
        [FAR, g.K + 1, -16.4],
        [1000, g.K + 1, -16.4],
        [5200, g.cross, -16.9],
      ]),
    },
  ],
};

/** How far the learner eases off, and which way it moves over, per hazard (the careful response). */
const RESPONSE: Record<string, { slow: number; shiftX: number }> = {
  surface_hazard: { slow: 0.8, shiftX: 0 },
  child_school: { slow: 0.8, shiftX: 0 },
  cattle_animal: { slow: 0.8, shiftX: 0 },
  door_opening: { slow: 0.5, shiftX: 0.7 },
  wrong_side_2w: { slow: 0.6, shiftX: 0.6 },
  overtaking_oncoming: { slow: 0.6, shiftX: -0.8 },
};
const DEFAULT_RESPONSE = { slow: 0.65, shiftX: 0 };

/** Side-road gaps in the building line (z relative to the learner's position at onset). */
const GAPS: Record<string, { side: -1 | 1; a: number; b: number }> = {
  truck_left_turn: { side: -1, a: -8, b: -30 },
  junction_emerging: { side: -1, a: -9, b: -30 },
  vehicle_pulling_out: { side: -1, a: -14, b: -27 },
};

export function geometryFor(row: Pick<SceneRow, "roadType" | "setting">): Geometry {
  const wide = row.setting === "metro_arterial" || row.setting === "jk_town";
  const h = wide
    ? 7
    : ["kerala_town", "small_town_market", "school_zone"].includes(row.setting)
      ? 5.6
      : 4.2;
  if (wide) return { h, L: -1.75, R: 1.75, K: -h, lane: 3.5, cross: -1.75, median: true };
  return { h, L: -h / 2, R: h / 2, K: -h, lane: h, cross: h / 2, median: false };
}

export interface ScenePlan {
  row: SceneRow;
  hazards: PlanHazard[];
  geometry: Geometry;
  durationMs: number;
  v0: number;
  gaps: Gap[];
  egoZ(tMs: number): number;
  egoX(tMs: number): number;
  /** Learner speed (m/s) at t, for wheel and wind effects. */
  egoV(tMs: number): number;
  poses(tMs: number): Pose[];
}

/** The learner's careful response factor (1 = cruising) at t for one hazard. */
function factor(h: PlanHazard, t: number, slow: number): number {
  const down = smooth((t - h.aMs) / 1500);
  const up = smooth((t - (h.bMs + 800)) / 2700);
  return 1 - slow * down * (1 - up);
}

const DT = 50;
const AMBIENT_KINDS: ActorKind[] = ["car", "auto", "scooter", "van", "car", "bus"];

export function buildPlan(row: SceneRow, hazards: PlanHazard[]): ScenePlan {
  const geometry = geometryFor(row);
  const v0 = row.speedKmh / 3.6;
  const durationMs = row.durationMs;
  const speedAt = (t: number) => {
    let f = 1;
    for (const h of hazards)
      f = Math.min(f, factor(h, t, (RESPONSE[h.type] ?? DEFAULT_RESPONSE).slow));
    return v0 * f;
  };
  // Distance travelled is integrated into a table, so egoZ(t) is a cheap lookup per frame.
  const steps = Math.ceil(durationMs / DT) + 400;
  let zTab = new Float64Array(steps + 1);
  const integrate = (limit: ((t: number, z: number) => number) | null) => {
    const tab = new Float64Array(steps + 1);
    let prev = speedAt(0);
    for (let i = 1; i <= steps; i++) {
      const t = (i - 0.5) * DT;
      const want = limit ? Math.min(speedAt(t), limit(t, tab[i - 1] as number)) : speedAt(t);
      // Brakes at 3.5 m/s2 and pulls away at 2.0 m/s2, so a stop is a ramp, not a jump.
      prev = Math.min(prev + (2 * DT) / 1000, Math.max(prev - (3.5 * DT) / 1000, want));
      tab[i] = (tab[i - 1] as number) - (prev * DT) / 1000;
    }
    return tab;
  };
  zTab = integrate(null);
  const egoZ = (t: number) => {
    const f = Math.max(0, t) / DT;
    const i = Math.min(steps - 1, Math.floor(f));
    return lerp(zTab[i] as number, zTab[i + 1] as number, f - i);
  };
  const egoX = (t: number) => {
    let s = 0;
    for (const h of hazards) {
      const r = RESPONSE[h.type];
      if (!r) continue;
      s += r.shiftX * smooth((t - (h.aMs + 800)) / 1400) * (1 - smooth((t - (h.bMs + 600)) / 2200));
    }
    return geometry.L + s;
  };

  const defs: { def: Def; zOn: number; a: number }[] = [];
  const gaps: Gap[] = [];
  const ctx: Ctx = { g: geometry, v0, setting: row.setting };
  hazards.forEach((h, i) => {
    const make = HAZARDS[h.type];
    if (!make) return;
    const zOn = egoZ(h.aMs);
    for (const def of make(ctx))
      defs.push({ def: { ...def, id: `h${i}:${def.id}` }, zOn, a: h.aMs });
    const gp = GAPS[h.type];
    if (gp) gaps.push({ side: gp.side, z0: zOn + gp.a, z1: zOn + gp.b });
  });

  // Ambient traffic keeps its lane; the two oncoming-lane hazards own that lane, so it is left out.
  if (!hazards.some((h) => h.type === "wrong_side_2w" || h.type === "overtaking_oncoming")) {
    for (let i = 0; i < 6; i++)
      defs.push({
        zOn: 0,
        a: 0,
        def: {
          id: `amb${i}`,
          kind: AMBIENT_KINDS[i] as ActorKind,
          hazard: false,
          abs: true,
          fn: drive([[FAR, geometry.R + (i % 2 ? 0.25 : -0.25)]], -45 - i * 48, 8 + (i % 3) * 2),
        },
      });
  }
  if (hazards.length === 0)
    defs.push({
      zOn: 0,
      a: 0,
      def: {
        id: "lead",
        kind: row.pov === "2W" ? "car" : "scooter",
        hazard: false,
        abs: true,
        fn: drive([[FAR, geometry.L]], -22, -0.97 * v0),
      },
    });

  const poseOf = (e: (typeof defs)[number], t: number): Pose => {
    const dt = e.def.abs ? t : t - e.a;
    const at = (d: number) => {
      const p = e.def.fn(d);
      return { x: p.x, z: e.def.abs ? p.z : e.zOn + p.z };
    };
    const p = at(dt);
    const p1 = at(dt - 60);
    const p2 = at(dt + 60);
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const d = Math.hypot(dx, dz);
    return {
      id: e.def.id,
      kind: e.def.kind,
      x: p.x,
      z: p.z,
      yaw: d > 1e-4 ? Math.atan2(-dx, -dz) : (e.def.yaw ?? 0),
      v: d / 0.12,
      aux: e.def.aux ? e.def.aux(dt) : 0,
      hazard: e.def.hazard,
    };
  };

  const poses = (t: number) => defs.map((e) => poseOf(e, t));

  // The learner is a careful driver: it never closes on anyone in its path, it waits until they
  // are clear. The limit starts after the first onset so the staged geometry is unchanged.
  const firstA = Math.min(...hazards.map((h) => h.aMs), Number.POSITIVE_INFINITY);
  zTab = integrate((t, z) => {
    if (t < firstA + 500) return Number.POSITIVE_INFINITY;
    const x = egoX(t);
    const soon = poses(t + 2600);
    let v = Number.POSITIVE_INFINITY;
    for (const [i, p] of poses(t).entries()) {
      if (p.kind === "puddle" || p.kind === "gravel") continue;
      // In the path now, or heading into it within a few seconds (someone stepping out).
      const sx = (soon[i] as Pose).x;
      const entering = Math.abs(sx - p.x) > 0.3 && Math.abs(sx - x) < 1.1;
      if (Math.abs(p.x - x) > 1.1 && !entering) continue;
      const gap = z - p.z;
      if (gap > -2 && gap < 40) v = Math.min(v, Math.sqrt(7 * Math.max(0, gap - 9)));
    }
    return v;
  });

  return {
    row,
    hazards,
    geometry,
    durationMs,
    v0,
    gaps,
    egoZ,
    egoX,
    egoV: (t) =>
      Math.abs(egoZ(Math.max(DT, t) - DT) - egoZ(Math.max(DT, t) + DT)) / ((2 * DT) / 1000),
    poses,
  };
}
