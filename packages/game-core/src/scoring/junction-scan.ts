// G4 Junction Scan scoring (GAME_DESIGN §5.7, DEBRIEF_SPEC §2.4). 100 per item, session = mean.
// Scan completeness (30), gap acceptance (40), creep use (15), yield correctness (15). A collision,
// or GO with no look toward the threat side in the last 3 s, caps the item at 20.
// Gap, time-to-arrival and collision are derived on replay from the item's scripted traffic plus
// seeded spawn jitter; the client never reports them.
import { runIntegrityChecks } from "../integrity/checks.ts";
import type { JsItem, JunctionScanContent } from "../schema/content.ts";
import type { EventOf, GameEvent } from "../schema/events.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type { Finding, ScoreComponent, SessionResult } from "../schema/result.ts";
import { timeToArrival } from "../sim/geometry.ts";
import { randInt, subStream } from "../sim/prng.ts";
import { round2 } from "../sim/quantise.ts";
import {
  buildResult,
  component,
  finding,
  itemStartT,
  pad2,
  requireAligned,
  type ScoreOptions,
} from "./common.ts";
import { GAME_CONFIG } from "./config.ts";

const C = GAME_CONFIG.junctionScan;

type Agent = JsItem["traffic"][number];

/** Seeded spawn time (ms after item start) of one road user. */
export function jsAgentSpawnMs(seed: number, item: number, agent: Agent): number {
  return (
    agent.spawnMs +
    randInt(subStream(seed, `js:spawn:${item}:${agent.agentId}`), 0, agent.spawnJitterMs)
  );
}

export interface JunctionItemResult {
  item: number;
  went: boolean;
  scan: number;
  gap: number;
  creep: number;
  yieldPts: number;
  score: number;
  capped: boolean;
  gapS: number | null;
  collision: boolean;
  lookedRight: boolean;
  lookedLeft: boolean;
  lastLook: "right" | "left" | "none";
  noThreatLook: boolean;
  crept: boolean;
  yieldMissed: "pedestrian" | "vehicle_in_junction" | null;
  threatSide: "right" | "left";
  occluded: boolean;
}

/** Right/left looks in the 3 s before GO (inclusive), in order. */
function looksBefore(own: readonly GameEvent[], goT: number): ("right" | "left")[] {
  return own
    .filter((e): e is EventOf<"scan_look"> => e.type === "scan_look")
    .filter((e) => e.t <= goT && e.t >= goT - C.scanWindowMs)
    .map((e) => e.p.dir)
    .filter((d): d is "right" | "left" => d === "right" || d === "left");
}

/** Scan completeness: both sides and right last → 30; both → 20; one side → 10; none → 0. */
function scanPoints(looks: readonly ("right" | "left")[]): number {
  const both = looks.includes("right") && looks.includes("left");
  if (both) return looks[looks.length - 1] === "right" ? 30 : 20;
  return looks.length > 0 ? 10 : 0;
}

/** Seconds until the nearest conflicting road user reaches the conflict point at GO (null: none). */
function acceptedGap(seed: number, item: number, spec: JsItem, tGo: number): number | null {
  let gapS: number | null = null;
  for (const a of spec.traffic) {
    const spawn = jsAgentSpawnMs(seed, item, a);
    const g =
      tGo < spawn
        ? timeToArrival(a.distAtSpawnM, a.speedMps) + (spawn - tGo) / 1000
        : timeToArrival(a.distAtSpawnM - (a.speedMps * (tGo - spawn)) / 1000, a.speedMps);
    if (g < -C.agentClearS) continue; // already through the conflict point
    const gc = Math.max(0, g);
    if (gapS === null || gc < gapS) gapS = gc;
  }
  return gapS;
}

/** Gap acceptance: ≥ 4 s → 40, linear between 2 and 4 s, ≤ 2 s → 0; no traffic → 40. */
function gapPoints(gapS: number | null): number {
  if (gapS === null || gapS >= C.gapFullS) return C.gapMax;
  if (gapS <= C.gapZeroS) return 0;
  return (C.gapMax * (gapS - C.gapZeroS)) / (C.gapFullS - C.gapZeroS);
}

function yieldMissedAt(spec: JsItem, tGo: number): "pedestrian" | "vehicle_in_junction" | null {
  const inside = (w: { fromMs: number; toMs: number } | null): boolean =>
    w !== null && tGo >= w.fromMs && tGo <= w.toMs;
  if (inside(spec.pedestrianOnCrossing)) return "pedestrian";
  if (inside(spec.vehicleInJunction)) return "vehicle_in_junction";
  return null;
}

export function scoreJunctionItem(
  seed: number,
  events: readonly GameEvent[],
  item: number,
  spec: JsItem,
): JunctionItemResult {
  const t0 = itemStartT(events, item) ?? 0;
  const own = events.filter((e) => e.item === item);
  const go = own.find((e): e is EventOf<"decision"> => e.type === "decision" && e.p.node === "go");
  const base = { item, threatSide: spec.threatSide, occluded: spec.occluded };
  if (go === undefined) {
    // Never committed: nothing to score (no crossing happened).
    return {
      ...base,
      went: false,
      scan: 0,
      gap: 0,
      creep: 0,
      yieldPts: 0,
      score: 0,
      capped: false,
      gapS: null,
      collision: false,
      lookedRight: false,
      lookedLeft: false,
      lastLook: "none",
      noThreatLook: false,
      crept: false,
      yieldMissed: null,
    };
  }
  const tGo = go.t - t0;
  const looks = looksBefore(own, go.t);
  const scan = scanPoints(looks);
  const gapS = acceptedGap(seed, item, spec, tGo);
  const gap = gapPoints(gapS);
  const collision = gapS !== null && gapS < C.collisionGapS;
  const creptDm = own
    .filter((e): e is EventOf<"creep"> => e.type === "creep" && e.t <= go.t)
    .reduce((s, e) => s + e.p.distDm, 0);
  const crept = creptDm >= Math.max(1, spec.creepClearDm);
  const creep = !spec.occluded || crept ? C.creepMax : 0;
  const yieldMissed = yieldMissedAt(spec, tGo);
  const yieldPts = yieldMissed === null ? C.yieldMax : 0;
  const noThreatLook = !looks.includes(spec.threatSide);
  const capped = collision || noThreatLook;
  const total = scan + gap + creep + yieldPts;
  return {
    ...base,
    went: true,
    scan,
    gap,
    creep,
    yieldPts,
    score: capped ? Math.min(C.criticalCap, total) : total,
    capped: capped && total > C.criticalCap,
    gapS: gapS === null ? null : round2(gapS),
    collision,
    lookedRight: looks.includes("right"),
    lookedLeft: looks.includes("left"),
    lastLook: looks[looks.length - 1] ?? "none",
    noThreatLook,
    crept,
    yieldMissed,
  };
}

export function scoreJunctionScan(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: JunctionScanContent,
  opts: ScoreOptions,
): SessionResult {
  requireAligned(ctx, content.items.length, "junction_scan");
  const integrity = runIntegrityChecks(ctx, events, {
    maxEvents: opts.maxEvents ?? GAME_CONFIG.budgets.junction_scan.maxEvents,
    defaultTimingMode: "sim",
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
  });
  const items = content.items
    .map((spec, item) =>
      integrity.voidedItems.has(item) ? null : scoreJunctionItem(ctx.seed, events, item, spec),
    )
    .filter((x): x is JunctionItemResult => x !== null);
  const n = items.length;
  // Session = mean of item scores: each item contributes score/n out of 100/n.
  const components: ScoreComponent[] = items.map((r) =>
    component(`item_${pad2(r.item + 1)}`, r.score / n, 100 / n, "junction.item_score"),
  );
  return buildResult(ctx, opts, {
    components,
    passed: null,
    passRule: null,
    capApplied: items.some((r) => r.capped) ? `critical_fault_cap_${C.criticalCap}` : null,
    findings: jsFindings(ctx, items),
    evidence: [],
    calibration: null,
    integrity,
  });
}

function jsFindings(ctx: SessionContext, items: readonly JunctionItemResult[]): Finding[] {
  const out: Finding[] = [];
  const ref = (item: number): string | undefined => ctx.items[item]?.ref;
  const went = items.filter((r) => r.went);
  const rules = ["RR-JCT-001"];

  // A collision is an accepted gap under collisionGapS, so its gap is always known.
  const col = went
    .filter((r): r is JunctionItemResult & { gapS: number } => r.collision && r.gapS !== null)
    .sort((a, b) => a.gapS - b.gapS || a.item - b.item)[0];
  if (col !== undefined) {
    out.push(
      finding({
        findingId: "JS_COLLISION",
        severity: 1,
        critical: true,
        skillId: "SK-M6",
        ruleIds: rules,
        drillIds: ["DR-JS-SCAN"],
        facts: { threat_side: col.threatSide, gap_s: col.gapS },
        itemRef: ref(col.item),
      }),
    );
  }
  const blind = went.find((r) => r.noThreatLook);
  if (blind !== undefined) {
    out.push(
      finding({
        findingId: "JS_NO_SCAN_THREAT_SIDE",
        severity: 0.95,
        critical: true,
        skillId: "SK-M6",
        ruleIds: rules,
        drillIds: ["DR-JS-SCAN"],
        facts: { threat_side: blind.threatSide, last_look: blind.lastLook },
        itemRef: ref(blind.item),
      }),
    );
  }
  const notRightLast = went.find((r) => r.lookedLeft && r.lookedRight && r.lastLook !== "right");
  if (notRightLast !== undefined) {
    out.push(
      finding({
        findingId: "JS_NOT_RIGHT_LAST",
        severity: 0.5,
        skillId: "SK-M6",
        ruleIds: rules,
        drillIds: ["DR-JS-SCAN"],
        facts: { last_look: notRightLast.lastLook },
        itemRef: ref(notRightLast.item),
      }),
    );
  }
  const short = went
    .filter(
      (r): r is JunctionItemResult & { gapS: number } => r.gapS !== null && r.gapS < C.gapFullS,
    )
    .sort((a, b) => a.gapS - b.gapS || a.item - b.item)[0];
  if (short !== undefined) {
    out.push(
      finding({
        findingId: "JS_SHORT_GAP",
        severity: Math.min(1, (C.gapFullS - short.gapS) / 2),
        skillId: "SK-M6",
        ruleIds: rules,
        drillIds: ["DR-JS-GAP"],
        facts: { gap_s: short.gapS },
        itemRef: ref(short.item),
      }),
    );
  }
  const noCreep = went.find((r) => r.occluded && !r.crept);
  if (noCreep !== undefined) {
    out.push(
      finding({
        findingId: "JS_NO_CREEP",
        severity: 0.6,
        skillId: "SK-M6",
        ruleIds: rules,
        drillIds: ["DR-JS-CREEP"],
        facts: { occluded: true },
        itemRef: ref(noCreep.item),
      }),
    );
  }
  const noYield = went.find((r) => r.yieldMissed !== null);
  if (noYield !== undefined && noYield.yieldMissed !== null) {
    out.push(
      finding({
        findingId: "JS_YIELD_MISSED",
        severity: 0.8,
        skillId: "SK-M18",
        ruleIds: ["RR-JCT-002", "RR-PED-001"],
        drillIds: ["DR-JS-YIELD"],
        facts: { yield_missed: noYield.yieldMissed },
        itemRef: ref(noYield.item),
      }),
    );
  }
  return out;
}
