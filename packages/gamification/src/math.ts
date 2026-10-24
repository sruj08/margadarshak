// Small numeric helpers shared by the formulas. Rounding is "half up after
// snapping to 1e-9" so that values such as 40 × 0.15 = 6.000000000000001 or
// 2.4999999999999996 round the way the spec's arithmetic reads. The Go side
// must mirror this when it recomputes the same numbers.

const SNAP = 1e9;

/** Rounds to 9 decimals to absorb binary floating-point noise. */
export function snap(x: number): number {
  return Math.round(x * SNAP) / SNAP;
}

/** Half-up integer rounding after snapping (x ≥ 0 in every caller). */
export function roundHalfUp(x: number): number {
  return Math.floor(snap(x) + 0.5);
}

export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
