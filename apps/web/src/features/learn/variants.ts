import type { BankItem, BankOption } from "./content/bank-types";

/**
 * Variant choice (GAME_DESIGN §11.4, CURRICULUM §2.1): every concept has 3–6 surface forms, and a
 * practice card shows the one that avoids the last 2 surface forms the learner saw for that concept,
 * so memorising one wording fails. Pure and seeded: the same inputs give the same pick.
 */

export const AVOID_LAST = 2;
/** How many recent variants are remembered per concept. */
export const SEEN_MEMORY = 5;

/** mulberry32 over a 32-bit FNV-1a hash of the seed string. */
export function seeded(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks the variant of `concept` to show. `seen` is the concept's history, oldest first. Variants
 * outside the last 2 seen are preferred; if every variant is that recent (a concept with ≤ 2
 * variants in the pool), the least recently seen one is used.
 */
export function pickVariant(
  variants: readonly BankItem[],
  seen: readonly string[],
  seed: string,
): BankItem | null {
  if (variants.length === 0) return null;
  const recent = new Set(seen.slice(-AVOID_LAST));
  const fresh = variants.filter((v) => !recent.has(v.id));
  if (fresh.length > 0) {
    const never = fresh.filter((v) => !seen.includes(v.id));
    const pool = never.length > 0 ? never : fresh;
    const rnd = seeded(`${seed}:${variants[0]?.concept ?? ""}`);
    return pool[Math.floor(rnd() * pool.length)] ?? pool[0] ?? null;
  }
  // Every variant is among the last 2: take the one seen longest ago.
  let best: BankItem | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const v of variants) {
    const at = seen.lastIndexOf(v.id);
    if (at < bestAt) {
      bestAt = at;
      best = v;
    }
  }
  return best;
}

/** Records a shown variant in the concept's history (kept to the last 5). */
export function rememberVariant(seen: readonly string[], itemId: string): string[] {
  return [...seen.filter((s) => s !== itemId), itemId].slice(-SEEN_MEMORY);
}

/** Option order shuffled per variant from the session seed (UI_SPEC §2.5). */
export function shuffledOptions(item: BankItem, seed: string): BankOption[] {
  const out = [...item.options];
  // True/false keeps its natural order.
  if (item.form === "true_false") return out;
  const rnd = seeded(`${seed}:${item.id}`);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a && b) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/** Variants of each concept in a pool, keyed by concept. */
export function byConcept(items: readonly BankItem[]): Map<string, BankItem[]> {
  const m = new Map<string, BankItem[]>();
  for (const it of items) {
    const list = m.get(it.concept) ?? [];
    list.push(it);
    m.set(it.concept, list);
  }
  return m;
}
