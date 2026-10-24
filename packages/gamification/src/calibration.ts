// Personal calibration (GAMIFICATION_ENGINE §6). Every practice answer asks
// "How sure?" (50 / 75 / 100 %) before feedback. Answers are passed oldest
// first; the statistics use the last 40 confidence-rated answers.

import { snap } from "./math.ts";
import type { ConfidenceLevel, RatedAnswer } from "./types.ts";

export const CALIBRATION_WINDOW = 40;

export const CONFIDENCE_P: Readonly<Record<ConfidenceLevel, number>> = {
  "50": 0.5,
  "75": 0.75,
  "100": 1,
};

/** A rated answer with its confidence known. */
export interface ConfidentAnswer {
  readonly correct: boolean;
  readonly confidence: ConfidenceLevel;
}

/** The last `window` answers that carry a confidence, oldest first. */
export function lastRated(
  answers: readonly RatedAnswer[],
  window = CALIBRATION_WINDOW,
): ConfidentAnswer[] {
  const rated: ConfidentAnswer[] = [];
  for (const a of answers) {
    if (a.confidence !== undefined && a.confidence in CONFIDENCE_P) {
      rated.push({ correct: a.correct, confidence: a.confidence });
    }
  }
  return rated.slice(Math.max(0, rated.length - window));
}

/** Brier score B = (1/N) Σ (p_i − o_i)² over the last 40 rated answers; null when there are none. */
export function brier(answers: readonly RatedAnswer[], window = CALIBRATION_WINDOW): number | null {
  const rated = lastRated(answers, window);
  if (rated.length === 0) return null;
  let s = 0;
  for (const a of rated) {
    const d = CONFIDENCE_P[a.confidence] - (a.correct ? 1 : 0);
    s += d * d;
  }
  return snap(s / rated.length);
}

/** OC = mean(stated confidence) − accuracy over the last 40 rated answers; null when there are none. */
export function overconfidence(
  answers: readonly RatedAnswer[],
  window = CALIBRATION_WINDOW,
): number | null {
  const rated = lastRated(answers, window);
  if (rated.length === 0) return null;
  let conf = 0;
  let correct = 0;
  for (const a of rated) {
    conf += CONFIDENCE_P[a.confidence];
    if (a.correct) correct++;
  }
  return snap((conf - correct) / rated.length);
}

export interface CalibrationBin {
  readonly stated: ConfidenceLevel;
  readonly p: number;
  readonly n: number;
  /** Actual accuracy in the bin; null when n = 0. */
  readonly accuracy: number | null;
}

/** The three-bin calibration chart (stated 50/75/100 vs actual accuracy, with n per bin). */
export function calibrationBins(
  answers: readonly RatedAnswer[],
  window = CALIBRATION_WINDOW,
): CalibrationBin[] {
  const rated = lastRated(answers, window);
  return (["50", "75", "100"] as const).map((stated) => {
    const inBin = rated.filter((a) => a.confidence === stated);
    const correct = inBin.filter((a) => a.correct).length;
    return {
      stated,
      p: CONFIDENCE_P[stated],
      n: inBin.length,
      accuracy: inBin.length === 0 ? null : snap(correct / inBin.length),
    };
  });
}

/** "You were sure and wrong N times this week": count of 100%-confident wrong answers (caller passes the week's answers). Private to the user. */
export function sureAndWrong(answers: readonly RatedAnswer[]): number {
  return answers.filter((a) => a.confidence === "100" && !a.correct).length;
}

/** Calibrated badge (§6) [D]: B ≤ 0.18 over ≥ 40 items and |stated − actual| ≤ 0.10 in the 100% bin (which must be non-empty). */
export function isCalibrated(answers: readonly RatedAnswer[]): boolean {
  const rated = lastRated(answers);
  if (rated.length < CALIBRATION_WINDOW) return false;
  const b = brier(rated);
  const top = calibrationBins(rated)[2];
  if (b === null || top === undefined || top.accuracy === null) return false;
  return b <= 0.18 && snap(Math.abs(top.p - top.accuracy)) <= 0.1;
}
