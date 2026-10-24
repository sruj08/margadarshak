// Learning and gamification maths for the Go API (D1, plan §2.11.4). Pure pass-throughs to
// @margdarshak/gamification plus game-core's `ratingFromEvidence`, so the browser and the server run
// one implementation. Stateless: Go sends the review log, the cached states and `now` (epoch ms,
// Go server time); nothing here reads the clock or stores anything.
//
//   POST /learn/answers          LL answers → correctness from the verifier's server keys (`q/`),
//                                FSRS rating, accepted review time, next due date, card states.
//                                Go never sees an answer key and never computes correctness.
//   POST /learn/state            review log → cards, mastery by topic, skill-tree node states,
//                                review queue, Test Readiness, calibration, Road Readiness.
//   POST /gamification/evaluate  XP for a verified session and/or due reviews, rank (never
//                                demotes), weekly streak (closes finished weeks lazily), badges.
//
// Casing: request envelopes are camelCase (plan §2.11.4); the answer rows in and out of
// /learn/answers are snake_case like API-32 and the learn.answers table; the nested gamification
// structures (CardState, ReviewLogEntry, StreakState, …) keep the package's camelCase so Go can
// store and send them back verbatim.

import { ratingFromEvidence } from "@margdarshak/game-core/learning";
import { LlAnswerKey } from "@margdarshak/game-core/schema";
import {
  acceptReviewTime,
  archiveStreak,
  type BadgeHistory,
  type BadgeId,
  brier,
  CALIBRATION_WINDOW,
  type CardState,
  calibrationBins,
  DAY_MS,
  evaluateBadges,
  initialStreak,
  isCalibrated,
  istWeek,
  type LlMasteries,
  masteryByTopic,
  type NodeState,
  nextNodeState,
  overconfidence,
  parseWeekKey,
  RANKS,
  type RankId,
  type RatedAnswer,
  type ReviewLogEntry,
  rankFor,
  readiness,
  replayReviewLog,
  reviewQueue,
  roadReadiness,
  type SessionResultLike,
  SKILL_NODES,
  type SkillNodeId,
  type StreakEvent,
  type StreakState,
  streakTransition,
  streakView,
  sureAndWrong,
  type XpAward,
  xpForReviews,
  xpForSession,
} from "@margdarshak/gamification";
import { z } from "zod";
import { HttpProblem } from "../http-util.ts";
import { defined, EPOCH_MS_MAX, postRoute, type RouteMap } from "./types.ts";

// ---------------------------------------------------------------------------------------------
// Shared schemas

const EpochMs = z.number().int().min(0).max(EPOCH_MS_MAX);
const Confidence = z.enum(["50", "75", "100"]);
const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const CardId = z.string().min(1).max(48);
const Sid = z.string().min(1).max(64);
/** A curriculum module / topic ID (`LL1`, `M14`), the `<module>` of `C-<module>-<nnn>`. */
const TopicId = z.string().regex(/^[A-Z]{1,4}[0-9]{1,2}$/);
const WeekKey = z.string().regex(/^\d{4}-W\d{2}$/);

export const ReviewLogEntrySchema = z
  .object({
    cardId: CardId,
    rating: Rating,
    reviewedAt: EpochMs,
    sourceSid: Sid.optional(),
    confidence: Confidence.optional(),
  })
  .strict();

export const RatedAnswerSchema = z
  .object({ correct: z.boolean(), confidence: Confidence.optional() })
  .strict();

const ReviewLog = z.array(ReviewLogEntrySchema).max(20_000);

const NodeStateSchema = z.enum(["locked", "learning", "mastered", "fading"]);
const SkillNodeSchema = z.enum(SKILL_NODES as unknown as [SkillNodeId, ...SkillNodeId[]]);
const NodeStatesSchema = z.partialRecord(SkillNodeSchema, NodeStateSchema);
const RankIdSchema = z.enum(RANKS.map((r) => r.id) as [RankId, ...RankId[]]);

export const CardStateSchema = z
  .object({
    cardId: z.string(),
    phase: z.enum(["new", "learning", "review", "relearning"]),
    due: z.number(),
    stability: z.number(),
    difficulty: z.number(),
    elapsedDays: z.number(),
    scheduledDays: z.number(),
    learningSteps: z.number(),
    reps: z.number(),
    lapses: z.number(),
    lastReview: z.number().nullable(),
    firstReview: z.number().nullable(),
    reviews: z.number(),
    goodOrEasy: z.number(),
  })
  .strict();

const toLog = (log: readonly z.infer<typeof ReviewLogEntrySchema>[]): ReviewLogEntry[] =>
  log.map((e) => defined(e) as ReviewLogEntry);
const toRated = (a: readonly z.infer<typeof RatedAnswerSchema>[]): RatedAnswer[] =>
  a.map((x) => defined(x) as RatedAnswer);

// ---------------------------------------------------------------------------------------------
// POST /learn/answers

/** Item IDs as in content (`C-LL1-001:v1`); the session item ref is `q:<qref>`. */
const QRef = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,54}$/)
  .refine((s) => !s.includes(".."), { message: "invalid qref" });

export const AnswerSchema = z
  .object({
    client_answer_id: z.string().min(1).max(64),
    qref: QRef,
    /** null = no answer (timeout or skipped): scored wrong. */
    selected_option_id: z.string().min(1).max(24).nullable(),
    confidence: Confidence.optional(),
    latency_ms: z.number().int().min(0).max(3_600_000).optional(),
    /** The item's timer, for the "slow" rule (> 80% of the timer is Hard). */
    timer_ms: z.number().int().min(1).max(3_600_000).optional(),
    /** Device time of the answer; EC-15 decides whether it is kept. */
    answered_at: EpochMs,
    /** Answers of one session collapse to one review per card (worst rating). */
    source_sid: Sid.optional(),
  })
  .strict();
export type Answer = z.infer<typeof AnswerSchema>;

export const LearnAnswersRequest = z
  .object({
    now: EpochMs,
    answers: z.array(AnswerSchema).min(1).max(200),
    /** The stored review log of (at least) the cards these answers touch, any order. */
    reviewLog: ReviewLog,
  })
  .strict()
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    r.answers.forEach((a, i) => {
      if (seen.has(a.client_answer_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["answers", i, "client_answer_id"],
          message: "duplicate client_answer_id in the batch (dedupe before calling)",
        });
      }
      seen.add(a.client_answer_id);
    });
  });
export type LearnAnswersRequest = z.infer<typeof LearnAnswersRequest>;

export const AnswerResultSchema = z
  .object({
    client_answer_id: z.string(),
    qref: z.string(),
    /** The concept card the answer reviews (every variant of a concept shares it). */
    card_id: z.string(),
    topic: z.string(),
    correct: z.boolean(),
    rating: Rating,
    overconfident: z.boolean(),
    /** Accepted review time (EC-15): the device time when plausible and monotonic, else `now`. */
    reviewed_at: z.number(),
    /** The card's due date after this answer. */
    next_due_at: z.number(),
  })
  .strict();

export const LearnAnswersResponse = z
  .object({
    results: z.array(AnswerResultSchema),
    /** Every card in reviewLog ∪ the new reviews, replayed (sorted by cardId). */
    cards: z.array(CardStateSchema),
  })
  .strict();
export type LearnAnswersResponse = z.infer<typeof LearnAnswersResponse>;

/** Looks up answer keys by qref; missing ones are reported together. */
export type KeyLookup = (qref: string) => Promise<LlAnswerKey | undefined>;

/** The maths of /learn/answers, given the keys (exported for unit tests). */
export function scoreAnswers(
  req: LearnAnswersRequest,
  keys: ReadonlyMap<string, LlAnswerKey>,
): LearnAnswersResponse {
  const log = toLog(req.reviewLog);
  const lastByCard = new Map<string, number>();
  for (const e of log) {
    lastByCard.set(e.cardId, Math.max(lastByCard.get(e.cardId) ?? e.reviewedAt, e.reviewedAt));
  }
  // Accept times in device-time order so a batch synced late is not pushed to `now` by itself.
  const order = req.answers
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.answered_at - y.a.answered_at || x.i - y.i);
  const entries: (ReviewLogEntry & { i: number })[] = [];
  const partial: Omit<z.infer<typeof AnswerResultSchema>, "next_due_at">[] = [];
  for (const { a, i } of order) {
    const key = keys.get(a.qref) as LlAnswerKey;
    const correct = a.selected_option_id !== null && a.selected_option_id === key.correctOptionId;
    const { rating, overconfident } = ratingFromEvidence(
      defined({
        correct,
        confidence: a.confidence,
        latencyMs: a.latency_ms,
        timerMs: a.timer_ms,
      }),
    );
    const prev = lastByCard.get(key.cardId) ?? null;
    const at = acceptReviewTime(a.answered_at, req.now, prev);
    lastByCard.set(key.cardId, Math.max(prev ?? at, at));
    entries.push(
      defined({
        i,
        cardId: key.cardId,
        rating,
        reviewedAt: at,
        sourceSid: a.source_sid,
        confidence: a.confidence,
      }),
    );
    partial[i] = {
      client_answer_id: a.client_answer_id,
      qref: a.qref,
      card_id: key.cardId,
      topic: key.topic,
      correct,
      rating,
      overconfident,
      reviewed_at: at,
    };
  }
  // next_due_at: the card's due date once the log up to and including this answer is replayed.
  const results = req.answers.map((_, i) => {
    const r = partial[i] as (typeof partial)[number];
    const upTo = entries.slice(0, entries.findIndex((e) => e.i === i) + 1);
    const cardLog = [...log, ...upTo.map(({ i: _i, ...e }) => e)].filter(
      (e) => e.cardId === r.card_id,
    );
    const card = replayReviewLog(cardLog)[0] as CardState;
    return { ...r, next_due_at: card.due };
  });
  const cards = replayReviewLog([...log, ...entries.map(({ i: _i, ...e }) => e)]);
  return { results, cards };
}

async function learnAnswers(req: LearnAnswersRequest, lookup: KeyLookup) {
  const qrefs = [...new Set(req.answers.map((a) => a.qref))];
  const found = await Promise.all(qrefs.map((q) => lookup(q)));
  const missing = qrefs.filter((_, i) => found[i] === undefined);
  if (missing.length > 0) {
    throw new HttpProblem({
      type: "content-not-found",
      title: "No answer key for a question",
      status: 422,
      detail: `no server key for ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
      code: "CONTENT_NOT_FOUND",
    });
  }
  const keys = new Map(qrefs.map((q, i) => [q, found[i] as LlAnswerKey]));
  return scoreAnswers(req, keys);
}

// ---------------------------------------------------------------------------------------------
// POST /learn/state

export const LearnStateRequest = z
  .object({
    now: EpochMs,
    reviewLog: ReviewLog,
    /** The last ≤ 40 confidence-rated LL answers, oldest first (calibration window). */
    ratedAnswers: z.array(RatedAnswerSchema).max(CALIBRATION_WINDOW),
    /** |concepts in topic| from the content pack, e.g. {"LL1": 30, "M14": 12}. */
    conceptCounts: z.record(TopicId, z.number().int().min(0).max(10_000)),
    /** Verified LL mock percentages (oldest first) and the state's pass mark, for the gate. */
    gateInput: z
      .object({
        llMockPcts: z.array(z.number().min(0).max(100)).max(50),
        passMarkPct: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
    /** Nazar Score (NAZAR.md; Go computes it from eligible mocks); null/absent = none yet. */
    nazarScore: z.number().min(0).max(100).nullable().optional(),
    /** Tenant state code (J&K adds M14 to Road Readiness). */
    stateCode: z.string().regex(/^[A-Z]{2,7}$/),
    /** Cached node states from the last call (hysteresis needs the previous state). */
    previousNodeStates: NodeStatesSchema.optional(),
    /** Nodes whose module game criterion has ever been met (CURRICULUM §6). */
    gameCriteriaMet: z.array(SkillNodeSchema).max(64).optional(),
    /** Unseen concept IDs in curriculum order, offered after the due cards. */
    newCandidates: z.array(CardId).max(500).optional(),
    /** This week's answers, for "sure and wrong N times this week"; defaults to ratedAnswers. */
    weekAnswers: z.array(RatedAnswerSchema).max(1000).optional(),
  })
  .strict();
export type LearnStateRequest = z.infer<typeof LearnStateRequest>;

const TopicMasterySchema = z
  .object({
    mastery: z.number(),
    coverage: z.number(),
    meanRetrievability: z.number().nullable(),
    conceptCount: z.number(),
    seen: z.number(),
    covered: z.number(),
  })
  .strict();

const ReadinessSchema = z
  .object({
    readiness: z.number(),
    knowledge: z.number(),
    calPenalty: z.number(),
    topics: z.array(
      z.object({ topic: z.string(), mastery: z.number(), weight: z.number() }).strict(),
    ),
    calibration: z
      .object({ n: z.number(), oc: z.number().nullable(), enough: z.boolean() })
      .strict(),
    weightsSource: z.string(),
    gate: z
      .object({
        met: z.boolean(),
        reasons: z.array(z.string()),
        weakTopics: z.array(z.string()),
        bookAnywayVisible: z.literal(true),
      })
      .strict(),
  })
  .strict();

export const CalibrationSchema = z
  .object({
    n: z.number(),
    brier: z.number().nullable(),
    overconfidence: z.number().nullable(),
    bins: z.array(
      z
        .object({
          stated: Confidence,
          p: z.number(),
          n: z.number(),
          accuracy: z.number().nullable(),
        })
        .strict(),
    ),
    sureAndWrong: z.number(),
    calibrated: z.boolean(),
  })
  .strict();

export const LearnStateResponse = z
  .object({
    cards: z.array(CardStateSchema),
    masteryByTopic: z.record(z.string(), TopicMasterySchema),
    /** Every skill node (29), "locked" when nothing is known. */
    nodeStates: z.record(z.string(), NodeStateSchema),
    reviewQueue: z
      .object({
        due: z.array(
          z.object({ cardId: z.string(), retrievability: z.number(), due: z.number() }).strict(),
        ),
        fresh: z.array(z.string()),
        dueRemaining: z.number(),
        newIntroducedToday: z.number(),
      })
      .strict(),
    readiness: ReadinessSchema,
    calibration: CalibrationSchema,
    roadReadiness: z
      .object({
        score: z.number().nullable(),
        knowledgePart: z.number(),
        nazarPart: z.number().nullable(),
        modules: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type LearnStateResponse = z.infer<typeof LearnStateResponse>;

/** Calibration over the last `window` rated answers (GAMIFICATION_ENGINE §6). */
export function calibrationSummary(
  answers: readonly RatedAnswer[],
  weekAnswers: readonly RatedAnswer[] = answers,
  window = CALIBRATION_WINDOW,
): z.infer<typeof CalibrationSchema> {
  const n = answers.filter((a) => a.confidence !== undefined).slice(-window).length;
  return {
    n,
    brier: brier(answers, window),
    overconfidence: overconfidence(answers, window),
    bins: calibrationBins(answers, window),
    sureAndWrong: sureAndWrong(weekAnswers),
    calibrated: isCalibrated(answers),
  };
}

/** Readiness from LL topic masteries (exported so the §5.1 golden can be checked directly). */
export function readinessFrom(
  masteries: LlMasteries,
  answers: readonly RatedAnswer[],
  gateInput?: { llMockPcts: readonly number[]; passMarkPct: number },
) {
  return readiness(masteries, answers, undefined, gateInput);
}

/** Node states after this observation (hysteresis from the previous state, §3.1). */
export function nodeStatesFrom(
  masteries: Readonly<Record<string, { mastery: number; seen: number }>>,
  previous: Readonly<Partial<Record<SkillNodeId, NodeState>>> = {},
  criteria: readonly SkillNodeId[] = [],
): Record<SkillNodeId, NodeState> {
  const met = new Set(criteria);
  const out = {} as Record<SkillNodeId, NodeState>;
  for (const node of SKILL_NODES) {
    const prev = previous[node] ?? "locked";
    const m = masteries[node.slice(3)];
    out[node] =
      m === undefined
        ? prev
        : nextNodeState(
            prev,
            { mastery: m.mastery, gameCriterionMet: met.has(node), hasEvidence: m.seen > 0 },
            met.has(node),
          );
  }
  return out;
}

export function learnState(req: LearnStateRequest) {
  const cards = replayReviewLog(toLog(req.reviewLog));
  const mastery = masteryByTopic(cards, req.now, req.conceptCounts);
  const rated = toRated(req.ratedAnswers);
  const ll: Record<string, number> = {};
  for (const t of ["LL1", "LL2", "LL3", "LL4"]) {
    const m = mastery[t];
    if (m !== undefined) ll[t] = m.mastery;
  }
  const masteryValues = Object.fromEntries(Object.entries(mastery).map(([t, m]) => [t, m.mastery]));
  return {
    cards,
    masteryByTopic: mastery,
    nodeStates: nodeStatesFrom(mastery, req.previousNodeStates ?? {}, req.gameCriteriaMet ?? []),
    reviewQueue: reviewQueue(
      cards,
      req.now,
      req.newCandidates === undefined ? {} : { newCandidates: req.newCandidates },
    ),
    readiness: readinessFrom(ll, rated, req.gateInput),
    calibration: calibrationSummary(
      rated,
      req.weekAnswers === undefined ? rated : toRated(req.weekAnswers),
    ),
    roadReadiness: roadReadiness(masteryValues, req.nazarScore ?? null, {
      stateCode: req.stateCode,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// POST /gamification/evaluate

/** The SessionResult fields XP and badges read (gamification `SessionResultLike`). */
const SessionLike = {
  gameId: z.string().min(1).max(24),
  mode: z.enum(["learn", "practice", "mock", "pair"]),
  score: z
    .object({
      pct: z.number().min(0).max(100),
      capApplied: z.string().max(48).nullable().optional(),
    })
    .strict(),
  findings: z
    .array(z.object({ findingId: z.string().max(40), critical: z.boolean() }).strict())
    .max(12)
    .optional(),
  integrity: z
    .object({ trust: z.number().min(0).max(1), flags: z.array(z.string().max(32)).max(32) })
    .strict(),
};
const SessionLikeSchema = z.object(SessionLike).strict();
const BadgeSessionSchema = z.object({ ...SessionLike, completedAt: EpochMs }).strict();

const StreakStateSchema = z
  .object({
    status: z.enum(["active", "repairable", "archived"]),
    weeks: z.number().int().min(0),
    tokens: z.number().int().min(0).max(2),
    goal: z.number().int().min(2).max(6),
    lastClosedWeek: WeekKey.nullable(),
    archivedOn: z.iso.date().optional(),
  })
  .strict();

const BadgeIdSchema = z.enum(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"]);

const BadgeHistorySchema = z
  .object({
    hasAccount: z.boolean(),
    declarations: z
      .object({
        khudLicence: z.object({ dlIssueDate: z.iso.date() }).strict().nullable().optional(),
        firstAttemptPass: z.boolean().optional(),
      })
      .strict()
      .optional(),
    nazar: z
      .object({
        score: z.number().min(0).max(100).nullable(),
        eligibleMocks: z.number().int().min(0),
      })
      .strict()
      .optional(),
    answers: z.array(RatedAnswerSchema).max(1000).optional(),
    sessions: z.array(BadgeSessionSchema).max(500).optional(),
    helmetSelfChecks: z.array(EpochMs).max(1000).optional(),
    /** Defaults to the request's nodeStates. */
    nodeStates: NodeStatesSchema.optional(),
    nightNazarTypesMastered: z.boolean().optional(),
    goldenHourMedicalSignOff: z.boolean().optional(),
  })
  .strict();

export const EvaluateRequest = z
  .object({
    now: EpochMs,
    /** The verified session (XP only for verified sessions: GAME_SDK §6.4). */
    session: SessionLikeSchema.optional(),
    /** Active learning minutes already accrued in the IST day before this activity. */
    minutesToday: z.number().min(0).max(1440),
    /** This session's verified duration in minutes (pro-rata split across 45/90). */
    sessionMinutes: z.number().min(0).max(1440).default(0),
    /** A review sitting: due cards reviewed (non-due re-reviews earn nothing). */
    reviews: z
      .object({
        dueCardsReviewed: z.number().int().min(0).max(1000),
        reviewMinutes: z.number().min(0).max(1440).default(0),
      })
      .strict()
      .optional(),
    /** XP in the ledger before this activity. */
    xpTotal: z.number().int().min(0).max(1_000_000_000),
    nodeStates: NodeStatesSchema,
    verifiedNazarMocks: z.number().int().min(0).max(1_000_000),
    /** The rank already held (null = none yet); the result is never below it. */
    currentRank: RankIdSchema.nullable(),
    /** Stored streak; null starts one (with streakGoal, default 4). */
    streakState: StreakStateSchema.nullable(),
    streakGoal: z.number().int().min(2).max(6).optional(),
    /** The IST ISO week of `now` ("2026-W43"); must match `now`. */
    weekKey: WeekKey,
    /** Counted sessions in the current week, including this one (for the weekly card). */
    sessionsThisWeek: z.number().int().min(0).max(1000),
    /**
     * Finished weeks not yet closed, with their counted sessions (any order; weeks with no
     * sessions may be omitted). Weeks up to last week are closed lazily and idempotently; a week
     * at or before `streakState.lastClosedWeek` changes nothing.
     */
    closedWeeks: z
      .array(z.object({ weekKey: WeekKey, sessions: z.number().int().min(0).max(1000) }).strict())
      .max(60)
      .default([]),
    /** E-11 test_passed time: archives the streak ("Prep streak: N weeks"). */
    testPassedAt: EpochMs.optional(),
    badgeHistory: BadgeHistorySchema,
    /** Badges already stored as earned (to report what is newly awarded or silently revoked). */
    earnedBadges: z.array(BadgeIdSchema).max(9).default([]),
  })
  .strict();
export type EvaluateRequest = z.infer<typeof EvaluateRequest>;

const XpAwardSchema = z
  .object({
    xp: z.number(),
    base: z.number(),
    quality: z.number(),
    diminish: z.number(),
    trustFactor: z.number(),
    zeroReason: z.literal("seen_clip_replay").optional(),
  })
  .strict();

const RankGapSchema = z
  .object({
    rank: RankIdSchema,
    xpRequired: z.number(),
    xpMissing: z.number(),
    nodesMissing: z.array(
      z.object({ node: z.string(), needs: z.enum(["learning", "mastered"]) }).strict(),
    ),
    nazarMocksMissing: z.number(),
  })
  .strict();

export const EvaluateResponse = z
  .object({
    xp: z
      .object({
        session: XpAwardSchema.nullable(),
        reviews: XpAwardSchema.nullable(),
        /** XP earned by this activity (session + reviews). */
        gained: z.number(),
        /** xpTotal + gained. */
        total: z.number(),
      })
      .strict(),
    rank: z
      .object({
        rank: RankIdSchema,
        name: z.string(),
        shape: z.string(),
        next: RankGapSchema.nullable(),
        promoted: z.boolean(),
      })
      .strict(),
    streak: z
      .object({
        state: StreakStateSchema,
        /** E-22 ledger events (never user-facing copy). */
        events: z.array(z.string()),
        /** Always false: a streak never triggers a notification (DP-10). */
        notify: z.literal(false),
        view: z
          .object({
            weekKey: z.string(),
            dots: z.number(),
            filled: z.number(),
            pothole: z.boolean(),
            weeks: z.number(),
            archived: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    badges: z
      .object({
        statuses: z.array(
          z
            .object({
              id: BadgeIdSchema,
              key: z.string(),
              shape: z.string(),
              earned: z.boolean(),
              available: z.boolean(),
              yourWord: z.boolean(),
              verifiedBy: z.string(),
              label: z.string().nullable(),
              count: z.number().optional(),
            })
            .strict(),
        ),
        /** Earned now and not in earnedBadges. */
        awarded: z.array(BadgeIdSchema),
        /** In earnedBadges but no longer earned (a withdrawn self-declaration): remove silently. */
        revoked: z.array(BadgeIdSchema),
      })
      .strict(),
  })
  .strict();
export type EvaluateResponse = z.infer<typeof EvaluateResponse>;

/** Closes finished weeks (provided counts, then zeros up to last week), idempotently. */
export function closeStreakWeeks(
  start: StreakState,
  now: number,
  closedWeeks: readonly { weekKey: string; sessions: number }[],
  testPassedAt?: number,
): { state: StreakState; events: StreakEvent[] } {
  let state = start;
  const events: StreakEvent[] = [];
  const sorted = [...closedWeeks].sort(
    (a, b) => (parseWeekKey(a.weekKey) ?? 0) - (parseWeekKey(b.weekKey) ?? 0),
  );
  for (const w of sorted) {
    const r = streakTransition(state, { weekKey: w.weekKey, sessions: w.sessions });
    state = r.state;
    events.push(...r.events);
  }
  const last = istWeek(now - 7 * DAY_MS).key;
  if (state.lastClosedWeek !== null && state.status !== "archived") {
    const r = streakTransition(state, { weekKey: last, sessions: 0 });
    state = r.state;
    events.push(...r.events);
  }
  if (testPassedAt !== undefined && state.status !== "archived") {
    state = archiveStreak(state, testPassedAt);
    events.push("archived");
  }
  return { state, events };
}

export function evaluateGamification(req: EvaluateRequest) {
  const current = istWeek(req.now);
  if (req.weekKey !== current.key) {
    throw new HttpProblem({
      type: "week-mismatch",
      title: "weekKey is not the IST week of now",
      status: 422,
      detail: `now is in ${current.key}, weekKey is ${req.weekKey}`,
    });
  }
  const currentMonday = current.monday;
  for (const w of req.closedWeeks) {
    const monday = parseWeekKey(w.weekKey);
    if (monday === null || monday >= currentMonday) {
      throw new HttpProblem({
        type: "week-mismatch",
        title: "closedWeeks must be finished ISO weeks before weekKey",
        status: 422,
        detail: w.weekKey,
      });
    }
  }
  const session: XpAward | null =
    req.session === undefined
      ? null
      : xpForSession(
          defined(req.session) as SessionResultLike,
          req.minutesToday,
          req.sessionMinutes,
        );
  // A review sitting in the same call starts after the session's minutes.
  const reviews: XpAward | null =
    req.reviews === undefined
      ? null
      : xpForReviews(
          req.reviews.dueCardsReviewed,
          req.minutesToday + (req.session === undefined ? 0 : req.sessionMinutes),
          req.reviews.reviewMinutes,
        );
  const gained = (session?.xp ?? 0) + (reviews?.xp ?? 0);
  const total = req.xpTotal + gained;

  const rank = rankFor(total, req.nodeStates, {
    verifiedNazarMocks: req.verifiedNazarMocks,
    currentRank: req.currentRank ?? undefined,
  });
  const idx = (id: RankId | null): number =>
    id === null ? -1 : RANKS.findIndex((r) => r.id === id);

  const start = req.streakState ?? initialStreak(req.streakGoal);
  const closed = closeStreakWeeks(
    defined(start) as StreakState,
    req.now,
    req.closedWeeks,
    req.testPassedAt,
  );

  const history = defined({
    ...req.badgeHistory,
    nodeStates: req.badgeHistory.nodeStates ?? req.nodeStates,
  }) as unknown as BadgeHistory;
  const statuses = evaluateBadges(history);
  const held = new Set<BadgeId>(req.earnedBadges);
  return {
    xp: { session, reviews, gained, total },
    rank: { ...rank, promoted: idx(rank.rank) > Math.max(0, idx(req.currentRank)) },
    streak: {
      state: closed.state,
      events: closed.events,
      notify: false,
      view: streakView(closed.state, req.sessionsThisWeek, req.now),
    },
    badges: {
      statuses,
      awarded: statuses.filter((b) => b.earned && !held.has(b.id)).map((b) => b.id),
      revoked: statuses.filter((b) => !b.earned && held.has(b.id)).map((b) => b.id),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Routes

export const learnRoutes: RouteMap = {
  "/learn/answers": postRoute({
    request: LearnAnswersRequest,
    response: LearnAnswersResponse,
    contract: "Request does not match the /learn/answers contract",
    handle: (req, ctx) =>
      learnAnswers(req, async (qref) => {
        const raw = await ctx.deps.store.doc(`q:${qref}`);
        if (raw === undefined) return undefined;
        const k = LlAnswerKey.safeParse(raw);
        if (!k.success || k.data.qref !== qref) {
          throw new HttpProblem({
            type: "content-mismatch",
            title: "Answer key does not match the question",
            status: 422,
            detail: qref,
            code: "CONTENT_MISMATCH",
          });
        }
        return k.data;
      }),
  }),
  "/learn/state": postRoute({
    request: LearnStateRequest,
    response: LearnStateResponse,
    contract: "Request does not match the /learn/state contract",
    handle: (req) => learnState(req),
  }),
  "/gamification/evaluate": postRoute({
    request: EvaluateRequest,
    response: EvaluateResponse,
    contract: "Request does not match the /gamification/evaluate contract",
    handle: (req) => evaluateGamification(req),
  }),
};
