import { describe, expect, it } from "vitest";
import { buildBank, buildPracticeKey } from "./content/bank-build";
import { cardsFromLog, deviceQueue, deviceReadiness } from "./learning";
import { type LogEntry, memoryReviewStore, sortLog } from "./offline/review-store";
import { batchKey } from "./offline/sync";
import { AVOID_LAST, pickVariant, rememberVariant } from "./variants";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 4, 30);

function entry(i: number, cardId: string, rating: 1 | 2 | 3 | 4, at: number): LogEntry {
  return {
    id: `ans-${i}`,
    cardId,
    itemId: `${cardId}:v1`,
    optionId: "a",
    rating,
    reviewedAt: at,
    correct: rating > 1,
    overconfident: false,
    confidence: rating === 4 ? "100" : "75",
    sourceSid: `sid-${Math.floor(i / 3)}`,
    mode: "review",
    wasDue: true,
  };
}

const LOG: LogEntry[] = [
  entry(0, "C-LL1-001", 3, T0),
  entry(1, "C-LL1-002", 1, T0 + 1000),
  entry(2, "C-LL2-001", 4, T0 + 2000),
  entry(3, "C-LL1-001", 4, T0 + 3 * DAY),
  entry(4, "C-LL1-002", 3, T0 + 3 * DAY + 10),
  entry(5, "C-LL1-001", 2, T0 + 9 * DAY),
];

describe("on-device review log (FSRS, GAMIFICATION_ENGINE §4.2)", () => {
  it("replays deterministically: the same log gives byte-identical card states", () => {
    const a = JSON.stringify(cardsFromLog(LOG));
    const b = JSON.stringify(cardsFromLog(LOG.map((e) => ({ ...e }))));
    expect(a).toBe(b);
  });

  it("replay does not depend on the order entries were stored in", () => {
    const shuffled = [LOG[4], LOG[0], LOG[5], LOG[2], LOG[1], LOG[3]] as LogEntry[];
    expect(JSON.stringify(cardsFromLog(sortLog(shuffled)))).toBe(JSON.stringify(cardsFromLog(LOG)));
  });

  it("the store keeps the first write of an answer: replaying an outbox never doubles a review", async () => {
    const store = memoryReviewStore();
    const sub = {
      client_answer_id: "ans-0",
      card_id: "C-LL1-001",
      question_id: "C-LL1-001",
      variant_id: "v1",
      option_id: "a",
      answered_at: new Date(T0).toISOString(),
      mode: "review" as const,
    };
    await store.append(LOG, [sub]);
    await store.append(LOG, [sub]);
    expect((await store.log()).length).toBe(LOG.length);
    expect((await store.outbox()).length).toBe(1);
    expect(JSON.stringify(cardsFromLog(await store.log()))).toBe(JSON.stringify(cardsFromLog(LOG)));
  });

  it("an outbox batch always carries the same Idempotency-Key", () => {
    expect(batchKey(["b", "a", "c"])).toBe(batchKey(["c", "b", "a"]));
    expect(batchKey(["a"])).not.toBe(batchKey(["a", "b"]));
    // The API refuses an Idempotency-Key shorter than 16 characters: the hash is always 8 digits.
    for (let i = 0; i < 2000; i++) expect(batchKey([`id-${i}`]).length).toBeGreaterThanOrEqual(16);
  });

  it("a new learner's queue starts with signs (8 new cards a day at most)", () => {
    const bank = buildBank("en");
    const q = deviceQueue([], T0, bank.items);
    expect(q.length).toBe(8);
    expect(q.every((i) => i.topic_id === "LL1")).toBe(true);
  });

  it("device readiness is API-33-shaped, with book-anyway always true", () => {
    const bank = buildBank("en");
    const r = deviceReadiness(LOG, T0 + 10 * DAY, bank.conceptCounts);
    expect(r.gate.book_anyway_visible).toBe(true);
    expect(r.gate.advisory).toBe(true);
    expect(r.gate.threshold).toBe(85);
    expect(r.topics.map((t) => t.topic_id)).toEqual(["LL1", "LL2", "LL3", "LL4"]);
    expect(r.score).toBe(Math.max(0, r.knowledge - r.calibration_penalty));
  });
});

describe("variant choice avoids the last 2 surface forms (GAME_DESIGN §11.4)", () => {
  const bank = buildBank("en");
  const key = buildPracticeKey("en");
  const practice = bank.items.filter((i) => i.pool === "practice" && key[i.id]);
  const byConcept = new Map<string, typeof practice>();
  for (const it of practice) byConcept.set(it.concept, [...(byConcept.get(it.concept) ?? []), it]);
  const rich = [...byConcept.entries()].filter(([, v]) => v.length >= 3);

  it("there are concepts with 3+ practice variants to test against", () => {
    expect(rich.length).toBeGreaterThan(5);
  });

  it("never picks one of the last 2 seen when another variant exists", () => {
    for (const [, variants] of rich) {
      for (let s = 0; s < 20; s++) {
        const seen = [variants[1]?.id, variants[0]?.id].filter((x): x is string => !!x);
        const pick = pickVariant(variants, seen, `seed-${s}`);
        expect(seen.slice(-AVOID_LAST)).not.toContain(pick?.id);
      }
    }
  });

  it("over a run of sessions, consecutive picks never repeat the last 2", () => {
    const [, variants] = rich[0] ?? ["", []];
    let seen: string[] = [];
    for (let s = 0; s < 30; s++) {
      const pick = pickVariant(variants, seen, `run-${s}`);
      expect(pick).not.toBeNull();
      expect(seen.slice(-AVOID_LAST)).not.toContain(pick?.id);
      seen = rememberVariant(seen, pick?.id ?? "");
    }
  });

  it("with only 2 variants it takes the one seen longest ago", () => {
    const two = practice.filter((i) => i.concept === rich[0]?.[0]).slice(0, 2);
    const [a, b] = two;
    expect(pickVariant(two, [a?.id ?? "", b?.id ?? ""], "x")?.id).toBe(a?.id);
    expect(pickVariant(two, [b?.id ?? "", a?.id ?? ""], "x")?.id).toBe(b?.id);
  });
});
