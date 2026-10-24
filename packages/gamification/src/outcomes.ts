// Calibrating the Readiness score itself on real LL outcomes
// (GAMIFICATION_ENGINE §5.3). Readiness is a practice indicator, not a
// probability. Until a tenant has ≥ 100 paired outcomes the only allowed
// outcome line is a count ("Of N users who reached 85 before testing, k
// passed", shown when N ≥ 30); never a percentage chance for an individual.

import { snap } from "./math.ts";
import type { EpochMs } from "./time.ts";
import { DAY_MS } from "./time.ts";

export const MIN_PAIRS_FOR_FIT = 100;
export const MIN_N_FOR_COUNT_LINE = 30;
export const PAIRING_WINDOW_DAYS = 7;

export interface ReadinessSnapshot {
  readonly at: EpochMs;
  readonly readiness: number;
}

export interface OutcomePair {
  readonly readiness: number;
  readonly passed: boolean;
}

/**
 * Pairs a real LL result with the Readiness shown in the 7 days before the
 * test: the latest snapshot in [testAt − 7 d, testAt). Null when none.
 */
export function pairOutcome(
  shown: readonly ReadinessSnapshot[],
  testAt: EpochMs,
  passed: boolean,
): OutcomePair | null {
  let best: ReadinessSnapshot | null = null;
  for (const s of shown) {
    if (s.at >= testAt || s.at < testAt - PAIRING_WINDOW_DAYS * DAY_MS) continue;
    if (best === null || s.at > best.at) best = s;
  }
  return best === null ? null : { readiness: best.readiness, passed };
}

/** Brier score of probabilistic predictions against outcomes. */
export function predictionBrier(
  preds: readonly { readonly p: number; readonly passed: boolean }[],
): number | null {
  if (preds.length === 0) return null;
  let s = 0;
  for (const x of preds) {
    const d = x.p - (x.passed ? 1 : 0);
    s += d * d;
  }
  return snap(s / preds.length);
}

/** "Of N users who reached 85 before testing, k passed", or null while N < 30. */
export function outcomeCountLine(
  pairs: readonly OutcomePair[],
  threshold = 85,
  minN = MIN_N_FOR_COUNT_LINE,
): { readonly n: number; readonly k: number } | null {
  const reached = pairs.filter((p) => p.readiness >= threshold);
  if (reached.length < minN) return null;
  return { n: reached.length, k: reached.filter((p) => p.passed).length };
}

export interface PassModel {
  /** p_pass = σ(a + b × Readiness). */
  readonly a: number;
  readonly b: number;
  readonly n: number;
  readonly brier: number;
  readonly baseRate: number;
  /** Brier of always predicting the tenant pass rate. */
  readonly baseRateBrier: number;
  /** True when the fit is worse than the base rate: review the gate threshold and log it (§5.3 step 4). */
  readonly reviewGate: boolean;
}

const sigmoid = (z: number): number =>
  z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));

/**
 * Fits p_pass = σ(a + b × Readiness) by Newton–Raphson (IRLS) on readiness/100,
 * with a tiny ridge (1e-6) so perfectly separated data still converges.
 * Deterministic: fixed start (0, 0), fixed iteration cap. Returns null below
 * 100 pairs per tenant [D].
 */
export function fitPassModel(
  pairs: readonly OutcomePair[],
  minPairs = MIN_PAIRS_FOR_FIT,
): PassModel | null {
  if (pairs.length < minPairs || pairs.length === 0) return null;
  const ridge = 1e-6;
  let a = 0;
  let b = 0;
  for (let iter = 0; iter < 100; iter++) {
    let ga = -ridge * a;
    let gb = -ridge * b;
    let haa = ridge;
    let hab = 0;
    let hbb = ridge;
    for (const p of pairs) {
      const x = p.readiness / 100;
      const mu = sigmoid(a + b * x);
      const y = p.passed ? 1 : 0;
      const w = mu * (1 - mu);
      ga += y - mu;
      gb += (y - mu) * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    }
    const det = haa * hbb - hab * hab;
    if (!(Math.abs(det) > 1e-300)) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) break;
  }
  const n = pairs.length;
  const baseRate = pairs.filter((p) => p.passed).length / n;
  const brier =
    predictionBrier(
      pairs.map((p) => ({ p: sigmoid(a + (b * p.readiness) / 100), passed: p.passed })),
    ) ?? 0;
  const baseRateBrier = predictionBrier(pairs.map((p) => ({ p: baseRate, passed: p.passed }))) ?? 0;
  return {
    a: snap(a),
    b: snap(b / 100),
    n,
    brier,
    baseRate: snap(baseRate),
    baseRateBrier,
    reviewGate: brier > baseRateBrier,
  };
}
