// Common integrity checks (GAME_SDK §6.5). Pure functions of the context and the event stream;
// server-only knowledge (seen clips, expiry, client/server mismatch) arrives as hints.

import type { EventOf, GameEvent } from "../schema/events.ts";
import type { TimingMode } from "../schema/ids.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type { IntegrityFlag } from "../schema/result.ts";
import { mergeFlags, sortFlags } from "./trust.ts";

export const INTEGRITY_CONFIG = {
  source: "design",
  /** |Δt − Δmt| over a clip above this voids the clip (speed hack or stalled video). */
  clockDriftMs: 250,
  /** The recorder caps taps at 20/s; more in any 1 s window means the stream was not ours. */
  maxTapsPerSecond: 20,
  /** Lateral speed of a rider above this (m/s) is impossible for the quantised controls. */
  maxLateralMps: 4,
  /** Longitudinal progress rate above this (m/s) is impossible for the scripted rides. */
  maxProgressMps: 40,
  /** Steering change faster than full lock (254 units) in 100 ms. */
  maxSteerUnitsPerMs: 2.54,
  /** Rate violations must last longer than this to flag. */
  sustainMs: 500,
  /** Two input samples closer than one 60 Hz step are impossible spacing. */
  inputMinSpacingMs: 16,
} as const;

/** Server-side knowledge the event stream cannot carry. */
export interface IntegrityHints {
  /** A mock clip this user had already seen (defence in depth). */
  seenClip?: boolean;
  /** Completed after `expiresAt`. */
  sessionExpired?: boolean;
}

export type VoidReason = "INT_TAB_HIDDEN" | "INT_CLOCK_DRIFT";

export interface IntegrityAnalysis {
  /** Canonical order; INT_TAB_HIDDEN repeats once per voided item. */
  flags: IntegrityFlag[];
  /** Items that score 0 (practice: also excluded from the max), with the reason. */
  voidedItems: Map<number, VoidReason>;
  timingMode: TimingMode;
}

export interface IntegrityOptions {
  maxEvents: number;
  /** Timing used when the stream has no session_start (sim games: "sim"; quizzes: "none"). */
  defaultTimingMode: TimingMode;
  /** Whether hiding the tab during an item voids it. Default: every item is timed. */
  timedItem?: (item: number) => boolean;
  /** Check media-time drift per item (video games). */
  checkClockDrift?: boolean;
  hints?: IntegrityHints;
  /** Game-specific flags detected by a scorer (e.g. INT_RT_ANTICIPATORY). */
  extraFlags?: readonly IntegrityFlag[];
}

interface ItemSpan {
  start: number;
  end: number;
}

/** [start, end] in `t` for every item that has an item_start; end defaults to the last event. */
export function itemSpans(events: readonly GameEvent[]): Map<number, ItemSpan> {
  const spans = new Map<number, ItemSpan>();
  const lastT = events.length > 0 ? (events[events.length - 1] as GameEvent).t : 0;
  for (const e of events) {
    if (e.item === undefined) continue;
    if (e.type === "item_start" && !spans.has(e.item))
      spans.set(e.item, { start: e.t, end: lastT });
    if (e.type === "item_end") {
      const s = spans.get(e.item);
      if (s !== undefined) s.end = e.t;
    }
  }
  return spans;
}

/** Paused milliseconds inside [from, to] (pause → resume pairs). */
function pausedWithin(events: readonly GameEvent[], from: number, to: number): number {
  let total = 0;
  let pausedAt: number | null = null;
  for (const e of events) {
    if (e.type === "pause" && pausedAt === null) pausedAt = e.t;
    if (e.type === "resume" && pausedAt !== null) {
      const a = Math.max(from, pausedAt);
      const b = Math.min(to, e.t);
      if (b > a) total += b - a;
      pausedAt = null;
    }
  }
  return total;
}

function maxInWindow(times: readonly number[], windowMs: number): number {
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while ((times[hi] as number) - (times[lo] as number) >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/** Duration (ms) of the longest run of consecutive sample intervals that break a rate limit. */
function longestViolation<T extends { t: number }>(
  samples: readonly T[],
  rate: (a: T, b: T, dtMs: number) => number,
  limit: number,
): { sustainedMs: number; zeroSpacing: boolean } {
  let run = 0;
  let best = 0;
  let zeroSpacing = false;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as T;
    const b = samples[i] as T;
    const dt = b.t - a.t;
    if (dt <= 0) {
      if (rate(a, b, 1) > 0) zeroSpacing = true;
      continue;
    }
    if (rate(a, b, dt) > limit) {
      run += dt;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return { sustainedMs: best, zeroSpacing };
}

export function rateImpossible(events: readonly GameEvent[]): boolean {
  const c = INTEGRITY_CONFIG;
  const taps = events.filter((e) => e.type === "tap").map((e) => e.t);
  if (maxInWindow(taps, 1000) > c.maxTapsPerSecond) return true;

  const lane = events.filter((e): e is EventOf<"lane_pos"> => e.type === "lane_pos");
  const lat = longestViolation(
    lane,
    (a, b, dt) => Math.abs(b.p.lateralCm - a.p.lateralCm) / 100 / (dt / 1000),
    c.maxLateralMps,
  );
  const lon = longestViolation(
    lane,
    (a, b, dt) => Math.abs(b.p.progressDm - a.p.progressDm) / 10 / (dt / 1000),
    c.maxProgressMps,
  );
  if (
    lat.sustainedMs > c.sustainMs ||
    lon.sustainedMs > c.sustainMs ||
    lat.zeroSpacing ||
    lon.zeroSpacing
  ) {
    return true;
  }

  const inputs = events.filter((e): e is EventOf<"input"> => e.type === "input");
  for (let i = 1; i < inputs.length; i++) {
    if ((inputs[i] as GameEvent).t - (inputs[i - 1] as GameEvent).t < c.inputMinSpacingMs)
      return true;
  }
  const steer = longestViolation(
    inputs,
    (a, b, dt) => Math.abs(b.p.steer - a.p.steer) / dt,
    c.maxSteerUnitsPerMs,
  );
  return steer.sustainedMs > c.sustainMs;
}

/** Items hidden during play (or ended as voided by the client), for timed items only. */
function hiddenItems(
  events: readonly GameEvent[],
  spans: Map<number, ItemSpan>,
  timed: (item: number) => boolean,
): number[] {
  const out: number[] = [];
  for (const [item, span] of spans) {
    if (!timed(item)) continue;
    const hidden = events.some(
      (e) =>
        (e.type === "visibility_hidden" &&
          (e.item === item || (e.item === undefined && e.t >= span.start && e.t <= span.end))) ||
        (e.type === "item_end" && e.item === item && e.p.reason === "voided"),
    );
    if (hidden) out.push(item);
  }
  return out;
}

/** Items whose wall-clock and media-time deltas differ by more than the drift limit. */
function driftedItems(
  events: readonly GameEvent[],
  spans: Map<number, ItemSpan>,
  skip: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  for (const [item, span] of spans) {
    if (skip.has(item)) continue;
    const withMt = events.filter((e) => e.item === item && e.mt !== undefined);
    if (withMt.length < 2) continue;
    const a = withMt[0] as GameEvent;
    const b = withMt[withMt.length - 1] as GameEvent;
    const dt = b.t - a.t - pausedWithin(events, Math.max(a.t, span.start), b.t);
    const dmt = (b.mt as number) - (a.mt as number);
    if (Math.abs(dt - dmt) > INTEGRITY_CONFIG.clockDriftMs) out.push(item);
  }
  return out;
}

/** Session-level flags: timing, rates, server hints, event cap, offline seed. */
function sessionFlags(
  ctx: SessionContext,
  events: readonly GameEvent[],
  opts: IntegrityOptions,
  timingMode: TimingMode,
): IntegrityFlag[] {
  const capped =
    events.length >= opts.maxEvents ||
    events.some((e) => e.type === "session_end" && e.p.reason === "event_cap");
  const checks: [boolean, IntegrityFlag][] = [
    [timingMode === "fallback", "INT_TIMING_FALLBACK"],
    [rateImpossible(events), "INT_RATE_IMPOSSIBLE"],
    [opts.hints?.seenClip === true, "INT_SEEN_CLIP"],
    [capped, "INT_EVENT_CAP"],
    [opts.hints?.sessionExpired === true, "INT_SESSION_EXPIRED"],
    [ctx.seedOrigin === "client_offline", "INT_OFFLINE_SEED"],
  ];
  return checks.filter(([on]) => on).map(([, f]) => f);
}

/** Runs every common check. Item voids come back separately so scorers can zero those items. */
export function runIntegrityChecks(
  ctx: SessionContext,
  events: readonly GameEvent[],
  opts: IntegrityOptions,
): IntegrityAnalysis {
  const flags: IntegrityFlag[] = [];
  const voidedItems = new Map<number, VoidReason>();
  const spans = itemSpans(events);
  for (const item of hiddenItems(events, spans, opts.timedItem ?? (() => true))) {
    voidedItems.set(item, "INT_TAB_HIDDEN");
    flags.push("INT_TAB_HIDDEN");
  }
  if (opts.checkClockDrift === true) {
    const drifted = driftedItems(events, spans, new Set(voidedItems.keys()));
    for (const item of drifted) voidedItems.set(item, "INT_CLOCK_DRIFT");
    if (drifted.length > 0) flags.push("INT_CLOCK_DRIFT");
  }
  const start = events.find((e): e is EventOf<"session_start"> => e.type === "session_start");
  const timingMode = start?.p.timingMode ?? opts.defaultTimingMode;
  flags.push(...sessionFlags(ctx, events, opts, timingMode));
  return {
    flags: mergeFlags(sortFlags(flags), opts.extraFlags ?? []),
    voidedItems,
    timingMode,
  };
}
