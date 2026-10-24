// Cross-scene checks for content/nazar/scenes.json (ADR-0013). Each returns a list of issues; an
// empty list means it passed. The schema (src/schema/nazar-scenes.ts) checks one scene at a time.
import { z } from "zod";
import { HAZARD_TYPES } from "./schema/common.ts";
import {
  type NazarScenesFile,
  NazarScenesFile as NazarScenesFileSchema,
  type SceneSetting,
} from "./schema/nazar-scenes.ts";

/** Bank coverage the product owner asked for (ADR-0013 §"Scene catalogue"). */
export const SCENE_COVERAGE = {
  minHazardScenes: 24,
  minQuietScenes: 4,
  povs: ["2W", "4W"],
  timesOfDay: ["day", "dusk"],
  weathers: ["rain"],
  /** Each group needs at least one scene (J&K hills, Kerala, metro and small-town roads). */
  settingGroups: {
    jk_hills: ["jk_hill_road"],
    kerala: ["kerala_town", "kerala_rural", "kerala_highway"],
    metro: ["metro_arterial", "metro_residential"],
    small_town: ["small_town_market"],
  } satisfies Record<string, readonly SceneSetting[]>,
} as const;

/** Every hazard type, the quiet quota, both POVs, day/dusk/rain variants and the Indian contexts. */
export function checkSceneCoverage(file: NazarScenesFile): string[] {
  const out: string[] = [];
  const C = SCENE_COVERAGE;
  const hazard = file.scenes.filter((s) => s.hazardType !== "quiet");
  const quiet = file.scenes.filter((s) => s.hazardType === "quiet");
  if (hazard.length < C.minHazardScenes)
    out.push(`${hazard.length} hazard scenes, need at least ${C.minHazardScenes}`);
  if (quiet.length < C.minQuietScenes)
    out.push(`${quiet.length} quiet scenes, need at least ${C.minQuietScenes}`);
  const types = new Set(hazard.map((s) => s.hazardType));
  for (const t of HAZARD_TYPES) if (!types.has(t)) out.push(`no scene for hazard type ${t}`);
  for (const p of C.povs)
    if (!hazard.some((s) => s.pov === p)) out.push(`no hazard scene from the ${p} point of view`);
  for (const t of C.timesOfDay)
    if (!file.scenes.some((s) => s.timeOfDay === t)) out.push(`no ${t} scene`);
  for (const w of C.weathers)
    if (!file.scenes.some((s) => s.weather === w)) out.push(`no ${w} scene`);
  for (const [group, settings] of Object.entries(C.settingGroups)) {
    if (!file.scenes.some((s) => (settings as readonly string[]).includes(s.setting)))
      out.push(`no scene in the ${group} context`);
  }
  return out;
}

export function checkSceneIds(file: NazarScenesFile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of file.scenes) {
    if (seen.has(s.sceneId)) out.push(`duplicate sceneId ${s.sceneId}`);
    seen.add(s.sceneId);
  }
  return out;
}

/**
 * Words a scene's prompt text must never contain: harm, speed content, brands and text to read.
 * The guardrail block (appended by the generator) forbids these again; this keeps scene authors
 * from asking for them in the first place.
 */
export const SCENE_TEXT_BANS: readonly { id: string; re: RegExp }[] = [
  {
    id: "harm",
    re: /\b(crash\w*|collid\w*|collision|accident\w*|injur\w*|blood\w*|hit by|knocked down|run over|fall(s|en)? off|dead|death)\b/i,
  },
  {
    id: "speed",
    re: /\b(speeding|race|racing|stunt\w*|wheelie\w*|zoom\w*|top speed|full throttle)\b/i,
  },
  {
    id: "brand",
    re: /\b(maruti|suzuki|tata|mahindra|hyundai|honda|hero|bajaj|tvs|royal enfield|toyota|kia|ksrtc|dtc|best bus|ola|uber|rapido|swiggy|zomato|amul|coca|pepsi|indian oil|bharat petroleum|hp petrol|jio|airtel)\b/i,
  },
  { id: "readable-text", re: /\b(reads?|reading|written|says|labelled|logo\w*|banner with)\b/i },
  /** Plate-like strings (`KL 07 AB 1234`) and long digit runs. */
  { id: "plate", re: /\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4}\b|\d{3,}/ },
  { id: "official", re: /\bofficial(ly)?\b/i },
  { id: "speech", re: /\b(shouts?|says|calls? out|dialogue|voice|music|song|talks?)\b/i },
];

export function checkSceneText(file: NazarScenesFile): string[] {
  const out: string[] = [];
  for (const s of file.scenes) {
    const texts = [
      { where: "scene", text: s.scene },
      ...s.shots.map((x, i) => ({ where: `shot ${i + 1}`, text: x.prompt })),
    ];
    for (const { where, text } of texts) {
      for (const b of SCENE_TEXT_BANS) {
        const m = b.re.exec(text);
        if (m) out.push(`${s.sceneId} ${where}: ${b.id} ("${m[0]}")`);
      }
    }
  }
  return out;
}

/** `promptVersion` must equal the `version` in ai/prompts/clip_generator.md's front matter. */
export function checkScenePromptVersion(file: NazarScenesFile, promptMarkdown: string): string[] {
  const m = /^---[\s\S]*?^version:\s*(\S+)/m.exec(promptMarkdown);
  const id = /^id:\s*(\S+)/m.exec(promptMarkdown)?.[1];
  const out: string[] = [];
  if (!m) return ["ai/prompts/clip_generator.md has no version"];
  if (m[1] !== file.promptVersion)
    out.push(`promptVersion ${file.promptVersion} != clip_generator.md version ${m[1]}`);
  if (id !== file.promptId) out.push(`promptId ${file.promptId} != clip_generator.md id ${id}`);
  return out;
}

/** The committed content/nazar/scenes.schema.json (draft 2020-12, generated from Zod). */
export function nazarScenesJsonSchema(): Record<string, unknown> {
  const body = z.toJSONSchema(NazarScenesFileSchema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
  const { $schema, ...rest } = body;
  return {
    $schema,
    $id: "https://margdarshak.example/content/nazar/scenes.schema.json",
    title: "Nazar scene catalogue for the AI-generated clip bank (ADR-0013)",
    description:
      "content/nazar/scenes.json. Generated from packages/content/src/schema/nazar-scenes.ts by scripts/gen-nazar-schema.ts. Shot-list timing, speed-per-setting and coverage rules are enforced by Zod and src/nazar.ts, not here.",
    ...rest,
  };
}

/** Every check over a parsed file (throws a ZodError on a schema failure first). */
export function runNazarSceneChecks(
  raw: unknown,
  promptMarkdown: string,
): { file: NazarScenesFile; issues: Record<string, string[]> } {
  const file = NazarScenesFileSchema.parse(raw);
  return {
    file,
    issues: {
      coverage: checkSceneCoverage(file),
      ids: checkSceneIds(file),
      text: checkSceneText(file),
      promptVersion: checkScenePromptVersion(file, promptMarkdown),
    },
  };
}
