/**
 * Real-mode global teardown: Playwright ends its web servers with a hard kill on Windows, which
 * leaves the embedded PostgreSQL of scripts/real-api.mjs running. Stop it cleanly here (only the
 * e2e instance in services/api/.cache/e2e/pgdata; a developer's dev database is never touched).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REAL } from "../real-env.mjs";

const work = REAL.workDir;

// biome-ignore lint/style/noDefaultExport: Playwright's globalTeardown loads the default export
export default async function teardown() {
  const pgdata = join(work, "pgdata");
  if (!existsSync(join(pgdata, "postmaster.pid"))) return;
  const exe = process.platform === "win32" ? ".exe" : "";
  const binRoot = join(work, "pgwork", "bin");
  const pgCtl = [join(binRoot, "bin", `pg_ctl${exe}`), join(binRoot, `pg_ctl${exe}`)].find((p) =>
    existsSync(p),
  );
  if (pgCtl) spawnSync(pgCtl, ["stop", "-D", pgdata, "-m", "fast", "-w"], { stdio: "ignore" });
}
