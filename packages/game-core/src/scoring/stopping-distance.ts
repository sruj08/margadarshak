// G2 Stopping Distance scoring (GAME_DESIGN §3.7, DEBRIEF_SPEC §2.2).
// Round 1 estimation (30), round 2 speed + react without collision (20), round 3 speed for sight
// (50). Physics from sim/stopping with the teaching values μ_dry 0.7, μ_wet 0.4, t_r 1.5 s. The
// reaction time is reported, never scored: anticipation is rewarded through the speed choice.
import { runIntegrityChecks } from "../integrity/checks.ts";
import type { SdRound, StoppingDistanceContent } from "../schema/content.ts";
import type { EventOf, GameEvent } from "../schema/events.ts";
import type { Surface } from "../schema/ids.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type { Finding, IntegrityFlag, ScoreComponent, SessionResult } from "../schema/result.ts";
import { randInt, subStream } from "../sim/prng.ts";
import { round1 as round1Dp, round2 } from "../sim/quantise.ts";
import {
  collides,
  impactSpeed,
  kmhToMps,
  maxSafeOptionKmh,
  mpsToKmh,
  totalStoppingDistance,
  type WhoBand,
  whoBand,
} from "../sim/stopping.ts";
import { buildResult, component, finding, requireAligned, type ScoreOptions } from "./common.ts";
import { GAME_CONFIG } from "./config.ts";

const C = GAME_CONFIG.stoppingDistance;
const mu = (s: Surface): number => C.mu[s];

type Round2 = Extract<SdRound, { round: 2 }>;
type Round3 = Extract<SdRound, { round: 3 }>;

/** Seeded distance (m) at which the child steps out in round 2; attempt counts re-deals. */
export function sdChildDistanceM(
  seed: number,
  item: number,
  attempt: number,
  spec: Round2,
): number {
  return randInt(
    subStream(seed, `sd:child:${item}:${attempt}`),
    spec.childDistanceM.min,
    spec.childDistanceM.max,
  );
}

/** Seeded clear sight distance (m) for a round-3 item. */
export function sdSightM(seed: number, item: number, spec: Round3): number {
  return randInt(subStream(seed, `sd:sight:${item}`), spec.sightM.min, spec.sightM.max);
}

/** True total stopping distance (m) with the teaching reaction time. */
export function sdTrueDistanceM(speedKmh: number, surface: Surface): number {
  return totalStoppingDistance(kmhToMps(speedKmh), C.reactionTimeS, mu(surface));
}

interface R1 {
  item: number;
  speedKmh: number;
  surface: Surface;
  trueM: number;
  predictedM: number | null;
  accuracy: number;
  errorPct: number | null;
}
interface R2 {
  item: number;
  surface: Surface;
  chosenKmh: number | null;
  rtMs: number | null;
  childM: number;
  collision: boolean;
  impactKmh: number;
  band: WhoBand | null;
  stopM: number | null;
}
interface R3 {
  item: number;
  surface: Surface;
  sightM: number;
  chosenKmh: number | null;
  maxOptKmh: number;
  overKmh: number;
  share: number;
}

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

export function scoreStoppingDistance(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: StoppingDistanceContent,
  opts: ScoreOptions,
): SessionResult {
  requireAligned(ctx, content.rounds.length, "stopping_distance");
  const extraFlags: IntegrityFlag[] = [];
  const r1: R1[] = [];
  const r2: R2[] = [];
  const r3: R3[] = [];
  const own = (item: number): GameEvent[] => events.filter((e) => e.item === item);

  // Integrity first so voided items are skipped (learn/practice: excluded from the max).
  const anticipatory = events.some(
    (e) => e.type === "brake" && e.p.rtMs !== undefined && e.p.rtMs < C.anticipatoryRtMs,
  );
  if (anticipatory) extraFlags.push("INT_RT_ANTICIPATORY");
  const integrity = runIntegrityChecks(ctx, events, {
    maxEvents: opts.maxEvents ?? GAME_CONFIG.budgets.stopping_distance.maxEvents,
    defaultTimingMode: "none",
    extraFlags,
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
  });

  content.rounds.forEach((spec, item) => {
    if (integrity.voidedItems.has(item)) return;
    const evs = own(item);
    if (spec.round === 1) r1.push(scoreRound1(item, spec, evs));
    else if (spec.round === 2) r2.push(scoreRound2(ctx.seed, item, spec, evs));
    else r3.push(scoreRound3(ctx.seed, item, spec, evs));
  });

  return buildResult(ctx, opts, {
    components: sdComponents(r1, r2, r3),
    passed: null,
    passRule: null,
    capApplied: null,
    findings: sdFindings(ctx, r1, r2, r3),
    evidence: [],
    calibration: null,
    integrity,
  });
}

type Round1 = Extract<SdRound, { round: 1 }>;

function scoreRound1(item: number, spec: Round1, evs: readonly GameEvent[]): R1 {
  const trueM = sdTrueDistanceM(spec.speedKmh, spec.surface);
  const est = last(evs.filter((e): e is EventOf<"estimate"> => e.type === "estimate"));
  const predictedM = est?.p.predictedM ?? null;
  return {
    item,
    speedKmh: spec.speedKmh,
    surface: spec.surface,
    trueM,
    predictedM,
    accuracy: predictedM === null ? 0 : Math.max(0, 1 - Math.abs(predictedM - trueM) / trueM),
    errorPct: predictedM === null ? null : round1Dp(((predictedM - trueM) / trueM) * 100),
  };
}

/** The first valid reaction time; anticipatory taps (rt < 100 ms) re-deal and bump the attempt. */
function firstValidBrake(evs: readonly GameEvent[]): { attempt: number; rtMs: number | null } {
  let attempt = 0;
  for (const b of evs.filter((e): e is EventOf<"brake"> => e.type === "brake")) {
    if (b.p.rtMs === undefined) continue;
    if (b.p.rtMs >= C.anticipatoryRtMs) return { attempt, rtMs: b.p.rtMs };
    attempt += 1;
  }
  return { attempt, rtMs: null };
}

function scoreRound2(seed: number, item: number, spec: Round2, evs: readonly GameEvent[]): R2 {
  const choice = last(
    evs.filter(
      (e): e is EventOf<"speed_choice"> => e.type === "speed_choice" && e.p.context === "street",
    ),
  );
  const { attempt, rtMs } = firstValidBrake(evs);
  const childM = sdChildDistanceM(seed, item, attempt, spec);
  const base = { item, surface: spec.surface, rtMs, childM };
  if (choice === undefined) {
    return { ...base, chosenKmh: null, collision: true, impactKmh: 0, band: null, stopM: null };
  }
  const v = kmhToMps(choice.p.chosenKmh);
  const m = mu(spec.surface);
  if (rtMs === null) {
    // No valid brake: the rider never reacted, so the full speed reaches the child.
    const impactKmh = round1Dp(mpsToKmh(v));
    return {
      ...base,
      chosenKmh: choice.p.chosenKmh,
      collision: true,
      impactKmh,
      band: whoBand(impactKmh),
      stopM: null,
    };
  }
  const rtS = rtMs / 1000;
  const collision = collides(v, rtS, m, childM);
  const impactKmh = collision ? round1Dp(mpsToKmh(impactSpeed(v, rtS, m, childM))) : 0;
  return {
    ...base,
    chosenKmh: choice.p.chosenKmh,
    collision,
    impactKmh,
    band: collision ? whoBand(impactKmh) : null,
    stopM: round1Dp(totalStoppingDistance(v, rtS, m)),
  };
}

function scoreRound3(seed: number, item: number, spec: Round3, evs: readonly GameEvent[]): R3 {
  const sightM = sdSightM(seed, item, spec);
  const maxOptKmh = maxSafeOptionKmh(sightM, C.reactionTimeS, mu(spec.surface));
  const choice = last(
    evs.filter(
      (e): e is EventOf<"speed_choice"> => e.type === "speed_choice" && e.p.context !== "street",
    ),
  );
  const chosenKmh = choice?.p.chosenKmh ?? null;
  const overKmh = chosenKmh === null ? 0 : Math.max(0, chosenKmh - maxOptKmh);
  const share =
    chosenKmh === null ? 0 : Math.max(0, 1 - C.sightPenaltyPerStep * Math.ceil(overKmh / 5));
  return { item, surface: spec.surface, sightM, chosenKmh, maxOptKmh, overKmh, share };
}

function sdComponents(r1: readonly R1[], r2: readonly R2[], r3: readonly R3[]): ScoreComponent[] {
  const out: ScoreComponent[] = [];
  if (r1.length > 0) {
    const mean = r1.reduce((s, x) => s + x.accuracy, 0) / r1.length;
    out.push(
      component("estimation", C.estimationMax * mean, C.estimationMax, "stopping.estimation"),
    );
  }
  if (r2.length > 0) {
    const safe = r2.filter((x) => !x.collision).length;
    out.push(
      component(
        "no_collision",
        (C.noCollisionMax * safe) / r2.length,
        C.noCollisionMax,
        "stopping.no_collision",
      ),
    );
  }
  if (r3.length > 0) {
    const sum = r3.reduce((s, x) => s + (C.sightMax / r3.length) * x.share, 0);
    out.push(component("speed_for_sight", sum, C.sightMax, "stopping.speed_for_sight"));
  }
  return out;
}

function sdFindings(
  ctx: SessionContext,
  r1: readonly R1[],
  r2: readonly R2[],
  r3: readonly R3[],
): Finding[] {
  const out: Finding[] = [];
  const ref = (item: number): string | undefined => ctx.items[item]?.ref;

  const over = r3
    .filter((x) => x.overKmh > 0)
    .sort((a, b) => b.overKmh - a.overKmh || a.item - b.item)[0];
  if (over !== undefined) {
    out.push(
      finding({
        findingId: "SD_OVERSPEED_FOR_SIGHT",
        severity: Math.min(1, over.overKmh / 20),
        skillId: "SK-M1",
        ruleIds: ["RR-SPD-001"],
        drillIds: [over.surface === "wet" ? "DR-SD-SIGHT-WET" : "DR-SD-SIGHT-DRY"],
        facts: {
          chosen_kmh: over.chosenKmh ?? 0,
          max_safe_kmh: over.maxOptKmh,
          sight_m: over.sightM,
          surface: over.surface,
          over_kmh: over.overKmh,
        },
        itemRef: ref(over.item),
      }),
    );
  }

  const answered = r1.filter(
    (x): x is R1 & { errorPct: number; predictedM: number } => x.errorPct !== null,
  );
  if (answered.length > 0) {
    const meanErr = answered.reduce((s, x) => s + x.errorPct, 0) / answered.length;
    if (meanErr < C.underestimateMeanPct) {
      const worst = [...answered].sort(
        (a, b) => a.errorPct - b.errorPct || a.item - b.item,
      )[0] as (typeof answered)[0];
      out.push(
        finding({
          findingId: "SD_UNDERESTIMATE",
          severity: Math.min(1, Math.abs(meanErr) / 50),
          skillId: "SK-M1",
          ruleIds: ["RR-SPD-001"],
          drillIds: ["DR-SD-PREDICT"],
          facts: {
            speed_kmh: worst.speedKmh,
            surface: worst.surface,
            predicted_m: worst.predictedM,
            true_m: round1Dp(worst.trueM),
            error_pct: worst.errorPct,
          },
          itemRef: ref(worst.item),
        }),
      );
    }
    const absMean = (s: Surface): number | null => {
      const xs = answered.filter((x) => x.surface === s);
      return xs.length === 0
        ? null
        : round1Dp(xs.reduce((a, x) => a + Math.abs(x.errorPct), 0) / xs.length);
    };
    const wet = absMean("wet");
    const dry = absMean("dry");
    if (wet !== null && dry !== null && wet >= C.wetGapFactor * dry && wet >= C.wetGapMinErrPct) {
      out.push(
        finding({
          findingId: "SD_WET_GAP",
          severity: 0.6,
          skillId: "SK-M16",
          ruleIds: ["RR-FOG-001"],
          drillIds: ["DR-SD-PREDICT-WET"],
          facts: { wet_err_pct: wet, dry_err_pct: dry },
        }),
      );
    }
  }

  const hit = r2
    .filter(
      (x): x is R2 & { chosenKmh: number; band: WhoBand } =>
        x.collision && x.chosenKmh !== null && x.band !== null,
    )
    .sort((a, b) => b.impactKmh - a.impactKmh || a.item - b.item)[0];
  if (hit !== undefined) {
    out.push(
      finding({
        findingId: "SD_COLLISION",
        severity: 0.5 + 0.5 * (hit.band === "below_50" ? 0 : 1),
        skillId: "SK-M2",
        ruleIds: ["RR-SPD-003"],
        drillIds: ["DR-SD-STREET"],
        facts: {
          speed_kmh: hit.chosenKmh,
          rt_s: hit.rtMs === null ? undefined : round2(hit.rtMs / 1000),
          impact_band: hit.band,
          stop_m: hit.stopM ?? undefined,
          child_m: hit.childM,
        },
        itemRef: ref(hit.item),
      }),
    );
  }
  return out;
}
