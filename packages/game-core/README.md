# @margdarshak/game-core
> Project: Margdarshak · Owner: game-core owner (Learning & Games) · Status: v0.1 implemented (P2 core) · Last updated: 2026-10-24
> Related: [GAME_SDK](../../docs/09-learning-games/GAME_SDK.md) · [GAME_DESIGN](../../docs/09-learning-games/GAME_DESIGN.md) · [DEBRIEF_SPEC](../../docs/09-learning-games/DEBRIEF_SPEC.md) · [GAMIFICATION_ENGINE](../../docs/09-learning-games/GAMIFICATION_ENGINE.md) · [NAZAR](../../docs/09-learning-games/NAZAR.md) · [score verifier](../../services/score-verifier/README.md)

**One package, pure TypeScript, no DOM.** It holds the Game SDK contract (Zod schemas + JSON Schema export), the deterministic simulation kernel, one pure scorer per implemented game, the integrity checks, the evidence → FSRS rating and calibration maths, the difficulty staircase, the event recorder / lifecycle / replay codec, and golden replay vectors.

The **same code** runs in the browser (instant preview, offline play) and in the **Node score verifier** (`services/score-verifier`), which replays every session and overwrites the client score (D-11). No scorer ever trusts a client-reported fault, band or score; Gemini never computes a number (D-09): every number a user sees about a session travels as `findings[].facts`.

---

## 1. Running it

| Task | Command (from `packages/game-core`) |
|---|---|
| Tests (node:test, from source, no build) | `node --test --experimental-strip-types "test/**/*.test.ts"` |
| Typecheck | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` |
| Build (`dist/`, `.ts` imports rewritten to `.js`, with `.d.ts`) | `pnpm build` (= `tsc -p tsconfig.build.json`) |
| Lint (repo root) | `node node_modules/@biomejs/biome/bin/biome check packages/game-core services/score-verifier` |
| Regenerate `schema/*.json` (after a schema change) | `node --experimental-strip-types scripts/write-schemas.ts` then `biome format --write packages/game-core/schema` |
| Print every golden vector's scored result (review aid) | `node --experimental-strip-types scripts/print-vectors.ts [name-prefix]` |
| Regenerate `fixtures/golden.json` (after any vector or expected-result change; a drift test checks it) | `node --experimental-strip-types scripts/export-golden.ts` (= `pnpm fixtures:golden`) then `biome format --write packages/game-core/fixtures/golden.json` |
| Regenerate expected results (new vectors or a reviewed scoring-major bump only) | `node --experimental-strip-types scripts/write-expected.ts` then `biome format --write packages/game-core/src/fixtures/expected.ts` |

Runtime dependency: **`zod` only** (4.x, `z.toJSONSchema`). Node ≥ 22.12. ESM, `"sideEffects": false`, `erasableSyntaxOnly` (Node type stripping).

### 1.1 Source vs built resolution (`exports` conditions)

Every subpath export has three conditions, in this order:

```json
"./scoring": {
  "margdarshak-source": "./src/scoring/index.ts",
  "types": "./dist/scoring/index.d.ts",
  "default": "./dist/scoring/index.js"
}
```

- **Production / plain Node** (`node dist/server.js` in the verifier image) resolves `default` → compiled JS. Node refuses to type-strip files under `node_modules`, so a deployed consumer must load compiled JS.
- **Development and tests from source** add the custom condition: `node --conditions=margdarshak-source --experimental-strip-types …` (the verifier's `test` and `dev` scripts do this) and TypeScript `"customConditions": ["margdarshak-source"]` (verifier `tsconfig.json`). No build is needed.
- Bundlers: Vitest `resolve.conditions` / webpack or Turbopack `conditionNames` can add `margdarshak-source`, or depend on `^build` in Turbo.
- game-core's own tests import `../src/*.ts` directly and need no flag.

---

## 2. Subpath exports (what exists)

| Import path | Main exports |
|---|---|
| `@margdarshak/game-core` | `replay`, `replayAsync`, `SCORING_VERSIONS`, `ReplayError`, `compareResults`, `computeTrust`, `eligibility`, `ratingFromEvidence`, `encodeReplay`, `decodeReplay`, `eventsDigest`, the main schemas, `toJsonSchemas`, `GAME_CORE_VERSION` |
| `./schema` | ids/enums: `GameId`, `A11yMode`, `GameMode`, `SeedOrigin`, `TimingMode`, `HazardType`, `Surface`, `SignFamily`, `LlTopic`, `ItemRef`, `Short`, `SemVer`, `ScoringVersion`, `FACT_KEY_RE`, `FINDING_ID_RE`, `RULE_ID_RE`, `DRILL_ID_RE` · contract: `GameManifest` (`.strict()`), `MANIFEST_LABEL`, `SessionContext`, `SessionItem`, `ReplayManifest` (type), `GameEvent` (+ `EventOf`, `PayloadOf`, `GAME_EVENT_TYPES`, `EVENT_BOUNDS`, `EventStream`), `Finding`, `Evidence`, `IntegrityFlag`, `IntegrityReport`, `ScoreComponent`, `PassRule`, `Calibration`, `SessionResult`, `ReplayEncoding`, `ReplayPackage` · server-side content: `NazarClip`, `NazarHazard`, `HptFormat`, `FormatStatus`, `SdRound`, `BsItem`, `VehicleType`, `ProbePrompt`, `JsItem`, `RoadUserKind`, `TrackSpec`, `FaultLocation`, `LlExamFormat`, `LlAnswerKey`, `GameContent` · `EXPORTED_SCHEMAS`, `toJsonSchemas()` |
| `./sim` | `mulberry32`, `subStream`, `hash32`, `randInt`, `pick`, `shuffle` · `dmath` (`dsin`, `dcos`, `dtan`, `datan`, `datan2`, `dexp`, `dlog`, `dpow`, `degToRad`) · `createFixedStepLoop`, `stepIndexAt` · `totalStoppingDistance`, `reactionDistance`, `brakingDistance`, `maxSafeSpeed`, `maxSafeOptionKmh`, `collides`, `impactSpeed`, `whoBand`, `kmhToMps`, `mpsToKmh`, `G` · `stepBicycle` / `bicycleModel` · geometry `rotate`, `rect`, `pointInPolygon`, `convexOverlap`, `distance`, `cumulativeLengths`, `projectOnPolyline`, `interpolate`, `timeToArrival` · quantisation `roundTo`, `round1`, `round2`, `clamp`, `quantiseUnit`, `quantiseInt`, `sampleBucket` |
| `./scoring` | `scoreNazarKerala5Band`, `scoreNazarFieldKitLinear`, `scoreStoppingDistance`, `scoreBlindSpot`, `scoreJunctionScan`, `scoreTrackTwin`, `scoreLlSim` · `replay(manifest, ctx, pkg, content, opts?)`, `replayAsync` (also gzip), `scoreEvents`, `SCORING_VERSIONS`, `SUPPORTED_GAMES` · content assembly `assembleContent`, `requiredFormats`, `defaultLlFormat`, `ITEM_KIND`, `HPT_FORMAT_ID` · seeded helpers the client renders with: `sdChildDistanceM`, `sdSightM`, `bsOrientationDeg`, `jsAgentSpawnMs`, `simulateTrack`, `vehicleZones` · `GAME_CONFIG` (design parameters) · `finding`, `rankFindings`, `hazardDrill`, `buildResult`, `ReplayError` |
| `./integrity` | `runIntegrityChecks(ctx, events, opts)`, `computeTrust(flags)`, `TRUST_FACTORS`, `compareResults(client, server)`, `withIntegrityFlags`, `eligibility(result, purpose, ctx?)`, `rateImpossible`, `INTEGRITY_CONFIG` |
| `./learning` | `ratingFromEvidence(e) → { rating, overconfident }`, `collapseEvidence`, `RATING`, `brier`, `overconfidence`, `calibrationBins`, `staircase(state, itemPassed)`, `runStaircase`, `initialStaircase` |
| `./sdk` | `createEventRecorder(ctx, sink, { now })`, `arraySink`, `SessionLifecycle`, `encodeReplay` / `decodeReplay` (sync, `mdr1`), `encodeReplayGzip` / `decodeReplayAsync` (`mdr1+gzip`), `eventsDigest`, `canonicalJSON`, `canonicalDigest`, `sha256Hex` · types `GameModule`, `GameHost`, `MediaClock`, `EventRecorder`, `EventSink` |
| `./sdk/browser` | the device side (MD-203): `createMemoryQueueStore`, `createIndexedDbQueueStore(globalThis.indexedDB)` (events keyed `(sid, seq)`, first write wins, survives reloads, `clear()` = "Clear this device"), `createQueueSink(store)` (batched recorder sink), `queueSession` / `endQueuedSession`, `syncQueue(store, submit)` (oldest first, Idempotency-Key = sid, stops at the first retry), `bindVisibility(document, {...})` (records `visibility_hidden` + a hidden `pause`, voids a timed item, abandons after 10 min hidden), `createMediaClock(video, rafScheduler)` (rVFC, else `currentTime` as timingMode `fallback`), `queueStoreContract` (checks the web app runs on real IndexedDB). Browser APIs are injected as structural types; no DOM lib |
| `./fixtures` | `goldenVectors()` (35 vectors: Nazar 8, Stopping Distance 5, Blind Spot 5, Junction Scan 5, Track Twin 6, LL 6), `fixtureContentDocs()`, `fixtureFormats()`, `manifestFor`, `ctxFor`, `StreamBuilder`. The same vectors are exported to the committed contract file `fixtures/golden.json` (`margdarshak.game-core.golden/1`: each vector's exact score-verifier `/verify` request body, the expected server result with `replay.inputs` stored as `""`, and the result digest; Nazar requests carry their clip documents inline). The Go contract test and `services/score-verifier` `dist/cli/replay.js <file>` replay it; `test/golden-export.test.ts` fails on drift |
| `./debrief` | `generateFindings(result, history, catalogue, { locale })` → `FactsPack` · `formatFact`, `fillPlaceholders`, `dropMissingClauses` · `validateDraft(draft, pack)`, `retryHint`, `violatedRules`, `checkText`, `VALIDATOR_SPEC` (= `validator-spec.json`), `escapeHtml` / `unescapeHtml` · `renderTemplateCard` ("Auto notes"), `renderDraft` ("Coach notes"), `templateDraft`, `auditCatalogue` · catalogue types + `debriefCatalogue(contentFiles)`, `buildLabels` · schemas `FactsPack`, `DebriefDraft`, `DebriefCard`, `FactKind`, `DebriefLocale` · `DebriefError`. The root re-exports `generateFindings`, `renderTemplateCard`, `renderDraft`, `validateDraft` and the three schemas. See §7 |

`ratingFromEvidence` is the shared FSRS mapping for `@margdarshak/gamification`: input `{ correct, critical?, confidence?: "50"|"75"|"100", latencyMs?, timerMs?, nazarBand?: 1..5 }`, output `{ rating: 1|2|3|4, overconfident }` (wrong at 100% = Again + overconfident; Hard beats Easy; > 80% of the timer is slow).

---

## 3. Contract notes

- **Events** (`GameEvent`): strict envelope `{sid, seq, t, mt?, item?, type, p}`; `t` and `mt` are **integer ms**; taps are 0..1 with 2 dp (`multipleOf(0.01)`); free strings ≤ 24 chars; `seq` < 5000. Every payload is strict (a test feeds every type an extra key).
- **SessionResult** exactly as GAME_SDK §10. `score.raw = Σ components.value` (2 dp); `pct = raw / max × 100` (2 dp); findings ranked `(critical desc, severity desc, findingId asc)`, one per ID (worst instance, critical beats non-critical); drill `DR-NAZ-OCCL-<TYPE>` with the hazard type upper-cased.
- **Integrity**: flags in canonical order; `INT_TAB_HIDDEN` repeats once per voided item (trust ×0.9 per item); `trust` rounded to 4 dp; client/server match iff `|Δpct| ≤ 0.5` and the same finding-ID set.
- **JSON Schemas** (`schema/*.json`, draft 2020-12, `$id` under `https://margdarshak.example/schemas/game-core/`) are for the Go API; a test fails on drift and a PII guard fails on fields named like `name`, `dob`, `phone`, `email`, `aadhaar`, `lat`, `lng`, `address`.
- **Server-side content** is assembled by `assembleContent(ctx, { items, formats })` from documents keyed by item ref (`clip:<id>@<v>`, `sd:<id>`, `bs:<id>`, `js:<id>`, `track:<id>@<v>`, `q:<qref>`) and format rows (`HPT-KL`, `LLT-<tenant>`; no `LLT` row → the default 15 questions / 9 to pass, `passRule.source = "design"`).

### 3.1 Determinism

- `src/sim` and `src/scoring` use no `Math.random`, `Date.now`, `performance.now`, `new Date()` or engine transcendentals (a test scans the code). `dmath` ports the fdlibm kernels using only `+ − × ÷`, `Math.sqrt`, `Math.round/floor/min/max` and IEEE bit access via `DataView`; accuracy ≤ 1e-15 against `Math.*` on the sim domains, and bit patterns are pinned in a test.
- Seeds: `mulberry32`; `subStream(seed, label)` = `mulberry32(fmix32(FNV-1a(seed LE bytes ‖ label)))`.
- Track Twin replays recorded quantised inputs through the bicycle model at a fixed 60 Hz; an input event at `t` takes effect at step `⌊t·60/1000⌋`; the recorder keeps at most one input per 60 Hz step.

### 3.2 Replay encoding and digest

- `mdr1` (default): canonical JSON `{"v":1,"sid":…,"r":[rows]}` → UTF-8 → base64; each row is `[Δseq, Δt, Δmt|null, item|null, type, payload]`, and `[n]` repeats the previous row n times. **Chosen over gzip as the default** because it is synchronous and byte-identical in every engine (CompressionStream is async, and gzip output differs between implementations). `mdr1+gzip` (CompressionStream) is supported for transport size via `encodeReplayGzip` / `decodeReplayAsync` / `replayAsync`; decompression is capped at 4 MB.
- **Digest** = `sha256:` + SHA-256 (pure TS, synchronous, cross-checked against `node:crypto`) over the sorted-key canonical JSON of the **decoded** events. Never over compressed bytes.

---

## 4. Scorers (one pure function of ctx, events, content, options each)

| Game | Function | Score | Pass rule |
|---|---|---|---|
| Nazar | `scoreNazarKerala5Band` | mock/pair: Kerala marks per clip (1 hazard 2p, 2 hazards p₁+p₂), session /100 (scaled when fewer clips); practice: 0–5 per hazard; learn: 0–5 per hazard for the tap plus 0/5 for the "what happens next?" answer (the k-th `prediction` of a clip pairs with its k-th hazard by onset; an unanswered freeze scores 0), and every answer writes FSRS evidence for the hazard card (MD-224). "Tap where" is scored on time only: clip metadata has no hazard region yet | mock/pair: total ≥ `HPT-KL.pass`, `{rule_pack, HPT-KL}` |
| Nazar (study) | `scoreNazarFieldKitLinear` | 10 marks to onset + 2 s, linear to 0 at + 5 s (two hazards: 5 each), same pattern rule | as above |
| Stopping Distance | `scoreStoppingDistance` | estimation 30 + no-collision 20 + speed-for-sight 50 | none (learn/practice) |
| Blind Spot | `scoreBlindSpot` | placement 30 + no-zone time 30 + mirror 15 + hold-back 25; left overtake zeroes Part B | none |
| Junction Scan | `scoreJunctionScan` | 100 per item (scan 30, gap 40, creep 15, yield 15), critical cap 20, session = mean | none |
| Track Twin | `scoreTrackTwin` | demerit sheet: pct = max(0, 100 − 5·demerits), cap 40 on immediate fail | demerits ≤ spec threshold and no immediate fail, `{design, track:<id>@<v>}` |
| LL Simulator | `scoreLlSim` | 1 per question; timeouts wrong; evidence + Brier calibration | mock: correct ≥ `LLT-<state>.pass` |

Nazar anti-spam (brief §15): a clip scores 0 if any **half-open** 1.0 s window `[s, s+1000)` holds more than 3 taps, or the clip has more than `2 × hazards + 4` taps (taps without media time count toward the cap). Mock: a clip voided by a hidden tab or clock drift counts as 0; practice: excluded from the max. Not in this version: Helmet Fit, Golden Hour, Night & Glare, Hill Road and Nazar commentary (`replay` returns `UNSUPPORTED_GAME`).

---

## 5. Tests (`test/`)

`schema` (PII guard, extra-key rejection for all 31 event types, bounds, JSON Schema drift, manifests/results validate) · `sim` (pinned PRNG and sub-streams, sub-stream independence, dmath accuracy + pinned bits, forbidden-API scan, fixed step at 30/60 fps, track trace determinism, stopping golden distances, geometry) · `learning` · `sdk` (SHA-256 vs node:crypto, pinned digests of golden streams, codec round-trip incl. RLE and gzip, tamper detection, recorder caps, lifecycle) · `golden` (35 vectors deep-equal, content-store assembly, hand-checked numbers per game) · `nazar` (anti-spam and band boundaries, linear rule) · `properties` (seeded mulberry32 loops: score ∈ [0, max], raw = Σ components, an extra false alarm never raises a score, pattern-voided clips score 0, critical findings rank first) · `golden-export` (`fixtures/golden.json` matches the generator, one entry per vector, digests and inline Nazar content) · `integrity` · `package`.

---

## 6. Deviations from the earlier API sketch and the specs

| Item | Spec said | Implemented | Why |
|---|---|---|---|
| Scope | debrief, gamification, `sdk/browser`, ts-fsrs scheduler, 10 scorers | debrief in `./debrief` (MD-242, §7); `sdk/browser` (MD-203) with injected browser APIs; the rest not here | gamification belongs to other P2 work (`@margdarshak/gamification`); the IndexedDB store runs for real only in the web app's Playwright pass over `queueStoreContract`; four games + commentary are out of P2 scope |
| `lane_pos` payload | `{lat, lon}` | `{lateralCm, progressDm}` | `lat`/`lon` read as GPS coordinates and would trip the PII guard |
| `speed_choice.context` | `sight\|night\|bend` | adds `street` | Stopping Distance round 2 needs it |
| Drill ID pattern | `^DR-[A-Z]{2,3}-[A-Z0-9-]+$` | adds `_` | the spec's own `DR-NAZ-OCCL-BUS_STOP_PEDESTRIAN` needs it |
| Replay encoding | gzip + base64 | `mdr1` default, `mdr1+gzip` optional | determinism and synchronous decode (§3.2) |
| `ReplayPackage` | seed + inputs + digest | adds `telemetryVersion`, `encoding`, `eventCount` | the decoder needs them to validate |
| `t`, `mt` | numbers | integers (ms) | exact band arithmetic; quantised by the recorder |
| Scorer signature | `(ctx, events, clips)` | `(ctx, events, content, opts)` | `opts` carries versions, replay blob, hints |
| `replay` manifest | full `GameManifest` | `ReplayManifest` (gameId, version, scoringVersion, budgets) | the verifier builds it from the request; a full manifest also fits |
| `runIntegrityChecks` | `(ctx, events, result)` | `(ctx, events, opts)` | scorers need item voids before they score |
| Ranking | `(critical, severity, id)` | informational `NAZ_BELOW_KERALA_MARK` sorts after other non-critical findings | DEBRIEF_SPEC says it is "never the top finding if a skill finding exists" |
| Positives | `SD_SPEED_CHOICE_GOOD`, `NAZ_IMPROVED` | not emitted | severity n/a / need history; the debrief layer derives them |
| `LL_WEAK_TOPIC` | topic mastery `M_t < 0.6` | in-session topic accuracy < 0.6 over ≥ 3 answers (fact `mastery_pct`) | mastery needs FSRS history the scorer does not have |
| Nazar card IDs | `C-M18-001`… | `hazard.cardId` from content, else `hazard:<type>` | the hazard-type → concept map is not published yet |
| `SD_WET_GAP` | wet ≥ 2 × dry error | also wet error ≥ 10% [D] | avoids firing on 1% vs 0% |
| Junction "collision" | derived on replay | accepted gap < 1.0 s [D] | no published geometry; config value |
| Pattern window | "any 1.0 s window" | half-open `[s, s+1000)` | 4 taps spanning exactly 1000 ms are allowed; tested |

---

## 7. Debrief layer (`./debrief`, MD-242)

Implements DEBRIEF_SPEC §5–§9: **code finds, Gemini words.** Everything here is deterministic and runs on the device (an instant, offline "Auto notes" card) and in Node. The Go backend runs the AI path and reads the **same** rule data, `src/debrief/validator-spec.json`.

```
SessionResult ─► generateFindings ─► FactsPack ─┬─► renderTemplateCard ─► DebriefCard (auto_notes)
  + DebriefHistory + DebriefCatalogue           └─► [Go: DebriefAgent] ─► DebriefDraft ─► validateDraft ─► renderDraft ─► DebriefCard (coach_notes)
```

### 7.1 Inputs
- **Catalogue** (`DebriefCatalogue`): structural types over the content JSON (`content/catalogue/{findings,rules,drills,games,enums,hazard_types}.json`). game-core never imports `@margdarshak/content`: pass the parsed files, or `debriefCatalogue(content)` with the content package's file model. Labels for enum facts come from `enums.json` and `hazard_types.json` (`buildLabels`).
- **History** (`DebriefHistory`, every field optional): `lastDebriefs` (newest first; prevFindings = the last 3), `retrievability` (FSRS R by skill; missing = 0, unseen), `staircaseLevels` (by skill; missing = 1), `nazarLateS` (`{ firstSessions, current, speedKmh }` for `NAZ_IMPROVED`; the caller supplies the mean late_s from the replayed analysis because `SessionResult` carries only the worst one).

### 7.2 `generateFindings` (§5.1)
1. Keeps the scorer's findings the catalogue knows **for this game**, and types their facts against the catalogue (`typedFacts`): undeclared keys, non-numeric numbers and free-text enum values are dropped, so instruction-like text can never reach the pack (§6.2 rule 7, §6.4).
2. Positive-polarity findings (`LL_UNDERCONFIDENT`, which the scorer emits) move to `positives`; `NAZ_IMPROVED` (history) and `SD_SPEED_CHOICE_GOOD` (full `speed_for_sight` marks and no overspeed finding; `sight_m` is not on the result and the template does not need it) are detected here.
3. Ranks with the scorers' own `rankFindings` (critical desc, informational last, severity desc, findingId asc; worst instance per ID) and takes the top 3.
4. `allowedRuleIds = ∪ top.ruleIds ∩ ai_citable`, RR IDs only (track, sign and rule-pack refs never enter). Empty today: no rule is verified.
5. `drillCandidates` (≤ 3): the top findings' drills ranked by (R asc, staircase level asc, finding rank, drill order), each with its level clamped by the drill's range (`null` for mock and concept-set drills); none → the game's `default_drill_id`.
6. `prevFindings`, `resolvedSinceLast` (previous negatives that no finding of this session carries: the only legal `improved_since_last`), `labels` of the pack's enum facts in the pack locale, `score.band` (strong ≥ 80 / medium 50–79 / weak < 50), `score.pass_mark` when a finding carries one, and `debriefMode: "template_only"` for Golden Hour (the AI is never called; `validateDraft` rejects with `MODE`).

### 7.3 Facts formatting (§5.2)
| Kind | EN | HI |
|---|---|---|
| `seconds` | `1.4 s` (1 dp) | `1.4 सेकंड` |
| `metres` / `centimetres` | `≈ 16 m` / `≈ 34 cm` (whole) | `लगभग 16 मीटर` / `लगभग 34 सेमी` |
| `kmh` | `40 km/h` | `40 किमी/घंटा` |
| `percent` | `18%` | `18%` |
| `times` | `once`, `2 times` | `एक बार`, `2 बार` |
| `rate_per_min` | `4.5 times a minute` | `4.5 बार प्रति मिनट` |
| `number` / `ordinal` / `ratio` | `7` (1 dp if fractional) / `3` / `0.36` | same |
| `enum` / `enum_list` | i18n label; a list travels as one comma-separated string and is joined "a, b and c" | label, joined "… और …" |
| `boolean` | `yes` / `no` | `हाँ` / `नहीं` |

Western digits in both locales. Hinglish narration is Latin script, so inline facts use the English forms. A missing label throws `DebriefError("MISSING_LABEL")` with `{ strict: true }` (tests, audits) and otherwise prints a neutral phrase (`MISSING_VALUE`), never the raw snake_case value.

### 7.4 Validator (`validator-spec.json`, §6.3)
The JSON holds every pattern, list, limit and hint; `spec.ts` only parses and compiles it (a malformed edit fails at import). Regexes use the subset ECMAScript and Go RE2 share (no lookaround or backreferences; `\b` is ASCII in both; flag `i` = Go `(?i)`), and a test enforces that.

| Rule | Data and decision |
|---|---|
| `MODE`, `SCHEMA` | pre-checks: template-only games take no draft (§0 line 5); the draft must decode as a strict `DebriefDraft` (§6.4) |
| V1 | `[0-9०-९]` after stripping `{{fact:[a-z0-9_]+}}` (§6.3 V1) |
| V2 | finding, rule (`allowedRuleIds ∪ UNKNOWN`) and drill IDs are closed; `improved_since_last ∈ resolvedSinceLast` (§7.1 comment) |
| V3 | a point's placeholders are its finding's facts; `how_you_did` takes the positives' facts; `next_drill.why` takes none; leftover `{{` or `}}` is malformed |
| V4 | `where_you_lacked[0]` is the top finding whenever findings exist |
| V5 | EN, HI and Hinglish lists, all applied to every locale: the §6.2 rule 4 list, gore, death and injury words, shaming words, babying ("beta"), praise of quick reactions, false urgency (CONTENT_STYLE §8.1, §8.3; D-19) |
| V6 | per field, letters in the locale's script: `hi` Devanagari ≥ 0.7, `en` and `hinglish` Latin ≥ 0.9; script ranges are data; `draft.locale` must equal the pack's |
| V7 | code points of the text as written (placeholders included): 160 / 140 / 120 |
| V8 | ≤ 3 per list, no finding twice in a list, "could" findings ⊆ "lacked" findings |
| V9 | applied at render, never a rejection: `&`, `<`, `>` escaped for text-node insertion; quotes kept so "didn't" survives (a UI that escapes again, such as React text nodes, uses `unescapeHtml`) |
| V10 | `₹`, `rupee`, `रुपये`/`रुपए`, `शुल्क`, `फ़ीस` as substrings; `fee`/`fees` as a whole word, so "feet show before the person does" (§8.1) passes |

`validateDraft` returns every violation `{ rule, path, message, hint }`; `retryHint` builds the §6.3 retry text ("Your draft broke V1 at where_you_lacked[0].text: remove the digit, use one of {{fact:late_s}}, …"); `violatedRules` gives the unique rule IDs for E-19 (`["V1", "V10"]` for §8.5).

### 7.5 Cards (§7.2, §9)
- **`renderTemplateCard(pack, catalogue, locale, { now, sid, generatorVersion, validator?, strict? })`**: `how_you_did` from the first positive whose `how` template renders, else `debrief.<gameId>.how.<band>`; the top findings in generator order with their `lacked` and `could` templates; a rule chip only for a **verified** rule (else `ruleId: "UNKNOWN"`, no chip); `next_drill = drillCandidates[0]` with `margdarshak://play/<gameId>?drill=<id>&level=<n>`. Hinglish renders the `hi` templates. Every template first passes the same text checks as a draft (strict mode throws; otherwise a reviewed fallback line from `FALLBACK_TEXT` is used). Sentences or clauses whose optional fact is absent are dropped (`dropMissingClauses`, e.g. `SD_COLLISION` without `stop_m`). Golden Hour cards carry the notice "Draft, not medical advice".
- **`renderDraft(draft, pack, catalogue, locale, { now, sid, generatorVersion, model, attempts? })`**: re-validates (throws `INVALID_DRAFT` with the retry text), fills placeholders and attaches rule text + source for the cited allowed rules.
- Card fields follow §7.2 (`label` is the footer "Practice and familiarisation, not certification"). Additions: `notes_label` ("Auto notes" / "स्वचालित नोट्स", "Coach notes" / "कोच नोट्स"), `notices`, and `ruleId` per point. `created_at` is the caller's `now`: nothing in `src/debrief` reads the clock (tested).
- **`templateDraft`** expresses the template card as a `DebriefDraft`, so tests run it through `validateDraft`: the template debrief passes the validator for every golden vector and every catalogue finding, in en and hi.

### 7.6 Tests
`debrief-format` (every FactKind in both locales, the §8.1 and §9 lines, label and type fallbacks, FactKind kept equal to the content schema) · `debrief-validator` (V1–V10 pass and fail, §8.1 passes in EN and HI, §8.5 fails V1 + V10, retry format, renderDraft, the RE2-compatible pattern subset) · `debrief-generate` (ranking, allowlists, positives, drill ranking and clamping, history, Golden Hour, hostile facts; seeded properties: deterministic pack, critical first, top ≤ 3, `allowedRuleIds ⊆ ai_citable`, a worse instance never lowers severity) · `debrief-catalogue` (the real catalogue: audit clean, en + hi templates for all 54 findings, golden vectors × catalogue, every finding from synthetic facts) · `debrief-package`.

### 7.7 Open items
- Hindi labels, fallback lines and card labels await native review, like all catalogue Hindi.
- `NAZ_IMPROVED` needs the session's mean late_s from the caller; `SD_SPEED_CHOICE_GOOD` has no `sight_m` (not on `SessionResult`).
- When practice rules flip to `verified: true`, regenerate `content/generated/allowlists.json`; the generator picks them up with no code change.
