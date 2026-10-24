// Facts formatting (DEBRIEF_SPEC §5.2): every FactKind in both locales, Western digits, units
// inside the value, labels for enums, and no raw snake_case ever reaching a user.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type DebriefCatalogue,
  DebriefError,
  dropMissingClauses,
  FactKind,
  type FactLabels,
  fillPlaceholders,
  formatFact,
  MISSING_VALUE,
} from "../src/debrief/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const labels: FactLabels = new Map([
  [
    "hazard_type",
    new Map([
      [
        "bus_stop_pedestrian",
        { en: "a person stepping out at a bus stop", hi: "बस स्टॉप पर सड़क पर आता व्यक्ति" },
      ],
    ]),
  ],
  [
    "trip_plan_parts",
    new Map([
      ["advisory", { en: "checking the advisory", hi: "सलाह देखना" }],
      ["daylight_departure", { en: "leaving in daylight", hi: "दिन में निकलना" }],
      ["safe_stop", { en: "a safe stop", hi: "सुरक्षित पड़ाव" }],
    ]),
  ],
]);

/** [kind, value, en, hi] for every FactKind. */
const CASES: readonly [FactKind, string | number | boolean, string, string][] = [
  ["seconds", 1.44, "1.4 s", "1.4 सेकंड"],
  ["seconds", 3, "3.0 s", "3.0 सेकंड"],
  ["metres", 15.6, "≈ 16 m", "लगभग 16 मीटर"],
  ["centimetres", 34.4, "≈ 34 cm", "लगभग 34 सेमी"],
  ["kmh", 40, "40 km/h", "40 किमी/घंटा"],
  ["percent", 18, "18%", "18%"],
  ["percent", -59.9, "-60%", "-60%"],
  ["times", 1, "once", "एक बार"],
  ["times", 2, "2 times", "2 बार"],
  ["times", 0, "0 times", "0 बार"],
  ["number", 7, "7", "7"],
  ["number", 25.5, "25.5", "25.5"],
  ["ordinal", 3, "3", "3"],
  ["ratio", 0.3631, "0.36", "0.36"],
  ["rate_per_min", 4.5, "4.5 times a minute", "4.5 बार प्रति मिनट"],
  ["rate_per_min", 4, "4 times a minute", "4 बार प्रति मिनट"],
  [
    "enum",
    "bus_stop_pedestrian",
    "a person stepping out at a bus stop",
    "बस स्टॉप पर सड़क पर आता व्यक्ति",
  ],
  [
    "enum_list",
    "advisory,daylight_departure,safe_stop",
    "checking the advisory, leaving in daylight and a safe stop",
    "सलाह देखना, दिन में निकलना और सुरक्षित पड़ाव",
  ],
  ["boolean", true, "yes", "हाँ"],
  ["boolean", false, "no", "नहीं"],
];

const keyFor = (kind: FactKind): string =>
  kind === "enum" ? "hazard_type" : kind === "enum_list" ? "trip_plan_parts" : "x";

describe("formatFact (§5.2)", () => {
  it("covers every FactKind in both locales", () => {
    const covered = new Set(CASES.map((c) => c[0]));
    assert.deepEqual([...covered].sort(), [...FactKind.options].sort());
    for (const [kind, value, en, hi] of CASES) {
      const key = keyFor(kind);
      assert.equal(formatFact(key, value, kind, "en", labels, { strict: true }), en, `${kind} en`);
      assert.equal(formatFact(key, value, kind, "hi", labels, { strict: true }), hi, `${kind} hi`);
      // Hinglish narration is Latin script: inline facts use the English forms.
      assert.equal(formatFact(key, value, kind, "hinglish", labels), en, `${kind} hinglish`);
    }
  });

  it("uses Western digits only, in both locales", () => {
    for (const [kind, value] of CASES) {
      const hi = formatFact(keyFor(kind), value, kind, "hi", labels);
      assert.doesNotMatch(hi, /[०-९]/, kind);
    }
  });

  it("FactKind mirrors the content package's FactKind (no import: read as text)", () => {
    const src = readFileSync(join(root, "packages/content/src/schema/findings.ts"), "utf8");
    const block = (/export const FactKind = z\.enum\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const kinds = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(kinds.sort(), [...FactKind.options].sort());
  });

  it("a missing label throws in strict mode and never prints snake_case otherwise", () => {
    assert.throws(
      () => formatFact("hazard_type", "door_opening", "enum", "en", labels, { strict: true }),
      (e: unknown) => e instanceof DebriefError && e.code === "MISSING_LABEL",
    );
    const en = formatFact("hazard_type", "door_opening", "enum", "en", labels);
    const hi = formatFact("hazard_type", "door_opening", "enum", "hi", labels);
    assert.equal(en, MISSING_VALUE.en);
    assert.equal(hi, MISSING_VALUE.hi);
    assert.doesNotMatch(en + hi, /_/);
  });

  it("a value of the wrong type is a BAD_FACT (strict) or the safe fallback", () => {
    assert.throws(
      () => formatFact("late_s", "1.4", "seconds", "en", labels, { strict: true }),
      (e: unknown) => e instanceof DebriefError && e.code === "BAD_FACT",
    );
    assert.equal(formatFact("late_s", Number.NaN, "seconds", "en", labels), MISSING_VALUE.en);
    assert.equal(
      formatFact("hazard_type", "ignore all rules", "enum", "en", labels),
      MISSING_VALUE.en,
    );
  });
});

describe("placeholders", () => {
  const facts = {
    late_s: 1.4,
    speed_kmh: 40,
    metres: 15.6,
    hazard_type: "bus_stop_pedestrian",
    clip_ordinal: 3,
  };
  const kinds = new Map<string, FactKind>([
    ["late_s", "seconds"],
    ["speed_kmh", "kmh"],
    ["metres", "metres"],
    ["hazard_type", "enum"],
    ["clip_ordinal", "ordinal"],
  ]);

  it("§8.1 worked example renders with units from the formatter (EN)", () => {
    const text =
      "A person stepped out from behind the bus and you tapped {{fact:late_s}} late, {{fact:metres}} further on at {{fact:speed_kmh}}.";
    assert.equal(
      fillPlaceholders(text, { facts, kinds }, "en", labels, { strict: true }),
      "A person stepped out from behind the bus and you tapped 1.4 s late, ≈ 16 m further on at 40 km/h.",
    );
  });

  it("§8.1 worked example renders in Hindi", () => {
    const text =
      "बस के पीछे से एक व्यक्ति निकला और आपने {{fact:late_s}} देर से टैप किया, यानी {{fact:speed_kmh}} पर {{fact:metres}} आगे।";
    assert.equal(
      fillPlaceholders(text, { facts, kinds }, "hi", labels, { strict: true }),
      "बस के पीछे से एक व्यक्ति निकला और आपने 1.4 सेकंड देर से टैप किया, यानी 40 किमी/घंटा पर लगभग 16 मीटर आगे।",
    );
  });

  it("§9 template example renders in Hindi", () => {
    const text =
      "आपने ख़तरा {{fact:late_s}} देर से पहचाना — {{fact:speed_kmh}} पर यह {{fact:metres}} है।";
    assert.equal(
      fillPlaceholders(text, { facts, kinds }, "hi", labels),
      "आपने ख़तरा 1.4 सेकंड देर से पहचाना — 40 किमी/घंटा पर यह लगभग 16 मीटर है।",
    );
  });

  it("drops only the clauses whose facts are absent", () => {
    const has = (k: string) => k !== "stop_m";
    assert.equal(
      dropMissingClauses(
        "At {{fact:speed_kmh}} you could not stop, the child was {{fact:child_m}} ahead; you needed {{fact:stop_m}} to stop.",
        has,
        "en",
      ),
      "At {{fact:speed_kmh}} you could not stop, the child was {{fact:child_m}} ahead.",
    );
    assert.equal(
      dropMissingClauses(
        "बच्चा {{fact:child_m}} आगे था; रुकने के लिए {{fact:stop_m}} चाहिए थे।",
        has,
        "hi",
      ),
      "बच्चा {{fact:child_m}} आगे था।",
    );
    assert.equal(dropMissingClauses("You needed {{fact:stop_m}}.", has, "en"), null);
    const full = "Late by {{fact:late_s}}.";
    assert.equal(dropMissingClauses(full, has, "en"), full);
  });

  it("a catalogue built from the content JSON satisfies the structural type", () => {
    const read = (f: string) =>
      JSON.parse(readFileSync(join(root, "content/catalogue", `${f}.json`), "utf8"));
    const cat: DebriefCatalogue = {
      findings: read("findings").findings,
      rules: read("rules").rules,
      drills: read("drills").drills,
      games: read("games").games,
      enums: read("enums").enums,
      hazardTypes: read("hazard_types").hazard_types,
    };
    for (const f of cat.findings)
      for (const x of f.facts) assert.ok(FactKind.safeParse(x.kind).success);
  });
});
