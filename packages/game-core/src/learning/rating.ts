// Evidence → FSRS rating (GAMIFICATION_ENGINE §4.3). Deterministic and shared: the LL scorer fills
// SessionResult.evidence with it, and @margdarshak/gamification imports it for the review log.
//
// | Outcome                                                              | Rating            |
// | Wrong, missed, or a critical fault                                    | 1 Again           |
// | Correct but late (Nazar band 4–5), slow (> 80% of timer), or at 50%   | 2 Hard            |
// | Correct, on time                                                      | 3 Good            |
// | Correct, early (Nazar band 1), or at 100% confidence                  | 4 Easy            |
// | Wrong at 100% confidence                                              | 1 Again + overconfidence event |
//
// "Hard" conditions win over "Easy" ones (correct at 100% confidence but slow is Hard): a slow or
// late answer is the weaker signal, and FSRS should not stretch the interval on it.
import type { ConfidenceTag } from "../schema/result.ts";

export const RATING = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Rating = (typeof RATING)[keyof typeof RATING];

/** One piece of evidence about one concept card. All optional fields refine the rating. */
export interface EvidenceOutcome {
  /** Correct answer, or a hazard that was scored (≥ 1 point). */
  correct: boolean;
  /** A critical fault on the item (always Again). */
  critical?: boolean;
  /** Stated confidence before feedback. */
  confidence?: ConfidenceTag;
  /** Answer latency, with the item's timer, for the "slow" rule (> 80% of the timer). */
  latencyMs?: number;
  timerMs?: number;
  /** Nazar 5-band index of the response: 1 = earliest band (5 points) … 5 = latest (1 point). */
  nazarBand?: 1 | 2 | 3 | 4 | 5;
}

export interface RatingResult {
  rating: Rating;
  /** True only for a wrong answer given at 100% confidence. */
  overconfident: boolean;
}

/** Share of the item timer above which a correct answer counts as slow. */
export const SLOW_FRACTION = 0.8;

export function ratingFromEvidence(e: EvidenceOutcome): RatingResult {
  if (!e.correct || e.critical === true) {
    return { rating: RATING.Again, overconfident: !e.correct && e.confidence === "100" };
  }
  const slow =
    e.latencyMs !== undefined &&
    e.timerMs !== undefined &&
    e.timerMs > 0 &&
    e.latencyMs > SLOW_FRACTION * e.timerMs;
  const late = e.nazarBand === 4 || e.nazarBand === 5;
  if (slow || late || e.confidence === "50") return { rating: RATING.Hard, overconfident: false };
  if (e.nazarBand === 1 || e.confidence === "100")
    return { rating: RATING.Easy, overconfident: false };
  return { rating: RATING.Good, overconfident: false };
}

/**
 * Collapses several pieces of evidence for the same card in one session to the worst rating
 * (one review per card per session). `overconfident` is kept if any piece was overconfident.
 * Output order is first appearance of each card, so it is deterministic.
 */
export function collapseEvidence<
  T extends { cardId: string; rating: number; overconfident: boolean },
>(items: readonly T[]): T[] {
  const byCard = new Map<string, T>();
  for (const it of items) {
    const prev = byCard.get(it.cardId);
    if (prev === undefined) {
      byCard.set(it.cardId, it);
      continue;
    }
    const worse = it.rating < prev.rating ? it : prev;
    byCard.set(it.cardId, { ...worse, overconfident: prev.overconfident || it.overconfident });
  }
  return [...byCard.values()];
}
