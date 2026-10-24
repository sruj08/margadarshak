// AI-generated clip bank (ADR-0013): the scene contract the `clip_generate` task consumes, the
// versioned prompt template and guardrails (mirrored in ai/prompts/clip_generator.md, with a drift
// test), the approximate onset hint for raters, the clip.json facts a scene implies, and the
// deterministic keys. Pure: no model call, no clock, no file I/O.
//
// The authoring schema of content/nazar/scenes.json (strict, with bank-coverage checks) lives in
// packages/content. This one is the consumer view: what the generator needs, checked again at run
// time so a bad scene fails before any paid generation.
import { z } from "zod";
import {
  BATCH_ID_RE,
  COARSE_PLACE_RE,
  CueTextSchema,
  GENERATED_MAX_MS,
  type Generation,
  GenerationSchema,
  HAZARD_MODULES,
  HAZARD_TYPES,
  MONTH_RE,
  POVS,
  ROAD_TYPES,
  SCENE_ID_RE,
  WEATHERS,
} from "./schema.ts";

/** ai/prompts/clip_generator.md front matter (`id`, `version`). */
export const CLIP_GENERATOR_PROMPT = { id: "PRM-CLIPGEN", version: "1.0.0" } as const;
/** GEMINI_MODEL_VIDEO_GEN default (Gemini Omni Flash; the Veo 3.1 previews closed on 2026-10-22). */
export const DEFAULT_VIDEO_MODEL = "gemini-omni-1.1-flash";

/** Model limits (Gemini Omni docs, read 2026-10-24) and our own bank rules. */
export const GENERATION_LIMITS = {
  /** One generated video, extensions included. */
  maxTotalS: GENERATED_MAX_MS / 1000,
  openingMinS: 4,
  openingMaxS: 10,
  /** "a 3–10 second continuation" per extension turn. */
  extensionMinS: 3,
  extensionMaxS: 10,
  /** Calm lead-in before the cue: raters and learners need time to settle (NAZAR §3.1). */
  minLeadInS: 10,
  /** Time after the cue for the hazard to develop and resolve before the clip ends. */
  minResolveS: 4,
  targetMinS: 20,
  targetMaxS: 40,
  /** Calm, legal camera speeds only (no speed content, CLAUDE.md "Games"). */
  minSpeedKmh: 10,
  maxSpeedKmh: 60,
  /** 720p so both 360p and 480p deliveries are downscales (never upscales). */
  resolution: "720p",
  aspectRatio: "16:9",
} as const;

/** Raters see the hint as "around here ± this"; it never sets a window (D-09). */
export const ONSET_HINT_TOLERANCE_MS = 3_000;

/**
 * Appended to every prompt, opening and extensions alike. Version-locked to
 * CLIP_GENERATOR_PROMPT.version; the curator's syntheticReview checks the output against them.
 */
export const GUARDRAILS: readonly string[] = [
  "No collision, no contact between road users, no fall, no injury, no blood and no crash aftermath at any moment.",
  "No real brands, logos, trademarks or company liveries on vehicles, shops, buses or signs; signboards and shop fronts carry no readable words.",
  "Every number plate is blank or blurred beyond reading at every moment.",
  "No recognisable real people or celebrities: everyone is an ordinary, generic person.",
  "No text overlays, captions, subtitles, logos, watermarks, timestamps or on-screen graphics.",
  "The camera vehicle keeps a calm, legal speed and stays in its lane: no speeding, racing, stunts, wheelies or risky overtaking.",
  "Audio: ambient traffic sound only (engines, distant horns, rain if it is raining). No speech, no dialogue, no voice-over, no music.",
  "Any developing hazard shows its early cue first, develops gradually, and then resolves safely: the camera vehicle eases off or holds back and everyone carries on unharmed.",
];

/** The two prompt templates (placeholders in braces). Same text as ai/prompts/clip_generator.md. */
export const PROMPT_TEMPLATES = {
  opening:
    "Photorealistic forward-facing video from a {pov_camera}, showing a fictional, AI-generated Indian road scene. {scene} {time_weather}. The camera vehicle moves steadily at about {speed_kmh} km/h in its own lane. One continuous shot, no cuts, eye-level, natural colours.\nShot {n} of {total}, about {duration_s} seconds: {shot}\n\nRules for every frame:\n{guardrails}",
  extension:
    "Extend the previous video as one continuous shot from its last frame: same camera, same road, same light and weather, same steady speed of about {speed_kmh} km/h.\nShot {n} of {total}, about {duration_s} seconds: {shot}\n\nRules for every frame:\n{guardrails}",
} as const;

const POV_CAMERA: Readonly<Record<(typeof POVS)[number], string>> = {
  "2W": "helmet-height camera on a scooter, the handlebar edge just visible at the bottom of the frame",
  "4W": "dashboard camera in a small hatchback car, the bonnet edge just visible at the bottom of the frame",
};

export const SCENE_TIMES_OF_DAY = ["dawn", "day", "dusk"] as const;
const TIME_TEXT: Readonly<Record<(typeof SCENE_TIMES_OF_DAY)[number], string>> = {
  dawn: "Early morning, soft low light",
  day: "Daytime",
  dusk: "Dusk, low warm light, vehicles with headlights on",
};
const WEATHER_TEXT: Readonly<Record<(typeof WEATHERS)[number], string>> = {
  clear: "clear weather",
  overcast: "overcast sky",
  haze: "light haze",
  rain: "steady light rain, a wet road surface with reflections",
  fog: "light fog, visibility reduced but the road ahead still clear to see",
};

/** Scene hazard: one of NAZAR §3.3's 15 types, or `quiet` (no hazard, to measure over-tapping). */
export const SCENE_HAZARDS = [...HAZARD_TYPES, "quiet"] as const;
export type SceneHazard = (typeof SCENE_HAZARDS)[number];

export const ShotSpecSchema = z.object({
  kind: z.enum(["opening", "extension"]),
  durationS: z.int().min(GENERATION_LIMITS.extensionMinS).max(GENERATION_LIMITS.openingMaxS),
  prompt: z.string().min(20).max(600),
  /** The shot in which the hazard's cue first appears (exactly one per hazard scene). */
  hazardBegins: z.boolean().optional(),
  /** Seconds into that shot when the cue should appear (default 1). */
  cueAtS: z.number().min(0).max(GENERATION_LIMITS.extensionMaxS).optional(),
});
export type ShotSpec = z.infer<typeof ShotSpecSchema>;

/** The fields of a content/nazar/scenes.json scene that generation and registration use. */
export const SceneSpecSchema = z
  .object({
    sceneId: z.string().regex(SCENE_ID_RE),
    revision: z.int().min(1),
    hazardType: z.enum(SCENE_HAZARDS),
    pov: z.enum(POVS),
    roadType: z.enum(ROAD_TYPES),
    region: z.string().regex(COARSE_PLACE_RE),
    tenantTags: z
      .array(z.string().regex(/^[A-Z]{2,3}$/))
      .min(1)
      .max(8),
    timeOfDay: z.enum(SCENE_TIMES_OF_DAY),
    weather: z.enum(WEATHERS),
    speedKmh: z.number().min(GENERATION_LIMITS.minSpeedKmh).max(GENERATION_LIMITS.maxSpeedKmh),
    leadInS: z.number().min(GENERATION_LIMITS.minLeadInS),
    targetDurationS: z.int().min(GENERATION_LIMITS.targetMinS).max(GENERATION_LIMITS.targetMaxS),
    scene: z.string().min(20).max(600),
    shots: z.array(ShotSpecSchema).min(2).max(10),
    cue: CueTextSchema,
    difficulty: z.int().min(1).max(5),
    occlusion: z.boolean(),
  })
  .superRefine((s, ctx) => {
    for (const issue of sceneShotIssues(s)) ctx.addIssue({ code: "custom", message: issue });
  });
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

/** Start (s) of each shot in the nominal timeline. */
export function shotStartsS(shots: readonly Pick<ShotSpec, "durationS">[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of shots) {
    out.push(t);
    t += s.durationS;
  }
  return out;
}

/** Nominal onset (s) from the shot list: start of the hazard shot + its cue offset; null when quiet. */
export function nominalOnsetS(scene: Pick<SceneSpec, "shots" | "hazardType">): number | null {
  if (scene.hazardType === "quiet") return null;
  const k = scene.shots.findIndex((s) => s.hazardBegins === true);
  if (k < 0) return null;
  const start = shotStartsS(scene.shots)[k] ?? 0;
  return start + (scene.shots[k]?.cueAtS ?? 1);
}

/** Shot-list rules shared with the packages/content authoring checks. Empty = consistent. */
export function sceneShotIssues(
  s: Pick<SceneSpec, "shots" | "hazardType" | "leadInS" | "targetDurationS">,
): string[] {
  const out: string[] = [];
  const L = GENERATION_LIMITS;
  s.shots.forEach((shot, i) => {
    if (i === 0 && shot.kind !== "opening") out.push("the first shot is the opening shot");
    if (i > 0 && shot.kind !== "extension") out.push(`shot ${i + 1} must be an extension`);
    if (i === 0 && (shot.durationS < L.openingMinS || shot.durationS > L.openingMaxS))
      out.push(`opening shot is ${L.openingMinS}–${L.openingMaxS} s`);
    if (i > 0 && (shot.durationS < L.extensionMinS || shot.durationS > L.extensionMaxS))
      out.push(`extension ${i} is ${L.extensionMinS}–${L.extensionMaxS} s`);
  });
  const total = s.shots.reduce((t, x) => t + x.durationS, 0);
  if (total !== s.targetDurationS)
    out.push(`shots add up to ${total} s, targetDurationS is ${s.targetDurationS}`);
  if (total > L.maxTotalS) out.push(`a generated video is at most ${L.maxTotalS} s`);
  const marked = s.shots.filter((x) => x.hazardBegins === true).length;
  if (s.hazardType === "quiet") {
    if (marked > 0) out.push("a quiet scene has no hazard shot");
    return out;
  }
  if (marked !== 1) {
    out.push("a hazard scene marks exactly one shot with hazardBegins");
    return out;
  }
  if (s.shots[0]?.hazardBegins === true)
    out.push("the hazard begins in an extension, never in the opening shot");
  const onset = nominalOnsetS(s) ?? 0;
  if (onset < s.leadInS)
    out.push(`nominal onset ${onset} s comes before the ${s.leadInS} s lead-in ends`);
  if (onset < L.minLeadInS) out.push(`the cue appears at least ${L.minLeadInS} s in`);
  if (total - onset < L.minResolveS)
    out.push(`at least ${L.minResolveS} s after the cue for the hazard to develop and resolve`);
  return out;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, k: string) => values[k] ?? m);
}

/** The guardrail block exactly as it is appended to every prompt. */
export function guardrailBlock(): string {
  return GUARDRAILS.map((g) => `- ${g}`).join("\n");
}

export interface ShotPrompt {
  /** 1-based shot number; shot 1 is the opening, every later one an extension turn. */
  readonly n: number;
  readonly kind: "opening" | "extension";
  readonly durationS: number;
  readonly text: string;
}

/** Every prompt for one scene, in generation order. Each one ends with the full guardrail block. */
export function buildShotPrompts(input: SceneSpec): ShotPrompt[] {
  const scene = SceneSpecSchema.parse(input);
  const total = String(scene.shots.length);
  const common = {
    pov_camera: POV_CAMERA[scene.pov],
    scene: scene.scene,
    time_weather: `${TIME_TEXT[scene.timeOfDay]}, ${WEATHER_TEXT[scene.weather]}`,
    speed_kmh: String(scene.speedKmh),
    total,
    guardrails: guardrailBlock(),
  };
  return scene.shots.map((shot, i) => ({
    n: i + 1,
    kind: shot.kind,
    durationS: shot.durationS,
    text: fill(i === 0 ? PROMPT_TEMPLATES.opening : PROMPT_TEMPLATES.extension, {
      ...common,
      n: String(i + 1),
      duration_s: String(shot.durationS),
      shot: shot.prompt,
    }),
  }));
}

export interface OnsetHint {
  /** Approximate cue time in the generated video (ms); a hint for raters, never a window. */
  readonly approxOnsetMs: number;
  readonly toleranceMs: number;
  readonly authoritative: false;
  /** "measured": from the generated turn durations; "nominal": from the shot list only. */
  readonly basis: "measured" | "nominal";
}

/**
 * Where the cue should be, for the raters' first look. `turnEndsMs[k]` is the duration of the
 * video after turn k+1 (the extension outputs are the whole video so far). The hazard shot starts
 * where the previous turn's video ended, so the hint follows the model's real turn lengths.
 * Quiet scenes have no hint. Never authoritative: two human raters set every window (D-09).
 */
export function approximateOnsetHint(
  scene: Pick<SceneSpec, "shots" | "hazardType">,
  turnEndsMs?: readonly number[],
): OnsetHint | null {
  const nominal = nominalOnsetS(scene);
  if (nominal === null) return null;
  const k = scene.shots.findIndex((s) => s.hazardBegins === true);
  const cueMs = Math.round((scene.shots[k]?.cueAtS ?? 1) * 1000);
  const prevEnd = turnEndsMs?.[k - 1];
  if (prevEnd !== undefined && Number.isFinite(prevEnd) && prevEnd > 0) {
    return {
      approxOnsetMs: Math.round(prevEnd) + cueMs,
      toleranceMs: ONSET_HINT_TOLERANCE_MS,
      authoritative: false,
      basis: "measured",
    };
  }
  return {
    approxOnsetMs: Math.round(nominal * 1000),
    toleranceMs: ONSET_HINT_TOLERANCE_MS,
    authoritative: false,
    basis: "nominal",
  };
}

/** clip.json fields a scene implies (the Go register step copies them into the new clip). */
export function sceneClipFacts(scene: SceneSpec) {
  return {
    city: scene.region,
    tenantTags: [...scene.tenantTags],
    roadType: scene.roadType,
    timeOfDay: scene.timeOfDay,
    weather: scene.weather,
    pov: scene.pov,
    speedKmhEst: scene.speedKmh,
    speedSource: "scene_spec" as const,
    modules: scene.hazardType === "quiet" ? [] : [...HAZARD_MODULES[scene.hazardType]],
    origin: "ai_generated" as const,
  };
}

/** The clip.json `generation` record (validated). `generatedAt` is a YYYY-MM month. */
export function generationRecord(args: {
  readonly model: string;
  readonly sceneId: string;
  readonly batchId?: string;
  readonly generatedAt: string;
  readonly durationMs: number;
  readonly extensions: number;
}): Generation {
  if (!MONTH_RE.test(args.generatedAt))
    throw new RangeError(`generatedAt must be YYYY-MM, got ${args.generatedAt}`);
  return GenerationSchema.parse({
    model: args.model,
    sceneId: args.sceneId,
    promptVersion: CLIP_GENERATOR_PROMPT.version,
    ...(args.batchId !== undefined ? { seedOrBatchId: args.batchId } : {}),
    generatedAt: args.generatedAt,
    durationMs: args.durationMs,
    extensions: args.extensions,
    synthId: true,
    disclosure: "ai_generated",
  });
}

const STEP_ID_RE = /^[a-z][a-z0-9_]*$/;

function checkGenRef(sceneId: string, version: number, batchId: string): void {
  if (!SCENE_ID_RE.test(sceneId)) throw new RangeError(`bad sceneId ${sceneId}`);
  if (!Number.isInteger(version) || version < 1) throw new RangeError(`bad version ${version}`);
  if (!BATCH_ID_RE.test(batchId)) throw new RangeError(`bad batchId ${batchId}`);
}

/**
 * Idempotency key for a clip_generate step: `SCN-004:2:b20261024a:generate`. One scene revision
 * and batch is one clip; a re-run with the same three never pays for a second generation.
 */
export function generationIdempotencyKey(
  step: string,
  sceneId: string,
  version: number,
  batchId: string,
): string {
  if (!STEP_ID_RE.test(step)) throw new RangeError(`bad step id ${step}`);
  checkGenRef(sceneId, version, batchId);
  return `${sceneId}:${version}:${batchId}:${step}`;
}

export type GeneratedArtefact =
  | "source.mp4"
  | "normalised.mp4"
  | "check-480p.mp4"
  | "luma-3x3.gray"
  | "generation.json";

/** Private ingest-bucket key of a generation artefact, e.g. `generated/SCN-004/v2/b1/source.mp4`. */
export function generatedObjectKey(
  sceneId: string,
  version: number,
  batchId: string,
  name: GeneratedArtefact,
): string {
  checkGenRef(sceneId, version, batchId);
  return `generated/${sceneId}/v${version}/${batchId}/${name}`;
}
