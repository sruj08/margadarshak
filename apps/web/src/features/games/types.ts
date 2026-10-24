/**
 * The web game contract (MD-205): how a game plugs into the host. Types only, so importing this
 * file never pulls game or host code into a bundle. See README.md in this folder.
 */
import type {
  GameContent,
  GameId,
  GameMode,
  NazarClip,
  ReplayManifest,
  SessionContext,
  SessionResult,
  TimingMode,
} from "@margdarshak/game-core/schema";
import type {
  EndReason,
  EventRecorder,
  GameModule,
  SessionLifecycle,
} from "@margdarshak/game-core/sdk";
import type { ComponentType } from "react";
import type { CheckedSessionResult, GameSessionItem, GameSessionStart } from "./api-types";

export type { EndReason };

/**
 * The imperative half of a web game: game-core's `GameModule` plus the timing mode the host
 * writes into `session_start`. The host calls, in order: `init` (await: preload everything; the
 * host shows a determinate ring from `reportProgress`) → `start` → `pause`/`resume` (pause is
 * mandatory on visibilitychange → hidden) → `end` → `destroy`.
 */
export interface WebGameModule extends GameModule {
  /** "rvfc" | "fallback" (video), "sim" (fixed-step sims), "none" (quizzes). */
  readonly timingMode: TimingMode;
  /**
   * Called before `resume()` when the item on screen was voided because the page was hidden
   * (GAME_SDK §6.5): end that item (`item_end` reason "voided") and move on or re-deal it.
   */
  onItemVoided?(): void;
}

/** HUD slots the host draws in its 48 px top bar (UI_SPEC_LEARN_GAMES §4.2). No score in play. */
export interface HudState {
  /** "3/10": the item on screen (1-based) and the total. */
  counter?: { current: number; total: number } | null;
  /** Skill tag chip, already localised (e.g. "Bus stop · pedestrians"). */
  tag?: string | null;
}

/** Display and input options chosen in the brief (persisted on the device). */
export interface GameA11y {
  reducedMotion: boolean;
  screenReaderAlt: boolean;
  tapOnly: boolean;
  leftHanded: boolean;
  largeText: boolean;
  soundOn: boolean;
}

/** What the host knows about the running session, beyond `ctx`. */
export interface HostSession {
  start: GameSessionStart;
  /** "server": API-34 answered. "device": a local session (mock mode or the API unavailable). */
  source: "server" | "device";
  /** Items with their media URLs, client-safe documents and (learn/practice only) reveal windows. */
  items: GameSessionItem[];
  /**
   * "placeholder": no real clip media yet; the game draws a labelled placeholder timeline from
   * the fixture clips. "video": items carry real `asset_url` media.
   */
  media: "video" | "placeholder";
  /** Device sessions only: the full scoring content (fixture clips). Never sent by the server. */
  deviceContent: GameContent | null;
}

export interface WebGameProps {
  ctx: SessionContext;
  session: HostSession;
  recorder: EventRecorder;
  /** Read it; the host owns transitions. */
  lifecycle: SessionLifecycle;
  a11y: GameA11y;
  /** True while the host's pause sheet is open (user pause or page hidden). */
  paused: boolean;
  /** Register the module once on mount; returns the unregister function. */
  register(module: WebGameModule): () => void;
  /** Loading progress while `init` runs (bytes for clips, items otherwise). */
  reportProgress(p: { loaded: number; total: number; unit: "bytes" | "items" }): void;
  /** The item on screen (index into ctx.items) and whether hiding the page voids it. */
  setCurrentItem(item: number | null, timed: boolean): void;
  setHud(hud: HudState): void;
  /** The game finished by itself. The host then calls `end`, writes `session_end` and submits. */
  onEnd(reason: Extract<EndReason, "completed" | "timeout">): void;
}

/** The outcome the results screen and the debrief read. */
export interface SessionOutcome {
  sid: string;
  gameId: GameId;
  mode: GameMode;
  /** API-35 answer, or the device's provisional result; null when nothing could be scored yet. */
  checked: CheckedSessionResult | null;
  /** "verified": server-checked. "provisional": device or verifier-down result. "queued": saved
   * on this phone, submitted when online. */
  status: "verified" | "provisional" | "queued";
  /** Device sessions: the fixture clips (Nazar) for local analysis. */
  clips?: readonly NazarClip[];
}

/** A web game: the React half plus its static description. Default export of a game module file. */
export interface WebGame {
  readonly gameId: GameId;
  /** Version, scoring version and budgets (used for the device preview and the recorder cap). */
  readonly replayManifest: ReplayManifest;
  readonly Component: ComponentType<WebGameProps>;
  /** Show the host's "Ready → Start" step after `init` (default true). */
  readonly hostStart?: boolean;
  /** Extra lines inside the host's results reveal (e.g. Nazar's "spotted 7 of 9"). */
  readonly ResultsExtra?: ComponentType<{ outcome: SessionOutcome }>;
}

/** What a registry loader resolves to: the module file's namespace with a default WebGame. */
export interface WebGameExport {
  default: WebGame;
}

export type WebGameLoader = () => Promise<WebGameExport>;

/** How a clip was made: filmed on Indian roads, or an AI-generated scene (labelled as such). */
export type ClipOrigin = "filmed" | "ai_generated";

/** One clip's media for a device session. */
export interface DeviceMedia {
  url: string;
  bytes?: number;
  sha256?: string;
  posterUrl?: string;
  srAltUrl?: string;
  origin?: ClipOrigin;
}

/** Field-study form (FIELD_STUDY §4.2): A test B1+B2 / fresh B3, B test B2+B3 / fresh B1, C test B1+B3 / fresh B2. */
export type StudyForm = "A" | "B" | "C";

/** Device sessions for games whose items do not come from the game-core fixtures (e.g. LL bank). */
export interface DeviceItems {
  /** Refs and versions, in play order. */
  items: { ref: string; contentVersion: string }[];
  /** Scoring documents by ref (stay on the device; used for the provisional preview only). */
  docs: Readonly<Record<string, unknown>>;
  /** Format rows by rule ID (e.g. LLT-JK), when the game needs one. */
  formats?: Readonly<Record<string, unknown>>;
  /**
   * Clip media by ref (Nazar): a real MP4 URL per clip, e.g. AI-generated scenes delivered as device
   * documents. Without it a device Nazar session uses the labelled placeholder timeline.
   */
  media?: Readonly<Record<string, DeviceMedia>>;
  /** State whose rule-pack rows the session uses (e.g. "KL" for LLT-KL); default from GameStage `tenant`. */
  tenant?: string;
  /** Client-safe documents by ref, handed to the game as `items[].public`. */
  publicDocs?: Readonly<Record<string, Record<string, unknown>>>;
}

export type { SessionResult };
