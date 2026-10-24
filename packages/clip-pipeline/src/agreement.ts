// Two-rater hazard windows: agreement (NAZAR §6.3), final window (§6.4), third-rater adjudication,
// batch statistics (κ, median Δ, H4) and rater drift (§6.5).
//
// Thresholds. Per-hazard acceptance defaults to Δonset ≤ 500 ms and Δend ≤ 1000 ms with the same
// hazardType: ARCHITECTURE §8 ("onset Δ ≤ 0.5 s, matched hazards; else third rater"),
// DATA_PIPELINE §2.3 and MD-217 agree on 0.5 s, and DATA_PIPELINE gives the paired 1.0 s end bound.
// NAZAR §6.3's looser per-hazard row (1.0 s / 1.5 s) is available as NAZAR_63_PER_HAZARD. The batch
// targets of §6.3 (median Δonset ≤ 0.5 s = pre-registered H4, median Δend ≤ 1.0 s, κ ≥ 0.6) are
// computed by batchAgreementStats over all matched pairs, before any adjudication.
//
// The Go job step `clip.agreement` (ARCHITECTURE §10.6) is the runtime authority; this module is the
// reference implementation it must mirror (test/fixtures/agreement-golden.json).
import { z } from "zod";
import { canonicalMarks, matchWindows } from "./match.ts";
import { cmpStr, cohensKappa, mean, median, snapToFrameMs } from "./math.ts";
import type { ProposedWindow } from "./proposals.ts";
import {
  DELIVERY_FPS,
  type HazardType,
  HazardTypeSchema,
  MAX_HAZARDS_PER_CLIP,
  PSEUDONYM_RE,
} from "./schema.ts";

export const RaterMarkSchema = z
  .strictObject({
    hazardType: HazardTypeSchema,
    aMs: z.int().nonnegative(),
    bMs: z.int().positive(),
    cue: z.string().max(160).optional(),
    occlusion: z.boolean().optional(),
  })
  .refine((m) => m.aMs < m.bMs, { message: "aMs must be < bMs" });
export type RaterMark = z.infer<typeof RaterMarkSchema>;

/** One rater's blind submission (E-21 ClipRating: rater_pseudonym, marks, submitted_at). */
export const RaterSubmissionSchema = z.strictObject({
  rater: z.string().regex(PSEUDONYM_RE),
  clipId: z.string().min(1),
  version: z.int().min(1),
  marks: z.array(RaterMarkSchema).max(10),
  submittedAt: z.iso.datetime(),
});
export type RaterSubmission = z.infer<typeof RaterSubmissionSchema>;

export interface AgreementOptions {
  readonly onsetToleranceMs: number;
  readonly endToleranceMs: number;
  /** Temporal IoU at or above which two marks are the same hazard (DATA_PIPELINE §2.3). */
  readonly minIoU: number;
  readonly maxHazards: number;
  readonly fps: number;
  readonly snapToFrame: boolean;
}

export const DEFAULT_AGREEMENT: AgreementOptions = {
  onsetToleranceMs: 500,
  endToleranceMs: 1000,
  minIoU: 0.3,
  maxHazards: MAX_HAZARDS_PER_CLIP,
  fps: DELIVERY_FPS,
  snapToFrame: true,
};

/** NAZAR §6.3 "Per-hazard acceptance" row, for teams that adopt the looser bound. */
export const NAZAR_63_PER_HAZARD: Pick<AgreementOptions, "onsetToleranceMs" | "endToleranceMs"> = {
  onsetToleranceMs: 1000,
  endToleranceMs: 1500,
};

/** §6.3 batch targets. */
export const BATCH_TARGETS = { medianOnsetMs: 500, medianEndMs: 1000, kappa: 0.6 } as const;

export type AgreementReason =
  | "unmatched_hazard"
  | "onset_delta"
  | "end_delta"
  | "type_mismatch"
  | "too_many_hazards"
  | "unconfirmed_proposal";

export interface MatchedPair {
  readonly clusterId: string;
  readonly a: RaterMark;
  readonly b: RaterMark;
  readonly iou: number;
  readonly deltaOnsetMs: number;
  readonly deltaEndMs: number;
  /** a.aMs − b.aMs: rater A's onset relative to rater B's. */
  readonly signedOnsetMs: number;
  readonly sameType: boolean;
  readonly accepted: boolean;
  readonly reasons: readonly AgreementReason[];
}

export interface ClusterMark {
  readonly rater: string;
  readonly mark: RaterMark;
}

/** One candidate hazard: a matched pair, a mark only one rater made, or a proposal nobody marked. */
export interface Cluster {
  readonly clusterId: string;
  readonly kind: "pair" | "only_a" | "only_b" | "proposal_only";
  readonly marks: readonly ClusterMark[];
  readonly proposal?: ProposedWindow;
}

export interface FinalHazard {
  readonly hazardId: string;
  readonly hazardType: HazardType;
  readonly window: { readonly aMs: number; readonly bMs: number };
  readonly raterCount: number;
  readonly deltaOnsetMs: number;
  readonly deltaEndMs: number;
  readonly adjudicated: boolean;
  readonly occlusion: boolean;
  /** The raters' one-line cues, for the curator who writes cueText.en / cueText.hi. */
  readonly cues: readonly string[];
}

export interface ClipAgreement {
  readonly clipId: string;
  readonly version: number;
  readonly raters: readonly [string, string];
  readonly pairs: readonly MatchedPair[];
  readonly onlyA: readonly RaterMark[];
  readonly onlyB: readonly RaterMark[];
  readonly unconfirmedProposals: readonly ProposedWindow[];
  readonly clusters: readonly Cluster[];
  readonly metrics: {
    readonly matched: number;
    readonly medianDeltaOnsetMs: number | null;
    readonly medianDeltaEndMs: number | null;
    readonly meanIoU: number | null;
    /** κ on hazard presence per 1-second bin (DATA_PIPELINE §2.3); null without durationMs. */
    readonly kappaPerSecond: number | null;
  };
  readonly reasons: readonly AgreementReason[];
  readonly accepted: boolean;
  readonly needsThirdRater: boolean;
  /** Final windows when accepted (mean of the two raters, frame-snapped); empty otherwise. */
  readonly finalHazards: readonly FinalHazard[];
  readonly options: AgreementOptions;
}

export interface ComputeAgreementInput {
  readonly durationMs?: number;
  /** M-06 proposals, shown after both raters submit (NAZAR §6.2.3). */
  readonly proposals?: readonly ProposedWindow[];
}

const REASON_ORDER: readonly AgreementReason[] = [
  "unmatched_hazard",
  "type_mismatch",
  "onset_delta",
  "end_delta",
  "too_many_hazards",
  "unconfirmed_proposal",
];

function sortReasons(rs: Iterable<AgreementReason>): AgreementReason[] {
  return [...new Set(rs)].sort((x, y) => REASON_ORDER.indexOf(x) - REASON_ORDER.indexOf(y));
}

/**
 * Final window from 2 marks (mean, §6.4) or 3 marks (median, after adjudication), snapped to the
 * nearest frame at `fps` (DATA_PIPELINE §2.3) or rounded to whole ms.
 */
export function finalWindow(
  marks: readonly { readonly aMs: number; readonly bMs: number }[],
  opts: Pick<AgreementOptions, "fps" | "snapToFrame"> = DEFAULT_AGREEMENT,
): { aMs: number; bMs: number } {
  if (marks.length !== 2 && marks.length !== 3) {
    throw new RangeError(`a final window needs 2 or 3 human marks, got ${marks.length}`);
  }
  const pick = (xs: number[]): number =>
    marks.length === 2 ? (mean(xs) as number) : (median(xs) as number);
  const a = pick(marks.map((m) => m.aMs));
  const b = pick(marks.map((m) => m.bMs));
  const round = (v: number): number =>
    opts.snapToFrame ? snapToFrameMs(v, opts.fps) : Math.round(v);
  const out = { aMs: round(a), bMs: round(b) };
  if (out.bMs <= out.aMs)
    throw new RangeError(`final window collapsed to [${out.aMs}, ${out.bMs}]`);
  return out;
}

function presenceBins(marks: readonly RaterMark[], durationMs: number): boolean[] {
  const bins = Math.ceil(durationMs / 1000);
  const out: boolean[] = [];
  for (let k = 0; k < bins; k++) {
    const lo = k * 1000;
    const hi = Math.min(durationMs, lo + 1000);
    out.push(marks.some((m) => m.aMs < hi && m.bMs > lo));
  }
  return out;
}

function spread(xs: readonly number[]): number {
  return Math.max(...xs) - Math.min(...xs);
}

function toFinalHazards(
  items: readonly { marks: readonly RaterMark[]; type: HazardType; adjudicated: boolean }[],
  opts: AgreementOptions,
): FinalHazard[] {
  const built = items.map((it) => ({
    hazardType: it.type,
    window: finalWindow(it.marks, opts),
    raterCount: it.marks.length,
    deltaOnsetMs: spread(it.marks.map((m) => m.aMs)),
    deltaEndMs: spread(it.marks.map((m) => m.bMs)),
    adjudicated: it.adjudicated,
    occlusion: it.marks.some((m) => m.occlusion === true),
    cues: it.marks.map((m) => m.cue ?? "").filter((c) => c !== ""),
  }));
  built.sort(
    (x, y) =>
      x.window.aMs - y.window.aMs ||
      x.window.bMs - y.window.bMs ||
      cmpStr(x.hazardType, y.hazardType),
  );
  return built.map((h, k) => ({ hazardId: `h${k + 1}`, ...h }));
}

type Draft = Omit<Cluster, "clusterId"> & { readonly pair?: Omit<MatchedPair, "clusterId"> };

function parsePair(
  raterA: RaterSubmission,
  raterB: RaterSubmission,
): [RaterSubmission, RaterSubmission] {
  const A = RaterSubmissionSchema.parse(raterA);
  const B = RaterSubmissionSchema.parse(raterB);
  if (A.clipId !== B.clipId || A.version !== B.version) {
    throw new Error(
      `ratings are for different clips: ${A.clipId}@${A.version} vs ${B.clipId}@${B.version}`,
    );
  }
  if (A.rater === B.rater)
    throw new Error(`the two ratings must come from two raters (both ${A.rater})`);
  return [A, B];
}

/** Per-hazard acceptance for one matched pair. */
function comparePair(
  a: RaterMark,
  b: RaterMark,
  pairIoU: number,
  opts: AgreementOptions,
): Omit<MatchedPair, "clusterId"> {
  const deltaOnsetMs = Math.abs(a.aMs - b.aMs);
  const deltaEndMs = Math.abs(a.bMs - b.bMs);
  const sameType = a.hazardType === b.hazardType;
  const reasons: AgreementReason[] = [];
  if (!sameType) reasons.push("type_mismatch");
  if (deltaOnsetMs > opts.onsetToleranceMs) reasons.push("onset_delta");
  if (deltaEndMs > opts.endToleranceMs) reasons.push("end_delta");
  return {
    a,
    b,
    iou: pairIoU,
    deltaOnsetMs,
    deltaEndMs,
    signedOnsetMs: a.aMs - b.aMs,
    sameType,
    accepted: reasons.length === 0,
    reasons,
  };
}

function perSecondKappa(
  marksA: readonly RaterMark[],
  marksB: readonly RaterMark[],
  durationMs: number | undefined,
): number | null {
  if (durationMs === undefined || durationMs <= 0) return null;
  const binsB = presenceBins(marksB, durationMs);
  return cohensKappa(
    presenceBins(marksA, durationMs).map((x, k) => [x, binsB[k] === true] as const),
  );
}

/**
 * Compares two blind rater submissions for one clip version (NAZAR §6.3, ARCHITECTURE §8).
 * Accepted (no third rater) when every candidate hazard is a matched pair of the same type within
 * both tolerances, there are at most `maxHazards`, and no M-06 proposal went unmarked by both raters.
 * The result is the same whichever rater is passed first, apart from the A/B labels.
 */
export function computeAgreement(
  raterA: RaterSubmission,
  raterB: RaterSubmission,
  input: ComputeAgreementInput = {},
  options: Partial<AgreementOptions> = {},
): ClipAgreement {
  const opts: AgreementOptions = { ...DEFAULT_AGREEMENT, ...options };
  const [A, B] = parsePair(raterA, raterB);
  const marksA = canonicalMarks(A.marks);
  const marksB = canonicalMarks(B.marks);
  const m = matchWindows(marksA, marksB, opts.minIoU);

  const drafts: Draft[] = m.pairs.map((p) => {
    const a = marksA[p.i] as RaterMark;
    const b = marksB[p.j] as RaterMark;
    return {
      kind: "pair",
      marks: [
        { rater: A.rater, mark: a },
        { rater: B.rater, mark: b },
      ],
      pair: comparePair(a, b, p.iou, opts),
    };
  });
  const onlyA = m.unmatchedLeft.map((i) => marksA[i] as RaterMark);
  const onlyB = m.unmatchedRight.map((j) => marksB[j] as RaterMark);
  for (const a of onlyA) drafts.push({ kind: "only_a", marks: [{ rater: A.rater, mark: a }] });
  for (const b of onlyB) drafts.push({ kind: "only_b", marks: [{ rater: B.rater, mark: b }] });

  const proposals = canonicalMarks(input.proposals ?? []);
  const human = [...marksA, ...marksB];
  const unconfirmed = proposals.filter(
    (p) => matchWindows([p], canonicalMarks(human), opts.minIoU).pairs.length === 0,
  );
  for (const p of unconfirmed) drafts.push({ kind: "proposal_only", marks: [], proposal: p });

  // Cluster IDs in timeline order so they are stable across reruns and rater order.
  const start = (d: Draft): number =>
    Math.min(...d.marks.map((x) => x.mark.aMs), d.proposal?.aMs ?? Number.POSITIVE_INFINITY);
  const kindRank = { pair: 0, only_a: 1, only_b: 1, proposal_only: 2 } as const;
  const typeOf = (d: Draft): string => d.marks[0]?.mark.hazardType ?? d.proposal?.hazardType ?? "";
  drafts.sort(
    (x, y) =>
      start(x) - start(y) ||
      kindRank[x.kind] - kindRank[y.kind] ||
      cmpStr(typeOf(x), typeOf(y)) ||
      cmpStr(x.marks[0]?.rater ?? "", y.marks[0]?.rater ?? ""),
  );
  const clusters: Cluster[] = [];
  const pairs: MatchedPair[] = [];
  drafts.forEach(({ pair, ...d }, k) => {
    const clusterId = `c${k + 1}`;
    clusters.push({ clusterId, ...d });
    if (pair) pairs.push({ clusterId, ...pair });
  });

  const reasons = new Set<AgreementReason>(pairs.flatMap((p) => p.reasons));
  if (onlyA.length || onlyB.length) reasons.add("unmatched_hazard");
  if (unconfirmed.length) reasons.add("unconfirmed_proposal");
  if (pairs.length + onlyA.length + onlyB.length > opts.maxHazards) reasons.add("too_many_hazards");
  const accepted = reasons.size === 0;
  const kappaPerSecond = perSecondKappa(marksA, marksB, input.durationMs);

  return {
    clipId: A.clipId,
    version: A.version,
    raters: [A.rater, B.rater],
    pairs,
    onlyA,
    onlyB,
    unconfirmedProposals: unconfirmed,
    clusters,
    metrics: {
      matched: pairs.length,
      medianDeltaOnsetMs: median(pairs.map((p) => p.deltaOnsetMs)),
      medianDeltaEndMs: median(pairs.map((p) => p.deltaEndMs)),
      meanIoU: mean(pairs.map((p) => p.iou)),
      kappaPerSecond,
    },
    reasons: sortReasons(reasons),
    accepted,
    needsThirdRater: !accepted,
    finalHazards: accepted
      ? toFinalHazards(
          pairs.map((p) => ({ marks: [p.a, p.b], type: p.a.hazardType, adjudicated: false })),
          opts,
        )
      : [],
    options: opts,
  };
}

// ---------------------------------------------------------------------------------------------
// Adjudication

export const ADJUDICATION_REASON_CODES = [
  "type_resolved",
  "window_resolved",
  "presence_resolved",
  "proposal_checked",
  "too_many_hazards",
  "other",
] as const;

export const AdjudicationInputSchema = z.strictObject({
  adjudicator: z.string().regex(PSEUDONYM_RE),
  decidedAt: z.iso.datetime(),
  reasonCode: z.enum(ADJUDICATION_REASON_CODES),
  decisions: z
    .array(
      z.strictObject({
        clusterId: z.string().regex(/^c\d+$/),
        verdict: z.enum(["hazard", "not_hazard"]),
        mark: RaterMarkSchema.optional(),
      }),
    )
    .max(20),
});
export type AdjudicationInput = z.infer<typeof AdjudicationInputSchema>;

export interface AdjudicationResult {
  readonly resolved: boolean;
  readonly hazards: readonly FinalHazard[];
  readonly dropped: readonly string[];
  readonly issues: readonly string[];
}

/**
 * Third-rater adjudication. The adjudicator (a third person, who sees both raters and the
 * proposals: DATA_PIPELINE §2) rules on every cluster of the agreement:
 *   - `not_hazard` drops it;
 *   - `hazard` must carry the adjudicator's own mark. The final window is the median of the three
 *     human marks for a pair (NAZAR §6.4), or the mean of two when only one rater had marked it.
 *     The type is the adjudicator's. A proposal-only cluster has one human mark (the
 *     adjudicator's), which is not enough: two humans set every final window (D-09), so the clip
 *     stays unresolved until another rater marks it.
 * Resolved only when every cluster has a decision and the result has ≤ maxHazards hazards.
 */
export function adjudicate(
  agreement: ClipAgreement,
  input: AdjudicationInput,
  options: Partial<AgreementOptions> = {},
): AdjudicationResult {
  const opts: AgreementOptions = { ...agreement.options, ...options };
  const adj = AdjudicationInputSchema.parse(input);
  if (agreement.raters.includes(adj.adjudicator)) {
    throw new Error(`the adjudicator must be a third person, not ${adj.adjudicator}`);
  }
  const byId = new Map(agreement.clusters.map((c) => [c.clusterId, c]));
  const seen = new Set<string>();
  for (const d of adj.decisions) {
    if (!byId.has(d.clusterId)) throw new Error(`unknown cluster ${d.clusterId}`);
    if (seen.has(d.clusterId)) throw new Error(`two decisions for ${d.clusterId}`);
    seen.add(d.clusterId);
  }
  const issues: string[] = [];
  const dropped: string[] = [];
  const items: { marks: RaterMark[]; type: HazardType; adjudicated: boolean }[] = [];
  for (const c of agreement.clusters) {
    const d = adj.decisions.find((x) => x.clusterId === c.clusterId);
    if (!d) {
      issues.push(`${c.clusterId}: no decision`);
      continue;
    }
    if (d.verdict === "not_hazard") {
      dropped.push(c.clusterId);
      continue;
    }
    if (!d.mark) {
      issues.push(`${c.clusterId}: a hazard verdict needs the adjudicator's own mark`);
      continue;
    }
    const marks = [...c.marks.map((x) => x.mark), d.mark];
    if (marks.length < 2) {
      issues.push(
        `${c.clusterId}: only one human mark; a second rater must mark it (two humans set final windows)`,
      );
      continue;
    }
    items.push({ marks, type: d.mark.hazardType, adjudicated: true });
  }
  if (items.length > opts.maxHazards)
    issues.push(`${items.length} hazards after adjudication; at most ${opts.maxHazards}`);
  const resolved = issues.length === 0;
  return {
    resolved,
    hazards: resolved ? toFinalHazards(items, opts) : [],
    dropped: dropped.sort(cmpStr),
    issues,
  };
}

// ---------------------------------------------------------------------------------------------
// Batch statistics and drift

export interface BatchAgreementStats {
  readonly clips: number;
  readonly matchedPairs: number;
  /** Median |Δonset| over every matched pair in the batch: the H4 statistic (target ≤ 500 ms). */
  readonly medianDeltaOnsetMs: number | null;
  readonly medianDeltaEndMs: number | null;
  /** Cohen's κ over (clip, candidate hazard) pairs, quiet clips included as (absent, absent). */
  readonly kappa: number | null;
  readonly targets: { readonly onset: boolean; readonly end: boolean; readonly kappa: boolean };
}

/** NAZAR §6.3 batch metrics. Uses the raw two-rater marks (before adjudication), as pre-registered. */
export function batchAgreementStats(agreements: readonly ClipAgreement[]): BatchAgreementStats {
  const onsets: number[] = [];
  const ends: number[] = [];
  const presence: (readonly [boolean, boolean])[] = [];
  for (const g of agreements) {
    for (const p of g.pairs) {
      onsets.push(p.deltaOnsetMs);
      ends.push(p.deltaEndMs);
      presence.push([true, true]);
    }
    for (const _ of g.onlyA) presence.push([true, false]);
    for (const _ of g.onlyB) presence.push([false, true]);
    if (g.pairs.length + g.onlyA.length + g.onlyB.length === 0) presence.push([false, false]);
  }
  const mOn = median(onsets);
  const mEnd = median(ends);
  const kappa = cohensKappa(presence);
  return {
    clips: agreements.length,
    matchedPairs: onsets.length,
    medianDeltaOnsetMs: mOn,
    medianDeltaEndMs: mEnd,
    kappa,
    targets: {
      onset: mOn !== null && mOn <= BATCH_TARGETS.medianOnsetMs,
      end: mEnd !== null && mEnd <= BATCH_TARGETS.medianEndMs,
      kappa: kappa !== null && kappa >= BATCH_TARGETS.kappa,
    },
  };
}

/**
 * The field kit's H4 line (`nazar_stats.py`): median |rater_a_onset − rater_b_onset| over clips,
 * in seconds. Kept as a literal port for the study report.
 */
export function fieldKitH4MedianOnsetS(
  rows: readonly { readonly raterAOnsetS: number; readonly raterBOnsetS: number }[],
): number | null {
  return median(rows.map((r) => Math.abs(r.raterAOnsetS - r.raterBOnsetS)));
}

export interface RaterDrift {
  readonly rater: string;
  readonly n: number;
  /** Mean (rater onset − pair consensus onset), ms; positive means the rater marks late (§6.5). */
  readonly meanSignedOnsetMs: number;
}

export function raterDrift(agreements: readonly ClipAgreement[]): RaterDrift[] {
  const acc = new Map<string, number[]>();
  const add = (r: string, v: number): void => {
    const xs = acc.get(r) ?? [];
    xs.push(v);
    acc.set(r, xs);
  };
  for (const g of agreements) {
    for (const p of g.pairs) {
      add(g.raters[0], p.signedOnsetMs / 2);
      add(g.raters[1], -p.signedOnsetMs / 2);
    }
  }
  return [...acc.entries()]
    .map(([rater, xs]) => ({ rater, n: xs.length, meanSignedOnsetMs: mean(xs) as number }))
    .sort((x, y) => cmpStr(x.rater, y.rater));
}
