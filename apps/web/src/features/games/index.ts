// biome-ignore-all lint/performance/noBarrelFile: the documented public surface of the game host (README.md).
/**
 * Public API of the game host (MD-205). Documented in ./README.md; agents D and E code against it.
 *
 * Pages: import client components from their own file (the paths in the comments below), not from
 * this barrel, so a brief page never pulls the host (recorder, zod schemas) into its first load.
 * Types can come from here freely (`import type` costs nothing).
 */

// API facade (src/features/games/api.ts).
export {
  API_MODE,
  completeGameSession,
  GameApiError,
  getGameSessionReplay,
  getServerDebrief,
  listNazarClips,
  startGameSession,
  Unavailable,
} from "./api";
// Contract (types only).
export type {
  CheckedSessionResult,
  GameSessionItem,
  GameSessionReplay,
  GameSessionStart,
  HazardWindowWire,
  NazarClipAnalysisWire,
} from "./api-types";
// Brief (src/features/games/brief/PreGameBrief.tsx).
export type { BriefMode, PreGameBriefProps } from "./brief/PreGameBrief";
export { PreGameBrief } from "./brief/PreGameBrief";
// Accessibility context (src/features/games/host/a11y-context.tsx).
export {
  a11yModes,
  currentA11y,
  GameA11yProvider,
  useGameA11y,
} from "./host/a11y-context";
// The stage (src/features/games/host/GameStage.tsx): load it with next/dynamic({ ssr: false }).
export type { GameStageProps } from "./host/GameStage";
export { GameStage } from "./host/GameStage";
export { createWebGameHost, deviceClass } from "./host/game-host";
export { useOnline } from "./host/online";
export { syncPending } from "./host/queue";
// HUD pieces (src/features/games/hud/*).
export { GameHud } from "./hud/GameHud";
export { PauseSheet } from "./hud/PauseSheet";
export { NotCountedNote, TRUST_COUNTED_MIN } from "./integrity/NotCountedNote";
// Registry (src/features/games/registry.ts).
export { GAME_REGISTRY, loadWebGame, UnknownGameError } from "./registry";
export { ResultsReveal, shownScore } from "./results/ResultsReveal";
export type { SessionRecord } from "./results-store";
export { getSessionRecord, listSessionRecords } from "./results-store";
// Screen states (src/features/games/states.tsx).
export { OfflineNote, StateEmpty, StateError, StateLoading } from "./states";
export type {
  DeviceItems,
  EndReason,
  GameA11y,
  HostSession,
  HudState,
  SessionOutcome,
  WebGame,
  WebGameExport,
  WebGameLoader,
  WebGameModule,
  WebGameProps,
} from "./types";
