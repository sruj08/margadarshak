import "./sd.css";
import { GAME_CONFIG, SCORING_VERSIONS } from "@margdarshak/game-core/scoring";
import type { WebGame } from "@/features/games/types";
import { SdResultsExtra } from "./results-extra";
import { StoppingDistanceGame } from "./StoppingDistanceGame";

/**
 * Stopping Distance's web game module (G2, MD-216). Loaded only through `GameStage`'s `load`
 * (`import()`), so this file and everything it imports form the game's chunk, requested when the
 * play stage mounts. Copy: `messages/{en,hi}/sims.json` (`sims.sd`; Hindi pending native review).
 */
if (typeof window !== "undefined") {
  const w = window as unknown as { __mdGames?: Record<string, boolean> };
  w.__mdGames = { ...w.__mdGames, stopping_distance: true };
}

const stoppingDistance: WebGame = {
  gameId: "stopping_distance",
  replayManifest: {
    gameId: "stopping_distance",
    version: "1.0.0",
    scoringVersion: SCORING_VERSIONS.stopping_distance?.[0] ?? "1.0",
    budgets: GAME_CONFIG.budgets.stopping_distance,
  },
  Component: StoppingDistanceGame,
  hostStart: true,
  ResultsExtra: SdResultsExtra,
};

// biome-ignore lint/style/noDefaultExport: the host loads a game module's default WebGame
export default stoppingDistance;
