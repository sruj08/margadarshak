// Scene catalogue for the AI-generated Nazar clip bank (ADR-0013): content/nazar/scenes.json.
//
// Scene fields mirror clip.json naming (camelCase), because the clip_generate task copies them into
// the new clip; the file header follows the content/ convention. The consumer view the generator
// re-checks at run time is packages/clip-pipeline/src/generation.ts (`SceneSpecSchema`); the shot
// rules below are the same rules, and services/workflows tests parse this file with that schema.
import { z } from "zod";
import { fileHeader, HAZARD_TYPES, HiReviewStatus } from "./common.ts";

export const SCENE_ID_RE = /^SCN-\d{3}$/;
const COARSE_PLACE_RE = /^[\p{L}][\p{L} .'-]{1,59}$/u;
const NOT_BLANK_RE = /\S/;
const DEVANAGARI_RE = /[ऀ-ॿ]/;

/** A scene's hazard: NAZAR §3.3's 15 types, or `quiet` (no hazard, to measure over-tapping). */
export const SCENE_HAZARDS = [...HAZARD_TYPES, "quiet"] as const;
export const SceneHazard = z.enum(SCENE_HAZARDS);

/** Indian contexts the bank must cover (J&K hills, Kerala, metro and small-town roads). */
export const SCENE_SETTINGS = [
  "jk_hill_road",
  "jk_town",
  "kerala_town",
  "kerala_rural",
  "kerala_highway",
  "metro_arterial",
  "metro_residential",
  "small_town_market",
  "school_zone",
] as const;
export const SceneSetting = z.enum(SCENE_SETTINGS);
export type SceneSetting = z.infer<typeof SceneSetting>;

/**
 * Calm, legal camera speeds per setting (km/h). Below common Indian urban limits; schools, markets
 * and residential lanes at 25 or less. No speed content (CLAUDE.md "Games").
 */
export const SETTING_MAX_KMH: Readonly<Record<SceneSetting, number>> = {
  jk_hill_road: 35,
  jk_town: 40,
  kerala_town: 30,
  kerala_rural: 40,
  kerala_highway: 60,
  metro_arterial: 40,
  metro_residential: 25,
  small_town_market: 25,
  school_zone: 20,
};

/** clip.json enums (packages/clip-pipeline/src/schema.ts). */
export const SCENE_ROAD_TYPES = [
  "urban_arterial",
  "market_street",
  "residential_lane",
  "school_zone",
  "highway",
  "hill_road",
  "rural_road",
] as const;
export const SCENE_WEATHERS = ["clear", "overcast", "haze", "rain", "fog"] as const;
/** No night scenes yet (NAZAR §3.4: night is roadmap). */
export const SCENE_TIMES_OF_DAY = ["dawn", "day", "dusk"] as const;

/** Model limits (Gemini Omni docs, 2026-10-24) and bank rules; same numbers as clip-pipeline. */
export const SCENE_LIMITS = {
  maxTotalS: 40,
  openingMinS: 4,
  openingMaxS: 10,
  extensionMinS: 3,
  extensionMaxS: 10,
  minLeadInS: 10,
  minResolveS: 4,
  targetMinS: 20,
  targetMaxS: 40,
  minSpeedKmh: 10,
} as const;

export const SceneShot = z
  .object({
    kind: z.enum(["opening", "extension"]),
    durationS: z.int().min(SCENE_LIMITS.extensionMinS).max(SCENE_LIMITS.openingMaxS),
    prompt: z.string().min(20).max(600),
    hazardBegins: z.literal(true).optional(),
    cueAtS: z.number().min(0).max(SCENE_LIMITS.extensionMaxS).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.cueAtS !== undefined && s.hazardBegins !== true) {
      ctx.addIssue({ code: "custom", message: "cueAtS only on the hazard shot", path: ["cueAtS"] });
    }
  });
export type SceneShot = z.infer<typeof SceneShot>;

const CueText = z
  .object({
    en: z.string().min(1).max(160).regex(NOT_BLANK_RE),
    hi: z.string().min(1).max(160).regex(DEVANAGARI_RE, "hi must be Devanagari"),
  })
  .strict();

/** Start (s) of the hazard cue from the shot list, or null for a quiet scene. */
export function sceneNominalOnsetS(scene: {
  hazardType: string;
  shots: readonly {
    durationS: number;
    hazardBegins?: true | undefined;
    cueAtS?: number | undefined;
  }[];
}): number | null {
  if (scene.hazardType === "quiet") return null;
  let t = 0;
  for (const s of scene.shots) {
    if (s.hazardBegins === true) return t + (s.cueAtS ?? 1);
    t += s.durationS;
  }
  return null;
}

export const NazarScene = z
  .object({
    sceneId: z.string().regex(SCENE_ID_RE),
    /** Bumped on every edit; a generation job names the revision it was made from. */
    revision: z.int().min(1),
    hazardType: SceneHazard,
    pov: z.enum(["2W", "4W"]),
    setting: SceneSetting,
    roadType: z.enum(SCENE_ROAD_TYPES),
    /** Coarse region shown as the clip's `city` (letters only; no real landmark). */
    region: z.string().regex(COARSE_PLACE_RE),
    tenantTags: z
      .array(z.string().regex(/^[A-Z]{2,3}$/))
      .min(1)
      .max(8),
    timeOfDay: z.enum(SCENE_TIMES_OF_DAY),
    weather: z.enum(SCENE_WEATHERS),
    speedKmh: z.number().min(SCENE_LIMITS.minSpeedKmh).max(60),
    /** Calm lead-in before the cue (s). */
    leadInS: z.number().min(SCENE_LIMITS.minLeadInS),
    targetDurationS: z.int().min(SCENE_LIMITS.targetMinS).max(SCENE_LIMITS.targetMaxS),
    /** The setting in plain English, for the prompt. */
    scene: z.string().min(20).max(600),
    shots: z.array(SceneShot).min(2).max(10),
    /** What raters look for (en + hi); for quiet scenes, why nothing develops. */
    cue: CueText,
    difficulty: z.int().min(1).max(5),
    occlusion: z.boolean(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const add = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: "custom", message, path });
    const L = SCENE_LIMITS;
    s.shots.forEach((shot, i) => {
      if (i === 0 && shot.kind !== "opening")
        add("the first shot is the opening shot", ["shots", i]);
      if (i > 0 && shot.kind !== "extension") add("later shots are extensions", ["shots", i]);
      if (i === 0 && (shot.durationS < L.openingMinS || shot.durationS > L.openingMaxS))
        add(`opening shot is ${L.openingMinS}–${L.openingMaxS} s`, ["shots", i]);
    });
    const total = s.shots.reduce((t, x) => t + x.durationS, 0);
    if (total !== s.targetDurationS)
      add(`shots add up to ${total} s, targetDurationS is ${s.targetDurationS}`, [
        "targetDurationS",
      ]);
    if (total > L.maxTotalS) add(`a generated video is at most ${L.maxTotalS} s`, ["shots"]);
    if (s.speedKmh > SETTING_MAX_KMH[s.setting])
      add(`${s.setting} scenes stay at or below ${SETTING_MAX_KMH[s.setting]} km/h`, ["speedKmh"]);
    const marked = s.shots.filter((x) => x.hazardBegins === true).length;
    if (s.hazardType === "quiet") {
      if (marked > 0) add("a quiet scene has no hazard shot", ["shots"]);
      return;
    }
    if (marked !== 1) {
      add("a hazard scene marks exactly one shot with hazardBegins", ["shots"]);
      return;
    }
    if (s.shots[0]?.hazardBegins === true)
      add("the hazard begins in an extension, never in the opening shot", ["shots", 0]);
    const onset = sceneNominalOnsetS(s) ?? 0;
    if (onset < s.leadInS)
      add(`nominal onset ${onset} s comes before the lead-in ends`, ["leadInS"]);
    if (total - onset < L.minResolveS)
      add(`at least ${L.minResolveS} s after the cue to develop and resolve`, ["shots"]);
  });
export type NazarScene = z.infer<typeof NazarScene>;

export const NazarScenesFile = z
  .object({
    ...fileHeader("nazar_scenes"),
    /** ai/prompts/clip_generator.md `id` and `version`. */
    promptId: z.literal("PRM-CLIPGEN"),
    promptVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    disclosure: z.literal("ai_generated"),
    hi_review_status: HiReviewStatus,
    scenes: z.array(NazarScene).min(1),
  })
  .strict();
export type NazarScenesFile = z.infer<typeof NazarScenesFile>;
