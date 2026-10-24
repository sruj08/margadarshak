// Blind Spot golden vectors: Part A placement (5 probes) and a Part B highway ride.
// Road layout for Part B: the truck rides the left lane (front-centre 2.0 m from the left edge);
// the rider's lane is [3.5 m, 7.0 m]; lane thirds are 1.17 m wide.
import type { BlindSpotContent, BsItem, ProbePrompt } from "../schema/content.ts";
import { bsOrientationDeg } from "../scoring/blind-spot.ts";
import { degToRad } from "../sim/dmath.ts";
import { rotate } from "../sim/geometry.ts";
import { ctxFor, StreamBuilder, type VectorInput, vector } from "./builders.ts";

type PartA = Extract<BsItem, { part: "A" }>;
type PartB = Extract<BsItem, { part: "B" }>;

export const BS_PART_A: PartA = {
  part: "A",
  vehicleType: "truck",
  orientationsDeg: [0, 90, 180, 270],
  probes: [
    "wait_behind_at_light",
    "truck_about_to_turn_left",
    "beside_in_slow_traffic",
    "about_to_overtake",
    "stopped_ahead_of_truck",
  ],
};

export const BS_PART_A_BUS: PartA = { ...BS_PART_A, vehicleType: "bus" };

const TRUCK_SPEED = 8; // m/s, scripted
export const BS_PART_B: PartB = {
  part: "B",
  vehicleType: "truck",
  durationMs: 20000,
  laneWidthM: 3.5,
  riderLaneLeftM: 3.5,
  truck: {
    keyframes: [
      { tMs: 0, progressM: 30, lateralM: 2 },
      { tMs: 20000, progressM: 30 + TRUCK_SPEED * 20, lateralM: 2 },
    ],
    exitMs: 15000,
  },
  indicateLeft: [{ fromMs: 10000, toMs: 15000 }],
};

/** Safe local positions (vehicle frame, m) per prompt for a truck, and typical wrong ones. */
const SAFE: Record<ProbePrompt, [number, number]> = {
  wait_behind_at_light: [0, -21.5],
  truck_about_to_turn_left: [0.5, -22],
  beside_in_slow_traffic: [4.2, -5],
  about_to_overtake: [4.2, -12],
  stopped_ahead_of_truck: [0, 5.5],
};
const WRONG: Record<ProbePrompt, [number, number]> = {
  wait_behind_at_light: [0, -12],
  truck_about_to_turn_left: [-3, -5],
  beside_in_slow_traffic: [-2.5, -6],
  about_to_overtake: [2, -6],
  stopped_ahead_of_truck: [0, 1.5],
};

/** World-frame probe in decimetres for a local position, given the seeded orientation. */
function probe(local: [number, number], thetaDeg: number): { x: number; y: number } {
  const w = rotate({ x: local[0], y: local[1] }, degToRad(thetaDeg));
  return { x: Math.round(w.x * 10), y: Math.round(w.y * 10) };
}

interface RidePlan {
  /** Rider lateral position (m) and gap behind the truck front (m) at time t (ms). */
  at: (tMs: number) => { lat: number; behind: number };
  mirrors: number[];
}

function session(
  n: number,
  seed: number,
  items: { ref: string; spec: BsItem; wrong?: ProbePrompt[]; ride?: RidePlan }[],
) {
  const ctx = ctxFor({
    n,
    gameId: "blind_spot",
    mode: "practice",
    seed,
    items: items.map((i) => ({ ref: i.ref, contentVersion: "1" })),
  });
  const s = new StreamBuilder(ctx.sid);
  s.push(
    "session_start",
    { deviceClass: "high", timingMode: "sim", a11yModes: [], orientation: "landscape" },
    { t: 0 },
  );
  let t = 1000;
  items.forEach((it, item) => {
    s.push("item_start", { ref: it.ref }, { t, item });
    const spec = it.spec;
    if (spec.part === "A") {
      const theta = bsOrientationDeg(seed, item, spec);
      spec.probes.forEach((prompt, k) => {
        const local = it.wrong?.includes(prompt) === true ? WRONG[prompt] : SAFE[prompt];
        s.push("place", { zoneProbe: probe(local, theta) }, { t: t + 3000 * (k + 1), item });
      });
      t += 3000 * (spec.probes.length + 1);
    } else {
      const plan = it.ride as RidePlan;
      for (let ms = 0; ms <= spec.durationMs; ms += 100) {
        const { lat, behind } = plan.at(ms);
        const truckFront = (spec.truck.keyframes[0]?.progressM ?? 0) + (TRUCK_SPEED * ms) / 1000;
        s.push(
          "lane_pos",
          { lateralCm: Math.round(lat * 100), progressDm: Math.round((truckFront - behind) * 10) },
          { t: t + ms, item },
        );
      }
      for (const m of plan.mirrors) s.push("mirror_check", { target: "truck" }, { t: t + m, item });
      t += spec.durationMs + 100;
    }
    s.push("item_end", { ref: it.ref, reason: "done" }, { t, item });
    t += 1000;
  });
  s.push("session_end", { reason: "completed" }, { t });
  const content: BlindSpotContent = { gameId: "blind_spot", items: items.map((i) => i.spec) };
  return { ctx, events: s.build(), content };
}

/** Linear move from a to b over [t0, t0 + dur] ms (keeps lateral and progress rates plausible). */
const lerp = (t: number, t0: number, dur: number, a: number, b: number): number =>
  t <= t0 ? a : t >= t0 + dur ? b : a + ((b - a) * (t - t0)) / dur;

export function blindSpotVectors(): VectorInput[] {
  const A = { ref: "bs:part-a-truck", spec: BS_PART_A };
  const B = { ref: "bs:part-b-highway", spec: BS_PART_B };
  return [
    vector({
      name: "bs-strong",
      description:
        "All 5 probes outside the no-zones; rides 25 m back, mirror-checks before both lane changes, holds back",
      tags: ["strong"],
      ...session(301, 7001, [
        A,
        {
          ...B,
          ride: {
            at: (t) => ({
              lat: t < 12000 ? lerp(t, 6000, 1000, 5.25, 6.4) : lerp(t, 12000, 1000, 6.4, 5.25),
              behind: 25,
            }),
            mirrors: [5000, 11200],
          },
        },
      ]),
    }),
    vector({
      name: "bs-medium",
      description:
        "4/5 probes; closes up in the truck's right-side blind zone for about 3 s without mirror checks",
      tags: ["medium"],
      ...session(302, 7002, [
        { ...A, wrong: ["about_to_overtake"] },
        {
          ...B,
          ride: {
            at: (t) =>
              t < 5000
                ? { lat: lerp(t, 1500, 1000, 5.25, 4.3), behind: lerp(t, 1500, 1000, 25, 6) }
                : { lat: lerp(t, 5000, 1000, 4.3, 5.25), behind: lerp(t, 5000, 1000, 6, 25) },
            mirrors: [],
          },
        },
      ]),
    }),
    vector({
      name: "bs-weak",
      description:
        "3 probes wrong; lingers in the right-side no-zone, weaves without mirror checks, does not hold back",
      tags: ["weak"],
      ...session(303, 7003, [
        {
          ...A,
          wrong: ["wait_behind_at_light", "truck_about_to_turn_left", "beside_in_slow_traffic"],
        },
        {
          ...B,
          ride: {
            at: (t) => {
              if (t < 6000)
                return { lat: lerp(t, 2000, 1000, 5.25, 4.2), behind: lerp(t, 2000, 1000, 25, 6) };
              if (t < 7000) return { lat: 4.9, behind: 6 };
              if (t < 9000) return { lat: 4.2, behind: 6 };
              return { lat: 4.5, behind: 7 };
            },
            mirrors: [],
          },
        },
      ]),
    }),
    vector({
      name: "bs-left-overtake",
      description:
        "Overtakes on the left while the truck indicates left: critical, Part B scores 0, BS_LEFT_OVERTAKE first",
      tags: ["critical"],
      ...session(304, 7004, [
        A,
        {
          ...B,
          ride: {
            at: (t) => ({
              lat: lerp(t, 8000, 2000, 5.25, 0.3),
              behind: lerp(t, 8000, 3000, 25, 4),
            }),
            mirrors: [7500],
          },
        },
      ]),
    }),
    vector({
      name: "bs-edge-bus-placement",
      description:
        "Part A only, a bus at a seeded orientation, one probe wrong; Part B components are absent",
      tags: ["edge"],
      ...session(305, 7005, [
        { ref: "bs:part-a-bus", spec: BS_PART_A_BUS, wrong: ["stopped_ahead_of_truck"] },
      ]),
    }),
  ];
}
