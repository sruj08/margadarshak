// nightly_stats (RW-4; ARCHITECTURE §8; plan §2.9 and §2.11.5). Started through API-67
// (`POST /internal/jobs/nightly_stats`) by n8n W14 (hourly during the field test) or W13.
//
//   nightly_stats(args)
//     1. POST /internal/job-steps/study.export_csv {stats_id, as_of}
//          -> {as_of, files: {"sessions.csv", "sessions_alt.csv", "raters.csv"}}   (CSV text)
//        The Go export applies the FIELD_STUDY §7.1 mapping and the trust < 0.6 exclusion.
//     2. Write the CSVs to a private temp dir and run the pre-registered analysis script
//        UNCHANGED (FIELD_STUDY §8.2; its sha256 is pre-registered in HYPOTHESES.md):
//          node field-kit/nazar_stats.mjs sessions.csv raters.csv   (primary)
//          node field-kit/nazar_stats.mjs sessions_alt.csv          (sensitivity score)
//        spawn(process.execPath, [...]) with no shell and a minimal environment.
//     3. Parse what the script prints (parseNazarStats) and POST
//        /internal/job-steps/stats.field_study_publish with the numbers, the raw stdout, the
//        script's sha256 and the sha256 of each input file. Go stores them for API-71.
//
// The task computes no statistic itself: every number comes from the script's stdout.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiClient } from "../lib/api.ts";
import { NonRetryableError } from "../lib/api.ts";
import type { Config } from "../lib/config.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";
import { boundedKey, digestHex } from "./step-keys.ts";

export const TASK_NIGHTLY_STATS = "nightly_stats";
export const STEP_EXPORT_CSV = "study.export_csv";
export const STEP_FIELD_STUDY_PUBLISH = "stats.field_study_publish";
export const CSV_FILES = ["sessions.csv", "sessions_alt.csv", "raters.csv"] as const;
export type CsvFile = (typeof CSV_FILES)[number];
/** Per-file cap on what the export may hand us (the study is ≈ 40–120 participants). */
export const MAX_CSV_BYTES = 4 * 1024 * 1024;
export const SCRIPT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Where the script is looked for when FIELD_KIT_STATS_SCRIPT is unset, in order. Paths are
 * relative to this module, which sits at services/workflows/{src,dist}/tasks/ (four levels below
 * the repo root in both layouts). FIELD_STUDY §8.2 names analysis/nazar_stats.mjs as the copy
 * made after G0; today the file lives in field-kit/.
 */
export const DEFAULT_SCRIPT_CANDIDATES: readonly string[] = [
  "../../../../field-kit/nazar_stats.mjs",
  "../../../../analysis/nazar_stats.mjs",
  "../../../../../field-kit/nazar_stats.mjs",
].map((rel) => fileURLToPath(new URL(rel, import.meta.url)));

// ---- script location and hash -------------------------------------------------------------

export function resolveStatsScript(
  configured: string | undefined,
  candidates: readonly string[] = DEFAULT_SCRIPT_CANDIDATES,
): string {
  const tried = configured ? [resolve(configured)] : candidates;
  for (const p of tried) {
    // realpath: the script only runs main() when argv[1] equals its own (real) module path.
    if (existsSync(p)) return realpathSync(p);
  }
  throw new NonRetryableError(
    STEP_FIELD_STUDY_PUBLISH,
    `nazar_stats.mjs not found (set FIELD_KIT_STATS_SCRIPT); tried ${tried.join(", ")}`,
    undefined,
    0,
  );
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---- running the script --------------------------------------------------------------------

export interface ScriptRun {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type ScriptRunner = (
  script: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<ScriptRun>;

/** Environment for the child: enough for Node to start, none of this service's secrets. */
export function childEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR"]) {
    const v = env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** spawn(process.execPath, [script, ...args]) with no shell; stdout/stderr capped at 64 KB. */
export const runScript: ScriptRunner = (script, args, opts) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: opts.cwd,
      env: childEnv(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d;
    });
    child.stderr.on("data", (d: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, signal, stdout, stderr, timedOut });
    });
  });

// ---- parsing the printed lines -------------------------------------------------------------

/** Every number exactly as printed (already rounded by the script); `nan`/`inf` become null. */
export interface NazarStats {
  /** "N after pre-registered exclusions: n (of total)" */
  readonly n_after_exclusions: number;
  readonly n_total: number;
  /** "H1  below 60/100: k/n = p%  (95% CI lo-hi%)" (Wilson) */
  readonly h1: {
    readonly below_60: number;
    readonly n: number;
    readonly pct: number | null;
    readonly ci95_pct: readonly [number | null, number | null];
  } | null;
  /** "H2  r(LL mock, Nazar) = r  (95% CI lo to hi)" (Fisher z) */
  readonly h2: {
    readonly r: number | null;
    readonly ci95: readonly [number | null, number | null];
  } | null;
  /** "    median late = s s  (~m m at v km/h)" */
  readonly median_late: {
    readonly seconds: number | null;
    readonly metres: number | null;
    readonly speed_kmh: number | null;
  } | null;
  /** "H3  mean gain after feedback = +g/10 per clip, one-sided Wilcoxon p = p" */
  readonly h3: { readonly mean_gain: number | null; readonly wilcoxon_p: number | null } | null;
  /** "    test-retest r = r (n=k)" (only with >= 8 retakes) */
  readonly test_retest: { readonly r: number | null; readonly n: number } | null;
  /** "H4  inter-rater median |d onset| = d s over k clips" (only with raters.csv) */
  readonly h4: { readonly median_abs_onset_delta_s: number | null; readonly clips: number } | null;
}

const NUM = String.raw`([+-]?(?:\d+(?:\.\d+)?|nan|inf))`;
const PCT = String.raw`(\d+|nan)`;
const LINE = {
  n: /^N after pre-registered exclusions: (\d+) \(of (\d+)\)$/,
  h1: new RegExp(String.raw`^H1  below 60/100: (\d+)/(\d+) = ${PCT}%  \(95% CI ${PCT}-${PCT}%\)$`),
  h2: new RegExp(String.raw`^H2  r\(LL mock, Nazar\) = ${NUM}  \(95% CI ${NUM} to ${NUM}\)$`),
  late: new RegExp(String.raw`^    median late = ${NUM} s  \(~${NUM} m at ${NUM} km/h\)$`),
  h3: new RegExp(
    `^H3  mean gain after feedback = ${NUM}/10 per clip, one-sided Wilcoxon p = ${NUM}$`,
  ),
  retest: new RegExp(String.raw`^    test-retest r = ${NUM} \(n=(\d+)\)$`),
  h4: new RegExp(String.raw`^H4  inter-rater median \|d onset\| = ${NUM} s over (\d+) clips$`),
} as const;

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function int(s: string | undefined): number {
  return Number.parseInt(s ?? "", 10);
}

export class StatsOutputError extends NonRetryableError {
  override readonly name: string = "StatsOutputError";
}

function statsError(msg: string): StatsOutputError {
  return new StatsOutputError(STEP_FIELD_STUDY_PUBLISH, `nazar_stats output: ${msg}`, undefined, 0);
}

type Found = {
  -readonly [K in Exclude<keyof NazarStats, "n_after_exclusions" | "n_total">]: NazarStats[K];
};
interface Work extends Found {
  n: RegExpMatchArray | null;
}
type LineHandler = readonly [RegExp, (m: RegExpMatchArray, w: Work) => void];

/** One handler per printed line shape, in the order of the script's print() calls. */
const LINE_HANDLERS: readonly LineHandler[] = [
  [
    LINE.n,
    (m, w) => {
      if (w.n) throw statsError("N printed twice");
      w.n = m;
    },
  ],
  [
    LINE.h1,
    (m, w) => {
      w.h1 = {
        below_60: int(m[1]),
        n: int(m[2]),
        pct: num(m[3]),
        ci95_pct: [num(m[4]), num(m[5])],
      };
    },
  ],
  [
    LINE.h2,
    (m, w) => {
      w.h2 = { r: num(m[1]), ci95: [num(m[2]), num(m[3])] };
    },
  ],
  [
    LINE.late,
    (m, w) => {
      w.median_late = { seconds: num(m[1]), metres: num(m[2]), speed_kmh: num(m[3]) };
    },
  ],
  [
    LINE.h3,
    (m, w) => {
      w.h3 = { mean_gain: num(m[1]), wilcoxon_p: num(m[2]) };
    },
  ],
  [
    LINE.retest,
    (m, w) => {
      w.test_retest = { r: num(m[1]), n: int(m[2]) };
    },
  ],
  [
    LINE.h4,
    (m, w) => {
      w.h4 = { median_abs_onset_delta_s: num(m[1]), clips: int(m[2]) };
    },
  ],
];

/**
 * Parses nazar_stats.mjs stdout. Strict: the format is pre-registered, so an unknown line or a
 * missing H1–H3 block (when n > 0) is an error rather than a guess.
 */
export function parseNazarStats(stdout: string): NazarStats {
  const w: Work = {
    n: null,
    h1: null,
    h2: null,
    median_late: null,
    h3: null,
    test_retest: null,
    h4: null,
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const handler = LINE_HANDLERS.find(([re]) => re.test(line));
    const m = handler ? line.match(handler[0]) : null;
    if (!handler || !m) throw statsError(`unrecognised line ${JSON.stringify(line.slice(0, 120))}`);
    handler[1](m, w);
  }
  const { n, ...found } = w;
  if (!n) throw statsError("no 'N after pre-registered exclusions' line");
  const nAfter = int(n[1]);
  if (nAfter > 0 && (!found.h1 || !found.h2 || !found.median_late || !found.h3)) {
    throw statsError(`n = ${nAfter} but the H1/H2/median late/H3 lines are incomplete`);
  }
  if (found.h1 && found.h1.n !== nAfter) throw statsError(`H1 n ${found.h1.n} != N ${nAfter}`);
  return { n_after_exclusions: nAfter, n_total: int(n[2]), ...found };
}

// ---- the task -----------------------------------------------------------------------------

export interface AnalysisResult {
  readonly file: CsvFile;
  readonly argv: readonly string[];
  readonly stats: NazarStats;
  readonly stdout: string;
  readonly exit_code: number | null;
}

export interface NightlyStatsSummary {
  readonly stats_id: string | null;
  readonly as_of: string | null;
  readonly published: boolean;
  /** Why nothing was published (`stub`, `no_sessions`), or null. */
  readonly reason: string | null;
  readonly script_sha256: string | null;
  readonly n_after_exclusions: number | null;
  readonly sensitivity_n_after_exclusions: number | null;
}

export interface NightlyStatsDeps {
  readonly api: () => ApiClient;
  readonly config: () => Config;
  readonly log?: (msg: string, attrs: Record<string, unknown>) => void;
  /** Test seam; the real spawn by default. */
  readonly runScript?: ScriptRunner;
  readonly scriptCandidates?: readonly string[];
}

const STATS_ID = /^[A-Za-z0-9_\-.:]{1,64}$/;

export function normaliseStatsInput(args: readonly unknown[]): {
  stats_id: string | null;
  as_of: string | null;
} {
  const first = args[0];
  const o =
    first !== null && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : {};
  const id = o["stats_id"];
  if (id !== undefined && id !== null && (typeof id !== "string" || !STATS_ID.test(id))) {
    throw new NonRetryableError(
      STEP_EXPORT_CSV,
      `bad stats_id ${JSON.stringify(id)}`,
      undefined,
      0,
    );
  }
  const asOf = o["as_of"];
  return {
    stats_id: typeof id === "string" ? id : null,
    as_of: typeof asOf === "string" && asOf.length <= 40 ? asOf : null,
  };
}

/** Accepts `{files: {"sessions.csv": "..."}}` or flat `{sessions_csv: "..."}`; absent files are null. */
export function readExport(res: unknown): {
  as_of: string | null;
  stub: boolean;
  files: Record<CsvFile, string | null>;
} {
  if (!res || typeof res !== "object" || Array.isArray(res)) {
    throw new NonRetryableError(STEP_EXPORT_CSV, "export is not an object", undefined, 0);
  }
  const o = res as Record<string, unknown>;
  const nested =
    o["files"] && typeof o["files"] === "object" ? (o["files"] as Record<string, unknown>) : {};
  const files = {} as Record<CsvFile, string | null>;
  for (const f of CSV_FILES) {
    const v = nested[f] ?? o[f.replace(".", "_")];
    if (v !== undefined && v !== null && typeof v !== "string")
      throw new NonRetryableError(STEP_EXPORT_CSV, `${f} is not CSV text`, undefined, 0);
    if (typeof v === "string" && Buffer.byteLength(v, "utf8") > MAX_CSV_BYTES) {
      throw new NonRetryableError(
        STEP_EXPORT_CSV,
        `${f} exceeds ${MAX_CSV_BYTES} bytes`,
        undefined,
        0,
      );
    }
    files[f] = typeof v === "string" ? v : null;
  }
  return {
    as_of: typeof o["as_of"] === "string" ? o["as_of"] : null,
    stub: o["status"] === "stub",
    files,
  };
}

/** Data rows in a CSV (non-empty lines after the header). */
export function csvDataRows(csv: string | null): number {
  if (!csv) return 0;
  return csv.split(/\r?\n/).filter((l) => l.trim() !== "").length - 1;
}

async function analyse(
  run: ScriptRunner,
  script: string,
  dir: string,
  file: CsvFile,
  raters: string | null,
): Promise<AnalysisResult> {
  const argv = [join(dir, file), ...(raters ? [raters] : [])];
  const r = await run(script, argv, { cwd: dir, timeoutMs: SCRIPT_TIMEOUT_MS });
  if (r.timedOut) throw new Error(`nazar_stats ${file}: timed out after ${SCRIPT_TIMEOUT_MS} ms`);
  let stats: NazarStats;
  try {
    stats = parseNazarStats(r.stdout);
  } catch (err) {
    if (r.code !== 0)
      throw new Error(`nazar_stats ${file}: exit ${r.code ?? r.signal}: ${r.stderr.slice(0, 300)}`);
    throw err;
  }
  // The script throws (exit 1) right after printing "N ... 0": that is "no data yet", not a failure.
  if (r.code !== 0 && stats.n_after_exclusions !== 0) {
    throw new Error(`nazar_stats ${file}: exit ${r.code ?? r.signal}: ${r.stderr.slice(0, 300)}`);
  }
  return { file, argv: argv.map((a) => basename(a)), stats, stdout: r.stdout, exit_code: r.code };
}

/** Writes the exported CSVs into `dir` (0600) and returns their sha256 (FIELD_STUDY §8.2 step 2). */
async function writeInputs(
  dir: string,
  files: Record<CsvFile, string | null>,
): Promise<Partial<Record<CsvFile, string>>> {
  const sha: Partial<Record<CsvFile, string>> = {};
  for (const f of CSV_FILES) {
    const text = files[f];
    if (text === null) continue;
    await writeFile(join(dir, f), text, { encoding: "utf8", mode: 0o600 });
    sha[f] = sha256Hex(text);
  }
  return sha;
}

/** The two pre-registered runs: primary (with raters.csv when it has rows) and sensitivity. */
async function runAnalyses(
  run: ScriptRunner,
  script: string,
  dir: string,
  files: Record<CsvFile, string | null>,
): Promise<{ primary: AnalysisResult; sensitivity: AnalysisResult | null }> {
  // An empty raters.csv would make the script fail on median([]); H4 is then simply absent.
  const raters = csvDataRows(files["raters.csv"]) > 0 ? join(dir, "raters.csv") : null;
  const primary = await analyse(run, script, dir, "sessions.csv", raters);
  if (primary.stats.n_after_exclusions === 0 || csvDataRows(files["sessions_alt.csv"]) === 0) {
    return { primary, sensitivity: null };
  }
  const alt = await analyse(run, script, dir, "sessions_alt.csv", null);
  return { primary, sensitivity: alt.stats.n_after_exclusions > 0 ? alt : null };
}

const view = (a: AnalysisResult) => ({ argv: a.argv, stats: a.stats, stdout: a.stdout });

export function defineNightlyStatsTask(
  define: DefineTask,
  deps: NightlyStatsDeps,
): TaskDef<unknown[], NightlyStatsSummary> {
  const log = deps.log ?? (() => {});
  const run = deps.runScript ?? runScript;
  return define(
    {
      name: TASK_NIGHTLY_STATS,
      // ARCHITECTURE §8: 3 retries; 15 min.
      retry: { maxRetries: 3, waitDurationMs: 5_000, backoffScaling: 2 },
      timeoutSeconds: 900,
    },
    async (ctx: TaskCtx, ...args: unknown[]): Promise<NightlyStatsSummary> => {
      const input = normaliseStatsInput(args);
      const cfg = deps.config();
      const api = deps.api();
      const runId = ctx.metadata.taskRunId;
      const scope = runId ?? input.stats_id ?? "adhoc";
      const exp = readExport(
        await api.step(
          STEP_EXPORT_CSV,
          { stats_id: input.stats_id, as_of: input.as_of },
          { runId, idempotencyKey: boundedKey(STEP_EXPORT_CSV, scope) },
        ),
      );
      const base = { stats_id: input.stats_id, as_of: exp.as_of ?? input.as_of };
      const finish = (s: NightlyStatsSummary): NightlyStatsSummary => {
        log("nightly_stats summary", { run_id: runId, ...s });
        return s;
      };
      const empty = {
        published: false,
        script_sha256: null,
        n_after_exclusions: null,
        sensitivity_n_after_exclusions: null,
      };
      if (exp.stub) return finish({ ...base, ...empty, reason: "stub" });
      if (exp.files["sessions.csv"] === null) {
        throw new NonRetryableError(STEP_EXPORT_CSV, "export has no sessions.csv", undefined, 0);
      }
      const script = resolveStatsScript(cfg.fieldKitStatsScript, deps.scriptCandidates);
      const scriptSha = sha256Hex(readFileSync(script));
      const dir = await mkdtemp(join(tmpdir(), "md-nightly-stats-"));
      try {
        const inputsSha = await writeInputs(dir, exp.files);
        const { primary, sensitivity } = await runAnalyses(run, script, dir, exp.files);
        if (primary.stats.n_after_exclusions === 0) {
          return finish({
            ...base,
            ...empty,
            reason: "no_sessions",
            script_sha256: scriptSha,
            n_after_exclusions: 0,
          });
        }
        const publishArgs = {
          ...base,
          script: { name: basename(script), sha256: scriptSha },
          inputs_sha256: inputsSha,
          primary: view(primary),
          sensitivity: sensitivity ? view(sensitivity) : null,
        };
        const contentKey = digestHex([scriptSha, primary.stdout, sensitivity?.stdout ?? ""]);
        await api.step(STEP_FIELD_STUDY_PUBLISH, publishArgs, {
          runId,
          idempotencyKey: boundedKey(STEP_FIELD_STUDY_PUBLISH, scope, contentKey),
        });
        return finish({
          ...base,
          published: true,
          reason: null,
          script_sha256: scriptSha,
          n_after_exclusions: primary.stats.n_after_exclusions,
          sensitivity_n_after_exclusions: sensitivity?.stats.n_after_exclusions ?? null,
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
}
