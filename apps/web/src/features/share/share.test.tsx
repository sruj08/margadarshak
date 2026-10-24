// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearnerProfileInfo } from "@/features/games/api";
import { IntlWrap } from "@/features/games/test-utils";
import { ParentConsentGate } from "./ParentConsentGate";
import {
  initials,
  percentileForCard,
  previewContent,
  profileFor,
  shareDecision,
  shareDisplayName,
} from "./share-rules";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const minor = (extras: ("squads" | "share_cards" | "pair_mode")[]): LearnerProfileInfo => ({
  account: "signed_in",
  members: [
    {
      member_id: "fam_ABC123",
      label: "Rahul",
      is_minor: true,
      parental_consent: { status: "granted" },
      parental_extras: extras,
    },
  ],
});

describe("share card rules (GAMIFICATION_ENGINE §10, §13; D-13 revised)", () => {
  it("refuses a card for a minor's profile without the parent's share_cards consent", () => {
    const d = shareDecision(profileFor(minor(["squads"]), "fam_ABC123"));
    expect(d).toEqual({ allowed: false, reason: "needs_parent_consent" });
  });

  it("allows it once the parent adds the share_cards extra, and always for the adult account", () => {
    expect(shareDecision(profileFor(minor(["share_cards"]), "fam_ABC123")).allowed).toBe(true);
    expect(shareDecision(profileFor(minor([]), null)).allowed).toBe(true);
  });

  it("revoked base consent means no card even with the extra recorded", () => {
    const info = minor(["share_cards"]);
    const m = info.members[0];
    if (m) m.parental_consent.status = "revoked";
    expect(shareDecision(profileFor(info, "fam_ABC123")).allowed).toBe(false);
  });

  it("anonymous device sessions need an account", () => {
    expect(shareDecision(profileFor({ account: "anonymous", members: [] }))).toEqual({
      allowed: false,
      reason: "needs_account",
    });
  });

  it("no percentile below a 200-mock baseline; initials and allowlisted fields only", () => {
    expect(percentileForCard(72, 199)).toBeNull();
    expect(percentileForCard(72, 200)).toBe(72);
    expect(initials("Kabir  Sharma")).toBe("KS");
    const c = previewContent({
      displayName: "Kabir Sharma",
      nameMode: "initials",
      nazarScore: 61,
      countedSessions: 3,
      badge: null,
      keralaLine: true,
    });
    expect(c.display_name).toBe("KS");
    expect(c.percentile).toBeNull();
    expect(Object.keys(c).sort()).toEqual(
      [
        "calibration",
        "counted_sessions",
        "display_name",
        "kerala_line",
        "nazar_score",
        "percentile",
        "rank",
      ].sort(),
    );
  });

  it("display_name mode keeps at most 20 characters, as the server does", () => {
    expect(shareDisplayName("  Kabirsinghrathoremehra  ")).toBe("Kabirsinghrathoremeh");
    expect(shareDisplayName("Kabir")).toBe("Kabir");
    const c = previewContent({
      displayName: "Kabir Singh Rathore Mehra",
      nameMode: "display_name",
      nazarScore: 61,
      countedSessions: 3,
      badge: null,
      keralaLine: false,
    });
    expect(c.display_name.length).toBeLessThanOrEqual(20);
    expect(c.display_name).toBe("Kabir Singh Rathore");
  });

  it("the consent gate is calm and points to the parent's settings", () => {
    render(
      <IntlWrap>
        <ParentConsentGate name="Rahul" />
      </IntlWrap>,
    );
    expect(screen.getByTestId("parent-consent-gate").textContent).toContain(
      "Share cards for Rahul need the parent's consent first.",
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("/privacy");
  });
});
