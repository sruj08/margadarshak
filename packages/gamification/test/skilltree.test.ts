// Skill tree node states (hysteresis) and ranks (XP and mastery, never demote).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankFor } from "../src/ranks.ts";
import type { NodeStates } from "../src/skilltree.ts";
import { canStartNode, nodeState, SKILL_NODES } from "../src/skilltree.ts";

const obs = (mastery: number, gameCriterionMet = true) => ({ mastery, gameCriterionMet });

describe("skill nodes", () => {
  it("one node per curriculum module: LL0–LL4, M1–M22, DL1", () => {
    assert.equal(SKILL_NODES.length, 5 + 22 + 1);
    assert.ok(SKILL_NODES.includes("SK-M19"));
    assert.ok(SKILL_NODES.includes("SK-DL1"));
    assert.equal(new Set(SKILL_NODES).size, SKILL_NODES.length);
  });
  it("SK-DL1 needs SK-M1 and SK-LL1 at learning; others start freely", () => {
    assert.equal(canStartNode("SK-DL1", {}), false);
    assert.equal(canStartNode("SK-DL1", { "SK-M1": "learning" }), false);
    assert.equal(canStartNode("SK-DL1", { "SK-M1": "fading", "SK-LL1": "mastered" }), true);
    assert.equal(canStartNode("SK-M16", {}), true);
  });
});

describe("nodeState hysteresis (in at 0.8, out below 0.7)", () => {
  it("locked without evidence", () => {
    assert.equal(nodeState([]), "locked");
    assert.equal(nodeState([{ mastery: 0, hasEvidence: false }]), "locked");
  });
  it("any evidence → learning", () => {
    assert.equal(nodeState([obs(0)]), "learning");
    assert.equal(nodeState([obs(0.79)]), "learning");
  });
  it("mastered needs M ≥ 0.8 and the game criterion", () => {
    assert.equal(nodeState([obs(0.8)]), "mastered");
    assert.equal(nodeState([obs(0.95, false)]), "learning");
    // Criterion met earlier stays met.
    assert.equal(nodeState([obs(0.5, true), obs(0.85, false)]), "mastered");
  });
  it("mastered holds down to exactly 0.7; 0.69 → fading", () => {
    assert.equal(nodeState([obs(0.85), obs(0.75)]), "mastered");
    assert.equal(nodeState([obs(0.85), obs(0.7)]), "mastered");
    assert.equal(nodeState([obs(0.85), obs(0.6999)]), "fading");
  });
  it("fading needs the full 0.8 to come back; never drops to learning", () => {
    assert.equal(nodeState([obs(0.85), obs(0.6), obs(0.79)]), "fading");
    assert.equal(nodeState([obs(0.85), obs(0.6), obs(0.1)]), "fading");
    assert.equal(nodeState([obs(0.85), obs(0.6), obs(0.8)]), "mastered");
  });
  it("no flicker around 0.75", () => {
    const seq = [obs(0.82), obs(0.76), obs(0.74), obs(0.78), obs(0.72)];
    assert.equal(nodeState(seq), "mastered");
  });
});

describe("rankFor", () => {
  const mohalla: NodeStates = { "SK-LL1": "learning", "SK-M1": "learning" };
  const shehar: NodeStates = {
    ...mohalla,
    "SK-LL2": "learning",
    "SK-LL3": "learning",
    "SK-LL4": "learning",
    "SK-M3": "learning",
    "SK-M6": "learning",
  };
  const highway: NodeStates = {
    ...shehar,
    "SK-M1": "mastered",
    "SK-M4": "mastered",
    "SK-M5": "learning",
    "SK-M7": "fading",
  };
  const ghat: NodeStates = { ...highway, "SK-M14": "mastered", "SK-M8": "learning" };

  it("Gali at 0 XP", () => {
    assert.equal(rankFor(0, {}).rank, "R1");
    assert.equal(rankFor(0, {}).name, "Gali");
  });
  it("XP alone can't buy a rank", () => {
    const r = rankFor(1_000_000, {}, { verifiedNazarMocks: 50 });
    assert.equal(r.rank, "R1");
    assert.deepEqual(
      r.next?.nodesMissing.map((n) => n.node),
      ["SK-LL1", "SK-M1"],
    );
    assert.equal(r.next?.xpMissing, 0);
  });
  it("mastery alone can't either", () => {
    assert.equal(rankFor(299, mohalla).rank, "R1");
    assert.equal(rankFor(299, mohalla).next?.xpMissing, 1);
  });
  it("each rank at its threshold with its requirements", () => {
    assert.equal(rankFor(300, mohalla).name, "Mohalla");
    assert.equal(rankFor(900, shehar, { verifiedNazarMocks: 1 }).name, "Shehar");
    assert.equal(rankFor(2000, highway, { verifiedNazarMocks: 1 }).name, "Highway");
    assert.equal(rankFor(3500, ghat, { verifiedNazarMocks: 1 }).name, "Ghat");
    assert.equal(rankFor(3500, ghat, { verifiedNazarMocks: 1 }).next, null);
    assert.equal(rankFor(3500, ghat, { verifiedNazarMocks: 1 }).shape, "octagon");
  });
  it("Shehar needs ≥ 1 verified Nazar mock", () => {
    const r = rankFor(900, shehar, { verifiedNazarMocks: 0 });
    assert.equal(r.name, "Mohalla");
    assert.equal(r.next?.nazarMocksMissing, 1);
  });
  it("ranks are cumulative: Highway's own nodes without Shehar's stay below", () => {
    const r = rankFor(
      5000,
      {
        ...mohalla,
        "SK-M1": "mastered",
        "SK-M4": "mastered",
        "SK-M5": "learning",
        "SK-M7": "learning",
      },
      { verifiedNazarMocks: 3 },
    );
    assert.equal(r.name, "Mohalla");
  });
  it("a fading node doesn't open a new rank that needs it mastered", () => {
    const r = rankFor(2500, { ...highway, "SK-M4": "fading" }, { verifiedNazarMocks: 1 });
    assert.equal(r.name, "Shehar");
    assert.deepEqual(r.next?.nodesMissing, [{ node: "SK-M4", needs: "mastered" }]);
  });
  it("ranks never go down", () => {
    // Highway held; M1/M4 faded and XP data says less: rank stays.
    const r = rankFor(0, { "SK-M1": "fading", "SK-M4": "fading" }, { currentRank: "R4" });
    assert.equal(r.name, "Highway");
    assert.equal(rankFor(3500, ghat, { verifiedNazarMocks: 1, currentRank: "R2" }).name, "Ghat");
  });
});
