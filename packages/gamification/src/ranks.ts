// Ranks (GAMIFICATION_ENGINE §3.2): gated by XP **and** mastery, so XP alone
// can't buy a rank, and ranks never go down (demotion would be loss-aversion
// punishment). Thresholds are design values [D], tuned after the field study.

import type { NodeState, NodeStates, SkillNodeId } from "./skilltree.ts";
import { atLeastLearning } from "./skilltree.ts";

export type RankId = "R1" | "R2" | "R3" | "R4" | "R5";
export type RankShape = "rectangle" | "circle" | "triangle" | "octagon";

export interface RankRequirement {
  readonly node: SkillNodeId;
  readonly needs: "learning" | "mastered";
}

export interface RankDef {
  readonly id: RankId;
  readonly name: "Gali" | "Mohalla" | "Shehar" | "Highway" | "Ghat";
  readonly xp: number;
  readonly shape: RankShape;
  /** This rank's own node requirements; lower ranks' requirements also apply. */
  readonly nodes: readonly RankRequirement[];
  readonly verifiedNazarMocks: number;
  readonly source: "design";
}

const learning = (node: SkillNodeId): RankRequirement => ({ node, needs: "learning" });
const mastered = (node: SkillNodeId): RankRequirement => ({ node, needs: "mastered" });

export const RANKS: readonly RankDef[] = [
  {
    id: "R1",
    name: "Gali",
    xp: 0,
    shape: "rectangle",
    nodes: [],
    verifiedNazarMocks: 0,
    source: "design",
  },
  {
    id: "R2",
    name: "Mohalla",
    xp: 300,
    shape: "rectangle",
    nodes: [learning("SK-LL1"), learning("SK-M1")],
    verifiedNazarMocks: 0,
    source: "design",
  },
  {
    id: "R3",
    name: "Shehar",
    xp: 900,
    shape: "circle",
    nodes: [
      learning("SK-LL1"),
      learning("SK-LL2"),
      learning("SK-LL3"),
      learning("SK-LL4"),
      learning("SK-M1"),
      learning("SK-M3"),
      learning("SK-M6"),
    ],
    verifiedNazarMocks: 1,
    source: "design",
  },
  {
    id: "R4",
    name: "Highway",
    xp: 2000,
    shape: "triangle",
    nodes: [learning("SK-M5"), learning("SK-M7"), mastered("SK-M1"), mastered("SK-M4")],
    verifiedNazarMocks: 0,
    source: "design",
  },
  {
    id: "R5",
    name: "Ghat",
    xp: 3500,
    shape: "octagon",
    nodes: [mastered("SK-M14"), learning("SK-M8")],
    verifiedNazarMocks: 0,
    source: "design",
  },
];

function meets(req: RankRequirement, state: NodeState | undefined): boolean {
  // "mastered" means mastered now: a fading node keeps a rank already held but
  // doesn't open a new one (the learner refreshes first, which is the point).
  return req.needs === "mastered" ? state === "mastered" : atLeastLearning(state);
}

export interface RankGap {
  readonly rank: RankId;
  readonly xpRequired: number;
  readonly xpMissing: number;
  readonly nodesMissing: readonly RankRequirement[];
  readonly nazarMocksMissing: number;
}

export interface RankResult {
  readonly rank: RankId;
  readonly name: RankDef["name"];
  readonly shape: RankShape;
  /** What the next rank still needs (criteria shown up front: DP-07), or null at Ghat. */
  readonly next: RankGap | null;
}

export interface RankOptions {
  /** Count of verified Nazar mocks (needed for Shehar). */
  readonly verifiedNazarMocks?: number;
  /** The rank already held. The result is never below it. */
  readonly currentRank?: RankId | undefined;
}

function gapFor(index: number, xp: number, states: NodeStates, mocks: number): RankGap | null {
  const def = RANKS[index];
  if (def === undefined) return null;
  // Cumulative: rank n needs its own requirements and those of every rank below.
  const reqs = RANKS.slice(0, index + 1).flatMap((r) => r.nodes);
  const seen = new Set<string>();
  const nodesMissing: RankRequirement[] = [];
  for (const req of reqs) {
    const key = `${req.node}:${req.needs}`;
    if (seen.has(key) || meets(req, states[req.node])) continue;
    seen.add(key);
    nodesMissing.push(req);
  }
  const mockNeed = Math.max(...RANKS.slice(0, index + 1).map((r) => r.verifiedNazarMocks));
  return {
    rank: def.id,
    xpRequired: def.xp,
    xpMissing: Math.max(0, def.xp - xp),
    nodesMissing,
    nazarMocksMissing: Math.max(0, mockNeed - mocks),
  };
}

const rankIndex = (id: RankId): number => RANKS.findIndex((r) => r.id === id);

/**
 * Highest rank whose XP threshold and (cumulative) mastery requirements are
 * met, never below `currentRank`.
 */
export function rankFor(xp: number, nodeStates: NodeStates, opts: RankOptions = {}): RankResult {
  const mocks = opts.verifiedNazarMocks ?? 0;
  const safeXp = Number.isFinite(xp) ? xp : 0;
  let earned = 0;
  for (let i = 1; i < RANKS.length; i++) {
    const gap = gapFor(i, safeXp, nodeStates, mocks);
    if (
      gap === null ||
      gap.xpMissing > 0 ||
      gap.nodesMissing.length > 0 ||
      gap.nazarMocksMissing > 0
    )
      break;
    earned = i;
  }
  const held = opts.currentRank === undefined ? 0 : Math.max(0, rankIndex(opts.currentRank));
  const idx = Math.max(earned, held);
  const def = RANKS[idx] ?? RANKS[0];
  if (def === undefined) throw new Error("RANKS is empty");
  return {
    rank: def.id,
    name: def.name,
    shape: def.shape,
    next: gapFor(idx + 1, safeXp, nodeStates, mocks),
  };
}
