// Template texts of the fallback card (DEBRIEF_SPEC §9) pass the §6.3 text rules: no raw digits,
// placeholders ⊆ the finding's facts, tone, language, lengths, no fees; every finding has en + hi.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkFindingLocales, checkTemplates, templateTexts } from "../src/checks.ts";
import { checkTemplateText, LIMITS, placeholders, scriptShare } from "../src/text.ts";
import { cloneContent, content, show } from "./helpers.ts";

describe("finding templates", () => {
  it("pass V1 / V3 / V5 / V6 / V7 / V10 (findings, game bands, drill reasons)", () => {
    const issues = checkTemplates(content());
    assert.deepEqual(issues, [], show(issues));
  });

  it("use only placeholders that are facts keys of the same finding", () => {
    for (const f of content().findings.findings) {
      const keys = new Set(f.facts.map((x) => x.key));
      for (const t of templateTexts(f)) {
        for (const locale of ["en", "hi"] as const) {
          for (const k of placeholders(t.text[locale]))
            assert.ok(keys.has(k), `${f.finding_id}.${t.slot}.${locale}: ${k}`);
        }
      }
    }
  });

  it("use the same placeholders in en and hi", () => {
    for (const f of content().findings.findings) {
      for (const t of templateTexts(f)) {
        assert.deepEqual(
          [...placeholders(t.text.en)].sort(),
          [...placeholders(t.text.hi)].sort(),
          `${f.finding_id}.${t.slot}`,
        );
      }
    }
  });

  it("every finding renders in en and hi", () => {
    const issues = checkFindingLocales(content());
    assert.deepEqual(issues, [], show(issues));
  });

  it("flags a template that types a number or uses an unknown key", () => {
    const c = cloneContent();
    const f = c.findings.findings.find((x) => x.finding_id === "NAZ_LATE_RESPONSE");
    assert.ok(f?.templates.lacked);
    f.templates.lacked.en = "You were 1.4 s late at {{fact:speed}}.";
    const issues = checkTemplates(c).join("\n");
    assert.match(issues, /NAZ_LATE_RESPONSE\.lacked\.en: V1/);
    assert.match(issues, /unknown fact key speed/);
  });
});

describe("text rules (checkTemplateText)", () => {
  const ok = (text: string, locale: "en" | "hi" = "en", keys: string[] = []) =>
    checkTemplateText(text, { locale, maxLength: LIMITS.point, allowedKeys: keys });

  it("V1: digits outside placeholders (Latin and Devanagari)", () => {
    assert.ok(ok("You were 2 times late").some((v) => v.rule === "V1"));
    assert.ok(ok("आप २ बार देर से थे", "hi").some((v) => v.rule === "V1"));
    assert.deepEqual(ok("You were late {{fact:times}}.", "en", ["times"]), []);
  });

  it("V3: unknown keys and malformed placeholders", () => {
    assert.ok(ok("Late by {{fact:late_s}}").some((v) => v.rule === "V3"));
    assert.ok(ok("Late by {{late_s}}", "en", ["late_s"]).some((v) => v.rule === "V3"));
  });

  it("V5: tone bans in English and Hindi", () => {
    assert.ok(ok("You would have crashed there.").some((v) => v.rule === "V5"));
    assert.ok(ok("You are a certified safe driver.").some((v) => v.rule === "V5"));
    assert.ok(ok("बेटा, ध्यान दो", "hi").some((v) => v.rule === "V5"));
  });

  it("V6: script share per locale", () => {
    assert.ok(ok("This is English", "hi").some((v) => v.rule === "V6"));
    assert.ok(scriptShare("आपने {{fact:hazard_type}} देर से पहचाना", "hi") > 0.95);
  });

  it("V7: length limits", () => {
    assert.ok(ok("a ".repeat(80)).some((v) => v.rule === "V7"));
  });

  it("V10: fee and rupee mentions, without tripping on 'feet'", () => {
    assert.ok(ok("The licence fee is waived").some((v) => v.rule === "V10"));
    assert.ok(ok("₹ off").some((v) => v.rule === "V10"));
    assert.ok(ok("फ़ीस माफ़ है", "hi").some((v) => v.rule === "V10"));
    assert.deepEqual(ok("Watch for feet under the bus."), []);
  });
});
