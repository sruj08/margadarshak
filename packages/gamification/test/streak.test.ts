// Weekly repairable streaks (§7): goal, silent freeze tokens, repair, silent
// break, gap weeks, idempotence and archive on DL test day.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StreakState } from "../src/streak.ts";
import {
  archiveStreak,
  countStreakSessions,
  initialStreak,
  setStreakGoal,
  streakTransition,
  streakView,
} from "../src/streak.ts";
import { ist } from "./helpers.ts";

const close = (s: StreakState, weekKey: string, sessions: number) =>
  streakTransition(s, { weekKey, sessions });

/** Closes consecutive weeks from 2026-W40 with the given session counts. */
function run(sessions: number[], start = initialStreak()): StreakState {
  let s = start;
  sessions.forEach((n, i) => {
    s = close(s, `2026-W${String(40 + i).padStart(2, "0")}`, n).state;
  });
  return s;
}

describe("goal and sessions", () => {
  it("default goal 4, clamped to 2–6", () => {
    assert.equal(initialStreak().goal, 4);
    assert.equal(initialStreak(1).goal, 2);
    assert.equal(initialStreak(9).goal, 6);
    assert.equal(setStreakGoal(initialStreak(), 3).goal, 3);
  });
  it("a session = a verified scored game session, or a sitting of ≥ 10 due reviews", () => {
    assert.equal(
      countStreakSessions({ verifiedScoredSessions: 2, dueReviewsPerSitting: [10, 9, 12] }),
      4,
    );
    assert.equal(countStreakSessions({ verifiedScoredSessions: 0 }), 0);
  });
});

describe("state machine", () => {
  it("goal met → weeks + 1, tokens + 1 (max 2 banked)", () => {
    const t = close(initialStreak(), "2026-W40", 4);
    assert.deepEqual(t.events, ["goal_met"]);
    assert.equal(t.state.weeks, 1);
    assert.equal(t.state.tokens, 1);
    assert.equal(t.notify, false);
    const s = run([4, 5, 6, 4]);
    assert.equal(s.weeks, 4);
    assert.equal(s.tokens, 2);
  });
  it("goal missed with a token → token spent silently, weeks kept", () => {
    const s = run([4, 4]);
    const t = close(s, "2026-W42", 1);
    assert.deepEqual(t.events, ["token_applied"]);
    assert.equal(t.state.status, "active");
    assert.equal(t.state.weeks, 2);
    assert.equal(t.state.tokens, 1);
    assert.equal(t.notify, false);
  });
  it("goal missed, no token → repairable (pothole), weeks kept", () => {
    const t = close(initialStreak(), "2026-W40", 3);
    assert.deepEqual(t.events, ["became_repairable"]);
    assert.equal(t.state.status, "repairable");
    assert.equal(t.state.weeks, 0);
    const s = run([4, 0, 0]); // token covers W41, W42 becomes repairable
    assert.equal(s.status, "repairable");
    assert.equal(s.weeks, 1);
    assert.equal(s.tokens, 0);
  });
  it("repair: goal + 2 sessions the next week → active, weeks + 1", () => {
    const s = run([4, 0, 0]);
    const t = close(s, "2026-W43", 6);
    assert.deepEqual(t.events, ["repaired"]);
    assert.equal(t.state.status, "active");
    assert.equal(t.state.weeks, 2);
    assert.equal(t.state.tokens, 1);
  });
  it("repair missed (goal + 1) → silent reset to 0", () => {
    const s = run([4, 0, 0]);
    const t = close(s, "2026-W43", 5);
    assert.deepEqual(t.events, ["reset"]);
    assert.equal(t.state.status, "active");
    assert.equal(t.state.weeks, 0);
    assert.equal(t.notify, false);
  });
  it("weeks with no activity are closed with 0 sessions, in order", () => {
    const s = run([4, 4]); // tokens 2 after W41
    const t = close(s, "2026-W45", 4); // W42, W43 use tokens; W44 → repairable; W45 = 4 < 6 → reset
    assert.deepEqual(t.events, ["token_applied", "token_applied", "became_repairable", "reset"]);
    assert.equal(t.state.weeks, 0);
    assert.equal(t.state.lastClosedWeek, "2026-W45");
  });
  it("gap filling works across the ISO year boundary", () => {
    const s = close(initialStreak(), "2026-W52", 4).state;
    const t = close(s, "2027-W01", 4); // W53 missed: token applied
    assert.deepEqual(t.events, ["token_applied", "goal_met"]);
    assert.equal(t.state.weeks, 2);
  });
  it("idempotent: closing the same or an earlier week changes nothing", () => {
    const s = run([4, 4]);
    assert.deepEqual(close(s, "2026-W41", 9), { state: s, events: [], notify: false });
    assert.deepEqual(close(s, "2026-W30", 9).state, s);
  });
  it("rejects malformed week keys", () => {
    assert.throws(() => close(initialStreak(), "2026-43", 4), RangeError);
  });
});

describe("archive on DL test day", () => {
  it("archives as 'Prep streak: N weeks'; the cut-short week counts only if its goal was met", () => {
    const s = run([4, 4, 4]);
    const met = streakTransition(s, {
      weekKey: "2026-W43",
      sessions: 4,
      testPassedAt: ist(2026, 10, 21, 11),
    });
    assert.equal(met.state.status, "archived");
    assert.equal(met.state.weeks, 4);
    assert.equal(met.state.archivedOn, "2026-10-21");
    assert.deepEqual(met.events, ["archived"]);
    const short = streakTransition(s, {
      weekKey: "2026-W43",
      sessions: 1,
      testPassedAt: ist(2026, 10, 20, 9),
    });
    assert.equal(short.state.weeks, 3);
  });
  it("archived streaks never change again (no lifetime streak)", () => {
    const a = archiveStreak(run([4, 4]), ist(2026, 10, 15, 12));
    assert.equal(a.status, "archived");
    assert.equal(a.weeks, 2);
    assert.deepEqual(close(a, "2026-W44", 6), { state: a, events: [], notify: false });
    assert.equal(archiveStreak(a, ist(2027, 1, 1)), a);
  });
});

describe("streakView", () => {
  it("'New week: 0/4' after a break; pothole with goal + 2 dots while repairable", () => {
    const now = ist(2026, 10, 24, 12);
    assert.deepEqual(streakView(initialStreak(), 0, now), {
      weekKey: "2026-W43",
      dots: 4,
      filled: 0,
      pothole: false,
      weeks: 0,
      archived: false,
    });
    const rep = streakView(run([0]), 2, now);
    assert.equal(rep.dots, 6);
    assert.equal(rep.filled, 2);
    assert.equal(rep.pothole, true);
  });
});
