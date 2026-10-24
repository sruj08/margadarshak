// biome-ignore-all lint/performance/noBarrelFile: this file is the `./scoring` subpath entry point.
export type { ReplayErrorCode } from "../errors.ts";
export { bsOrientationDeg, scoreBlindSpot, vehicleZones } from "./blind-spot.ts";
export type { FindingSpec, ResultParts, ScoreOptions } from "./common.ts";
export {
  buildResult,
  finding,
  hazardDrill,
  INFORMATIONAL_FINDINGS,
  ReplayError,
  rankFindings,
} from "./common.ts";
export type { GameConfig, VehicleGeometry } from "./config.ts";
export { GAME_CONFIG } from "./config.ts";
export type { RawContent } from "./content.ts";
export {
  assembleContent,
  defaultLlFormat,
  HPT_FORMAT_ID,
  ITEM_KIND,
  requiredFormats,
} from "./content.ts";
export type { JunctionItemResult } from "./junction-scan.ts";
export { jsAgentSpawnMs, scoreJunctionItem, scoreJunctionScan } from "./junction-scan.ts";
export { scoreLlSim } from "./ll-sim.ts";
export type { ClipAnalysis, HazardCredit } from "./nazar.ts";
export {
  analyseNazarClips,
  bandFor,
  linearFraction,
  maxTapsInWindow,
  patternVoids,
  scoreNazarFieldKitLinear,
  scoreNazarKerala5Band,
} from "./nazar.ts";
export type { ReplayOptions } from "./replay.ts";
export { replay, replayAsync, SCORING_VERSIONS, SUPPORTED_GAMES, scoreEvents } from "./replay.ts";
export {
  scoreStoppingDistance,
  sdChildDistanceM,
  sdSightM,
  sdTrueDistanceM,
} from "./stopping-distance.ts";
export type {
  DemeritSheet,
  TimedInput,
  TrackFault,
  TrackFaultKind,
  TrackRun,
} from "./track-twin.ts";
export { demeritSheet, scoreTrackTwin, simulateTrack, trackInputs } from "./track-twin.ts";
