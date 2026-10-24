// Integration against the real content catalogue (content/catalogue/*.json, read as data): every
// golden vector's findings and facts are known to the catalogue and labelled; the template card
// renders and passes the validator for every vector in en and hi; every catalogue finding of all
// ten games renders from synthetic facts; every finding has en + hi templates (P2 DoD).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditCatalogue,
  buildLabels,
  CARD_LABELS,
  type CatalogueFinding,
  checkText,
  type DebriefCard,
  type DebriefCatalogue,
  debriefCatalogue,
  FALLBACK_TEXT,
  type FactsPack,
  generateFindings,
  MISSING_VALUE,
  renderTemplateCard,
  templateDraft,
  validateDraft,
} from "../src/debrief/index.ts";
import { goldenVectors } from "../src/fixtures/index.ts";
import type { Finding, SessionResult } from "../src/schema/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (f: string) =>
  JSON.parse(readFileSync(join(root, "content/catalogue", `${f}.json`), "utf8"));
const catalogue: DebriefCatalogue = debriefCatalogue({
  findings: read("findings"),
  rules: read("rules"),
  drills: read("drills"),
  games: read("games"),
  enums: read("enums"),
  hazardTypes: read("hazard_types"),
});
const labels = buildLabels(catalogue);
const byId = new Map(catalogue.findings.map((f) => [f.finding_id, f]));
const OPTS = { now: "2026-10-24T10:41:07Z", generatorVersion: "game-core 0.1.0", strict: true };

/** All user-visible text of a card. */
const texts = (c: DebriefCard): string[] => [
  c.how_you_did,
  ...c.where_you_lacked.map((p) => p.text),
  ...c.what_you_could_have_done.map((p) => p.text),
  c.next_drill.why,
];

/** The template debrief, as a draft, passes validateDraft (Golden Hour checked as if AI-eligible). */
function assertTemplatePasses(pack: FactsPack, locale: "en" | "hi", what: string): void {
  const draft = templateDraft(pack, catalogue, locale, { strict: true });
  const asAi: FactsPack = { ...pack, locale: draft.locale, debriefMode: "ai_or_template" };
  const r = validateDraft(draft, asAi);
  assert.deepEqual(r.violations, [], `${what} ${locale}`);
}

function assertCardClean(card: DebriefCard, what: string): void {
  for (const t of texts(card)) {
    assert.doesNotMatch(t, /\{\{|\}\}/, `${what}: leftover placeholder in "${t}"`);
    assert.ok(!t.includes(MISSING_VALUE.en) && !t.includes(MISSING_VALUE.hi), `${what}: ${t}`);
    assert.doesNotMatch(t, /[a-z]+_[a-z]+/, `${what}: snake_case in "${t}"`);
  }
}

describe("catalogue audit", () => {
  it("every template, band line and drill reason passes the text rules; enums are labelled", () => {
    assert.deepEqual(auditCatalogue(catalogue), []);
  });

  it("every finding in the catalogue has en + hi templates (P2 DoD)", () => {
    assert.equal(new Set(catalogue.findings.map((f) => f.game_id)).size, 10);
    for (const f of catalogue.findings) {
      const slots = f.polarity === "negative" ? (["lacked", "could"] as const) : (["how"] as const);
      for (const s of slots) {
        for (const l of ["en", "hi"] as const) {
          assert.ok((f.templates[s]?.[l] ?? "").trim().length > 0, `${f.finding_id}.${s}.${l}`);
        }
      }
    }
  });

  it("the fallback lines and card labels pass the text rules themselves", () => {
    for (const l of ["en", "hi"] as const) {
      const f = FALLBACK_TEXT[l];
      const c = (text: string, field: "how_you_did" | "point_text" | "drill_why") =>
        checkText(text, { field, path: field, locale: l, allowedKeys: [] });
      assert.deepEqual(
        [
          ...c(f.how, "how_you_did"),
          ...c(f.lacked, "point_text"),
          ...c(f.could, "point_text"),
          ...c(f.why, "drill_why"),
        ],
        [],
        l,
      );
      const { footer: _footer, ...rest } = CARD_LABELS[l];
      for (const text of Object.values(rest)) assert.deepEqual(c(text, "drill_why"), [], text);
    }
    assert.equal(CARD_LABELS.en.autoNotes, "Auto notes");
    assert.equal(CARD_LABELS.hi.autoNotes, "स्वचालित नोट्स");
  });
});

describe("golden vectors × catalogue", () => {
  for (const v of goldenVectors()) {
    const r = v.expectedResult;
    it(`${v.name}: findings, facts and enum labels are known to the catalogue`, () => {
      for (const f of r.findings) {
        const entry = byId.get(f.findingId);
        assert.ok(entry !== undefined, `${f.findingId} not in catalogue`);
        assert.equal(entry.game_id, r.gameId, f.findingId);
        const kinds = new Map(entry.facts.map((x) => [x.key, x.kind]));
        for (const [key, value] of Object.entries(f.facts)) {
          const kind = kinds.get(key);
          assert.ok(kind !== undefined, `${f.findingId}.${key} not declared`);
          if (kind !== "enum" && kind !== "enum_list") continue;
          for (const part of String(value).split(",")) {
            const label = labels.get(key)?.get(part);
            assert.ok(label?.en && label.hi, `${f.findingId}.${key}=${part} has no en + hi label`);
          }
        }
      }
    });

    it(`${v.name}: template card renders in en and hi and passes the validator`, () => {
      for (const locale of ["en", "hi"] as const) {
        const pack = generateFindings(r, {}, catalogue, { locale });
        const card = renderTemplateCard(pack, catalogue, locale, { ...OPTS, sid: r.sid });
        assert.equal(card.kind, "auto_notes");
        assert.equal(card.locale, locale);
        assert.equal(card.label, CARD_LABELS[locale].footer);
        assertCardClean(card, `${v.name} ${locale}`);
        // No rule is verified today: every point cites UNKNOWN and shows no chip (§9).
        for (const p of [...card.where_you_lacked, ...card.what_you_could_have_done]) {
          assert.equal(p.ruleId, "UNKNOWN");
          assert.equal(p.rule, null);
        }
        assertTemplatePasses(pack, locale, v.name);
      }
    });
  }

  it("Hinglish falls back to the hi templates", () => {
    const r = goldenVectors().find((v) => v.name === "nazar-medium")
      ?.expectedResult as SessionResult;
    const pack = generateFindings(r, {}, catalogue, { locale: "hinglish" });
    const card = renderTemplateCard(pack, catalogue, "hinglish", { ...OPTS, sid: r.sid });
    const hi = renderTemplateCard(
      generateFindings(r, {}, catalogue, { locale: "hi" }),
      catalogue,
      "hi",
      { ...OPTS, sid: r.sid },
    );
    assert.equal(card.locale, "hi");
    assert.deepEqual(texts(card), texts(hi));
  });

  it("rule chips render only for verified rules", () => {
    const verified: DebriefCatalogue = {
      ...catalogue,
      rules: catalogue.rules.map((x) =>
        x.rule_id === "RR-HVY-003"
          ? { ...x, verified: true, ai_citable: true, verified_on: "2026-10-24" }
          : x,
      ),
    };
    const r = goldenVectors().find((v) => v.name === "bs-left-overtake")
      ?.expectedResult as SessionResult;
    const card = renderTemplateCard(generateFindings(r, {}, verified), verified, "en", {
      ...OPTS,
      sid: r.sid,
    });
    assert.equal(card.where_you_lacked[0]?.ruleId, "RR-HVY-003");
    assert.equal(card.where_you_lacked[0]?.rule?.id, "RR-HVY-003");
    assert.equal(card.where_you_lacked[1]?.rule, null, "RR-HVY-001 is still unverified");
  });
});

describe("every catalogue finding renders from synthetic facts", () => {
  const base = goldenVectors()[0]?.expectedResult as SessionResult;
  const firstValue = (key: string): string => {
    const values = [...(labels.get(key)?.keys() ?? [])];
    assert.ok(values.length > 0, `no labels for ${key}`);
    return key.endsWith("_parts") || key.endsWith("_families")
      ? values.slice(0, 2).join(",")
      : (values[0] as string);
  };
  const synthetic = (entry: CatalogueFinding): Finding => {
    const facts: Record<string, string | number | boolean> = {};
    for (const x of entry.facts) {
      if (x.kind === "enum" || x.kind === "enum_list") facts[x.key] = firstValue(x.key);
      else if (x.kind === "boolean") facts[x.key] = true;
      else if (x.kind === "ratio") facts[x.key] = 0.31;
      else facts[x.key] = 2;
    }
    const pattern = (
      entry as CatalogueFinding & { drill_pattern?: { template: string; fact_key: string } | null }
    ).drill_pattern;
    const drillIds =
      entry.drill_ids.length > 0
        ? entry.drill_ids.slice(0, 3)
        : pattern
          ? [
              pattern.template.replace(
                `{${pattern.fact_key}}`,
                String(facts[pattern.fact_key]).toUpperCase(),
              ),
            ]
          : [];
    return {
      findingId: entry.finding_id,
      severity: 0.5,
      critical: entry.critical,
      ruleIds: entry.rule_ids.slice(0, 8),
      skillId: entry.skill.id ?? "SK-M18",
      drillIds,
      facts,
    };
  };

  for (const entry of catalogue.findings) {
    it(`${entry.finding_id} (${entry.game_id}, ${entry.polarity})`, () => {
      const r: SessionResult = {
        ...base,
        gameId: entry.game_id as SessionResult["gameId"],
        findings: [synthetic(entry)],
      };
      for (const locale of ["en", "hi"] as const) {
        const pack = generateFindings(r, {}, catalogue, { locale });
        const card = renderTemplateCard(pack, catalogue, locale, { ...OPTS, sid: r.sid });
        assertCardClean(card, `${entry.finding_id} ${locale}`);
        if (entry.polarity === "negative") {
          assert.equal(card.where_you_lacked[0]?.findingId, entry.finding_id);
          assert.ok(pack.drillCandidates.length > 0);
        } else {
          assert.deepEqual(
            pack.positives.map((p) => p.findingId),
            [entry.finding_id],
          );
        }
        assertTemplatePasses(pack, locale, entry.finding_id);
      }
    });
  }
});
