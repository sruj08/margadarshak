// Session-level calibration (GAMIFICATION_ENGINE §5.1, §6).
// Brier B = (1/N) Σ (p_i − o_i)²; overconfidence OC = mean(stated confidence) − accuracy.
// Reference points: always 50% gives 0.25; always 100% at 61% accuracy gives 0.39.
import type { ConfidenceTag } from "../schema/result.ts";

export interface RatedAnswer {
  confidence: ConfidenceTag;
  correct: boolean;
}

export const confidenceToP = (c: ConfidenceTag): number =>
  c === "50" ? 0.5 : c === "75" ? 0.75 : 1;

/** Brier score over confidence-rated answers; null when there are none. */
export function brier(answers: readonly RatedAnswer[]): number | null {
  if (answers.length === 0) return null;
  let s = 0;
  for (const a of answers) {
    const d = confidenceToP(a.confidence) - (a.correct ? 1 : 0);
    s += d * d;
  }
  return s / answers.length;
}

/** Mean stated confidence minus accuracy; positive means overconfident. Null when empty. */
export function overconfidence(answers: readonly RatedAnswer[]): number | null {
  if (answers.length === 0) return null;
  let p = 0;
  let c = 0;
  for (const a of answers) {
    p += confidenceToP(a.confidence);
    if (a.correct) c += 1;
  }
  return (p - c) / answers.length;
}

/** Stated-vs-actual accuracy for the three confidence bins (n per bin). */
export function calibrationBins(
  answers: readonly RatedAnswer[],
): { confidence: ConfidenceTag; n: number; accuracy: number | null }[] {
  return (["50", "75", "100"] as const).map((confidence) => {
    const bin = answers.filter((a) => a.confidence === confidence);
    const n = bin.length;
    return { confidence, n, accuracy: n === 0 ? null : bin.filter((a) => a.correct).length / n };
  });
}
