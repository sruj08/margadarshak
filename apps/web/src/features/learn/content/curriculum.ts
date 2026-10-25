import games from "@content/catalogue/games.json";
import skills from "@content/catalogue/skills.json";
import DL1 from "@content/curriculum/DL1.json";
import LL0 from "@content/curriculum/LL0.json";
import LL1 from "@content/curriculum/LL1.json";
import LL2 from "@content/curriculum/LL2.json";
import LL3 from "@content/curriculum/LL3.json";
import LL4 from "@content/curriculum/LL4.json";
import M1 from "@content/curriculum/M1.json";
import M2 from "@content/curriculum/M2.json";
import M3 from "@content/curriculum/M3.json";
import M4 from "@content/curriculum/M4.json";
import M5 from "@content/curriculum/M5.json";
import M6 from "@content/curriculum/M6.json";
import M7 from "@content/curriculum/M7.json";
import M8 from "@content/curriculum/M8.json";
import M9 from "@content/curriculum/M9.json";
import M10 from "@content/curriculum/M10.json";
import M11 from "@content/curriculum/M11.json";
import M12 from "@content/curriculum/M12.json";
import M13 from "@content/curriculum/M13.json";
import M14 from "@content/curriculum/M14.json";
import M15 from "@content/curriculum/M15.json";
import M16 from "@content/curriculum/M16.json";
import M17 from "@content/curriculum/M17.json";
import M18 from "@content/curriculum/M18.json";
import M19 from "@content/curriculum/M19.json";
import M20 from "@content/curriculum/M20.json";
import M21 from "@content/curriculum/M21.json";
import M22 from "@content/curriculum/M22.json";

/**
 * Curriculum index for the learn screens (CURRICULUM §1, UI_SPEC_LEARN_GAMES §2.1). Server-only:
 * the 28 module files are 170 KB, so pages pass the trimmed, single-locale result to client
 * components as props. Text is the reviewed content pack's own; nothing here is generated.
 */

import type { AppLocale } from "@/i18n/routing";

type Locale = AppLocale;
type Loc = { en: string; hi: string } & Partial<Record<Locale, string>>;

function pickLoc(loc: Loc, locale: Locale): string {
  return loc[locale] ?? (locale === "hi" || locale === "doi" || locale === "mr" ? loc.hi : loc.en);
}

interface RawSource {
  title: string;
  url: string | null;
  checked_on: string | null;
}
interface RawModule {
  module_id: string;
  track: string;
  title: Loc;
  phase_1_2_depth: string;
  available_to: string | string[];
  skill_id: string;
  game_ids: string[];
  learning_objectives: { id: string; text: Loc }[];
  lessons: { id: string; title: Loc }[];
  key_facts: {
    id: string;
    text: Loc;
    sources: RawSource[];
    confidence: string;
    verified: boolean;
  }[];
  misconceptions: { id: string; myth: Loc; correction: Loc }[];
}

const RAW = [
  LL0,
  LL1,
  LL2,
  LL3,
  LL4,
  M1,
  M2,
  M3,
  M4,
  M5,
  M6,
  M7,
  M8,
  M9,
  M10,
  M11,
  M12,
  M13,
  M14,
  M15,
  M16,
  M17,
  M18,
  M19,
  M20,
  M21,
  M22,
  DL1,
] as unknown as RawModule[];

export type Branch = "ll" | "survival" | "dl";
export type Depth = "deep" | "thin" | "coming";

export interface KeyFact {
  id: string;
  text: string;
  source: string | null;
  sourceUrl: string | null;
  checkedOn: string | null;
  verified: boolean;
}

export interface ModuleSummary {
  id: string;
  nodeId: string;
  branch: Branch;
  title: string;
  short: string;
  depth: Depth;
  /** Only for these tenants (the J&K hill pack), or null for everyone. */
  tenants: string[] | null;
  games: string[];
  lessons: { id: string; title: string }[];
  /** Display order prerequisites (only SK-DL1 has a hard requirement). */
  follows: string[];
  /** Shown in the skill tree (the rest are lesson-only cards). */
  inTree: boolean;
}

export interface ModuleDetail extends ModuleSummary {
  objectives: string[];
  facts: KeyFact[];
  myths: { id: string; myth: string; correction: string }[];
}

interface RawSkill {
  skill_id: string;
  title: Loc;
  follows: string[];
  in_skill_tree: boolean;
}
const SKILLS = new Map(
  (skills as unknown as { skills: RawSkill[] }).skills.map((s) => [s.skill_id, s] as const),
);

function branchOf(track: string): Branch {
  if (track.startsWith("A_")) return "ll";
  if (track.startsWith("DL")) return "dl";
  return "survival";
}

function depthOf(raw: string): Depth {
  const d = raw.toLowerCase();
  if (d.startsWith("deep")) return "deep";
  if (d.startsWith("not built") || d.startsWith("storyboard")) return "coming";
  return "thin";
}

function summary(m: RawModule, locale: Locale): ModuleSummary {
  const skill = SKILLS.get(m.skill_id);
  return {
    id: m.module_id,
    nodeId: m.skill_id,
    branch: branchOf(m.track),
    title: pickLoc(m.title, locale),
    short: skill ? pickLoc(skill.title, locale) : pickLoc(m.title, locale),
    depth: depthOf(m.phase_1_2_depth),
    tenants: Array.isArray(m.available_to) ? m.available_to : null,
    games: m.game_ids,
    lessons: m.lessons.map((l) => ({ id: l.id, title: pickLoc(l.title, locale) })),
    follows: skill?.follows ?? [],
    inTree: skill?.in_skill_tree ?? false,
  };
}

export function moduleIndex(locale: Locale): ModuleSummary[] {
  return RAW.map((m) => summary(m, locale));
}

export function moduleByNode(nodeId: string, locale: Locale): ModuleDetail | null {
  const m = RAW.find((r) => r.skill_id === nodeId);
  if (!m) return null;
  return {
    ...summary(m, locale),
    objectives: m.learning_objectives.map((o) => pickLoc(o.text, locale)),
    facts: m.key_facts.map((f) => {
      const src = f.sources[0];
      return {
        id: f.id,
        text: pickLoc(f.text, locale),
        source: src?.title ?? null,
        sourceUrl: src?.url ?? null,
        checkedOn: src?.checked_on ?? null,
        verified: f.verified,
      };
    }),
    myths: m.misconceptions.map((x) => ({
      id: x.id,
      myth: pickLoc(x.myth, locale),
      correction: pickLoc(x.correction, locale),
    })),
  };
}

export function allNodeIds(): string[] {
  return RAW.map((m) => m.skill_id);
}

export function allLessonIds(): string[] {
  return RAW.flatMap((m) => m.lessons.map((l) => l.id));
}

/** The module and position of a lesson ID ("LS-M1-2" → M1, index 1). */
export function lessonLookup(
  lessonId: string,
  locale: Locale,
): { module: ModuleDetail; index: number } | null {
  for (const m of RAW) {
    const index = m.lessons.findIndex((l) => l.id === lessonId);
    if (index >= 0) {
      const module = moduleByNode(m.skill_id, locale);
      return module ? { module, index } : null;
    }
  }
  return null;
}

interface RawGame {
  game_id: string;
  code: string;
  title: Loc;
  module_ids: string[];
  build_depth_phase_1_2: string;
  medical_review_required: boolean;
}

export interface GameTile {
  id: string;
  code: string;
  title: string;
  depth: "deep" | "thin" | "storyboard";
  modules: string[];
  draft: boolean;
}

export function gameTiles(locale: Locale): GameTile[] {
  return (games as unknown as { games: RawGame[] }).games.map((g) => ({
    id: g.game_id,
    code: g.code,
    title: pickLoc(g.title, locale),
    depth:
      g.build_depth_phase_1_2 === "deep"
        ? "deep"
        : g.build_depth_phase_1_2 === "thin"
          ? "thin"
          : "storyboard",
    modules: g.module_ids,
    draft: g.medical_review_required,
  }));
}

export function gameTitle(gameId: string, locale: Locale): string {
  const g = (games as unknown as { games: RawGame[] }).games.find((x) => x.game_id === gameId);
  return g ? pickLoc(g.title, locale) : gameId;
}

/** URL slug of a game's own route (`learn/practise/<slug>`), owned by each game's workstream. */
export function gameSlug(gameId: string): string {
  return gameId.replaceAll("_", "-");
}
