// XP (GAMIFICATION_ENGINE §2): golden examples, diminishing-returns boundaries,
// pro-rata straddling, trust factor, and the "never earns XP" list.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  crossedSpacingLine,
  diminish,
  multiplierAt,
  NO_XP_ACTIONS,
  xpForAction,
  xpForReviews,
  xpForSession,
} from "../src/xp.ts";
import { session } from "./helpers.ts";

describe("§2.4 golden examples", () => {
  it("Nazar mock at 58%, first session of the day, trust 1.0 → 23 XP", () => {
    const a = xpForSession(session("mock", 58, 1), 0);
    assert.equal(a.xp, 23);
    assert.deepEqual(
      { base: a.base, quality: a.quality, diminish: a.diminish, trustFactor: a.trustFactor },
      { base: 40, quality: 0.58, diminish: 1, trustFactor: 1 },
    );
  });
  it("LL practice at 20% → 6 XP (quality floor 0.3)", () => {
    const a = xpForSession(session("practice", 20, 1, { gameId: "ll_sim" }), 0);
    assert.equal(a.quality, 0.3);
    assert.equal(a.xp, 6);
  });
  it("12 due reviews after 60 minutes of play → 30 XP", () => {
    assert.equal(xpForReviews(12, 60).xp, 30);
  });
});

describe("§2.1 bases, quality and trust", () => {
  it("bases: mock 40, practice 20, pair 20, learn 15", () => {
    assert.equal(xpForSession(session("mock", 100), 0).xp, 40);
    assert.equal(xpForSession(session("practice", 100), 0).xp, 20);
    assert.equal(xpForSession(session("pair", 100), 0).xp, 20);
    assert.equal(xpForSession(session("learn", 100, 1, { gameId: "golden_hour" }), 0).xp, 15);
  });
  it("failing still earns (0% → floor 0.3)", () => {
    assert.equal(xpForSession(session("mock", 0), 0).xp, 12);
  });
  it("pct outside 0–100 is clamped", () => {
    assert.equal(xpForSession(session("practice", 150), 0).xp, 20);
    assert.equal(xpForSession(session("practice", -5), 0).xp, 6);
  });
  it("trust ≥ 0.6 → ×1.0; below → ×0.5", () => {
    assert.equal(xpForSession(session("mock", 100, 0.6), 0).xp, 40);
    assert.equal(xpForSession(session("mock", 100, 0.59), 0).xp, 20);
    assert.equal(xpForSession(session("mock", 100, Number.NaN), 0).trustFactor, 0.5);
  });
  it("a mock replaying seen clips (INT_SEEN_CLIP) earns 0", () => {
    const a = xpForSession(session("mock", 90, 1, { flags: ["INT_SEEN_CLIP"] }), 0);
    assert.equal(a.xp, 0);
    assert.equal(a.zeroReason, "seen_clip_replay");
    // The flag doesn't zero a practice session (practice may reuse clips).
    assert.equal(xpForSession(session("practice", 100, 1, { flags: ["INT_SEEN_CLIP"] }), 0).xp, 20);
  });
  it("XP is a pure function: same input, same output (DP-14)", () => {
    const s = session("practice", 73, 0.8);
    assert.deepEqual(xpForSession(s, 50, 12), xpForSession(s, 50, 12));
  });
});

describe("§2.2 diminishing returns", () => {
  it("point multipliers at the boundaries: exactly 45 → ×0.5, exactly 90 → ×0.2", () => {
    assert.equal(multiplierAt(0), 1);
    assert.equal(multiplierAt(44.999), 1);
    assert.equal(multiplierAt(45), 0.5);
    assert.equal(multiplierAt(89.999), 0.5);
    assert.equal(multiplierAt(90), 0.2);
    assert.equal(multiplierAt(300), 0.2);
    assert.equal(multiplierAt(-10), 1);
  });
  it("a session ending exactly at 45 is all full rate", () => {
    assert.equal(diminish(30, 15), 1);
    assert.equal(xpForSession(session("practice", 100), 30, 15).xp, 20);
  });
  it("a session starting exactly at 45 is all half rate", () => {
    assert.equal(diminish(45, 20), 0.5);
  });
  it("straddling 45 splits pro rata: 30→60 is 15 min ×1 + 15 min ×0.5 = ×0.75", () => {
    assert.equal(diminish(30, 30), 0.75);
    assert.equal(xpForSession(session("mock", 100), 30, 30).xp, 30);
  });
  it("straddling 45 and 90: 40→100 = (5×1 + 45×0.5 + 10×0.2)/60", () => {
    assert.ok(Math.abs(diminish(40, 60) - 29.5 / 60) < 1e-9);
    // 40 × 1.0 × 0.491666… = 19.67 → 20
    assert.equal(xpForSession(session("mock", 100), 40, 60).xp, 20);
  });
  it("straddling 90: 80→100 = (10×0.5 + 10×0.2)/20 = ×0.35", () => {
    assert.equal(diminish(80, 20), 0.35);
  });
  it("reviews split pro rata too", () => {
    // 10 due cards = 50 base; 40→50 min = (5×1 + 5×0.5)/10 = 0.75 → 37.5 → 38
    assert.equal(xpForReviews(10, 40, 10).xp, 38);
    assert.equal(xpForReviews(10, 95).xp, 10);
  });
  it("calm spacing line shows once on crossing 45 minutes", () => {
    assert.equal(crossedSpacingLine(30, 44), false);
    assert.equal(crossedSpacingLine(30, 45), true);
    assert.equal(crossedSpacingLine(45, 60), false);
  });
});

describe("§2.3 what never earns XP", () => {
  it("every listed action is 0", () => {
    for (const a of NO_XP_ACTIONS) assert.equal(xpForAction(a), 0, a);
    assert.ok(NO_XP_ACTIONS.includes("share"));
    assert.ok(NO_XP_ACTIONS.includes("invite"));
    assert.ok(NO_XP_ACTIONS.includes("app_open"));
    assert.ok(NO_XP_ACTIONS.includes("morth_tutorial"));
  });
  it("non-due reviews (cramming) earn 0: only the due count is paid", () => {
    assert.equal(xpForReviews(0, 0).xp, 0);
    assert.equal(xpForReviews(-3, 0).xp, 0);
    assert.equal(xpForReviews(2.9, 0).xp, 10);
  });
});
