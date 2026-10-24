import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import games from "@content/catalogue/games.json";
import { GAME_IDS } from "@margdarshak/content";
import { replay } from "@margdarshak/game-core";
import { DebriefError, debriefCatalogue } from "@margdarshak/game-core/debrief";
import { bandFor, SCORING_VERSIONS } from "@margdarshak/game-core/scoring";
import { createMemoryQueueStore } from "@margdarshak/game-core/sdk/browser";
import { brier } from "@margdarshak/gamification/learning";
import { describe, expect, it } from "vitest";

/**
 * W0b plumbing: the P2 workspace packages resolve from source in Vitest (vitest.config.ts aliases)
 * and in tsc/Next (tsconfig.json paths), and content JSON resolves through `@content/*`.
 */
describe("P2 workspace packages resolve from source", () => {
  it("game-core: root, scoring, debrief and the nested sdk/browser subpath", async () => {
    expect(typeof replay).toBe("function");
    expect(bandFor(0, 0, 5000)).toBe(1);
    expect(bandFor(4999, 0, 5000)).toBe(5);
    expect(SCORING_VERSIONS.nazar).toContain("1.0");
    expect(typeof debriefCatalogue).toBe("function");
    expect(new DebriefError("UNKNOWN_GAME", "m")).toBeInstanceOf(Error);
    const store = createMemoryQueueStore();
    expect(await store.sessions()).toEqual([]);
  });

  it("gamification/learning: pure maths", () => {
    expect(brier([])).toBeNull();
  });

  it("content: schemas, and the catalogue JSON through @content/*", () => {
    expect(GAME_IDS).toContain("nazar");
    const ids = games.games.map((g) => g.game_id);
    expect(ids).toContain("nazar");
    for (const id of ids) expect(GAME_IDS as readonly string[]).toContain(id);
  });

  it("tsconfig paths point at existing source files, and @margdarshak/content/node stays unmapped", () => {
    const web = join(import.meta.dirname, "..", "..");
    const tsconfig = JSON.parse(readFileSync(join(web, "tsconfig.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    const paths = tsconfig.compilerOptions.paths;
    for (const [key, [target]] of Object.entries(paths)) {
      if (!key.startsWith("@margdarshak/") || target === undefined) continue;
      const file = target.replace("/*/index.ts", "/sdk/browser/index.ts");
      expect(existsSync(join(web, file)), `${key} → ${file}`).toBe(true);
    }
    // Disk loaders (node:fs) must never reach client code: no alias, so the import fails to resolve.
    expect(Object.keys(paths).some((k) => k.startsWith("@margdarshak/content/"))).toBe(false);
  });
});
