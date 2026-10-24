// Design parameters for every scorer, in one place (GAME_DESIGN tag [D]). Every block carries
// `source: "design"`: these are our choices, never presented as government rules. Rule-pack values
// (Kerala HPT format, LL formats, track specs) arrive through `content` with their own source.
import type { VehicleType } from "../schema/content.ts";
import type { GameId, HazardType } from "../schema/ids.ts";

export interface VehicleGeometry {
  lengthM: number;
  widthM: number;
  /** Rear axle line, measured back from the front (m). */
  rearAxleFromFrontM: number;
  /** No-zone extents (illustrative, from mirror sight-lines; "zones vary by vehicle and mirrors"). */
  frontZoneM: number;
  rearZoneM: number;
  leftZoneWidthM: number;
  leftZoneAheadM: number;
  rightZoneWidthM: number;
  rightZoneFromM: number;
  rightZoneToM: number;
}

const HAZARD_SKILL: Readonly<Record<HazardType, string>> = {
  bus_stop_pedestrian: "SK-M18",
  door_opening: "SK-M5",
  auto_cut_in: "SK-M5",
  wrong_side_2w: "SK-M9",
  cattle_animal: "SK-M18",
  child_school: "SK-M18",
  pedestrian_median: "SK-M18",
  vehicle_pulling_out: "SK-M6",
  truck_left_turn: "SK-M4",
  junction_emerging: "SK-M6",
  overtaking_oncoming: "SK-M7",
  parked_vehicle_hidden: "SK-M6",
  cyclist: "SK-M18",
  surface_hazard: "SK-M17",
  other: "SK-M18",
};

/** DEBRIEF_SPEC §2.1: pedestrian types → RR-PED-001, junction types → RR-JCT-001, truck → RR-HVY-001. */
const HAZARD_RULES: Readonly<Record<HazardType, readonly string[]>> = {
  bus_stop_pedestrian: ["RR-PED-001"],
  child_school: ["RR-PED-001"],
  pedestrian_median: ["RR-PED-001"],
  parked_vehicle_hidden: ["RR-PED-001"],
  vehicle_pulling_out: ["RR-JCT-001"],
  junction_emerging: ["RR-JCT-001"],
  truck_left_turn: ["RR-HVY-001"],
  door_opening: [],
  auto_cut_in: [],
  wrong_side_2w: [],
  cattle_animal: [],
  overtaking_oncoming: [],
  cyclist: [],
  surface_hazard: [],
  other: [],
};

export const GAME_CONFIG = {
  nazar: {
    source: "design",
    /** Pattern rule: more than `patternMaxTaps` taps in any half-open window [s, s + 1000 ms). */
    patternWindowMs: 1000,
    patternMaxTaps: 3,
    /** Pattern rule: more than `2 × hazards + 4` taps in the clip. */
    clipCapPerHazard: 2,
    clipCapBase: 4,
    /** Taps within this before onset are `early_taps` (learn feedback), never points. */
    earlyTapWindowMs: 1000,
    lateResponseMinS: 0.5,
    falseAlarmMinPerMin: 4,
    /** Item pass for the staircase and `actual_pass` (Kerala marks per clip ≥ 6). */
    itemPassMarks: 6,
    overconfidentMinGap: 3,
    /** Field-kit linear rule: full marks to onset + 2 s, linear to 0 at onset + 5 s. */
    linearFullMs: 2000,
    linearZeroMs: 5000,
    /**
     * Learn mode (NAZAR §1: "prediction correct / location correct"): a correct "what happens
     * next?" answer is worth as much as the best tap, so each hazard is half prediction, half tap.
     */
    learnPredictionPoints: 5,
    hazardSkill: HAZARD_SKILL,
    hazardRules: HAZARD_RULES,
  },
  stoppingDistance: {
    source: "design",
    /** Teaching values (GAME_DESIGN §3.7, "real roads vary"). */
    reactionTimeS: 1.5,
    mu: { dry: 0.7, wet: 0.4 },
    anticipatoryRtMs: 100,
    estimationMax: 30,
    noCollisionMax: 20,
    sightMax: 50,
    /** −20% of an item per 5 km/h over the max safe option. */
    sightPenaltyPerStep: 0.2,
    underestimateMeanPct: -20,
    wetGapFactor: 2,
    /** Below this wet error the "wet ≥ 2 × dry" finding stays quiet (avoids 1% vs 0%). */
    wetGapMinErrPct: 10,
    itemPassFraction: 0.8,
  },
  blindSpot: {
    source: "design",
    probePoints: 6,
    placementMax: 30,
    noZoneMax: 30,
    mirrorMax: 15,
    holdBackMax: 25,
    /** No-zone share at which the component reaches 0. */
    noZoneShareZero: 0.25,
    mirrorWindowMs: 3000,
    /** Lane-position gaps longer than this do not count as riding time. */
    sampleGapCapMs: 200,
    bikeHalfWidthM: 0.4,
    bikeHalfLengthM: 1.0,
    noZoneFindingPct: 10,
    mirrorFindingPct: 60,
    mirrorFindingMinChanges: 2,
    partAPassPoints: 24,
    partBPassPoints: 56,
    vehicles: {
      truck: {
        lengthM: 10,
        widthM: 2.5,
        rearAxleFromFrontM: 8,
        frontZoneM: 3,
        rearZoneM: 9,
        leftZoneWidthM: 3.5,
        leftZoneAheadM: 1,
        rightZoneWidthM: 1.5,
        rightZoneFromM: 3,
        rightZoneToM: 8,
      },
      bus: {
        lengthM: 12,
        widthM: 2.6,
        rearAxleFromFrontM: 9.5,
        frontZoneM: 2.5,
        rearZoneM: 8,
        leftZoneWidthM: 3,
        leftZoneAheadM: 1,
        rightZoneWidthM: 1.5,
        rightZoneFromM: 3,
        rightZoneToM: 9,
      },
      tanker: {
        lengthM: 13,
        widthM: 2.5,
        rearAxleFromFrontM: 11,
        frontZoneM: 3,
        rearZoneM: 10,
        leftZoneWidthM: 3.5,
        leftZoneAheadM: 1,
        rightZoneWidthM: 1.5,
        rightZoneFromM: 3,
        rightZoneToM: 10,
      },
    } satisfies Record<VehicleType, VehicleGeometry>,
  },
  junctionScan: {
    source: "design",
    scanWindowMs: 3000,
    scanMax: 30,
    gapMax: 40,
    creepMax: 15,
    yieldMax: 15,
    gapFullS: 4,
    gapZeroS: 2,
    /** Accepted gap below this means the rider and the road user meet: a collision. */
    collisionGapS: 1,
    /** A road user up to this long past the conflict point still occupies it. */
    agentClearS: 0.5,
    criticalCap: 20,
    itemPassScore: 70,
  },
  trackTwin: {
    source: "design",
    vehicle2W: {
      wheelbaseM: 1.3,
      maxSpeedMps: 3,
      maxSteerRad: 0.6108652381980153, // 35°
      accelMps2: 1.5,
      brakeMps2: 4,
      dragMps2: 0.3,
    },
    bikeHalfWidthM: 0.35,
    /** Balance meter: below v_min the bike wobbles; below 0.6 m/s for > 1 s = foot down. */
    vMinMps: 1,
    footDownSpeedMps: 0.6,
    footDownHoldMs: 1000,
    /** A new line touch counts only after the bike was clear of the line this long. */
    lineTouchRearmMs: 500,
    /** Progress search window ahead of the current segment (follows a self-crossing path). */
    progressWindowM: 4,
    demeritPct: 5,
    immediateFailCapPct: 40,
  },
  llSim: {
    source: "design",
    defaultQuestions: 15,
    defaultPassPct: 60,
    overconfidentWrongAt100: 3,
    overconfidenceMax: 0.15,
    /** The overconfidence branch needs at least this many rated answers. */
    overconfidenceMinN: 5,
    weakTopicAccuracy: 0.6,
    weakTopicMinAnswers: 3,
    signFamilyMinWrong: 2,
    timeoutsMin: 2,
    underconfidentAccuracy: 0.85,
    underconfidentMinN: 10,
  },
  /** Replay budgets per game (manifest `budgets`), used when the verifier builds a manifest view. */
  budgets: {
    nazar: { maxEvents: 2000, maxSessionSeconds: 1200 },
    stopping_distance: { maxEvents: 1000, maxSessionSeconds: 900 },
    blind_spot: { maxEvents: 5000, maxSessionSeconds: 900 },
    junction_scan: { maxEvents: 2000, maxSessionSeconds: 900 },
    track_twin: { maxEvents: 5000, maxSessionSeconds: 600 },
    helmet_fit: { maxEvents: 500, maxSessionSeconds: 600 },
    golden_hour: { maxEvents: 500, maxSessionSeconds: 900 },
    night_glare: { maxEvents: 5000, maxSessionSeconds: 900 },
    hill_road: { maxEvents: 5000, maxSessionSeconds: 1200 },
    ll_sim: { maxEvents: 1000, maxSessionSeconds: 1200 },
  } satisfies Record<GameId, { maxEvents: number; maxSessionSeconds: number }>,
} as const;

export type GameConfig = typeof GAME_CONFIG;
