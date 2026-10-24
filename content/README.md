# content/: Margdarshak learning content (data)

Structured, validated learning content for Phase P2: the LL (learner's licence) question bank, the curriculum modules, and the debrief catalogues that the AI allowlists are generated from. It sits next to `rulepacks/`, and the Go API and the TypeScript packages both read it as plain JSON.

Schemas, loaders, validators, the answer-key split and the allowlist generator live in [`packages/content`](../packages/content/README.md) (`@margdarshak/content`).

> Practice and familiarisation, not certification. Questions here are written by the team from cited sources. They are not the government's question bank.

## Layout

| Path | What | Count |
|---|---|---|
| `catalogue/rules.json` | Rule ID catalogue (DEBRIEF_SPEC §3), entry shape `{rule_id, kind, text_en, text_hi, source_title, source_url, verified_on, verified, reviewed_by, ai_citable}` plus review fields | 37 rules |
| `catalogue/findings.json` | Finding taxonomy for all ten games (DEBRIEF_SPEC §2) with reviewed-template text in en + hi (§9) | 60 findings |
| `catalogue/drills.json` | Drill catalogue (§4), with `DR-NAZ-OCCL-<TYPE>` expanded per hazard type | 61 drills |
| `catalogue/skills.json` | `SK-*` skill nodes (GAMIFICATION_ENGINE §3.1) | 28 nodes |
| `catalogue/games.json` | The ten games: modules, default drill, how-you-did band templates | 10 games |
| `catalogue/hazard_types.json` | Nazar hazard types (NAZAR §3.3) with labels, skill, rules and occlusion drill | 15 types |
| `catalogue/enums.json` | Labels (en + hi) for every enum-valued fact the scorers emit, including those drill patterns expand over (`surface`, `topic`, `sign_family`) | see the file |
| `catalogue/signs.json` | Sign catalogue `SIGN-<MAN/CAU/INF/MRK/SIG>-<nnn>` (IRC:67 families, IRC:35 markings, signals) | 67 signs |
| `catalogue/illustrations.json` | LL3 hand-signal pictures (rear, side and front views) and vehicle-light pictures | 18 pictures |
| `curriculum/<id>.json` | Modules LL0–LL4, M1–M22 and DL1 (CURRICULUM §2–§3) | 28 modules |
| `questions/ll1.json` … `ll4.json` | LL question bank, one topic per file, concepts with nested item variants | 75 concepts, 239 items |
| `schema/*.schema.json` | JSON Schema 2020-12, generated from the Zod schemas (do not edit by hand) | 12 schemas |
| `generated/allowlists.json` | Per-agent ID allowlists, generated (do not edit by hand) | 1 file |
| `generated/ll-bank.client.json`, `generated/ll-bank.practice-key.json` | Client-safe LL bank and the practice feedback pack (no mock answers), generated | 239 items, 164 practice keys |

### The LL bank in numbers

| Topic | Concepts | Items | Mock-reserved items |
|---|---|---|---|
| LL1 Road signs & markings | 30 | 102 | 30 |
| LL2 Rules of the road | 23 | 69 | 23 |
| LL3 Driving & hand signals | 10 | 32 | 10 |
| LL4 Documents, LL conditions & duties | 12 | 36 | 12 |

- Every concept has 3–6 surface-form variants with unique stems: sign to name, name to sign, scenario, reworded rule question, true/false, and picture to meaning.
- Each concept keeps one variant for mocks and at least two for practice, so mocks always draw unseen variants. That is enough for the J&K format (10 questions, 6 to pass) and the default practice assumption (15 questions, 60%) in many distinct forms.
- Every item has a distractor-similarity level from L1 to L5 for the practice staircase (GAME_DESIGN §11.8). For sign items the level is computed from the sign catalogue (family, shape, colour scheme and symbol class) and re-checked by tests. Items whose options are text carry an authored level.
- Correct-option positions are balanced across the bank, and a test enforces it.
- Alt text describes the shape and symbol of a sign or the gesture in a picture. It never states the meaning (GAME_DESIGN §11.9).

## Answer keys stay on the server

`questions/*.json` is **server-side content**. Every item's `key` (correct option, option refs) and every concept's `explanation` would reveal the answer. A build step runs `splitQuestionBank` (`packages/content`), which produces three outputs:

- **client bank**: items without keys, explanations, option refs or concept titles.
- **practice key**: keys and explanations for `pool: "practice"` items only. It may be served after an answer.
- **server key**: keys for every item, practice and mock. Only the score verifier loads it.

Mock keys never leave the server, the same principle as Nazar hazard windows (NAZAR §3.2).

- The client bank and the practice key are committed as `generated/ll-bank.client.json` and `generated/ll-bank.practice-key.json`, so the web app can import them and practise offline. Regenerate them with `pnpm --filter @margdarshak/content gen:client-bank`; a drift test fails until you do.
- The server key is never committed. The score verifier turns it into game-core answer keys (`toLlAnswerKeys`) in its own gitignored content directory.
- `split-questions.ts --out <dir>` still writes all three outputs for ad-hoc builds.

## Licence and attribution

The data in `content/` is licensed **CC-BY-4.0** (https://creativecommons.org/licenses/by/4.0/), the same as `rulepacks/` and the Nazar clip bank (root README, "Licence"). Every data file carries:

```json
"licence": "CC-BY-4.0",
"attribution": "Margdarshak content pack, team Chanakya (Nestiq Private Limited), 2026"
```

The code in `packages/content` is Apache-2.0. We draw our own sign vectors and cite IRC:67, IRC:35 and the MV Act schedule. We never reproduce their pages (CURRICULUM §2.0).

## Review status (honest state as of 2026-10-24)

Everything here is a **draft** that has to pass the CURRICULUM §5 review gates before it is published.

| Area | State | What flips it |
|---|---|---|
| Rule catalogue | All 37 rows are `verified: false`, as in DEBRIEF_SPEC §3: practice rows are "review pending", law and evidence rows "no", the medical row "no (draft)". **No rule is AI-citable yet**, so the DebriefAgent, VoiceGuide and Tutor rule allowlists are empty and the AI cites `UNKNOWN`. | The primary text is fetched and pinned, then a second person checks the wording. Then set `verified`, `verified_on`, `reviewed_by` (two people), `verification_status: "verified"`, `source_pin: "pinned"` and `ai_citable`, and regenerate the allowlists. |
| Legal sources | The MV (Driving) Regulations 2017 gazette text and MV Act ss.129, 134, 134A, 184, 185, 199A, 2(12A) and CMVR r.3 have not been fetched. Section and regulation numbers are cited only where the project docs cite them, and `source_pin: "to_pin"` marks what is missing. | Content lead fetches and pins (CURRICULUM §9). |
| Signs | Meanings follow the IRC:67 families but were not checked against a fetched copy. `check_note` lists drawing details to confirm (no-parking background, hospital symbol, narrow-bridge drawing and others). Vectors are still to be drawn. | Two-person check per sign against the standard. |
| LL items and explanations | Team-authored drafts. The Tutor explanation allowlist is empty until explanations reach `approved` in both en and hi. | Two-person content review, then native Hindi review. |
| Hindi | Every Hindi string is `pending_native_review` (LOCALIZATION §11). | Native-speaker review. |
| Golden Hour (G7, M19, `RR-GHR-003`) | Medical content is a draft. G7 is template-only and never reaches an AI. | Sign-off by a qualified medical reviewer, recorded in `reviewed_by` with a date. |
| Values quoted from rule packs | LL validity (6 months), the DL test wait (30 days) and the minimum ages are declared in `rulepack_facts`. Tests fail if `rulepacks/` changes them. | Maintained by the RULES agent. |

## Validate and regenerate

Run these from the repo root:

```bash
# all content checks + tests (schemas, IDs, references, templates, bank, split, wording, allowlists)
cd packages/content && node --test --experimental-strip-types "test/**/*.test.ts"
node --experimental-strip-types packages/content/scripts/validate.ts

# after changing a Zod schema
node --experimental-strip-types packages/content/scripts/gen-schemas.ts

# after changing any catalogue, module or question (the drift test fails until you do)
node --experimental-strip-types packages/content/scripts/gen-allowlists.ts

# formatting, copy lints
node node_modules/@biomejs/biome/bin/biome check packages/content content
node scripts/lint_wording.mjs $(find content -name '*.json')
node scripts/lint_fee_literals.mjs $(find content -name '*.json')
```

The generators format their output with Biome. The drift tests compare parsed JSON, so formatting never makes them fail.

## Conventions

- JSON is snake_case on the wire (PROJECT_BRIEF §15). Rule packs use camelCase internally, and content refers to their rows by ID only.
- No ₹ literals and no fee amounts anywhere. Fees render from `rulepacks/fees.json`. Unverified legal limits, such as the alcohol limit or the child-pillion speed cap, are not typed at all.
- Template text has no digits. Numbers enter only through `{{fact:key}}` placeholders whose keys are the finding's facts. Formatted values carry their own units (DEBRIEF_SPEC §5.2), so templates never type a unit after a placeholder.
- IDs:
  - `RR-<DOMAIN>-<nnn>` rules.
  - `<PREFIX>_<NAME>` findings.
  - `DR-<GAME>-…` drills, where `DR-NAZ-OCCL-<HAZARD_TYPE upper-cased>` is the Nazar occlusion drill.
  - `SK-<module>` skills.
  - `SIGN-<cat>-<nnn>` signs.
  - `C-<module>-<nnn>` concepts.
  - Items are `<concept>:v<n>`, the GAME_SDK `contentVersion` form, so `q:C-LL1-004:v2` is an item reference.
  - `EX-<concept>` explanations.
  - `LO-`, `LS-`, `KF-` and `MC-` prefixes for objectives, lessons, key facts and misconceptions.
