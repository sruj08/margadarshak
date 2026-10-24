// The catalogues cover the spec tables faithfully: every rule (with its verification status),
// every finding (facts, critical flag, rules, drills), every drill, every skill node.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkAiCitable,
  checkHazardDrills,
  collectStrings,
  expandDrillPattern,
  factEnumValues,
} from "../src/checks.ts";
import { HAZARD_TYPES } from "../src/schema/common.ts";
import { RuleEntry } from "../src/schema/rules.ts";
import { cloneContent, content, show } from "./helpers.ts";
import {
  DOCUMENTED_LEGAL_REFS,
  SPEC_CRITICAL,
  SPEC_DRILLS_FIXED,
  SPEC_FINDING_DRILLS,
  SPEC_FINDING_FACTS,
  SPEC_FINDING_RULES,
  SPEC_POSITIVE,
  SPEC_RULES,
  SPEC_TREE_NODES,
} from "./spec.ts";

describe("rule catalogue (DEBRIEF_SPEC §3)", () => {
  it("has exactly the spec's RR-* entries", () => {
    const ids = content()
      .rules.rules.map((r) => r.rule_id)
      .sort();
    assert.deepEqual(ids, Object.keys(SPEC_RULES).sort());
  });

  it("carries the spec's kind and verification status faithfully", () => {
    const status = {
      "review pending": "review_pending",
      no: "not_verified",
      "no (draft)": "draft_medical_signoff_required",
    };
    for (const r of content().rules.rules) {
      const [kind, spec] = SPEC_RULES[r.rule_id] as [string, keyof typeof status];
      assert.equal(r.kind, kind, r.rule_id);
      assert.equal(r.verification_status, status[spec], r.rule_id);
      assert.equal(r.verified, false, `${r.rule_id}: the spec marks no rule verified yet`);
      assert.equal(r.verified_on, null, r.rule_id);
    }
  });

  it("ai_citable matches verified && kind != 'medical' for every entry", () => {
    const issues = checkAiCitable(content());
    assert.deepEqual(issues, [], show(issues));
  });

  it("the schema rejects an entry whose ai_citable breaks the formula", () => {
    const r = structuredClone(content().rules.rules[0]);
    assert.ok(r);
    r.ai_citable = true;
    assert.equal(RuleEntry.safeParse(r).success, false);
    const med = structuredClone(content().rules.rules.find((x) => x.kind === "medical"));
    assert.ok(med);
    Object.assign(med, {
      verified: true,
      verified_on: "2026-10-24",
      reviewed_by: ["dr-a", "dr-b"],
      verification_status: "verified",
      ai_citable: true,
    });
    assert.equal(RuleEntry.safeParse(med).success, false, "medical rows are never AI-citable");
    med.ai_citable = false;
    assert.equal(RuleEntry.safeParse(med).success, true);
  });

  it("law and evidence rows say what is still to pin", () => {
    for (const r of content().rules.rules) {
      if (r.kind === "law" || r.kind === "evidence" || r.kind === "medical") {
        assert.equal(r.source_pin, "to_pin", r.rule_id);
      }
      assert.ok(r.source_note.length > 10, r.rule_id);
    }
  });

  it("cites only MV Act sections and CMVR rules that appear in the docs or rule packs", () => {
    const refs = new Set<string>();
    const re = /\b(s\.\s?\d+[A-Z]?(?:\(\d+[A-Z]?\))?|r\.\s?\d+)/g;
    for (const u of collectStrings(content())) {
      for (const m of u.text.matchAll(re)) refs.add((m[1] as string).replace(/\s/g, ""));
    }
    const unknown = [...refs].filter((r) => !DOCUMENTED_LEGAL_REFS.has(r));
    assert.deepEqual(unknown, [], `undocumented legal references: ${unknown.join(", ")}`);
  });
});

describe("finding catalogue (DEBRIEF_SPEC §2)", () => {
  const byId = () => new Map(content().findings.findings.map((f) => [f.finding_id, f]));

  it("covers every finding of all ten games", () => {
    const ids = [...byId().keys()].sort();
    assert.deepEqual(ids, Object.keys(SPEC_FINDING_FACTS).sort());
    const games = new Set(content().findings.findings.map((f) => f.game_id));
    assert.equal(games.size, 10);
  });

  it("facts keys match the spec exactly", () => {
    for (const [id, keys] of Object.entries(SPEC_FINDING_FACTS)) {
      assert.deepEqual(
        byId()
          .get(id)
          ?.facts.map((x) => x.key),
        keys,
        id,
      );
    }
  });

  it("critical flags and positives match the spec", () => {
    for (const f of content().findings.findings) {
      assert.equal(f.critical, SPEC_CRITICAL.has(f.finding_id), `${f.finding_id} critical`);
      assert.equal(
        f.polarity === "positive",
        SPEC_POSITIVE.has(f.finding_id),
        `${f.finding_id} polarity`,
      );
    }
  });

  it("lists every rule the spec names for the finding", () => {
    for (const [id, rules] of Object.entries(SPEC_FINDING_RULES)) {
      const f = byId().get(id);
      for (const r of rules) assert.ok(f?.rule_ids.includes(r), `${id} should list ${r}`);
    }
  });

  it("resolves to the spec's drill (fixed or pattern)", () => {
    for (const [id, drill] of Object.entries(SPEC_FINDING_DRILLS)) {
      const f = byId().get(id);
      assert.ok(f, id);
      if (drill.includes("{")) assert.equal(f.drill_pattern?.template, drill, id);
      else assert.ok(f.drill_ids.includes(drill), `${id} → ${drill}`);
    }
    // NAZ_EARLY_TAPS has no hazard_type fact, so it lists every occlusion drill.
    const early = byId().get("NAZ_EARLY_TAPS");
    assert.equal(early?.drill_ids.length, HAZARD_TYPES.length);
  });

  it("per-topic rules equal the union of the LL modules' rules", () => {
    const weak = byId().get("LL_WEAK_TOPIC");
    const ll = new Set(
      content()
        .modules.filter((m) => /^LL[1-4]$/.test(m.module_id))
        .flatMap((m) => m.rule_ids),
    );
    assert.deepEqual([...(weak?.rule_ids ?? [])].sort(), [...ll].sort());
  });

  it("Golden Hour findings are template-only and flagged for medical review", () => {
    for (const f of content().findings.findings.filter((x) => x.game_id === "golden_hour")) {
      assert.equal(f.template_only, true, f.finding_id);
      assert.equal(f.medical_review_required, true, f.finding_id);
    }
  });

  it("Hindi templates are marked pending native review", () => {
    for (const f of content().findings.findings)
      assert.equal(f.hi_review_status, "pending_native_review");
  });
});

describe("drill catalogue (DEBRIEF_SPEC §4)", () => {
  it("contains every spec drill plus one occlusion drill per hazard type", () => {
    const ids = new Set(content().drills.drills.map((d) => d.drill_id));
    for (const d of SPEC_DRILLS_FIXED) assert.ok(ids.has(d), d);
    const expected = new Set([
      ...SPEC_DRILLS_FIXED,
      ...HAZARD_TYPES.map((h) => `DR-NAZ-OCCL-${h.toUpperCase()}`),
    ]);
    assert.deepEqual([...ids].sort(), [...expected].sort());
  });

  it("every hazard type has its upper-cased occlusion drill", () => {
    const issues = checkHazardDrills(content());
    assert.deepEqual(issues, [], show(issues));
    assert.ok(
      content().drills.drills.some((d) => d.drill_id === "DR-NAZ-OCCL-BUS_STOP_PEDESTRIAN"),
    );
  });

  it("detects a missing occlusion drill", () => {
    const c = cloneContent();
    c.drills.drills = c.drills.drills.filter((d) => d.drill_id !== "DR-NAZ-OCCL-CYCLIST");
    assert.ok(checkHazardDrills(c).some((i) => i.includes("DR-NAZ-OCCL-CYCLIST")));
  });

  it("every drill pattern expands over its enum to existing drills", () => {
    const ids = new Set(content().drills.drills.map((d) => d.drill_id));
    for (const f of content().findings.findings) {
      if (!f.drill_pattern) continue;
      const values = factEnumValues(content(), f.drill_pattern.fact_key);
      assert.ok(values && values.length > 0, f.finding_id);
      for (const v of values) {
        const id = expandDrillPattern(f.drill_pattern.template, f.drill_pattern.fact_key, v);
        assert.ok(ids.has(id), `${f.finding_id}: ${id}`);
      }
    }
  });

  it("Night & Glare and Hill Road drills are marked Phase 3+ (storyboard games)", () => {
    for (const d of content().drills.drills) {
      if (d.game_id === "night_glare" || d.game_id === "hill_road")
        assert.equal(d.availability, "phase_3_plus", d.drill_id);
    }
  });
});

describe("skills and hazard types", () => {
  it("every GAMIFICATION_ENGINE §3.1 node is in the tree; every module has a skill", () => {
    const skills = new Map(content().skills.skills.map((s) => [s.skill_id, s]));
    for (const id of SPEC_TREE_NODES) assert.equal(skills.get(id)?.in_skill_tree, true, id);
    for (const m of content().modules) assert.ok(skills.has(m.skill_id), m.module_id);
    assert.equal(skills.size, content().modules.length);
    assert.deepEqual(
      skills
        .get("SK-DL1")
        ?.requires.map((r) => r.skill_id)
        .sort(),
      ["SK-LL1", "SK-M1"],
    );
  });

  it("hazard types follow NAZAR §3.3 in order", () => {
    assert.deepEqual(
      content().hazardTypes.hazard_types.map((h) => h.hazard_type),
      [...HAZARD_TYPES],
    );
    const other = content().hazardTypes.hazard_types.find((h) => h.hazard_type === "other");
    assert.equal(other?.mock_eligible, false);
  });
});
