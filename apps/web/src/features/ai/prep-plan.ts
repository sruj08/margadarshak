import type { LlTopicId } from "@/features/learn/content/bank-types";

/**
 * The prep buddy's device plan: next steps computed in code from this phone's own practice (LL
 * answers, mock tests, Nazar sessions). It changes after every session, so it adapts to the latest
 * results. The server's coach plan (API-76) replaces it when the API answers.
 */

const DAY = 86_400_000;
const TOPICS: readonly LlTopicId[] = ["LL1", "LL2", "LL3", "LL4"];
/** Below this share right in a topic's recent answers, review it. */
const WEAK = 0.7;
/** How many recent answers per topic count. */
const RECENT = 20;
const MAX_RECS = 4;

export interface PrepInput {
  answers: readonly { topic: LlTopicId; correct: boolean; at: number }[];
  mocks: readonly { at: number; passed: boolean }[];
  nazarAt: readonly number[];
  now: number;
}

export type PrepRec =
  | { kind: "review"; href: string; topic: LlTopicId; pct: number }
  | { kind: "start"; href: string; topic: LlTopicId }
  | { kind: "mock" | "mockAgain" | "mockKeep" | "nazar" | "strong"; href: string };

export interface PrepPlan {
  /** Distinct days with any practice in the last 7 days. */
  activeDays: number;
  recs: PrepRec[];
}

/** "C-LL1-001" → "LL1". */
export function topicOfCard(cardId: string): LlTopicId | null {
  const m = /^C-(LL[1-4])-/.exec(cardId);
  return m ? (m[1] as LlTopicId) : null;
}

export function buildPrepPlan({ answers, mocks, nazarAt, now }: PrepInput): PrepPlan {
  const weekAgo = now - 7 * DAY;
  const days = new Set<string>();
  const day = (t: number) => new Date(t).toDateString();
  for (const a of answers) if (a.at >= weekAgo) days.add(day(a.at));
  for (const m of mocks) if (m.at >= weekAgo) days.add(day(m.at));
  for (const t of nazarAt) if (t >= weekAgo) days.add(day(t));

  const review: Extract<PrepRec, { kind: "review" }>[] = [];
  const start: PrepRec[] = [];
  for (const topic of TOPICS) {
    const recent = answers
      .filter((a) => a.topic === topic)
      .sort((a, b) => b.at - a.at)
      .slice(0, RECENT);
    const href = `/learn/review?topic=${topic}`;
    if (recent.length === 0) start.push({ kind: "start", href, topic });
    else {
      const share = recent.filter((a) => a.correct).length / recent.length;
      if (share < WEAK) review.push({ kind: "review", href, topic, pct: Math.round(share * 100) });
    }
  }
  review.sort((a, b) => a.pct - b.pct);

  const recs: PrepRec[] = [...review, ...start];
  const mockHref = "/learn/practise/ll-sim";
  const last = [...mocks].sort((a, b) => b.at - a.at)[0];
  if (!last || last.at < weekAgo) recs.push({ kind: "mock", href: mockHref });
  else if (!last.passed) recs.push({ kind: "mockAgain", href: mockHref });
  if (!nazarAt.some((t) => t >= weekAgo))
    recs.push({ kind: "nazar", href: "/learn/practise/nazar" });
  if (recs.length === 0) recs.push({ kind: "strong", href: mockHref });
  return { activeDays: days.size, recs: recs.slice(0, MAX_RECS) };
}
