import {
  canCreateShareCard,
  type Profile,
  percentileVisible,
  type ShareDecision,
} from "@margdarshak/gamification";
import type { LearnerProfileInfo } from "@/features/games/api";
import {
  type BadgeKey,
  SHARE_DISPLAY_NAME_MAX,
  type ShareCardContentWire,
} from "@/features/games/api-types";

/**
 * Share-card rules on the device (GAMIFICATION_ENGINE §10, §13; gamification `canCreateShareCard`,
 * `percentileVisible`). The device only decides what to offer; the server recomputes every number
 * and re-checks the allowlist and the parent's consent when the card is created.
 */

/** The gamification Profile of the learner the card would be for. */
export function profileFor(info: LearnerProfileInfo, memberId?: string | null): Profile {
  if (info.account === "anonymous") return { kind: "anonymous" };
  const m = memberId ? info.members.find((x) => x.member_id === memberId) : undefined;
  if (!m?.is_minor) return { kind: "adult" };
  const consent = m.parental_consent.status === "granted";
  return {
    kind: "family_minor",
    parentConsents: { shareCards: consent && (m.parental_extras ?? []).includes("share_cards") },
  };
}

/** Who may create a card: an account holder; a minor's profile only with the parent's consent. */
export function shareDecision(profile: Profile): ShareDecision {
  return canCreateShareCard(profile);
}

/** A percentile is printed only once the baseline holds ≥ 200 verified mocks [D]. */
export function percentileForCard(
  percentile: number | null | undefined,
  baselineVerifiedMocks: number,
): number | null {
  return percentile !== null && percentile !== undefined && percentileVisible(baselineVerifiedMocks)
    ? percentile
    : null;
}

/** Initials shown on the card when the learner picks "initials" ("Kabir Sharma" → "KS"). */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The name as the server keeps it in `display_name` mode: at most 20 characters (API-57; a longer
 * name is refused with 422), trimmed.
 */
export function shareDisplayName(name: string): string {
  return Array.from(name.trim()).slice(0, SHARE_DISPLAY_NAME_MAX).join("").trim();
}

/**
 * The preview card: the server's Nazar Score and counted sessions, the chosen name form and badge.
 * Never a date, an RTO, a licence status or a failure; nothing outside the allowlist.
 */
export function previewContent(args: {
  displayName: string;
  nameMode: "display_name" | "initials";
  nazarScore: number;
  countedSessions: number;
  badge: BadgeKey | null;
  keralaLine: boolean;
}): ShareCardContentWire {
  const name = args.nameMode === "initials" ? initials(args.displayName) : args.displayName.trim();
  return {
    display_name: args.nameMode === "initials" ? name : shareDisplayName(name),
    nazar_score: args.nazarScore,
    counted_sessions: args.countedSessions,
    rank: "gali",
    ...(args.badge ? { badge: args.badge } : {}),
    kerala_line: args.keralaLine,
    percentile: null,
    calibration: null,
  };
}
