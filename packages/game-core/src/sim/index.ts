// biome-ignore-all lint/performance/noBarrelFile: this file is the `./sim` subpath entry point.
export type { BicycleParams, BicycleState, QuantisedInput } from "./bicycle.ts";
export { bicycleModel, stepBicycle } from "./bicycle.ts";
export {
  datan,
  datan2,
  dcos,
  degToRad,
  dexp,
  dlog,
  dmath,
  dpow,
  dsin,
  dtan,
  HALF_PI,
  PI,
  TRIG_DOMAIN,
} from "./dmath.ts";
export type { Polygon, PolylineProjection, Vec2 } from "./geometry.ts";
export {
  convexOverlap,
  cumulativeLengths,
  distance,
  interpolate,
  pointInPolygon,
  projectOnPolyline,
  rect,
  rotate,
  timeToArrival,
} from "./geometry.ts";
export type { FixedStepLoop } from "./loop.ts";
export { createFixedStepLoop, stepIndexAt } from "./loop.ts";
export type { Rng } from "./prng.ts";
export { hash32, mulberry32, pick, randInt, shuffle, subStream } from "./prng.ts";
export {
  clamp,
  quantiseInt,
  quantiseUnit,
  round1,
  round2,
  roundTo,
  sampleBucket,
} from "./quantise.ts";
export type { WhoBand } from "./stopping.ts";
export {
  brakingDistance,
  collides,
  G,
  impactSpeed,
  kmhToMps,
  maxSafeOptionKmh,
  maxSafeSpeed,
  mpsToKmh,
  reactionDistance,
  totalStoppingDistance,
  whoBand,
} from "./stopping.ts";
