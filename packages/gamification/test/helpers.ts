// Test helpers: IST instants and small builders.
import { IST_OFFSET_MS } from "../src/time.ts";
import type { ConfidenceLevel, RatedAnswer, SessionMode, SessionResultLike } from "../src/types.ts";

/** Epoch ms of a wall-clock time in IST. */
export function ist(y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0): number {
  return Date.UTC(y, m - 1, d, h, min, s, ms) - IST_OFFSET_MS;
}

export function session(
  mode: SessionMode,
  pct: number,
  trust = 1,
  extra: Partial<{ gameId: string; flags: string[] }> = {},
): SessionResultLike {
  return {
    gameId: extra.gameId ?? "nazar",
    mode,
    score: { pct },
    integrity: { trust, flags: extra.flags ?? [] },
  };
}

/** `n` answers at a confidence, the first `correct` of them right. */
export function answers(n: number, confidence: ConfidenceLevel, correct: number): RatedAnswer[] {
  return Array.from({ length: n }, (_, i) => ({ confidence, correct: i < correct }));
}
