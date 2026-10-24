/**
 * Every number Stopping Distance shows comes from here, and everything here comes from game-core
 * (`sim/stopping` physics with the teaching values in `GAME_CONFIG.stoppingDistance`, and the
 * scorer's own seeded helpers). The UI never types a distance, a speed limit or a friction value
 * (FRONTEND §10.4, GAME_DESIGN §3.7). The outcome helpers mirror `scoreStoppingDistance` exactly, so
 * what the reveal says is what the server replay will find.
 */
import type { SdRound, Surface } from "@margdarshak/game-core/schema";
import { GAME_CONFIG, sdChildDistanceM, sdSightM } from "@margdarshak/game-core/scoring";
import {
  brakingDistance,
  collides,
  impactSpeed,
  kmhToMps,
  maxSafeOptionKmh,
  mpsToKmh,
  reactionDistance,
  round1,
  totalStoppingDistance,
  type WhoBand,
  whoBand,
} from "@margdarshak/game-core/sim";

const C = GAME_CONFIG.stoppingDistance;

export type Round1 = Extract<SdRound, { round: 1 }>;
export type Round2 = Extract<SdRound, { round: 2 }>;
export type Round3 = Extract<SdRound, { round: 3 }>;

/** Teaching values shown in the brief and the reveal ("real roads vary"). */
export const TEACHING = {
  reactionS: C.reactionTimeS,
  muDry: C.mu.dry,
  muWet: C.mu.wet,
  anticipatoryMs: C.anticipatoryRtMs,
} as const;

const mu = (s: Surface): number => C.mu[s];

export interface StopBreakdown {
  /** Distance covered before the brakes bite (m). */
  reactionM: number;
  /** Braking distance (m). */
  brakingM: number;
  /** `totalStoppingDistance` (m). */
  totalM: number;
}

/** Thinking + braking distance at a speed and surface, with the teaching (or a measured) reaction. */
export function stopBreakdown(
  speedKmh: number,
  surface: Surface,
  reactionS: number = C.reactionTimeS,
): StopBreakdown {
  const v = kmhToMps(speedKmh);
  return {
    reactionM: reactionDistance(v, reactionS),
    brakingM: brakingDistance(v, mu(surface)),
    totalM: totalStoppingDistance(v, reactionS, mu(surface)),
  };
}

/** Metres to one decimal, as the reveal shows them (game-core rounding). */
export const m1 = (m: number): number => round1(m);

/** True when a reaction time counts as an anticipatory tap (re-deals the round, never a stop). */
export const isAnticipatory = (rtMs: number): boolean => rtMs < C.anticipatoryRtMs;

/** The seeded distance (m) at which the child steps out, for this attempt. */
export const childDistanceM = (seed: number, item: number, attempt: number, spec: Round2): number =>
  sdChildDistanceM(seed, item, attempt, spec);

/** The seeded clear sight distance (m) of a round-3 item. */
export const sightDistanceM = (seed: number, item: number, spec: Round3): number =>
  sdSightM(seed, item, spec);

export interface StreetOutcome {
  collision: boolean;
  /** km/h at the child's position (0 when stopped in time). */
  impactKmh: number;
  band: WhoBand | null;
  /** Total stopping distance with the measured reaction (m), null when nobody braked. */
  stopM: number | null;
  /** Reaction distance with the measured reaction (m). */
  reactionM: number | null;
}

/** Round 2 outcome, exactly as `scoreStoppingDistance` derives it on replay. */
export function streetOutcome(
  chosenKmh: number,
  rtMs: number | null,
  childM: number,
  surface: Surface,
): StreetOutcome {
  const v = kmhToMps(chosenKmh);
  if (rtMs === null) {
    const impactKmh = round1(mpsToKmh(v));
    return { collision: true, impactKmh, band: whoBand(impactKmh), stopM: null, reactionM: null };
  }
  const rtS = rtMs / 1000;
  const collision = collides(v, rtS, mu(surface), childM);
  const impactKmh = collision ? round1(mpsToKmh(impactSpeed(v, rtS, mu(surface), childM))) : 0;
  return {
    collision,
    impactKmh,
    band: collision ? whoBand(impactKmh) : null,
    stopM: round1(totalStoppingDistance(v, rtS, mu(surface))),
    reactionM: round1(reactionDistance(v, rtS)),
  };
}

/** Seconds the bike needs to reach the child at the chosen speed: after that, no brake can help. */
export const reachMs = (chosenKmh: number, childM: number): number =>
  (childM / kmhToMps(chosenKmh)) * 1000;

export interface SightOutcome {
  /** Highest 5 km/h option that still stops within the sight distance. */
  maxSafeKmh: number;
  /** Stopping distance at the chosen speed (m). */
  stopM: number;
  overKmh: number;
}

/** Round 3 outcome, exactly as the scorer derives it (teaching reaction time). */
export function sightOutcome(chosenKmh: number, sightM: number, surface: Surface): SightOutcome {
  const maxSafeKmh = maxSafeOptionKmh(sightM, C.reactionTimeS, mu(surface));
  return {
    maxSafeKmh,
    stopM: round1(totalStoppingDistance(kmhToMps(chosenKmh), C.reactionTimeS, mu(surface))),
    overKmh: Math.max(0, chosenKmh - maxSafeKmh),
  };
}
