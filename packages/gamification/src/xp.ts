// XP (GAMIFICATION_ENGINE §2). XP is a pure function of the session (DP-14: no
// random or mystery rewards) and of the minutes already played in the IST day.
//
//   XP_session = round(base(mode) × quality × diminish × trustFactor)
//   quality    = max(0.3, pct / 100)
//   trust      = 1.0 if integrity.trust ≥ 0.6 else 0.5
//   XP_review  = round(5 × dueCards × diminish)

import { clamp, roundHalfUp, snap } from "./math.ts";
import type { SessionMode, SessionResultLike } from "./types.ts";

/** Base XP per mode (§2.1). `pair` plays practice content, so it uses the practice base. */
export const XP_BASE: Readonly<Record<SessionMode, number>> = {
  mock: 40,
  practice: 20,
  pair: 20,
  learn: 15,
};

export const XP_PER_DUE_REVIEW = 5;
export const QUALITY_FLOOR = 0.3;
export const TRUST_THRESHOLD = 0.6;
export const LOW_TRUST_FACTOR = 0.5;

/** Diminishing-returns bands (§2.2), in minutes of active learning in the IST day. */
export const DIMINISH_BANDS: readonly { readonly from: number; readonly multiplier: number }[] = [
  { from: 0, multiplier: 1.0 },
  { from: 45, multiplier: 0.5 },
  { from: 90, multiplier: 0.2 },
];

/**
 * Multiplier for the minute starting at `minute` (minutes already played today).
 * Minute 44→45 is the last full-rate minute; once 45 minutes are played the
 * next minute earns ×0.5, and once 90 are played, ×0.2.
 */
export function multiplierAt(minute: number): number {
  const m = Math.max(0, minute);
  let mult = 1;
  for (const band of DIMINISH_BANDS) if (m >= band.from) mult = band.multiplier;
  return mult;
}

/**
 * Effective multiplier for activity of `sessionMinutes` that starts after
 * `minutesBefore` minutes already played in the IST day. A session that
 * straddles 45 or 90 is split pro rata (time-weighted mean of the bands it
 * covers). With `sessionMinutes` 0 this is the point multiplier.
 */
export function diminish(minutesBefore: number, sessionMinutes = 0): number {
  const start = Math.max(0, Number.isFinite(minutesBefore) ? minutesBefore : 0);
  const len = Math.max(0, Number.isFinite(sessionMinutes) ? sessionMinutes : 0);
  if (len === 0) return multiplierAt(start);
  const end = start + len;
  let weighted = 0;
  for (let i = 0; i < DIMINISH_BANDS.length; i++) {
    const band = DIMINISH_BANDS[i];
    if (band === undefined) continue;
    const bandEnd = DIMINISH_BANDS[i + 1]?.from ?? Number.POSITIVE_INFINITY;
    const overlap = Math.min(end, bandEnd) - Math.max(start, band.from);
    if (overlap > 0) weighted += overlap * band.multiplier;
  }
  return snap(weighted / len);
}

export interface XpAward {
  readonly xp: number;
  readonly base: number;
  readonly quality: number;
  readonly diminish: number;
  readonly trustFactor: number;
  /** Set when the award is 0 by rule (§2.3), e.g. a mock replaying clips already seen. */
  readonly zeroReason?: "seen_clip_replay";
}

/**
 * XP for one verified scored session (§2.1). `minutesToday` is the active
 * learning minutes already accrued in the user's IST day **before** this
 * session started; `sessionMinutes` is this session's verified duration, used
 * to split it pro rata across the 45/90-minute boundaries. Only verified
 * sessions belong in the XP ledger (GAME_SDK §6.4); the caller decides that.
 */
export function xpForSession(
  result: SessionResultLike,
  minutesToday: number,
  sessionMinutes = 0,
): XpAward {
  const base = XP_BASE[result.mode];
  const quality = Math.max(QUALITY_FLOOR, clamp(result.score.pct, 0, 100) / 100);
  const trust = Number.isFinite(result.integrity.trust) ? result.integrity.trust : 0;
  const trustFactor = trust >= TRUST_THRESHOLD ? 1.0 : LOW_TRUST_FACTOR;
  const dim = diminish(minutesToday, sessionMinutes);
  // §2.3: replaying a mock clip already seen never earns XP (defence in depth;
  // Nazar mocks are unseen-only, so the verifier's INT_SEEN_CLIP should never fire).
  if (result.mode === "mock" && result.integrity.flags.includes("INT_SEEN_CLIP")) {
    return { xp: 0, base, quality, diminish: dim, trustFactor, zeroReason: "seen_clip_replay" };
  }
  return {
    xp: roundHalfUp(base * quality * dim * trustFactor),
    base,
    quality,
    diminish: dim,
    trustFactor,
  };
}

/**
 * XP for FSRS reviews (§2.1): 5 per **due** card reviewed, any rating. Non-due
 * re-reviews (cramming) earn 0, so pass only the due count. `reviewMinutes`
 * splits the sitting pro rata like a session.
 */
export function xpForReviews(
  dueCardsReviewed: number,
  minutesToday: number,
  reviewMinutes = 0,
): XpAward {
  const n = Math.max(0, Math.floor(Number.isFinite(dueCardsReviewed) ? dueCardsReviewed : 0));
  const base = XP_PER_DUE_REVIEW * n;
  const dim = diminish(minutesToday, reviewMinutes);
  return { xp: roundHalfUp(base * dim), base, quality: 1, diminish: dim, trustFactor: 1 };
}

/** Actions that never earn XP (§2.3). */
export const NO_XP_ACTIONS = [
  "app_open",
  "streak_day",
  "share",
  "invite",
  "squad_join",
  "profile_complete",
  "morth_tutorial",
  "mock_clip_replay",
] as const;
export type NoXpAction = (typeof NO_XP_ACTIONS)[number];

/** Always 0: these actions are not learning (§0 principle 1, §2.3, DP-04). */
export function xpForAction(_action: NoXpAction): 0 {
  return 0;
}

/**
 * Whether to show the calm spacing line ("Good session. Your brain keeps more
 * if you come back tomorrow.") — once, when the day's minutes cross 45. No
 * lock, no nag (§2.2).
 */
export function crossedSpacingLine(minutesBefore: number, minutesAfter: number): boolean {
  return minutesBefore < 45 && minutesAfter >= 45;
}
