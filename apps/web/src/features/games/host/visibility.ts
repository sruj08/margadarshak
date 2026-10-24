"use client";

import type { EventRecorder, SessionLifecycle } from "@margdarshak/game-core/sdk";
import { bindVisibility, type VisibilitySource } from "@margdarshak/game-core/sdk/browser";

/**
 * Pause on visibilitychange → hidden is mandatory (GAME_SDK §4.2, 08 §2.1). game-core's
 * `bindVisibility` records `visibility_hidden` + a hidden `pause`, moves the lifecycle to Paused (or
 * ItemVoided when a timed item was on screen) and calls the game's pause. Resuming stays a user
 * action; back after 10 minutes hidden, the session is abandoned (the host then ends it).
 */
export function bindHostVisibility(opts: {
  doc?: VisibilitySource;
  lifecycle: SessionLifecycle;
  recorder: EventRecorder;
  pauseGame: () => void;
  currentItem: () => number | null;
  itemIsTimed: () => boolean;
  /** Runs after game-core's handler on every change (host UI: open the pause sheet, abandon). */
  afterChange?: (hidden: boolean) => void;
}): () => void {
  const doc = opts.doc ?? (document as unknown as VisibilitySource);
  const unbind = bindVisibility(doc, {
    lifecycle: opts.lifecycle,
    recorder: opts.recorder,
    pauseGame: opts.pauseGame,
    currentItem: opts.currentItem,
    itemIsTimed: opts.itemIsTimed,
    now: () => performance.now(),
  });
  const after = () => opts.afterChange?.(doc.visibilityState === "hidden");
  doc.addEventListener("visibilitychange", after);
  return () => {
    unbind();
    doc.removeEventListener("visibilitychange", after);
  };
}
