#!/usr/bin/env node
/**
 * Full-stack e2e: starts the Go API (services/api) on embedded PostgreSQL 16 with the synthetic
 * demo personas, for `E2E_MODE=real pnpm test:e2e:real` (playwright.config.ts starts this script as
 * a webServer). No Docker. Everything it writes stays in services/api/.cache/e2e (gitignored):
 *   pgdata/     the database (recreated on every start, so each run begins from the seed)
 *   pgwork/     the PostgreSQL binaries for this instance
 *   api.log     the API's JSON log; specs read it to assert the W02 envelope (N8N_BASE_URL unset)
 * Ports and secrets come from tests/e2e/real-env.mjs, shared with the Playwright config and specs.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { REAL } from "../real-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..", "..", "..", "services", "api");
const work = REAL.workDir;
const exe = process.platform === "win32" ? ".exe" : "";
mkdirSync(work, { recursive: true });

/**
 * The case clock never nudges in quiet hours (21:00-08:00 IST, MD-130). When the run happens at
 * night, shift the API clock (DEV_CLOCK_OFFSET, dev only) to 12:00 IST of the same IST date so the
 * sweep spec is deterministic; specs set the browser clock to the API's time (GET /v1/health).
 */
function clockOffset() {
  if (process.env["E2E_CLOCK_OFFSET"] !== undefined) return process.env["E2E_CLOCK_OFFSET"];
  const istMs = Date.now() + 5.5 * 3600_000;
  const hour = new Date(istMs).getUTCHours();
  if (hour >= 8 && hour < 21) return "";
  const noon = new Date(istMs);
  noon.setUTCHours(12, 0, 0, 0);
  return `${Math.round((noon.getTime() - istMs) / 1000)}s`;
}

const env = {
  ...process.env,
  DEV_CLOCK_OFFSET: clockOffset(),
  APP_ENV: "dev",
  DEV_EMBEDDED_PG: "true",
  EMBEDDED_POSTGRES_PORT: String(REAL.pgPort),
  // Relative to services/api: the Go side joins these onto the module directory.
  EMBEDDED_POSTGRES_DATA: relative(apiDir, join(work, "pgdata")).replaceAll("\\", "/"),
  MD_CACHE_DIR: relative(apiDir, work).replaceAll("\\", "/"),
  PORT: String(REAL.apiPort),
  PUBLIC_BASE_URL: REAL.apiUrl,
  WEB_BASE_URL: REAL.webUrl,
  CORS_ALLOWED_ORIGINS: `${REAL.webUrl},${REAL.webUrl.replace("localhost", "127.0.0.1")}`,
  INTERNAL_HMAC_SECRET: REAL.hmacSecret,
  INTERNAL_BEARER_TOKENS: REAL.internalToken,
  LAB_TOKENS: REAL.labToken,
  DEMO_MODE: "true",
  N8N_BASE_URL: "",
  JOB_RUNNER: "inline",
  // Same adapter modes as the Render demo (infra/render.yaml) and CI: synthetic government data,
  // so the hand-off shows the Simulated chip from the API provenance (MD-045).
  ADAPTER_SARATHI: "mock",
  ADAPTER_DIGILOCKER: "mock",
  ADAPTER_PAYMENT: "mock",
  ADAPTER_BHASHINI: "mock",
  ADAPTER_SLOT: "mock",
  OTEL_SDK_DISABLED: "true",
  // The suites open many anonymous device sessions from one IP (default limit 10/h/IP).
  DEV_DEVICE_SESSION_RATE_LIMIT: process.env["E2E_DEVICE_SESSION_LIMIT"] ?? "1000",
  SCORE_VERIFIER_URL: REAL.verifierUrl,
  SCORE_VERIFIER_SHARED_SECRET: REAL.verifierSecret,
};
if (!env.DEV_CLOCK_OFFSET) delete env.DEV_CLOCK_OFFSET;
else console.log(`[real-api] quiet hours now: API clock shifted by ${env.DEV_CLOCK_OFFSET}`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: apiDir, env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[real-api] ${cmd} ${args.join(" ")} failed (${r.status})`);
    process.exit(1);
  }
}

// A force-killed previous run (Playwright ends web servers with a hard kill on Windows) can leave
// its PostgreSQL running; stop it before recreating the data directory.
const pgdata = join(work, "pgdata");
if (existsSync(join(pgdata, "postmaster.pid"))) {
  const binRoot = join(work, "pgwork", "bin");
  const candidates = [join(binRoot, "bin", `pg_ctl${exe}`), join(binRoot, `pg_ctl${exe}`)];
  const pgCtl = candidates.find((c) => existsSync(c));
  if (pgCtl) spawnSync(pgCtl, ["stop", "-D", pgdata, "-m", "fast", "-w"], { stdio: "inherit" });
}
rmSync(pgdata, { recursive: true, force: true });
if (existsSync(join(work, "pgwork", "run"))) {
  for (const f of readdirSync(join(work, "pgwork", "run")))
    rmSync(join(work, "pgwork", "run", f), { recursive: true, force: true });
}

run("go", ["build", "-o", join(work, `api${exe}`), "./cmd/api"]);
run("go", ["build", "-o", join(work, `seed${exe}`), "./cmd/seed"]);
run(join(work, `seed${exe}`), ["--profile", "demo", "--synthetic"]);

// The score verifier, from source: build its server-side content (answer keys, formats; gitignored)
// once, then serve it on REAL.verifierUrl unless something already answers there.
const repo = join(apiDir, "..", "..");
const verifierDir = join(repo, "services", "score-verifier");
const verifierContent = join(verifierDir, "content");
const nodeTs = ["--conditions=margdarshak-source", "--experimental-strip-types"];
let verifier = null;
const verifierPort = new URL(REAL.verifierUrl).port || "80";
let verifierAlive = false;
try {
  verifierAlive = (await fetch(`${REAL.verifierUrl}/healthz`)).ok;
} catch {}
if (!verifierAlive) {
  if (!existsSync(join(verifierContent, "q"))) {
    const b = spawnSync(
      process.execPath,
      [...nodeTs, join(verifierDir, "scripts", "build-content.ts")],
      {
        cwd: verifierDir,
        stdio: "inherit",
      },
    );
    if (b.status !== 0)
      console.error("[real-api] verifier build:content failed; LL answers will 503");
  }
  verifier = spawn(process.execPath, [...nodeTs, join(verifierDir, "src", "server.ts")], {
    cwd: verifierDir,
    env: {
      ...process.env,
      PORT: verifierPort,
      VERIFIER_SHARED_SECRET: REAL.verifierSecret,
      VERIFIER_CONTENT_DIR: verifierContent,
      VERIFIER_BODY_LIMIT_BYTES: "1048576",
    },
    stdio: "inherit",
  });
}

// The seed's PostgreSQL has just stopped; on Windows its binaries can stay locked for a moment and
// the API's embedded start then fails to unpack them. Retry a start that dies early.
const log = createWriteStream(REAL.apiLog, { flags: "w" });
let api = null;
function serve(attempt) {
  const started = Date.now();
  api = spawn(join(work, `api${exe}`), ["serve"], { cwd: apiDir, env });
  api.stdout.on("data", (b) => {
    log.write(b);
    process.stdout.write(b);
  });
  api.stderr.on("data", (b) => {
    log.write(b);
    process.stderr.write(b);
  });
  api.on("exit", (code) => {
    if (code !== 0 && Date.now() - started < 60_000 && attempt < 5) {
      console.error(`[real-api] API exited early (${code}); retrying (${attempt + 1}/5)`);
      setTimeout(() => serve(attempt + 1), 3000);
      return;
    }
    log.end();
    verifier?.kill();
    process.exit(code ?? 0);
  });
}
serve(0);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    api?.kill(sig);
    verifier?.kill(sig);
  });
