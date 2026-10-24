import type { LlFormat } from "@/features/learn/api-types";
import type { BankItem, LlTopicId, PracticeKey } from "@/features/learn/content/bank-types";
import { byConcept, pickVariant, seeded } from "@/features/learn/variants";

/**
 * Item selection and device content for the LL simulator (GAME_DESIGN §11.3–§11.4). Pure.
 *
 *  - The question count and pass mark come from the state's rule-pack format (J&K: 10 / 6), or the
 *    documented default (15 / 9) when the format is unknown.
 *  - Concepts are spread evenly over LL1–LL4 (equal weights: the government's topic mix isn't
 *    published), seeded per session; each concept shows the variant that avoids the last 2 surface
 *    forms the learner saw.
 *  - On the device only PRACTICE items are used, because their keys are client-safe: the score is a
 *    provisional preview and counts for practice only. A real mock (mock-pool items) is dealt and
 *    scored by the server (API-34/35); mock keys never reach the phone.
 */

export const DEFAULT_QUESTIONS = 15;
export const DEFAULT_PASS = 9;

export function examSize(f: Pick<LlFormat, "questions" | "pass_correct">): {
  questions: number;
  pass: number;
} {
  const questions = f.questions && f.questions > 0 ? f.questions : DEFAULT_QUESTIONS;
  const pass = f.pass_correct && f.pass_correct > 0 ? f.pass_correct : DEFAULT_PASS;
  return { questions, pass: Math.min(pass, questions) };
}

const TOPICS: LlTopicId[] = ["LL1", "LL2", "LL3", "LL4"];

export function pickExamItems(
  practice: readonly BankItem[],
  count: number,
  seen: Readonly<Record<string, readonly string[]>>,
  seed: string,
): BankItem[] {
  const rnd = seeded(seed);
  const concepts = byConcept(practice);
  const perTopic = new Map<LlTopicId, string[]>();
  for (const t of TOPICS) {
    const ids = [...concepts.keys()].filter((c) => concepts.get(c)?.[0]?.topic === t).sort();
    // Seeded Fisher–Yates so each session deals a different mix.
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const a = ids[i];
      const b = ids[j];
      if (a !== undefined && b !== undefined) {
        ids[i] = b;
        ids[j] = a;
      }
    }
    perTopic.set(t, ids);
  }
  const out: BankItem[] = [];
  let round = 0;
  while (out.length < count && round < 200) {
    let added = false;
    for (const t of TOPICS) {
      if (out.length >= count) break;
      const concept = perTopic.get(t)?.[round];
      if (!concept) continue;
      const v = pickVariant(concepts.get(concept) ?? [], seen[concept] ?? [], seed);
      if (v) {
        out.push(v);
        added = true;
      }
    }
    if (!added) break;
    round++;
  }
  return out;
}

/** game-core `LlExamFormat` row for the scorer (`LLT-<state>`). */
export function examFormat(f: LlFormat) {
  const { questions, pass } = examSize(f);
  return {
    rule_id: `LLT-${f.state}`,
    state: f.state,
    known: f.known,
    questions,
    pass,
    per_q_timer_s: f.per_question_timer_s,
    total_timer_s: f.total_timer_s,
    source_url: f.provenance.source_url,
    verified_on: f.provenance.verified_on,
    confidence: f.provenance.confidence,
  };
}

/** The client-safe document a question carries into the game (`items[].public`). */
export type ExamPublic = BankItem & { timer_s: number | null };

/**
 * Device session content for the game host (`GameStage.deviceItems`): refs `q:<itemId>`, answer
 * key documents built from the practice key, the format row filed as `LLT-<state>`, the public
 * question documents, and the state as the session tenant, so the device scorer applies the chosen
 * state's pass rule.
 */
export function examDeviceItems(items: readonly BankItem[], key: PracticeKey, format: LlFormat) {
  const row = examFormat(format);
  const docs: Record<string, unknown> = {};
  const publicDocs: Record<string, Record<string, unknown>> = {};
  for (const it of items) {
    const k = key[it.id];
    const correct = it.options.find((o) => o.id === k?.correct);
    const sign = correct?.visual ?? it.visuals.find((v) => v.kind === "sign") ?? null;
    docs[`q:${it.id}`] = {
      qref: it.id,
      cardId: it.concept,
      correctOptionId: k?.correct ?? "",
      topic: it.topic,
      signFamily: sign?.kind === "sign" ? sign.family : null,
      signId: sign?.kind === "sign" ? sign.id : null,
    };
    const pub: ExamPublic = { ...it, timer_s: format.per_question_timer_s };
    publicDocs[`q:${it.id}`] = pub as unknown as Record<string, unknown>;
  }
  return {
    items: items.map((it) => ({ ref: `q:${it.id}`, contentVersion: "1" })),
    docs,
    formats: { [`LLT-${format.state}`]: row },
    publicDocs,
    tenant: format.state,
  };
}

/**
 * Question documents for the items a server session deals (API-34 sends no `public` documents):
 * `q:<itemId>` resolves to the locale bank's client copy of that question (practice or mock pool;
 * never a key), so the game shows the same question the server will score.
 */
export function examPublicDoc(
  bank: readonly BankItem[],
  format: Pick<LlFormat, "per_question_timer_s">,
): (ref: string) => Record<string, unknown> | undefined {
  const byId = new Map(bank.map((it) => [it.id, it] as const));
  return (ref) => {
    if (!ref.startsWith("q:")) return undefined;
    const it = byId.get(ref.slice(2));
    if (!it) return undefined;
    const pub: ExamPublic = { ...it, timer_s: format.per_question_timer_s };
    return pub as unknown as Record<string, unknown>;
  };
}
