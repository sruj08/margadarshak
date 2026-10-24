// Squads (§8), badges (§9), share cards (§10), family mode (§1, §13) and the
// dark-pattern lint spec (§12).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BadgeHistory, BadgeSession } from "../src/badges.ts";
import { BADGES, evaluateBadges } from "../src/badges.ts";
import { ageBand, featureAccess, ownAccountOffer } from "../src/family.ts";
import { patternLintSpec, patternRule } from "../src/patterns.ts";
import {
  canCreateShareCard,
  isAllowedShareHost,
  percentileVisible,
  shareCardLive,
  shareCardViolations,
} from "../src/share.ts";
import {
  canJoinSquad,
  canUsePairMode,
  inviteValid,
  memberView,
  sangathanRibbon,
  squadRibbon,
  squadScore,
  squadWeeklyGoal,
} from "../src/squads.ts";
import { DAY_MS } from "../src/time.ts";
import type { Profile } from "../src/types.ts";
import { answers, ist } from "./helpers.ts";

const adult: Profile = { kind: "adult" };
const anon: Profile = { kind: "anonymous" };
const minor: Profile = { kind: "family_minor" };
const minorConsented: Profile = {
  kind: "family_minor",
  parentConsents: { squads: true, pairMode: true, shareCards: true, notifications: true },
};

describe("squadScore (§8)", () => {
  it("2 contributors → null (no individual score can be inferred)", () => {
    assert.equal(
      squadScore([
        { nazarScore: 80, brier: 0.1 },
        { nazarScore: 70, brier: 0.2 },
      ]),
      null,
    );
  });
  it("mean of NazarScore × (1 − Brier) over ≥ 3 contributors", () => {
    // 80×0.9 = 72, 70×0.8 = 56, 60×0.75 = 45 → 173/3 = 57.67 → 58
    assert.equal(
      squadScore([
        { nazarScore: 80, brier: 0.1 },
        { nazarScore: 70, brier: 0.2 },
        { nazarScore: 60, brier: 0.25 },
      ]),
      58,
    );
  });
  it("members without a Nazar Score or a Brier don't contribute", () => {
    const members = [
      { nazarScore: 80, brier: 0.1 },
      { nazarScore: 70, brier: 0.2 },
      { nazarScore: null, brier: 0.1 },
      { nazarScore: 90, brier: null },
    ];
    assert.equal(squadScore(members), null);
  });
});

describe("squad rules (§8, §13)", () => {
  const now = ist(2026, 10, 24, 12);
  const squad = { memberCount: 3, inviteCreatedAt: now - DAY_MS };
  it("adults join; anonymous never; a minor only after the parent consents", () => {
    assert.deepEqual(canJoinSquad(adult, squad, now), { allowed: true });
    assert.deepEqual(canJoinSquad(anon, squad, now), { allowed: false, reason: "needs_account" });
    assert.deepEqual(canJoinSquad(minor, squad, now), {
      allowed: false,
      reason: "needs_parent_consent",
    });
    assert.deepEqual(canJoinSquad(minorConsented, squad, now), { allowed: true });
    assert.equal(canUsePairMode(minor), false);
    assert.equal(canUsePairMode(minorConsented), true);
  });
  it("max 5 members; invite links expire after 7 days", () => {
    assert.deepEqual(canJoinSquad(adult, { ...squad, memberCount: 5 }, now), {
      allowed: false,
      reason: "squad_full",
    });
    const created = ist(2026, 10, 1, 9);
    assert.equal(inviteValid(created, created + 7 * DAY_MS - 1), true);
    assert.equal(inviteValid(created, created + 7 * DAY_MS), false);
    assert.deepEqual(canJoinSquad(adult, { memberCount: 3, inviteCreatedAt: created }, now), {
      allowed: false,
      reason: "invite_expired",
    });
  });
  it("weekly goal 3 × members; everyone gets the ribbon or nobody does", () => {
    assert.equal(squadWeeklyGoal(5), 15);
    assert.equal(squadRibbon([6, 5, 4, 0, 0]), true);
    assert.equal(squadRibbon([6, 5, 3, 0, 0]), false);
    assert.equal(sangathanRibbon([true, false, true, true]), true);
    assert.equal(sangathanRibbon([true, true]), false);
  });
  it("members see name, rank and goal yes/no only", () => {
    const leaky = {
      displayName: "Asha",
      rank: "R2" as const,
      weeklyGoalHit: true,
      nazarScore: 41,
      brier: 0.3,
    };
    assert.deepEqual(memberView(leaky), { displayName: "Asha", rank: "R2", weeklyGoalHit: true });
  });
});

describe("badges (§9)", () => {
  const sess = (
    gameId: string,
    pct: number,
    day: number,
    extra: Partial<BadgeSession> = {},
  ): BadgeSession => ({
    gameId,
    mode: "practice",
    score: { pct, capApplied: null },
    findings: [],
    integrity: { trust: 1, flags: [] },
    completedAt: ist(2026, 10, day, 10),
    ...extra,
  });
  const byId = (h: BadgeHistory) => Object.fromEntries(evaluateBadges(h).map((b) => [b.id, b]));

  it("nine badges with road-sign shapes", () => {
    assert.equal(BADGES.length, 9);
    assert.deepEqual(
      BADGES.map((b) => b.shape),
      [
        "rectangle",
        "rectangle",
        "circle",
        "circle",
        "triangle",
        "circle",
        "triangle",
        "triangle",
        "octagon",
      ],
    );
    assert.equal(evaluateBadges({ hasAccount: true }).length, 9);
  });
  it("nothing earned from an empty history", () => {
    assert.ok(evaluateBadges({ hasAccount: true }).every((b) => !b.earned));
  });
  it("B1/B2 self-declared: need an account, carry the 'your word' flag", () => {
    const decl = { khudLicence: { dlIssueDate: "2026-10-01" }, firstAttemptPass: true };
    const b = byId({ hasAccount: true, declarations: decl });
    assert.equal(b["B1"]?.earned, true);
    assert.equal(b["B1"]?.yourWord, true);
    assert.equal(b["B1"]?.label, "your_word");
    assert.equal(b["B2"]?.earned, true);
    assert.equal(b["B3"]?.yourWord, false);
    const anonB = byId({ hasAccount: false, declarations: decl });
    assert.equal(anonB["B1"]?.earned, false);
    assert.equal(anonB["B1"]?.available, false);
    // Revoked declaration: silently gone.
    assert.equal(
      byId({ hasAccount: true, declarations: { khudLicence: null } })["B1"]?.earned,
      false,
    );
  });
  it("B3 Nazar 90: score ≥ 90 over ≥ 3 eligible mocks, with the count", () => {
    assert.equal(
      byId({ hasAccount: true, nazar: { score: 90, eligibleMocks: 3 } })["B3"]?.earned,
      true,
    );
    assert.equal(
      byId({ hasAccount: true, nazar: { score: 95, eligibleMocks: 2 } })["B3"]?.earned,
      false,
    );
    assert.equal(
      byId({ hasAccount: true, nazar: { score: 89.9, eligibleMocks: 9 } })["B3"]?.earned,
      false,
    );
    assert.equal(
      byId({ hasAccount: true, nazar: { score: 92, eligibleMocks: 4 } })["B3"]?.count,
      4,
    );
  });
  it("B4 Calibrated per §6", () => {
    const good = [...answers(20, "100", 19), ...answers(20, "75", 15)];
    assert.equal(byId({ hasAccount: true, answers: good })["B4"]?.earned, true);
  });
  it("B5 No-Zone Navigator: Blind Spot ≥ 85 twice, ≥ 2 IST days apart, trust ≥ 0.6", () => {
    assert.equal(
      byId({
        hasAccount: true,
        sessions: [sess("blind_spot", 85, 10), sess("blind_spot", 90, 12)],
      })["B5"]?.earned,
      true,
    );
    assert.equal(
      byId({
        hasAccount: true,
        sessions: [sess("blind_spot", 85, 10), sess("blind_spot", 90, 11)],
      })["B5"]?.earned,
      false,
    );
    assert.equal(
      byId({
        hasAccount: true,
        sessions: [sess("blind_spot", 84, 10), sess("blind_spot", 90, 12)],
      })["B5"]?.earned,
      false,
    );
    const lowTrust = sess("blind_spot", 95, 12, {
      integrity: { trust: 0.5, flags: ["INT_CLOCK_DRIFT"] },
    });
    assert.equal(
      byId({ hasAccount: true, sessions: [sess("blind_spot", 85, 10), lowTrust] })["B5"]?.earned,
      false,
    );
  });
  it("B6 Strap Streak: 7 self-checks on distinct days within 14 days", () => {
    const days = (ds: number[]) => ds.map((d) => ist(2026, 10, d, 8));
    assert.equal(
      byId({ hasAccount: true, helmetSelfChecks: days([1, 3, 5, 7, 9, 11, 14]) })["B6"]?.earned,
      true,
    );
    assert.equal(
      byId({ hasAccount: true, helmetSelfChecks: days([1, 3, 5, 7, 9, 11, 15]) })["B6"]?.earned,
      false,
    );
    assert.equal(
      byId({ hasAccount: true, helmetSelfChecks: Array(7).fill(ist(2026, 10, 1, 8)) })["B6"]
        ?.earned,
      false,
    );
    assert.equal(byId({ hasAccount: true })["B6"]?.label, "self_checked");
  });
  it("B7 Night Ready via SK-M8 (kept once faded) or night Nazar types; B8 via SK-M14", () => {
    assert.equal(
      byId({ hasAccount: true, nodeStates: { "SK-M8": "mastered" } })["B7"]?.earned,
      true,
    );
    assert.equal(byId({ hasAccount: true, nodeStates: { "SK-M8": "fading" } })["B7"]?.earned, true);
    assert.equal(
      byId({ hasAccount: true, nodeStates: { "SK-M8": "learning" } })["B7"]?.earned,
      false,
    );
    assert.equal(byId({ hasAccount: true, nightNazarTypesMastered: true })["B7"]?.earned, true);
    assert.equal(
      byId({ hasAccount: true, nodeStates: { "SK-M14": "mastered" } })["B8"]?.earned,
      true,
    );
  });
  it("B9 Golden Hour Ready: unavailable before medical sign-off; ≥ 80 with no critical error", () => {
    const ok = sess("golden_hour", 85, 10);
    const crit = sess("golden_hour", 85, 10, {
      findings: [{ findingId: "GH_SKIPPED_CALL", critical: true }],
    });
    const noSign = byId({ hasAccount: true, sessions: [ok] })["B9"];
    assert.equal(noSign?.available, false);
    assert.equal(noSign?.earned, false);
    assert.equal(
      byId({ hasAccount: true, sessions: [ok], goldenHourMedicalSignOff: true })["B9"]?.earned,
      true,
    );
    assert.equal(
      byId({ hasAccount: true, sessions: [crit], goldenHourMedicalSignOff: true })["B9"]?.earned,
      false,
    );
  });
  it("criteria are data, shown before starting (DP-07)", () => {
    assert.deepEqual(BADGES.find((b) => b.id === "B3")?.criterion, {
      minNazarScore: 90,
      minEligibleMocks: 3,
    });
  });
});

describe("share cards (§10)", () => {
  const ctx = {
    earnedBadges: ["B3" as const],
    baselineVerifiedMocks: 150,
    linkHost: "margdarshak.app",
  };
  const card = { displayName: "AK", nazarScore: 78, countedSessions: 4, rank: "R2", badge: "B3" };
  it("a minimal card is clean", () => {
    assert.deepEqual(shareCardViolations(card, ctx), []);
  });
  it("PII, RTO, dates, LL/DL status and failures can't appear", () => {
    const v = shareCardViolations(
      { ...card, rto: "JK02", dob: "2008-01-01", llStatus: "passed", failures: 2 },
      ctx,
    );
    assert.deepEqual(
      v.map((x) => (x.code === "field_not_allowed" ? x.field : x.code)),
      ["dob", "failures", "llStatus", "rto"],
    );
  });
  it("unearned badge, early percentile, calibration without B4, banned domain, APK link", () => {
    const v = shareCardViolations(
      { ...card, badge: "B1", percentile: 70, calibration: { brier: 0.1 } },
      { ...ctx, linkHost: "parivahan-practice.in", urls: ["https://x.example/app.APK?ref=1"] },
    );
    assert.deepEqual(
      v.map((x) => x.code),
      [
        "badge_not_earned",
        "percentile_baseline_too_small",
        "calibration_without_calibrated_badge",
        "domain_not_allowed",
        "apk_link",
      ],
    );
  });
  it("hosts never contain parivahan, sarathi or gov; percentile from 200 verified mocks", () => {
    assert.equal(isAllowedShareHost("margdarshak.app"), true);
    assert.equal(isAllowedShareHost("sarathi-help.in"), false);
    assert.equal(isAllowedShareHost("margdarshak.gov.in"), false);
    assert.equal(percentileVisible(199), false);
    assert.equal(percentileVisible(200), true);
  });
  it("who may share; links expire after 90 days or on delete", () => {
    assert.deepEqual(canCreateShareCard(adult), { allowed: true });
    assert.deepEqual(canCreateShareCard(anon), { allowed: false, reason: "needs_account" });
    assert.deepEqual(canCreateShareCard(minor), { allowed: false, reason: "needs_parent_consent" });
    assert.deepEqual(canCreateShareCard(minorConsented), { allowed: true });
    const t = ist(2026, 10, 1);
    assert.equal(shareCardLive(t, t + 90 * DAY_MS - 1), true);
    assert.equal(shareCardLive(t, t + 90 * DAY_MS), false);
    assert.equal(shareCardLive(t, t + DAY_MS, true), false);
  });
});

describe("family mode (§1, §13)", () => {
  it("minors get every learning feature; social ones wait for the parent", () => {
    for (const f of [
      "fsrs",
      "readiness",
      "xp",
      "ranks",
      "streak",
      "badges",
      "practice_record",
    ] as const) {
      assert.deepEqual(featureAccess(minor, f), { allowed: true, scope: "server" }, f);
    }
    for (const f of ["squads", "pair_mode", "share_card", "notifications"] as const) {
      assert.deepEqual(
        featureAccess(minor, f),
        { allowed: false, reason: "needs_parent_consent" },
        f,
      );
      assert.equal(featureAccess(minorConsented, f).allowed, true, f);
    }
  });
  it("never: profiling, targeted ads or marketing on a minor's data, even with consents", () => {
    for (const f of ["marketing", "behavioural_profiling", "targeted_ads"] as const) {
      assert.deepEqual(featureAccess(minorConsented, f), {
        allowed: false,
        reason: "never_for_minors",
      });
    }
  });
  it("anonymous sessions: learning on the device only; social and records need an account", () => {
    assert.deepEqual(featureAccess(anon, "xp"), { allowed: true, scope: "device" });
    assert.deepEqual(featureAccess(anon, "self_declared_badges"), {
      allowed: false,
      reason: "needs_account",
    });
    assert.deepEqual(featureAccess(anon, "practice_record"), {
      allowed: false,
      reason: "needs_account",
    });
    assert.deepEqual(featureAccess(anon, "squads"), { allowed: false, reason: "needs_account" });
  });
  it("age band from DOB on the IST calendar", () => {
    const dob = "2008-10-25";
    assert.equal(ageBand({ dob }, ist(2026, 10, 24, 23, 59)), "u18");
    assert.equal(ageBand({ dob }, ist(2026, 10, 25, 0, 0)), "adult");
    assert.equal(ageBand({}, ist(2026, 10, 25)), "u18");
  });
  it("EC-01: year of birth only keeps u18 while within a year of 18, until a DOB document is confirmed", () => {
    const now = ist(2026, 6, 1);
    assert.equal(ageBand({ birthYear: 2008 }, now), "u18"); // 18 by year
    assert.equal(ageBand({ birthYear: 2007 }, now), "u18"); // 19 by year
    assert.equal(ageBand({ birthYear: 2007, dobDocumentConfirmed: true }, now), "adult");
    assert.equal(ageBand({ birthYear: 2006 }, now), "adult"); // 20
    assert.equal(ageBand({ birthYear: 2010 }, now), "u18");
  });
  it("turning 18: offered an own account, never auto-enrolled", () => {
    assert.equal(ownAccountOffer(minor, "adult"), "offer");
    assert.equal(ownAccountOffer(minor, "u18"), "none");
    assert.equal(ownAccountOffer(adult, "adult"), "none");
  });
});

describe("patternLintSpec (§12)", () => {
  it("DP-01..DP-18: 13 CCPA patterns + 5 of ours, unique IDs", () => {
    assert.equal(patternLintSpec.length, 18);
    assert.deepEqual(
      patternLintSpec.map((r) => r.id),
      Array.from({ length: 18 }, (_, i) => `DP-${String(i + 1).padStart(2, "0")}`),
    );
    assert.equal(patternLintSpec.filter((r) => r.origin === "ccpa_2023").length, 13);
  });
  it("Phase 1–2 automated set is DP-01, 03, 04, 06, 08, 10, 13, 18", () => {
    assert.deepEqual(
      patternLintSpec.filter((r) => r.automatedPhase12).map((r) => r.id),
      ["DP-01", "DP-03", "DP-04", "DP-06", "DP-08", "DP-10", "DP-13", "DP-18"],
    );
  });
  it("every rule has a description, detection targets, enforcement and an example", () => {
    for (const r of patternLintSpec) {
      assert.ok(r.rule.length > 0 && r.detect.length > 0 && r.enforcement.length > 0, r.id);
      assert.ok(r.example.violation.length > 0 && r.example.compliant.length > 0, r.id);
    }
    assert.ok(patternRule("DP-01")?.copy?.banned?.["hi"]?.includes("जल्दी करें"));
    assert.equal(patternRule("DP-99"), undefined);
  });
  it("examples carry no rupee literals (D-06)", () => {
    const text = JSON.stringify(patternLintSpec);
    assert.equal(/₹\s?\d|\bRs\.?\s?\d|\bINR\s?\d/.test(text), false);
  });
});
