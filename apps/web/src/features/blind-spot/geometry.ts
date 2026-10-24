/**
 * Blind Spot geometry for the UI, all from game-core: the vehicle body and its four no-zones
 * (`vehicleZones`), the bike footprint size (`GAME_CONFIG.blindSpot`), rotation and overlap tests
 * (`sim/geometry`). Placement feedback runs the scorer's own test on the probe the learner sent, so
 * "he can see you here" on screen always matches the server replay (GAME_DESIGN §4.7).
 */
import type { BsItem, VehicleType } from "@margdarshak/game-core/schema";
import { bsOrientationDeg, GAME_CONFIG, vehicleZones } from "@margdarshak/game-core/scoring";
import {
  convexOverlap,
  degToRad,
  type Polygon,
  rect,
  rotate,
  type Vec2,
} from "@margdarshak/game-core/sim";

const C = GAME_CONFIG.blindSpot;
export type PartA = Extract<BsItem, { part: "A" }>;
export type PartB = Extract<BsItem, { part: "B" }>;
export type ZoneName = "front" | "rear" | "left" | "right";
/** `vehicleZones` returns the zones in this order. */
export const ZONE_NAMES: readonly ZoneName[] = ["front", "rear", "left", "right"];

export const BIKE = { halfWidthM: C.bikeHalfWidthM, halfLengthM: C.bikeHalfLengthM } as const;

export const geometryOf = (type: VehicleType) => C.vehicles[type];

/** The bike's footprint at a vehicle-frame position (as the scorer builds it). */
export const footprint = (x: number, y: number): Polygon =>
  rect(x, y, C.bikeHalfWidthM, C.bikeHalfLengthM);

/** Which no-zone (or the body) a footprint at a vehicle-frame position touches; null = visible. */
export function zoneHit(type: VehicleType, x: number, y: number): ZoneName | "body" | null {
  const { body, zones } = vehicleZones(type);
  const fp = footprint(x, y);
  if (convexOverlap(fp, body)) return "body";
  const k = zones.findIndex((z) => convexOverlap(fp, z));
  return k < 0 ? null : (ZONE_NAMES[k] ?? null);
}

/** Seeded orientation (degrees, counter-clockwise) of a Part A vehicle. */
export const orientationDeg = (seed: number, item: number, spec: PartA): number =>
  bsOrientationDeg(seed, item, spec);

/** World-frame probe in decimetres (the `place` payload) for a vehicle-frame position. */
export function probeFor(local: Vec2, thetaDeg: number): { x: number; y: number } {
  const w = rotate(local, degToRad(thetaDeg));
  const clamp = (v: number) => Math.max(-500, Math.min(500, Math.round(v * 10)));
  return { x: clamp(w.x), y: clamp(w.y) };
}

/** Vehicle-frame position (m) of a world-frame probe in decimetres, as the scorer reads it. */
export function localOfProbe(probe: { x: number; y: number }, thetaDeg: number): Vec2 {
  return rotate({ x: probe.x / 10, y: probe.y / 10 }, -degToRad(thetaDeg));
}

/** True when the scorer will count this probe as correct (outside every no-zone and the body). */
export function placementCorrect(
  type: VehicleType,
  thetaDeg: number,
  probe: { x: number; y: number },
): boolean {
  const p = localOfProbe(probe, thetaDeg);
  return zoneHit(type, p.x, p.y) === null;
}

export type SpotKey =
  | "aheadFar"
  | "aheadNear"
  | "leftFront"
  | "leftRear"
  | "rightNear"
  | "rightOut"
  | "behindNear"
  | "behindFar";

export interface Spot {
  /** 1-based number drawn on the diagram. */
  n: number;
  key: SpotKey;
  /** Vehicle frame (m): x to the vehicle's right, y forward, origin at the front-centre. */
  x: number;
  y: number;
}

/** UI layout margin [D]: how far a "far" spot sits beyond a zone edge, in bike lengths. */
const CLEAR_BIKES = 1.25;

/**
 * The eight numbered spots of Part A (UI_SPEC_LEARN_GAMES §5.3), placed from the vehicle's own
 * geometry: some inside a no-zone, some clear of every zone. Which spots are safe is never stored:
 * it is decided by `zoneHit` (the scorer's test) after the learner commits.
 */
export function spotsFor(type: VehicleType): Spot[] {
  const g = geometryOf(type);
  const hw = g.widthM / 2;
  const bl = 2 * C.bikeHalfLengthM;
  const clear = CLEAR_BIKES * bl;
  const raw: Omit<Spot, "n">[] = [
    { key: "aheadFar", x: 0, y: g.frontZoneM + C.bikeHalfLengthM + clear },
    { key: "aheadNear", x: 0, y: g.frontZoneM / 2 },
    { key: "leftFront", x: -hw - g.leftZoneWidthM / 2, y: -g.rightZoneFromM },
    { key: "leftRear", x: -hw - g.leftZoneWidthM / 2, y: -g.lengthM + bl },
    {
      key: "rightNear",
      x: hw + g.rightZoneWidthM / 2,
      y: -(g.rightZoneFromM + g.rightZoneToM) / 2,
    },
    { key: "rightOut", x: hw + g.rightZoneWidthM + C.bikeHalfWidthM + clear, y: -g.lengthM / 2 },
    { key: "behindNear", x: 0, y: -g.lengthM - g.rearZoneM / 2 },
    { key: "behindFar", x: 0, y: -g.lengthM - g.rearZoneM - C.bikeHalfLengthM - clear },
  ];
  return raw.map((s, i) => ({ ...s, n: i + 1 }));
}
