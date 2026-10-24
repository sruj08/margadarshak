// Structural input types. These mirror only the fields of game-core's
// `SessionResult` (GAME_SDK §10) that this package reads, so a real
// `SessionResult` (or its `evidence[]` entries) is assignable to them without
// importing @margdarshak/game-core.

import type { EpochMs } from "./time.ts";

export type SessionMode = "learn" | "practice" | "mock" | "pair";

/** The subset of `SessionResult` that XP and badges read. */
export interface SessionResultLike {
  readonly gameId: string;
  readonly mode: SessionMode;
  readonly score: { readonly pct: number; readonly capApplied?: string | null };
  readonly findings?: readonly { readonly findingId: string; readonly critical: boolean }[];
  readonly integrity: { readonly trust: number; readonly flags: readonly string[] };
}

/** Stated confidence, as in `SessionResult.evidence[].confidence`. */
export type ConfidenceLevel = "50" | "75" | "100";

/**
 * One answer for calibration and readiness. `SessionResult.evidence[]` entries
 * are assignable; entries without `confidence` are ignored where the spec says
 * "confidence-rated".
 */
export interface RatedAnswer {
  readonly correct: boolean;
  readonly confidence?: ConfidenceLevel | undefined;
}

/** FSRS grade from game-core's `ratingFromEvidence`: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type ReviewRating = 1 | 2 | 3 | 4;

/** One row of the append-only review log (E-18, GAMIFICATION_ENGINE §4.2). */
export interface ReviewLogEntry {
  readonly cardId: string;
  readonly rating: ReviewRating;
  readonly reviewedAt: EpochMs;
  readonly sourceSid?: string | undefined;
  readonly confidence?: ConfidenceLevel | undefined;
}

/** Who is using the app (GAMIFICATION_ENGINE §1, §13). */
export type ProfileKind = "adult" | "anonymous" | "family_minor";

/** Parent consents that unlock social features for a family-mode profile (D-13 revised). */
export interface ParentConsents {
  readonly squads?: boolean;
  readonly pairMode?: boolean;
  readonly shareCards?: boolean;
  readonly notifications?: boolean;
}

export interface Profile {
  readonly kind: ProfileKind;
  /** Only read for `family_minor`. */
  readonly parentConsents?: ParentConsents | undefined;
}
