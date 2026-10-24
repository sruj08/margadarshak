// Browser glue for games (GAME_SDK §4, EC-18): pause on visibilitychange and the video media clock.
// The DOM appears only as the structural slices below, so game-core needs no DOM lib.

import type { MediaClock } from "../interfaces.ts";
import { ABANDON_AFTER_MS, type SessionLifecycle } from "../lifecycle.ts";
import type { EventRecorder } from "../recorder.ts";

export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface VisibilityBinding {
  lifecycle: SessionLifecycle;
  recorder: EventRecorder;
  /** GameModule.pause(): pausing on hidden is mandatory (GAME_SDK §4.2). */
  pauseGame(): void;
  /** Index of the item on screen, or null between items. */
  currentItem(): number | null;
  /** Whether that item is timed (a Nazar clip, a timed question): hiding it voids the item. */
  itemIsTimed(): boolean;
  /** Host clock in ms (performance.now); enables the 10-minute abandon rule. */
  now?: () => number;
}

/**
 * Pauses the game when the page is hidden: records `visibility_hidden` and a hidden `pause` (the
 * integrity check voids a timed item from these events), moves the lifecycle to Paused or
 * ItemVoided, and calls the game's pause. Back after 10 minutes hidden, the session is abandoned.
 * Resuming stays a user action. Returns the unbind function.
 */
export function bindVisibility(doc: VisibilitySource, b: VisibilityBinding): () => void {
  let hiddenAt: number | null = null;
  const listener = (): void => {
    if (doc.visibilityState === "hidden") {
      if (b.lifecycle.state !== "Running") return;
      const item = b.currentItem();
      const at = item === null ? {} : { item };
      b.recorder.emit("visibility_hidden", {}, at);
      b.recorder.emit("pause", { cause: "hidden" }, at);
      b.lifecycle.send({ type: "hidden", timedItem: item !== null && b.itemIsTimed() });
      b.pauseGame();
      hiddenAt = b.now?.() ?? null;
      return;
    }
    if (hiddenAt !== null && b.now !== undefined && b.now() - hiddenAt >= ABANDON_AFTER_MS) {
      if (b.lifecycle.can({ type: "abandon" })) b.lifecycle.send({ type: "abandon" });
    }
    hiddenAt = null;
  };
  doc.addEventListener("visibilitychange", listener);
  return () => doc.removeEventListener("visibilitychange", listener);
}

export interface VideoLike {
  readonly currentTime: number;
  requestVideoFrameCallback?(cb: (now: number, metadata: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

/** requestAnimationFrame / cancelAnimationFrame, for the fallback clock. */
export interface FrameScheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

const ms = (seconds: number): number => Math.max(0, Math.round(seconds * 1000));

/**
 * The Nazar media clock: `requestVideoFrameCallback` media time when the browser has it, else
 * `currentTime` on animation frames, reported as timingMode "fallback" (which the integrity check
 * flags and the Nazar Score never counts).
 */
export function createMediaClock(video: VideoLike, scheduler: FrameScheduler): MediaClock {
  const rvfc = typeof video.requestVideoFrameCallback === "function";
  let lastFrameMs: number | null = null;
  return {
    timingMode: rvfc ? "rvfc" : "fallback",
    currentMs: () => (rvfc && lastFrameMs !== null ? lastFrameMs : ms(video.currentTime)),
    onFrame(cb) {
      let active = true;
      let handle = 0;
      if (rvfc) {
        const tick = (_now: number, meta: { mediaTime: number }): void => {
          if (!active) return;
          lastFrameMs = ms(meta.mediaTime);
          cb(lastFrameMs);
          handle = video.requestVideoFrameCallback?.(tick) ?? 0;
        };
        handle = video.requestVideoFrameCallback?.(tick) ?? 0;
        return () => {
          active = false;
          video.cancelVideoFrameCallback?.(handle);
        };
      }
      const tick = (): void => {
        if (!active) return;
        cb(ms(video.currentTime));
        handle = scheduler.request(tick);
      };
      handle = scheduler.request(tick);
      return () => {
        active = false;
        scheduler.cancel(handle);
      };
    },
  };
}
