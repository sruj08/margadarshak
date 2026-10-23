# @margdarshak/game-core
> Project: Margdarshak · Owner: game-core owner (Learning & Games) · Status: Draft v0.1 (API described, no code yet) · Last updated: 2026-10-23
> Related: [GAME_SDK](../../docs/09-learning-games/GAME_SDK.md) · [GAME_DESIGN](../../docs/09-learning-games/GAME_DESIGN.md) · [DEBRIEF_SPEC](../../docs/09-learning-games/DEBRIEF_SPEC.md) · [GAMIFICATION_ENGINE](../../docs/09-learning-games/GAMIFICATION_ENGINE.md) · [NAZAR](../../docs/09-learning-games/NAZAR.md) · [CURRICULUM](../../docs/09-learning-games/CURRICULUM.md) · [PROJECT_BRIEF](../../docs/00-overview/PROJECT_BRIEF.md)

**One package, pure TypeScript, no DOM in its core.** It holds the Game SDK contract (Zod schemas), the deterministic simulation kernel, one scoring function per game, integrity checks, the learning maths (FSRS evidence, mastery, readiness, Brier), the gamification rules (XP, ranks, streaks, badges) and the deterministic debrief layer (findings, facts formatting, templates, validator spec).

The **same build** runs in the browser (instant preview, offline play, under-18 device-only sessions) and in the **Node score verifier**, which replays every adult session and overwrites the client score (PROJECT_BRIEF §8). That is the anti-cheat guarantee and the reason Gemini never computes a number (D-09).

This README describes the API. Implementation lands during the build; nothing here is code.

---

## 1. Requirements and dependencies

| Item | Value |
|---|---|
| Runtime | Node ≥ 20 (verifier, tests); evergreen Chromium/WebKit/Firefox and Android WebView (browser) |
| Module format | ESM only, `"sideEffects": false`, subpath exports (tree-shaken per game so Lite mode stays < 300 KB) |
| Language | TypeScript 5.x, `strict: true`, `exactOptionalPropertyTypes: true` |
| Runtime deps (pinned exactly at H0) | `zod` 4.x (schemas + `z.toJSONSchema()`), `ts-fsrs` 5.x (candidate 5.4.1; never the 6.0 beta) [unverified exact versions] |
| Forbidden in core | `Math.random`, `Date.now`, `performance.now`, `Math.sin/cos/tan/atan2/exp/pow/log` inside `sim` and `scoring` (lint rule `margdarshak/no-nondeterminism`); any network or storage API; any DOM type outside `sdk/browser` |
| Licence | Apache-2.0 |

---

## 2. Subpath exports

| Import path | Purpose | Browser | Node verifier |
|---|---|---|---|
| `@margdarshak/game-core/schema` | All Zod schemas and inferred types; JSON Schema export for Pydantic codegen | ✓ | ✓ |
| `@margdarshak/game-core/sdk` | Game ⇄ host interfaces, event recorder, lifecycle state machine | ✓ | (types) |
| `@margdarshak/game-core/sdk/browser` | IndexedDB queue, visibility hooks, video frame clock | ✓ | ✗ |
| `@margdarshak/game-core/sim` | Fixed-step loop, seeded PRNG, deterministic math, vehicle and traffic models, geometry | ✓ | ✓ |
| `@margdarshak/game-core/scoring` | One scorer per game + replay entry point | ✓ | ✓ |
| `@margdarshak/game-core/integrity` | Integrity flags, trust, client/server comparison | ✓ (preview) | ✓ |
| `@margdarshak/game-core/learning` | FSRS evidence mapping, mastery, readiness, calibration | ✓ | ✓ |
| `@margdarshak/game-core/gamification` | XP, diminishing returns, rank gates, streak machine, badge evaluators | ✓ | ✓ |
| `@margdarshak/game-core/debrief` | Findings generator, facts formatter, template renderer, validator spec | ✓ | ✓ |
| `@margdarshak/game-core/fixtures` | Golden replay vectors and expected results | tests | tests (TS + Python) |

---

## 3. `schema`

Exports (each is a Zod schema plus its inferred TypeScript type):

| Name | Describes | Notes |
|---|---|---|
| `GameId` | the 10 game IDs (`nazar`, `stopping_distance`, `blind_spot`, `junction_scan`, `track_twin`, `helmet_fit`, `golden_hour`, `night_glare`, `hill_road`, `ll_sim`) | stable strings; G-codes are display only |
| `A11yMode` | `no_audio`, `colour_safe`, `one_hand`, `reduced_motion`, `tap_only`, `screen_reader_alt`, `large_text`, `safe_luminance` | |
| `GameManifest` | a game's identity, curriculum links, allowed rule/finding/drill IDs, modes, debrief mode, age band, offline/Lite behaviour, assets with hashes, budgets, the fixed "practice, not certification" label, content gates | `.strict()`; validated at build and load |
| `SessionContext` | what the host gives a game | contains **no** personal data by construction |
| `GameEvent` | discriminated union on `type` over a common envelope (`sid`, `seq`, `t`, `mt?`, `item?`) | payloads bounded, quantised, enum-first |
| `ReplayPackage` | seed + delta-encoded, gzipped, base64 inputs + digest | |
| `Finding` | `findingId`, `severity`, `critical`, `ruleIds`, `skillId`, `drillIds`, `facts`, `itemRef?` | facts keys snake_case ≤ 24 chars |
| `Evidence` | FSRS evidence per concept card (`cardId`, `correct`, `latencyMs?`, `confidence?`, `rating`, `overconfident`) | |
| `IntegrityReport` | `flags[]`, `trust` 0–1, `timingMode`, `provisional` | |
| `SessionResult` | the single result shape that every downstream consumer reads | `score.raw = Σ components` always |
| `FactsPack` | the debrief input (top findings, positives, allowlists, drill candidates, previous findings) | the only thing the AI may receive |
| `DebriefDraft`, `DebriefCard` | AI draft shape and rendered card | mirrors the Pydantic models |
| `toJsonSchemas()` | returns JSON Schema documents for every exported schema | consumed by `datamodel-code-generator` to produce the backend's Pydantic v2 models; CI fails on drift |

---

## 4. `sdk`

| Export | Kind | Responsibility |
|---|---|---|
| `GameModule` | interface (implemented by each game) | `init(ctx, recorder)`, `start()`, `pause()`, `resume()`, `end(reason)`, `getPreview()`, `destroy()`. Pausing on `visibilitychange` is mandatory. Games never call network or storage APIs |
| `GameHost` | interface (implemented by the web app) | `loadGame(manifest)`, `createSession(gameId, mode)`, `submit(sid)`, `getDebrief(sid)`, `onA11yChange(cb)`. The host owns networking, consent and age gating |
| `createEventRecorder(ctx, sink)` | factory | assigns `seq` and relative `t`; quantises sampled streams to 10 Hz; enforces the event cap, tap-rate cap and payload bounds; writes to a sink |
| `SessionLifecycle` | state machine | Loading → Ready → Running ⇄ Paused → Ended → Submitting → Verified / Queued / LocalOnly; item voiding when hidden during a timed item |
| `encodeReplay(events)` / `decodeReplay(pkg)` | functions | delta + run-length encoding, gzip, base64; canonical digest (SHA-256 over sorted-key JSON) |

`sdk/browser` adds `createIndexedDbQueue()` (idempotent on `(sid, seq)`, survives reloads, cleared by "Clear this device"), `bindVisibility(lifecycle)`, and `createMediaClock(video)` using `requestVideoFrameCallback` with a `currentTime` fallback that marks `timingMode: "fallback"`.

---

## 5. `sim`

| Export | Responsibility |
|---|---|
| `createFixedStepLoop({ hz: 60 })` | accumulator-based fixed timestep; rendering interpolates; logic is identical at 30 or 60 fps |
| `mulberry32(seed)`, `subStream(seed, label)` | seeded PRNG and label-derived sub-streams so adding a random concern never shifts others |
| `dmath` (`dsin`, `dcos`, `datan2`, `dexp`, `dpow`) | deterministic polynomial/table implementations using only `+ − × ÷` and `Math.sqrt`, so V8 and JavaScriptCore produce bit-identical replays |
| `bicycleModel` | kinematic bicycle model (`ψ̇ = v·tan δ / L`) for Track Test Twin and Hill Road |
| `brakeHeat` | the Hill Road heat/fade model (design parameters from config) |
| `traffic` | seeded agents (cars, two-wheelers, autos, trucks, buses, pedestrians, cyclists, animals) with deterministic behaviours |
| `geometry` | polygons (no-zones), sight-line cones with occluders, path tolerance (track lines, cones), conflict-point time-to-arrival |
| `stopping` | `totalStoppingDistance(v, tr, mu)`, `maxSafeSpeed(sight, tr, mu)`, `impactSpeed(...)`, `whoBand(impactKmh)` (two published points only) |

---

## 6. `scoring`

| Export | Game | Returns |
|---|---|---|
| `scoreNazarKerala5Band(ctx, events, clips)` | Nazar (product scoring) | `SessionResult` with Kerala marks /100, 5-band points, pattern-rule voids, late facts |
| `scoreNazarFieldKitLinear(ctx, events, clips)` | Nazar (study scoring, if pre-registered) | same shape, linear 2 s→5 s rule |
| `scoreNazarCommentary(mentions, clips)` | Nazar commentary | commentary percentage + findings |
| `scoreStoppingDistance` | Stopping Distance | estimation / no-collision / speed-for-sight components |
| `scoreBlindSpot` | Blind Spot | placement / no-zone time / mirror / hold-back; left-overtake critical |
| `scoreJunctionScan` | Junction Scan | scan / gap / creep / yield; critical cap 20 |
| `scoreTrackTwin` | Track Test Twin | demerit sheet from the track spec |
| `scoreHelmetFit` | Helmet Fit | framing (or mirror step) / steps in order / quiz |
| `scoreGoldenHour` | Golden Hour | LCS order / myths / call step; critical cap 40 |
| `scoreNightGlare` | Night & Glare | dipping / left-edge / speed in range / hazards |
| `scoreHillRoad` | Hill Road | engine braking / yield / horn / bends / zones / trip plan |
| `scoreLlSim` | LL Test Simulator | rule-pack pass rule; FSRS evidence; calibration |
| `replay(manifest, ctx, pkg, content)` | all | dispatches to the right scorer at the session's `scoringVersion`; the verifier's single entry point |
| `SCORING_VERSIONS` | all | map of game → supported `major.minor` versions |

Every scorer is a **pure function** of (context, events, content, config). Design parameters (thresholds, demerit points, bands) are read from `game-config.json` entries tagged `source: "design"`; rule-pack values (LL format, Kerala pass mark, track specs) come in through `content` with their source.

---

## 7. `integrity`

| Export | Responsibility |
|---|---|
| `runIntegrityChecks(ctx, events, result)` | emits flags: `INT_TAB_HIDDEN`, `INT_CLOCK_DRIFT`, `INT_TIMING_FALLBACK`, `INT_RATE_IMPOSSIBLE`, `INT_REPLAY_MISMATCH`, `INT_SEEN_CLIP`, `INT_RT_ANTICIPATORY`, `INT_EVENT_CAP`, `INT_SESSION_EXPIRED`, `INT_OFFLINE_SEED` |
| `computeTrust(flags)` | multiplicative trust 0–1 (factors in GAME_SDK §6.5) |
| `compareResults(client, server)` | match if `|Δpct| ≤ 0.5` and identical finding IDs |
| `eligibility(result, purpose)` | answers "may this count for FSRS / readiness / Nazar Score / percentile / badge / field study?" |

The UI never shows flags; it only says "This session wasn't counted for your card" when trust < 0.6.

---

## 8. `learning`

| Export | Responsibility |
|---|---|
| `ratingFromEvidence(evidence)` | the deterministic outcome → FSRS rating table (wrong at 100% confidence = Again + overconfidence event) |
| `createScheduler(params)` | wraps `ts-fsrs` with pinned parameters (`request_retention 0.9`, `maximum_interval 60`, `enable_fuzz false`) |
| `replayReviewLog(log)` | recomputes card states from the append-only review log (the source of truth on device and server) |
| `topicMastery(cards, now)` | `M_t = coverage × mean retrievability`, with the evidence floor |
| `nodeState(history)` | locked / learning / mastered / fading with hysteresis (0.8 in, 0.7 out) |
| `readiness(masteries, answers, weights)` | `{ readiness, knowledge, calPenalty, topics, gate }` exactly as GAMIFICATION_ENGINE §5 |
| `brier(answers)`, `overconfidence(answers)`, `calibrationBins(answers)` | personal calibration |
| `roadReadiness(masteries, nazarScore, tenant)` | the separate, non-gating road line |
| `reviewQueue(cards, now, limits)` | due-first ordering, daily new-concept cap |
| `staircase(state, itemPassed)` | 2-up / 1-down level update |

---

## 9. `gamification`

| Export | Responsibility |
|---|---|
| `xpForSession(result, minutesToday)` | base × quality × diminishing multiplier × trust factor |
| `xpForReviews(n, minutesToday)` | 5 per due card with diminishing returns |
| `rankFor(xp, nodeStates)` | Gali → Mohalla → Shehar → Highway → Ghat, gated by mastery; never demotes |
| `streakTransition(state, week)` | weekly goal, silent freeze tokens, repair rule, archive on DL test day |
| `evaluateBadges(history)` | the nine badges; self-declared badges carry a "your word" flag |
| `squadScore(members)` | co-op mean of NazarScore × (1 − Brier), returns null below 3 contributors |
| `patternLintSpec` | the DP-01…DP-18 rule metadata used by the ESLint plugin and copy scanner |

All return values are pure data; persistence is the backend's job (E-22, E-23).

---

## 10. `debrief`

| Export | Responsibility |
|---|---|
| `generateFindings(result, history, catalogue)` | runs the per-game detectors, dedupes, ranks `(critical, severity, id)`, picks the top 3, builds allowlists (only `ai_citable` rules) and drill candidates → `FactsPack` |
| `formatFact(key, value, locale)` | unit-carrying, locale-aware formatting ("≈ 16 m" / "लगभग 16 मीटर") |
| `renderTemplateCard(pack, locale)` | the reviewed-template "Auto notes" card (offline, under 18, AI off, fallback) |
| `renderDraft(draft, pack, catalogue, locale)` | fills `{{fact:key}}` placeholders in a validated AI draft and attaches rule chips |
| `validatorSpec` | the JSON rule set V1–V10 (digits, closed IDs, placeholders, coverage, tone, language, lengths, counts, escaping, fees) shared with the Python validator |
| `commentaryLexicon` / `matchCommentary(tokens, clip)` | EN/HI/Hinglish hazard lexicon and the deterministic mention matcher |

---

## 11. `fixtures` and tests

- **Golden vectors:** at least 5 per game (strong, medium, weak, critical fault, edge), each `{manifest, ctx, replayPackage, content, expectedResult}`. Append-only; changing an expected output requires a scoring-major bump.
- **Run in three places:** Vitest (TS), Playwright in Chromium/WebKit/Firefox (cross-engine determinism), and pytest against the verifier container (contract drift).
- **Property tests** (`fast-check`): scores stay in `[0, max]`; an extra false alarm never raises a score; a pattern-voided clip scores 0; a critical fault always ranks first; `allowedRuleIds ⊆ ai_citable`.
- **PII guard:** a test fails if any schema gains a field named like `name`, `dob`, `phone`, `email`, `aadhaar`, `lat`, `lng`, `address`.

---

## 12. Versioning

Semver. **Major** = any change to a golden vector's expected output or a breaking schema change; **minor** = a new game, finding, event type or optional field; **patch** = no output change. Each game's `scoringVersion` (`major.minor`) is stored on every session; the verifier keeps the last two minors loaded and older majors in a cold image so any stored session can be re-scored. `telemetryVersion` is `1` for Phase 1–2.

---

## 13. Hackathon build (Phase 1–2) vs production (Phase 3+)

| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| Scorers | Nazar (both rules + commentary), Stopping Distance, Blind Spot, LL Sim complete; Junction Scan, Track Twin, Helmet Fit, Golden Hour on their thin level | all ten complete |
| Distribution | workspace package in the monorepo | private registry with provenance and SBOM |
| Determinism CI | Node + Chromium | + WebKit, Firefox, a low-end Android WebView |
| Debrief | detectors for the deep games; templates EN + HI | all detectors; more locales via rule-pack translations |
