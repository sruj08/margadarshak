import "@/features/phaser/phaser.css";
import "@/features/stopping-distance/sd.css";
import "./bs.css";
import { GAME_CONFIG, SCORING_VERSIONS } from "@margdarshak/game-core/scoring";
import type { WebGame } from "@/features/games/types";
import { BlindSpotGame } from "./BlindSpotGame";
import { BsResultsExtra } from "./results-extra";

/**
 * Blind Spot's web game module (G3, MD-217). Loaded only through `GameStage`'s `load`
 * (`import()`). Phaser itself is a further lazy chunk, requested by `PhaserMount` only when the
 * canvas variant mounts; the decision version never requests it. Copy: `messages/{en,hi}/sims.json`
 * (`sims.bs`; Hindi pending native review).
 */
if (typeof window !== "undefined") {
  const w = window as unknown as { __mdGames?: Record<string, boolean> };
  w.__mdGames = { ...w.__mdGames, blind_spot: true };
}

const blindSpot: WebGame = {
  gameId: "blind_spot",
  replayManifest: {
    gameId: "blind_spot",
    version: "1.0.0",
    scoringVersion: SCORING_VERSIONS.blind_spot?.[0] ?? "1.0",
    budgets: GAME_CONFIG.budgets.blind_spot,
  },
  Component: BlindSpotGame,
  hostStart: true,
  ResultsExtra: BsResultsExtra,
};

// biome-ignore lint/style/noDefaultExport: the host loads a game module's default WebGame
export default blindSpot;
