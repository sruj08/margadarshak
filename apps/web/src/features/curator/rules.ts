import type {
  AgreementCluster,
  AgreementPair,
  AgreementReason,
  Clip,
  ClipAdjudicationCreate,
  ClipAgreement,
  ClipMark,
  ClipRating,
  FinalHazard,
} from "./types";
import { SYNTHETIC_CHECKS } from "./types";

/**
 * Pure rules of the clip admin. The server is the authority for every one of them (API-55); the UI
 * uses them to show what is missing before a request, and the mock store (mock-store.ts) uses them
 * to behave like the server in mock mode. Defaults follow NAZAR §6.3 and DATA_PIPELINE §2.3.
 */

export const FPS = 30;
export const FRAME_MS = 1000 / FPS;
export const ONSET_TOLERANCE_MS = 500;
export const END_TOLERANCE_MS = 1000;
export const MIN_IOU = 0.3;
export const MAX_HAZARDS = 2;
export const MIN_DURATION_MS = 20_000;
export const MAX_DURATION_MS = 60_000;

/** floor(duration_ms × 30 / 1000): the frames a 100% blur audit must check (clip-pipeline). */
export function framesTotal(durationMs: number): number {
  return Math.max(1, Math.floor((durationMs * FPS) / 1000));
}

export const frameToMs = (frame: number): number => Math.round(frame * FRAME_MS);
export const msToFrame = (ms: number): number => Math.round(ms / FRAME_MS);
export const snapMs = (ms: number): number => frameToMs(msToFrame(ms));

/** `0:04.20` (minutes, seconds with hundredths) from milliseconds. */
export function clockTime(ms: number): string {
  const safe = Math.max(0, ms);
  const m = Math.floor(safe / 60_000);
  const s = (safe - m * 60_000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Seconds with two decimals, as typed into the numeric fields ("12.40"). */
export const secondsText = (ms: number): string => (ms / 1000).toFixed(2);

/** "12.4" / "12,40" → 12400 ms; null when it is not a number. */
export function parseSeconds(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}

// ---------- blindness (NAZAR §6.2) ----------

/**
 * The other rater's marks may be shown only when the server says both ratings exist
 * (`ratings_visible`). The UI applies this even if a response carried ratings it should not have.
 */
export function visibleRatings(clip: Clip, viewer: string | null): ClipRating[] {
  if (clip.ratings_visible) return clip.ratings ?? [];
  const mine = clip.my_rating ?? (clip.ratings ?? []).find((r) => viewer && r.rater === viewer);
  return mine ? [mine] : [];
}

/** The caller's own rating of the current version, if any. */
export function myRating(clip: Clip, viewer: string | null): ClipRating | null {
  if (clip.my_rating) return clip.my_rating;
  if (!viewer) return null;
  return (clip.ratings ?? []).find((r) => r.rater === viewer) ?? null;
}

// ---------- mark validation ----------

export type MarkIssue = "order" | "range" | "cue_long" | "cue_pii";

export function markIssues(
  mark: ClipMark,
  durationMs: number,
  piiCheck?: (s: string) => boolean,
): MarkIssue[] {
  const out: MarkIssue[] = [];
  if (!(mark.a_ms < mark.b_ms)) out.push("order");
  if (mark.a_ms < 0 || mark.b_ms > durationMs) out.push("range");
  if ((mark.cue ?? "").length > 160) out.push("cue_long");
  if (mark.cue && piiCheck?.(mark.cue)) out.push("cue_pii");
  return out;
}

// ---------- publish preconditions (clip-pipeline transition(clip, published)) ----------

export type PublishCheckId =
  | "status"
  | "two_ratings"
  | "agreement"
  | "blur_audit"
  | "synthetic_review"
  | "flash_check"
  | "cue_texts"
  | "duration"
  | "speed"
  | "difficulty"
  | "licence"
  | "missing_rendition";

export interface PublishCheck {
  id: PublishCheckId;
  ok: boolean;
}

/** AI-generated clip (ADR-0013). The API always sends `origin` (`filmed` by default). */
export const isAi = (clip: Pick<Clip, "origin">): boolean => clip.origin === "ai_generated";

/** Every synthetic check ticked, by a reviewer, with a timestamp. */
export function syntheticReviewOk(clip: Clip): boolean {
  const r = clip.synthetic_review;
  return (
    !!r &&
    r.passed &&
    !!r.reviewer &&
    !!r.reviewed_at &&
    SYNTHETIC_CHECKS.every((c) => r.checks[c] === true)
  );
}

/**
 * Every precondition of publish, in display order. Filmed clips need the 100% blur audit; AI clips
 * skip it and need the synthetic review instead. Two raters and agreement are required for both.
 */
export function publishChecks(clip: Clip): PublishCheck[] {
  const audit = clip.blur_audit;
  const auditOk =
    !!audit &&
    audit.passed &&
    audit.misses === 0 &&
    audit.frames_checked >= audit.frames_total &&
    (clip.duration_ms === undefined || audit.frames_total >= framesTotal(clip.duration_ms));
  const adjudicated = clip.adjudication?.resolved === true;
  const hazards = clip.hazards ?? [];
  const cuesOk = hazards.every((h) => !!h.cue_text?.en?.trim() && !!h.cue_text?.hi?.trim());
  const d = clip.duration_ms ?? 0;
  const diff = clip.difficulty?.curator;
  return [
    { id: "status", ok: clip.status === "rated" || clip.status === "published" },
    { id: "two_ratings", ok: clip.rating_count >= 2 },
    { id: "agreement", ok: clip.agreement?.accepted === true || adjudicated },
    isAi(clip)
      ? { id: "synthetic_review" as const, ok: syntheticReviewOk(clip) }
      : { id: "blur_audit" as const, ok: auditOk },
    { id: "flash_check", ok: clip.flash_check?.passed === true },
    { id: "cue_texts", ok: cuesOk },
    { id: "duration", ok: d >= MIN_DURATION_MS && d <= MAX_DURATION_MS },
    { id: "speed", ok: typeof clip.speed_kmh_est === "number" },
    { id: "difficulty", ok: typeof diff === "number" && diff >= 1 && diff <= 5 },
    { id: "licence", ok: clip.licence === "CC-BY-4.0" },
    {
      id: "missing_rendition",
      ok: ["360p", "480p"].every((r) => (clip.media ?? []).some((m) => m.res === r)),
    },
  ];
}

export const canPublish = (clip: Clip): boolean =>
  clip.status === "rated" && publishChecks(clip).every((c) => c.ok);

// ---------- agreement (mock stand-in for clip-pipeline computeAgreement) ----------

function iou(a: ClipMark, b: ClipMark): number {
  const inter = Math.max(0, Math.min(a.b_ms, b.b_ms) - Math.max(a.a_ms, b.a_ms));
  const union = Math.max(a.b_ms, b.b_ms) - Math.min(a.a_ms, b.a_ms);
  return union > 0 ? inter / union : 0;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/**
 * Two blind ratings → agreement (NAZAR §6.3–§6.4): greedy pairing by overlap; a pair is accepted
 * with the same type, Δonset ≤ 500 ms, Δend ≤ 1000 ms and IoU ≥ 0.3; any unmatched hazard or more
 * than two hazards sends the clip to adjudication. Final window = mean of the two, snapped to a
 * 30 fps frame. Used by the mock store only; the server's /clip/agreement is the real one.
 */
export function computeAgreement(
  clipId: string,
  version: number,
  ra: ClipRating,
  rb: ClipRating,
  now: string,
): ClipAgreement {
  const A = ra.decision === "reject" ? [] : ra.marks;
  const B = rb.decision === "reject" ? [] : rb.marks;
  const candidates: { i: number; j: number; v: number }[] = [];
  A.forEach((a, i) => {
    B.forEach((b, j) => {
      const v = iou(a, b);
      if (v > 0) candidates.push({ i, j, v });
    });
  });
  candidates.sort((x, y) => y.v - x.v);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const raw: { a: ClipMark; b: ClipMark; v: number }[] = [];
  for (const c of candidates) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    raw.push({ a: A[c.i] as ClipMark, b: B[c.j] as ClipMark, v: c.v });
  }
  const onlyA = A.filter((_, i) => !usedA.has(i));
  const onlyB = B.filter((_, j) => !usedB.has(j));

  type Entry =
    | { kind: "pair"; at: number; a: ClipMark; b: ClipMark; v: number }
    | { kind: "only_a" | "only_b"; at: number; m: ClipMark };
  const entries: Entry[] = [
    ...raw.map((p) => ({ kind: "pair" as const, at: Math.min(p.a.a_ms, p.b.a_ms), ...p })),
    ...onlyA.map((m) => ({ kind: "only_a" as const, at: m.a_ms, m })),
    ...onlyB.map((m) => ({ kind: "only_b" as const, at: m.a_ms, m })),
  ].sort((x, y) => x.at - y.at);

  const pairs: AgreementPair[] = [];
  const clusters: AgreementCluster[] = [];
  entries.forEach((e, k) => {
    const id = `c${k + 1}`;
    if (e.kind === "pair") {
      const dOn = Math.abs(e.a.a_ms - e.b.a_ms);
      const dEnd = Math.abs(e.a.b_ms - e.b.b_ms);
      const same = e.a.hazard_type === e.b.hazard_type;
      const reasons: AgreementReason[] = [];
      if (!same) reasons.push("type_mismatch");
      if (dOn > ONSET_TOLERANCE_MS) reasons.push("onset_delta");
      if (dEnd > END_TOLERANCE_MS) reasons.push("end_delta");
      if (e.v < MIN_IOU && !reasons.includes("onset_delta")) reasons.push("onset_delta");
      pairs.push({
        cluster_id: id,
        a: e.a,
        b: e.b,
        iou: Math.round(e.v * 1000) / 1000,
        delta_onset_ms: dOn,
        delta_end_ms: dEnd,
        same_type: same,
        accepted: reasons.length === 0,
        reasons,
      });
      clusters.push({
        cluster_id: id,
        kind: "pair",
        marks: [
          { rater: ra.rater, mark: e.a },
          { rater: rb.rater, mark: e.b },
        ],
      });
    } else {
      clusters.push({
        cluster_id: id,
        kind: e.kind,
        marks: [{ rater: e.kind === "only_a" ? ra.rater : rb.rater, mark: e.m }],
      });
    }
  });

  const reasons = new Set<AgreementReason>();
  for (const p of pairs) for (const r of p.reasons) reasons.add(r);
  if (onlyA.length + onlyB.length > 0) reasons.add("unmatched_hazard");
  if (A.length > MAX_HAZARDS || B.length > MAX_HAZARDS) reasons.add("too_many_hazards");
  const oneRejected = (ra.decision === "reject") !== (rb.decision === "reject");
  if (oneRejected) reasons.add("unmatched_hazard");
  const accepted = reasons.size === 0;

  const final = accepted
    ? pairs.map((p, k) => ({
        hazard_id: `h${k + 1}`,
        hazard_type: p.a.hazard_type,
        a_ms: snapMs((p.a.a_ms + p.b.a_ms) / 2),
        b_ms: snapMs((p.a.b_ms + p.b.b_ms) / 2),
        rater_count: 2,
        delta_onset_ms: p.delta_onset_ms,
        delta_end_ms: p.delta_end_ms,
        adjudicated: false,
        occlusion: !!(p.a.occlusion || p.b.occlusion),
        cues: [p.a.cue, p.b.cue].filter((c): c is string => !!c),
      }))
    : [];

  const ious = pairs.map((p) => p.iou);
  return {
    clip_id: clipId,
    version,
    raters: [ra.rater, rb.rater],
    accepted,
    needs_third_rater: !accepted,
    reasons: [...reasons],
    metrics: {
      matched: pairs.filter((p) => p.accepted).length,
      median_delta_onset_ms: median(pairs.map((p) => p.delta_onset_ms)),
      median_delta_end_ms: median(pairs.map((p) => p.delta_end_ms)),
      mean_iou:
        ious.length > 0
          ? Math.round((ious.reduce((s, v) => s + v, 0) / ious.length) * 1000) / 1000
          : null,
      kappa_per_second: null,
    },
    pairs,
    only_a: onlyA,
    only_b: onlyB,
    clusters,
    final_hazards: final,
    computed_at: now,
  };
}

export type AdjudicationIssue = "missing_decision" | "missing_mark" | "bad_mark";

/** What still blocks an adjudication: every cluster needs a verdict, every "hazard" its own mark. */
export function adjudicationIssues(
  agreement: ClipAgreement,
  input: ClipAdjudicationCreate,
  durationMs: number,
): AdjudicationIssue[] {
  const out = new Set<AdjudicationIssue>();
  for (const c of agreement.clusters) {
    const d = input.decisions.find((x) => x.cluster_id === c.cluster_id);
    if (!d) out.add("missing_decision");
    else if (d.verdict === "hazard") {
      if (!d.mark) out.add("missing_mark");
      else if (markIssues(d.mark, durationMs).length > 0) out.add("bad_mark");
    }
  }
  return [...out];
}

/**
 * Final windows after an adjudication (NAZAR §6.4): the median of three marks for a pair cluster,
 * the mean of two for a hazard only one rater marked; "not_hazard" drops the cluster.
 */
export function adjudicatedHazards(
  agreement: ClipAgreement,
  input: ClipAdjudicationCreate,
): FinalHazard[] {
  const out: FinalHazard[] = [];
  for (const c of agreement.clusters) {
    const d = input.decisions.find((x) => x.cluster_id === c.cluster_id);
    if (d?.verdict !== "hazard" || !d.mark) continue;
    const marks = [...c.marks.map((m) => m.mark), d.mark];
    const pick = (f: (m: ClipMark) => number) =>
      marks.length === 3
        ? (median(marks.map(f)) as number)
        : marks.reduce((s, m) => s + f(m), 0) / marks.length;
    const humans = c.marks.map((m) => m.mark);
    const spread = (f: (m: ClipMark) => number) =>
      humans.length === 2 ? Math.abs(f(humans[0] as ClipMark) - f(humans[1] as ClipMark)) : 0;
    out.push({
      hazard_id: `h${out.length + 1}`,
      hazard_type: d.mark.hazard_type,
      a_ms: snapMs(pick((m) => m.a_ms)),
      b_ms: snapMs(pick((m) => m.b_ms)),
      rater_count: Math.min(3, marks.length),
      delta_onset_ms: spread((m) => m.a_ms),
      delta_end_ms: spread((m) => m.b_ms),
      adjudicated: true,
      occlusion: marks.some((m) => m.occlusion === true),
      cue_text: null,
    });
  }
  return out;
}

/** The next step a clip is waiting for, for the board's action link. */
export type NextAction =
  | "ingest"
  | "audit"
  | "review"
  | "rate"
  | "adjudicate"
  | "cues"
  | "publish"
  | "none";

export function nextAction(clip: Clip): NextAction {
  switch (clip.status) {
    case "raw":
    case "transcoded":
      return "ingest";
    case "blurred":
      return isAi(clip) ? "rate" : "audit";
    case "audited":
    case "proposed":
      return isAi(clip) || clip.blur_audit?.passed ? "rate" : "audit";
    case "adjudication":
      return "adjudicate";
    case "rated": {
      const hazards = clip.hazards ?? [];
      const cuesMissing =
        hazards.some((h) => !h.cue_text?.en || !h.cue_text?.hi) ||
        typeof clip.difficulty?.curator !== "number";
      if (cuesMissing) return "cues";
      if (isAi(clip)) return syntheticReviewOk(clip) ? "publish" : "review";
      return clip.blur_audit?.passed ? "publish" : "audit";
    }
    default:
      return "none";
  }
}
