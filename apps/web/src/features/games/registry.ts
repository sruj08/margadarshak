import type { GameId } from "@margdarshak/game-core/schema";
import type { WebGameExport, WebGameLoader } from "./types";

/**
 * gameId → lazy loader (MD-205). Each entry is a dynamic `import()`, so a game's code is a separate
 * chunk that is requested only when its stage mounts: nothing here enters any route's first load.
 *
 * Adding a game: add one line pointing at the game's module file (default export = `WebGame`), or
 * pass `load` to `GameStage` and leave this file alone (the registry only holds defaults).
 */
export const GAME_REGISTRY: Partial<Record<GameId, WebGameLoader>> = {
  nazar: () => import("@/features/nazar/module"),
};

export class UnknownGameError extends Error {
  constructor(public readonly gameId: string) {
    super(`no web game registered for ${gameId}`);
  }
}

/** Resolves a game's module: the explicit loader first, else the registry. Rejects unknown IDs. */
export async function loadWebGame(gameId: GameId, load?: WebGameLoader): Promise<WebGameExport> {
  const loader = load ?? GAME_REGISTRY[gameId];
  if (loader === undefined) throw new UnknownGameError(gameId);
  const mod = await loader();
  if (mod.default.gameId !== gameId) throw new UnknownGameError(gameId);
  return mod;
}
