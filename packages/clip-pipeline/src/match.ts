// Deterministic one-to-one matching of hazard windows between two lists (two raters, or proposals
// against final windows). Used by agreement.ts and proposals.ts.
//
// Algorithm (DATA_PIPELINE §2.3: greedy by temporal IoU, IoU ≥ 0.3 means "same hazard"):
//   1. Both lists are put in canonical order first (onset, end, type, then cue), so the result
//      never depends on the order the marks were submitted in.
//   2. Every cross pair with IoU ≥ minIoU is a candidate.
//   3. Candidates are sorted by: same hazardType first, then IoU descending, then |Δonset|
//      ascending, then left index, then right index (indices in canonical order). The type
//      preference only decides between overlapping candidates; it never creates a match below the
//      IoU threshold.
//   4. Greedy: take each candidate whose left and right items are both still free.
import { cmpStr, iou } from "./math.ts";

export interface Matchable {
  readonly aMs: number;
  readonly bMs: number;
  readonly hazardType: string;
  readonly cue?: string | undefined;
}

export interface MatchPair {
  readonly i: number;
  readonly j: number;
  readonly iou: number;
}

export interface MatchResult {
  readonly pairs: readonly MatchPair[];
  readonly unmatchedLeft: readonly number[];
  readonly unmatchedRight: readonly number[];
}

export function compareMarks(x: Matchable, y: Matchable): number {
  return (
    x.aMs - y.aMs ||
    x.bMs - y.bMs ||
    cmpStr(x.hazardType, y.hazardType) ||
    cmpStr(x.cue ?? "", y.cue ?? "")
  );
}

/** A sorted copy in canonical order. */
export function canonicalMarks<T extends Matchable>(marks: readonly T[]): T[] {
  return [...marks].sort(compareMarks);
}

/** Matches two lists that are already in canonical order. Pairs come back sorted by left index. */
export function matchWindows(
  left: readonly Matchable[],
  right: readonly Matchable[],
  minIoU: number,
): MatchResult {
  const cands: { i: number; j: number; iou: number; same: boolean; dOn: number }[] = [];
  left.forEach((l, i) => {
    right.forEach((r, j) => {
      const v = iou(l, r);
      if (v >= minIoU && v > 0)
        cands.push({
          i,
          j,
          iou: v,
          same: l.hazardType === r.hazardType,
          dOn: Math.abs(l.aMs - r.aMs),
        });
    });
  });
  cands.sort(
    (x, y) =>
      Number(y.same) - Number(x.same) || y.iou - x.iou || x.dOn - y.dOn || x.i - y.i || x.j - y.j,
  );
  const usedL = new Set<number>();
  const usedR = new Set<number>();
  const pairs: MatchPair[] = [];
  for (const c of cands) {
    if (usedL.has(c.i) || usedR.has(c.j)) continue;
    usedL.add(c.i);
    usedR.add(c.j);
    pairs.push({ i: c.i, j: c.j, iou: c.iou });
  }
  pairs.sort((x, y) => x.i - y.i);
  return {
    pairs,
    unmatchedLeft: left.map((_, i) => i).filter((i) => !usedL.has(i)),
    unmatchedRight: right.map((_, j) => j).filter((j) => !usedR.has(j)),
  };
}
