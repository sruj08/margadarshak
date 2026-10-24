// D-19 wording bans (scripts/lint_wording.terms.json) and D-06: no ₹ / fee literals anywhere in
// the pack, plus the content bans of GAME_DESIGN §1.1 that apply to text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkWording, collectStrings } from "../src/checks.ts";
import { cloneContent, content, show, wordingTerms } from "./helpers.ts";

describe("wording and fee literals", () => {
  it("no banned wording and no rupee or fee literals anywhere in the pack", () => {
    const issues = checkWording(content(), wordingTerms());
    assert.deepEqual(issues, [], show(issues));
  });

  it("never states a fee amount and never uses the ₹ sign", () => {
    for (const u of collectStrings(content())) {
      assert.ok(!u.text.includes("₹"), u.path);
    }
  });

  it("never claims certification, a verified licence, or a safe/unsafe driver verdict", () => {
    const re =
      /\b(certified|verified licen[cs]e|(un)?safe (driver|rider)|you would (have )?crash(ed)?|lives saved)\b/i;
    for (const u of collectStrings(content())) {
      if (u.userFacing) assert.ok(!re.test(u.text), `${u.path}: ${u.text}`);
    }
  });

  it("has no speed, stunt or racing content in learner text", () => {
    const re = /\b(stunt|wheelie|race|racing|drift(ing)?|top speed)\b/i;
    for (const u of collectStrings(content())) {
      if (u.userFacing) assert.ok(!re.test(u.text), `${u.path}: ${u.text}`);
    }
  });

  it("detects a seeded violation", () => {
    const c = cloneContent();
    const r = c.rules.rules[0];
    assert.ok(r);
    r.text_en = "The official retest fee is Rs 50";
    const issues = checkWording(c, wordingTerms()).join("\n");
    assert.match(issues, /\[official\]/);
    assert.match(issues, /\[rs-prefix\]/);
    assert.match(issues, /\[fee-number\]/);
  });
});
