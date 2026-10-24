import type { Bank, BankItem, PracticeKey } from "@/features/learn/content/bank-types";
import { byConcept, seeded } from "@/features/learn/variants";

/**
 * Lite learning (FRONTEND §9, EC-19): the question set for an HTML-form quiz and its scoring.
 * Server-side and pure. Lite uses PRACTICE items only, so the same set can be scored on the server
 * (the form posts) or on the phone when offline (a tiny inline script with the practice key for the
 * questions on the page); either way the result counts for practice only.
 */

const TOPICS = ["LL1", "LL2", "LL3", "LL4"] as const;

/** A deterministic set: `count` concepts spread over LL1–LL4, one practice variant each. */
export function liteSet(bank: Bank, key: PracticeKey, count: number, seed: string): BankItem[] {
  const rnd = seeded(seed);
  const practice = bank.items.filter((i) => i.pool === "practice" && key[i.id]);
  const concepts = byConcept(practice);
  const lists = TOPICS.map((t) => {
    const ids = [...concepts.keys()].filter((c) => c.startsWith(`C-${t}-`)).sort();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    }
    return ids;
  });
  const out: BankItem[] = [];
  for (let round = 0; out.length < count && round < 100; round++) {
    let added = false;
    for (const list of lists) {
      if (out.length >= count) break;
      const c = list[round];
      const variants = c ? concepts.get(c) : undefined;
      const v = variants?.[Math.floor(rnd() * variants.length)];
      if (v) {
        out.push(v);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export interface LiteAnswer {
  itemId: string;
  optionId: string | null;
  confidence: "50" | "75" | "100" | null;
}

export interface LiteScore {
  right: number;
  total: number;
  wrong: { itemId: string; optionId: string | null }[];
  sureAndWrong: number;
}

export function scoreLite(answers: readonly LiteAnswer[], key: PracticeKey): LiteScore {
  let right = 0;
  let sureAndWrong = 0;
  const wrong: LiteScore["wrong"] = [];
  for (const a of answers) {
    const ok = a.optionId !== null && key[a.itemId]?.correct === a.optionId;
    if (ok) right++;
    else {
      wrong.push({ itemId: a.itemId, optionId: a.optionId });
      if (a.confidence === "100") sureAndWrong++;
    }
  }
  return { right, total: answers.length, wrong, sureAndWrong };
}

/** `C-LL1-001:v1=a~100,C-LL2-004:v2=c~50,…` (compact, no personal data) ⇄ answers. */
export function encodeAnswers(answers: readonly LiteAnswer[]): string {
  return answers
    .map((a) => `${a.itemId}=${a.optionId ?? "-"}${a.confidence ? `~${a.confidence}` : ""}`)
    .join(",");
}

const ITEM_RE = /^C-LL[1-4]-\d{3}:v\d{1,2}$/;

export function decodeAnswers(raw: string): LiteAnswer[] {
  const out: LiteAnswer[] = [];
  for (const part of raw.split(",").slice(0, 40)) {
    const [itemId, rest] = part.split("=");
    if (!itemId || !ITEM_RE.test(itemId)) continue;
    const [opt, conf] = (rest ?? "-").split("~");
    out.push({
      itemId,
      optionId: opt && /^[a-f]$/.test(opt) ? opt : null,
      confidence: conf === "50" || conf === "75" || conf === "100" ? conf : null,
    });
  }
  return out;
}
