// Builds the verifier's server-side content directory and the committed game-items index.
//
//   node --conditions=margdarshak-source --experimental-strip-types scripts/build-content.ts \
//     [--out <dir>] [--index <file>] [--no-index]          (= pnpm build:content)
//
// Writes (default --out services/score-verifier/content, gitignored: it holds the server key):
//   q/<item>.json            one game-core LlAnswerKey per bank question (practice and mock), from
//                            @margdarshak/content toLlAnswerKeys(splitQuestionBank().serverKey, signs)
//   formats/LLT-<state>.json each state pack row overriding PRM-LL-FORMAT (LlExamFormat)
//   formats/HPT-<state>.json each state pack row overriding PRM-HPT with a format (HptFormat)
//   sd/ bs/ js/ track/       Stopping Distance, Blind Spot, Junction Scan and Track Twin documents
//                            copied from the game-core golden fixtures until authored content exists
//   BUILD.json               what was written (no timestamps)
// and the committed, deterministic index content/generated/game-items.json (repo root) that the
// Go API selects playable items from. Nazar clips are not written: Go sends `clip:` documents
// inline from content.clip_scoring.
//
// Provenance is never invented: source_url, verified_on (the row's checkedOn) and confidence come
// from the rule-pack row, null when the row has none. Two values the rows do not carry are derived
// and recorded in the index notes: HPT total_marks = clips × marksPerClip, and
// max_hazards_per_clip = 2 from NAZAR §8 ("10 per clip, up to 2 hazards per clip", as reported).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitQuestionBank, toLlAnswerKeys } from "@margdarshak/content";
import {
  loadContent,
  REPO_ROOT,
  type RulepackFiles,
  readRulepacks,
} from "@margdarshak/content/node";
import { GAME_CORE_VERSION } from "@margdarshak/game-core";
import { fixtureContentDocs, manifestFor } from "@margdarshak/game-core/fixtures";
import {
  BsItem,
  type GameId,
  HptFormat,
  JsItem,
  LlAnswerKey,
  LlExamFormat,
  SdRound,
  TrackSpec,
} from "@margdarshak/game-core/schema";
import { ITEM_KIND, SCORING_VERSIONS, SUPPORTED_GAMES } from "@margdarshak/game-core/scoring";
import type { z } from "zod";
import { refToPath } from "../src/content-store.ts";

export const VERIFIER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUT = join(VERIFIER_ROOT, "content");
export const GAME_ITEMS_PATH = join(REPO_ROOT, "content", "generated", "game-items.json");
export const GAME_ITEMS_SCHEMA = "margdarshak.game-items/1";
const GENERATOR = "services/score-verifier/scripts/build-content.ts";
const MARKER = "BUILD.json";

/** Kinds copied from the game-core fixtures (no authored content yet). */
const FIXTURE_KINDS: Readonly<Record<string, z.ZodType>> = {
  sd: SdRound,
  bs: BsItem,
  js: JsItem,
  track: TrackSpec,
};

export interface GameItem {
  ref: string;
  contentVersion: string;
  /** Curator difficulty 1–5 where known; null otherwise. */
  difficulty: number | null;
  /** LL only: the bank pool ("practice" | "mock"), topic and concept (the FSRS card). */
  pool?: string;
  topic?: string;
  conceptId?: string;
}

export interface GameEntry {
  gameId: GameId;
  itemKind: string;
  /** The game manifest version game-core declares (fixture manifest; no per-game constant yet). */
  gameVersion: string;
  /** Newest loaded scoring version, and every loaded one (SCORING_VERSIONS). */
  scoringVersion: string;
  scoringVersions: string[];
  /** Where the items come from. */
  source: "content/questions" | "game-core-fixtures" | "api";
  /** Rule-pack format rows the game needs that the verifier has (formats/). */
  formats: string[];
  items: GameItem[];
}

export interface GameItemsIndex {
  schema: typeof GAME_ITEMS_SCHEMA;
  generator: string;
  gameCoreVersion: string;
  /** sha256 (16 hex) over the canonical JSON of `games` and `formats`: changes with any item. */
  contentVersion: string;
  notes: string[];
  formats: {
    ruleId: string;
    row: string;
    verified: boolean;
    confidence: string | null;
    checkedOn: string | null;
    derived: string[];
  }[];
  games: GameEntry[];
}

export interface BuiltContent {
  /** Relative path (forward slashes) → document. */
  files: Map<string, unknown>;
  index: GameItemsIndex;
}

type Row = { id: string; overrides?: string; verified?: boolean; [k: string]: unknown };

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${what} is not an integer`);
  return v;
};

/** Provenance of a rule-pack row as the game-core format fields. */
function provenance(row: Row) {
  return {
    source_url: str(obj(row["source"])["url"]),
    verified_on: str(row["checkedOn"]),
    confidence: (str(row["confidence"]) ?? null) as "high" | "medium" | "low" | null,
  };
}

/** LLT-<state> and HPT-<state> rows from the state packs, validated against game-core. */
export function formatRows(packs: RulepackFiles): {
  rows: Map<string, unknown>;
  meta: GameItemsIndex["formats"];
} {
  const rows = new Map<string, unknown>();
  const meta: GameItemsIndex["formats"] = [];
  const states = Object.keys(packs)
    .filter((f) => /^states\/[A-Z]{2,7}\.json$/.test(f))
    .sort();
  for (const file of states) {
    const state = file.slice("states/".length, -".json".length);
    for (const row of (packs[file]?.rules ?? []) as Row[]) {
      const value = obj(obj(row["output"])["value"]);
      const common = {
        row: row.id,
        verified: row.verified === true,
        confidence: str(row["confidence"]),
        checkedOn: str(row["checkedOn"]),
      };
      if (row.overrides === "PRM-LL-FORMAT") {
        if (value["timerSeconds"] !== null && value["timerSeconds"] !== undefined) {
          // The pack does not say whether the timer is per question or total: decide, then map it.
          throw new Error(`${row.id}: timerSeconds is set; map it to per_q or total explicitly`);
        }
        const questions = int(value["questions"], `${row.id}.questions`);
        const derived: string[] = [];
        let pass: number;
        if (typeof value["passCorrect"] === "number") pass = int(value["passCorrect"], row.id);
        else {
          pass = Math.ceil((questions * int(value["passPct"], `${row.id}.passPct`)) / 100);
          derived.push("pass = ceil(questions × passPct / 100)");
        }
        const ruleId = `LLT-${state}`;
        rows.set(
          ruleId,
          LlExamFormat.parse({
            rule_id: ruleId,
            state,
            known: value["known"] === true,
            questions,
            pass,
            per_q_timer_s: null,
            total_timer_s: null,
            ...provenance(row),
          }),
        );
        meta.push({ ruleId, ...common, derived });
      } else if (row.overrides === "PRM-HPT" && typeof value["clips"] === "number") {
        const clips = int(value["clips"], `${row.id}.clips`);
        const marks = int(value["marksPerClip"], `${row.id}.marksPerClip`);
        const ruleId = `HPT-${state}`;
        rows.set(
          ruleId,
          HptFormat.parse({
            rule_id: ruleId,
            clips,
            marks_per_clip: marks,
            max_hazards_per_clip: 2,
            pass: int(value["passMark"], `${row.id}.passMark`),
            total_marks: clips * marks,
            status: value["status"],
            ...provenance(row),
          }),
        );
        meta.push({
          ruleId,
          ...common,
          derived: [
            "total_marks = clips × marksPerClip",
            "max_hazards_per_clip = 2 (NAZAR §8, as reported; not in the rule-pack row)",
          ],
        });
      }
    }
  }
  meta.sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1));
  return { rows, meta };
}

const byRef = (a: { ref: string }, b: { ref: string }): number =>
  a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Everything the build writes, in memory (deterministic; used by the drift tests). */
export function buildContent(): BuiltContent {
  const content = loadContent();
  const files = new Map<string, unknown>();
  const put = (ref: string, doc: unknown): void => {
    files.set(refToPath(ref).replaceAll("\\", "/"), doc);
  };

  // LL answer keys (server-only), validated against game-core's schema.
  const split = splitQuestionBank(content.questionBanks);
  const keys = toLlAnswerKeys(split.serverKey, content.signs.signs).map((k) =>
    LlAnswerKey.parse(k),
  );
  for (const k of keys) put(`q:${k.qref}`, k);
  const bankVersion = new Map<string, string>(
    content.questionBanks.map((b) => [b.topic, b.version]),
  );
  const pool = new Map(split.serverKey.keys.map((k) => [k.item_id, k.pool]));
  const llItems: GameItem[] = keys
    .map((k) => ({
      ref: `q:${k.qref}`,
      contentVersion: bankVersion.get(k.topic) ?? "unknown",
      difficulty: null,
      pool: pool.get(k.qref) ?? "unknown",
      topic: k.topic,
      conceptId: k.cardId,
    }))
    .sort(byRef);

  // Rule-pack format rows.
  const formats = formatRows(readRulepacks());
  for (const [id, row] of formats.rows) files.set(`formats/${id}.json`, row);

  // Fixture documents for the sims (until authored content exists).
  const fixtureItems = new Map<string, GameItem[]>();
  for (const [ref, doc] of Object.entries(fixtureContentDocs())) {
    const kind = ref.slice(0, ref.indexOf(":"));
    const schema = FIXTURE_KINDS[kind];
    if (schema === undefined) continue;
    const parsed = schema.parse(doc);
    put(ref, parsed);
    const version = kind === "track" ? String((parsed as { version: number }).version) : "1";
    const list = fixtureItems.get(kind) ?? [];
    list.push({ ref, contentVersion: version, difficulty: null });
    fixtureItems.set(kind, list);
  }

  const formatIds = [...formats.rows.keys()];
  const games: GameEntry[] = [...SUPPORTED_GAMES].sort().map((gameId) => {
    const kind = ITEM_KIND[gameId] as string;
    const versions = [...(SCORING_VERSIONS[gameId] ?? [])];
    const source: GameEntry["source"] =
      gameId === "ll_sim" ? "content/questions" : gameId === "nazar" ? "api" : "game-core-fixtures";
    const items =
      gameId === "ll_sim" ? llItems : gameId === "nazar" ? [] : [...(fixtureItems.get(kind) ?? [])];
    return {
      gameId,
      itemKind: kind,
      gameVersion: manifestFor(gameId).version,
      scoringVersion: versions[versions.length - 1] ?? "",
      scoringVersions: versions,
      source,
      formats: formatIds
        .filter(
          (id) =>
            (gameId === "nazar" ? id.startsWith("HPT-") : false) ||
            (gameId === "ll_sim" && id.startsWith("LLT-")),
        )
        .sort(),
      items: items.sort(byRef),
    };
  });

  const notes = [
    "Generated by services/score-verifier `pnpm build:content`; do not edit by hand (a drift test compares it with the generator).",
    "Stopping Distance, Blind Spot, Junction Scan and Track Twin items are the game-core golden-fixture documents (source: game-core-fixtures) until authored content exists.",
    "Nazar clips are not listed: the Go API selects them from content.clips and sends their scoring documents inline to /verify.",
    "LL answer keys never appear here; the verifier holds them in its gitignored content/q directory.",
    "LL tenants without an LLT-<state> row use game-core's default format (15 questions, 9 to pass, passRule.source = design).",
  ];
  const body = { formats: formats.meta, games };
  const index: GameItemsIndex = {
    schema: GAME_ITEMS_SCHEMA,
    generator: GENERATOR,
    gameCoreVersion: GAME_CORE_VERSION,
    contentVersion: createHash("sha256").update(canonical(body)).digest("hex").slice(0, 16),
    notes,
    ...body,
  };
  files.set(MARKER, {
    generator: GENERATOR,
    contentVersion: index.contentVersion,
    counts: {
      q: keys.length,
      formats: formats.rows.size,
      fixtures: [...fixtureItems.values()].reduce((s, l) => s + l.length, 0),
    },
  });
  return { files, index };
}

/** Writes the content directory (replacing an earlier build) and optionally the index. */
export function writeContent(built: BuiltContent, out: string, indexPath: string | null): void {
  const dir = resolve(out);
  if (existsSync(dir)) {
    if (!existsSync(join(dir, MARKER)))
      throw new Error(`${dir} exists and was not written by build-content; refusing to replace it`);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const [rel, doc] of built.files) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  }
  if (indexPath !== null) {
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, `${JSON.stringify(built.index, null, 2)}\n`, "utf8");
  }
}

/** Reads the committed index (for the drift test). */
export function readGameItems(path: string = GAME_ITEMS_PATH): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(argv: readonly string[]): void {
  let out = DEFAULT_OUT;
  let index: string | null = GAME_ITEMS_PATH;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = resolve(argv[++i] ?? "");
    else if (a === "--index") index = resolve(argv[++i] ?? "");
    else if (a === "--no-index") index = null;
    else throw new Error(`unknown argument ${a}`);
  }
  const built = buildContent();
  writeContent(built, out, index);
  const counts = obj(obj(built.files.get(MARKER))["counts"]);
  process.stdout.write(
    `${JSON.stringify({ out, index, contentVersion: built.index.contentVersion, counts })}\n`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
