// The committed client bank and practice pack match the authored bank, never carry a mock answer,
// and the server answer keys fit game-core's LlAnswerKey (the score verifier's input).
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LlAnswerKey } from "../../game-core/src/schema/content.ts";
import { toLlAnswerKeys } from "../src/answer-keys.ts";
import { CONTENT_DIR, readJson } from "../src/node.ts";
import { splitQuestionBank } from "../src/split.ts";
import { content } from "./helpers.ts";

const generated = (f: string) => readJson(join(CONTENT_DIR, "generated", f));

describe("committed client bank (run gen:client-bank after editing questions)", () => {
  const split = splitQuestionBank(content().questionBanks);

  it("ll-bank.client.json and ll-bank.practice-key.json match a fresh split", () => {
    assert.deepEqual(generated("ll-bank.client.json"), split.client);
    assert.deepEqual(generated("ll-bank.practice-key.json"), split.practiceKey);
  });

  it("the client bank carries no key, and the practice pack no mock item", () => {
    const text = JSON.stringify(generated("ll-bank.client.json"));
    assert.equal(/correct_option_id|option_refs|explanation/.test(text), false);
    const mock = new Set(
      split.serverKey.keys.filter((k) => k.pool === "mock").map((k) => k.item_id),
    );
    assert.ok(mock.size > 0);
    for (const k of split.practiceKey.keys) assert.equal(mock.has(k.item_id), false, k.item_id);
  });
});

describe("toLlAnswerKeys", () => {
  const split = splitQuestionBank(content().questionBanks);
  const keys = toLlAnswerKeys(split.serverKey, content().signs.signs);

  it("one game-core LlAnswerKey per item, mock items included", () => {
    assert.equal(keys.length, split.serverKey.keys.length);
    for (const k of keys) assert.equal(LlAnswerKey.safeParse(k).success, true, k.qref);
    assert.ok(keys.every((k) => `q:${k.qref}`.length <= 64));
  });

  it("variants of a concept review the same FSRS card; sign questions carry their family", () => {
    const first = keys.find((k) => k.qref === "C-LL1-001:v1");
    assert.deepEqual(first, {
      qref: "C-LL1-001:v1",
      cardId: "C-LL1-001",
      correctOptionId: "a",
      topic: "LL1",
      signFamily: "MANDATORY",
      signId: "SIGN-MAN-001",
    });
    const cards = new Set(keys.filter((k) => k.qref.startsWith("C-LL1-001:")).map((k) => k.cardId));
    assert.deepEqual([...cards], ["C-LL1-001"]);
  });

  it("rejects a sign that is missing from the catalogue", () => {
    assert.throws(() => toLlAnswerKeys(split.serverKey, []), /not in signs\.json/);
  });
});
