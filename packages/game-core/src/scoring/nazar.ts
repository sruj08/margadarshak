// G1 Nazar scoring (GAME_DESIGN §2.7, NAZAR §2, DEBRIEF_SPEC §2.1).
// Product rule: UK-style 5 bands per hazard window, scaled to Kerala's announced format (10 clips ×
// 10 marks, up to 2 hazards per clip, pass mark from the rule-pack row). Study rule: the field-kit
// linear rule (full marks to onset + 2 s, linear to 0 at onset + 5 s). Both share the anti-spam
// pattern rule and the findings; only the per-hazard credit differs.
import { runIntegrityChecks } from "../integrity/checks.ts";
import { collapseEvidence, ratingFromEvidence } from "../learning/rating.ts";
import type { NazarClip, NazarContent, NazarHazard } from "../schema/content.ts";
import type { EventOf, GameEvent } from "../schema/events.ts";
import type { HazardType } from "../schema/ids.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type { Evidence, Finding, ScoreComponent, SessionResult } from "../schema/result.ts";
import { round1, round2 } from "../sim/quantise.ts";
import {
  buildResult,
  component,
  eventsOfType,
  finding,
  hazardDrill,
  ReplayError,
  requireAligned,
  type ScoreOptions,
} from "./common.ts";
import { GAME_CONFIG } from "./config.ts";

const C = GAME_CONFIG.nazar;

type Rule = "kerala_5band" | "field_kit_linear";

export interface HazardCredit {
  hazard: NazarHazard;
  /** 5-band: 0..5 points. Linear: fraction 0..1 of full marks. */
  credit: number;
  /** 5-band index 1 (earliest) … 5; null when not scored or under the linear rule. */
  band: 1 | 2 | 3 | 4 | 5 | null;
  tapMt: number | null;
  lateS: number | null;
  metres: number | null;
  /** Learn mode: the "what happens next?" answer at the freeze before this hazard, if any. */
  prediction: HazardType | null;
}

export interface ClipAnalysis {
  item: number;
  ordinal: number;
  clip: NazarClip;
  tapCount: number;
  maxTapsInWindow: number;
  voided: "pattern" | "INT_TAB_HIDDEN" | "INT_CLOCK_DRIFT" | null;
  hazards: HazardCredit[];
  /** Kerala marks (0..10) before scaling to the format's marks per clip. */
  marks: number;
  earlyTaps: number;
  falseAlarms: number;
}

/** Most taps in any half-open window [s, s + windowMs). */
export function maxTapsInWindow(
  sortedMt: readonly number[],
  windowMs: number = C.patternWindowMs,
): number {
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < sortedMt.length; hi++) {
    while ((sortedMt[hi] as number) - (sortedMt[lo] as number) >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/** The anti-pattern-click rule (NAZAR §2.2, brief §15). */
export function patternVoids(
  sortedMt: readonly number[],
  tapCount: number,
  hazards: number,
): boolean {
  return (
    maxTapsInWindow(sortedMt) > C.patternMaxTaps ||
    tapCount > C.clipCapPerHazard * hazards + C.clipCapBase
  );
}

/** 5-band points for a tap at τ in [a, b]: k = min(5, ⌊5(τ − a)/(b − a)⌋ + 1), p = 6 − k. */
export function bandFor(tauMs: number, aMs: number, bMs: number): 1 | 2 | 3 | 4 | 5 {
  const k = Math.min(5, Math.floor((5 * (tauMs - aMs)) / (bMs - aMs)) + 1);
  return k as 1 | 2 | 3 | 4 | 5;
}

/** Field-kit linear fraction for a tap `dMs` after onset. */
export function linearFraction(dMs: number): number {
  if (dMs < 0 || dMs > C.linearZeroMs) return 0;
  if (dMs <= C.linearFullMs) return 1;
  return (C.linearZeroMs - dMs) / (C.linearZeroMs - C.linearFullMs);
}

function creditWindow(h: NazarHazard, rule: Rule): [number, number] {
  return rule === "kerala_5band"
    ? [h.window.aMs, h.window.bMs]
    : [h.window.aMs, h.window.aMs + C.linearZeroMs];
}

/** A clip's hazards by onset, ties by hazardId: the order taps credit and predictions pair in. */
const byOnset = (clip: NazarClip): NazarHazard[] =>
  [...clip.hazards].sort(
    (x, y) => x.window.aMs - y.window.aMs || (x.hazardId < y.hazardId ? -1 : 1),
  );

/** Credits hazards: each tap credits at most one hazard, the earliest-onset unscored one in window. */
function creditHazards(
  clip: NazarClip,
  taps: readonly number[],
  speedKmh: number,
  rule: Rule,
): Omit<HazardCredit, "prediction">[] {
  const order = byOnset(clip);
  const credited = new Map<string, number>();
  for (const tau of taps) {
    const h = order.find((z) => {
      const [lo, hi] = creditWindow(z, rule);
      return !credited.has(z.hazardId) && lo <= tau && tau <= hi;
    });
    if (h !== undefined) credited.set(h.hazardId, tau);
  }
  return clip.hazards.map((hazard) => {
    const tau = credited.get(hazard.hazardId);
    if (tau === undefined)
      return { hazard, credit: 0, band: null, tapMt: null, lateS: null, metres: null };
    const { aMs, bMs } = hazard.window;
    let credit: number;
    let band: HazardCredit["band"] = null;
    let fullEnd: number;
    if (rule === "kerala_5band") {
      band = bandFor(tau, aMs, bMs);
      credit = 6 - band;
      fullEnd = aMs + (bMs - aMs) / 5; // end of band 1
    } else {
      credit = linearFraction(tau - aMs);
      fullEnd = aMs + C.linearFullMs;
    }
    const lateS = round1(Math.max(0, tau - fullEnd) / 1000);
    return { hazard, credit, band, tapMt: tau, lateS, metres: round1((lateS * speedKmh) / 3.6) };
  });
}

function clipMarks(hazards: readonly HazardCredit[], rule: Rule): number {
  if (hazards.length === 0) return 0;
  if (rule === "kerala_5band") {
    return hazards.length === 1
      ? 2 * (hazards[0] as HazardCredit).credit
      : hazards.reduce((s, h) => s + h.credit, 0);
  }
  return round2((10 * hazards.reduce((s, h) => s + h.credit, 0)) / hazards.length);
}

function analyseClips(
  events: readonly GameEvent[],
  content: NazarContent,
  voidedItems: Map<number, "INT_TAB_HIDDEN" | "INT_CLOCK_DRIFT">,
  rule: Rule,
): ClipAnalysis[] {
  const taps = eventsOfType(events, "tap");
  const predictions = eventsOfType(events, "prediction");
  return content.clips.map((clip, item) => {
    const own = taps.filter((e) => e.item === item);
    const mts = own
      .filter((e): e is EventOf<"tap"> & { mt: number } => e.mt !== undefined)
      .map((e) => e.mt)
      .sort((a, b) => a - b);
    const window = maxTapsInWindow(mts);
    const integrityVoid = voidedItems.get(item) ?? null;
    const pattern = patternVoids(mts, own.length, clip.hazards.length);
    const voided = integrityVoid ?? (pattern ? "pattern" : null);
    // The clip freezes before each onset in turn, so the k-th answer belongs to the k-th hazard.
    const answers = predictions.filter((e) => e.item === item).map((e) => e.p.choice);
    const predictionOf = new Map(byOnset(clip).map((h, k) => [h.hazardId, answers[k] ?? null]));
    const hazards: HazardCredit[] =
      voided === null
        ? creditHazards(clip, mts, clip.speedKmhEst, rule).map((h) => ({
            ...h,
            prediction: predictionOf.get(h.hazard.hazardId) ?? null,
          }))
        : clip.hazards.map((hazard) => ({
            hazard,
            credit: 0,
            band: null,
            tapMt: null,
            lateS: null,
            metres: null,
            prediction: null,
          }));
    const near = (tau: number): boolean =>
      clip.hazards.some((h) => tau >= h.window.aMs - C.earlyTapWindowMs && tau <= h.window.bMs);
    const early = mts.filter((tau) =>
      clip.hazards.some((h) => tau >= h.window.aMs - C.earlyTapWindowMs && tau < h.window.aMs),
    ).length;
    return {
      item,
      ordinal: item + 1,
      clip,
      tapCount: own.length,
      maxTapsInWindow: window,
      voided,
      hazards,
      marks: clipMarks(hazards, rule),
      earlyTaps: voided === null ? early : 0,
      falseAlarms: voided === null ? mts.filter((tau) => !near(tau)).length : 0,
    };
  });
}

/** Shared inputs of the Nazar detectors (DEBRIEF_SPEC §2.1); each detector returns 0 or 1 finding. */
interface NazarFindingCtx {
  ctx: SessionContext;
  events: readonly GameEvent[];
  clips: readonly ClipAnalysis[];
  live: readonly ClipAnalysis[];
  scaledTotal: number | null;
  content: NazarContent;
}

type Detector = (f: NazarFindingCtx) => Finding | null;

const itemRef = (f: NazarFindingCtx, item: number): string | undefined => f.ctx.items[item]?.ref;

/** skillId, ruleIds and the occlusion drill for a hazard type. */
function typed(t: HazardType): { skillId: string; ruleIds: readonly string[]; drillIds: string[] } {
  return { skillId: C.hazardSkill[t], ruleIds: C.hazardRules[t], drillIds: [hazardDrill(t)] };
}

const isLate = (h: HazardCredit): boolean => (h.lateS ?? 0) >= C.lateResponseMinS;

/** NAZ_LATE_RESPONSE: any scored hazard with late_s ≥ 0.5; severity from the mean late_s. */
const lateResponse: Detector = (f) => {
  const scored = f.live.flatMap((c) =>
    c.hazards.filter((h) => h.credit > 0).map((h) => ({ c, h })),
  );
  const worst = scored
    .filter(({ h }) => isLate(h))
    .sort((x, y) => (y.h.lateS ?? 0) - (x.h.lateS ?? 0) || x.c.ordinal - y.c.ordinal)[0];
  if (worst === undefined) return null;
  const mean = scored.reduce((s, { h }) => s + (h.lateS ?? 0), 0) / scored.length;
  const t = worst.h.hazard.hazardType;
  return finding({
    findingId: "NAZ_LATE_RESPONSE",
    severity: Math.min(1, mean / 3),
    ...typed(t),
    facts: {
      late_s: worst.h.lateS ?? 0,
      speed_kmh: worst.c.clip.speedKmhEst,
      metres: worst.h.metres ?? 0,
      hazard_type: t,
      clip_ordinal: worst.c.ordinal,
    },
    itemRef: itemRef(f, worst.c.item),
  });
};

/** NAZ_MISSED_HAZARD: ≥ 1 hazard with 0 points (voided clips are reported by their own finding). */
const missedHazard: Detector = (f) => {
  const missed = f.live.flatMap((c) =>
    c.hazards.filter((h) => h.credit === 0).map((h) => ({ c, h })),
  );
  const first = missed[0];
  if (first === undefined) return null;
  const t = first.h.hazard.hazardType;
  return finding({
    findingId: "NAZ_MISSED_HAZARD",
    severity: Math.min(1, 0.4 + 0.2 * missed.length),
    ...typed(t),
    facts: { missed_count: missed.length, hazard_type: t, clip_ordinal: first.c.ordinal },
    itemRef: itemRef(f, first.c.item),
  });
};

/** NAZ_REPEATED_TYPE_MISS: the same type missed or late in ≥ 2 clips. */
const repeatedTypeMiss: Detector = (f) => {
  const perType = new Map<HazardType, Set<number>>();
  for (const c of f.live) {
    for (const h of c.hazards.filter((x) => x.credit === 0 || isLate(x))) {
      const set = perType.get(h.hazard.hazardType) ?? new Set<number>();
      set.add(c.ordinal);
      perType.set(h.hazard.hazardType, set);
    }
  }
  const top = [...perType.entries()]
    .filter(([, s]) => s.size >= 2)
    .sort((x, y) => y[1].size - x[1].size || (x[0] < y[0] ? -1 : 1))[0];
  if (top === undefined) return null;
  return finding({
    findingId: "NAZ_REPEATED_TYPE_MISS",
    severity: 0.8,
    ...typed(top[0]),
    facts: { hazard_type: top[0], times: top[1].size },
  });
};

/** NAZ_PATTERN_CLICK: the pattern rule voided ≥ 1 clip. */
const patternClick: Detector = (f) => {
  const pattern = f.clips.filter((c) => c.voided === "pattern");
  const first = pattern[0];
  if (first === undefined) return null;
  return finding({
    findingId: "NAZ_PATTERN_CLICK",
    severity: Math.min(1, 0.6 + 0.1 * pattern.length),
    skillId: "SK-M18",
    drillIds: ["DR-NAZ-CALM"],
    facts: {
      pattern_clips: pattern.length,
      taps_in_1s: Math.max(...pattern.map((c) => c.maxTapsInWindow)),
    },
    itemRef: itemRef(f, first.item),
  });
};

/** NAZ_FALSE_ALARMS (practice): taps outside every [a − 1 s, b] per minute of live clip time. */
const falseAlarms: Detector = (f) => {
  if (f.ctx.mode !== "practice" || f.live.length === 0) return null;
  const minutes = f.live.reduce((s, c) => s + c.clip.durationMs, 0) / 60000;
  const fa = round1(f.live.reduce((s, c) => s + c.falseAlarms, 0) / minutes);
  if (fa < C.falseAlarmMinPerMin) return null;
  return finding({
    findingId: "NAZ_FALSE_ALARMS",
    severity: Math.min(1, fa / 10),
    skillId: "SK-M18",
    drillIds: ["DR-NAZ-QUIET"],
    facts: { fa_per_min: fa },
  });
};

/** NAZ_EARLY_TAPS (learn): ≥ 2 taps within 1 s before an onset. */
const earlyTaps: Detector = (f) => {
  if (f.ctx.mode !== "learn") return null;
  const early = f.live.reduce((s, c) => s + c.earlyTaps, 0);
  const top = [...f.live].sort((x, y) => y.earlyTaps - x.earlyTaps || x.ordinal - y.ordinal)[0];
  const t = top?.clip.hazards[0]?.hazardType;
  if (early < 2 || t === undefined) return null;
  const { skillId, drillIds } = typed(t);
  return finding({
    findingId: "NAZ_EARLY_TAPS",
    severity: 0.3,
    skillId,
    drillIds,
    facts: { early_taps: early },
  });
};

/** NAZ_OVERCONFIDENT (mock): pre-mock prediction vs clips actually passed. */
const overconfident: Detector = (f) => {
  if (f.ctx.mode !== "mock") return null;
  let predicted: number | null = null;
  for (const e of f.events) {
    if (e.type === "confidence" && "predictedPassClips" in e.p) {
      predicted = e.p.predictedPassClips;
      break;
    }
  }
  if (predicted === null) return null;
  const passedClips = f.clips.filter(
    (c) => c.clip.hazards.length > 0 && c.marks >= C.itemPassMarks,
  );
  const gap = predicted - passedClips.length;
  if (gap < C.overconfidentMinGap) return null;
  return finding({
    findingId: "NAZ_OVERCONFIDENT",
    severity: Math.min(1, gap / 6),
    skillId: "calibration",
    drillIds: ["DR-NAZ-MOCK"],
    facts: { predicted_pass: predicted, actual_pass: passedClips.length },
  });
};

/** NAZ_BELOW_KERALA_MARK (mock): informational; ranked after every skill finding. */
const belowKeralaMark: Detector = (f) => {
  const fmt = f.content.format;
  if (f.ctx.mode !== "mock" || f.scaledTotal === null || f.scaledTotal >= fmt.pass) return null;
  return finding({
    findingId: "NAZ_BELOW_KERALA_MARK",
    severity: 0.5,
    skillId: "SK-M18",
    ruleIds: [fmt.rule_id],
    drillIds: ["DR-NAZ-MOCK"],
    facts: { score_total: f.scaledTotal, pass_mark: fmt.pass, kerala_status: fmt.status },
  });
};

const NAZAR_DETECTORS: readonly Detector[] = [
  lateResponse,
  missedHazard,
  repeatedTypeMiss,
  patternClick,
  falseAlarms,
  earlyTaps,
  overconfident,
  belowKeralaMark,
];

function nazarFindings(
  ctx: SessionContext,
  events: readonly GameEvent[],
  clips: readonly ClipAnalysis[],
  scaledTotal: number | null,
  content: NazarContent,
): Finding[] {
  const live = clips.filter((c) => c.voided === null);
  const f: NazarFindingCtx = { ctx, events, clips, live, scaledTotal, content };
  return NAZAR_DETECTORS.map((d) => d(f)).filter((x): x is Finding => x !== null);
}

/**
 * Kerala marks per clip (mock, pair, linear rule) or UK-style 0–5 points per hazard (practice,
 * learn). Learn mode adds the "what happens next?" answer per hazard; an unanswered freeze scores 0,
 * so skipping it never raises the score.
 */
function nazarComponents(
  clips: readonly ClipAnalysis[],
  content: NazarContent,
  kerala: boolean,
  rule: Rule,
  learn: boolean,
): ScoreComponent[] {
  const perClip = content.format.marks_per_clip / 10;
  const out: ScoreComponent[] = [];
  for (const c of clips) {
    if (c.clip.hazards.length === 0) continue; // quiet clips are not part of the 100-mark score
    // Practice: a clip voided by the tab being hidden is excluded from the max; mock counts it as 0.
    if (!kerala && c.voided !== null && c.voided !== "pattern") continue;
    if (kerala || rule === "field_kit_linear") {
      out.push(component(`clip_${c.ordinal}`, c.marks * perClip, 10 * perClip, "nazar.clip_marks"));
      continue;
    }
    for (const h of c.hazards) {
      const id = `c${c.ordinal}_${h.hazard.hazardId}`;
      out.push(component(id, h.credit, 5, "nazar.hazard_points"));
      if (!learn) continue;
      const points = h.prediction === h.hazard.hazardType ? C.learnPredictionPoints : 0;
      out.push(component(`${id}_predict`, points, C.learnPredictionPoints, "nazar.prediction"));
    }
  }
  return out;
}

/**
 * One FSRS review per hazard card per session (collapsed to the worst rating): from the tap, and in
 * learn mode also from each "what happens next?" answer (MD-224).
 */
function nazarEvidence(clips: readonly ClipAnalysis[], learn: boolean): Evidence[] {
  const raw: Evidence[] = [];
  for (const c of clips) {
    if (c.voided !== null) continue;
    for (const h of c.hazards) {
      const cardId = h.hazard.cardId ?? `hazard:${h.hazard.hazardType}`;
      const correct = h.credit > 0;
      const r = ratingFromEvidence(h.band === null ? { correct } : { correct, nazarBand: h.band });
      raw.push({ cardId, correct, rating: r.rating, overconfident: r.overconfident });
      if (!learn || h.prediction === null) continue;
      const predicted = h.prediction === h.hazard.hazardType;
      const p = ratingFromEvidence({ correct: predicted });
      raw.push({ cardId, correct: predicted, rating: p.rating, overconfident: p.overconfident });
    }
  }
  return collapseEvidence(raw);
}

function scoreNazar(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: NazarContent,
  opts: ScoreOptions,
  rule: Rule,
): SessionResult {
  requireAligned(ctx, content.clips.length, "nazar");
  for (const clip of content.clips) {
    if (clip.hazards.length > content.format.max_hazards_per_clip) {
      throw new ReplayError(
        "CONTENT_MISMATCH",
        `clip ${clip.clipId} has more hazards than the format allows`,
      );
    }
  }
  const integrity = runIntegrityChecks(ctx, events, {
    maxEvents: opts.maxEvents ?? GAME_CONFIG.budgets.nazar.maxEvents,
    defaultTimingMode: "fallback",
    checkClockDrift: true,
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
  });
  const clips = analyseClips(events, content, integrity.voidedItems, rule);
  const kerala = ctx.mode === "mock" || ctx.mode === "pair";
  const learn = ctx.mode === "learn";
  const components = nazarComponents(clips, content, kerala, rule, learn);
  const raw = components.reduce((s, x) => s + x.value, 0);
  const max = components.reduce((s, x) => s + x.max, 0);
  const scaledTotal = kerala
    ? max > 0
      ? round2((raw * content.format.total_marks) / max)
      : 0
    : null;
  return buildResult(ctx, opts, {
    components,
    passed: scaledTotal === null ? null : scaledTotal >= content.format.pass,
    passRule: kerala ? { source: "rule_pack", ref: content.format.rule_id } : null,
    capApplied: null,
    findings: nazarFindings(ctx, events, clips, scaledTotal, content),
    evidence: nazarEvidence(clips, learn),
    calibration: null,
    integrity,
  });
}

/** Nazar product scoring: UK-style 5 bands scaled to Kerala's announced format. */
export function scoreNazarKerala5Band(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: NazarContent,
  opts: ScoreOptions,
): SessionResult {
  return scoreNazar(ctx, events, content, opts, "kerala_5band");
}

/** Nazar study scoring (field kit): linear 2 s → 5 s rule, same pattern rule and findings. */
export function scoreNazarFieldKitLinear(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: NazarContent,
  opts: ScoreOptions,
): SessionResult {
  return scoreNazar(ctx, events, content, opts, "field_kit_linear");
}

/** Per-clip analysis for previews and debrief replays (same numbers the scorer uses). */
export function analyseNazarClips(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: NazarContent,
  rule: Rule = "kerala_5band",
): ClipAnalysis[] {
  const integrity = runIntegrityChecks(ctx, events, {
    maxEvents: GAME_CONFIG.budgets.nazar.maxEvents,
    defaultTimingMode: "fallback",
    checkClockDrift: true,
  });
  return analyseClips(events, content, integrity.voidedItems, rule);
}
