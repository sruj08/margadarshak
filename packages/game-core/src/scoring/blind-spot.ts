// G3 Blind Spot scoring (GAME_DESIGN §4.7, DEBRIEF_SPEC §2.3).
// Part A: 5 placement probes × 6 points (a probe is correct when the bike's footprint does not
// intersect any no-zone or the vehicle body). Part B: time in a no-zone (30), mirror checks before
// lane changes (15) and holding back at left turns (25), all derived on replay from lane_pos samples
// against the scripted truck. Overtaking on the left while the truck indicates left is a critical
// fault: Part B scores 0 and BS_LEFT_OVERTAKE ranks first.
//
// Frames. Vehicle frame: origin at the vehicle's front-centre, x to the vehicle's right, y forward;
// the body spans x ∈ [−w/2, w/2], y ∈ [−L, 0]. Road frame (Part B): lateral metres from the road's
// left edge (increasing to the right), progress metres along the road; the truck heads along +y.
import { runIntegrityChecks } from "../integrity/checks.ts";
import type { BlindSpotContent, BsItem, ProbePrompt, VehicleType } from "../schema/content.ts";
import type { EventOf, GameEvent } from "../schema/events.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type { Finding, ScoreComponent, SessionResult } from "../schema/result.ts";
import { degToRad } from "../sim/dmath.ts";
import { convexOverlap, interpolate, type Polygon, rect, rotate } from "../sim/geometry.ts";
import { pick, subStream } from "../sim/prng.ts";
import { round1 } from "../sim/quantise.ts";
import {
  buildResult,
  component,
  finding,
  itemStartT,
  requireAligned,
  type ScoreOptions,
} from "./common.ts";
import { GAME_CONFIG, type VehicleGeometry } from "./config.ts";

const C = GAME_CONFIG.blindSpot;

type PartA = Extract<BsItem, { part: "A" }>;
type PartB = Extract<BsItem, { part: "B" }>;

/** Body and the four no-zones of a vehicle type, in the vehicle frame. */
export function vehicleZones(type: VehicleType): { body: Polygon; zones: Polygon[] } {
  const g: VehicleGeometry = C.vehicles[type];
  const hw = g.widthM / 2;
  const box = (x0: number, x1: number, y0: number, y1: number): Polygon =>
    rect((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2);
  return {
    body: box(-hw, hw, -g.lengthM, 0),
    zones: [
      box(-hw - 0.5, hw + 0.5, 0, g.frontZoneM), // front
      box(-hw, hw, -g.lengthM - g.rearZoneM, -g.lengthM), // rear
      box(-hw - g.leftZoneWidthM, -hw, -g.lengthM, g.leftZoneAheadM), // left (passenger side)
      box(hw, hw + g.rightZoneWidthM, -g.rightZoneToM, -g.rightZoneFromM), // right (driver side)
    ],
  };
}

const footprint = (x: number, y: number): Polygon =>
  rect(x, y, C.bikeHalfWidthM, C.bikeHalfLengthM);

/** Seeded orientation (degrees) of the vehicle in a Part A item. */
export function bsOrientationDeg(seed: number, item: number, spec: PartA): number {
  return pick(subStream(seed, `bs:orientation:${item}`), spec.orientationsDeg);
}

interface ProbeResult {
  prompt: ProbePrompt;
  correct: boolean;
}

function scorePartA(
  ctx: SessionContext,
  events: readonly GameEvent[],
  item: number,
  spec: PartA,
): ProbeResult[] {
  const theta = degToRad(bsOrientationDeg(ctx.seed, item, spec));
  const { body, zones } = vehicleZones(spec.vehicleType);
  const places = events.filter((e): e is EventOf<"place"> => e.type === "place" && e.item === item);
  return spec.probes.map((prompt, k) => {
    const pl = places[k];
    if (pl === undefined) return { prompt, correct: false };
    // Probe in decimetres, world frame centred on the vehicle front; rotate into the vehicle frame.
    const local = rotate({ x: pl.p.zoneProbe.x / 10, y: pl.p.zoneProbe.y / 10 }, -theta);
    const fp = footprint(local.x, local.y);
    const hit = convexOverlap(fp, body) || zones.some((z) => convexOverlap(fp, z));
    return { prompt, correct: !hit };
  });
}

interface RideResult {
  rideMs: number;
  zoneMs: number;
  laneChanges: number;
  mirroredChanges: number;
  leftTurnEvents: number;
  heldBack: number;
  leftOvertake: boolean;
}

interface Sample {
  t: number;
  lat: number;
  prog: number;
}

/** The scripted truck of a Part B item: presence and rider position in the vehicle frame. */
function truckFrame(spec: PartB) {
  const kf = spec.truck.keyframes;
  return {
    present: (t: number): boolean => spec.truck.exitMs === null || t <= spec.truck.exitMs,
    local: (s: Sample): { x: number; y: number } => ({
      x: s.lat - interpolate(kf, s.t, (k) => k.lateralM),
      y: s.prog - interpolate(kf, s.t, (k) => k.progressM),
    }),
  };
}

/** Riding time and time with the bike's footprint in a no-zone (or on the body) while present. */
function zoneTime(samples: readonly Sample[], spec: PartB): { rideMs: number; zoneMs: number } {
  const { body, zones } = vehicleZones(spec.vehicleType);
  const truck = truckFrame(spec);
  let rideMs = 0;
  let zoneMs = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const s = samples[i] as Sample;
    const dt = Math.min((samples[i + 1] as Sample).t - s.t, C.sampleGapCapMs);
    rideMs += dt;
    if (!truck.present(s.t)) continue;
    const p = truck.local(s);
    const fp = footprint(p.x, p.y);
    if (convexOverlap(fp, body) || zones.some((z) => convexOverlap(fp, z))) zoneMs += dt;
  }
  return { rideMs, zoneMs };
}

/** Lane-third changes and how many had a mirror check in the 3 s before. */
function laneChanges(samples: readonly Sample[], mirrors: readonly number[], spec: PartB) {
  const third = (lat: number): number =>
    Math.min(2, Math.max(0, Math.floor((lat - spec.riderLaneLeftM) / (spec.laneWidthM / 3))));
  let changes = 0;
  let mirrored = 0;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i] as Sample;
    if (third((samples[i - 1] as Sample).lat) === third(s.lat)) continue;
    changes += 1;
    if (mirrors.some((m) => m >= s.t - C.mirrorWindowMs && m <= s.t)) mirrored += 1;
  }
  return { changes, mirrored };
}

/** Left-indicator events held back behind the rear axle line, and any pass on the left. */
function leftTurns(
  samples: readonly Sample[],
  spec: PartB,
): { heldBack: number; leftOvertake: boolean } {
  const g = C.vehicles[spec.vehicleType];
  const truck = truckFrame(spec);
  const axleY = -g.rearAxleFromFrontM;
  let heldBack = 0;
  let leftOvertake = false;
  for (const ev of spec.indicateLeft) {
    const during = samples.filter((s) => s.t >= ev.fromMs && s.t <= ev.toMs && truck.present(s.t));
    const ahead = during.map((s) => truck.local(s)).filter((p) => p.y + C.bikeHalfLengthM > axleY);
    if (ahead.length === 0) heldBack += 1;
    // Ahead of the rear axle and entirely to the truck's left: passing on the left.
    if (ahead.some((p) => p.x + C.bikeHalfWidthM <= -g.widthM / 2)) leftOvertake = true;
  }
  return { heldBack, leftOvertake };
}

function scorePartB(events: readonly GameEvent[], item: number, spec: PartB): RideResult {
  const t0 = itemStartT(events, item) ?? 0;
  const samples: Sample[] = events
    .filter((e): e is EventOf<"lane_pos"> => e.type === "lane_pos" && e.item === item)
    .map((e) => ({ t: e.t - t0, lat: e.p.lateralCm / 100, prog: e.p.progressDm / 10 }));
  const mirrors = events
    .filter((e) => e.type === "mirror_check" && e.item === item)
    .map((e) => e.t - t0);
  const { rideMs, zoneMs } = zoneTime(samples, spec);
  const lane = laneChanges(samples, mirrors, spec);
  const turns = leftTurns(samples, spec);
  return {
    rideMs,
    zoneMs,
    laneChanges: lane.changes,
    mirroredChanges: lane.mirrored,
    leftTurnEvents: spec.indicateLeft.length,
    heldBack: turns.heldBack,
    leftOvertake: turns.leftOvertake,
  };
}

export function scoreBlindSpot(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: BlindSpotContent,
  opts: ScoreOptions,
): SessionResult {
  requireAligned(ctx, content.items.length, "blind_spot");
  const integrity = runIntegrityChecks(ctx, events, {
    maxEvents: opts.maxEvents ?? GAME_CONFIG.budgets.blind_spot.maxEvents,
    defaultTimingMode: "sim",
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
  });

  const probes: { item: number; vehicle: VehicleType; r: ProbeResult }[] = [];
  const rides: { item: number; vehicle: VehicleType; r: RideResult }[] = [];
  content.items.forEach((spec, item) => {
    if (integrity.voidedItems.has(item)) return;
    if (spec.part === "A") {
      for (const r of scorePartA(ctx, events, item, spec))
        probes.push({ item, vehicle: spec.vehicleType, r });
    } else {
      rides.push({ item, vehicle: spec.vehicleType, r: scorePartB(events, item, spec) });
    }
  });

  const components: ScoreComponent[] = [];
  if (probes.length > 0) {
    const correct = probes.filter((p) => p.r.correct).length;
    // Placement is out of 30 for the canonical 5 probes; scale when a level asks for a different count.
    components.push(
      component(
        "placement",
        (C.placementMax * correct) / probes.length,
        C.placementMax,
        "blind_spot.placement",
      ),
    );
  }
  const leftOvertake = rides.some((r) => r.r.leftOvertake);
  if (rides.length > 0) {
    const ride = rides.reduce((s, r) => s + r.r.rideMs, 0);
    const zone = rides.reduce((s, r) => s + r.r.zoneMs, 0);
    const share = ride > 0 ? zone / ride : 0;
    const changes = rides.reduce((s, r) => s + r.r.laneChanges, 0);
    const mirrored = rides.reduce((s, r) => s + r.r.mirroredChanges, 0);
    const turns = rides.reduce((s, r) => s + r.r.leftTurnEvents, 0);
    const held = rides.reduce((s, r) => s + r.r.heldBack, 0);
    const k = leftOvertake ? 0 : 1; // critical fault: Part B scores 0
    components.push(
      component(
        "no_zone_time",
        k * C.noZoneMax * Math.max(0, 1 - share / C.noZoneShareZero),
        C.noZoneMax,
        "blind_spot.no_zone_time",
      ),
      component(
        "mirror_checks",
        k * (changes === 0 ? C.mirrorMax : (C.mirrorMax * mirrored) / changes),
        C.mirrorMax,
        "blind_spot.mirror_checks",
      ),
      component(
        "hold_back",
        k * (turns === 0 ? C.holdBackMax : (C.holdBackMax * held) / turns),
        C.holdBackMax,
        "blind_spot.hold_back",
      ),
    );
  }

  return buildResult(ctx, opts, {
    components,
    passed: null,
    passRule: null,
    capApplied: leftOvertake ? "critical_left_overtake_part_b_0" : null,
    findings: bsFindings(ctx, probes, rides),
    evidence: [],
    calibration: null,
    integrity,
  });
}

function bsFindings(
  ctx: SessionContext,
  probes: readonly { item: number; vehicle: VehicleType; r: ProbeResult }[],
  rides: readonly { item: number; vehicle: VehicleType; r: RideResult }[],
): Finding[] {
  const out: Finding[] = [];
  const ref = (item: number): string | undefined => ctx.items[item]?.ref;

  const overtake = rides.find((r) => r.r.leftOvertake);
  if (overtake !== undefined) {
    out.push(
      finding({
        findingId: "BS_LEFT_OVERTAKE",
        severity: 1,
        critical: true,
        skillId: "SK-M5",
        ruleIds: ["RR-HVY-003", "RR-HVY-002"],
        drillIds: ["DR-BS-RIDE-LEFTTURN"],
        facts: { vehicle_type: overtake.vehicle, truck_signal: "left" },
        itemRef: ref(overtake.item),
      }),
    );
  }

  if (rides.length > 0) {
    const ride = rides.reduce((s, r) => s + r.r.rideMs, 0);
    const zone = rides.reduce((s, r) => s + r.r.zoneMs, 0);
    const sharePct = ride > 0 ? round1((100 * zone) / ride) : 0;
    const worst = [...rides].sort(
      (a, b) => b.r.zoneMs - a.r.zoneMs || a.item - b.item,
    )[0] as (typeof rides)[0];
    if (sharePct >= C.noZoneFindingPct) {
      out.push(
        finding({
          findingId: "BS_NOZONE_TIME",
          severity: Math.min(1, sharePct / 25),
          skillId: "SK-M4",
          ruleIds: ["RR-HVY-001"],
          drillIds: ["DR-BS-RIDE"],
          facts: { share_pct: sharePct, vehicle_type: worst.vehicle },
          itemRef: ref(worst.item),
        }),
      );
    }
    const changes = rides.reduce((s, r) => s + r.r.laneChanges, 0);
    const mirrored = rides.reduce((s, r) => s + r.r.mirroredChanges, 0);
    const mirrorPct = changes === 0 ? 100 : round1((100 * mirrored) / changes);
    if (changes >= C.mirrorFindingMinChanges && mirrorPct < C.mirrorFindingPct) {
      out.push(
        finding({
          findingId: "BS_NO_MIRROR_CHECK",
          severity: 1 - mirrorPct / 100,
          skillId: "SK-M4",
          ruleIds: ["RR-HVY-001"],
          drillIds: ["DR-BS-MIRROR"],
          facts: { mirror_before_pct: mirrorPct, lane_changes: changes },
        }),
      );
    }
    const turns = rides.reduce((s, r) => s + r.r.leftTurnEvents, 0);
    const held = rides.reduce((s, r) => s + r.r.heldBack, 0);
    if (turns > held && overtake === undefined) {
      out.push(
        finding({
          findingId: "BS_NO_HOLD_BACK",
          severity: 0.7,
          skillId: "SK-M4",
          ruleIds: ["RR-HVY-003"],
          drillIds: ["DR-BS-RIDE-LEFTTURN"],
          facts: { left_turn_events: turns, held_back: held },
        }),
      );
    }
  }

  const wrong = probes.filter((p) => !p.r.correct);
  const firstWrong = wrong[0];
  if (firstWrong !== undefined) {
    out.push(
      finding({
        findingId: "BS_PLACEMENT_WRONG",
        severity: 0.2 * wrong.length,
        skillId: "SK-M4",
        ruleIds: ["RR-HVY-001"],
        drillIds: ["DR-BS-PLACE"],
        facts: { probes_wrong: wrong.length, probe_label: firstWrong.r.prompt },
        itemRef: ref(firstWrong.item),
      }),
    );
  }
  return out;
}
