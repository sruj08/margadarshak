// Quantisation helpers. Inputs are quantised on the device so the replay consumes exactly what the
// client consumed (GAME_SDK §6.2 rule 4); outputs are rounded once, here, so facts are stable.

const P10 = [1, 10, 100, 1000, 10000];

/** Rounds to `dp` decimals (0–4), half up. Deterministic (Math.round is exactly specified). */
export function roundTo(x: number, dp: number): number {
  const p = P10[dp];
  if (p === undefined) throw new RangeError(`dp must be 0..4, got ${dp}`);
  const r = Math.round(x * p) / p;
  return r === 0 ? 0 : r; // never -0
}

export const round1 = (x: number): number => roundTo(x, 1);
export const round2 = (x: number): number => roundTo(x, 2);

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Normalised coordinate in [0, 1] with 2 dp (tap x/y). */
export function quantiseUnit(x: number): number {
  return roundTo(clamp(x, 0, 1), 2);
}

/** Integer quantisation into [lo, hi] (steer −127..127, cm, dm, ms). */
export function quantiseInt(x: number, lo: number, hi: number): number {
  return clamp(Math.round(x), lo, hi);
}

/** 10 Hz bucket of a time in ms; a sampled stream keeps one sample per bucket. */
export function sampleBucket(tMs: number, hz = 10): number {
  return Math.floor((tMs * hz) / 1000);
}
