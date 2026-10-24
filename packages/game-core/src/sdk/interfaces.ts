// Game ⇄ host interfaces (GAME_SDK §4.2). Types only, no DOM: games talk to the recorder, never to
// fetch or storage; the host owns networking, consent and family-mode checks.
import type { A11yMode, GameId, GameMode } from "../schema/ids.ts";
import type { GameManifest, SessionContext } from "../schema/manifest.ts";
import type { SessionResult } from "../schema/result.ts";
import type { EventRecorder } from "./recorder.ts";

export type EndReason = "completed" | "quit" | "timeout";

/** A client-side preview of the result (the server replay result wins). */
export type SessionResultPreview = SessionResult;

export interface GameModule {
  init(ctx: SessionContext, recorder: EventRecorder): void | Promise<void>;
  start(): void;
  /** Mandatory on visibilitychange → hidden. */
  pause(): void;
  resume(): void;
  end(reason: EndReason): void;
  getPreview(): SessionResultPreview | null;
  destroy(): void;
}

export interface GameHost {
  loadGame(manifest: GameManifest): Promise<GameModule>;
  createSession(gameId: GameId, mode: GameMode): Promise<SessionContext>;
  submit(sid: string): Promise<SessionResult | null>;
  getDebrief(sid: string): Promise<unknown>;
  onA11yChange(cb: (modes: readonly A11yMode[]) => void): () => void;
}

/** Media clock for video games: rVFC when available, else currentTime (timingMode "fallback"). */
export interface MediaClock {
  readonly timingMode: "rvfc" | "fallback";
  onFrame(cb: (mediaTimeMs: number) => void): () => void;
  /** Media time (ms) of the frame on screen: what a tap's `mt` is stamped with. */
  currentMs(): number;
}
