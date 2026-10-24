import type { ParentConsents, Profile } from "@margdarshak/gamification";
import { getActiveCase } from "@/lib/case/case-store";
import { LEARN_KEYS, readKv, writeKv } from "./offline/kv";

/**
 * Who is learning on this phone (GAMIFICATION_ENGINE §1, §13; D-13 revised). A family-mode case for a
 * minor makes the profile `family_minor`: every learning feature works as for anyone, and squads and
 * share cards wait for the parent's consent. The consent recorded here is the device (mock) stand-in
 * for API-60 `parental-consent` with the `squads` extra; with the real API the server decides
 * (403 PARENT_CONSENT_REQUIRED) and this record only remembers that the parent was asked.
 */

export interface LearnerProfile extends Profile {
  memberId: string | null;
  memberLabel: string | null;
}

interface ConsentRecord {
  memberId: string | null;
  squads: boolean;
  at: string;
}

export function learnerProfile(): LearnerProfile {
  const c = getActiveCase();
  if (c?.minor) {
    const rec = readKv<ConsentRecord | null>(LEARN_KEYS.consent, null);
    const consents: ParentConsents =
      rec && rec.memberId === c.memberId ? { squads: rec.squads } : {};
    return {
      kind: "family_minor",
      parentConsents: consents,
      memberId: c.memberId,
      memberLabel: c.memberLabel,
    };
  }
  return { kind: "adult", memberId: c?.memberId ?? null, memberLabel: c?.memberLabel ?? null };
}

/** The parent said yes to squads for this member (recorded on this phone in mock mode). */
export function recordSquadConsent(memberId: string | null, squads: boolean): void {
  writeKv(LEARN_KEYS.consent, { memberId, squads, at: new Date().toISOString() });
}
