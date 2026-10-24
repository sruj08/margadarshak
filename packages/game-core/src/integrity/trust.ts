// Trust (GAME_SDK §6.5): starts at 1.0 and is multiplied by one factor per flag occurrence, floored
// at 0. We never accuse: below 0.6 a session counts for practice only and the UI says "This session
// wasn't counted for your card".
import type { IntegrityFlag } from "../schema/result.ts";

export const TRUST_FACTORS: Readonly<Record<IntegrityFlag, number>> = {
  INT_TAB_HIDDEN: 0.9, // per voided item
  INT_CLOCK_DRIFT: 0.5,
  INT_TIMING_FALLBACK: 1.0,
  INT_RATE_IMPOSSIBLE: 0.5,
  INT_REPLAY_MISMATCH: 0.7,
  INT_SEEN_CLIP: 1.0,
  INT_RT_ANTICIPATORY: 1.0,
  INT_EVENT_CAP: 0.8,
  INT_SESSION_EXPIRED: 0.8,
  INT_OFFLINE_SEED: 0.8,
};

/** Below this trust a session counts for practice only. */
export const TRUST_PRACTICE_ONLY_BELOW = 0.6;

/** Canonical flag order: the enum order of GAME_SDK §6.5. */
export const FLAG_ORDER = Object.keys(TRUST_FACTORS) as IntegrityFlag[];

const isFlag = (f: string): f is IntegrityFlag => Object.hasOwn(TRUST_FACTORS, f);

/**
 * Multiplicative trust in [0, 1], rounded to 4 dp. Each occurrence of a flag multiplies once, so
 * INT_TAB_HIDDEN listed for three items gives 0.9³. Unknown flags are ignored.
 */
export function computeTrust(flags: readonly string[]): number {
  let t = 1;
  for (const f of flags) if (isFlag(f)) t *= TRUST_FACTORS[f];
  t = Math.max(0, Math.min(1, t));
  return Math.round(t * 10000) / 10000;
}

/** Sorts flags into canonical order (duplicates of INT_TAB_HIDDEN are kept). */
export function sortFlags(flags: readonly IntegrityFlag[]): IntegrityFlag[] {
  return [...flags].sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b));
}

/** Adds flags that may appear only once (everything but INT_TAB_HIDDEN), keeping canonical order. */
export function mergeFlags(
  base: readonly IntegrityFlag[],
  extra: readonly IntegrityFlag[],
): IntegrityFlag[] {
  const out = [...base];
  for (const f of extra) {
    if (f === "INT_TAB_HIDDEN" || !out.includes(f)) out.push(f);
  }
  return sortFlags(out);
}
