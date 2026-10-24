// The parsed content pack and its pure (environment-free) parser. Loading from disk lives in
// node.ts so this module also runs in the browser and in the score verifier.
import type { z } from "zod";
import { type Module, Module as ModuleSchema } from "./schema/curriculum.ts";
import { type DrillsFile, DrillsFile as DrillsSchema } from "./schema/drills.ts";
import { type EnumsFile, EnumsFile as EnumsSchema } from "./schema/enums.ts";
import { type FindingsFile, FindingsFile as FindingsSchema } from "./schema/findings.ts";
import { type GamesFile, GamesFile as GamesSchema } from "./schema/games.ts";
import { HazardTypesFile as HazardsSchema, type HazardTypesFile } from "./schema/hazards.ts";
import { QuestionBankFile as BankSchema, type QuestionBankFile } from "./schema/questions.ts";
import { type RulesFile, RulesFile as RulesSchema } from "./schema/rules.ts";
import {
  type IllustrationsFile,
  IllustrationsFile as IllustrationsSchema,
  type SignsFile,
  SignsFile as SignsSchema,
} from "./schema/signs.ts";
import { type SkillsFile, SkillsFile as SkillsSchema } from "./schema/skills.ts";

export type Content = {
  rules: RulesFile;
  findings: FindingsFile;
  drills: DrillsFile;
  skills: SkillsFile;
  games: GamesFile;
  hazardTypes: HazardTypesFile;
  enums: EnumsFile;
  signs: SignsFile;
  illustrations: IllustrationsFile;
  /** Ordered LL0–LL4, M1–M22, DL1. */
  modules: Module[];
  /** Ordered LL1–LL4. */
  questionBanks: QuestionBankFile[];
};

/** Unvalidated JSON as read from content/ (keys mirror Content). */
export type RawContent = {
  [K in keyof Content]: Content[K] extends unknown[] ? unknown[] : unknown;
};

export class ContentError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`content failed validation:\n  ${issues.join("\n  ")}`);
    this.name = "ContentError";
    this.issues = issues;
  }
}

function parseOne<S extends z.ZodType>(
  schema: S,
  value: unknown,
  label: string,
  issues: string[],
): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  for (const i of r.error.issues) {
    issues.push(`${label}: ${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
  }
  return value as z.infer<S>;
}

/** Validates every file against its schema. Throws ContentError listing all schema issues. */
export function parseContent(raw: RawContent): Content {
  const issues: string[] = [];
  const content: Content = {
    rules: parseOne(RulesSchema, raw.rules, "catalogue/rules.json", issues),
    findings: parseOne(FindingsSchema, raw.findings, "catalogue/findings.json", issues),
    drills: parseOne(DrillsSchema, raw.drills, "catalogue/drills.json", issues),
    skills: parseOne(SkillsSchema, raw.skills, "catalogue/skills.json", issues),
    games: parseOne(GamesSchema, raw.games, "catalogue/games.json", issues),
    hazardTypes: parseOne(HazardsSchema, raw.hazardTypes, "catalogue/hazard_types.json", issues),
    enums: parseOne(EnumsSchema, raw.enums, "catalogue/enums.json", issues),
    signs: parseOne(SignsSchema, raw.signs, "catalogue/signs.json", issues),
    illustrations: parseOne(
      IllustrationsSchema,
      raw.illustrations,
      "catalogue/illustrations.json",
      issues,
    ),
    modules: raw.modules.map((m, i) =>
      parseOne(ModuleSchema, m, `curriculum[${i}] ${moduleLabel(m)}`, issues),
    ),
    questionBanks: raw.questionBanks.map((b, i) =>
      parseOne(BankSchema, b, `questions[${i}] ${topicLabel(b)}`, issues),
    ),
  };
  if (issues.length > 0) throw new ContentError(issues);
  return content;
}

function moduleLabel(m: unknown): string {
  return typeof m === "object" && m !== null && "module_id" in m ? String(m.module_id) : "?";
}
function topicLabel(b: unknown): string {
  return typeof b === "object" && b !== null && "topic" in b ? String(b.topic) : "?";
}

/** Module file order used by loaders and generators. */
export const MODULE_ORDER: readonly string[] = [
  "LL0",
  "LL1",
  "LL2",
  "LL3",
  "LL4",
  ...Array.from({ length: 22 }, (_, i) => `M${i + 1}`),
  "DL1",
];
