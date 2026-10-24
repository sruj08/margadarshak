// Clip status state machine (NAZAR §3.2 status values) and the invariants each status implies.
//
//   raw → transcoded → blurred ─┬→ audited → proposed ─┬→ rated → published → retired
//                       ↺ reblur └──────────→ proposed  └→ adjudication → rated
//   any status except retired → retired (takedown within 72 h, NAZAR §5; or an unusable clip)
//
// `blurred → proposed` exists because ARCHITECTURE §8 runs propose_windows inside the clip_ingest
// run, before the human blur audit, which happens during the rater wait and is checked again in
// clip_finalize (`blur_audit_check`). NAZAR §0 and DATA_PIPELINE §2 order the audit first; both
// orders are allowed and either way nothing publishes without a passing audit.
// Window edits do not move a published clip backwards: they create version n+1 (NAZAR §6.4).
//
// AI-generated clips (ADR-0013) have nothing real to blur:
//
//   raw → transcoded ──────────────→ proposed ─┬→ rated → published → retired
//                                               └→ adjudication → rated
//
// They never enter `blurred` or `audited`; filmed clips never take `transcoded → proposed`
// (`isAllowedFor`). Publishing an AI clip needs a passing `syntheticReview` instead of the blur
// audit. Two agreeing human raters (or an adjudication) set every final window, for every origin.
import { DEFAULT_AGREEMENT } from "./agreement.ts";
import { rubricFactsFromClip, validateCuratorDifficulty } from "./difficulty.ts";
import {
  type Clip,
  type ClipOrigin,
  ClipSchema,
  type ClipStatus,
  DELIVERY_FPS,
  expectedFrameCount,
  MAX_HAZARDS_PER_CLIP,
  RENDITIONS,
} from "./schema.ts";

/** Every edge for some origin; `isAllowedFor` narrows it per origin. */
export const TRANSITIONS: Readonly<Record<ClipStatus, readonly ClipStatus[]>> = {
  raw: ["transcoded", "retired"],
  transcoded: ["blurred", "proposed", "retired"],
  blurred: ["blurred", "audited", "proposed", "retired"],
  audited: ["proposed", "retired"],
  proposed: ["rated", "adjudication", "retired"],
  adjudication: ["rated", "retired"],
  rated: ["published", "retired"],
  published: ["retired"],
  retired: [],
};

/** Publishable clip length: practice/learn 20–60 s, mocks 45–60 s when the bank allows (NAZAR §3.1, §8). */
export const PUBLISH_DURATION_MS = { min: 20_000, max: 60_000 } as const;

export interface Violation {
  readonly code: string;
  readonly message: string;
}

export interface InvariantOptions {
  /** Per-hazard acceptance used to judge two-rater windows (defaults: ARCHITECTURE §8 / DATA_PIPELINE §2.3). */
  readonly onsetToleranceMs?: number;
  readonly endToleranceMs?: number;
  readonly fps?: number;
}

export function isAllowedTransition(from: ClipStatus, to: ClipStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses an AI-generated clip never has (there is nothing real to blur or audit). */
export const AI_SKIPPED_STATUSES: ReadonlySet<ClipStatus> = new Set(["blurred", "audited"]);

/** The edge for a clip of this origin: AI clips skip blur and audit; filmed clips never skip them. */
export function isAllowedFor(origin: ClipOrigin, from: ClipStatus, to: ClipStatus): boolean {
  if (!isAllowedTransition(from, to)) return false;
  if (origin === "ai_generated") return !AI_SKIPPED_STATUSES.has(to);
  return !(from === "transcoded" && to === "proposed");
}

const WITH_RENDITIONS: ReadonlySet<ClipStatus> = new Set([
  "blurred",
  "audited",
  "proposed",
  "adjudication",
  "rated",
  "published",
]);
const NO_FINAL_WINDOWS: ReadonlySet<ClipStatus> = new Set([
  "raw",
  "transcoded",
  "blurred",
  "audited",
  "proposed",
  "adjudication",
]);

/** 100% of frames checked and zero misses, from the clip.json `blurAudit` (NAZAR §5, M-09, MD-218). */
export function clipBlurAuditPasses(clip: Clip, fps: number = DELIVERY_FPS): boolean {
  const a = clip.blurAudit;
  return (
    a !== null &&
    a.misses === 0 &&
    a.framesChecked >= expectedFrameCount(clip.durationMs, fps) &&
    a.framesChecked > 0
  );
}

/** An AI clip's curator review: present means every check passed (they are literal `true`s). */
export function syntheticReviewPasses(clip: Clip): boolean {
  return clip.origin === "ai_generated" && clip.syntheticReview !== undefined;
}

/**
 * The privacy/content gate before publish, per origin: the 100% blur audit for filmed clips, the
 * synthetic-content review for AI clips. The Go `clip.blur_audit_check` step uses this.
 */
export function clipReviewPasses(clip: Clip, fps: number = DELIVERY_FPS): boolean {
  return clip.origin === "ai_generated"
    ? syntheticReviewPasses(clip)
    : clipBlurAuditPasses(clip, fps);
}

function finalWindowViolations(clip: Clip, opts: InvariantOptions): Violation[] {
  const onsetTol = opts.onsetToleranceMs ?? DEFAULT_AGREEMENT.onsetToleranceMs;
  const endTol = opts.endToleranceMs ?? DEFAULT_AGREEMENT.endToleranceMs;
  const out: Violation[] = [];
  if (clip.hazards.length > MAX_HAZARDS_PER_CLIP) {
    out.push({ code: "too_many_hazards", message: `more than ${MAX_HAZARDS_PER_CLIP} hazards` });
  }
  for (const h of clip.hazards) {
    if (h.adjudicated) continue; // adjudicated windows are final by definition (median of the marks)
    if (h.raterCount !== 2) {
      out.push({
        code: "not_two_raters",
        message: `${h.hazardId}: needs two raters or an adjudication`,
      });
    }
    if (h.deltaOnsetMs > onsetTol || h.deltaEndMs > endTol) {
      out.push({
        code: "raters_disagree",
        message: `${h.hazardId}: Δonset ${h.deltaOnsetMs} ms / Δend ${h.deltaEndMs} ms exceed ${onsetTol}/${endTol} ms without adjudication`,
      });
    }
  }
  return out;
}

/** Everything that must hold for a clip in its current status. Empty means consistent. */
export function checkInvariants(clip: Clip, opts: InvariantOptions = {}): Violation[] {
  const parsed = ClipSchema.safeParse(clip);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      code: "schema",
      message: `${i.path.join(".")}: ${i.message}`,
    }));
  }
  const fps = opts.fps ?? DELIVERY_FPS;
  const s = clip.status;
  const out: Violation[] = [];
  if (clip.origin === "ai_generated" && AI_SKIPPED_STATUSES.has(s)) {
    out.push({
      code: "origin_status",
      message: `ai_generated clips skip ${s} (nothing real to blur or audit)`,
    });
  }
  if (WITH_RENDITIONS.has(s)) out.push(...renditionViolations(clip));
  if (NO_FINAL_WINDOWS.has(s) && clip.hazards.length > 0) {
    out.push({
      code: "premature_windows",
      message: `final windows exist before agreement (status ${s})`,
    });
  }
  if (s === "audited" && !clipBlurAuditPasses(clip, fps)) {
    out.push({
      code: "blur_audit",
      message: "status audited needs a 100% blur audit with 0 misses",
    });
  }
  if (s === "rated" || s === "published") out.push(...finalWindowViolations(clip, opts));
  if (s === "published") out.push(...publishViolations(clip, fps));
  return out;
}

function renditionViolations(clip: Clip): Violation[] {
  return RENDITIONS.filter((r) => !clip.media.some((m) => m.res === r)).map((r) => ({
    code: "missing_rendition",
    message: `no ${r} rendition`,
  }));
}

function publishViolations(clip: Clip, fps: number): Violation[] {
  const out: Violation[] = [];
  if (clip.origin === "ai_generated") {
    if (!syntheticReviewPasses(clip)) {
      out.push({
        code: "synthetic_review",
        message:
          "publish needs a curator syntheticReview (no real-person likeness, no readable plates, no real brands, no collision or injury, hazard visible)",
      });
    }
  } else if (!clipBlurAuditPasses(clip, fps)) {
    const need = expectedFrameCount(clip.durationMs, fps);
    const got = clip.blurAudit
      ? `${clip.blurAudit.framesChecked} frames, ${clip.blurAudit.misses} misses`
      : "none";
    out.push({
      code: "blur_audit",
      message: `publish needs a blur audit of all ${need} frames with 0 misses (got ${got})`,
    });
  }
  if (clip.durationMs < PUBLISH_DURATION_MS.min || clip.durationMs > PUBLISH_DURATION_MS.max) {
    out.push({
      code: "duration",
      message: `published clips are 20–60 s (got ${clip.durationMs} ms)`,
    });
  }
  if (clip.speedKmhEst === null) {
    out.push({
      code: "speed",
      message:
        "publish needs a speed estimate: the scorer turns late seconds into metres with it (NAZAR §3.2)",
    });
  }
  if (clip.difficulty.curator === null) {
    out.push({
      code: "curator_difficulty",
      message: "publish needs a curator difficulty (NAZAR §7.1)",
    });
  } else {
    const rubric = validateCuratorDifficulty(clip.difficulty.curator, rubricFactsFromClip(clip));
    for (const e of rubric.errors) out.push({ code: "curator_rubric", message: e });
  }
  return out;
}

export type TransitionResult =
  | { readonly ok: true; readonly clip: Clip }
  | { readonly ok: false; readonly violations: readonly Violation[] };

/**
 * Moves `clip` (already carrying the new fields: media, hazards, blurAudit, ...) to status `to`.
 * Fails on a disallowed edge or when the clip would break the invariants of `to`.
 */
export function transition(
  clip: Clip,
  to: ClipStatus,
  opts: InvariantOptions = {},
): TransitionResult {
  if (!isAllowedFor(clip.origin, clip.status, to)) {
    const why = isAllowedTransition(clip.status, to) ? ` for ${clip.origin} clips` : "";
    return {
      ok: false,
      violations: [{ code: "transition", message: `${clip.status} → ${to} is not allowed${why}` }],
    };
  }
  const next: Clip = { ...clip, status: to };
  const violations = checkInvariants(next, opts);
  return violations.length === 0 ? { ok: true, clip: next } : { ok: false, violations };
}

export interface MockEligibilityContext {
  /** Result of the WCAG 2.3.1 flash check on the published rendition (flash.ts). */
  readonly flashPassed: boolean;
}

/**
 * Whether a clip may be served in Kerala-format mocks: published and consistent, 1–2 hazards,
 * none typed `other` (NAZAR §3.3), curator difficulty 2–4 (§3.4), no flash failure (§12) and
 * Kerala clip length (§3.1: 45–60 s; Phase 1–2 may use 20 s+, see §8, so we only require 20 s).
 */
export function mockEligibility(
  clip: Clip,
  ctx: MockEligibilityContext,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (clip.status !== "published") reasons.push(`status ${clip.status}`);
  for (const v of checkInvariants(clip)) reasons.push(v.message);
  if (clip.hazards.length === 0) reasons.push("quiet clip (no hazard to score)");
  if (clip.hazards.some((h) => h.hazardType === "other")) reasons.push("hazard typed other");
  const d = clip.difficulty.curator;
  if (d === null || d < 2 || d > 4) reasons.push("curator difficulty outside 2–4");
  if (!ctx.flashPassed) reasons.push("failed the flash check");
  return { eligible: reasons.length === 0, reasons };
}
