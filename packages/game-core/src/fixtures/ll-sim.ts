// LL Test Simulator golden vectors on the J&K format (10 questions, 6 to pass, as reported) and the
// default assumption (15 questions, 60%) for a tenant without a format row.
import type { LlAnswerKey, LlExamFormat, LlSimContent } from "../schema/content.ts";
import type { GameMode, LlTopic, SignFamily } from "../schema/ids.ts";
import { defaultLlFormat } from "../scoring/content.ts";
import { ctxFor, StreamBuilder, type VectorInput, vector } from "./builders.ts";

export const LLT_JK: LlExamFormat = {
  rule_id: "LLT-JK",
  state: "JK",
  known: true,
  questions: 10,
  pass: 6,
  per_q_timer_s: 30,
  total_timer_s: null,
  source_url:
    "https://kashmirlife.net/rto-kashmir-rolls-out-new-s-track-driving-test-for-licences-415456/",
  verified_on: "2026-10-22",
  confidence: "medium",
};

function key(n: number, topic: LlTopic, family: SignFamily | null): LlAnswerKey {
  const id = `C-${topic}-${String(n).padStart(3, "0")}`;
  return {
    qref: `${id}:v1`,
    cardId: id,
    correctOptionId: "b",
    topic,
    signFamily: family,
    signId: family === null ? null : `SIGN-${family.slice(0, 3)}-${String(n).padStart(3, "0")}`,
  };
}

/** Ten answer keys across LL1–LL4; questions 1–4 are signs. */
export const LL_KEYS: readonly LlAnswerKey[] = [
  key(1, "LL1", "CAUTIONARY"),
  key(2, "LL1", "CAUTIONARY"),
  key(3, "LL1", "MANDATORY"),
  key(4, "LL1", "CAUTIONARY"),
  key(5, "LL2", null),
  key(6, "LL2", null),
  key(7, "LL3", null),
  key(8, "LL3", null),
  key(9, "LL4", null),
  key(10, "LL4", null),
];

/** One question's play: "c" correct, "w" wrong, "t" timeout, "h" hidden tab, "x" never answered. */
type Outcome = "c" | "w" | "t" | "h" | "x";

interface Play {
  outcomes: Outcome[];
  confidence?: (50 | 75 | 100 | null)[];
  latencyMs?: number[];
}

const END_REASON: Record<Outcome, "done" | "voided" | "timeout"> = {
  c: "done",
  w: "done",
  x: "done",
  h: "voided",
  t: "timeout",
};

/** Pushes one question's events starting at t; returns the next question's start time. */
function playQuestion(
  s: StreamBuilder,
  k: LlAnswerKey,
  item: number,
  t: number,
  play: Play,
  mode: GameMode,
): number {
  const ref = `q:${k.qref}`;
  const o = play.outcomes[item] ?? "x";
  const lat = play.latencyMs?.[item] ?? 9000;
  const conf = play.confidence?.[item] ?? null;
  s.push("item_start", { ref }, { t, item });
  if (conf !== null && mode !== "mock") {
    s.push("confidence", { qref: k.qref, p: conf }, { t: t + lat - 1500, item });
  }
  if (o === "c" || o === "w") {
    const optionId = o === "c" ? "b" : "a";
    s.push("answer", { qref: k.qref, optionId, latencyMs: lat }, { t: t + lat, item });
  }
  if (o === "h") s.push("visibility_hidden", {}, { t: t + 4000, item });
  const end = o === "t" ? t + 30000 : t + lat + 500;
  s.push("item_end", { ref, reason: END_REASON[o] }, { t: end, item });
  return end + 1000;
}

function session(
  n: number,
  mode: GameMode,
  seed: number,
  tenant: string,
  format: LlExamFormat | null,
  play: Play,
) {
  const ctx = ctxFor({
    n,
    gameId: "ll_sim",
    mode,
    seed,
    tenant,
    items: LL_KEYS.map((k) => ({ ref: `q:${k.qref}`, contentVersion: "1" })),
  });
  const s = new StreamBuilder(ctx.sid);
  s.push(
    "session_start",
    { deviceClass: "low", timingMode: "none", a11yModes: ["large_text"], orientation: "portrait" },
    { t: 0 },
  );
  let t = 1000;
  LL_KEYS.forEach((k, item) => {
    t = playQuestion(s, k, item, t, play, mode);
  });
  s.push("session_end", { reason: "completed" }, { t });
  const content: LlSimContent = {
    gameId: "ll_sim",
    format: format ?? defaultLlFormat(),
    questions: [...LL_KEYS],
  };
  return { ctx, events: s.build(), content };
}

const lat = (ms: number): number[] => Array.from({ length: 10 }, () => ms);

export function llSimVectors(): VectorInput[] {
  return [
    vector({
      name: "ll-mock-strong",
      description: "J&K mock: 9/10 correct, passed (rule-pack pass mark 6)",
      tags: ["strong"],
      ...session(601, "mock", 11, "JK", LLT_JK, {
        outcomes: ["c", "c", "c", "c", "c", "c", "w", "c", "c", "c"],
      }),
    }),
    vector({
      name: "ll-mock-pass-mark",
      description: "J&K mock: exactly 6/10, passes on the mark",
      tags: ["medium", "edge"],
      ...session(602, "mock", 12, "JK", LLT_JK, {
        outcomes: ["c", "w", "c", "w", "c", "c", "w", "c", "w", "c"],
      }),
    }),
    vector({
      name: "ll-mock-weak",
      description:
        "J&K mock: 4/10 with 2 timeouts and 3 cautionary signs wrong: below the pass mark",
      tags: ["weak"],
      ...session(603, "mock", 13, "JK", LLT_JK, {
        outcomes: ["w", "w", "c", "w", "t", "c", "t", "c", "w", "c"],
      }),
    }),
    vector({
      name: "ll-practice-overconfident",
      description: "Practice: wrong at 100% three times; evidence ratings and Brier calibration",
      tags: ["critical"],
      ...session(604, "practice", 14, "JK", LLT_JK, {
        outcomes: ["w", "c", "w", "c", "w", "c", "c", "w", "c", "c"],
        confidence: [100, 100, 100, 75, 100, 50, 75, 50, 100, 100],
        latencyMs: [6000, 6000, 7000, 8000, 5000, 26000, 9000, 9000, 4000, 25000],
      }),
    }),
    vector({
      name: "ll-mock-default-format",
      description:
        "Tenant without an LLT row: default assumption (15 q / 9 to pass, design source); a hidden question counts as wrong",
      tags: ["edge", "voided"],
      ...session(605, "mock", 15, "PB", null, {
        outcomes: ["c", "c", "c", "c", "h", "c", "c", "c", "c", "c"],
      }),
    }),
    vector({
      name: "ll-practice-slow",
      description:
        "Practice: correct but slow (> 80% of the 30 s timer) is Hard; one answer arrives after the timer (timeout)",
      tags: ["edge"],
      ...session(606, "practice", 16, "JK", LLT_JK, {
        outcomes: ["c", "c", "c", "c", "c", "c", "c", "c", "c", "c"],
        confidence: [75, 75, 75, 75, 75, 75, 75, 75, 75, 75],
        latencyMs: [25000, 31000, ...lat(8000).slice(2)],
      }),
    }),
  ];
}
