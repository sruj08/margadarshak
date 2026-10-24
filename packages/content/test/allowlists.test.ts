// Allowlists are deterministic, never drift from the catalogues, are subsets of them, and carry
// only ai_citable rules (verified && kind != "medical").
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { allowlistInputs, buildAllowlists, canonicalJson } from "../src/allowlists.ts";
import { checkAllowlists } from "../src/checks.ts";
import { CONTENT_DIR, generateAllowlists, hashInputs, readJson } from "../src/node.ts";
import { AllowlistsFile } from "../src/schema/allowlists.ts";
import { cloneContent, content, show } from "./helpers.ts";

const committed = () =>
  AllowlistsFile.parse(readJson(join(CONTENT_DIR, "generated", "allowlists.json")));

describe("allowlists", () => {
  it("the committed file matches a fresh generation (run gen:allowlists)", () => {
    assert.deepEqual(committed(), generateAllowlists(content()));
  });

  it("generation is deterministic and lists are sorted and unique", () => {
    const a = generateAllowlists(content());
    const b = generateAllowlists(structuredClone(content()));
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(AllowlistsFile.safeParse(a).success, true);
  });

  it("every ID is a subset of its catalogue", () => {
    const issues = checkAllowlists(content(), committed());
    assert.deepEqual(issues, [], show(issues));
  });

  it("rule IDs are only ai_citable rules: none today, since the spec verifies none yet", () => {
    const a = committed();
    assert.deepEqual(a.debrief_agent.rule_ids, []);
    assert.deepEqual(a.tutor_agent.rule_ids, []);
    assert.deepEqual(a.voice_guide_agent.get_rule_ids, []);
  });

  it("a verified practice rule becomes citable; a verified medical rule never does", () => {
    const c = cloneContent();
    for (const r of c.rules.rules) {
      if (r.rule_id === "RR-PED-001" || r.rule_id === "RR-GHR-003") {
        Object.assign(r, {
          verified: true,
          verified_on: "2026-10-24",
          reviewed_by: ["reviewer-a", "reviewer-b"],
          verification_status: "verified",
          ai_citable: r.kind !== "medical",
        });
      }
    }
    const a = buildAllowlists(c, hashInputs(allowlistInputs(c)));
    assert.ok(a.debrief_agent.rule_ids.includes("RR-PED-001"));
    assert.ok(a.voice_guide_agent.get_rule_ids.includes("RR-PED-001"));
    assert.ok(!a.debrief_agent.rule_ids.includes("RR-GHR-003"));
    assert.ok(!a.voice_guide_agent.get_rule_ids.includes("RR-GHR-003"));
    assert.deepEqual(checkAllowlists(c, a), []);
  });

  it("Golden Hour (template only) never reaches the DebriefAgent", () => {
    const a = committed();
    assert.ok(a.debrief_agent.finding_ids.every((id) => !id.startsWith("GH_")));
    assert.ok(a.debrief_agent.drill_ids.every((id) => !id.startsWith("DR-GH-")));
    assert.deepEqual(a.policy.template_only_games_excluded_from_ai, ["golden_hour"]);
  });

  it("fact keys per finding equal the finding's facts", () => {
    const a = committed();
    for (const f of content().findings.findings) {
      if (f.template_only) continue;
      assert.deepEqual(
        a.debrief_agent.fact_keys[f.finding_id],
        f.facts.map((x) => x.key).sort(),
        f.finding_id,
      );
    }
  });

  it("coach and voice drills exclude games not built in Phase 1–2", () => {
    const a = committed();
    for (const id of [...a.coach_agent.drill_ids, ...a.voice_guide_agent.open_drill_ids]) {
      assert.ok(!id.startsWith("DR-NG-") && !id.startsWith("DR-HR-"), id);
    }
    assert.ok(!a.coach_agent.drill_ids.includes("DR-TT-REVPARK"));
  });

  it("tutor explanations require approved EN and HI review (none approved yet)", () => {
    assert.deepEqual(committed().tutor_agent.explanation_ids, []);
    const c = cloneContent();
    const k = c.questionBanks[0]?.concepts[0];
    assert.ok(k);
    k.explanation.review_status = "approved";
    k.explanation.hi_review_status = "approved";
    const a = buildAllowlists(c, hashInputs(allowlistInputs(c)));
    assert.deepEqual(a.tutor_agent.explanation_ids, [k.explanation.explanation_id]);
  });

  it("SignSnap gets sign IDs only (no markings or signals)", () => {
    const ids = committed().sign_snap.sign_ids;
    assert.ok(ids.length > 0);
    assert.ok(ids.every((id) => /^SIGN-(MAN|CAU|INF)-/.test(id)));
  });

  it("detects an allowlist that smuggles in a non-citable rule", () => {
    const a = structuredClone(committed());
    a.debrief_agent.rule_ids = ["RR-HVY-002"];
    assert.ok(checkAllowlists(content(), a).some((i) => i.includes("RR-HVY-002")));
  });
});
