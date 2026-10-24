import type { HazardType } from "@margdarshak/game-core/schema";
import { shuffle, subStream } from "@margdarshak/game-core/sim";
import { PREDICTABLE } from "./hazard-labels";

/**
 * The four "what happens next?" options for a freeze (NAZAR §1 learn mode): the true hazard type
 * plus three distractors, drawn and ordered by a seeded sub-stream so the same session always shows
 * the same options (and the server replay never depends on them: the scorer pairs answers by order).
 */
export function predictionOptions(
  seed: number,
  item: number,
  k: number,
  truth: HazardType,
): HazardType[] {
  const rng = subStream(seed, `nazar:predict:${item}:${k}`);
  const distractors = shuffle(
    rng,
    PREDICTABLE.filter((t) => t !== truth),
  ).slice(0, 3);
  return shuffle(rng, [truth, ...distractors]);
}
