// clip.json (E-20), field for field as NAZAR.md §3.2, with the hazard enum of §3.3.
//
// Every object is strict: an unknown key is rejected, so a precise location (lat/lng, GPS, street,
// pin code) cannot ride along in the metadata (NAZAR §4, §13; DATA_PIPELINE §1: district at most).
// `city` is letters only for the same reason: no house numbers, pin codes or coordinates.
// Structural rules that JSON Schema cannot express (windows inside the clip, unique IDs, quiet
// segments clear of hazards) live in the superRefine below; status-dependent rules (what must hold
// to publish) live in status.ts.
import { z } from "zod";

export const CLIP_STATUSES = [
  "raw",
  "transcoded",
  "blurred",
  "audited",
  "proposed",
  "rated",
  "adjudication",
  "published",
  "retired",
] as const;
export const ClipStatusSchema = z.enum(CLIP_STATUSES);
export type ClipStatus = z.infer<typeof ClipStatusSchema>;

/** NAZAR §3.3, in table order. Shared with DEBRIEF_SPEC. */
export const HAZARD_TYPES = [
  "bus_stop_pedestrian",
  "door_opening",
  "auto_cut_in",
  "wrong_side_2w",
  "cattle_animal",
  "child_school",
  "pedestrian_median",
  "vehicle_pulling_out",
  "truck_left_turn",
  "junction_emerging",
  "overtaking_oncoming",
  "parked_vehicle_hidden",
  "cyclist",
  "surface_hazard",
  "other",
] as const;
export const HazardTypeSchema = z.enum(HAZARD_TYPES);
export type HazardType = z.infer<typeof HazardTypeSchema>;

/** Curriculum modules per hazard type (NAZAR §3.3 "Module" column). `other` has none. */
export const HAZARD_MODULES: Readonly<Record<HazardType, readonly string[]>> = {
  bus_stop_pedestrian: ["M18"],
  door_opening: ["M5", "M17"],
  auto_cut_in: ["M5"],
  wrong_side_2w: ["M9"],
  cattle_animal: ["M18"],
  child_school: ["M18"],
  pedestrian_median: ["M18"],
  vehicle_pulling_out: ["M6"],
  truck_left_turn: ["M4"],
  junction_emerging: ["M6"],
  overtaking_oncoming: ["M7"],
  parked_vehicle_hidden: ["M6", "M18"],
  cyclist: ["M18"],
  surface_hazard: ["M17"],
  other: [],
};

// The spec shows one example value for each of these; the lists are ours (see README "Deviations").
export const ROAD_TYPES = [
  "urban_arterial",
  "market_street",
  "residential_lane",
  "school_zone",
  "highway",
  "hill_road",
  "rural_road",
] as const;
export const TIMES_OF_DAY = ["dawn", "day", "dusk", "night"] as const;
export const WEATHERS = ["clear", "overcast", "haze", "rain", "fog"] as const;
export const POVS = ["2W", "4W"] as const;
export const SPEED_SOURCES = [
  "rider_log",
  "speedometer",
  "passenger_estimate",
  "not_logged",
  /** AI-generated clips (ADR-0013): the calm, legal speed the scene catalogue specifies. */
  "scene_spec",
] as const;
/**
 * Where the footage comes from (ADR-0013). `filmed` is the NAZAR §4 filming protocol;
 * `ai_generated` is a scene from content/nazar/scenes.json rendered by a video model (SynthID
 * watermarked, labelled in every UI). Absent in older clip.json files, which parse as `filmed`.
 */
export const CLIP_ORIGINS = ["filmed", "ai_generated"] as const;
export const ClipOriginSchema = z.enum(CLIP_ORIGINS);
export type ClipOrigin = z.infer<typeof ClipOriginSchema>;
export const RENDITIONS = ["360p", "480p"] as const;
export type Rendition = (typeof RENDITIONS)[number];

export const LICENCE = "CC-BY-4.0";
/** NAZAR §3.2 / §11 attribution string (the licence is carried in its own field). */
export const ATTRIBUTION = "Margdarshak clip bank, team Chanakya (Nestiq Private Limited), 2026";
/** Delivery frame rate (NAZAR §3.1). Frame counts and frame snapping use it. */
export const DELIVERY_FPS = 30;
/** Kerala format: at most two hazards per clip (DATA_PIPELINE §2.3, §2.5). */
export const MAX_HAZARDS_PER_CLIP = 2;

export const CLIP_ID_RE = /^[A-Z]{2,4}-\d{4,6}$/;
/** Pseudonymous person IDs only (rater, auditor, curator), e.g. `rater-07`. Never a name. */
export const PSEUDONYM_RE = /^[a-z][a-z0-9]*-[a-z0-9]{1,16}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const COARSE_PLACE_RE = /^[\p{L}][\p{L} .'-]{1,59}$/u;
const NOT_BLANK_RE = /\S/;

const ms = z.int().nonnegative();

export const WindowSchema = z
  .strictObject({ aMs: ms, bMs: ms })
  .refine((w) => w.aMs < w.bMs, { message: "window aMs must be < bMs" });
export type HazardWindow = z.infer<typeof WindowSchema>;

export const CueTextSchema = z.strictObject({
  en: z.string().min(1).max(160).regex(NOT_BLANK_RE),
  hi: z.string().min(1).max(160).regex(NOT_BLANK_RE),
});

export const ClipHazardSchema = z.strictObject({
  hazardId: z.string().regex(/^h[1-9]\d?$/),
  hazardType: HazardTypeSchema,
  window: WindowSchema,
  raterCount: z.int().min(2).max(3),
  deltaOnsetMs: ms,
  deltaEndMs: ms,
  adjudicated: z.boolean(),
  occlusion: z.boolean(),
  cueText: CueTextSchema,
});
export type ClipHazard = z.infer<typeof ClipHazardSchema>;

export const QuietSegmentSchema = z
  .strictObject({ fromMs: ms, toMs: ms })
  .refine((q) => q.fromMs < q.toMs, { message: "quiet segment fromMs must be < toMs" });
export type QuietSegment = z.infer<typeof QuietSegmentSchema>;

export const DifficultySchema = z.strictObject({
  curator: z.int().min(1).max(5).nullable(),
  empirical: z.number().min(0).max(5).nullable(),
  irt: z.number().nullable(),
  nTakers: z.int().nonnegative(),
});

export const ClipBlurAuditSchema = z.strictObject({
  auditor: z.string().regex(PSEUDONYM_RE),
  framesChecked: z.int().nonnegative(),
  misses: z.int().nonnegative(),
  auditedAt: z.iso.datetime(),
});
export type ClipBlurAudit = z.infer<typeof ClipBlurAuditSchema>;

/** Scene catalogue IDs (content/nazar/scenes.json), e.g. `SCN-004`. */
export const SCENE_ID_RE = /^SCN-\d{3}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
/** Video model IDs, e.g. `gemini-omni-1.1-flash` (configurable as GEMINI_MODEL_VIDEO_GEN). */
const MODEL_ID_RE = /^[a-z][a-z0-9.-]{2,63}$/;
/** Generation batch IDs: letters, digits, `_` and `-` (they become object-key segments). */
export const BATCH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The video model's cap on one generated video, extensions included (Gemini Omni docs: 40 s). */
export const GENERATED_MAX_MS = 40_000;

/**
 * How an `ai_generated` clip was made (ADR-0013). No prompt text: the scene catalogue holds it,
 * versioned by `promptVersion`. `synthId` and `disclosure` are literals: every output of the model
 * carries an invisible SynthID watermark and every surface labels the clip as AI-generated.
 * `durationMs` may exceed the 40 s cap by container rounding only (one second of slack).
 */
export const GenerationSchema = z.strictObject({
  model: z.string().regex(MODEL_ID_RE),
  sceneId: z.string().regex(SCENE_ID_RE),
  promptVersion: z.string().regex(SEMVER_RE),
  seedOrBatchId: z.string().regex(BATCH_ID_RE).optional(),
  generatedAt: z.string().regex(MONTH_RE),
  durationMs: z
    .int()
    .min(1000)
    .max(GENERATED_MAX_MS + 1000),
  extensions: z.int().min(0).max(12),
  synthId: z.literal(true),
  disclosure: z.literal("ai_generated"),
});
export type Generation = z.infer<typeof GenerationSchema>;

/**
 * The curator's synthetic-content review, which replaces the blur audit for `ai_generated` clips
 * (nothing real to blur). Every check is a literal `true`: a clip that fails one is regenerated or
 * retired, never published with a caveat.
 */
export const SyntheticReviewSchema = z.strictObject({
  reviewer: z.string().regex(PSEUDONYM_RE),
  checkedAt: z.iso.datetime(),
  noRealPersonLikeness: z.literal(true),
  noReadablePlates: z.literal(true),
  noRealBrands: z.literal(true),
  noCollisionOrInjury: z.literal(true),
  hazardVisible: z.literal(true),
});
export type SyntheticReview = z.infer<typeof SyntheticReviewSchema>;

export const MediaEntrySchema = z.strictObject({
  res: z.enum(RENDITIONS),
  bytes: z.int().positive(),
  sha256: z.string().regex(SHA256_RE),
});
export type MediaEntry = z.infer<typeof MediaEntrySchema>;

const ClipObjectSchema = z.strictObject({
  clipId: z.string().regex(CLIP_ID_RE),
  version: z.int().min(1),
  status: ClipStatusSchema,
  tenantTags: z
    .array(z.string().regex(/^[A-Z]{2,3}$/))
    .min(1)
    .max(8),
  city: z.string().regex(COARSE_PLACE_RE),
  roadType: z.enum(ROAD_TYPES),
  timeOfDay: z.enum(TIMES_OF_DAY),
  weather: z.enum(WEATHERS),
  pov: z.enum(POVS),
  capturedMonth: z.string().regex(MONTH_RE),
  speedKmhEst: z.number().min(0).max(150).nullable(),
  speedSource: z.enum(SPEED_SOURCES),
  durationMs: z.int().min(1000).max(900_000),
  hazards: z.array(ClipHazardSchema).max(MAX_HAZARDS_PER_CLIP),
  quietSegments: z.array(QuietSegmentSchema).max(32),
  difficulty: DifficultySchema,
  modules: z.array(z.string().regex(/^M\d{1,2}$/)).max(20),
  licence: z.literal(LICENCE),
  attribution: z.string().min(1).max(200).regex(NOT_BLANK_RE),
  blurAudit: ClipBlurAuditSchema.nullable(),
  media: z.array(MediaEntrySchema).max(RENDITIONS.length),
  origin: ClipOriginSchema.default("filmed"),
  generation: GenerationSchema.optional(),
  syntheticReview: SyntheticReviewSchema.optional(),
});

/** The clip.json schema. Parse with `parseClip` (throws) or `ClipSchema.safeParse`. */
export const ClipSchema = ClipObjectSchema.superRefine((c, ctx) => {
  const ids = new Set<string>();
  c.hazards.forEach((h, i) => {
    if (ids.has(h.hazardId)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate hazardId ${h.hazardId}`,
        path: ["hazards", i, "hazardId"],
      });
    }
    ids.add(h.hazardId);
    if (h.window.bMs > c.durationMs) {
      ctx.addIssue({
        code: "custom",
        message: "hazard window ends after the clip",
        path: ["hazards", i, "window"],
      });
    }
    if (h.raterCount === 3 && !h.adjudicated) {
      ctx.addIssue({
        code: "custom",
        message: "three marks only exist after adjudication",
        path: ["hazards", i, "adjudicated"],
      });
    }
  });
  const quiet = [...c.quietSegments].sort((x, y) => x.fromMs - y.fromMs);
  quiet.forEach((q, i) => {
    if (q.toMs > c.durationMs) {
      ctx.addIssue({
        code: "custom",
        message: "quiet segment ends after the clip",
        path: ["quietSegments"],
      });
    }
    const prev = quiet[i - 1];
    if (prev && prev.toMs > q.fromMs) {
      ctx.addIssue({ code: "custom", message: "quiet segments overlap", path: ["quietSegments"] });
    }
    for (const h of c.hazards) {
      if (q.fromMs < h.window.bMs && h.window.aMs < q.toMs) {
        ctx.addIssue({
          code: "custom",
          message: `quiet segment overlaps hazard ${h.hazardId}`,
          path: ["quietSegments"],
        });
      }
    }
  });
  const res = new Set<string>();
  c.media.forEach((m, i) => {
    if (res.has(m.res))
      ctx.addIssue({ code: "custom", message: `duplicate rendition ${m.res}`, path: ["media", i] });
    res.add(m.res);
  });
  if ((c.speedKmhEst === null) !== (c.speedSource === "not_logged")) {
    ctx.addIssue({
      code: "custom",
      message: 'speedKmhEst is null exactly when speedSource is "not_logged"',
      path: ["speedKmhEst"],
    });
  }
  originRules(c, ctx);
});

/** What `origin` implies (ADR-0013): the two kinds of clip never borrow each other's evidence. */
function originRules(c: z.infer<typeof ClipObjectSchema>, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: "custom", message, path });
  if (c.origin === "filmed") {
    if (c.generation !== undefined)
      issue("generation is only for ai_generated clips", ["generation"]);
    if (c.syntheticReview !== undefined)
      issue("syntheticReview is only for ai_generated clips (filmed clips need the blur audit)", [
        "syntheticReview",
      ]);
    if (c.speedSource === "scene_spec")
      issue('speedSource "scene_spec" is only for ai_generated clips', ["speedSource"]);
    return;
  }
  if (c.generation === undefined) {
    issue("ai_generated clips need their generation record", ["generation"]);
  } else if (c.generation.generatedAt !== c.capturedMonth) {
    issue("capturedMonth of an ai_generated clip is its generation month", ["capturedMonth"]);
  }
  if (c.blurAudit !== null)
    issue("ai_generated clips have no blur audit (syntheticReview replaces it)", ["blurAudit"]);
  if (c.speedSource !== "scene_spec")
    issue('ai_generated clips take their speed from the scene ("scene_spec")', ["speedSource"]);
}
export type Clip = z.infer<typeof ClipSchema>;

export function parseClip(input: unknown): Clip {
  return ClipSchema.parse(input);
}

/** `JMU-0012@3`, the versioned clip reference used in manifests and SessionContext items. */
export function clipRef(clip: Pick<Clip, "clipId" | "version">): string {
  return `${clip.clipId}@${clip.version}`;
}

/** Frames a full blur audit must check: floor(duration × 30 fps). 38 000 ms → 1 140 frames. */
export function expectedFrameCount(durationMs: number, fps: number = DELIVERY_FPS): number {
  return Math.floor((durationMs * fps) / 1000);
}

/** The JSON Schema written to schema/clip.schema.json (refinements are not representable). */
export function clipJsonSchema(): Record<string, unknown> {
  // io "input": `origin` has a default, so a clip.json written before ADR-0013 (no origin) still
  // validates against the JSON Schema exactly as it does against Zod.
  const schema = z.toJSONSchema(ClipObjectSchema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
  return {
    $schema: schema["$schema"],
    $id: "https://margdarshak.example/schema/clip.schema.json",
    title: "Nazar clip metadata (clip.json, E-20)",
    description:
      "Generated from packages/clip-pipeline/src/schema.ts by scripts/gen-schema.ts. Do not edit. Cross-field rules (windows inside the clip, unique IDs, quiet segments clear of hazards, origin rules for ai_generated clips, publish invariants) are enforced by the Zod schema and status.ts, not here.",
    ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "$schema")),
  };
}
