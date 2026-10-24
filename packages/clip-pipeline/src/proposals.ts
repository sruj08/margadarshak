// ClipWindowProposer (M-06) output: schema, conversion to absolute windows, chunk stitching and a
// report against the human final windows. Proposals are never authoritative: nothing here writes a
// final window (D-09: two humans set the final windows; ai/prompts/clip_window_proposer.md).
import { z } from "zod";
import { canonicalMarks, matchWindows } from "./match.ts";
import { cmpStr, iou, median } from "./math.ts";
import { HAZARD_TYPES, type HazardType } from "./schema.ts";

/**
 * Labels the prompt (PRM-CLIPPROP 1.0.0) asks the model to use, mapped onto the NAZAR §3.3 enum.
 * The prompt's list predates §3.3; canonical §3.3 values are accepted as-is too.
 */
export const PROMPT_LABEL_MAP: Readonly<Record<string, HazardType>> = {
  bus_stop_pedestrian: "bus_stop_pedestrian",
  pedestrian: "parked_vehicle_hidden", // "between parked cars" in the prompt
  child: "child_school",
  two_wheeler_cut_in: "other", // no §3.3 type for a 2W cut-in; curators retype it
  auto_cut_in: "auto_cut_in",
  door_opening: "door_opening",
  cattle: "cattle_animal",
  oncoming_overtake: "overtaking_oncoming",
  wrong_side_rider: "wrong_side_2w",
  vehicle_pulling_out: "vehicle_pulling_out",
  other: "other",
};

export const PROPOSAL_LABELS = [
  ...new Set([...Object.keys(PROMPT_LABEL_MAP), ...HAZARD_TYPES]),
].sort(cmpStr) as [string, ...string[]];

const MMSS = z.string().regex(/^\d{1,3}:[0-5]\d$/, "MM:SS relative to the chunk start");

export const ProposalWindowSchema = z.strictObject({
  start: MMSS,
  end: MMSS,
  hazard_type: z.enum(PROPOSAL_LABELS),
  why: z.string().min(1).max(240),
});

/** The model's structured output for one chunk. */
export const ClipProposalSchema = z
  .strictObject({
    windows: z.array(ProposalWindowSchema).max(50),
    no_hazard: z.boolean(),
  })
  .refine((p) => p.no_hazard === (p.windows.length === 0), {
    message: "no_hazard must be true exactly when windows is empty",
  });
export type ClipProposal = z.infer<typeof ClipProposalSchema>;

/** A proposal on the clip timeline (ms from clip start), already mapped to the §3.3 enum. */
export interface ProposedWindow {
  readonly aMs: number;
  readonly bMs: number;
  readonly hazardType: HazardType;
  readonly why: string;
}

export interface ChunkInfo {
  readonly chunkOffsetS: number;
  readonly chunkLenS: number;
}

/** Longest window we keep; the prompt says windows are "usually between one and ten seconds". */
export const MAX_PROPOSAL_MS = 20_000;

export function mmssToSeconds(s: string): number {
  const [m, sec] = s.split(":");
  return Number(m) * 60 + Number(sec);
}

/** Sanity-checks one chunk's proposal (DATA_PIPELINE §2) and puts it on the clip timeline. */
export function proposalToWindows(
  proposal: unknown,
  chunk: ChunkInfo,
): { windows: ProposedWindow[]; dropped: { index: number; reason: string }[] } {
  const p = ClipProposalSchema.parse(proposal);
  const windows: ProposedWindow[] = [];
  const dropped: { index: number; reason: string }[] = [];
  for (const [index, w] of p.windows.entries()) {
    const s = mmssToSeconds(w.start);
    const e = mmssToSeconds(w.end);
    let reason: string | null = null;
    if (e <= s) reason = "end is not after start";
    else if (s >= chunk.chunkLenS + 1) reason = "starts after the chunk";
    else if ((e - s) * 1000 > MAX_PROPOSAL_MS) reason = "longer than 20 s";
    if (reason !== null) {
      dropped.push({ index, reason });
      continue;
    }
    const end = Math.min(e, chunk.chunkLenS + 1);
    windows.push({
      aMs: Math.round((chunk.chunkOffsetS + s) * 1000),
      bMs: Math.round((chunk.chunkOffsetS + end) * 1000),
      hazardType: PROMPT_LABEL_MAP[w.hazard_type] ?? (w.hazard_type as HazardType),
      why: w.why,
    });
  }
  return { windows, dropped };
}

/**
 * Joins the windows of all chunks: canonical order, and windows of the same type with IoU ≥ 0.3
 * (one hazard seen at a chunk boundary) are merged into their union.
 */
export function mergeChunkProposals(
  chunks: readonly (readonly ProposedWindow[])[],
  minIoU = 0.3,
): ProposedWindow[] {
  const all = canonicalMarks(chunks.flat());
  const out: ProposedWindow[] = [];
  for (const w of all) {
    const k = out.findIndex((o) => o.hazardType === w.hazardType && iou(o, w) >= minIoU);
    const prev = k >= 0 ? out[k] : undefined;
    if (prev) out[k] = { ...prev, aMs: Math.min(prev.aMs, w.aMs), bMs: Math.max(prev.bMs, w.bMs) };
    else out.push(w);
  }
  return canonicalMarks(out);
}

export interface FinalWindowRef {
  readonly hazardId: string;
  readonly hazardType: HazardType;
  readonly window: { readonly aMs: number; readonly bMs: number };
}

export interface ProposalReport {
  readonly finalHazards: number;
  readonly proposals: number;
  readonly matched: number;
  /** Share of final hazards with a proposal at IoU ≥ 0.3 (M-06 eval target ≥ 0.8); null with no hazards. */
  readonly recall: number | null;
  readonly missedHazardIds: readonly string[];
  readonly falseProposals: number;
  readonly falseProposalRate: number | null;
  readonly typeAgreement: number | null;
  /** Median |proposal onset − final onset|, ms. */
  readonly medianAbsOnsetErrorMs: number | null;
  /** Median (proposal onset − final onset), ms; negative means the model is early. */
  readonly medianSignedOnsetErrorMs: number | null;
}

/** M-06 quality against the human final windows (DATA_PIPELINE §2.3 "Proposer quality"). Report only. */
export function compareProposals(
  proposals: readonly ProposedWindow[],
  finals: readonly FinalWindowRef[],
  minIoU = 0.3,
): ProposalReport {
  const left = canonicalMarks(
    finals.map((f) => ({ ...f.window, hazardType: f.hazardType, cue: f.hazardId, id: f.hazardId })),
  );
  const right = canonicalMarks(proposals);
  const m = matchWindows(left, right, minIoU);
  const abs: number[] = [];
  const signed: number[] = [];
  let sameType = 0;
  for (const p of m.pairs) {
    const f = left[p.i];
    const w = right[p.j];
    if (!f || !w) continue;
    abs.push(Math.abs(w.aMs - f.aMs));
    signed.push(w.aMs - f.aMs);
    if (w.hazardType === f.hazardType) sameType++;
  }
  return {
    finalHazards: left.length,
    proposals: right.length,
    matched: m.pairs.length,
    recall: left.length ? m.pairs.length / left.length : null,
    missedHazardIds: m.unmatchedLeft.map((i) => left[i]?.id ?? "").sort(cmpStr),
    falseProposals: m.unmatchedRight.length,
    falseProposalRate: right.length ? m.unmatchedRight.length / right.length : null,
    typeAgreement: m.pairs.length ? sameType / m.pairs.length : null,
    medianAbsOnsetErrorMs: median(abs),
    medianSignedOnsetErrorMs: median(signed),
  };
}
