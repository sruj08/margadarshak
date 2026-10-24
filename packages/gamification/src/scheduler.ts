// FSRS scheduling (GAMIFICATION_ENGINE §4.1–4.2) on ts-fsrs 5.4.2 (FSRS-6).
// Parameters are pinned so the device and the server compute identical due
// dates from the same review log: request_retention 0.90, maximum_interval
// 60 days, enable_fuzz false, default FSRS-6 weights. Time is always a
// parameter (ts-fsrs falls back to `new Date()` when `now` is omitted; we
// never omit it).

import type { Card, FSRS, FSRSParameters, Grade } from "ts-fsrs";
import { fsrs, State } from "ts-fsrs";
import type { EpochMs } from "./time.ts";
import type { ReviewLogEntry, ReviewRating } from "./types.ts";

/** FSRS-6 default weights of ts-fsrs 5.4.2, pinned here so a library bump can't move them silently. */
export const FSRS_WEIGHTS: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

export interface PinnedFsrsParams {
  readonly request_retention: number;
  readonly maximum_interval: number;
  readonly enable_fuzz: false;
  readonly enable_short_term: boolean;
  readonly learning_steps: readonly ("1m" | "10m")[];
  readonly relearning_steps: readonly "10m"[];
  readonly w: readonly number[];
}

/** §4.1 parameters [D]. Learning steps and short-term mode are ts-fsrs 5.x defaults, pinned explicitly. */
export const FSRS_PARAMS: PinnedFsrsParams = Object.freeze({
  request_retention: 0.9,
  maximum_interval: 60,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: Object.freeze(["1m", "10m"] as const),
  relearning_steps: Object.freeze(["10m"] as const),
  w: FSRS_WEIGHTS,
});

/** What callers may override. Fuzz is not overridable: it is always off. */
export interface SchedulerOverrides {
  /** Per-user weights (Production, §4.1). Must have 21 entries. */
  readonly w?: readonly number[];
  readonly request_retention?: number;
  /** Capped at 60 days whatever is passed. */
  readonly maximum_interval?: number;
}

export type CardPhase = "new" | "learning" | "review" | "relearning";

/** Plain, JSON-serialisable card state (E-18). Derived; the review log is the source of truth. */
export interface CardState {
  readonly cardId: string;
  readonly phase: CardPhase;
  readonly due: EpochMs;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsedDays: number;
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly reps: number;
  readonly lapses: number;
  readonly lastReview: EpochMs | null;
  /** When the concept was first reviewed (drives the daily new-concept cap). */
  readonly firstReview: EpochMs | null;
  /** Reviews applied (one per card per session). */
  readonly reviews: number;
  /** Reviews rated Good or Easy (coverage needs at least one, §4.4). */
  readonly goodOrEasy: number;
}

export interface Scheduler {
  readonly params: Readonly<FSRSParameters>;
  /** A never-reviewed card, due at `now`. */
  newCard(cardId: string, now: EpochMs): CardState;
  /** Applies one review. Throws RangeError on a rating outside 1–4 or a non-finite time. */
  review(card: CardState, rating: ReviewRating, at: EpochMs): CardState;
  /** FSRS retrievability R(now) in [0, 1]; 0 for a new card. */
  retrievability(card: CardState, now: EpochMs): number;
}

const PHASE_OF: Readonly<Record<State, CardPhase>> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};
const STATE_OF: Readonly<Record<CardPhase, State>> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

function toFsrsCard(c: CardState): Card {
  const card: Card = {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: STATE_OF[c.phase],
  };
  if (c.lastReview !== null) card.last_review = new Date(c.lastReview);
  return card;
}

function fromFsrsCard(
  card: Card,
  prev: Pick<CardState, "cardId" | "firstReview" | "reviews" | "goodOrEasy">,
): CardState {
  return {
    cardId: prev.cardId,
    phase: PHASE_OF[card.state],
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review === undefined ? null : card.last_review.getTime(),
    firstReview: prev.firstReview,
    reviews: prev.reviews,
    goodOrEasy: prev.goodOrEasy,
  };
}

function assertTime(at: EpochMs): void {
  if (!Number.isFinite(at)) throw new RangeError(`invalid time: ${String(at)}`);
}

function assertRating(r: number): asserts r is ReviewRating {
  if (r !== 1 && r !== 2 && r !== 3 && r !== 4)
    throw new RangeError(`invalid rating: ${String(r)}`);
}

/** Builds a deterministic scheduler with the pinned §4.1 parameters. */
export function createScheduler(overrides: SchedulerOverrides = {}): Scheduler {
  const w = overrides.w ?? FSRS_PARAMS.w;
  if (w.length !== FSRS_WEIGHTS.length)
    throw new RangeError(`FSRS-6 needs ${FSRS_WEIGHTS.length} weights`);
  const retention = overrides.request_retention ?? FSRS_PARAMS.request_retention;
  if (!(retention > 0 && retention < 1))
    throw new RangeError("request_retention must be in (0, 1)");
  const maxIvl = Math.min(
    FSRS_PARAMS.maximum_interval,
    Math.max(1, overrides.maximum_interval ?? FSRS_PARAMS.maximum_interval),
  );
  const f: FSRS = fsrs({
    request_retention: retention,
    maximum_interval: maxIvl,
    enable_fuzz: false,
    enable_short_term: FSRS_PARAMS.enable_short_term,
    learning_steps: [...FSRS_PARAMS.learning_steps],
    relearning_steps: [...FSRS_PARAMS.relearning_steps],
    w: [...w],
  });
  return {
    params: Object.freeze({ ...f.parameters }),
    newCard(cardId, now) {
      assertTime(now);
      return {
        cardId,
        phase: "new",
        due: now,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        lastReview: null,
        firstReview: null,
        reviews: 0,
        goodOrEasy: 0,
      };
    },
    review(card, rating, at) {
      assertTime(at);
      assertRating(rating);
      const next = f.next(toFsrsCard(card), new Date(at), rating as Grade).card;
      // ts-fsrs 5.4.2 clamps each interval to maximum_interval and *then*
      // forces hard < good < easy, so Good/Easy can land at max + 1 / max + 2
      // days. §4.1 says intervals never exceed 60 days, so re-clamp here.
      if (next.scheduled_days > maxIvl) {
        next.scheduled_days = maxIvl;
        next.due = new Date(at + maxIvl * 86_400_000);
      }
      return fromFsrsCard(next, {
        cardId: card.cardId,
        firstReview: card.firstReview ?? at,
        reviews: card.reviews + 1,
        goodOrEasy: card.goodOrEasy + (rating >= 3 ? 1 : 0),
      });
    },
    retrievability(card, now) {
      assertTime(now);
      if (card.phase === "new" || card.lastReview === null) return 0;
      return f.get_retrievability(toFsrsCard(card), new Date(now), false);
    },
  };
}

let defaultScheduler: Scheduler | undefined;
/** The shared pinned scheduler (created lazily; stateless apart from parameters). */
export function pinnedScheduler(): Scheduler {
  defaultScheduler ??= createScheduler();
  return defaultScheduler;
}

/**
 * Recomputes card states from the append-only review log (§4.2). Entries are
 * applied per card in `reviewedAt` order (ties keep log order). Defensive
 * collapse of the "one review per card per session" rule (§4.3): entries for
 * the same card with the same `sourceSid` merge into one review at the
 * earliest time with the worst (lowest) rating. Output is sorted by cardId,
 * so replaying the same log always yields byte-identical results.
 */
export function replayReviewLog(
  log: readonly ReviewLogEntry[],
  scheduler: Scheduler = pinnedScheduler(),
): CardState[] {
  const byCard = new Map<
    string,
    { at: EpochMs; rating: ReviewRating; idx: number; sid?: string }[]
  >();
  log.forEach((e, idx) => {
    assertTime(e.reviewedAt);
    assertRating(e.rating);
    const list = byCard.get(e.cardId) ?? [];
    const sid = e.sourceSid;
    const same = sid === undefined || sid === "" ? undefined : list.find((x) => x.sid === sid);
    if (same !== undefined) {
      if (e.rating < same.rating) same.rating = e.rating;
      if (e.reviewedAt < same.at) same.at = e.reviewedAt;
    } else {
      list.push(
        sid === undefined || sid === ""
          ? { at: e.reviewedAt, rating: e.rating, idx }
          : { at: e.reviewedAt, rating: e.rating, idx, sid },
      );
    }
    byCard.set(e.cardId, list);
  });
  const ids = [...byCard.keys()].sort();
  return ids.map((cardId) => {
    const entries = (byCard.get(cardId) ?? []).slice().sort((a, b) => a.at - b.at || a.idx - b.idx);
    const first = entries[0];
    let card = scheduler.newCard(cardId, first === undefined ? 0 : first.at);
    for (const e of entries) card = scheduler.review(card, e.rating, e.at);
    return card;
  });
}

/** EC-15: accepted review time on sync. Device time is kept when within ±24 h of server receipt and not earlier than the card's previous accepted review; otherwise the receipt time is used. */
export function acceptReviewTime(
  deviceAt: EpochMs,
  receivedAt: EpochMs,
  previousForCard: EpochMs | null,
): EpochMs {
  const DAY = 86_400_000;
  const plausible = Number.isFinite(deviceAt) && Math.abs(deviceAt - receivedAt) <= DAY;
  const monotonic = previousForCard === null || deviceAt >= previousForCard;
  return plausible && monotonic ? deviceAt : receivedAt;
}
