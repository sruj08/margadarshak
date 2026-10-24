/**
 * Blind Spot Part B, the ride (GAME_DESIGN §4.3, §4.7). Pure logic over game-core: no Phaser, no
 * React, no DOM. The Phaser scene and the DOM decision version both drive this controller and only
 * draw its snapshot.
 *
 * Time. The scripted truck is placed from the time since `item_start`, read from the same clock as
 * the event recorder, because the scorer places it from each `lane_pos` event's `t`. The rider moves
 * in fixed 60 Hz steps (game-core `createFixedStepLoop` in the mount), so the frame rate never
 * changes the ride. A pause stops the rider while the scripted truck keeps its schedule ("the truck
 * moved on"), which is exactly what the replay sees.
 *
 * Events: `lane_pos {lateralCm, progressDm}` sampled at 10 Hz by the recorder and `mirror_check
 * {target}`. Time in a no-zone, lane changes, holding back and the left overtake are derived by
 * `scoreBlindSpot` on replay; the controller mirrors the left-overtake test only to freeze the scene
 * the moment it happens (UI_SPEC_LEARN_GAMES §5.3).
 */

import { INTEGRITY_CONFIG } from "@margdarshak/game-core/integrity";
import { GAME_CONFIG, vehicleZones } from "@margdarshak/game-core/scoring";
import type { EventRecorder } from "@margdarshak/game-core/sdk";
import { convexOverlap, interpolate } from "@margdarshak/game-core/sim";
import { footprint, geometryOf, type PartB, type ZoneName, zoneHit } from "./geometry";

const C = GAME_CONFIG.blindSpot;

/** Rider positions across the road: the gap on the truck's left, then the three lane thirds. */
export type LanePos = "kerb" | "left" | "centre" | "right";
export const LANE_ORDER: readonly LanePos[] = ["kerb", "left", "centre", "right"];

/** Ride design parameters [D] (not physics; GAME_DESIGN §4.3: throttle is automatic and modest). */
export const RIDE_UI = {
  /** How much faster than the truck the rider rolls when not holding back (m/s). */
  closingMps: 1.5,
  /** "Pass" in the decision version: the manoeuvre the learner chose, played out (m/s over the truck). */
  passClosingMps: 4.5,
  /** Closest the rider follows directly behind the truck's rear (m). */
  followMinM: 4,
  /** Lateral speed: half the replay's impossible-rate limit, so a lane change is never flagged. */
  lateralMps: INTEGRITY_CONFIG.maxLateralMps / 2,
  /** Gap between the bike and the truck's left side in the kerb position (m). */
  kerbMarginM: 0.05,
  /** Start this many metres further back than the hold-back gap. */
  startExtraM: 3,
} as const;

export type SpeedMode = "cruise" | "hold" | "pass";

export interface RideSnapshot {
  simMs: number;
  durationMs: number;
  rider: { lat: number; prog: number; pos: LanePos; mode: SpeedMode };
  truck: { lat: number; prog: number; present: boolean; indicating: boolean };
  /** The zone (or body) the rider's footprint is in right now; null = the driver can see you. */
  zone: ZoneName | "body" | null;
  critical: boolean;
  finished: boolean;
  road: { widthM: number; laneLeftM: number; laneWidthM: number };
}

export interface RideOptions {
  spec: PartB;
  item: number;
  recorder: Pick<EventRecorder, "emit" | "sample">;
  /** The recorder's clock (ms). */
  now: () => number;
}

export class Ride {
  readonly spec: PartB;
  private readonly item: number;
  private readonly rec: RideOptions["recorder"];
  private readonly now: () => number;
  private readonly g;
  private readonly holdGapM: number;
  private t0 = 0;
  private started = false;
  private lat: number;
  private prog: number;
  private pos: LanePos = "centre";
  private mode: SpeedMode = "cruise";
  private critical = false;
  private finished = false;
  private simMs = 0;

  constructor(o: RideOptions) {
    this.spec = o.spec;
    this.item = o.item;
    this.rec = o.recorder;
    this.now = o.now;
    this.g = geometryOf(o.spec.vehicleType);
    // Hold back until the whole bike is clear of the rear no-zone.
    this.holdGapM = this.g.lengthM + this.g.rearZoneM + 2 * C.bikeHalfLengthM;
    this.lat = this.laneLat("centre", 0);
    this.prog = this.truckAt(0).prog - this.holdGapM - RIDE_UI.startExtraM;
  }

  /** Call right after `item_start`: the ride clock starts here. */
  start(): void {
    this.t0 = this.now();
    this.started = true;
    this.sample();
  }

  get isRunning(): boolean {
    return this.started && !this.finished && !this.critical;
  }

  truckAt(tMs: number): { lat: number; prog: number; present: boolean; indicating: boolean } {
    const kf = this.spec.truck.keyframes;
    const present = this.spec.truck.exitMs === null || tMs <= this.spec.truck.exitMs;
    return {
      lat: interpolate(kf, tMs, (k) => k.lateralM),
      prog: interpolate(kf, tMs, (k) => k.progressM),
      present,
      indicating: present && this.spec.indicateLeft.some((w) => tMs >= w.fromMs && tMs <= w.toMs),
    };
  }

  /** Lateral metres from the road's left edge for a position at time t. */
  laneLat(pos: LanePos, tMs: number): number {
    if (pos === "kerb") {
      const truck = this.truckAt(tMs);
      return truck.lat - this.g.widthM / 2 - C.bikeHalfWidthM - RIDE_UI.kerbMarginM;
    }
    const third = this.spec.laneWidthM / 3;
    const k = pos === "left" ? 0 : pos === "centre" ? 1 : 2;
    return this.spec.riderLaneLeftM + third * (k + 0.5);
  }

  setPos(pos: LanePos): void {
    this.pos = pos;
  }

  move(dir: -1 | 1): LanePos {
    const i = LANE_ORDER.indexOf(this.pos) + dir;
    this.pos = LANE_ORDER[Math.max(0, Math.min(LANE_ORDER.length - 1, i))] ?? this.pos;
    return this.pos;
  }

  setMode(mode: SpeedMode): void {
    this.mode = mode;
  }

  /** Mirror check: records `mirror_check` and says whether the driver could see you right now. */
  mirror(): { present: boolean; visible: boolean } {
    const truck = this.truckAt(this.simMs);
    const target = !truck.present ? "self" : this.spec.vehicleType === "bus" ? "bus" : "truck";
    this.rec.emit("mirror_check", { target }, { item: this.item });
    return { present: truck.present, visible: truck.present && this.zoneNow(truck) === null };
  }

  private zoneNow(truck: { lat: number; prog: number; present: boolean }) {
    if (!truck.present) return null;
    return zoneHit(this.spec.vehicleType, this.lat - truck.lat, this.prog - truck.prog);
  }

  private overlapsBody(lat: number, prog: number, truck: { lat: number; prog: number }): boolean {
    const { body } = vehicleZones(this.spec.vehicleType);
    return convexOverlap(footprint(lat - truck.lat, prog - truck.prog), body);
  }

  private truckSpeed(tMs: number): number {
    const a = this.truckAt(Math.max(0, tMs - 50)).prog;
    const b = this.truckAt(tMs + 50).prog;
    return (b - a) / 0.1;
  }

  private lanePos() {
    return {
      lateralCm: Math.max(-2000, Math.min(2000, Math.round(this.lat * 100))),
      progressDm: Math.max(-1000, Math.min(100_000, Math.round(this.prog * 10))),
    };
  }

  /** A 10 Hz `lane_pos` sample (the recorder keeps the first per bucket); true when it landed. */
  private sample(): boolean {
    return this.rec.sample("lane_pos", this.lanePos(), { item: this.item }) !== null;
  }

  /** One fixed logic step. */
  step(stepMs: number): void {
    if (!this.isRunning) return;
    const t = this.now() - this.t0;
    this.simMs = t;
    if (t >= this.spec.durationMs) {
      this.finished = true;
      return;
    }
    const dt = stepMs / 1000;
    const truck = this.truckAt(t);
    // Lateral: towards the chosen position, never through the truck.
    const target = this.laneLat(this.pos, t);
    const maxD = RIDE_UI.lateralMps * dt;
    const nextLat = this.lat + Math.max(-maxD, Math.min(maxD, target - this.lat));
    if (!truck.present || !this.overlapsBody(nextLat, this.prog, truck)) this.lat = nextLat;
    // Longitudinal: automatic, modest; hold back drops behind the rear no-zone and stays there.
    const vt = this.truckSpeed(t);
    const gap = truck.prog - this.prog;
    const v =
      this.mode === "hold"
        ? gap < this.holdGapM
          ? vt - RIDE_UI.closingMps
          : vt
        : vt + (this.mode === "pass" ? RIDE_UI.passClosingMps : RIDE_UI.closingMps);
    const before = this.prog;
    this.prog += Math.max(0, v) * dt;
    // Directly behind the truck: never closer than the follow gap to its rear.
    const hw = this.g.widthM / 2;
    const besideBody = Math.abs(this.lat - truck.lat) < hw + C.bikeHalfWidthM;
    const limit = truck.prog - this.g.lengthM - RIDE_UI.followMinM - C.bikeHalfLengthM;
    if (truck.present && besideBody && before <= limit + 1e-6 && this.prog > limit)
      this.prog = limit;
    const landed = this.sample();
    // The scorer's left-overtake test, to freeze the scene the moment it happens.
    if (truck.indicating) {
      const x = this.lat - truck.lat;
      const y = this.prog - truck.prog;
      if (y + C.bikeHalfLengthM > -this.g.rearAxleFromFrontM && x + C.bikeHalfWidthM <= -hw) {
        this.critical = true;
        // The scene freezes here, so this exact position must be on record even when the 10 Hz
        // bucket was already taken (same position as any sample this step: no impossible rate).
        if (!landed) this.rec.emit("lane_pos", this.lanePos(), { item: this.item });
      }
    }
  }

  snapshot(): RideSnapshot {
    const t = this.started ? Math.max(this.simMs, 0) : 0;
    const truck = this.truckAt(t);
    return {
      simMs: t,
      durationMs: this.spec.durationMs,
      rider: { lat: this.lat, prog: this.prog, pos: this.pos, mode: this.mode },
      truck,
      zone: this.zoneNow(truck),
      critical: this.critical,
      finished: this.finished,
      road: {
        widthM: this.spec.riderLaneLeftM + this.spec.laneWidthM,
        laneLeftM: this.spec.riderLaneLeftM,
        laneWidthM: this.spec.laneWidthM,
      },
    };
  }
}
