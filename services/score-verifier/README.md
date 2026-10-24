# @margdarshak/score-verifier
> The private TypeScript compute service the Go API calls (decision D1). It replays game sessions with `@margdarshak/game-core` and returns the authoritative `SessionResult`; the server replay score wins (D-11). It also runs the learning, gamification and clip-agreement maths, so the client and the server share one implementation. Go keeps auth, persistence and orchestration. Every route is stateless and HMAC-signed, and none reads the clock: Go sends `now`.
> Built on `node:http` with no framework. Runtime deps: `zod`, game-core, `@margdarshak/gamification`, `@margdarshak/clip-pipeline`. Dev dep: `@margdarshak/content`, used only for the content build.
> Related: [game-core](../../packages/game-core/README.md) · [gamification](../../packages/gamification/README.md) · [clip-pipeline](../../packages/clip-pipeline/README.md) · [GAME_SDK §6.3](../../docs/09-learning-games/GAME_SDK.md) · [ARCHITECTURE §6](../../docs/03-engineering/ARCHITECTURE.md) · [BACKEND §9](../../docs/03-engineering/BACKEND.md)

## Run

Run these from `services/score-verifier`.

| Task | Command |
|---|---|
| Tests (real HTTP on an ephemeral port, from source) | `node --conditions=margdarshak-source --test --experimental-strip-types "test/**/*.test.ts"` (= `pnpm test`) |
| Build the content directory and the game-items index | `pnpm build:content` (= `node --conditions=margdarshak-source --experimental-strip-types scripts/build-content.ts [--out <dir>] [--index <file>] [--no-index]`) |
| Dev server from source | `VERIFIER_SHARED_SECRET=dev-secret VERIFIER_CONTENT_DIR=content pnpm dev` |
| Typecheck (src, test, scripts) | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` |
| Build | `pnpm --filter "@margdarshak/score-verifier..." build`. This builds game-core, gamification, clip-pipeline and content first, then writes `dist/server.js` and `dist/cli/replay.js` |
| Start the built server | `VERIFIER_SHARED_SECRET=… VERIFIER_CONTENT_DIR=content node dist/server.js` |
| Golden determinism gate (CICD) | `node dist/cli/replay.js ../../packages/game-core/fixtures/golden.json` (= `pnpm replay:golden`). See [Golden vectors](#golden-vectors) |

The `margdarshak-source` condition makes the workspace packages resolve to their TypeScript source. Without it, Node resolves the compiled `dist` (see game-core README §1.1). Production runs from `dist`, while `build:content` runs from source, which is why `@margdarshak/content` is only a dev dependency.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `VERIFIER_SHARED_SECRET` | none (required) | The HMAC secret. Falls back to `SCORE_VERIFIER_HMAC_SECRET`. The process exits 1 without one. The Go API signs with the same value (`SCORE_VERIFIER_SHARED_SECRET` / `VERIFIER_SHARED_SECRET`) |
| `PORT`, then `SCORE_VERIFIER_PORT` | `8081` | |
| `HOST` | `0.0.0.0` | |
| `VERIFIER_CONTENT_DIR` | unset, which serves the built-in golden fixtures (logged as dev only) | Point it at `services/score-verifier/content` after `build:content`. `/learn/answers` needs it, because the fixture store holds only the 10 golden LL keys |
| `VERIFIER_BODY_LIMIT_BYTES` | `262144` (256 KB) | Larger bodies get a 413. Raise it if `/clip/manifests` is sent hundreds of clips or `/learn/state` is sent a very long review log |
| `VERIFIER_REQUEST_TIMEOUT_MS` | `10000` | `server.requestTimeout` |
| `VERIFIER_REPLAY_CACHE_SIZE` | `10000` | How many accepted signatures are remembered |

## Content

The content lives in `VERIFIER_CONTENT_DIR`. It is gitignored (`services/score-verifier/.gitignore`) because it holds the LL server key. `pnpm build:content` writes it:

| Path | From | Shape |
|---|---|---|
| `q/<item>.json` (`:` in the ID written as `_`, e.g. `q/C-LL1-001_v1.json`) | `toLlAnswerKeys(splitQuestionBank(loadContent().questionBanks).serverKey, signs)`: one file per bank question, practice and mock | game-core `LlAnswerKey` |
| `formats/LLT-<state>.json` | Each state-pack row that overrides `PRM-LL-FORMAT` (today only `JK-PRM-LL-FORMAT`) | `LlExamFormat` |
| `formats/HPT-<state>.json` | Each state-pack row that overrides `PRM-HPT` with a format (today `KL-PRM-HPT`) | `HptFormat` |
| `sd/`, `bs/`, `js/`, `track/` | The game-core golden fixtures, until authored content exists | `SdRound`, `BsItem`, `JsItem`, `TrackSpec` |
| `BUILD.json` | Counts and the content version (no timestamps). The build refuses to replace a directory that has no `BUILD.json` | |

Provenance is never invented:
- `source_url`, `verified_on` (the row's `checkedOn`) and `confidence` come from the rule-pack row, or are null when the row has none.
- `per_q_timer_s` and `total_timer_s` are null because the pack has no timer. If a row ever sets `timerSeconds`, the build fails until someone decides whether it is a per-question or a total timer.
- Two HPT values are derived, and the index records each derivation: `total_marks = clips × marksPerClip`, and `max_hazards_per_clip = 2` from NAZAR §8 ("up to 2 hazards per clip", as reported).
- Tenants without an `LLT-<state>` row use game-core's default format (15 questions, 9 to pass, `passRule.source = "design"`).

Nazar clip documents are not written here. The Go API sends them inline (see `/verify` below).

The same build writes the committed index **`content/generated/game-items.json`** at the repo root. The Go API selects playable items from it. Its contents:
- `schema`, `gameCoreVersion`, a `contentVersion` hash, notes, and the format rows with their provenance flags;
- per game, sorted by `gameId`: `itemKind`, `gameVersion`, `scoringVersion` / `scoringVersions` (from `SCORING_VERSIONS`), `source` (`content/questions` | `game-core-fixtures` | `api`), `formats`, and items sorted by ref (`{ref, contentVersion, difficulty}`, where `difficulty` is null when unknown; LL items also carry `pool`, `topic` and `conceptId`).

The index never contains a key or a window. A drift test fails until you re-run `build:content`.

The directory layout behind a store is `<dir>/<kind>/<id>.json` per item ref `<kind>:<id>`, plus `<dir>/formats/<ruleId>.json`. Documents are validated with game-core's content schemas, and clients never receive them.

## Auth and errors

Every POST takes the header `Margdarshak-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`. This is the same scheme as `services/workflows/src/lib/hmac.ts` and the Go `hmacsig` package:
- the window is ±300 s;
- the comparison is timing-safe;
- an accepted signature is rejected if it is replayed, so re-sign every retry.

`/healthz` and `/versions` are unauthenticated: they sit on the private network, and the container healthcheck calls `/healthz`.

Errors are RFC 9457 `application/problem+json` with `type` `https://margdarshak.example/problems/<slug>`. Validation errors carry `errors[{path, message}]` and never the submitted values.

| Status | Slug |
|---|---|
| 400 | `bad-request` (the body is not JSON); `validation-failed` on the compute routes |
| 401 | `unauthorized`, with `code` `signature_missing`, `signature_malformed`, `signature_stale`, `signature_mismatch` or `signature_replayed` |
| 404 | `not-found` |
| 405 | `method-not-allowed` |
| 413 | `payload-too-large` |
| 415 | `unsupported-media-type` |
| 422 | `/verify`: `validation-failed` (kept from v0.1), `unsupported-game`, `unsupported-version`, `content-not-found`, `content-mismatch`, `context-mismatch`, `bad-replay`, `digest-mismatch`, `bad-events`. Compute routes: `content-not-found` and `content-mismatch` (a missing or bad answer key), `week-mismatch`, `invalid-ratings`, `invalid-adjudication`, `invalid-window`, `not-scorable`, `not-publishable` |
| 500 | `internal`, which includes a response that broke its own schema |

Every request and every response is a strict Zod schema (`src/verify.ts`, `src/routes/*.ts`). Unknown fields are rejected, and a response is parsed before it is sent.

## Endpoints

| Method and path | Module | In → out |
|---|---|---|
| `GET /healthz` | `app.ts` | → `{status, service, version, content}` |
| `GET /versions` | `app.ts` | → `{gameCore, scoringVersions, games, routes}` |
| `POST /verify` | `verify.ts` | session + replay (+ inline `content.items`, + `analysis`) → `{result, digest, eventsDigest, comparison, serverChecked, analysis?}` |
| `POST /learn/answers` | `routes/learn.ts` | `{now, answers[], reviewLog[]}` → `{results[], cards[]}` |
| `POST /learn/state` | `routes/learn.ts` | `{now, reviewLog, ratedAnswers≤40, conceptCounts, stateCode, gateInput?, nazarScore?, …}` → `{cards, masteryByTopic, nodeStates, reviewQueue, readiness, calibration, roadReadiness}` |
| `POST /gamification/evaluate` | `routes/learn.ts` | `{now, session?, minutesToday, sessionMinutes, xpTotal, nodeStates, verifiedNazarMocks, currentRank, streakState, weekKey, sessionsThisWeek, badgeHistory, …}` → `{xp, rank, streak, badges}` |
| `POST /clip/agreement` | `routes/clip.ts` | `{op: agreement \| adjudicate \| final_window \| scoring_clip, now, …}` → `{op, …}` |
| `POST /clip/manifests` | `routes/clip.ts` | `{now, clips[], flashPassed?, tenant?, resolution?, mediaBaseUrl?, include?}` → `{generatedAt, bank, client, mockEligibility}` |

`app.ts` mounts the route maps exported by `routes/learn.ts` and `routes/clip.ts` (`RouteMap`, see `routes/types.ts`) behind one pipeline:

> content type → body limit → signature → replay cache → JSON → strict request → handler → strict response

A path that is registered twice is a startup error.

### `POST /verify`

This is the flat shape of ARCHITECTURE §6, extended with what GAME_SDK §6.3 and API-35 need:

```jsonc
{
  "sid": "uuid", "gameId": "nazar", "gameVersion": "1.0.0", "scoringVersion": "1.0",
  "mode": "mock", "difficulty": 3, "seed": 734119, "seedOrigin": "server",
  "items": [{ "ref": "clip:KL-0001@1", "contentVersion": "1" }],
  "tenant": "JK", "rulePackVersion": "2026.10.23",
  "telemetryVersion": 1, "encoding": "mdr1",            // or "mdr1+gzip"
  "inputs": "<base64 replay>", "digest": "sha256:<hex of canonical events>", "eventCount": 35,
  "context": { "userBand": "adult", "locale": "en", "deviceClass": "mid", "offline": false, "serverStartIso": null }, // optional
  "clientResult": { "score": { "pct": 71 }, "findings": [{ "findingId": "NAZ_LATE_RESPONSE" }] },                     // optional
  "hints": { "seenClip": false, "sessionExpired": false },                                                          // optional
  "content": { "items": [ { "clipId": "KL-0001", "version": 1, "speedKmhEst": 40, "durationMs": 30000, "hazards": [ … ], "quietSegments": [] } ] }, // optional, P2
  "analysis": ["nazar_clips", "nazar_clips_linear"]                                                                  // optional, P2, Nazar only
}
```

`content.items` holds scoring documents sent inline (1 to 48 of them), which are looked up before the verifier's own store (`CompositeContentStore`). Each document must identify itself, in one of these ways:

| Document | Ref it serves |
|---|---|
| `{clipId, version, …}`: a game-core `NazarClip`, or a full clip.json (extra keys are stripped) | `clip:<clipId>@<version>` |
| `{trackId, version, …}` | `track:<trackId>@<version>` |
| `{qref, …}` | `q:<qref>` |
| `{rule_id, …}` | that format row (`HPT-KL`, `LLT-<state>`) |
| `{ref, doc}` (an envelope, for kinds without an ID, such as `sd:` rounds) | `ref` |

A document that identifies nothing, or a duplicate, is a 422 `validation-failed` whose path is `content.items.N`. A clip with `speedKmhEst: null` is a 422 `content-mismatch`.

The `200` response:

```jsonc
{
  "result": { /* SessionResult (GAME_SDK §10), server replay, integrity.provisional = false */ },
  "digest": "sha256:…",        // canonical JSON of result (the CI determinism hash)
  "eventsDigest": "sha256:…",  // canonical decoded events (equals the request digest)
  "comparison": { "match": false, "clientPct": 71, "serverPct": 64, "deltaPct": 7, "findingIdsMatch": true } | null,
  "serverChecked": true,
  "analysis": {                // only when requested; one key per requested kind
    "nazar_clips": {           // "kerala_5band" (product); "nazar_clips_linear" → "field_kit_linear" (study)
      "rule": "kerala_5band",
      "clips": [{
        "ordinal": 1, "ref": "clip:KL-0001@1",
        "voided": null,        // "pattern" | "INT_TAB_HIDDEN" | "INT_CLOCK_DRIFT"
        "taps": 3, "maxTapsInWindow": 2, "earlyTaps": 0, "falseAlarms": 1,
        "marks": 8,            // 0–10 per clip, before scaling to the format
        "hazards": [{ "hazardId": "h1", "hazardType": "bus_stop_pedestrian",
                      "credit": 4, "band": 2, "tapMt": 12950, "lateS": 0.4, "metres": 4.4, "prediction": null }]
      }]
    }
  }
}
```

Notes on the response:
- `credit` is 0–5 points under the 5-band rule, and a fraction 0–1 under the linear rule.
- `band`, `tapMt`, `lateS` and `metres` are null for a hazard that was not credited.
- Hazard windows are never echoed.
- On a mismatch (`|Δpct| > 0.5`, or different finding IDs), the result carries `INT_REPLAY_MISMATCH` (trust ×0.7). The server score is returned either way.
- Hints add `INT_SEEN_CLIP` and `INT_SESSION_EXPIRED`.

### `POST /learn/answers`

LL answers come in; correctness comes back. The answer keys are the verifier's own (`q/`), so Go never sees a key and never computes correctness. The answer rows are snake_case, like API-32.

```jsonc
{
  "now": 1792800000000,
  "answers": [{                        // 1–200, unique client_answer_id
    "client_answer_id": "a1", "qref": "C-LL1-001:v1",
    "selected_option_id": "a",        // null = no answer (wrong)
    "confidence": "100",              // optional "50" | "75" | "100"
    "latency_ms": 5400, "timer_ms": 30000,   // optional ("slow" = > 80% of the timer → Hard)
    "answered_at": 1792799940000,     // device time; kept if within ±24 h of now and monotonic per card (EC-15)
    "source_sid": "…"                 // optional; answers of one session collapse to one review per card
  }],
  "reviewLog": [{ "cardId": "C-LL1-001", "rating": 3, "reviewedAt": 1792500000000, "sourceSid": "…", "confidence": "75" }]
}
```

`reviewLog` should hold at least the stored log of the cards these answers touch.

The `200` response:

```jsonc
{
  "results": [{ "client_answer_id": "a1", "qref": "C-LL1-001:v1", "card_id": "C-LL1-001", "topic": "LL1",
                "correct": true, "rating": 4, "overconfident": false,
                "reviewed_at": 1792799940000, "next_due_at": 1793404740000 }],
  "cards": [ /* gamification CardState for every card in reviewLog ∪ the new reviews, sorted by cardId */ ]
}
```

To build the new review-log rows, Go appends `{card_id, rating, reviewed_at, confidence, correct, overconfident}`.

Errors: a question with no server key is a 422 `content-not-found`, and a duplicate `client_answer_id` is a 400.

### `POST /learn/state`

```jsonc
{
  "now": 1792800000000,
  "reviewLog": [ /* the subject's full review log, any order */ ],
  "ratedAnswers": [{ "correct": true, "confidence": "75" }],  // the last ≤ 40 confidence-rated LL answers, oldest first
  "conceptCounts": { "LL1": 30, "LL2": 23, "LL3": 10, "LL4": 12, "M1": 10 },
  "stateCode": "JK",
  "gateInput": { "llMockPcts": [70, 80], "passMarkPct": 60 },   // optional
  "nazarScore": 72,                                             // optional; null or absent = none yet
  "previousNodeStates": { "SK-LL1": "mastered" },               // optional (hysteresis)
  "gameCriteriaMet": ["SK-LL1"],                                // optional (module game criterion ever met)
  "newCandidates": ["C-LL1-007"],                               // optional, curriculum order
  "weekAnswers": [ … ]                                          // optional; "sure and wrong this week" (defaults to ratedAnswers)
}
```

The `200` response:
- `cards`: replayed with `replayReviewLog`;
- `masteryByTopic`: `{mastery, coverage, meanRetrievability, conceptCount, seen, covered}` per topic;
- `nodeStates`: all 29 skill nodes, `locked` when nothing is known;
- `reviewQueue`: `{due[], fresh[], dueRemaining, newIntroducedToday}`;
- `readiness`: `{readiness, knowledge, calPenalty, topics, calibration, weightsSource: "equal", gate{met, reasons, weakTopics, bookAnywayVisible: true}}`;
- `calibration`: `{n, brier, overconfidence, bins[50/75/100], sureAndWrong, calibrated}`;
- `roadReadiness`: `{score, knowledgePart, nazarPart, modules}`.

The output is deterministic for any order of the log.

### `POST /gamification/evaluate`

```jsonc
{
  "now": 1792800000000,
  "session": { "gameId": "nazar", "mode": "mock", "score": { "pct": 58, "capApplied": null },
               "findings": [{ "findingId": "NAZ_LATE_RESPONSE", "critical": false }],
               "integrity": { "trust": 1, "flags": [] } },     // optional; the SessionResultLike subset, strict (not the full SessionResult)
  "minutesToday": 30, "sessionMinutes": 12,                     // IST-day minutes before this activity; this session's minutes
  "reviews": { "dueCardsReviewed": 12, "reviewMinutes": 6 },    // optional review sitting (5 XP per due card)
  "xpTotal": 290, "nodeStates": { "SK-LL1": "learning", "SK-M1": "learning" },
  "verifiedNazarMocks": 1, "currentRank": "R1",                 // or null
  "streakState": { "status": "active", "weeks": 2, "tokens": 0, "goal": 4, "lastClosedWeek": "2026-W42" }, // or null
  "streakGoal": 4,                                              // optional, used when streakState is null
  "weekKey": "2026-W44",                                        // must be the IST ISO week of now
  "sessionsThisWeek": 2,
  "closedWeeks": [{ "weekKey": "2026-W43", "sessions": 4 }],    // optional: finished weeks not yet closed
  "testPassedAt": 1792800000000,                                // optional: archives the streak
  "badgeHistory": { "hasAccount": true, "declarations": { "firstAttemptPass": true }, "nazar": { "score": 91, "eligibleMocks": 3 } },
  "earnedBadges": ["B2"]                                        // optional, already stored
}
```

The `200` response:
- `xp`: `{session: XpAward | null, reviews: XpAward | null, gained, total}`;
- `rank`: `{rank, name, shape, next, promoted}`. It is never below `currentRank`;
- `streak`: `{state, events, notify: false, view}`. Weeks up to last week close lazily and idempotently: the given counts first, then zeros;
- `badges`: `{statuses[9], awarded[], revoked[]}`.

Errors: a `weekKey` that is not the IST week of `now`, or a `closedWeeks` entry that is not a finished week, is a 422 `week-mismatch`.

### `POST /clip/agreement`

| `op` | Extra input | Output |
|---|---|---|
| `agreement` | `raterA`, `raterB` (clip-pipeline `RaterSubmission`), `durationMs?`, `proposals?` | `{op, agreement: ClipAgreement}` |
| `adjudicate` | the same, plus `adjudication` (`AdjudicationInput`). The agreement is recomputed from the ratings | `{op, agreement, adjudication: {resolved, hazards, dropped, issues}}` |
| `final_window` | `marks`: 2 (mean) or 3 (median) `{aMs, bMs}` | `{op, window}`, frame-snapped at 30 fps |
| `scoring_clip` | `clip` (a published or retired clip.json) | `{op, scoringClip}`. A game-core `NazarClip`, ready to send inline to `/verify` |

```jsonc
{ "op": "agreement", "now": 1792800000000,
  "raterA": { "rater": "rater-01", "clipId": "JMU-0012", "version": 3, "submittedAt": "2026-10-23T10:00:00Z",
              "marks": [{ "hazardType": "bus_stop_pedestrian", "aMs": 12000, "bMs": 16500 }] },
  "raterB": { "rater": "rater-02", "clipId": "JMU-0012", "version": 3, "submittedAt": "2026-10-23T10:05:00Z",
              "marks": [{ "hazardType": "bus_stop_pedestrian", "aMs": 12500, "bMs": 17000 }] } }
// → { "op": "agreement", "agreement": { "accepted": true, "needsThirdRater": false, "reasons": [],
//      "finalHazards": [{ "hazardId": "h1", "window": { "aMs": 12267, "bMs": 16767 }, … }], … } }
```

Errors: ratings for different clips, or two ratings from one rater, are a 422 `invalid-ratings`. A bad adjudication (for example, by one of the two raters) is a 422 `invalid-adjudication`.

### `POST /clip/manifests`

`{now, clips[] (≤ 200 clip.json), flashPassed?: {"JMU-0012@3": true}, tenant?, resolution?, mediaBaseUrl?, include?: ["bank", "client"]}` → `{generatedAt, bank, client, mockEligibility: {"JMU-0012@3": {eligible, reasons}}}`.

- `generatedAt` is the ISO form of `now`.
- The client manifest (API-37) is a strict allowlist: it never carries hazard windows, quiet segments, cues or speed.
- A clip with no flash result is not mock-eligible.
- Media URLs are `<mediaBaseUrl>/clips/<id>/v<n>/<res>.mp4`, or the bare object key when no base URL is given (Go presigns per session).

## Golden vectors

`packages/game-core/fixtures/golden.json` (`margdarshak.game-core.golden/1`) holds every golden vector: its exact `/verify` request body, `expected.result` (with `replay.inputs` stored as `""`; it always equals `request.inputs`), `expected.digest` and `expected.eventsDigest`. Nazar requests carry their clip documents inline, as the Go API will.

- `node dist/cli/replay.js <golden.json>` runs every request through the verifier's own path (strict schema, content store, replay) against the built-in fixture content, and compares digests. It also accepts the older vector-array format. With no argument, it replays game-core's built-in vectors.
- The Go contract test signs each `request`, posts it to a verifier started without `VERIFIER_CONTENT_DIR`, and compares `result` and `digest`.
- `test/verify-extensions.test.ts` does the same over HTTP.

## Tests

| File | Covers |
|---|---|
| `server.test.ts`, `edge-cases.test.ts`, `unit.test.ts` | v0.1 contract: golden vectors, tampering, hints, HMAC, problem types, body limit, logs, directory store, config, EC-18 |
| `verify-extensions.test.ts` | Inline content (keys, precedence, 422s), per-clip analysis (both rules, marks equal the components, the worst `lateS` equals the finding, a pattern-voided clip), `golden.json` over HTTP |
| `content-build.test.ts` | A key for every bank item; the LL golden refs covered; LLT-JK and HPT-KL provenance; fixtures copied, no clips; `game-items.json` drift and shape; the built directory serving LL and sim vectors |
| `learn.test.ts` | Brier 0.25 / 0.39; readiness 78 = 84 − 6; XP 23, ×0.5, ×0.2 and pro rata; seen-clip 0 XP; rank (XP alone fails, promotion, never demotes); streak transitions and idempotence; badges; EC-15 times; HTTP: HMAC, 400 on an unknown field, correctness from server keys, state determinism, evaluate |
| `clip.test.ts` | HMAC and strictness; the 10 clip-pipeline agreement golden cases; invalid ratings; adjudication; final windows; scoring clip; manifests (no windows in the client manifest, eligibility, URLs) |

Logs are one JSON line per request on stdout (`reqId`, method, path, status, `durMs`, `gameId`, `sid`, error `code`). Bodies, replay inputs, answers, signatures and secrets are never logged.
