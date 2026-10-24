// G5 Track Test Twin scoring (GAME_DESIGN §6.7, DEBRIEF_SPEC §2.5): a Singapore-style demerit sheet
// on a practice layout ("Practice layout, not your RTO's track"). The recorded quantised inputs are
// replayed through the kinematic bicycle model at a fixed 60 Hz; line touches, cone hits, foot-down,
// time and leaving the track are derived here, never reported by the client. Layout familiarisation
// only: no balance, clutch or emergency-handling claims, and speed is capped at 3 m/s.
import { runIntegrityChecks } from "../integrity/checks.ts";
import type { FaultLocation, TrackSpec, TrackTwinContent } from "../schema/content.ts";
import type { EventOf, GameEvent } from "../schema/events.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type { Finding, ScoreComponent, SessionResult } from "../schema/result.ts";
import { type BicycleState, type QuantisedInput, stepBicycle } from "../sim/bicycle.ts";
import { degToRad } from "../sim/dmath.ts";
import { cumulativeLengths, distance, projectOnPolyline, type Vec2 } from "../sim/geometry.ts";
import { stepIndexAt } from "../sim/loop.ts";
import { round2 } from "../sim/quantise.ts";
import {
  buildResult,
  component,
  finding,
  itemEndReason,
  itemStartT,
  requireAligned,
  type ScoreOptions,
} from "./common.ts";
import { GAME_CONFIG } from "./config.ts";

const C = GAME_CONFIG.trackTwin;
const HZ = 60;
const DT = 1 / HZ;

export type TrackFaultKind = "line_touch" | "cone" | "foot_down" | "timeout" | "off_track";

export interface TrackFault {
  kind: TrackFaultKind;
  step: number;
  location: FaultLocation;
}

export interface TrackRun {
  finished: boolean;
  /** Steps simulated (finish, immediate fail or the 1.5 × time-limit cut-off). */
  steps: number;
  timeS: number;
  faults: TrackFault[];
  immediateFail: TrackFaultKind | null;
  final: BicycleState;
}

/** Input changes keyed by the logic step at which they take effect. */
export interface TimedInput {
  step: number;
  input: QuantisedInput;
}

const ZERO: QuantisedInput = { steer: 0, throttle: 0, brake: 0 };

/** Fault detector state carried across steps; each `check` returns the faults of one step. */
interface FaultTracker {
  check(
    state: BicycleState,
    distanceToLine: number,
    step: number,
    loc: FaultLocation,
  ): TrackFault[];
}

/** Line touch: the bike's edge reaches the lane line; re-arms after 0.5 s clear of it. */
function lineTouchTracker(spec: TrackSpec): FaultTracker {
  let touching = false;
  let clearMs = Number.POSITIVE_INFINITY;
  return {
    check(_state, d, step, location) {
      const now = d + C.bikeHalfWidthM > spec.halfWidthM;
      const fire = now && !touching && clearMs >= C.lineTouchRearmMs;
      clearMs = now ? 0 : clearMs + 1000 * DT;
      touching = now;
      return fire ? [{ kind: "line_touch", step, location }] : [];
    },
  };
}

/** Each cone counts once, when the bike's footprint first reaches it. */
function coneTracker(spec: TrackSpec): FaultTracker {
  const hit = new Set<number>();
  return {
    check(state, _d, step, location) {
      const out: TrackFault[] = [];
      spec.cones.forEach((cone, i) => {
        if (hit.has(i) || distance(state, { x: cone.x, y: cone.y }) >= cone.rM + C.bikeHalfWidthM)
          return;
        hit.add(i);
        out.push({ kind: "cone", step, location });
      });
      return out;
    },
  };
}

/** Foot down (2W): after launch, below 0.6 m/s for more than 1 s counts once per episode. */
function footDownTracker(spec: TrackSpec): FaultTracker {
  let launched = false;
  let lowMs = 0;
  let counted = false;
  return {
    check(state, _d, step, location) {
      if (state.v >= C.vMinMps) launched = true;
      if (!launched || spec.class !== "2W") return [];
      if (state.v >= C.footDownSpeedMps) {
        lowMs = 0;
        counted = false;
        return [];
      }
      lowMs += 1000 * DT;
      if (lowMs <= C.footDownHoldMs || counted) return [];
      counted = true;
      return [{ kind: "foot_down", step, location }];
    },
  };
}

/**
 * Follows progress inside a window ahead of the current segment so a self-crossing path (the
 * figure-8 crossing) never snaps to the other branch.
 */
function progressTracker(pts: readonly Vec2[], cum: readonly number[]) {
  let seg = 0;
  return {
    get segment(): number {
      return seg;
    },
    project(p: Vec2) {
      let hi = seg + 1;
      while (hi < pts.length - 1 && (cum[hi] as number) - (cum[seg] as number) < C.progressWindowM)
        hi++;
      const proj = projectOnPolyline(pts, cum, p, Math.max(0, seg - 1), hi + 1);
      seg = proj.segment;
      return proj;
    },
  };
}

/** Replays inputs over a track. Inputs after `releaseStep` are released (zero). Pure and deterministic. */
export function simulateTrack(
  spec: TrackSpec,
  inputs: readonly TimedInput[],
  releaseStep = Number.POSITIVE_INFINITY,
): TrackRun {
  const pts: Vec2[] = spec.centreline.map(([x, y]) => ({ x, y }));
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1] as number;
  const end = pts[pts.length - 1] as Vec2;
  const maxSteps = Math.ceil(spec.timeLimitS * spec.immediateFailTimeFactor * HZ);
  const locationOf = (seg: number): FaultLocation =>
    spec.segments.find((s) => seg >= s.fromIndex && seg < s.toIndex)?.location ?? "entry";
  const trackers = [lineTouchTracker(spec), coneTracker(spec), footDownTracker(spec)];
  const progress = progressTracker(pts, cum);
  const faults: TrackFault[] = [];
  const done = (steps: number, state: BicycleState, fail: TrackFaultKind | null): TrackRun => ({
    finished: fail === null,
    steps,
    timeS: round2(steps * DT),
    faults,
    immediateFail: fail,
    final: state,
  });

  let state: BicycleState = {
    x: spec.start.x,
    y: spec.start.y,
    headingRad: degToRad(spec.start.headingDeg),
    v: 0,
  };
  let next = 0;
  let current = ZERO;
  for (let step = 0; step < maxSteps; step++) {
    while (next < inputs.length && (inputs[next] as TimedInput).step <= step) {
      current = (inputs[next] as TimedInput).input;
      next++;
    }
    state = stepBicycle(state, step >= releaseStep ? ZERO : current, C.vehicle2W, DT);
    const proj = progress.project(state);
    const loc = locationOf(proj.segment);
    if (proj.distance > spec.halfWidthM + spec.offTrackMarginM) {
      faults.push({ kind: "off_track", step, location: loc });
      return done(step + 1, state, "off_track");
    }
    for (const t of trackers) faults.push(...t.check(state, proj.distance, step, loc));
    if (proj.arc >= spec.finishFraction * total && distance(state, end) <= spec.finishRadiusM) {
      return done(step + 1, state, null);
    }
  }
  faults.push({ kind: "timeout", step: maxSteps, location: locationOf(progress.segment) });
  return done(maxSteps, state, "timeout");
}

/** Input events of one item as step-keyed changes (relative to the item start). */
export function trackInputs(
  events: readonly GameEvent[],
  item: number,
): { inputs: TimedInput[]; releaseStep: number } {
  const t0 = itemStartT(events, item) ?? 0;
  const inputs = events
    .filter((e): e is EventOf<"input"> => e.type === "input" && e.item === item)
    .map((e) => ({ step: stepIndexAt(e.t - t0, HZ), input: e.p }));
  const end = events.find((e) => e.type === "item_end" && e.item === item);
  return {
    inputs,
    releaseStep: end === undefined ? Number.POSITIVE_INFINITY : stepIndexAt(end.t - t0, HZ),
  };
}

export interface DemeritSheet {
  demerits: number;
  overS: number;
  counts: Record<"line_touch" | "cone" | "foot_down", number>;
  pct: number;
  passed: boolean;
}

export function demeritSheet(spec: TrackSpec, run: TrackRun): DemeritSheet {
  const count = (k: TrackFaultKind): number => run.faults.filter((f) => f.kind === k).length;
  const counts = {
    line_touch: count("line_touch"),
    cone: count("cone"),
    foot_down: count("foot_down"),
  };
  const overS = Math.max(0, round2(run.timeS - spec.timeLimitS));
  const d =
    counts.line_touch * spec.demerits.lineTouch +
    counts.cone * spec.demerits.cone +
    counts.foot_down * spec.demerits.footDown +
    (overS > 0 ? Math.ceil(overS / 10) * spec.demerits.overTimePer10s : 0);
  let pct = Math.max(0, 100 - C.demeritPct * d);
  if (run.immediateFail !== null) pct = Math.min(pct, C.immediateFailCapPct);
  return {
    demerits: d,
    overS,
    counts,
    pct,
    passed: d <= spec.passDemerits && run.immediateFail === null,
  };
}

export function scoreTrackTwin(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: TrackTwinContent,
  opts: ScoreOptions,
): SessionResult {
  requireAligned(ctx, content.tracks.length, "track_twin");
  const integrity = runIntegrityChecks(ctx, events, {
    maxEvents: opts.maxEvents ?? GAME_CONFIG.budgets.track_twin.maxEvents,
    defaultTimingMode: "sim",
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
  });
  const runs = content.tracks
    .map((spec, item) => {
      if (integrity.voidedItems.has(item) || itemStartT(events, item) === null) return null;
      const { inputs, releaseStep } = trackInputs(events, item);
      const run = simulateTrack(
        spec,
        inputs,
        itemEndReason(events, item) === null ? Number.POSITIVE_INFINITY : releaseStep,
      );
      return { item, spec, run, sheet: demeritSheet(spec, run) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const n = runs.length;
  const components: ScoreComponent[] = runs.map((r) =>
    component(
      n === 1 ? "demerit_sheet" : `demerit_sheet_${r.item + 1}`,
      r.sheet.pct / n,
      100 / n,
      "track.demerit_sheet",
    ),
  );
  const passRef = (spec: TrackSpec): string => `track:${spec.trackId}@${spec.version}`;
  const first = runs[0];
  return buildResult(ctx, opts, {
    components,
    passed: n === 0 ? null : runs.every((r) => r.sheet.passed),
    passRule:
      first === undefined
        ? null
        : {
            source: first.spec.source === "rule_pack" ? "rule_pack" : "design",
            ref: passRef(first.spec),
          },
    capApplied: runs.some((r) => r.run.immediateFail !== null)
      ? `immediate_fail_cap_${C.immediateFailCapPct}`
      : null,
    findings: ttFindings(ctx, runs),
    evidence: [],
    calibration: null,
    integrity,
  });
}

function ttFindings(
  ctx: SessionContext,
  runs: readonly { item: number; spec: TrackSpec; run: TrackRun; sheet: DemeritSheet }[],
): Finding[] {
  const out: Finding[] = [];
  const ref = (item: number): string | undefined => ctx.items[item]?.ref;
  const all = runs.flatMap((r) => r.run.faults.map((f) => ({ r, f })));
  const rulesOf = (spec: TrackSpec): string[] => [`track:${spec.trackId}@${spec.version}`];

  const fail = all.find(({ f }) => f.kind === "off_track" || f.kind === "timeout");
  if (fail !== undefined) {
    out.push(
      finding({
        findingId: "TT_IMMEDIATE_FAIL",
        severity: 1,
        critical: true,
        skillId: "SK-DL1",
        ruleIds: rulesOf(fail.r.spec),
        drillIds: ["DR-TT-FIG8-SLOW"],
        facts: { fault: fail.f.kind, fault_location: fail.f.location },
        itemRef: ref(fail.r.item),
      }),
    );
  }
  const counted = (
    kind: "foot_down" | "line_touch" | "cone",
    id: string,
    sev: (n: number) => number,
    drill: string,
  ): void => {
    const xs = all.filter(({ f }) => f.kind === kind);
    const firstX = xs[0];
    if (firstX === undefined) return;
    out.push(
      finding({
        findingId: id,
        severity: sev(xs.length),
        skillId: "SK-DL1",
        ruleIds: rulesOf(firstX.r.spec),
        drillIds: [drill],
        facts: { count: xs.length, fault_location: firstX.f.location },
        itemRef: ref(firstX.r.item),
      }),
    );
  };
  counted("foot_down", "TT_FOOT_DOWN", (n) => Math.min(1, 0.4 + 0.2 * n), "DR-TT-FIG8-SLOW");
  counted("line_touch", "TT_LINE_TOUCH", (n) => Math.min(1, 0.2 * n), "DR-TT-FIG8-WIDE");
  counted("cone", "TT_CONE_HIT", (n) => Math.min(1, 0.3 * n), "DR-TT-FIG8-WIDE");

  const late = runs
    .filter((r) => r.sheet.overS > 0)
    .sort((a, b) => b.sheet.overS - a.sheet.overS || a.item - b.item)[0];
  if (late !== undefined && late.run.immediateFail !== "timeout") {
    out.push(
      finding({
        findingId: "TT_OVER_TIME",
        severity: Math.min(1, late.sheet.overS / 30),
        skillId: "SK-DL1",
        ruleIds: rulesOf(late.spec),
        drillIds: ["DR-TT-TIMED"],
        facts: { time_s: late.run.timeS, time_limit_s: late.spec.timeLimitS },
        itemRef: ref(late.item),
      }),
    );
  }
  return out;
}
