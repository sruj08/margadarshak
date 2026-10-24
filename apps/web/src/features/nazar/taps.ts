/**
 * Tap input (GAME_DESIGN §2.5): tap anywhere on the clip, or press Space or any key (switch access).
 * Positions are normalised to 0..1 with 2 decimals (the event schema's quantum); no other input is
 * recorded. Nothing here filters "too many" taps: the pattern rule in game-core scores that clip 0
 * on replay, and the player is never told mid-clip (NAZAR §2.2).
 */

const q2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

export function tapPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
  return { x: q2((clientX - rect.left) / rect.width), y: q2((clientY - rect.top) / rect.height) };
}

/** Keys that never count as a tap: modifiers, navigation, and the host's pause keys (P, Esc). */
const NOT_A_TAP = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Tab",
  "Escape",
  "p",
  "P",
  "Fn",
  "OS",
  "ContextMenu",
]);

export function isTapKey(
  e: Pick<KeyboardEvent, "key" | "repeat" | "ctrlKey" | "metaKey" | "altKey">,
) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !NOT_A_TAP.has(e.key);
}

/** One amber ring on screen (UI-only; removed after its ripple). */
export interface Ring {
  id: number;
  x: number;
  y: number;
}
