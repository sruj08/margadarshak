// G10 LL Test Simulator scoring (GAME_DESIGN §11.7, DEBRIEF_SPEC §2.10).
// Mock: passed iff correct ≥ the rule pack's pass count (`LLT-<state>`); timeouts count as wrong;
// pct = correct / total × 100. Practice: no pass rule; every answer becomes FSRS evidence and the
// session gets a Brier calibration. The answer key is server-only content.
import { runIntegrityChecks } from "../integrity/checks.ts";
import { brier, overconfidence, type RatedAnswer } from "../learning/calibration.ts";
import { collapseEvidence, ratingFromEvidence } from "../learning/rating.ts";
import type { LlAnswerKey, LlSimContent } from "../schema/content.ts";
import type { EventOf, GameEvent } from "../schema/events.ts";
import type { SignFamily } from "../schema/ids.ts";
import type { SessionContext } from "../schema/manifest.ts";
import type {
  ConfidenceTag,
  Evidence,
  Finding,
  ScoreComponent,
  SessionResult,
} from "../schema/result.ts";
import { round1, roundTo } from "../sim/quantise.ts";
import {
  buildResult,
  component,
  finding,
  itemEndReason,
  pad2,
  requireAligned,
  type ScoreOptions,
} from "./common.ts";
import { GAME_CONFIG } from "./config.ts";

const C = GAME_CONFIG.llSim;

interface QuestionResult {
  item: number;
  key: LlAnswerKey;
  answered: boolean;
  correct: boolean;
  timeout: boolean;
  latencyMs: number | null;
  confidence: ConfidenceTag | null;
}

const toTag = (p: 50 | 75 | 100): ConfidenceTag => (p === 50 ? "50" : p === 75 ? "75" : "100");

export function scoreLlSim(
  ctx: SessionContext,
  events: readonly GameEvent[],
  content: LlSimContent,
  opts: ScoreOptions,
): SessionResult {
  requireAligned(ctx, content.questions.length, "ll_sim");
  const integrity = runIntegrityChecks(ctx, events, {
    maxEvents: opts.maxEvents ?? GAME_CONFIG.budgets.ll_sim.maxEvents,
    defaultTimingMode: "none",
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
  });
  const mock = ctx.mode === "mock";
  const timerMs =
    content.format.per_q_timer_s === null ? null : content.format.per_q_timer_s * 1000;

  const results: QuestionResult[] = [];
  content.questions.forEach((key, item) => {
    const voided = integrity.voidedItems.has(item);
    // Practice excludes a voided question; a mock counts it as wrong, like a real test.
    if (voided && !mock) return;
    const own = events.filter((e) => e.item === item);
    // The first committed answer counts; an answer for another question variant is ignored.
    const ans = own.find(
      (e): e is EventOf<"answer"> => e.type === "answer" && e.p.qref === key.qref,
    );
    const conf = own.find(
      (e): e is EventOf<"confidence"> =>
        e.type === "confidence" && "p" in e.p && (e.p.qref ?? key.qref) === key.qref,
    );
    const latencyMs = ans?.p.latencyMs ?? null;
    const timedOut =
      itemEndReason(events, item) === "timeout" && ans === undefined
        ? true
        : timerMs !== null && latencyMs !== null && latencyMs > timerMs;
    const answered = ans !== undefined && !timedOut && !voided;
    results.push({
      item,
      key,
      answered,
      correct: answered && ans?.p.optionId === key.correctOptionId,
      timeout: timedOut,
      latencyMs,
      confidence: conf !== undefined && "p" in conf.p ? toTag(conf.p.p) : null,
    });
  });

  const total = mock ? content.questions.length : results.length;
  const correct = results.filter((r) => r.correct).length;
  const components: ScoreComponent[] = results.map((r) =>
    component(`q${pad2(r.item + 1)}`, r.correct ? 1 : 0, 1, "ll.question"),
  );

  // Evidence: every answered or timed-out question (an unanswered quit carries no signal).
  const evidence: Evidence[] = collapseEvidence(
    results
      .filter((r) => r.answered || r.timeout)
      .map((r) => {
        const rating = ratingFromEvidence({
          correct: r.correct,
          ...(r.confidence === null ? {} : { confidence: r.confidence }),
          ...(r.latencyMs === null ? {} : { latencyMs: r.latencyMs }),
          ...(timerMs === null ? {} : { timerMs }),
        });
        const ev: Evidence = {
          cardId: r.key.cardId,
          correct: r.correct,
          rating: rating.rating,
          overconfident: rating.overconfident,
        };
        if (r.latencyMs !== null) ev.latencyMs = r.latencyMs;
        if (r.confidence !== null) ev.confidence = r.confidence;
        return ev;
      }),
  );

  const rated: RatedAnswer[] = results
    .filter(
      (r): r is QuestionResult & { confidence: ConfidenceTag } =>
        r.confidence !== null && (r.answered || r.timeout),
    )
    .map((r) => ({ confidence: r.confidence, correct: r.correct }));
  const b = brier(rated);
  const oc = overconfidence(rated);
  const calibration =
    rated.length === 0
      ? null
      : { n: rated.length, brier: roundTo(b ?? 0, 4), overconfidence: roundTo(oc ?? 0, 4) };

  const ruleRef = content.format.rule_id;
  const fromPack = content.format.known;
  return buildResult(ctx, opts, {
    components,
    max: total,
    passed: mock ? correct >= content.format.pass : null,
    passRule: mock ? { source: fromPack ? "rule_pack" : "design", ref: ruleRef } : null,
    capApplied: null,
    findings: llFindings({ content, results, rated, brier: b, oc, mock, correct, total }),
    evidence,
    calibration,
    integrity,
  });
}

/** Shared inputs of the LL detectors (DEBRIEF_SPEC §2.10); each returns 0 or 1 finding. */
interface LlFindingCtx {
  content: LlSimContent;
  results: readonly QuestionResult[];
  rated: readonly RatedAnswer[];
  brier: number | null;
  oc: number | null;
  mock: boolean;
  correct: number;
  total: number;
}

type LlDetector = (f: LlFindingCtx) => Finding | null;

const counted = (r: QuestionResult): boolean => r.answered || r.timeout;

/** LL_OVERCONFIDENT: ≥ 3 wrong at 100%, or overconfidence > 0.15 over ≥ 5 rated answers. */
const llOverconfident: LlDetector = (f) => {
  const wrongAt100 = f.rated.filter((r) => r.confidence === "100" && !r.correct).length;
  const ocHigh =
    f.oc !== null && f.rated.length >= C.overconfidenceMinN && f.oc > C.overconfidenceMax;
  if (wrongAt100 < C.overconfidentWrongAt100 && !ocHigh) return null;
  return finding({
    findingId: "LL_OVERCONFIDENT",
    severity: Math.min(1, 0.4 + 0.1 * wrongAt100),
    skillId: "calibration",
    drillIds: ["DR-LL-CALIB"],
    facts: {
      wrong_at_100: wrongAt100,
      brier: f.brier === null ? undefined : roundTo(f.brier, 3),
      overconfidence: f.oc === null ? undefined : roundTo(f.oc, 3),
    },
  });
};

/**
 * LL_WEAK_TOPIC: in-session accuracy per topic stands in for FSRS mastery M_t (the debrief layer
 * swaps in real mastery when it has the review history).
 */
const llWeakTopic: LlDetector = (f) => {
  const topics = [...new Set(f.results.map((r) => r.key.topic))].sort();
  const weak = topics
    .map((topic) => {
      const xs = f.results.filter((r) => r.key.topic === topic && counted(r));
      const acc = xs.length === 0 ? 1 : xs.filter((r) => r.correct).length / xs.length;
      return { topic, n: xs.length, acc };
    })
    .filter((t) => t.n >= C.weakTopicMinAnswers && t.acc < C.weakTopicAccuracy)
    .sort((x, y) => x.acc - y.acc || (x.topic < y.topic ? -1 : 1))[0];
  if (weak === undefined) return null;
  return finding({
    findingId: "LL_WEAK_TOPIC",
    severity: 1 - weak.acc,
    skillId: `SK-${weak.topic}`,
    drillIds: [weak.topic === "LL0" ? "DR-LL-MOCK" : `DR-LL-TOPIC-${weak.topic}`],
    facts: { topic: weak.topic, mastery_pct: round1(100 * weak.acc) },
  });
};

/** LL_SIGN_FAMILY_CONFUSION: ≥ 2 wrong in the same sign family. */
const llSignFamily: LlDetector = (f) => {
  const byFamily = new Map<SignFamily, QuestionResult[]>();
  for (const r of f.results.filter((x) => x.key.signFamily !== null && !x.correct && counted(x))) {
    const fam = r.key.signFamily as SignFamily;
    byFamily.set(fam, [...(byFamily.get(fam) ?? []), r]);
  }
  const top = [...byFamily.entries()]
    .filter(([, xs]) => xs.length >= C.signFamilyMinWrong)
    .sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1))[0];
  if (top === undefined) return null;
  const [family, xs] = top;
  const signIds = [...new Set(xs.map((r) => r.key.signId).filter((s): s is string => s !== null))]
    .sort()
    .slice(0, 8);
  return finding({
    findingId: "LL_SIGN_FAMILY_CONFUSION",
    severity: Math.min(1, 0.3 + 0.15 * xs.length),
    skillId: "SK-LL1",
    ruleIds: signIds,
    drillIds: [`DR-LL-SIGNS-${family}`],
    facts: { sign_family: family, wrong: xs.length },
  });
};

/** LL_TIMEOUTS: ≥ 2 timeouts. */
const llTimeouts: LlDetector = (f) => {
  const timeouts = f.results.filter((r) => r.timeout).length;
  if (timeouts < C.timeoutsMin) return null;
  return finding({
    findingId: "LL_TIMEOUTS",
    severity: Math.min(1, 0.2 * timeouts),
    skillId: "SK-LL0",
    ruleIds: [f.content.format.rule_id],
    drillIds: ["DR-LL-MOCK"],
    facts: { timeouts, per_q_timer_s: f.content.format.per_q_timer_s ?? undefined },
  });
};

/** LL_MOCK_BELOW_PASS: a mock below the format's pass count. */
const llBelowPass: LlDetector = (f) => {
  const fmt = f.content.format;
  if (!f.mock || f.correct >= fmt.pass) return null;
  return finding({
    findingId: "LL_MOCK_BELOW_PASS",
    severity: 0.6,
    skillId: "SK-LL0",
    ruleIds: [fmt.rule_id],
    drillIds: ["DR-LL-MOCK"],
    facts: {
      correct: f.correct,
      total: f.total,
      pass_mark: fmt.pass,
      format_source: fmt.known ? "rule_pack_verified" : "default_assumption",
    },
  });
};

/** LL_UNDERCONFIDENT (positive framing): accuracy at 50% confidence ≥ 0.85 over ≥ 10 answers. */
const llUnderconfident: LlDetector = (f) => {
  const at50 = f.rated.filter((r) => r.confidence === "50");
  if (at50.length < C.underconfidentMinN) return null;
  const acc = at50.filter((r) => r.correct).length / at50.length;
  if (acc < C.underconfidentAccuracy) return null;
  return finding({
    findingId: "LL_UNDERCONFIDENT",
    severity: 0.2,
    skillId: "calibration",
    drillIds: ["DR-LL-CALIB"],
    facts: { accuracy_pct_50: round1(100 * acc) },
  });
};

const LL_DETECTORS: readonly LlDetector[] = [
  llOverconfident,
  llWeakTopic,
  llSignFamily,
  llTimeouts,
  llBelowPass,
  llUnderconfident,
];

function llFindings(f: LlFindingCtx): Finding[] {
  return LL_DETECTORS.map((d) => d(f)).filter((x): x is Finding => x !== null);
}
