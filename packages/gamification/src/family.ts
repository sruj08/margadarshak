// Who gets what (GAMIFICATION_ENGINE §1) and family-mode rules (§13,
// D-13 revised, P-07, EC-01, EC-05). A learner under 18 uses Margdarshak inside
// a parent's adult account; every learning feature works as for anyone, the
// social features (squads, pair mode, share cards) need the parent's consent,
// and a minor's data is never used for behavioural tracking, profiling,
// targeted ads or marketing (DPDP s.9(3)).

import type { EpochMs } from "./time.ts";
import { civilFromDays, istDay } from "./time.ts";
import type { Profile } from "./types.ts";

export type Feature =
  | "fsrs"
  | "readiness"
  | "xp"
  | "ranks"
  | "streak"
  | "badges"
  | "self_declared_badges"
  | "squads"
  | "pair_mode"
  | "share_card"
  | "practice_record"
  | "notifications"
  | "marketing"
  | "behavioural_profiling"
  | "targeted_ads";

export type Access =
  /** Server + device cache. */
  | { readonly allowed: true; readonly scope: "server" }
  /** Device only; migrates on account creation where §1 says so. */
  | { readonly allowed: true; readonly scope: "device" }
  | {
      readonly allowed: false;
      readonly reason: "needs_account" | "needs_parent_consent" | "never_for_minors";
    };

const SERVER: Access = { allowed: true, scope: "server" };
const DEVICE: Access = { allowed: true, scope: "device" };
const NEEDS_ACCOUNT: Access = { allowed: false, reason: "needs_account" };
const NEEDS_PARENT: Access = { allowed: false, reason: "needs_parent_consent" };
const NEVER_MINOR: Access = { allowed: false, reason: "never_for_minors" };

/**
 * Feature access per §1 and §13. Adult marketing and profiling are governed
 * by consent artefacts elsewhere (E-15); this function only encodes the
 * child-data bans, so for adults those return `server` (allowed subject to
 * their own consent).
 */
export function featureAccess(profile: Profile, feature: Feature): Access {
  if (profile.kind === "adult") return SERVER;
  if (profile.kind === "anonymous") {
    switch (feature) {
      case "fsrs":
      case "readiness":
      case "xp":
      case "ranks":
      case "streak":
      case "badges":
        return DEVICE;
      default:
        return NEEDS_ACCOUNT;
    }
  }
  const c = profile.parentConsents ?? {};
  switch (feature) {
    case "squads":
      return c.squads === true ? SERVER : NEEDS_PARENT;
    case "pair_mode":
      return c.pairMode === true ? SERVER : NEEDS_PARENT;
    case "share_card":
      return c.shareCards === true ? SERVER : NEEDS_PARENT;
    case "notifications":
      // Opt-in by the parent, ≤ 1/day, never marketing.
      return c.notifications === true ? SERVER : NEEDS_PARENT;
    case "marketing":
    case "behavioural_profiling":
    case "targeted_ads":
      return NEVER_MINOR;
    default:
      return SERVER;
  }
}

export type AgeBand = "u18" | "adult";

export interface AgeInput {
  /** Full date of birth "YYYY-MM-DD", when known. */
  readonly dob?: string;
  /** Year of birth only (EC-01: Aadhaar with only a year). */
  readonly birthYear?: number;
  /** A DOB document has been confirmed. */
  readonly dobDocumentConfirmed?: boolean;
}

function parseYmd(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Age band from the DOB, on the IST calendar (§13 rule 1). With only a year of
 * birth (EC-01) the learner stays u18 while the computed age (current year −
 * birth year) is within a year of 18, until a DOB document is confirmed.
 * Unknown age is treated as u18 (the safer band).
 */
export function ageBand(input: AgeInput, now: EpochMs): AgeBand {
  const [y, mo, d] = civilFromDays(istDay(now));
  if (input.dob !== undefined) {
    const p = parseYmd(input.dob);
    if (p !== null) {
      const [by, bm, bd] = p;
      const age = y - by - (mo < bm || (mo === bm && d < bd) ? 1 : 0);
      return age >= 18 ? "adult" : "u18";
    }
  }
  if (input.birthYear !== undefined && Number.isFinite(input.birthYear)) {
    const computed = y - input.birthYear;
    if (computed < 18) return "u18";
    if (Math.abs(computed - 18) <= 1 && input.dobDocumentConfirmed !== true) return "u18";
    return "adult";
  }
  return "u18";
}

/**
 * §13 rule 4: on turning 18 the learner is *offered* (never auto-enrolled)
 * their own account. Returns "offer" for a family-mode profile now in the
 * adult band; "none" otherwise.
 */
export function ownAccountOffer(profile: Profile, band: AgeBand): "offer" | "none" {
  return profile.kind === "family_minor" && band === "adult" ? "offer" : "none";
}
