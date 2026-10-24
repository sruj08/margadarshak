// DebriefDraft validator (DEBRIEF_SPEC §6.3): every rule V1–V10 passes and fails, the §8.1 draft
// passes, the §8.5 "₹0 fee" draft fails V1 + V10, the retry message format, and the shared
// validator-spec.json stays inside the regex subset Go RE2 also understands.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type DebriefCatalogue,
  type DebriefDraft,
  DebriefError,
  debriefCatalogue,
  escapeHtml,
  type FactsPack,
  generateFindings,
  renderDraft,
  retryHint,
  scriptShare,
  unescapeHtml,
  VALIDATOR_SPEC,
  type Violation,
  validateDraft,
  violatedRules,
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
/** The catalogue after the Phase 1 review flips RR-PED-001 (practice) to verified. */
const verifiedCatalogue: DebriefCatalogue = {
  ...catalogue,
  rules: catalogue.rules.map((r) =>
    r.rule_id === "RR-PED-001"
      ? { ...r, verified: true, ai_citable: true, verified_on: "2026-10-24" }
      : r,
  ),
};

const base = goldenVectors().find((v) => v.name === "nazar-medium")
  ?.expectedResult as SessionResult;
const late: Finding = {
  findingId: "NAZ_LATE_RESPONSE",
  severity: 0.47,
  critical: false,
  ruleIds: ["RR-PED-001"],
  skillId: "SK-M18",
  drillIds: ["DR-NAZ-OCCL-BUS_STOP_PEDESTRIAN"],
  facts: {
    clip_ordinal: 3,
    hazard_type: "bus_stop_pedestrian",
    late_s: 1.4,
    metres: 15.6,
    speed_kmh: 40,
  },
};
const missed: Finding = {
  findingId: "NAZ_MISSED_HAZARD",
  severity: 0.4,
  critical: false,
  ruleIds: ["RR-PED-001"],
  skillId: "SK-M18",
  drillIds: ["DR-NAZ-OCCL-CHILD_SCHOOL"],
  facts: { clip_ordinal: 5, hazard_type: "child_school", missed_count: 1 },
};
const result = (findings: Finding[]): SessionResult => ({ ...base, findings });
const pack = (locale: "en" | "hi" | "hinglish" = "en", cat = verifiedCatalogue): FactsPack =>
  generateFindings(result([late, missed]), {}, cat, { locale });

/** The §8.1 model draft (valid: no digits, closed IDs). */
const draft81: DebriefDraft = {
  locale: "en",
  how_you_did: "You spotted most hazards, and the bus-stop ones are where you lost marks.",
  where_you_lacked: [
    {
      finding_id: "NAZ_LATE_RESPONSE",
      rule_id: "RR-PED-001",
      text: "A person stepped out from behind the bus and you tapped {{fact:late_s}} late, {{fact:metres}} further on at {{fact:speed_kmh}}.",
    },
  ],
  what_you_could_have_done: [
    {
      finding_id: "NAZ_LATE_RESPONSE",
      rule_id: "RR-PED-001",
      text: "When a bus is stopped, watch the gap at its front edge; feet show before the person does.",
    },
  ],
  next_drill: {
    drill_id: "DR-NAZ-OCCL-BUS_STOP_PEDESTRIAN",
    why: "Three short bus-stop clips that pause just before the hazard.",
  },
  unknown: false,
};
const draftHi: DebriefDraft = {
  locale: "hi",
  how_you_did: "आपने ज़्यादातर ख़तरे पहचाने; बस स्टॉप वाले ख़तरों पर अंक कटे।",
  where_you_lacked: [
    {
      finding_id: "NAZ_LATE_RESPONSE",
      rule_id: "RR-PED-001",
      text: "बस के पीछे से एक व्यक्ति निकला और आपने {{fact:late_s}} देर से टैप किया, यानी {{fact:speed_kmh}} पर {{fact:metres}} आगे।",
    },
  ],
  what_you_could_have_done: [
    {
      finding_id: "NAZ_LATE_RESPONSE",
      rule_id: "RR-PED-001",
      text: "रुकी हुई बस के आगे वाले किनारे पर नज़र रखें; व्यक्ति से पहले उसके पैर दिखते हैं।",
    },
  ],
  next_drill: {
    drill_id: "DR-NAZ-OCCL-BUS_STOP_PEDESTRIAN",
    why: "बस स्टॉप की तीन छोटी क्लिप, जो ख़तरे से ठीक पहले रुकती हैं।",
  },
  unknown: false,
};

type Edit = (d: DebriefDraft) => void;
const edited = (edit: Edit, from: DebriefDraft = draft81): DebriefDraft => {
  const d = structuredClone(from);
  edit(d);
  return d;
};
const rulesOf = (d: unknown, p: FactsPack = pack()): string[] =>
  validateDraft(d, p).violations.map((v) => v.rule);
const point0 = (d: DebriefDraft) => d.where_you_lacked[0] as DebriefDraft["where_you_lacked"][0];

describe("validator: the spec's own drafts", () => {
  it("§8.1 draft passes (EN), 'feet' included", () => {
    assert.deepEqual(validateDraft(draft81, pack()), { verdict: "pass", violations: [] });
  });

  it("§8.1 draft passes (HI)", () => {
    assert.deepEqual(validateDraft(draftHi, pack("hi")), { verdict: "pass", violations: [] });
  });

  it("§8.5 '₹0 fee' draft is rejected by V1 + V10", () => {
    const d = edited((x) => {
      x.how_you_did = "Good news, the licence fee is ₹0 if you pass Nazar.";
    });
    const r = validateDraft(d, pack());
    assert.equal(r.verdict, "reject");
    assert.deepEqual(violatedRules(r.violations), ["V1", "V10"]);
  });

  it("with today's catalogue no rule is citable: RR-PED-001 fails V2, UNKNOWN passes", () => {
    const p = pack("en", catalogue);
    assert.deepEqual(p.allowedRuleIds, []);
    assert.deepEqual(rulesOf(draft81, p), ["V2", "V2"]);
    const unknown = edited((x) => {
      for (const pt of [...x.where_you_lacked, ...x.what_you_could_have_done])
        pt.rule_id = "UNKNOWN";
    });
    assert.deepEqual(rulesOf(unknown, p), []);
  });
});

describe("validator rules V1–V10", () => {
  it("V1: Latin and Devanagari digits fail; digits inside placeholders are stripped first", () => {
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = "You missed 2 hazards.";
        }),
      ),
      ["V1"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = "आपने २ ख़तरे छोड़े।";
        }, draftHi),
        pack("hi"),
      ),
      ["V1"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.next_drill.why = "Clips 3 to 5.";
        }),
      ),
      ["V1"],
    );
    // late_s and speed_kmh contain no digits, but clip_ordinal is a digit-free key too; a key with
    // a digit-like name still strips cleanly.
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          point0(x).text = "In clip {{fact:clip_ordinal}} you were late.";
        }),
      ),
      [],
    );
  });

  it("V2: closed finding, rule and drill IDs, and improved_since_last", () => {
    const wrongId = validateDraft(
      edited((x) => {
        point0(x).finding_id = "NAZ_FALSE_ALARMS";
      }),
      pack(),
    );
    assert.deepEqual(violatedRules(wrongId.violations), ["V2", "V3", "V4", "V8"]);
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          point0(x).rule_id = "RR-HVY-002";
        }),
      ),
      ["V2"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.next_drill.drill_id = "DR-NAZ-MOCK";
        }),
      ),
      ["V2"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.improved_since_last = "NAZ_PATTERN_CLICK";
        }),
      ),
      ["V2"],
    );
    const withHistory = generateFindings(
      result([late]),
      { lastDebriefs: [{ findingIds: ["NAZ_PATTERN_CLICK"] }] },
      verifiedCatalogue,
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.improved_since_last = "NAZ_PATTERN_CLICK";
        }),
        withHistory,
      ),
      [],
    );
  });

  it("V3: placeholders must be facts of their own finding; none in the drill reason", () => {
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          point0(x).text = "You missed {{fact:missed_count}}.";
        }),
      ),
      ["V3"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = "Late by {{fact:late_s}}.";
        }),
      ),
      ["V3"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.next_drill.why = "Faster than {{fact:late_s}}.";
        }),
      ),
      ["V3"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          point0(x).text = "Late by {{late_s}}.";
        }),
      ),
      ["V3"],
    );
    // how_you_did may use the positives' facts.
    const withPositive = generateFindings(
      result([late]),
      { nazarLateS: { firstSessions: [1.2, 1.1, 1.0], current: 0.6, speedKmh: 36 } },
      verifiedCatalogue,
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = "You now react {{fact:gain_s}} earlier.";
        }),
        withPositive,
      ),
      [],
    );
  });

  it("V4: the first lacked point is the top finding", () => {
    const d = edited((x) => {
      x.where_you_lacked = [
        {
          finding_id: "NAZ_MISSED_HAZARD",
          rule_id: "UNKNOWN",
          text: "A child near the school gate went untapped.",
        },
        ...x.where_you_lacked,
      ];
    });
    assert.deepEqual(rulesOf(d), ["V4"]);
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.where_you_lacked = [];
          x.what_you_could_have_done = [];
        }),
      ),
      ["V4"],
    );
  });

  it("V5: tone bans in EN, HI and Hinglish", () => {
    for (const bad of [
      "You would have crashed there.",
      "You are a certified safe driver now.",
      "This is the official result.",
      "Great reflexes on that one!",
      "Don't worry beta, you will pass.",
      "Kerala's test is easy for you.",
      "Pakka pass hai, tension mat lo.",
    ]) {
      assert.ok(
        rulesOf(
          edited((x) => {
            x.how_you_did = bad;
          }),
        ).includes("V5"),
        bad,
      );
    }
    assert.ok(
      rulesOf(
        edited((x) => {
          x.how_you_did = "बेटा, ध्यान दो।";
        }, draftHi),
        pack("hi"),
      ).includes("V5"),
    );
    assert.ok(
      rulesOf(
        edited((x) => {
          x.how_you_did = "यहाँ मौत हो सकती थी।";
        }, draftHi),
        pack("hi"),
      ).includes("V5"),
    );
  });

  it("V6: script share per locale, and the draft locale must match the pack", () => {
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = "You did well.";
        }, draftHi),
        pack("hi"),
      ),
      ["V6"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = "आपने अच्छा किया।";
        }),
      ),
      ["V6"],
    );
    assert.ok(rulesOf(draftHi, pack("en")).includes("V6"));
    const hinglish = edited((x) => {
      x.locale = "hinglish";
      x.how_you_did = "Aapne zyaadatar khatre pehchaane, bus stop wale khatron par marks kate.";
    });
    assert.deepEqual(rulesOf(hinglish, pack("hinglish")), []);
    assert.ok(scriptShare("आपने {{fact:hazard_type}} देर से पहचाना", "hi") > 0.95);
    assert.equal(scriptShare("{{fact:late_s}} —", "en"), 1);
  });

  it("V7: lengths 160 / 140 / 120", () => {
    const words = (n: number) => "a".repeat(n);
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = words(160);
        }),
      ),
      [],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = words(161);
        }),
      ),
      ["V7"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          point0(x).text = words(141);
        }),
      ),
      ["V7"],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.next_drill.why = words(120);
        }),
      ),
      [],
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.next_drill.why = words(121);
        }),
      ),
      ["V7"],
    );
  });

  it("V8: at most 3 points, no duplicates, could ⊆ lacked", () => {
    const p = point0(draft81);
    assert.ok(
      rulesOf(
        edited((x) => {
          x.where_you_lacked = [p, p, p, p];
        }),
      ).includes("V8"),
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.where_you_lacked = [p, p];
        }),
      ),
      ["V8"],
    );
    const notLacked = edited((x) => {
      x.what_you_could_have_done.push({
        finding_id: "NAZ_MISSED_HAZARD",
        rule_id: "UNKNOWN",
        text: "Keep your eyes moving.",
      });
    });
    assert.deepEqual(rulesOf(notLacked), ["V8"]);
  });

  it("V9: escaping is applied at render (never a rejection)", () => {
    assert.equal(escapeHtml("<b>Tom & Jerry</b>"), "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
    assert.equal(unescapeHtml(escapeHtml("a < b & c > d")), "a < b & c > d");
    assert.equal(escapeHtml("didn't"), "didn't");
    const d = edited((x) => {
      x.how_you_did = "You spotted most hazards <script>x</script>.";
    });
    assert.equal(validateDraft(d, pack()).verdict, "pass");
    const card = renderDraft(d, pack(), verifiedCatalogue, "en", {
      now: "2026-10-24T10:41:07Z",
      sid: base.sid,
      generatorVersion: "game-core 0.1.0",
      model: "gemini-3.1-flash-lite",
    });
    assert.ok(!card.how_you_did.includes("<script>"));
    assert.ok(card.how_you_did.includes("&lt;script&gt;"));
  });

  it("V10: rupee and fee terms, 'fee' as a whole word only", () => {
    for (const bad of [
      "The fee is waived.",
      "No fees today.",
      "Save rupees.",
      "Pay ₹ later.",
      "Rs. later",
    ]) {
      assert.ok(
        rulesOf(
          edited((x) => {
            x.how_you_did = bad;
          }),
        ).includes("V10"),
        bad,
      );
    }
    assert.ok(
      rulesOf(
        edited((x) => {
          x.how_you_did = "शुल्क नहीं लगेगा।";
        }, draftHi),
        pack("hi"),
      ).includes("V10"),
    );
    assert.ok(
      rulesOf(
        edited((x) => {
          x.how_you_did = "सौ रुपये बचेंगे।";
        }, draftHi),
        pack("hi"),
      ).includes("V10"),
    );
    assert.deepEqual(
      rulesOf(
        edited((x) => {
          x.how_you_did = "Feet show before the person does; feedback helps.";
        }),
      ),
      [],
    );
  });

  it("MODE and SCHEMA pre-checks", () => {
    const gh = generateFindings(
      {
        ...base,
        gameId: "golden_hour",
        findings: [
          {
            ...late,
            findingId: "GH_HELMET_REMOVED",
            critical: true,
            severity: 1,
            ruleIds: ["RR-GHR-003"],
            drillIds: ["DR-GH-ORDER"],
            facts: {},
          },
        ],
      },
      {},
      catalogue,
    );
    assert.equal(gh.debriefMode, "template_only");
    assert.deepEqual(rulesOf(draft81, gh), ["MODE"]);
    assert.deepEqual(rulesOf({ ...draft81, extra: 1 }), ["SCHEMA"]);
    assert.deepEqual(rulesOf({ ...draft81, unknown: "no" }), ["SCHEMA"]);
  });
});

describe("retry and rendering", () => {
  it("retryHint follows the §6.3 format and suggests the finding's numeric facts", () => {
    const d = edited((x) => {
      point0(x).text = "You were 1.4 s late.";
    });
    const r = validateDraft(d, pack());
    const msg = retryHint(r.violations);
    assert.match(
      msg,
      /^Your draft broke V1 at where_you_lacked\[0\]\.text: remove the digit, use one of .*\{\{fact:late_s\}\}/,
    );
    const two: Violation[] = validateDraft(
      edited((x) => {
        x.how_you_did = "The fee is ₹0.";
      }),
      pack(),
    ).violations;
    // V1 for the digit, V10 twice ("₹" and "fee"): one line each.
    assert.equal(retryHint(two).split("\n").length, 3);
  });

  it("renderDraft fills facts, attaches allowed rule chips and throws on an invalid draft", () => {
    const card = renderDraft(draft81, pack(), verifiedCatalogue, "en", {
      now: "2026-10-24T10:41:07Z",
      sid: base.sid,
      generatorVersion: "game-core 0.1.0",
      model: "gemini-3.1-flash-lite",
    });
    assert.equal(card.kind, "coach_notes");
    assert.equal(card.notes_label, "Coach notes");
    assert.equal(card.label, "Practice and familiarisation, not certification");
    assert.equal(
      card.where_you_lacked[0]?.text,
      "A person stepped out from behind the bus and you tapped 1.4 s late, ≈ 16 m further on at 40 km/h.",
    );
    assert.equal(card.where_you_lacked[0]?.rule?.id, "RR-PED-001");
    assert.equal(
      card.next_drill.deeplink,
      "margdarshak://play/nazar?drill=DR-NAZ-OCCL-BUS_STOP_PEDESTRIAN&level=1",
    );
    assert.equal(card.model, "gemini-3.1-flash-lite");
    const hi = renderDraft(draftHi, pack("hi"), verifiedCatalogue, "hi", {
      now: "2026-10-24T10:41:07Z",
      sid: base.sid,
      generatorVersion: "game-core 0.1.0",
      model: "gemini-3.1-flash-lite",
    });
    assert.equal(
      hi.where_you_lacked[0]?.text,
      "बस के पीछे से एक व्यक्ति निकला और आपने 1.4 सेकंड देर से टैप किया, यानी 40 किमी/घंटा पर लगभग 16 मीटर आगे।",
    );
    assert.throws(
      () =>
        renderDraft(
          edited((x) => {
            x.how_you_did = "₹0 fee";
          }),
          pack(),
          verifiedCatalogue,
          "en",
          {
            now: "2026-10-24T10:41:07Z",
            sid: base.sid,
            generatorVersion: "game-core 0.1.0",
            model: "m",
          },
        ),
      (e: unknown) =>
        e instanceof DebriefError && e.code === "INVALID_DRAFT" && /V10/.test(e.message),
    );
  });
});

describe("validator-spec.json", () => {
  const patterns = (): { pattern: string; flags: string }[] => {
    const r = VALIDATOR_SPEC.rules;
    return [
      { pattern: VALIDATOR_SPEC.placeholder.pattern, flags: "" },
      { pattern: VALIDATOR_SPEC.placeholder.malformed_pattern, flags: "" },
      { pattern: r.V1.pattern, flags: "" },
      ...r.V5.banned.en,
      ...r.V5.banned.hi,
      ...r.V5.banned.hinglish,
      ...r.V10.patterns,
    ];
  };

  it("uses only the regex subset shared by ECMAScript and Go RE2", () => {
    for (const p of patterns()) {
      assert.doesNotThrow(() => new RegExp(p.pattern, p.flags), p.pattern);
      assert.doesNotMatch(
        p.pattern,
        /\(\?[=!<]|\\[1-9]|\\[pPkK]|\(\?</,
        `no lookaround/backrefs: ${p.pattern}`,
      );
      assert.ok(p.flags === "" || p.flags === "i", p.pattern);
    }
  });

  it("names a spec source for every rule and matches the DEBRIEF_SPEC limits", () => {
    for (const [id, rule] of Object.entries(VALIDATOR_SPEC.rules)) {
      assert.match(rule.source, /DEBRIEF_SPEC/, id);
    }
    assert.equal(VALIDATOR_SPEC.fields.how_you_did.max_chars, 160);
    assert.equal(VALIDATOR_SPEC.fields.point_text.max_chars, 140);
    assert.equal(VALIDATOR_SPEC.fields.drill_why.max_chars, 120);
    assert.equal(VALIDATOR_SPEC.rules.V8.max_points, 3);
    assert.equal(VALIDATOR_SPEC.rules.V6.thresholds.hi.min_share, 0.7);
    assert.equal(VALIDATOR_SPEC.rules.V6.thresholds.en.min_share, 0.9);
    assert.equal(VALIDATOR_SPEC.rules.V6.thresholds.hinglish.min_share, 0.9);
  });

  it("covers the §6.2 rule 4 list", () => {
    const tone = (t: string) =>
      rulesOf(
        edited((x) => {
          x.how_you_did = t;
        }),
      ).includes("V5");
    for (const phrase of [
      "certified",
      "official",
      "safe driver",
      "unsafe driver",
      "you would crash",
      "you would have died",
      "lives saved",
      "Kerala's test",
      "your RTO's track",
      "guaranteed",
      "beta",
    ]) {
      assert.ok(tone(`Note: ${phrase} here.`), phrase);
    }
  });
});
