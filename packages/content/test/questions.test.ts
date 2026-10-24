// LL bank: size and topic balance for the mocks, 3–6 variants with unique stems, balanced answer
// positions, computed distractor similarity, catalogue-consistent options, and the answer-key split.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allConcepts,
  allItems,
  checkBankSize,
  checkOptionConsistency,
  checkPositionBalance,
  checkSimilarity,
  checkVariants,
  positionCounts,
} from "../src/checks.ts";
import { splitQuestionBank } from "../src/split.ts";
import { cloneContent, content, show } from "./helpers.ts";

describe("LL question bank", () => {
  it("has ≥ 60 concepts and ≥ 200 items, balanced across LL1–LL4", () => {
    const issues = checkBankSize(content());
    assert.deepEqual(issues, [], show(issues));
    assert.ok(allConcepts(content()).length >= 60);
    assert.ok(allItems(content()).length >= 200);
  });

  it("can fill a J&K mock (10) and a default mock (15) from unseen mock variants with every topic present", () => {
    for (const b of content().questionBanks) {
      const mock = b.concepts.flatMap((c) => c.items.filter((it) => it.pool === "mock"));
      // ≥ 4 mock variants per topic covers a 15-question form with equal topic weights.
      assert.ok(mock.length >= 4, `${b.topic}: ${mock.length} mock items`);
    }
    const totalMock = allItems(content()).filter((x) => x.item.pool === "mock").length;
    assert.ok(
      totalMock >= 15 * 4,
      `${totalMock} mock items: enough for several distinct default forms`,
    );
  });

  it("every concept has 3–6 variants with unique stems (en and hi) and Devanagari Hindi", () => {
    const issues = checkVariants(content());
    assert.deepEqual(issues, [], show(issues));
  });

  it("detects a repeated stem inside a concept", () => {
    const c = cloneContent();
    const items = c.questionBanks[0]?.concepts[0]?.items;
    assert.ok(items?.[0] && items[1]);
    items[1].stem = structuredClone(items[0].stem);
    assert.ok(checkVariants(c).some((i) => i.includes("stem (en)")));
  });

  it("keeps the correct-option position balanced across the bank", () => {
    const issues = checkPositionBalance(content());
    assert.deepEqual(issues, [], show(issues));
    const four = positionCounts(content()).get(4);
    assert.ok(four && four.size === 4, "every position a–d is used by 4-option items");
  });

  it("detects a bank that always puts the answer first", () => {
    const c = cloneContent();
    for (const { item } of allItems(c)) item.key.correct_option_id = "a";
    assert.ok(checkPositionBalance(c).length > 0);
  });

  it("distractor similarity levels match the sign data and span L1–L5", () => {
    const issues = checkSimilarity(content());
    assert.deepEqual(issues, [], show(issues));
    const levels = new Set(allItems(content()).map((x) => x.item.similarity.level));
    for (const l of [1, 2, 3, 4, 5]) assert.ok(levels.has(l), `no item at L${l}`);
  });

  it("sign options agree with the catalogue and the answer is the concept's own sign", () => {
    const issues = checkOptionConsistency(content());
    assert.deepEqual(issues, [], show(issues));
  });

  it("alt text never names the sign (describes shape and symbol, not meaning)", () => {
    for (const s of content().signs.signs) {
      const name = s.name.en.toLowerCase();
      if (name.length < 5) continue; // e.g. "Stop" is printed on the sign itself
      assert.ok(
        !s.alt.en.toLowerCase().includes(name),
        `${s.sign_id}: alt contains "${s.name.en}"`,
      );
    }
    for (const i of content().illustrations.illustrations) {
      assert.ok(
        !/slow|stop|turn|overtak|brak|hazard/i.test(
          i.alt.en.replace(/^Rider seen from [a-z ]+: /, ""),
        ) || i.subject !== "hand_signal",
        i.illustration_id,
      );
    }
  });

  it("every concept cites a source and stays verified=false until reviewed", () => {
    for (const k of allConcepts(content())) {
      assert.ok(k.sources.length > 0, k.concept_id);
      assert.equal(k.verified, false, k.concept_id);
      assert.equal(k.explanation.hi_review_status, "pending_native_review", k.concept_id);
    }
  });

  it("each concept reserves one mock variant and keeps ≥ 2 practice variants", () => {
    for (const k of allConcepts(content())) {
      assert.ok(
        k.items.some((it) => it.pool === "mock"),
        k.concept_id,
      );
      assert.ok(k.items.filter((it) => it.pool === "practice").length >= 2, k.concept_id);
    }
  });
});

describe("answer-key split", () => {
  const split = () => splitQuestionBank(content().questionBanks);

  it("the client bank carries no keys, explanations, option refs or concept titles", () => {
    const { client } = split();
    const text = JSON.stringify(client);
    for (const banned of [
      "correct_option_id",
      "option_refs",
      "explanation",
      '"key"',
      '"title"',
      "rule_ids",
    ]) {
      assert.ok(!text.includes(banned), `client bank leaks ${banned}`);
    }
    assert.equal(client.items.length, allItems(content()).length);
  });

  it("explanation text never reaches the client bank", () => {
    const { client } = split();
    const text = JSON.stringify(client);
    for (const k of allConcepts(content())) {
      assert.ok(!text.includes(k.explanation.text.en), `${k.concept_id} explanation leaked`);
    }
  });

  it("the practice key holds only practice items; mock keys stay server-side", () => {
    const { practiceKey, serverKey } = split();
    const mockIds = new Set(
      allItems(content())
        .filter((x) => x.item.pool === "mock")
        .map((x) => x.item.item_id),
    );
    assert.ok(mockIds.size > 0);
    for (const k of practiceKey.keys)
      assert.ok(!mockIds.has(k.item_id), `${k.item_id} is a mock item`);
    const serverIds = new Set(serverKey.keys.map((k) => k.item_id));
    for (const id of mockIds) assert.ok(serverIds.has(id), id);
    assert.equal(serverKey.keys.length, allItems(content()).length);
  });

  it("server keys reproduce the authored answers", () => {
    const { serverKey } = split();
    const answers = new Map(
      allItems(content()).map((x) => [x.item.item_id, x.item.key.correct_option_id]),
    );
    for (const k of serverKey.keys)
      assert.equal(k.correct_option_id, answers.get(k.item_id), k.item_id);
  });

  it("is deterministic", () => {
    assert.deepEqual(split(), split());
  });
});
