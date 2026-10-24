// The three entry points load and expose the README's names (game-core
// README §8 and §9, minus ratingFromEvidence and staircase, which stay in game-core).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as gamification from "../src/gamification.ts";
import * as root from "../src/index.ts";
import * as learning from "../src/learning.ts";

describe("entry points", () => {
  it("./learning exposes the learning maths", () => {
    for (const name of [
      "createScheduler",
      "replayReviewLog",
      "topicMastery",
      "nodeState",
      "readiness",
      "brier",
      "overconfidence",
      "calibrationBins",
      "roadReadiness",
      "reviewQueue",
    ]) {
      assert.equal(typeof (learning as Record<string, unknown>)[name], "function", name);
    }
    assert.equal("ratingFromEvidence" in learning, false);
    assert.equal("staircase" in learning, false);
  });
  it("./gamification exposes the rules", () => {
    for (const name of [
      "xpForSession",
      "xpForReviews",
      "rankFor",
      "streakTransition",
      "evaluateBadges",
      "squadScore",
    ]) {
      assert.equal(typeof (gamification as Record<string, unknown>)[name], "function", name);
    }
    assert.ok(Array.isArray(gamification.patternLintSpec));
  });
  it("the root re-exports both subpaths plus time helpers, with no clashes", () => {
    const r = root as Record<string, unknown>;
    for (const k of [...Object.keys(learning), ...Object.keys(gamification)]) {
      assert.ok(k in r, k);
    }
    assert.equal(typeof root.istWeek, "function");
    const shared = Object.keys(learning).filter((k) => k in gamification);
    assert.deepEqual(shared, []);
  });
});
