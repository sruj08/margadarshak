// nightly_stats (RW-4): runs the REAL pre-registered field-kit/nazar_stats.mjs on the fixture CSVs
// in test/fixtures/field-study and checks the parser against what the script actually prints.
// The Go steps (study.export_csv, stats.field_study_publish) are faked.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { NonRetryableError } from "../src/lib/api.ts";
import { defineTasks } from "../src/tasks/index.ts";
import {
  CSV_FILES,
  childEnv,
  csvDataRows,
  DEFAULT_SCRIPT_CANDIDATES,
  type NazarStats,
  parseNazarStats,
  readExport,
  resolveStatsScript,
  runScript,
  STEP_EXPORT_CSV,
  STEP_FIELD_STUDY_PUBLISH,
  StatsOutputError,
  TASK_NIGHTLY_STATS,
} from "../src/tasks/nightly-stats.ts";
import { type Call, ENV, fakeCtx, fakeFetch, fakeSdk } from "./helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "field-study");
const SCRIPT = join(HERE, "..", "..", "..", "field-kit", "nazar_stats.mjs");
const fixture = (f: string) => readFileSync(join(FIX, f), "utf8");
const SCRIPT_SHA = createHash("sha256").update(readFileSync(SCRIPT)).digest("hex");

/** The stats.field_study_publish args the task sends. */
interface Published {
  script: { name: string; sha256: string };
  inputs_sha256: Record<string, string>;
  primary: { argv: string[]; stats: NazarStats; stdout: string };
  sensitivity: { argv: string[]; stats: NazarStats; stdout: string } | null;
}

/** What the real script prints for the fixtures (checked against a live run below). */
const PRIMARY_STDOUT = [
  "N after pre-registered exclusions: 12 (of 23)",
  "H1  below 60/100: 7/12 = 58%  (95% CI 32-81%)",
  "H2  r(LL mock, Nazar) = 0.61  (95% CI 0.05 to 0.88)",
  "    median late = 0.72 s  (~6 m at 32 km/h)",
  "H3  mean gain after feedback = +0.88/10 per clip, one-sided Wilcoxon p = 0.0014",
  "    test-retest r = 0.99 (n=8)",
  "H4  inter-rater median |d onset| = 0.25 s over 5 clips",
  "",
].join("\n");

function fakeStudyApi(files: Partial<Record<string, string | null>> | "stub") {
  const published: Call[] = [];
  const f = fakeFetch((call) => {
    assert.ok(call.signature.ok, `bad signature on ${call.path}`);
    if (call.path === `/internal/job-steps/${STEP_EXPORT_CSV}`) {
      if (files === "stub") return { status: 200, body: { step: STEP_EXPORT_CSV, status: "stub" } };
      const result = { as_of: "2026-10-24T15:00:00Z", files };
      return { status: 200, body: { ...result, step: STEP_EXPORT_CSV, result } };
    }
    if (call.path === `/internal/job-steps/${STEP_FIELD_STUDY_PUBLISH}`) {
      published.push(call);
      return { status: 200, body: { step: STEP_FIELD_STUDY_PUBLISH, stored: true } };
    }
    return { status: 404, body: { title: "unknown step" } };
  });
  return { ...f, published };
}

function setup(api: ReturnType<typeof fakeStudyApi>, env: Record<string, string> = {}) {
  const sdk = fakeSdk();
  const tasks = defineTasks(sdk.define, {
    env: { ...ENV, ...env },
    fetch: api.fetch,
    log: () => {},
  });
  return { sdk, tasks };
}

const allFiles = () => ({
  "sessions.csv": fixture("sessions.csv"),
  "sessions_alt.csv": fixture("sessions_alt.csv"),
  "raters.csv": fixture("raters.csv"),
});

describe("nazar_stats.mjs output parser", () => {
  it("reads every line the script prints", () => {
    assert.deepEqual(parseNazarStats(PRIMARY_STDOUT), {
      n_after_exclusions: 12,
      n_total: 23,
      h1: { below_60: 7, n: 12, pct: 58, ci95_pct: [32, 81] },
      h2: { r: 0.61, ci95: [0.05, 0.88] },
      median_late: { seconds: 0.72, metres: 6, speed_kmh: 32 },
      h3: { mean_gain: 0.88, wilcoxon_p: 0.0014 },
      test_retest: { r: 0.99, n: 8 },
      h4: { median_abs_onset_delta_s: 0.25, clips: 5 },
    });
  });

  it("maps nan to null, keeps signs, and allows the optional lines to be absent", () => {
    const out = parseNazarStats(
      [
        "N after pre-registered exclusions: 3 (of 5)",
        "H1  below 60/100: 3/3 = 100%  (95% CI 44-100%)",
        "H2  r(LL mock, Nazar) = -0.50  (95% CI nan to nan)",
        "    median late = 1.10 s  (~12 m at 40 km/h)",
        "H3  mean gain after feedback = -0.20/10 per clip, one-sided Wilcoxon p = nan",
      ].join("\r\n"),
    );
    assert.deepEqual(out.h2, { r: -0.5, ci95: [null, null] });
    assert.deepEqual(out.h3, { mean_gain: -0.2, wilcoxon_p: null });
    assert.equal(out.test_retest, null);
    assert.equal(out.h4, null);
  });

  it("accepts the n = 0 output (the script stops after the N line)", () => {
    const out = parseNazarStats("N after pre-registered exclusions: 0 (of 4)\n");
    assert.equal(out.n_after_exclusions, 0);
    assert.equal(out.h1, null);
  });

  it("is strict: unknown lines, a missing block or a changed format are errors", () => {
    assert.throws(() => parseNazarStats(`${PRIMARY_STDOUT}H5  something new\n`), StatsOutputError);
    assert.throws(() => parseNazarStats(PRIMARY_STDOUT.replace(/^H2.*\n/m, "")), /incomplete/);
    assert.throws(
      () => parseNazarStats(PRIMARY_STDOUT.replace("H1  below", "H1 below")),
      StatsOutputError,
    );
    assert.throws(() => parseNazarStats(PRIMARY_STDOUT.replace("7/12", "7/11")), /H1 n 11 != N 12/);
    assert.throws(() => parseNazarStats(""), /no 'N after/);
  });
});

describe("the real field-kit/nazar_stats.mjs", () => {
  it("is found by default, unchanged, and prints what the parser expects on the fixtures", async () => {
    assert.ok(existsSync(SCRIPT), SCRIPT);
    assert.equal(resolveStatsScript(undefined).toLowerCase(), SCRIPT.toLowerCase());
    assert.equal(DEFAULT_SCRIPT_CANDIDATES.length, 3);
    const r = await runScript(SCRIPT, [join(FIX, "sessions.csv"), join(FIX, "raters.csv")], {
      cwd: FIX,
      timeoutMs: 30_000,
    });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, PRIMARY_STDOUT);
  });

  it("gives the child no secrets from this service's environment", () => {
    const env = childEnv({
      PATH: "/bin",
      INTERNAL_HMAC_SECRET: "s",
      R2_SECRET_ACCESS_KEY: "k",
      SystemRoot: "C:\\Windows",
    });
    assert.deepEqual(env, { PATH: "/bin", SystemRoot: "C:\\Windows" });
  });
});

describe("nightly_stats task (RW-4)", () => {
  it("is registered with 3 retries and a 15 min timeout", () => {
    const { sdk, tasks } = setup(fakeStudyApi(allFiles()));
    assert.equal(tasks.nightlyStats.name, TASK_NIGHTLY_STATS);
    assert.deepEqual(sdk.registered.get(TASK_NIGHTLY_STATS), {
      name: "nightly_stats",
      retry: { maxRetries: 3, waitDurationMs: 5000, backoffScaling: 2 },
      timeoutSeconds: 900,
    });
  });

  it("exports, runs the script twice (primary + sensitivity) and publishes numbers, stdout and sha256", async () => {
    const api = fakeStudyApi(allFiles());
    const { tasks } = setup(api);
    const ctx = fakeCtx();
    const out = await tasks.nightlyStats.func(ctx, { stats_id: "stats-2026-10-24T15" });
    assert.deepEqual(out, {
      stats_id: "stats-2026-10-24T15",
      as_of: "2026-10-24T15:00:00Z",
      published: true,
      reason: null,
      script_sha256: SCRIPT_SHA,
      n_after_exclusions: 12,
      sensitivity_n_after_exclusions: 8,
    });
    assert.deepEqual(
      api.calls.map((c) => c.path),
      [`/internal/job-steps/${STEP_EXPORT_CSV}`, `/internal/job-steps/${STEP_FIELD_STUDY_PUBLISH}`],
    );
    assert.deepEqual(api.calls[0]!.json!.args, { stats_id: "stats-2026-10-24T15", as_of: null });
    const pub = api.published[0]!;
    const args = pub.json!.args as unknown as Published;
    assert.equal(pub.json!.run_id, ctx.metadata.taskRunId);
    assert.deepEqual(args.script, { name: "nazar_stats.mjs", sha256: SCRIPT_SHA });
    assert.equal(args.primary.stdout, PRIMARY_STDOUT);
    assert.deepEqual(args.primary.argv, ["sessions.csv", "raters.csv"]);
    assert.deepEqual(args.primary.stats, parseNazarStats(PRIMARY_STDOUT));
    assert.deepEqual(args.sensitivity!.argv, ["sessions_alt.csv"]);
    assert.equal(args.sensitivity!.stats.h1!.pct, 50);
    assert.equal(args.sensitivity!.stats.h4, null, "the sensitivity run has no raters.csv");
    for (const f of CSV_FILES) {
      assert.equal(args.inputs_sha256[f], createHash("sha256").update(fixture(f)).digest("hex"), f);
    }
    for (const c of api.calls) {
      const k = c.headers["idempotency-key"]!;
      assert.ok(k.length >= 16 && k.length <= 64, k);
    }
    assert.ok(pub.body.length < 16 * 1024);
  });

  it("publishes the same key for the same results (a retried publish dedupes)", async () => {
    const api = fakeStudyApi(allFiles());
    const { tasks } = setup(api);
    const ctx = fakeCtx();
    await tasks.nightlyStats.func(ctx, {});
    await tasks.nightlyStats.func(ctx, {});
    const keys = api.published.map((c) => c.headers["idempotency-key"]);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
  });

  it("skips H4 when raters.csv has no rows and skips the sensitivity run without sessions_alt.csv", async () => {
    const api = fakeStudyApi({
      "sessions.csv": fixture("sessions.csv"),
      "raters.csv": "clip_id,rater_a_onset_s,rater_b_onset_s\n",
    });
    const { tasks } = setup(api);
    const out = await tasks.nightlyStats.func(fakeCtx(), {});
    assert.equal(out.published, true);
    const args = api.published[0]!.json!.args as unknown as Published;
    assert.deepEqual(args.primary.argv, ["sessions.csv"]);
    assert.equal(args.primary.stats.h4, null);
    assert.equal(args.sensitivity, null);
    assert.equal(csvDataRows("a,b\n\n"), 0);
    assert.equal(csvDataRows(null), 0);
  });

  it("publishes nothing before any session survives the exclusions (script exits 1 after N = 0)", async () => {
    const header = fixture("sessions.csv").split("\n")[0];
    const api = fakeStudyApi({
      "sessions.csv": `${header}\nP-099,10,50,5,6,0.5,30,20,1,1,\n`,
      "sessions_alt.csv": `${header}\n`,
      "raters.csv": "",
    });
    const { tasks } = setup(api);
    const out = await tasks.nightlyStats.func(fakeCtx(), {});
    assert.deepEqual(
      { published: out.published, reason: out.reason, n: out.n_after_exclusions },
      { published: false, reason: "no_sessions", n: 0 },
    );
    assert.equal(api.published.length, 0);
  });

  it("ends without running the script while study.export_csv is the P2 stub", async () => {
    const api = fakeStudyApi("stub");
    const { tasks } = setup(api);
    const out = await tasks.nightlyStats.func(fakeCtx(), {});
    assert.equal(out.reason, "stub");
    assert.equal(api.published.length, 0);
  });

  it("fails without retrying when the configured script is missing or the export is malformed", async () => {
    const api = fakeStudyApi(allFiles());
    const { tasks } = setup(api, { FIELD_KIT_STATS_SCRIPT: join(FIX, "does-not-exist.mjs") });
    await assert.rejects(tasks.nightlyStats.func(fakeCtx(), {}), NonRetryableError);
    assert.throws(() => readExport({ files: { "sessions.csv": 42 } }), NonRetryableError);
    assert.deepEqual(readExport({ sessions_csv: "a\n" }).files, {
      "sessions.csv": "a\n",
      "sessions_alt.csv": null,
      "raters.csv": null,
    });
    const noSessions = fakeStudyApi({ "raters.csv": fixture("raters.csv") });
    await assert.rejects(
      setup(noSessions).tasks.nightlyStats.func(fakeCtx(), {}),
      /no sessions.csv/,
    );
  });

  it("uses FIELD_KIT_STATS_SCRIPT when set", async () => {
    const api = fakeStudyApi(allFiles());
    const { tasks } = setup(api, { FIELD_KIT_STATS_SCRIPT: SCRIPT });
    const out = await tasks.nightlyStats.func(fakeCtx(), {});
    assert.equal(out.script_sha256, SCRIPT_SHA);
  });
});
