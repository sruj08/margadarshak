// Share-card rules (GAMIFICATION_ENGINE §10) as pure checks. The card is
// server-rendered from server-recomputed scores; these functions decide what
// may appear on it and who may create one. Sharing earns no XP and unlocks
// nothing (CCPA forced action, DP-04).

import type { BadgeId } from "./badges.ts";
import { featureAccess } from "./family.ts";
import type { RankId } from "./ranks.ts";
import type { EpochMs } from "./time.ts";
import { DAY_MS } from "./time.ts";
import type { Profile } from "./types.ts";

export const SHARE_CARD_TTL_DAYS = 90;
export const PERCENTILE_MIN_BASELINE = 200;
/** Domains for share links must never contain these (verification G10). */
export const BANNED_DOMAIN_PARTS: readonly string[] = ["parivahan", "sarathi", "gov"];

/** The only fields a share card may carry. */
export interface ShareCardContent {
  /** Display name or initials, the user's choice. */
  readonly displayName: string;
  readonly nazarScore: number;
  /** "Verified sessions: n" in the spec; label key `counted_sessions` (PROJECT_BRIEF §15). */
  readonly countedSessions: number;
  readonly rank: RankId;
  /** At most one badge, chosen by the user, and earned. */
  readonly badge?: BadgeId | null;
  readonly keralaLine?: boolean;
  /** Only when the baseline holds ≥ 200 verified mocks. */
  readonly percentile?: number | null;
  /** Calibration details only when the Calibrated badge (B4) is the chosen badge. */
  readonly calibration?: { readonly brier: number } | null;
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "displayName",
  "nazarScore",
  "countedSessions",
  "rank",
  "badge",
  "keralaLine",
  "percentile",
  "calibration",
]);

export type ShareCardViolation =
  | { readonly code: "field_not_allowed"; readonly field: string }
  | { readonly code: "badge_not_earned" }
  | { readonly code: "percentile_baseline_too_small" }
  | { readonly code: "calibration_without_calibrated_badge" }
  | { readonly code: "domain_not_allowed" }
  | { readonly code: "apk_link" };

export interface ShareCardContext {
  readonly earnedBadges: readonly BadgeId[];
  /** Verified mocks in the percentile baseline. */
  readonly baselineVerifiedMocks: number;
  /** Host of the share link (e.g. "margdarshak.app"). */
  readonly linkHost: string;
  /** Any URLs printed on the card or in its share text. */
  readonly urls?: readonly string[];
}

/** Whether a share link host is acceptable: no "parivahan", "sarathi" or "gov" anywhere in it. */
export function isAllowedShareHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h !== "" && !BANNED_DOMAIN_PARTS.some((p) => h.includes(p));
}

/** Whether "better than X% of takers" may be shown (≥ 200 verified mocks in the baseline [D]). */
export function percentileVisible(baselineVerifiedMocks: number): boolean {
  return baselineVerifiedMocks >= PERCENTILE_MIN_BASELINE;
}

/**
 * Checks a proposed card. Any key outside the allowlist is a violation (so
 * PII, RTO, dates, LL/DL status and failures can't slip in), as are an
 * unearned badge, a percentile without the baseline, calibration details
 * without the Calibrated badge, a banned domain and any APK link (DP-13).
 */
export function shareCardViolations(
  card: Readonly<Record<string, unknown>>,
  ctx: ShareCardContext,
): ShareCardViolation[] {
  const out: ShareCardViolation[] = [];
  for (const key of Object.keys(card).sort()) {
    if (!ALLOWED_KEYS.has(key)) out.push({ code: "field_not_allowed", field: key });
  }
  const badge = card["badge"];
  if (badge !== undefined && badge !== null && !ctx.earnedBadges.includes(badge as BadgeId)) {
    out.push({ code: "badge_not_earned" });
  }
  const pct = card["percentile"];
  if (pct !== undefined && pct !== null && !percentileVisible(ctx.baselineVerifiedMocks)) {
    out.push({ code: "percentile_baseline_too_small" });
  }
  const cal = card["calibration"];
  if (cal !== undefined && cal !== null && badge !== "B4") {
    out.push({ code: "calibration_without_calibrated_badge" });
  }
  if (!isAllowedShareHost(ctx.linkHost)) out.push({ code: "domain_not_allowed" });
  for (const u of ctx.urls ?? []) {
    const lower = u.toLowerCase();
    const path = lower.split(/[?#]/, 1)[0] ?? lower;
    if (path.endsWith(".apk")) {
      out.push({ code: "apk_link" });
      break;
    }
  }
  return out;
}

export type ShareDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "needs_account" | "needs_parent_consent" };

/** Who may create a share card: account holders; a family-mode profile after the parent consents; never anonymous sessions. */
export function canCreateShareCard(profile: Profile): ShareDecision {
  const a = featureAccess(profile, "share_card");
  if (a.allowed) return { allowed: true };
  return {
    allowed: false,
    reason: a.reason === "needs_parent_consent" ? "needs_parent_consent" : "needs_account",
  };
}

/** Links expire 90 days after creation [D]; a deleted card is gone immediately. */
export function shareCardLive(createdAt: EpochMs, now: EpochMs, deleted = false): boolean {
  return !deleted && now >= createdAt && now < createdAt + SHARE_CARD_TTL_DAYS * DAY_MS;
}
