import type { GameEvent, SessionContext } from "@margdarshak/game-core/schema";
import { assembleContent, scoreLlSim } from "@margdarshak/game-core/scoring";
import { describe, expect, it } from "vitest";
import { buildBank, buildPracticeKey } from "@/features/learn/content/bank-build";
import { decodeAnswers, encodeAnswers, liteSet, scoreLite } from "@/features/lite-learn/quiz";
import { examDeviceItems, examSize, pickExamItems } from "./exam-items";
import { llFormatFor } from "./format";

const bank = buildBank("en");
const key = buildPracticeKey("en");
const practice = bank.items.filter((i) => i.pool === "practice" && key[i.id]);

describe("LL format from the rule packs (F-22, GAME_DESIGN §11.3)", () => {
  it("J&K: 10 questions, 6 to pass, with its source and checked date", () => {
    const f = llFormatFor("JK", "2026-10-24");
    expect(f.known).toBe(true);
    expect(examSize(f)).toEqual({ questions: 10, pass: 6 });
    expect(f.provenance.source_title).toMatch(/Kashmir Life/);
    expect(f.provenance.verified_on).toBe("2026-10-22");
    expect(f.per_question_timer_s).toBeNull();
    expect(f.online_test_available).toBe(true);
  });

  it("EC-10 Kerala: the LL test is at the RTO, in Kerala's own format (30 / 18 from Oct 2025)", () => {
    const f = llFormatFor("KL", "2026-10-24");
    expect(f.online_test_available).toBe(false);
    expect(f.where).toEqual(["rto"]);
    expect(f.known).toBe(true);
    expect(examSize(f)).toEqual({ questions: 30, pass: 18 });
  });

  it("a state without a published format uses the labelled practice default (Bihar)", () => {
    const f = llFormatFor("BR", "2026-10-24");
    expect(f.known).toBe(false);
    expect(examSize(f)).toEqual({ questions: 15, pass: 9 });
  });

  it("a J&K exam deals exactly 10 practice questions spread over LL1–LL4", () => {
    const items = pickExamItems(practice, 10, {}, "seed-1");
    expect(items).toHaveLength(10);
    expect(new Set(items.map((i) => i.concept)).size).toBe(10);
    expect(new Set(items.map((i) => i.topic))).toEqual(new Set(["LL1", "LL2", "LL3", "LL4"]));
    expect(items.every((i) => i.pool === "practice")).toBe(true);
  });

  it("exam variants avoid the last 2 surface forms seen for each concept", () => {
    const first = pickExamItems(practice, 10, {}, "seed-2");
    const seen: Record<string, string[]> = {};
    for (const it of first) seen[it.concept] = [it.id];
    const again = pickExamItems(practice, 40, seen, "seed-2");
    for (const it of again) expect(seen[it.concept] ?? []).not.toContain(it.id);
  });

  it("the device content scores a J&K mock with the state's pass rule (6 of 10)", () => {
    const f = llFormatFor("JK", "2026-10-24");
    const items = pickExamItems(practice, 10, {}, "seed-3");
    const dev = examDeviceItems(items, key, f);
    const ctx: SessionContext = {
      sid: "00000000-0000-4000-8000-000000000001",
      gameId: "ll_sim",
      mode: "mock",
      userBand: "adult",
      locale: "en",
      a11y: { modes: [], textScale: 1, haptics: false },
      difficulty: 3,
      seed: 7,
      seedOrigin: "client_offline",
      items: dev.items,
      deviceClass: "mid",
      offline: true,
      serverStartIso: null,
      tenant: "JK",
      rulePackVersion: "2026.10.23",
    };
    const content = assembleContent(ctx, {
      items: dev.items.map((i) => dev.docs[i.ref]),
      formats: dev.formats,
    });
    // Answer the first 6 right and the rest wrong.
    const events: GameEvent[] = [];
    let seq = 0;
    items.forEach((it, i) => {
      const right = key[it.id]?.correct ?? "a";
      const wrong = it.options.find((o) => o.id !== right)?.id ?? "b";
      events.push({
        sid: ctx.sid,
        seq: seq++,
        t: i * 1000,
        item: i,
        type: "item_start",
        p: { ref: `q:${it.id}` },
      });
      events.push({
        sid: ctx.sid,
        seq: seq++,
        t: i * 1000 + 500,
        item: i,
        type: "answer",
        p: { qref: it.id, optionId: i < 6 ? right : wrong, latencyMs: 500 },
      });
      events.push({
        sid: ctx.sid,
        seq: seq++,
        t: i * 1000 + 600,
        item: i,
        type: "item_end",
        p: { ref: `q:${it.id}`, reason: "done" },
      });
    });
    const result = scoreLlSim(ctx, events, content as Parameters<typeof scoreLlSim>[2], {
      gameVersion: "1.0.0",
      scoringVersion: "1.0",
      replayInputs: "",
      provisional: true,
    });
    expect(result.score.max).toBe(10);
    expect(result.score.raw).toBe(6);
    expect(result.score.passed).toBe(true);
  });
});

describe("Lite LL test (EC-19)", () => {
  it("deals the J&K count and scores locally from the practice key only", () => {
    const items = liteSet(bank, key, 10, "lite:JK");
    expect(items).toHaveLength(10);
    const answers = items.map((it, i) => ({
      itemId: it.id,
      optionId: i < 7 ? (key[it.id]?.correct ?? null) : null,
      confidence: null,
    }));
    const s = scoreLite(decodeAnswers(encodeAnswers(answers)), key);
    expect(s).toMatchObject({ right: 7, total: 10 });
  });
});
