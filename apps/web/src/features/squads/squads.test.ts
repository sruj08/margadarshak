import { canJoinSquad, featureAccess } from "@margdarshak/gamification";
import { describe, expect, it } from "vitest";
import * as mock from "@/features/learn/mock-api";
import type { LearnerProfile } from "@/features/learn/profile";
import { inviteToken, nameProblem, parseInvite } from "./invite";

const NOW = Date.UTC(2026, 9, 24, 6);

const minor = (squads?: boolean): LearnerProfile => ({
  kind: "family_minor",
  parentConsents: squads === undefined ? {} : { squads },
  memberId: "fam_DEMO01",
  memberLabel: "Rahul",
});
const adult: LearnerProfile = { kind: "adult", memberId: null, memberLabel: null };

describe("squads need the parent's consent for a minor (D-13 revised, MD-236)", () => {
  it("canJoinSquad blocks a family-mode minor without the squads consent", () => {
    const d = canJoinSquad(minor(), { memberCount: 2, inviteCreatedAt: NOW }, NOW);
    expect(d).toEqual({ allowed: false, reason: "needs_parent_consent" });
    expect(featureAccess(minor(false), "squads").allowed).toBe(false);
  });

  it("the device API refuses the join with 403 PARENT_CONSENT_REQUIRED", () => {
    expect(() =>
      mock.joinSquad("sqd_ABC123", { invite_code: "SQ-4K2M", display_name: "Rahul" }, minor(), NOW),
    ).toThrow(expect.objectContaining({ status: 403, code: "PARENT_CONSENT_REQUIRED" }));
    expect(() =>
      mock.createSquad({ name: "Lal Chowk 3", display_name: "Rahul" }, minor(), NOW),
    ).toThrow(expect.objectContaining({ code: "PARENT_CONSENT_REQUIRED" }));
  });

  it("with the parent's yes the same minor can join, like an adult", () => {
    const joined = mock.joinSquad(
      "sqd_ABC123",
      { invite_code: "SQ-4K2M", display_name: "Rahul" },
      minor(true),
      NOW,
    );
    expect(joined.members.some((m) => m.is_me)).toBe(true);
    expect(canJoinSquad(adult, { memberCount: 2, inviteCreatedAt: NOW }, NOW).allowed).toBe(true);
  });

  it("members see names, ranks and goal yes/no only: no scores (no leaderboard)", () => {
    const s = mock.joinSquad(
      "sqd_XYZ789",
      { invite_code: "SQ-AB12", display_name: "Kabir" },
      adult,
      NOW,
    );
    for (const m of s.members) {
      expect(Object.keys(m).sort()).toEqual(
        ["display_name", "is_me", "rank", "role", "weekly_goal_hit"].sort(),
      );
    }
  });

  it("full squads and expired invites are refused (409)", () => {
    expect(canJoinSquad(adult, { memberCount: 5, inviteCreatedAt: NOW }, NOW)).toEqual({
      allowed: false,
      reason: "squad_full",
    });
    expect(
      canJoinSquad(adult, { memberCount: 2, inviteCreatedAt: NOW - 8 * 86_400_000 }, NOW),
    ).toEqual({
      allowed: false,
      reason: "invite_expired",
    });
  });
});

describe("invite links and squad names", () => {
  it("round-trips the squad ID and the invite code", () => {
    expect(parseInvite(inviteToken("sqd_01JB8ZV", "SQ-4K2M"))).toEqual({
      squadId: "sqd_01JB8ZV",
      code: "SQ-4K2M",
    });
    expect(parseInvite("not-a-token")).toBeNull();
    expect(parseInvite("sqd_01JB8ZV.<script>")).toBeNull();
  });

  it("keeps personal data out of names", () => {
    expect(nameProblem("Call 9876543210")).toBe("pii");
    expect(nameProblem("me@example.com")).toBe("pii");
    expect(nameProblem("Gandhi Nagar 4")).toBeNull();
    expect(nameProblem("a")).toBe("short");
  });
});
