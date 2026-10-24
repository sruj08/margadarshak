/**
 * The LL question bank as the browser sees it (one locale at a time). Built on the server from
 * `@content/generated/ll-bank.client.json` (no keys) and `ll-bank.practice-key.json` (keys for
 * practice items only) by ./bank-build.ts, and served as JSON by the learn data routes so it never
 * enters a JS chunk. Mock-pool answer keys are never on the client (CURRICULUM §2, GAME_DESIGN §11.10).
 */

export type LlTopicId = "LL1" | "LL2" | "LL3" | "LL4";
export type ItemPool = "practice" | "mock";

/** A sign or illustration drawn on the question. The alt text describes shape and symbol only. */
export interface BankVisual {
  id: string;
  kind: "sign" | "illustration";
  /** Sign shape (octagon, circle, triangle, …) or "picture" for an illustration. */
  shape: string;
  scheme: string;
  family: string | null;
  alt: string;
}

export interface BankOption {
  id: string;
  text: string;
  /** For "which sign means …" questions, the sign drawn on the option. */
  visual: BankVisual | null;
}

export interface BankItem {
  /** Variant ID, e.g. "C-LL1-001:v1" (a surface form of the concept). */
  id: string;
  /** Concept = FSRS card ID, e.g. "C-LL1-001". */
  concept: string;
  topic: LlTopicId;
  /** Surface form (sign_to_meaning, scenario, …). */
  form: string;
  pool: ItemPool;
  stem: string;
  visuals: BankVisual[];
  options: BankOption[];
}

export interface Bank {
  locale: string;
  items: BankItem[];
  /** Concepts per LL topic (|concepts in t| for mastery coverage). */
  conceptCounts: Record<LlTopicId, number>;
}

export interface PracticeKeyEntry {
  correct: string;
  explanation: string | null;
  ruleIds: string[];
}

/** Item ID → key. Practice items only. */
export type PracticeKey = Record<string, PracticeKeyEntry>;

export const LL_TOPIC_IDS: readonly LlTopicId[] = ["LL1", "LL2", "LL3", "LL4"];

export function isLlTopic(v: string): v is LlTopicId {
  return v === "LL1" || v === "LL2" || v === "LL3" || v === "LL4";
}
