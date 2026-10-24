"use client";

import type { A11yMode } from "@margdarshak/game-core/schema";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { GameA11y } from "../types";

/**
 * Game accessibility options (F-52, GAME_DESIGN §1.3): chosen in the brief, stored on this device,
 * read by every game through `useGameA11y()`, and mapped to `ctx.a11y.modes`. Reduced motion also
 * follows the phone (prefers-reduced-motion) and the in-app setting (`html[data-motion=reduced]`).
 */
const KEY = "md.games.a11y.v1";

export const DEFAULT_A11Y: GameA11y = {
  reducedMotion: false,
  screenReaderAlt: false,
  tapOnly: true,
  leftHanded: false,
  largeText: false,
  soundOn: false,
};

type Stored = Partial<Omit<GameA11y, "reducedMotion">> & { reducedMotion?: boolean };

export function readStoredA11y(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return typeof v === "object" && v !== null ? (v as Stored) : {};
  } catch {
    return {};
  }
}

export function writeStoredA11y(patch: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readStoredA11y(), ...patch }));
  } catch {
    // private mode: the choice lasts for this page
  }
  for (const l of listeners) l();
}

const listeners = new Set<() => void>();

/** True when the phone or the in-app setting asks for reduced motion. */
export function systemReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const attr = document.documentElement.getAttribute("data-motion") === "reduced";
  return attr || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

export function currentA11y(): GameA11y {
  const s = readStoredA11y();
  return {
    ...DEFAULT_A11Y,
    ...s,
    reducedMotion: s.reducedMotion === true || systemReducedMotion(),
  };
}

/** GameA11y → game-core A11yMode list for SessionContext. */
export function a11yModes(a: GameA11y): A11yMode[] {
  const modes: A11yMode[] = [];
  if (!a.soundOn) modes.push("no_audio");
  if (a.reducedMotion) modes.push("reduced_motion");
  if (a.tapOnly) modes.push("tap_only");
  if (a.screenReaderAlt) modes.push("screen_reader_alt");
  if (a.largeText) modes.push("large_text");
  if (a.leftHanded) modes.push("one_hand");
  return modes;
}

/** Subscribe to option changes (GameHost.onA11yChange). */
export function onA11yChange(cb: (a: GameA11y) => void): () => void {
  const l = () => cb(currentA11y());
  listeners.add(l);
  const mq =
    typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : null;
  mq?.addEventListener?.("change", l);
  return () => {
    listeners.delete(l);
    mq?.removeEventListener?.("change", l);
  };
}

const Ctx = createContext<GameA11y>(DEFAULT_A11Y);

export function GameA11yProvider({ children }: { children: ReactNode }) {
  const [a11y, setA11y] = useState<GameA11y>(DEFAULT_A11Y);
  useEffect(() => {
    setA11y(currentA11y());
    return onA11yChange(setA11y);
  }, []);
  const value = useMemo(() => a11y, [a11y]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGameA11y(): GameA11y {
  return useContext(Ctx);
}
