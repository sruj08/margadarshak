import type { MediaClock } from "@margdarshak/game-core/sdk";
import { createMediaClock, type FrameScheduler } from "@margdarshak/game-core/sdk/browser";

/**
 * The clip on screen, real or placeholder, behind one interface. Taps are stamped with the media
 * time of the frame the learner saw (`clock.currentMs()`), never wall-clock (FRONTEND §10.3).
 *
 *  - `videoMedia`: a muted, inline `<video>` over a fully preloaded Blob URL; the clock is
 *    `requestVideoFrameCallback` media time when the browser has it (timingMode "rvfc"), else
 *    `currentTime` on animation frames (timingMode "fallback", flagged by the integrity check).
 *  - `placeholderMedia`: no clip media is published yet, so a deterministic timeline stands in for
 *    the video (clearly labelled on screen). Its time runs on the page clock; it has no video frames,
 *    so it reports timingMode "fallback" honestly.
 */
export interface ClipMedia {
  readonly durationMs: number;
  readonly clock: MediaClock;
  readonly paused: boolean;
  play(): void;
  pause(): void;
  destroy(): void;
}

export const rafScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (h) => cancelAnimationFrame(h),
};

export function supportsRvfc(): boolean {
  return (
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype
  );
}

/** A timeline that behaves like a paused-able video: currentTime advances with the page clock. */
export function placeholderMedia(
  durationMs: number,
  opts: { now?: () => number; scheduler?: FrameScheduler } = {},
): ClipMedia {
  const now = opts.now ?? (() => performance.now());
  let baseMs = 0;
  let playingSince: number | null = null;
  const currentMs = () =>
    Math.min(durationMs, baseMs + (playingSince === null ? 0 : now() - playingSince));
  const video = {
    get currentTime() {
      return currentMs() / 1000;
    },
  };
  const clock = createMediaClock(video, opts.scheduler ?? rafScheduler);
  return {
    durationMs,
    clock,
    get paused() {
      return playingSince === null;
    },
    play() {
      if (playingSince === null) playingSince = now();
    },
    pause() {
      if (playingSince === null) return;
      baseMs = currentMs();
      playingSince = null;
    },
    destroy() {
      this.pause();
    },
  };
}

export function videoMedia(video: HTMLVideoElement, durationMs: number): ClipMedia {
  const clock = createMediaClock(video, rafScheduler);
  return {
    durationMs,
    clock,
    get paused() {
      return video.paused;
    },
    play() {
      void video.play().catch(() => {});
    },
    pause() {
      video.pause();
    },
    destroy() {
      video.pause();
    },
  };
}
