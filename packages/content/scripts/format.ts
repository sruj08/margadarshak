// Runs the repo's Biome formatter on files a generator just wrote, so committed JSON stays
// `biome check` clean. Drift tests compare parsed JSON, so formatting never affects them.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../src/node.ts";

export function formatWithBiome(paths: readonly string[]): void {
  const biome = join(REPO_ROOT, "node_modules", "@biomejs", "biome", "bin", "biome");
  if (!existsSync(biome)) {
    console.warn("biome not installed; run `biome format --write content` before committing");
    return;
  }
  execFileSync(process.execPath, [biome, "format", "--write", ...paths], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
}
