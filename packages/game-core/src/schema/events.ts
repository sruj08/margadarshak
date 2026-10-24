// GameEvent: a discriminated union on `type` over one strict envelope (GAME_SDK §5).
// Bounds (§5.4): every object is strict, numbers are bounded and quantised (integers in ms, cm, dm;
// normalised taps to 2 dp), strings are enums or ≤ 24 chars. Collisions, faults and scores are
// never events: game-core derives them on replay.
import { z } from "zod";
import { A11yMode, GameMode, HazardType, ItemRef, Short, Surface, TimingMode } from "./ids.ts";

/** Recorder and schema bounds. */
export const EVENT_BOUNDS = {
  maxEvents: 5000,
  /** `t` is relative ms since session start; a session expires 60 min after creation. */
  maxTMs: 3_600_000,
  /** Media time of one clip (Nazar clips are ≤ 60 s; 10 min is a generous ceiling). */
  maxMtMs: 600_000,
  maxItems: 40,
  maxTapsPerSecond: 20,
  sampleHz: 10,
} as const;

const Ms = (max: number) => z.number().int().min(0).max(max);
const Unit = z.number().min(0).max(1).multipleOf(0.01);

/** The common envelope (GAME_SDK §5.1). `t` and `mt` are integer milliseconds. */
const envelope = {
  sid: z.uuid(),
  seq: z
    .number()
    .int()
    .min(0)
    .max(EVENT_BOUNDS.maxEvents - 1),
  t: Ms(EVENT_BOUNDS.maxTMs),
  mt: Ms(EVENT_BOUNDS.maxMtMs).optional(),
  item: z
    .number()
    .int()
    .min(0)
    .max(EVENT_BOUNDS.maxItems - 1)
    .optional(),
};

function ev<T extends string, P extends z.ZodType>(type: T, p: P) {
  return z.object({ ...envelope, type: z.literal(type), p }).strict();
}
const empty = z.object({}).strict();

export const SessionEndReason = z.enum(["completed", "quit", "timeout", "event_cap", "abandoned"]);

export const SessionStartEvent = ev(
  "session_start",
  z
    .object({
      deviceClass: z.enum(["low", "mid", "high"]),
      timingMode: TimingMode,
      a11yModes: z.array(A11yMode).max(8),
      orientation: z.enum(["portrait", "landscape"]),
      mode: GameMode.optional(),
    })
    .strict(),
);
export const ItemStartEvent = ev("item_start", z.object({ ref: ItemRef }).strict());
export const ItemEndEvent = ev(
  "item_end",
  z.object({ ref: ItemRef, reason: z.enum(["done", "voided", "timeout"]) }).strict(),
);
export const TapEvent = ev("tap", z.object({ x: Unit, y: Unit }).strict());
export const HazardResponseEvent = ev(
  "hazard_response",
  z
    .object({
      hazardId: Short,
      band: z.number().int().min(0).max(5),
      firstValidMt: Ms(EVENT_BOUNDS.maxMtMs),
    })
    .strict(),
);
// Correctness is never sent from the client: scoring computes it.
export const PredictionEvent = ev("prediction", z.object({ choice: HazardType }).strict());
export const EstimateEvent = ev(
  "estimate",
  z
    .object({
      speedKmh: z.number().int().min(0).max(150),
      surface: Surface,
      predictedM: z.number().min(0).max(400).multipleOf(0.1),
    })
    .strict(),
);
export const BrakeEvent = ev(
  "brake",
  z
    .object({
      rtMs: Ms(10_000).optional(),
      heldMs: Ms(60_000).optional(),
    })
    .strict(),
);
export const SpeedChoiceEvent = ev(
  "speed_choice",
  z
    .object({
      chosenKmh: z.number().int().min(0).max(150).multipleOf(5),
      // "street" (Stopping Distance round 2) extends the GAME_SDK list.
      context: z.enum(["sight", "night", "bend", "street"]),
    })
    .strict(),
);
export const PlaceEvent = ev(
  "place",
  z
    .object({
      zoneProbe: z
        .object({
          x: z.number().int().min(-500).max(500),
          y: z.number().int().min(-500).max(500),
        })
        .strict(),
    })
    .strict(),
);
// GAME_SDK names these `lat` / `lon`; renamed so no schema field reads like a GPS coordinate.
export const LanePosEvent = ev(
  "lane_pos",
  z
    .object({
      lateralCm: z.number().int().min(-2000).max(2000),
      progressDm: z.number().int().min(-1000).max(100_000),
    })
    .strict(),
);
export const MirrorCheckEvent = ev(
  "mirror_check",
  z.object({ target: z.enum(["truck", "bus", "self"]) }).strict(),
);
export const ScanLookEvent = ev(
  "scan_look",
  z
    .object({
      dir: z.enum(["right", "left", "ahead", "left_edge"]),
      durMs: Ms(10_000),
    })
    .strict(),
);
export const CreepEvent = ev(
  "creep",
  z.object({ distDm: z.number().int().min(0).max(100) }).strict(),
);
export const DecisionEvent = ev("decision", z.object({ node: Short, choice: Short }).strict());
export const IndicatorEvent = ev(
  "indicator",
  z.object({ side: z.enum(["left", "right", "off"]) }).strict(),
);
export const InputEvent = ev(
  "input",
  z
    .object({
      steer: z.number().int().min(-127).max(127),
      throttle: z.number().int().min(0).max(255),
      brake: z.number().int().min(0).max(255),
    })
    .strict(),
);
export const GearChoiceEvent = ev(
  "gear_choice",
  z.object({ gear: z.number().int().min(1).max(4) }).strict(),
);
export const HornEvent = ev("horn", empty);
export const BeamToggleEvent = ev(
  "beam_toggle",
  z.object({ state: z.enum(["high", "low"]) }).strict(),
);
export const CameraCheckEvent = ev(
  "camera_check",
  z
    .object({
      faceCentred: z.boolean(),
      chinVisible: z.boolean(),
      classifierBand: z.enum(["low", "mid", "high"]).optional(),
    })
    .strict(),
);
export const StepConfirmEvent = ev("step_confirm", z.object({ stepId: Short }).strict());
export const CardOrderEvent = ev(
  "card_order",
  z.object({ cardId: Short, position: z.number().int().min(0).max(20) }).strict(),
);
export const AnswerEvent = ev(
  "answer",
  z
    .object({
      qref: Short,
      optionId: Short,
      latencyMs: Ms(600_000),
    })
    .strict(),
);
export const ConfidenceLevel = z.union([z.literal(50), z.literal(75), z.literal(100)]);
export const ConfidenceEvent = ev(
  "confidence",
  z.union([
    z.object({ qref: Short.optional(), p: ConfidenceLevel }).strict(),
    z.object({ predictedPassClips: z.number().int().min(0).max(10) }).strict(),
  ]),
);
export const CommentaryMarkerEvent = ev(
  "commentary_marker",
  z
    .object({
      startMt: Ms(EVENT_BOUNDS.maxMtMs),
      endMt: Ms(EVENT_BOUNDS.maxMtMs),
    })
    .strict(),
);
const PauseCause = z.object({ cause: z.enum(["user", "hidden", "system"]) }).strict();
export const PauseEvent = ev("pause", PauseCause);
export const ResumeEvent = ev("resume", PauseCause);
export const VisibilityHiddenEvent = ev("visibility_hidden", empty);
export const A11yToggleEvent = ev(
  "a11y_toggle",
  z.object({ mode: A11yMode, on: z.boolean() }).strict(),
);
export const SessionEndEvent = ev("session_end", z.object({ reason: SessionEndReason }).strict());

export const GameEvent = z.discriminatedUnion("type", [
  SessionStartEvent,
  ItemStartEvent,
  ItemEndEvent,
  TapEvent,
  HazardResponseEvent,
  PredictionEvent,
  EstimateEvent,
  BrakeEvent,
  SpeedChoiceEvent,
  PlaceEvent,
  LanePosEvent,
  MirrorCheckEvent,
  ScanLookEvent,
  CreepEvent,
  DecisionEvent,
  IndicatorEvent,
  InputEvent,
  GearChoiceEvent,
  HornEvent,
  BeamToggleEvent,
  CameraCheckEvent,
  StepConfirmEvent,
  CardOrderEvent,
  AnswerEvent,
  ConfidenceEvent,
  CommentaryMarkerEvent,
  PauseEvent,
  ResumeEvent,
  VisibilityHiddenEvent,
  A11yToggleEvent,
  SessionEndEvent,
]);
export type GameEvent = z.infer<typeof GameEvent>;
export type GameEventType = GameEvent["type"];
/** The event of one type, e.g. `EventOf<"tap">`. */
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
/** The payload of one event type. */
export type PayloadOf<T extends GameEventType> = EventOf<T>["p"];

export const GAME_EVENT_TYPES = GameEvent.options.map(
  (o) => o.shape.type.value,
) as readonly GameEventType[];

/** A complete, ordered event stream for one session. */
export const EventStream = z.array(GameEvent).max(EVENT_BOUNDS.maxEvents);
