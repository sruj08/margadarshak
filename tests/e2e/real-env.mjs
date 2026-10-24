/**
 * Full-stack e2e settings (E2E_MODE=real), shared by playwright.config.ts, scripts/real-api.mjs and
 * the real-*.spec.ts files. Test-only values: never use them in a deployed environment.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const apiPort = Number(env["E2E_API_PORT"] ?? 8010);
const webPort = Number(env["E2E_PORT"] ?? 3100);
// Two real-mode runs can share a checkout (parallel agents, CI shards): give each its own work dir
// (database, binaries, log) and web build dir. Defaults keep the original single-run layout.
const workDir = env["E2E_WORK_DIR"] ?? join(here, "..", "..", "services", "api", ".cache", "e2e");

export const REAL = {
  apiPort,
  webPort,
  pgPort: Number(env["E2E_PG_PORT"] ?? 5459),
  apiUrl: env["E2E_API_URL"] ?? `http://localhost:${apiPort}`,
  webUrl: `http://localhost:${webPort}`,
  hmacSecret: env["E2E_INTERNAL_HMAC_SECRET"] ?? "e2e-internal-hmac-secret",
  internalToken: env["E2E_INTERNAL_TOKEN"] ?? "e2e-internal-token",
  labToken: env["E2E_LAB_TOKEN"] ?? "e2e-lab-token",
  workDir,
  nextDistDir: env["E2E_NEXT_DIST_DIR"] ?? ".next-real",
  // The score verifier (TS compute service) the API calls; real-api.mjs starts it from source.
  verifierUrl: env["SCORE_VERIFIER_URL"] ?? "http://127.0.0.1:8081",
  verifierSecret: env["SCORE_VERIFIER_SHARED_SECRET"] ?? "dev-only-verifier-secret",
  apiLog: env["E2E_API_LOG"] ?? join(workDir, "api.log"),
};
