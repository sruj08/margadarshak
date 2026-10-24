// No duplicate IDs; every referenced rule, drill, skill, module, finding, game, sign,
// illustration, concept and rule-pack row exists.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDuplicateIds, checkReferences, checkRulepackRefs } from "../src/checks.ts";
import { cloneContent, content, rulepacks, show } from "./helpers.ts";

describe("duplicate IDs", () => {
  it("none across the pack", () => {
    const issues = checkDuplicateIds(content());
    assert.deepEqual(issues, [], show(issues));
  });

  it("detects a duplicated drill, item and objective", () => {
    const c = cloneContent();
    const d = c.drills.drills[0];
    assert.ok(d);
    c.drills.drills.push(structuredClone(d));
    const concept = c.questionBanks[0]?.concepts[0];
    assert.ok(concept);
    const second = c.questionBanks[1]?.concepts[0]?.items[0];
    assert.ok(second);
    second.item_id = concept.items[0]?.item_id ?? "";
    const m = c.modules[1];
    assert.ok(m?.learning_objectives[0]);
    m.learning_objectives.push(structuredClone(m.learning_objectives[0]));
    const issues = checkDuplicateIds(c).join("\n");
    assert.match(issues, /duplicate drill_id/);
    assert.match(issues, /duplicate item_id/);
    assert.match(issues, /duplicate objective id/);
  });
});

describe("referential integrity", () => {
  it("every reference resolves", () => {
    const issues = checkReferences(content());
    assert.deepEqual(issues, [], show(issues));
  });

  it("rule-pack rows, LL formats and quoted rule-pack values exist and match rulepacks/", () => {
    const issues = checkRulepackRefs(content(), rulepacks());
    assert.deepEqual(issues, [], show(issues));
  });

  it("detects dangling rule, drill, skill, sign and concept references", () => {
    const c = cloneContent();
    const f = c.findings.findings[0];
    assert.ok(f);
    f.rule_ids.push("RR-XXX-999");
    f.drill_ids.push("DR-NAZ-NOPE");
    const s = c.skills.skills[1];
    assert.ok(s);
    s.follows.push("SK-M99");
    const g = c.games.games[0];
    assert.ok(g);
    g.default_drill_id = "DR-HF-STRAP";
    const concept = c.questionBanks[0]?.concepts[0];
    assert.ok(concept);
    concept.sign_id = "SIGN-MAN-999";
    const m = c.modules[1];
    assert.ok(m);
    m.assessment.item_refs.push("C-LL1-999");
    const issues = checkReferences(c).join("\n");
    for (const needle of [
      "RR-XXX-999",
      "DR-NAZ-NOPE",
      "SK-M99",
      "default drill",
      "SIGN-MAN-999",
      "C-LL1-999",
    ]) {
      assert.ok(issues.includes(needle), `expected an issue mentioning ${needle}`);
    }
  });

  it("detects a rule-pack value that drifted from the item text", () => {
    const c = cloneContent();
    const concept = c.questionBanks[3]?.concepts.find((k) => k.rulepack_facts.length > 0);
    assert.ok(concept?.rulepack_facts[0]);
    concept.rulepack_facts[0].expected = 12;
    assert.ok(checkRulepackRefs(c, rulepacks()).some((i) => i.includes("item text says 12")));
  });

  it("J&K overrides agree with the base values the LL4 items quote", () => {
    const rp = rulepacks();
    const jk = rp.files["states/JK.json"]?.rules ?? [];
    const v = (id: string) =>
      (jk.find((r) => r.id === id)?.["output"] as { value?: unknown } | undefined)?.value;
    assert.equal(v("JK-PRM-LL-VALIDITY-MONTHS"), 6);
    assert.equal(v("JK-PRM-MIN-WAIT-DAYS"), 30);
  });
});
