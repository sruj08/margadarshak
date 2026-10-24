// Server-side scoring content. Clients never receive these before completion: hazard windows,
// LL answer keys and track geometry live in the verifier's content store (GAME_SDK §6.3,
// NAZAR §3.2, API-37). Content objects strip unknown keys (a full clip.json parses and keeps only
// what scoring needs); rule-pack rows keep the rule pack's snake_case field names.
import { z } from "zod";
import { HazardType, LlTopic, Short, SignFamily, Surface } from "./ids.ts";

const MsInt = z.number().int().min(0).max(600_000);
const Window = z.object({ aMs: MsInt, bMs: MsInt }).refine((w) => w.bMs > w.aMs, {
  message: "window.bMs must be after window.aMs",
});

// ---- Nazar (NAZAR §3.2 field names) ----
export const NazarHazard = z.object({
  hazardId: Short,
  hazardType: HazardType,
  window: Window,
  /** FSRS concept card (`C-M18-001`); defaults to `hazard:<hazardType>` when absent. */
  cardId: z.string().max(48).optional(),
});
export type NazarHazard = z.infer<typeof NazarHazard>;

export const NazarClip = z
  .object({
    clipId: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
    version: z.number().int().min(1),
    speedKmhEst: z.number().min(0).max(120),
    durationMs: z.number().int().min(1000).max(600_000),
    hazards: z.array(NazarHazard).max(2),
    quietSegments: z.array(z.object({ fromMs: MsInt, toMs: MsInt })).max(20),
  })
  .superRefine((c, ctx) => {
    for (const h of c.hazards) {
      if (h.window.bMs > c.durationMs) {
        ctx.addIssue({ code: "custom", message: `hazard ${h.hazardId} ends after the clip` });
      }
    }
    if (new Set(c.hazards.map((h) => h.hazardId)).size !== c.hazards.length) {
      ctx.addIssue({ code: "custom", message: "duplicate hazardId" });
    }
  });
export type NazarClip = z.infer<typeof NazarClip>;

/** Rule-pack status values (NAZAR §8 and the KL pack's `stayed` / `postponed`). */
export const FormatStatus = z.enum([
  "announced",
  "in_force",
  "on_hold",
  "stayed",
  "postponed",
  "withdrawn",
]);

/** Kerala HPT format row (`HPT-KL`), as reported; numbers are Kerala's, not ours. */
export const HptFormat = z.object({
  rule_id: z.string().regex(/^HPT-[A-Z]{2}$/),
  clips: z.number().int().min(1).max(20),
  marks_per_clip: z.number().int().min(1).max(20),
  max_hazards_per_clip: z.number().int().min(1).max(2),
  pass: z.number().int().min(0),
  total_marks: z.number().int().min(1),
  status: FormatStatus,
  source_url: z.url().nullable(),
  verified_on: z.iso.date().nullable(),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
});
export type HptFormat = z.infer<typeof HptFormat>;

// ---- Stopping Distance (GAME_DESIGN §3) ----
const IntRange = (min: number, max: number) =>
  z
    .object({ min: z.number().int().min(min).max(max), max: z.number().int().min(min).max(max) })
    .refine((r) => r.max >= r.min, { message: "range max < min" });

export const SdRound = z.discriminatedUnion("round", [
  z.object({
    round: z.literal(1),
    speedKmh: z.number().int().min(10).max(120),
    surface: Surface,
  }),
  z.object({
    round: z.literal(2),
    surface: Surface,
    childDistanceM: IntRange(5, 120),
    speedOptionsKmh: z.array(z.number().int().min(5).max(120).multipleOf(5)).min(2).max(8),
  }),
  z.object({
    round: z.literal(3),
    surface: Surface,
    sightM: IntRange(10, 200),
  }),
]);
export type SdRound = z.infer<typeof SdRound>;

// ---- Blind Spot (GAME_DESIGN §4) ----
export const VehicleType = z.enum(["truck", "bus", "tanker"]);
export type VehicleType = z.infer<typeof VehicleType>;

export const ProbePrompt = z.enum([
  "wait_behind_at_light",
  "truck_about_to_turn_left",
  "beside_in_slow_traffic",
  "about_to_overtake",
  "stopped_ahead_of_truck",
]);
export type ProbePrompt = z.infer<typeof ProbePrompt>;

const MsLong = z.number().int().min(0).max(1_200_000);

export const BsItem = z.discriminatedUnion("part", [
  z.object({
    part: z.literal("A"),
    vehicleType: VehicleType,
    /** The seed picks one orientation per item (degrees, counter-clockwise). */
    orientationsDeg: z.array(z.number().int().min(0).max(359)).min(1).max(8),
    probes: z.array(ProbePrompt).min(1).max(5),
  }),
  z.object({
    part: z.literal("B"),
    vehicleType: VehicleType,
    durationMs: MsLong,
    laneWidthM: z.number().min(2).max(6),
    /** Lateral position of the rider's lane left edge from the road's left edge (m). */
    riderLaneLeftM: z.number().min(0).max(20),
    /** The truck's front-centre in road coordinates, linearly interpolated (the scripted sim). */
    truck: z.object({
      keyframes: z
        .array(
          z.object({
            tMs: MsLong,
            progressM: z.number().min(-100).max(10_000),
            lateralM: z.number().min(0).max(20),
          }),
        )
        .min(2)
        .max(64),
      exitMs: MsLong.nullable(),
    }),
    indicateLeft: z.array(z.object({ fromMs: MsLong, toMs: MsLong })).max(8),
  }),
]);
export type BsItem = z.infer<typeof BsItem>;

// ---- Junction Scan (GAME_DESIGN §5) ----
export const RoadUserKind = z.enum([
  "car",
  "two_wheeler",
  "auto",
  "truck",
  "bus",
  "pedestrian",
  "cyclist",
  "wrong_side_rider",
]);

export const JsItem = z.object({
  junction: z.enum(["T", "4arm"]),
  threatSide: z.enum(["right", "left"]),
  /** Sight-line blocked at the stop line (parked bus). */
  occluded: z.boolean(),
  /** Creep needed to clear the occluder (dm). */
  creepClearDm: z.number().int().min(0).max(100),
  traffic: z
    .array(
      z.object({
        agentId: Short,
        kind: RoadUserKind,
        side: z.enum(["right", "left"]),
        spawnMs: MsLong,
        /** Seeded jitter added to spawnMs: uniform integer in [0, spawnJitterMs]. */
        spawnJitterMs: z.number().int().min(0).max(10_000),
        distAtSpawnM: z.number().min(0).max(500),
        speedMps: z.number().positive().max(30),
      }),
    )
    .max(16),
  pedestrianOnCrossing: z.object({ fromMs: MsLong, toMs: MsLong }).nullable(),
  vehicleInJunction: z.object({ fromMs: MsLong, toMs: MsLong }).nullable(),
});
export type JsItem = z.infer<typeof JsItem>;

// ---- Track Test Twin (GAME_DESIGN §6) ----
export const FaultLocation = z.enum(["loop_left", "loop_right", "crossing", "entry", "exit"]);
export type FaultLocation = z.infer<typeof FaultLocation>;

const Pt = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]);

export const TrackSpec = z.object({
  trackId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9-]+$/),
  version: z.number().int().min(1),
  class: z.enum(["2W", "LMV"]),
  /** "design" for the generic layout; a published or Live-Intel-confirmed spec says so. */
  source: z.enum(["design", "rule_pack", "live_intel"]),
  label: z.literal("practice_layout"),
  timeLimitS: z.number().int().min(10).max(600),
  passDemerits: z.number().int().min(0).max(100),
  immediateFailTimeFactor: z.number().min(1).max(3),
  demerits: z.object({
    lineTouch: z.number().int().min(0).max(50),
    cone: z.number().int().min(0).max(50),
    footDown: z.number().int().min(0).max(50),
    stall: z.number().int().min(0).max(50),
    rollback: z.number().int().min(0).max(50),
    overTimePer10s: z.number().int().min(0).max(50),
  }),
  /** Half the lane width around the centreline (m). */
  halfWidthM: z.number().min(0.5).max(5),
  /** Beyond halfWidthM + offTrackMarginM the rider has left the track (immediate fail). */
  offTrackMarginM: z.number().min(0.1).max(5),
  /** The path to ride, start to finish (m). A figure-8 crosses itself. */
  centreline: z.array(Pt).min(4).max(400),
  /** Segment labels by centreline vertex index range [fromIndex, toIndex). */
  segments: z
    .array(
      z.object({
        fromIndex: z.number().int().min(0),
        toIndex: z.number().int().min(1),
        location: FaultLocation,
      }),
    )
    .min(1)
    .max(40),
  cones: z
    .array(z.object({ x: z.number(), y: z.number(), rM: z.number().min(0.05).max(1) }))
    .max(40),
  start: z.object({ x: z.number(), y: z.number(), headingDeg: z.number().min(-360).max(360) }),
  /** Fraction of centreline length that counts as finished (with the rider near the end). */
  finishFraction: z.number().min(0.5).max(1),
  finishRadiusM: z.number().min(0.5).max(10),
});
export type TrackSpec = z.infer<typeof TrackSpec>;

// ---- LL Test Simulator (GAME_DESIGN §11) ----
/** LL exam format row (`LLT-<state>`), field names as in GAME_DESIGN §11.3. */
export const LlExamFormat = z.object({
  rule_id: z.string().regex(/^LLT-[A-Z]{2,7}$/),
  state: z.string().regex(/^[A-Z]{2,7}$/),
  /** false when no state row exists and the default assumption (15 / 60%) is used. */
  known: z.boolean(),
  questions: z.number().int().min(1).max(40),
  pass: z.number().int().min(0).max(40),
  per_q_timer_s: z.number().int().min(5).max(600).nullable(),
  total_timer_s: z.number().int().min(10).max(7200).nullable(),
  source_url: z.url().nullable(),
  verified_on: z.iso.date().nullable(),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
});
export type LlExamFormat = z.infer<typeof LlExamFormat>;

/** Server-only answer key for one question variant. */
export const LlAnswerKey = z.object({
  qref: Short,
  cardId: z.string().max(48),
  correctOptionId: Short,
  topic: LlTopic,
  signFamily: SignFamily.nullable(),
  signId: z
    .string()
    .regex(/^SIGN-[A-Z]{2,4}-\d{3}$/)
    .nullable(),
});
export type LlAnswerKey = z.infer<typeof LlAnswerKey>;

// ---- Assembled per-game content (aligned with ctx.items order) ----
export const NazarContent = z.object({
  gameId: z.literal("nazar"),
  clips: z.array(NazarClip).max(40),
  format: HptFormat,
});
export const StoppingDistanceContent = z.object({
  gameId: z.literal("stopping_distance"),
  rounds: z.array(SdRound).max(40),
});
export const BlindSpotContent = z.object({
  gameId: z.literal("blind_spot"),
  items: z.array(BsItem).max(40),
});
export const JunctionScanContent = z.object({
  gameId: z.literal("junction_scan"),
  items: z.array(JsItem).max(40),
});
export const TrackTwinContent = z.object({
  gameId: z.literal("track_twin"),
  tracks: z.array(TrackSpec).max(40),
});
export const LlSimContent = z.object({
  gameId: z.literal("ll_sim"),
  format: LlExamFormat,
  questions: z.array(LlAnswerKey).max(40),
});
export const GameContent = z.discriminatedUnion("gameId", [
  NazarContent,
  StoppingDistanceContent,
  BlindSpotContent,
  JunctionScanContent,
  TrackTwinContent,
  LlSimContent,
]);
export type NazarContent = z.infer<typeof NazarContent>;
export type StoppingDistanceContent = z.infer<typeof StoppingDistanceContent>;
export type BlindSpotContent = z.infer<typeof BlindSpotContent>;
export type JunctionScanContent = z.infer<typeof JunctionScanContent>;
export type TrackTwinContent = z.infer<typeof TrackTwinContent>;
export type LlSimContent = z.infer<typeof LlSimContent>;
export type GameContent = z.infer<typeof GameContent>;
