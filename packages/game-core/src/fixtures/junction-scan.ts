// Junction Scan golden vectors: a T-junction with a parked bus (occluded), an empty T and a T with a
// pedestrian on the crossing. Threat side is the right (traffic keeps left in India).
import type { JsItem, JunctionScanContent } from "../schema/content.ts";
import { jsAgentSpawnMs } from "../scoring/junction-scan.ts";
import { ctxFor, StreamBuilder, type VectorInput, vector } from "./builders.ts";

export const JS_T_BUS: JsItem = {
  junction: "T",
  threatSide: "right",
  occluded: true,
  creepClearDm: 15,
  traffic: [
    {
      agentId: "car1",
      kind: "car",
      side: "right",
      spawnMs: 0,
      spawnJitterMs: 2000,
      distAtSpawnM: 70,
      speedMps: 10,
    },
    {
      agentId: "tw1",
      kind: "two_wheeler",
      side: "left",
      spawnMs: 3000,
      spawnJitterMs: 1000,
      distAtSpawnM: 60,
      speedMps: 8,
    },
  ],
  pedestrianOnCrossing: null,
  vehicleInJunction: null,
};

export const JS_T_CLEAR: JsItem = {
  junction: "T",
  threatSide: "right",
  occluded: false,
  creepClearDm: 0,
  traffic: [],
  pedestrianOnCrossing: null,
  vehicleInJunction: null,
};

export const JS_T_PED: JsItem = {
  junction: "T",
  threatSide: "right",
  occluded: false,
  creepClearDm: 0,
  traffic: [
    {
      agentId: "car1",
      kind: "car",
      side: "right",
      spawnMs: 12000,
      spawnJitterMs: 0,
      distAtSpawnM: 80,
      speedMps: 10,
    },
  ],
  pedestrianOnCrossing: { fromMs: 4000, toMs: 9000 },
  vehicleInJunction: null,
};

const ITEMS: Record<string, JsItem> = {
  "js:t-bus": JS_T_BUS,
  "js:t-clear": JS_T_CLEAR,
  "js:t-ped": JS_T_PED,
};

interface ItemPlay {
  ref: keyof typeof ITEMS & string;
  /** GO time (ms after item start); null = never commits. */
  go: (seed: number, item: number, spec: JsItem) => number | null;
  /** Looks as [direction, ms before GO]. */
  looks: ["right" | "left" | "ahead", number][];
  creepDm: number[];
}

/** Arrival (ms after item start) of an agent, with its seeded jitter. */
function arrival(seed: number, item: number, spec: JsItem, agentId: string): number {
  const a = spec.traffic.find((x) => x.agentId === agentId);
  if (a === undefined) throw new Error(`no agent ${agentId}`);
  return jsAgentSpawnMs(seed, item, a) + (a.distAtSpawnM / a.speedMps) * 1000;
}

/** GO so that `agentId` is `gapS` seconds from the conflict point. */
const goAtGap =
  (agentId: string, gapS: number) =>
  (seed: number, item: number, spec: JsItem): number =>
    Math.round(arrival(seed, item, spec, agentId) - gapS * 1000);

/** GO 1.5 s after the last agent has passed the conflict point. */
const goAfterAll = (seed: number, item: number, spec: JsItem): number =>
  Math.round(Math.max(...spec.traffic.map((a) => arrival(seed, item, spec, a.agentId))) + 1500);

function session(n: number, seed: number, plays: readonly ItemPlay[]) {
  const ctx = ctxFor({
    n,
    gameId: "junction_scan",
    mode: "practice",
    seed,
    items: plays.map((p) => ({ ref: p.ref, contentVersion: "1" })),
  });
  const s = new StreamBuilder(ctx.sid);
  s.push(
    "session_start",
    { deviceClass: "mid", timingMode: "sim", a11yModes: ["tap_only"], orientation: "landscape" },
    { t: 0 },
  );
  let t0 = 1000;
  plays.forEach((p, item) => {
    const spec = ITEMS[p.ref] as JsItem;
    s.push("item_start", { ref: p.ref }, { t: t0, item });
    const go = p.go(seed, item, spec);
    const goAbs = go === null ? t0 + 15000 : t0 + go;
    for (const [dir, before] of p.looks)
      s.push("scan_look", { dir, durMs: 400 }, { t: goAbs - before, item });
    p.creepDm.forEach((d, k) => {
      s.push("creep", { distDm: d }, { t: goAbs - 3500 + 300 * k, item });
    });
    if (go !== null) s.push("decision", { node: "go", choice: "go" }, { t: goAbs, item });
    const end = goAbs + 2000;
    s.push("item_end", { ref: p.ref, reason: go === null ? "timeout" : "done" }, { t: end, item });
    t0 = end + 1000;
  });
  s.push("session_end", { reason: "completed" }, { t: t0 });
  const content: JunctionScanContent = {
    gameId: "junction_scan",
    items: plays.map((p) => ITEMS[p.ref] as JsItem),
  };
  return { ctx, events: s.build(), content };
}

const RLR: ItemPlay["looks"] = [
  ["right", 2800],
  ["left", 1800],
  ["right", 600],
];

export function junctionScanVectors(): VectorInput[] {
  return [
    vector({
      name: "js-strong",
      description: "Right–left–right, creeps past the bus, goes after the traffic has passed: 100",
      tags: ["strong"],
      ...session(401, 8001, [
        { ref: "js:t-bus", go: goAfterAll, looks: RLR, creepDm: [10, 10] },
        { ref: "js:t-clear", go: () => 6000, looks: RLR, creepDm: [] },
      ]),
    }),
    vector({
      name: "js-medium",
      description:
        "Looks left last (20), accepts a 3 s gap (20); second item looks right only (10)",
      tags: ["medium"],
      ...session(402, 8002, [
        {
          ref: "js:t-bus",
          go: goAtGap("car1", 3),
          looks: [
            ["left", 2600],
            ["right", 1700],
            ["left", 700],
          ],
          creepDm: [8, 8],
        },
        { ref: "js:t-clear", go: () => 5000, looks: [["right", 900]], creepDm: [] },
      ]),
    }),
    vector({
      name: "js-weak",
      description:
        "Right only, no creep past the bus, 2.5 s gap; then goes while a pedestrian is on the crossing",
      tags: ["weak"],
      ...session(403, 8003, [
        { ref: "js:t-bus", go: goAtGap("car1", 2.5), looks: [["right", 1200]], creepDm: [] },
        { ref: "js:t-ped", go: () => 6000, looks: RLR, creepDm: [] },
      ]),
    }),
    vector({
      name: "js-critical",
      description:
        "Goes with a 0.6 s gap (collision, cap 20); second item never looks right (threat side, cap 20)",
      tags: ["critical"],
      ...session(404, 8004, [
        { ref: "js:t-bus", go: goAtGap("car1", 0.6), looks: RLR, creepDm: [10, 10] },
        { ref: "js:t-clear", go: () => 5000, looks: [["left", 800]], creepDm: [] },
      ]),
    }),
    vector({
      name: "js-edge",
      description:
        "First item never commits (0); second item looks exactly 3.000 s before GO (counted) and 3.001 s (not)",
      tags: ["edge"],
      ...session(405, 8005, [
        { ref: "js:t-bus", go: () => null, looks: [["right", 1000]], creepDm: [] },
        {
          ref: "js:t-clear",
          go: () => 8000,
          // Only the right look at exactly 3.000 s counts: scan 10 proves both window edges.
          looks: [
            ["left", 3001],
            ["right", 3000],
          ],
          creepDm: [],
        },
      ]),
    }),
  ];
}
