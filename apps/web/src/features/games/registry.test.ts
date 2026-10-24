import { describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => vi.fn());

vi.mock("@/features/nazar/module", () => {
  loaded();
  return {
    default: {
      gameId: "nazar",
      replayManifest: {
        gameId: "nazar",
        version: "1.0.0",
        scoringVersion: "1.0",
        budgets: { maxEvents: 2000, maxSessionSeconds: 1200 },
      },
      Component: () => null,
    },
  };
});

describe("game registry (MD-205: no game code before the game opens)", () => {
  it("imports a game's module only when the game is loaded", async () => {
    const { GAME_REGISTRY, loadWebGame } = await import("./registry");
    expect(typeof GAME_REGISTRY.nazar).toBe("function");
    expect(loaded).not.toHaveBeenCalled();
    const mod = await loadWebGame("nazar");
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(mod.default.gameId).toBe("nazar");
  });

  it("rejects unknown games and a module that is not the asked game", async () => {
    const { loadWebGame, UnknownGameError } = await import("./registry");
    await expect(loadWebGame("hill_road")).rejects.toBeInstanceOf(UnknownGameError);
    await expect(
      loadWebGame("blind_spot", async () => ({
        default: {
          gameId: "nazar",
          replayManifest: {
            gameId: "nazar",
            version: "1.0.0",
            scoringVersion: "1.0",
            budgets: { maxEvents: 1, maxSessionSeconds: 1 },
          },
          Component: () => null,
        },
      })),
    ).rejects.toBeInstanceOf(UnknownGameError);
  });

  it("the stage and the brief never import the registry or a game module statically", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const here = import.meta.dirname;
    const read = (p: string) => readFileSync(join(here, p), "utf8");
    const brief = read("brief/PreGameBrief.tsx") + read("../nazar/NazarBrief.tsx");
    expect(brief).not.toMatch(/registry|nazar\/module|host\/GameStage/);
    // The play page reaches the stage only through next/dynamic.
    expect(read("../nazar/NazarPlay.tsx")).toMatch(
      /dynamic\(\s*\(\) => import\("@\/features\/games\/host\/GameStage"\)/,
    );
  });
});
