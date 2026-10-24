"use client";

import type {
  A11yMode,
  GameId,
  GameManifest,
  GameMode,
  SessionContext,
  SessionResult,
} from "@margdarshak/game-core/schema";
import type { GameHost, GameModule } from "@margdarshak/game-core/sdk";
import { getServerDebrief, startGameSession } from "../api";
import { loadWebGame } from "../registry";
import { getSessionRecord } from "../results-store";
import { a11yModes, onA11yChange } from "./a11y-context";
import { syncPending } from "./queue";

/**
 * game-core's `GameHost` (GAME_SDK §4.2) implemented by the web app. `GameStage` is the React
 * front of the same steps; this object is the imperative surface for code that runs a game without
 * the stage (tests, the field-study flow).
 *
 * `loadGame` returns a headless GameModule only for games whose module object can exist without
 * React; web games register their module from their component, so here it resolves the WebGame and
 * rejects unknown IDs (the stage mounts the component).
 */
export function createWebGameHost(opts: { locale: "en" | "hi" }): GameHost {
  return {
    async loadGame(manifest: GameManifest): Promise<GameModule> {
      await loadWebGame(manifest.gameId);
      throw new Error("web games register their module from GameStage; use <GameStage />");
    },
    async createSession(gameId: GameId, mode: GameMode): Promise<SessionContext> {
      const started = await startGameSession(gameId, { mode, locale: opts.locale });
      return started.start.ctx;
    },
    async submit(sid: string): Promise<SessionResult | null> {
      await syncPending();
      return getSessionRecord(sid)?.checked?.result ?? null;
    },
    async getDebrief(sid: string): Promise<unknown> {
      const r = await getServerDebrief(sid);
      return r.kind === "card" ? r.data : null;
    },
    onA11yChange(cb: (modes: readonly A11yMode[]) => void): () => void {
      return onA11yChange((a) => cb(a11yModes(a)));
    },
  };
}

/** Device class from a cheap capability read (GAME_SDK §3: never from user-agent sniffing). */
export function deviceClass(): "low" | "mid" | "high" {
  if (typeof navigator === "undefined") return "mid";
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem <= 2 || cores <= 2) return "low";
  if (mem >= 8 && cores >= 8) return "high";
  return "mid";
}
