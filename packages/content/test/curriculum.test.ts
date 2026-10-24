// Curriculum modules follow CURRICULUM §2–§6: the 28 modules, priorities and vehicle scope,
// tenant gating, readiness membership, the depth contract and the review gates.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODULE_ORDER } from "../src/model.ts";
import { content } from "./helpers.ts";
import { SPEC_MODULES, SPEC_ROAD_READINESS } from "./spec.ts";

const mod = (id: string) => {
  const m = content().modules.find((x) => x.module_id === id);
  assert.ok(m, id);
  return m;
};

describe("curriculum modules", () => {
  it("LL0–LL4, M1–M22 and DL1, in order", () => {
    assert.deepEqual(
      content().modules.map((m) => m.module_id),
      [...MODULE_ORDER],
    );
  });

  it("priority and vehicle scope follow CURRICULUM §4", () => {
    for (const [id, spec] of Object.entries(SPEC_MODULES)) {
      assert.equal(mod(id).priority, spec.priority, `${id} priority`);
      assert.equal(mod(id).vehicle_scope, spec.scope, `${id} scope`);
    }
  });

  it("deep content only for MCWOG, MCWG and LMV-NT (D-05)", () => {
    for (const m of content().modules) {
      const expected =
        m.vehicle_scope === "2W"
          ? ["MCWOG", "MCWG"]
          : m.vehicle_scope === "Car"
            ? ["LMV-NT"]
            : ["MCWOG", "MCWG", "LMV-NT"];
      assert.deepEqual(m.deep_content_classes, expected, m.module_id);
    }
  });

  it("J&K modules are prioritised (and M15 gated) for the J&K tenant", () => {
    assert.deepEqual(mod("M14").priority_tenants, ["JK"]);
    assert.deepEqual(mod("M15").priority_tenants, ["JK"]);
    assert.deepEqual(mod("M15").available_to, ["JK"]);
    assert.ok(mod("LL1").lessons.some((l) => l.tenants?.includes("JK")));
  });

  it("readiness membership follows CURRICULUM §6", () => {
    for (const m of content().modules) {
      if (/^LL[1-4]$/.test(m.module_id)) assert.equal(m.assessment.readiness, "test", m.module_id);
      else if (SPEC_ROAD_READINESS.includes(m.module_id))
        assert.equal(m.assessment.readiness, "road", m.module_id);
      else if (m.module_id === "M14") {
        assert.equal(m.assessment.readiness, "road_tenant");
        assert.deepEqual(m.assessment.readiness_tenants, ["JK"]);
      } else assert.equal(m.assessment.readiness, "none", m.module_id);
    }
  });

  it("LL modules point their assessment at the authored concepts", () => {
    for (const id of ["LL1", "LL2", "LL3", "LL4"]) {
      const m = mod(id);
      const bank = content().questionBanks.find((b) => b.topic === id);
      assert.deepEqual(
        m.concepts.authored,
        bank?.concepts.map((c) => c.concept_id),
      );
      assert.deepEqual(m.assessment.item_refs, m.concepts.authored);
    }
  });

  it("M19 needs medical sign-off and carries the draft label", () => {
    const m = mod("M19");
    assert.equal(m.review.medical_review_required, true);
    assert.equal(m.review.draft_label_until_reviewed, true);
    assert.equal(m.review.reviewed_by.length, 0);
    assert.ok(m.key_facts.some((k) => k.kind === "medical" && !k.verified));
    assert.equal(mod("M11").review.medical_review_required, true);
    assert.equal(mod("M22").review.medical_review_required, true);
  });

  it("every key fact has a source and confidence; none is marked verified yet", () => {
    for (const m of content().modules) {
      for (const k of m.key_facts) {
        assert.ok(k.sources.length > 0, k.id);
        assert.equal(k.verified, false, k.id);
      }
    }
  });

  it("unverified legal limits never appear as numbers (M11 alcohol limit, M13 child-pillion cap)", () => {
    const text = JSON.stringify([mod("M11"), mod("M13")]);
    assert.ok(!/30\s?mg/i.test(text), "alcohol limit must not be typed");
    assert.ok(!/40\s?km\/h/.test(text), "child-pillion cap must not be typed");
  });

  it("stopping-distance key facts match the formula with the teaching values", () => {
    const d = (kmh: number, mu: number) => {
      const v = kmh / 3.6;
      return v * 1.5 + (v * v) / (2 * mu * 9.81);
    };
    const kf = mod("M1").key_facts.find((k) => k.kind === "physics");
    assert.ok(kf);
    for (const [kmh, mu, shown] of [
      [40, 0.7, "25.7"],
      [60, 0.7, "45.2"],
      [60, 0.4, "60.4"],
      [80, 0.7, "69.3"],
    ] as const) {
      assert.equal(d(kmh, mu).toFixed(1), shown);
      assert.ok(kf.text.en.includes(`≈ ${shown} m`), shown);
    }
  });
});
