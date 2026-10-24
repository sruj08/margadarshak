import { GAME_CONFIG } from "@margdarshak/game-core/scoring";
import type { WebGame } from "@/features/games/types";
import { NazarPlayer } from "./NazarPlayer";
import { NazarResultsExtra } from "./results-extra";

/**
 * Nazar's web game module (G1). Loaded only through the host registry (`import()`), so this file
 * and everything it imports form the Nazar chunk, requested when the play stage mounts. The marker
 * below lets the e2e smoke test prove the chunk was not loaded earlier.
 */
if (typeof window !== "undefined") {
  const w = window as unknown as { __mdGames?: Record<string, boolean> };
  w.__mdGames = { ...w.__mdGames, nazar: true };
}

const nazar: WebGame = {
  gameId: "nazar",
  replayManifest: {
    gameId: "nazar",
    version: "1.0.0",
    scoringVersion: "1.0",
    budgets: GAME_CONFIG.budgets.nazar,
  },
  Component: NazarPlayer,
  hostStart: true,
  ResultsExtra: NazarResultsExtra,
};

// biome-ignore lint/style/noDefaultExport: the registry loads a game module's default WebGame
export default nazar;
