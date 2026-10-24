// Topic mastery and the review queue (GAMIFICATION_ENGINE §4.4–4.5).
//
//   M_t        = coverage_t × mean_{c ∈ seen_t} R_c(now)
//   coverage_t = |{c ∈ t : reviews_c ≥ 2 and ≥ 1 Good/Easy}| / |concepts in t|
//   R_c(now)   = FSRS retrievability, capped at 0.6 while reviews_c < 2 (evidence floor)

import { snap } from "./math.ts";
import type { CardState, Scheduler } from "./scheduler.ts";
import { pinnedScheduler } from "./scheduler.ts";
import type { EpochMs } from "./time.ts";
import { istDay } from "./time.ts";

export const EVIDENCE_FLOOR_R = 0.6;
export const MIN_REVIEWS_FOR_COVERAGE = 2;

/** Module of a concept card ID `C-<module>-<nnn>` (CURRICULUM §1.1), or null. */
export function topicOfCard(cardId: string): string | null {
  const m = /^C-([A-Z]+[0-9]+)-[0-9]+$/.exec(cardId);
  return m?.[1] ?? null;
}

export interface TopicMastery {
  /** M_t in [0, 1]. */
  readonly mastery: number;
  readonly coverage: number;
  /** Mean (floored) retrievability over seen cards; null when nothing is seen. */
  readonly meanRetrievability: number | null;
  readonly conceptCount: number;
  readonly seen: number;
  readonly covered: number;
}

export interface TopicMasteryOptions {
  /**
   * |concepts in t| from the content pack. Defaults to `cards.length`, which is
   * right only if the caller passes every concept of the topic (unseen ones as
   * new cards). Cards beyond this count are still used.
   */
  readonly conceptCount?: number;
  readonly scheduler?: Scheduler;
}

/** Mastery of one topic from its cards (§4.4). Pass only the topic's cards. */
export function topicMastery(
  cards: readonly CardState[],
  now: EpochMs,
  opts: TopicMasteryOptions = {},
): TopicMastery {
  const sched = opts.scheduler ?? pinnedScheduler();
  const conceptCount = Math.max(opts.conceptCount ?? cards.length, cards.length);
  let seen = 0;
  let covered = 0;
  let rSum = 0;
  for (const c of cards) {
    if (c.reviews <= 0) continue;
    seen++;
    if (c.reviews >= MIN_REVIEWS_FOR_COVERAGE && c.goodOrEasy >= 1) covered++;
    const r = sched.retrievability(c, now);
    rSum += c.reviews < MIN_REVIEWS_FOR_COVERAGE ? Math.min(EVIDENCE_FLOOR_R, r) : r;
  }
  const coverage = conceptCount === 0 ? 0 : covered / conceptCount;
  const meanR = seen === 0 ? null : rSum / seen;
  return {
    mastery: snap(coverage * (meanR ?? 0)),
    coverage: snap(coverage),
    meanRetrievability: meanR === null ? null : snap(meanR),
    conceptCount,
    seen,
    covered,
  };
}

/**
 * Mastery for several topics at once. Cards are grouped by `topicOfCard`;
 * `conceptCounts` gives |concepts in t| per topic (topics missing from it use
 * the number of cards seen for that topic).
 */
export function masteryByTopic(
  cards: readonly CardState[],
  now: EpochMs,
  conceptCounts: Readonly<Record<string, number>>,
  scheduler?: Scheduler,
): Record<string, TopicMastery> {
  const groups = new Map<string, CardState[]>();
  for (const t of Object.keys(conceptCounts)) groups.set(t, []);
  for (const c of cards) {
    const t = topicOfCard(c.cardId);
    if (t === null) continue;
    const g = groups.get(t) ?? [];
    g.push(c);
    groups.set(t, g);
  }
  const out: Record<string, TopicMastery> = {};
  for (const t of [...groups.keys()].sort()) {
    const opts: TopicMasteryOptions = scheduler === undefined ? {} : { scheduler };
    const count = conceptCounts[t];
    out[t] = topicMastery(
      groups.get(t) ?? [],
      now,
      count === undefined ? opts : { ...opts, conceptCount: count },
    );
  }
  return out;
}

export interface ReviewQueueLimits {
  /** Max cards per sitting [D] (§4.5). */
  readonly maxPerSitting?: number;
  /** Max new concepts introduced per IST day [D] (§4.5). */
  readonly newPerDay?: number;
  /** Unseen concept IDs in curriculum order, offered once due cards are placed. */
  readonly newCandidates?: readonly string[];
  readonly scheduler?: Scheduler;
}

export const REVIEW_LIMITS = Object.freeze({ maxPerSitting: 20, newPerDay: 8 });

export interface QueuedCard {
  readonly cardId: string;
  readonly retrievability: number;
  readonly due: EpochMs;
}

export interface ReviewQueue {
  /** Due cards, lowest retrievability first. */
  readonly due: readonly QueuedCard[];
  /** New concept IDs for this sitting (after the due cards). */
  readonly fresh: readonly string[];
  /** Due cards that didn't fit this sitting. */
  readonly dueRemaining: number;
  /** New concepts already introduced today (IST), from `firstReview`. */
  readonly newIntroducedToday: number;
}

/**
 * Builds a sitting (§4.5, API-31): due cards first, by lowest retrievability
 * (ties: earlier due, then cardId), at most 20 per sitting; then new concepts,
 * at most 8 introduced per IST day. Presenting due Nazar hazard types as
 * "3 short clips" is the caller's job.
 */
export function reviewQueue(
  cards: readonly CardState[],
  now: EpochMs,
  limits: ReviewQueueLimits = {},
): ReviewQueue {
  const sched = limits.scheduler ?? pinnedScheduler();
  const maxPer = Math.max(0, Math.floor(limits.maxPerSitting ?? REVIEW_LIMITS.maxPerSitting));
  const newPerDay = Math.max(0, Math.floor(limits.newPerDay ?? REVIEW_LIMITS.newPerDay));
  const today = istDay(now);
  const due: QueuedCard[] = [];
  const known = new Set<string>();
  let newIntroducedToday = 0;
  for (const c of cards) {
    known.add(c.cardId);
    if (c.firstReview !== null && istDay(c.firstReview) === today) newIntroducedToday++;
    if (c.reviews > 0 && c.phase !== "new" && c.due <= now) {
      due.push({
        cardId: c.cardId,
        retrievability: snap(sched.retrievability(c, now)),
        due: c.due,
      });
    }
  }
  due.sort(
    (a, b) =>
      a.retrievability - b.retrievability ||
      a.due - b.due ||
      (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0),
  );
  const dueTaken = due.slice(0, maxPer);
  const room = Math.max(0, maxPer - dueTaken.length);
  const newAllowance = Math.max(0, newPerDay - newIntroducedToday);
  const fresh: string[] = [];
  // Cards passed in state "new" with no reviews count as unseen candidates too.
  const candidates = [
    ...(limits.newCandidates ?? []),
    ...cards.filter((c) => c.reviews === 0).map((c) => c.cardId),
  ];
  const picked = new Set<string>();
  for (const id of candidates) {
    if (fresh.length >= Math.min(room, newAllowance)) break;
    if (picked.has(id)) continue;
    const existing = cards.find((c) => c.cardId === id);
    if (known.has(id) && existing !== undefined && existing.reviews > 0) continue;
    picked.add(id);
    fresh.push(id);
  }
  return { due: dueTaken, fresh, dueRemaining: due.length - dueTaken.length, newIntroducedToday };
}
