# @margdarshak/content

Zod schemas, typed loaders, cross-file validators, the LL answer-key split and the AI allowlist generator for the learning content in [`content/`](../../content/README.md).

- The package depends on `zod` only. The entry point (`.`) is environment-free and runs in the browser, the score verifier and Node.
- Disk loaders live in `./node`.
- The package code is Apache-2.0. The data in `content/` is CC-BY-4.0.

## API

```ts
import {
  parseContent,          // RawContent → Content (throws ContentError listing every schema issue)
  splitQuestionBank,     // QuestionBankFile[] → { client, practiceKey, serverKey }
  buildAllowlists,       // (Content, inputHashes) → AllowlistsFile
  citableRuleIds,        // Set of rule IDs with verified && kind != "medical"
  checkTemplateText,     // DEBRIEF_SPEC §6.3 text rules for one string
  runContentChecks,      // all pure cross-file checks → { [check]: issues[] }
  SCHEMAS, toJsonSchema, // registry → JSON Schema 2020-12 documents
} from "@margdarshak/content";

import {
  loadContent,           // read + validate content/ → Content
  readRulepacks,         // rulepacks/ (read-only) for rule-pack cross-checks
  generateAllowlists,    // Content → AllowlistsFile (with sha256 input hashes)
  readWordingTerms,      // scripts/lint_wording.terms.json
} from "@margdarshak/content/node";
```

### Schemas (`src/schema/*.ts`)

| Module | File-level schema | Notes |
|---|---|---|
| `common.ts` | n/a | ID patterns, closed enums shared with game-core (`GameId`, `HazardType`, `SignFamily`, `LlTopic`), `LocalizedText`, `Source`, file header |
| `rules.ts` | `RulesFile` | Refinement: `ai_citable === verified && kind !== "medical"`. A verified row needs `verified_on` and two reviewers |
| `findings.ts` | `FindingsFile` | Fact kinds for the renderer; templates `lacked` / `could` / `how`; `drill_pattern` (`DR-NAZ-OCCL-{hazard_type}`) |
| `drills.ts` | `DrillsFile` | Deep link `margdarshak://play/<gameId>?drill=<id>&level={level}`; `availability` |
| `skills.ts`, `games.ts`, `hazards.ts`, `enums.ts` | `…File` | |
| `signs.ts` | `SignsFile`, `IllustrationsFile` | Shape, colour scheme and symbol class drive the similarity levels |
| `curriculum.ts` | `Module` | One file per module |
| `questions.ts` | `QuestionBankFile` | `items[].key` and `concepts[].explanation` are **server-only** |
| `allowlists.ts` | `AllowlistsFile` | Sorted, unique ID lists per agent |

### Checks (`src/checks.ts`)

Each check returns a list of issues, and an empty list means it passed. The tests assert each check on its own, and each check has a negative test that seeds a defect.

| Check | What it enforces |
|---|---|
| `checkDuplicateIds` | Unique IDs across every catalogue, module element, concept, item and explanation; unique sign names and alt texts |
| `checkReferences` | Every rule, drill, skill, module, game, sign, illustration and concept reference resolves; drill patterns expand to real drills |
| `checkRulepackRefs` | Rule-pack rows exist in `rulepacks/`; values quoted by LL items (`rulepack_facts`) equal the rule pack's and come from verified rows |
| `checkTemplates` | Every template passes V1 (digits), V3 (placeholders ⊆ facts), V5 (tone), V6 (script share), V7 (length) and V10 (fees) |
| `checkFindingLocales` | Every finding has en and Devanagari hi |
| `checkVariants` | 3–6 variants per concept; unique stems (en and hi); unique option texts |
| `checkPositionBalance` | Correct options are spread evenly over a–d (or a–c, a–b); no concept always uses the same position |
| `checkSimilarity` | Computed similarity levels match the sign data |
| `checkOptionConsistency` | Sign options use catalogue names or alt texts; the answer is the concept's own sign; a stem never shows the answer |
| `checkBankSize` | At least 60 concepts and 200 items; at least 10 concepts, 30 items and 10 mock variants per topic |
| `checkWording` | D-19 terms from `scripts/lint_wording.terms.json`; no ₹, Rs, INR, rupees, or fee next to a number |
| `checkAiCitable`, `checkHazardDrills`, `checkAllowlists` | The formula holds; every hazard type has its occlusion drill; every allowlist ID is in its catalogue |

### Allowlists (`src/allowlists.ts`)

`buildAllowlists` writes one block per agent:

| Agent | Lists |
|---|---|
| DebriefAgent (M-02) | `finding_ids` (excluding template-only Golden Hour), `rule_ids` (only `ai_citable` rules the findings cite), `drill_ids`, `fact_keys` per finding |
| TutorAgent (M-04) | `explanation_ids` (approved in en and hi), `rule_ids` (citable LL rules) |
| VoiceGuideAgent (M-01) | `get_rule_ids` (citable), `open_drill_ids` (drills whose game exists in Phase 1–2) |
| CoachAgent (M-03) | `drill_ids` (Phase 1–2 drills) |
| SignSnap (M-07) | `sign_ids` (mandatory, cautionary and informatory signs) |

The output has no timestamps. Every list is sorted, and `inputs` holds the sha256 of each input's canonical JSON, so a stale file is detectable. The Go API reads `content/generated/allowlists.json`. Per-request enums must be subsets of these lists.

### Answer-key split (`src/split.ts`)

`splitQuestionBank(banks)` returns three outputs:

- **`client`**: items with stems, options and assets, and no keys, explanations or concept titles.
- **`practiceKey`**: keys and explanations for practice items only.
- **`serverKey`**: every key, including mock items, for the score verifier.

`toLlAnswerKeys(serverKey, signs)` (`src/answer-keys.ts`) turns the server key into game-core `LlAnswerKey` documents, the shape the score verifier replays LL sessions with:
- `qref` is the item ID (the session item ref is `q:<qref>`);
- `cardId` is the concept, so every variant reviews the same FSRS card;
- the sign is the correct option's sign, and `signFamily` comes from `signs.json`.

A contract test checks the output against game-core's Zod schema.

## Scripts

Run these from `packages/content`:

| Command | Does |
|---|---|
| `node --test --experimental-strip-types "test/**/*.test.ts"` | All tests |
| `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | Typecheck |
| `node --experimental-strip-types scripts/validate.ts` | Every check, including rule-pack and wording checks |
| `node --experimental-strip-types scripts/gen-schemas.ts` | Regenerate `content/schema/*.schema.json` (the drift test fails until you do) |
| `node --experimental-strip-types scripts/gen-allowlists.ts` | Regenerate `content/generated/allowlists.json` (the drift test fails until you do) |
| `node --experimental-strip-types scripts/gen-client-bank.ts` (`gen:client-bank`) | Regenerate the committed `content/generated/ll-bank.client.json` and `ll-bank.practice-key.json` (the drift test fails until you do) |
| `node --experimental-strip-types scripts/split-questions.ts --out <dir>` | Write the client bank, practice key and server key (not committed) |
| `tsc -p tsconfig.build.json` (`build`) | Emit `dist/` for Node consumers; exports use the `margdarshak-source` condition for source and `dist` otherwise, like game-core |

## Tests (`test/`)

| File | Covers |
|---|---|
| `schema.test.ts` | Every file parses; `$schema` pointers; JSON Schema drift; strictness |
| `catalogue.test.ts` | Spec coverage (`test/spec.ts` transcribes DEBRIEF_SPEC §2–§4): rule statuses, `ai_citable`, finding facts, critical flags, rules, drills; only documented legal section numbers; occlusion drills; skill tree |
| `integrity.test.ts` | Duplicate IDs; referential integrity; rule-pack rows and quoted values; J&K overrides |
| `templates.test.ts` | Template text rules; placeholders ⊆ facts; same placeholders in en and hi; locales |
| `questions.test.ts` | Bank size and topic balance; variants; position balance; similarity; options; the split |
| `wording.test.ts` | D-19 and D-06 over the whole pack; no stunt or speed content |
| `allowlists.test.ts` | Drift; determinism; subsets; citable-only rules; Golden Hour exclusion; Phase 1–2 drills |
| `curriculum.test.ts` | 28 modules; priority and scope; depth contract; J&K gating; readiness; M19 medical gate; unverified limits never typed; stopping-distance arithmetic |
