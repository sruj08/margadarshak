import {
  type CardState,
  calibrationBins,
  type GateInput,
  type LlMasteries,
  type NodeObservation,
  type NodeState,
  nodeState,
  pinnedScheduler,
  type RatedAnswer,
  type ReviewLogEntry,
  readiness,
  replayReviewLog,
  reviewQueue,
  type TopicMastery,
  topicMastery,
  topicOfCard,
} from "@margdarshak/gamification";
import type { Readiness, ReviewItem } from "./api-types";
import type { BankItem, LlTopicId } from "./content/bank-types";
import type { LogEntry } from "./offline/review-store";

/**
 * The device side of the learning maths (mock mode and offline): everything is derived from the
 * append-only review log with `@margdarshak/gamification`, the same functions the compute service
 * runs for API-31/33. Pure: `now` is always passed in.
 */

export function toReviewLog(log: readonly LogEntry[]): ReviewLogEntry[] {
  return log.map((e) => ({
    cardId: e.cardId,
    rating: e.rating,
    reviewedAt: e.reviewedAt,
    sourceSid: e.sourceSid,
    ...(e.confidence ? { confidence: e.confidence } : {}),
  }));
}

/** Card states from the log (deterministic: the same log always gives byte-identical cards). */
export function cardsFromLog(log: readonly LogEntry[]): CardState[] {
  return replayReviewLog(toReviewLog(log), pinnedScheduler());
}

export function ratedAnswers(log: readonly LogEntry[]): RatedAnswer[] {
  return log
    .filter((e) => e.mode !== "mock")
    .map((e) => ({ correct: e.correct, ...(e.confidence ? { confidence: e.confidence } : {}) }));
}

/** M_t per LL topic (LL1–LL4). */
export function llMasteries(
  cards: readonly CardState[],
  now: number,
  conceptCounts: Record<LlTopicId, number>,
): Record<LlTopicId, TopicMastery> {
  const group = (t: LlTopicId) => cards.filter((c) => topicOfCard(c.cardId) === t);
  const sched = pinnedScheduler();
  const one = (t: LlTopicId) =>
    topicMastery(group(t), now, { conceptCount: conceptCounts[t], scheduler: sched });
  return { LL1: one("LL1"), LL2: one("LL2"), LL3: one("LL3"), LL4: one("LL4") };
}

export const WEIGHTS_SOURCE_EQUAL = "equal_default_topic_mix_unknown";

/** API-33-shaped readiness computed on this phone (labelled as an on-device estimate in the UI). */
export function deviceReadiness(
  log: readonly LogEntry[],
  now: number,
  conceptCounts: Record<LlTopicId, number>,
  gateInput?: GateInput,
): Readiness {
  const cards = cardsFromLog(log);
  const m = llMasteries(cards, now, conceptCounts);
  const masteries: LlMasteries = {
    LL1: m.LL1.mastery,
    LL2: m.LL2.mastery,
    LL3: m.LL3.mastery,
    LL4: m.LL4.mastery,
  };
  const r = readiness(masteries, ratedAnswers(log), undefined, gateInput);
  const out: Readiness = {
    score: r.readiness,
    knowledge: r.knowledge,
    calibration_penalty: r.calPenalty,
    display_key: "readiness.formula",
    topics: r.topics.map((t) => ({
      topic_id: t.topic,
      weight: t.weight,
      mastery: t.mastery,
      coverage: m[t.topic].coverage,
    })),
    weights_source: WEIGHTS_SOURCE_EQUAL,
    gate: { threshold: 85, met: r.gate.met, advisory: true, book_anyway_visible: true },
  };
  return out;
}

export function deviceCalibration(log: readonly LogEntry[]) {
  return calibrationBins(ratedAnswers(log));
}

/** Concepts in curriculum order (signs first) for new cards. */
export function newCandidates(items: readonly BankItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const order = [...items]
    .filter((i) => i.pool === "practice")
    .sort((a, b) => (a.concept < b.concept ? -1 : a.concept > b.concept ? 1 : 0));
  for (const i of order) {
    if (seen.has(i.concept)) continue;
    seen.add(i.concept);
    out.push(i.concept);
  }
  return out;
}

const TOPIC_RE = /^C-(LL[1-4])-/;

/** API-31-shaped queue from the device log. */
export function deviceQueue(
  log: readonly LogEntry[],
  now: number,
  items: readonly BankItem[],
  topic?: string | null,
): ReviewItem[] {
  const cards = cardsFromLog(log);
  let candidates = newCandidates(items);
  if (topic) candidates = candidates.filter((c) => c.startsWith(`C-${topic}-`));
  const q = reviewQueue(cards, now, { newCandidates: candidates });
  const due: ReviewItem[] = q.due
    .filter((d) => !topic || d.cardId.startsWith(`C-${topic}-`))
    .map((d) => ({
      card_id: d.cardId,
      topic_id: TOPIC_RE.exec(d.cardId)?.[1] ?? "",
      due_at: new Date(d.due).toISOString(),
      retrievability: d.retrievability,
    }));
  const fresh: ReviewItem[] = q.fresh.map((id) => ({
    card_id: id,
    topic_id: TOPIC_RE.exec(id)?.[1] ?? "",
    due_at: new Date(now).toISOString(),
    retrievability: 0,
  }));
  return [...due, ...fresh];
}

/** Earliest next due time across cards (for "Next review: …"), or null. */
export function nextDue(log: readonly LogEntry[], now: number): number | null {
  let min: number | null = null;
  for (const c of cardsFromLog(log)) {
    if (c.reviews === 0 || c.due <= now) continue;
    if (min === null || c.due < min) min = c.due;
  }
  return min;
}

/** Appends a node observation when mastery moved (keeps the last 30). */
export function observe(
  history: readonly NodeObservation[],
  mastery: number,
  criterion = true,
): NodeObservation[] {
  const last = history.at(-1);
  if (last && Math.abs(last.mastery - mastery) < 0.005) return [...history];
  return [...history, { mastery, gameCriterionMet: criterion }].slice(-30);
}

export function stateOf(history: readonly NodeObservation[] | undefined): NodeState {
  return history && history.length > 0 ? nodeState(history) : "locked";
}
