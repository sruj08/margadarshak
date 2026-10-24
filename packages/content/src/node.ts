// Node-only loaders: read content/ (and, read-only, rulepacks/) from disk.
//
//   import { loadContent } from "@margdarshak/content/node";
//   const content = loadContent();               // validated, throws ContentError on any issue
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allowlistInputs, buildAllowlists, canonicalJson } from "./allowlists.ts";
import { type Content, MODULE_ORDER, parseContent, type RawContent } from "./model.ts";
import { runNazarSceneChecks } from "./nazar.ts";
import type { AllowlistsFile } from "./schema/allowlists.ts";
import { LL_TOPICS } from "./schema/common.ts";
import type { NazarScenesFile } from "./schema/nazar-scenes.ts";

/** The repo root (packages/content/src → ../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const CONTENT_DIR = join(REPO_ROOT, "content");
export const RULEPACKS_DIR = join(REPO_ROOT, "rulepacks");
/** ADR-0013 scene catalogue for the AI-generated Nazar clip bank. */
export const NAZAR_SCENES_PATH = join(CONTENT_DIR, "nazar", "scenes.json");
export const NAZAR_SCENES_SCHEMA_PATH = join(CONTENT_DIR, "nazar", "scenes.schema.json");
export const CLIP_GENERATOR_PROMPT_PATH = join(REPO_ROOT, "ai", "prompts", "clip_generator.md");

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Raw (unvalidated) JSON of every content file, in canonical order. */
export function readRawContent(dir: string = CONTENT_DIR): RawContent {
  const cat = (f: string) => readJson(join(dir, "catalogue", f));
  const moduleFiles = new Set(readdirSync(join(dir, "curriculum")));
  const modules = MODULE_ORDER.filter((id) => moduleFiles.has(`${id}.json`)).map((id) =>
    readJson(join(dir, "curriculum", `${id}.json`)),
  );
  const questionBanks = LL_TOPICS.map((t) =>
    readJson(join(dir, "questions", `${t.toLowerCase()}.json`)),
  );
  return {
    rules: cat("rules.json"),
    findings: cat("findings.json"),
    drills: cat("drills.json"),
    skills: cat("skills.json"),
    games: cat("games.json"),
    hazardTypes: cat("hazard_types.json"),
    enums: cat("enums.json"),
    signs: cat("signs.json"),
    illustrations: cat("illustrations.json"),
    modules,
    questionBanks,
  };
}

/** Loads and schema-validates the whole content pack. */
export function loadContent(dir: string = CONTENT_DIR): Content {
  return parseContent(readRawContent(dir));
}

/** A rule-pack row as far as content needs it (rulepacks/ is owned by the RULES agent). */
export type RulepackRow = { id: string; verified?: boolean; [k: string]: unknown };
export type RulepackFiles = { [file: string]: { rules?: RulepackRow[]; classes?: RulepackRow[] } };

/** Reads rulepacks/base, states and classes.json, keyed by path relative to rulepacks/. */
export function readRulepacks(dir: string = RULEPACKS_DIR): RulepackFiles {
  const out: RulepackFiles = {};
  out["base/cmvr.json"] = readJson(join(dir, "base", "cmvr.json")) as RulepackFiles[string];
  out["classes.json"] = readJson(join(dir, "classes.json")) as RulepackFiles[string];
  for (const f of readdirSync(join(dir, "states"))
    .filter((x) => x.endsWith(".json"))
    .sort()) {
    out[`states/${f}`] = readJson(join(dir, "states", f)) as RulepackFiles[string];
  }
  return out;
}

/** D-19 wording-ban terms owned by the repo's copy lint (scripts/lint_wording.terms.json). */
export function readWordingTerms(
  root: string = REPO_ROOT,
): { id: string; pattern: string; lang: string }[] {
  const file = readJson(join(root, "scripts", "lint_wording.terms.json")) as {
    terms: { id: string; pattern: string; lang: string }[];
  };
  return file.terms;
}

/** sha256 of the canonical JSON of each allowlist input (see allowlistInputs). */
export function hashInputs(inputs: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(inputs).sort()) {
    out[k] = createHash("sha256").update(canonicalJson(inputs[k]), "utf8").digest("hex");
  }
  return out;
}

/** Builds the allowlists for the content pack on disk. */
export function generateAllowlists(content: Content): AllowlistsFile {
  return buildAllowlists(content, hashInputs(allowlistInputs(content)));
}

/** Writes JSON with a trailing newline (Biome then normalises the layout). */
export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Reads, schema-validates and cross-checks content/nazar/scenes.json against
 * ai/prompts/clip_generator.md. Throws on a schema failure; returns the issues of the other checks.
 */
export function loadNazarScenes(
  path: string = NAZAR_SCENES_PATH,
  promptPath: string = CLIP_GENERATOR_PROMPT_PATH,
): { file: NazarScenesFile; issues: Record<string, string[]> } {
  return runNazarSceneChecks(readJson(path), readFileSync(promptPath, "utf8"));
}
