import {
  canStartNode,
  type NodeObservation,
  type NodeState,
  type NodeStates,
  type SkillNodeId,
} from "@margdarshak/gamification";
import type { LlTopicId } from "./content/bank-types";
import { cardsFromLog, llMasteries, observe, stateOf } from "./learning";
import { LEARN_KEYS, readKv, writeKv } from "./offline/kv";
import type { LogEntry } from "./offline/review-store";

/**
 * Skill-tree node states on this phone (GAMIFICATION_ENGINE §3.1). LL nodes follow FSRS mastery with
 * the package's hysteresis (in at 0.8, out at 0.7, so a node never flickers); a road-safety node is
 * "learning" once a lesson of its module is done (its games, owned by other screens, post evidence
 * to the server). With the real API, `road_readiness.nodes` from API-33 wins.
 */

export type NodeHistory = Record<string, NodeObservation[]>;

export interface NodeView {
  state: NodeState;
  /** 0–1 for LL nodes, null where mastery isn't measured on this phone. */
  mastery: number | null;
  /** Only SK-DL1 can be closed (needs SK-M1 and SK-LL1 at "learning"). */
  canStart: boolean;
}

export function refreshNodeHistory(
  log: readonly LogEntry[],
  now: number,
  conceptCounts: Record<LlTopicId, number>,
): NodeHistory {
  const hist = { ...readKv<NodeHistory>(LEARN_KEYS.nodes, {}) };
  const m = llMasteries(cardsFromLog(log), now, conceptCounts);
  for (const t of ["LL1", "LL2", "LL3", "LL4"] as const) {
    const key = `SK-${t}`;
    if (m[t].seen === 0 && !hist[key]) continue;
    hist[key] = observe(hist[key] ?? [], m[t].mastery);
  }
  writeKv(LEARN_KEYS.nodes, hist);
  return hist;
}

export function lessonsDone(): string[] {
  return readKv<string[]>(LEARN_KEYS.lessons, []);
}

export function markLessonDone(lessonId: string): void {
  const done = lessonsDone();
  if (!done.includes(lessonId)) writeKv(LEARN_KEYS.lessons, [...done, lessonId]);
}

export function deviceNodeStates(hist: NodeHistory, lessons: readonly string[]): NodeStates {
  const out: Partial<Record<SkillNodeId, NodeState>> = {};
  for (const [k, v] of Object.entries(hist)) out[k as SkillNodeId] = stateOf(v);
  for (const l of lessons) {
    const mod = /^LS-([A-Z]+\d+)-/.exec(l)?.[1];
    if (!mod) continue;
    const key = `SK-${mod}` as SkillNodeId;
    if (!out[key] || out[key] === "locked") out[key] = "learning";
  }
  return out;
}

export function nodeView(
  nodeId: string,
  states: NodeStates,
  masteries: Partial<Record<string, number>>,
): NodeView {
  const state = states[nodeId as SkillNodeId] ?? "locked";
  return {
    state,
    mastery: masteries[nodeId] ?? null,
    canStart: canStartNode(nodeId as SkillNodeId, states),
  };
}

/** Server node states (API-33 `road_readiness.nodes`), keeping only known values. */
export function serverNodeStates(nodes: Record<string, string> | undefined): NodeStates {
  const out: Partial<Record<SkillNodeId, NodeState>> = {};
  for (const [k, v] of Object.entries(nodes ?? {}))
    if (v === "locked" || v === "learning" || v === "mastered" || v === "fading")
      out[k as SkillNodeId] = v;
  return out;
}
