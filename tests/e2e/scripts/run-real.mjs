#!/usr/bin/env node
/**
 * `pnpm test:e2e:real`: builds apps/web into .next-real with NEXT_PUBLIC_API_URL pointing at the
 * e2e API (skip with E2E_SKIP_BUILD=1), then runs Playwright in real mode. Extra arguments go to
 * `playwright test` (e.g. `pnpm test:e2e:real -- --grep Kabir`).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REAL } from "../real-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const shell = process.platform === "win32";
const env = { ...process.env, E2E_MODE: "real" };

if (process.env["E2E_SKIP_BUILD"] !== "1") {
  const b = spawnSync("pnpm", ["--filter", "@margdarshak/web", "exec", "next", "build"], {
    cwd: root,
    stdio: "inherit",
    shell,
    env: {
      ...env,
      NEXT_DIST_DIR: REAL.nextDistDir,
      NEXT_PUBLIC_API_URL: REAL.apiUrl,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

// With shell: true (Windows needs it to find pnpm.cmd) arguments are joined, so quote the ones
// with spaces.
const args = process.argv
  .slice(2)
  .filter((a) => a !== "--")
  .map((a) => (shell && /\s/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a));
const r = spawnSync("pnpm", ["exec", "playwright", "test", ...args], {
  cwd: join(here, ".."),
  stdio: "inherit",
  shell,
  env,
});
process.exit(r.status ?? 1);
