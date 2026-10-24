// Squads, co-op only (GAMIFICATION_ENGINE §8). 3–5 members, invite-only links
// that expire after 7 days, a squad score shown only when ≥ 3 members
// contribute (so no individual's score can be inferred), a weekly goal that
// everyone gets or nobody does, and no view of each other's scores,
// calibration or failures.

import { featureAccess } from "./family.ts";
import { roundHalfUp } from "./math.ts";
import type { RankId } from "./ranks.ts";
import type { EpochMs } from "./time.ts";
import { DAY_MS } from "./time.ts";
import type { Profile } from "./types.ts";

export const SQUAD_MIN = 3;
export const SQUAD_MAX = 5;
export const SQUAD_MIN_CONTRIBUTORS = 3;
export const INVITE_TTL_DAYS = 7;
export const SESSIONS_PER_MEMBER_GOAL = 3;
export const SANGATHAN_WEEKS = 3;

/** Preset reactions only: no free-text chat (IT Rules 2021, verification G12). */
export const SQUAD_REACTIONS = ["nice_spot", "lets_go_sunday", "need_help_on_signs"] as const;
export type SquadReaction = (typeof SQUAD_REACTIONS)[number];

export interface SquadScoreMember {
  /** Nazar Score 0–100, null without eligible mocks. */
  readonly nazarScore: number | null;
  /** Personal Brier 0–1, null without rated answers. */
  readonly brier: number | null;
}

/**
 * Squad score = mean over contributing members of NazarScore_i × (1 − B_i),
 * rounded. A member contributes when both values exist. Null below 3
 * contributors.
 */
export function squadScore(members: readonly SquadScoreMember[]): number | null {
  const parts: number[] = [];
  for (const m of members) {
    if (m.nazarScore === null || m.brier === null) continue;
    if (!Number.isFinite(m.nazarScore) || !Number.isFinite(m.brier)) continue;
    const n = Math.min(100, Math.max(0, m.nazarScore));
    const b = Math.min(1, Math.max(0, m.brier));
    parts.push(n * (1 - b));
  }
  if (parts.length < SQUAD_MIN_CONTRIBUTORS) return null;
  return roundHalfUp(parts.reduce((s, x) => s + x, 0) / parts.length);
}

export type SquadJoinDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "needs_account" | "needs_parent_consent" | "squad_full" | "invite_expired";
    };

/**
 * Whether a profile may join a squad: account holders yes; a family-mode
 * profile only after the parent consents (D-13 revised, §13); anonymous
 * sessions never (needs an account); never past 5 members or with an expired
 * invite link.
 */
export function canJoinSquad(
  profile: Profile,
  squad: { readonly memberCount: number; readonly inviteCreatedAt: EpochMs },
  now: EpochMs,
): SquadJoinDecision {
  const access = featureAccess(profile, "squads");
  if (!access.allowed) {
    return {
      allowed: false,
      reason: access.reason === "needs_parent_consent" ? "needs_parent_consent" : "needs_account",
    };
  }
  if (squad.memberCount >= SQUAD_MAX) return { allowed: false, reason: "squad_full" };
  if (!inviteValid(squad.inviteCreatedAt, now)) return { allowed: false, reason: "invite_expired" };
  return { allowed: true };
}

/** Pair mode needs the same consent as squads for a family-mode profile. */
export function canUsePairMode(profile: Profile): boolean {
  return featureAccess(profile, "pair_mode").allowed;
}

/** Invite links expire 7 days after creation. */
export function inviteValid(createdAt: EpochMs, now: EpochMs): boolean {
  return now >= createdAt && now < createdAt + INVITE_TTL_DAYS * DAY_MS;
}

/** Weekly squad goal = 3 × members [D] (e.g. 15 for 5). */
export function squadWeeklyGoal(memberCount: number): number {
  return SESSIONS_PER_MEMBER_GOAL * Math.max(0, Math.floor(memberCount));
}

/** Everyone gets the weekly ribbon, or nobody does: one boolean for the whole squad. */
export function squadRibbon(sessionsPerMember: readonly number[]): boolean {
  const total = sessionsPerMember.reduce((s, x) => s + Math.max(0, Math.floor(x)), 0);
  return sessionsPerMember.length > 0 && total >= squadWeeklyGoal(sessionsPerMember.length);
}

/** Squad Sangathan ribbon: weekly squad goal met 3 times (a squad ribbon, not a personal badge). */
export function sangathanRibbon(weeklyRibbons: readonly boolean[]): boolean {
  return weeklyRibbons.filter(Boolean).length >= SANGATHAN_WEEKS;
}

export interface SquadMemberRecord {
  readonly displayName: string;
  readonly rank: RankId;
  readonly weeklyGoalHit: boolean;
}

/** What members see of each other: display name, rank, goal yes/no. Nothing else (no scores, calibration or failures). */
export function memberView(member: SquadMemberRecord): SquadMemberRecord {
  return {
    displayName: member.displayName,
    rank: member.rank,
    weeklyGoalHit: member.weeklyGoalHit,
  };
}
