// Registry of the file-level schemas: one JSON Schema (2020-12) per entry in content/schema/.
import { z } from "zod";
import { AllowlistsFile } from "./allowlists.ts";
import { Module } from "./curriculum.ts";
import { DrillsFile } from "./drills.ts";
import { EnumsFile } from "./enums.ts";
import { FindingsFile } from "./findings.ts";
import { GamesFile } from "./games.ts";
import { HazardTypesFile } from "./hazards.ts";
import { QuestionBankFile } from "./questions.ts";
import { RulesFile } from "./rules.ts";
import { IllustrationsFile, SignsFile } from "./signs.ts";
import { SkillsFile } from "./skills.ts";

export type SchemaEntry = {
  /** File name in content/schema/. */
  file: string;
  title: string;
  description: string;
  schema: z.ZodType;
};

export const SCHEMA_ID_BASE = "https://margdarshak.example/content/schema/";

export const SCHEMAS: readonly SchemaEntry[] = [
  {
    file: "rules.schema.json",
    title: "Rule ID catalogue (DEBRIEF_SPEC §3)",
    description:
      "content/catalogue/rules.json. ai_citable = verified && kind != 'medical'. verified:false rows never enter an AI allowlist.",
    schema: RulesFile,
  },
  {
    file: "findings.schema.json",
    title: "Finding taxonomy with template texts (DEBRIEF_SPEC §2, §9)",
    description:
      "content/catalogue/findings.json. Templates insert numbers only through {{fact:key}} placeholders whose keys are the finding's facts.",
    schema: FindingsFile,
  },
  {
    file: "drills.schema.json",
    title: "Drill ID catalogue (DEBRIEF_SPEC §4)",
    description:
      "content/catalogue/drills.json. Deep links margdarshak://play/<gameId>?drill=<DR-ID>&level=<n>.",
    schema: DrillsFile,
  },
  {
    file: "skills.schema.json",
    title: "Skill-tree nodes (GAMIFICATION_ENGINE §3.1)",
    description: "content/catalogue/skills.json. SK-<module> for every curriculum module.",
    schema: SkillsFile,
  },
  {
    file: "games.schema.json",
    title: "Games as seen by the debrief (GAME_SDK §2.2)",
    description:
      "content/catalogue/games.json. Default drill and how-you-did band templates per game.",
    schema: GamesFile,
  },
  {
    file: "hazard-types.schema.json",
    title: "Nazar hazard types (NAZAR §3.3)",
    description:
      "content/catalogue/hazard_types.json. Labels, skill, rules and the DR-NAZ-OCCL-<TYPE> drill per hazard type.",
    schema: HazardTypesFile,
  },
  {
    file: "enums.schema.json",
    title: "Fact enum labels (DEBRIEF_SPEC §5.2)",
    description:
      "content/catalogue/enums.json. Values drill patterns expand over, with i18n labels.",
    schema: EnumsFile,
  },
  {
    file: "signs.schema.json",
    title: "Sign catalogue (IRC:67 families, SIGN-<cat>-<nnn>)",
    description:
      "content/catalogue/signs.json. Alt text describes shape and symbol, never the meaning.",
    schema: SignsFile,
  },
  {
    file: "illustrations.schema.json",
    title: "Illustration catalogue (LL3 hand signals)",
    description: "content/catalogue/illustrations.json.",
    schema: IllustrationsFile,
  },
  {
    file: "module.schema.json",
    title: "Curriculum module (CURRICULUM §2–§3)",
    description: "content/curriculum/<module>.json for LL0–LL4, M1–M22 and DL1.",
    schema: Module,
  },
  {
    file: "question-bank.schema.json",
    title: "LL question bank, one topic per file (CURRICULUM §2, GAME_DESIGN §11)",
    description:
      "content/questions/<topic>.json. SERVER-ONLY fields: items[].key and concepts[].explanation; split with splitQuestionBank before anything reaches a client.",
    schema: QuestionBankFile,
  },
  {
    file: "allowlists.schema.json",
    title: "Per-agent ID allowlists (generated)",
    description:
      "content/generated/allowlists.json, written by packages/content scripts/gen-allowlists.ts.",
    schema: AllowlistsFile,
  },
];

/** The JSON Schema document for one registry entry (deterministic). */
export function toJsonSchema(entry: SchemaEntry): Record<string, unknown> {
  const body = z.toJSONSchema(entry.schema, { target: "draft-2020-12", io: "input" }) as Record<
    string,
    unknown
  >;
  const { $schema, ...rest } = body;
  return {
    $schema,
    $id: `${SCHEMA_ID_BASE}${entry.file}`,
    title: entry.title,
    description: entry.description,
    ...rest,
  };
}
