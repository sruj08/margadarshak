# @margdarshak/gamification
> Project: Margdarshak · Phase P2 · Status: v0.1.0 · Spec: [GAMIFICATION_ENGINE](../../docs/09-learning-games/GAMIFICATION_ENGINE.md) (main), [game-core README §8–§9](../game-core/README.md), [GAME_SDK §6.4, §7, §10](../../docs/09-learning-games/GAME_SDK.md), [CURRICULUM §1, §4](../../docs/09-learning-games/CURRICULUM.md)

The learning maths and the gamification rules, as **pure TypeScript functions**: FSRS scheduling and review-log replay, topic mastery, skill-tree node states, Test Readiness and Road Readiness, personal calibration, XP, ranks, weekly streaks, squads, badges, share-card and family-mode guards, and the anti-dark-pattern lint spec.

- **Never reads the clock.** Every function takes `now` (or the dates it needs) as epoch milliseconds. A test runs the FSRS path with `Date.now`, `new Date()` and `Math.random` all throwing.
- **No persistence.** Everything returns plain, JSON-serialisable data. The Go backend stores E-18, E-22 and E-23.
- **Structural inputs.** This package doesn't import `@margdarshak/game-core`. Its inputs (`SessionResultLike`, `RatedAnswer`, `ReviewLogEntry`) mirror only the `SessionResult` fields it reads (GAME_SDK §10), so a real `SessionResult` or `evidence[]` entry can be passed in as is.
- Runtime dependency: `ts-fsrs` 5.4.2 (FSRS-6), and nothing else. The game-core README places these names inside game-core; they live here so game-core stays zod-only.

| Task | Command (from `packages/gamification`) |
|---|---|
| Test | `node --test --experimental-strip-types "test/**/*.test.ts"` |
| Typecheck | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` |
| Build | `pnpm --filter @margdarshak/gamification build` → `dist/`. Exports resolve `margdarshak-source` → `src/*.ts` (tests, dev with `--conditions=margdarshak-source`) and `dist` otherwise, like game-core |
| Lint (from repo root) | `node node_modules/@biomejs/biome/bin/biome check packages/gamification` |

## Integration point with game-core (read this)

**`ratingFromEvidence` is not here.** The evidence → FSRS rating table (GAMIFICATION_ENGINE §4.3) lives in `@margdarshak/game-core/learning`, because the LL scorer fills `SessionResult.evidence[].rating`. The flow:

```
game-core scorer → SessionResult.evidence[] { cardId, rating 1–4, confidence?, overconfident }
  → backend appends ReviewLogEntry { cardId, rating, reviewedAt, sourceSid, confidence } to E-18
  → replayReviewLog(log) → CardState[] → topicMastery / reviewQueue / readiness   (this package)
```

`replayReviewLog` also collapses entries with the same `(cardId, sourceSid)` to the worst rating at the earliest time. That restates §4.3's "one review per card per session" as a safety net in case game-core or the backend ever posts twice.

## API by subpath

### `@margdarshak/gamification/learning`

| Export | Spec | Notes |
|---|---|---|
| `createScheduler(overrides?)` → `Scheduler` | §4.1 | Pinned `FSRS_PARAMS`: `request_retention 0.9`, `maximum_interval 60`, `enable_fuzz false`, FSRS-6 default weights (`FSRS_WEIGHTS`, checked against `ts-fsrs` `default_w` in a test), learning steps `1m, 10m`, relearning steps `10m`, short-term on. You can override `w`, `request_retention` and lower `maximum_interval`. Fuzz can't be turned on. `Scheduler` has `newCard(id, now)`, `review(card, rating, at)` and `retrievability(card, now)` |
| `pinnedScheduler()` | | The shared default instance |
| `replayReviewLog(log, scheduler?)` → `CardState[]` | §4.2 | Applies each card's entries in `reviewedAt` order (ties keep log order). Output is sorted by `cardId` and is byte-identical across runs |
| `acceptReviewTime(deviceAt, receivedAt, prevForCard)` | §4.4, EC-15 | Keeps the device time if it is within ±24 h of server receipt and monotonic per card. Otherwise uses the receipt time |
| `topicMastery(cards, now, { conceptCount? })` | §4.4 | `M_t = coverage × mean R`. R is capped at 0.6 below 2 reviews. Coverage needs ≥ 2 reviews and ≥ 1 Good/Easy |
| `masteryByTopic(cards, now, conceptCounts)`, `topicOfCard(id)` | §4.4, CURRICULUM §1.1 | Groups `C-<module>-<nnn>` cards |
| `reviewQueue(cards, now, { newCandidates?, maxPerSitting?, newPerDay? })` | §4.5 | Due cards first (lowest R, then earliest due, then id), at most 20 per sitting. Then new concepts, at most 8 per IST day (counted from `CardState.firstReview`) |
| `nodeState(history)`, `nextNodeState`, `canStartNode`, `SKILL_NODES`, `SKILL_EDGES`, `DL1_REQUIRES` | §3.1 | `locked → learning → mastered → fading`. In at `M ≥ 0.8` plus the module's game criterion; out at `M < 0.7`; back in at 0.8 |
| `readiness(masteries, answers, weights?, gateInput?)` | §5.1–5.2 | Returns `{ readiness, knowledge, calPenalty, topics, calibration, weightsSource, gate }`. `gate.bookAnywayVisible` is always `true` |
| `calibrationPenalty(answers)` | §5.1 | 0 below 15 confidence-rated answers |
| `roadReadiness(masteries, nazarScore, { stateCode })` | §5.4 | Uses M1, M3, M4, M6, M8 and M19, plus M14 when `stateCode` is `JK`. `score: null` without a Nazar Score |
| `brier`, `overconfidence`, `calibrationBins`, `sureAndWrong`, `isCalibrated` | §6 | Over the last 40 rated answers (the window can be changed) |
| `pairOutcome`, `outcomeCountLine`, `fitPassModel`, `predictionBrier` | §5.3 | Count line only from N ≥ 30. Logistic fit only from ≥ 100 pairs. `reviewGate` is set when the fit's Brier is worse than the base rate's |

### `@margdarshak/gamification/gamification`

| Export | Spec | Notes |
|---|---|---|
| `xpForSession(result, minutesToday, sessionMinutes?)` → `XpAward` | §2.1–2.2 | `round(base × max(0.3, pct/100) × diminish × trustFactor)`. Returns the breakdown for the E-22 ledger |
| `xpForReviews(dueCards, minutesToday, reviewMinutes?)` | §2.1 | 5 per **due** card |
| `diminish(before, length)`, `multiplierAt(minute)` | §2.2 | Bands at 45 and 90 minutes, split pro rata |
| `xpForAction(action)`, `NO_XP_ACTIONS` | §2.3 | Always 0 |
| `crossedSpacingLine(before, after)` | §2.2 | When to show the calm 45-minute line, once |
| `rankFor(xp, nodeStates, { verifiedNazarMocks?, currentRank? })` | §3.2 | Returns `{ rank, name, shape, next: { xpMissing, nodesMissing, nazarMocksMissing } }`. Never below `currentRank` |
| `streakTransition(state, { weekKey, sessions, testPassedAt? })` → `{ state, events, notify: false }` | §7 | Plus `initialStreak`, `archiveStreak`, `setStreakGoal`, `countStreakSessions`, `streakView` |
| `squadScore(members)` | §8 | `null` below 3 contributors |
| `canJoinSquad`, `canUsePairMode`, `inviteValid`, `squadWeeklyGoal`, `squadRibbon`, `sangathanRibbon`, `memberView`, `SQUAD_REACTIONS` | §8, §13 | |
| `evaluateBadges(history)` → `BadgeStatus[]` (all nine), `BADGES` | §9 | `yourWord: true` on self-declared badges. Criteria are data (DP-07) |
| `shareCardViolations(card, ctx)`, `canCreateShareCard`, `isAllowedShareHost`, `percentileVisible`, `shareCardLive` | §10 | Allowlist of card fields |
| `featureAccess(profile, feature)`, `ageBand(input, now)`, `ownAccountOffer` | §1, §13, EC-01 | |
| `patternLintSpec`, `patternRule(id)` | §12 | DP-01..DP-18 as data for the MD-235 copy scanner and ESLint plugin |

### `@margdarshak/gamification` (root)

Everything above, plus the IST time helpers: `istDay`, `istDayStart`, `istDate`, `istWeek`, `isoWeekOfDay`, `isoWeekday`, `parseWeekKey`, `nextWeekKey`, `istMinutesOnDay`, `daysFromCivil` and `civilFromDays`.

## Design decisions

| Topic | Decision |
|---|---|
| Time | Epoch ms everywhere. IST is a fixed UTC+05:30 (no DST), computed without `Intl`. "The day" for diminishing returns and the new-concept cap is the IST calendar day |
| Streak weeks | ISO-8601 weeks on the IST calendar (Monday 00:00 to Sunday 23:59:59.999 IST), keyed `"2026-W43"`. ISO week-numbering years apply (2027-01-03 belongs to `2026-W53`) |
| `minutesToday` | The minutes already accrued in the IST day **before** this session started. Pass the session's own duration as `sessionMinutes`. `istMinutesOnDay(intervals, now)` computes the day total and splits sessions that cross midnight |
| Band boundaries | The multiplier applies to the minute being played. Minute 44→45 is the last one at ×1.0. With exactly 45 minutes played, the next minute earns ×0.5; with exactly 90, ×0.2. A straddling session gets the time-weighted mean of the bands it covers (e.g. 30→60 min = ×0.75) |
| Rounding | Half up after snapping to 1e-9, so `40 × 0.15 = 6.000000000000001` gives 6. The Go side should mirror this |
| `pair` mode XP | Practice base (20). The §2.1 table doesn't list pair mode, and it plays practice content |
| Seen-clip mocks | A `mock` carrying `INT_SEEN_CLIP` earns 0 XP (§2.3, "replaying a mock clip already seen"). Practice sessions aren't affected |
| Rank ladder | Cumulative: rank n needs its own requirements and every lower rank's. "At learning" means learning, mastered or fading. "Mastered" for a **promotion** means mastered now: a fading node doesn't open a new rank (refresh first), and a rank already held never drops |
| Ghat | "(+ SK-M8 at 'learning')" is treated as required |
| Badges and fading | A badge earned at mastery stays earned when the node later fades (B7, B8 accept `fading`) |
| Badge evidence | Only sessions with trust ≥ 0.6 count. B5 "≥ 2 days apart" means IST calendar days differ by ≥ 2. B6 counts distinct IST days, so 7 taps in a minute aren't 7 checks, within any 14-day window. Calibrated (B4) needs a non-empty 100% bin |
| Badge labels | Label keys: `your_word`, `self_checked`, `counted_sessions`. The spec's "Verified sessions: n" is rendered as "counted", because PROJECT_BRIEF §15 bans "verified" for user records |
| Squad score | A member contributes only when both a Nazar Score and a Brier exist. The result is rounded to an integer |
| Streak tokens | "+1 per completed week, max 2" applies to every week whose goal is met, including a repair week and a failed-repair week that still met the plain goal |
| Streak archive | On `testPassedAt` the week cut short by test day counts only if its goal was met. A missed partial week is never held against the user. Archived is terminal |
| Missing weeks | `streakTransition` closes any skipped weeks with 0 sessions first, in order. Closing a week at or before `lastClosedWeek` changes nothing (idempotent, as the Workflows rule requires) |
| Review sittings | Each review sitting with ≥ 10 due reviews counts as one streak session |
| Readiness gate input | The last two verified LL mocks and the rule-pack pass mark. Without them the gate reports `no_mock_data`; the score itself is unchanged |
| Readiness weights | Equal by default (`source: "equal"`). Custom weights must sum to 1 and carry a non-empty `source`, otherwise a `RangeError` is thrown |
| Age band | Read on the IST calendar. Unknown age is treated as u18 |
| Readiness pairing (§5.3) | The latest snapshot in `[testAt − 7 d, testAt)` |
| Pass-model fit | Newton/IRLS from (0, 0) with a 1e-6 ridge so separated data converges. Deterministic |

## Deviations from the spec

1. **FSRS 60-day cap is re-applied after ts-fsrs.** ts-fsrs 5.4.2 clamps each interval to `maximum_interval` and only then forces `hard < good < easy`. A run of Easy reviews therefore gets scheduled 61 or 62 days out. §4.1 says intervals stop at 60, so `review()` caps `scheduled_days` at 60 and sets `due = at + 60 d`. Stability and difficulty are untouched.
2. **ts-fsrs version.** §4.1 names 5.4.1 as the "candidate seen in research". The catalog pins **5.4.2**, a 5.x patch release and not the 6.0 beta.
3. **ts-fsrs side effect.** On import, ts-fsrs patches `Date.prototype` (`scheduler`, `diff`, `format`, `dueFormat`, deprecated). This package declares `"sideEffects": false` for its own modules, but importing it still pulls in that patch. Nothing here uses those methods.
4. **`ratingFromEvidence` is left out on purpose.** It belongs to game-core (see above).
5. **Extra parameters beyond the README signatures.** `xpForSession` takes `sessionMinutes` (needed for the pro-rata split, since `SessionResult` carries no duration). `readiness` takes `gateInput`. `rankFor` takes `{ verifiedNazarMocks, currentRank }` (Shehar needs a mock, and "never demotes" needs the held rank). `topicMastery` takes `conceptCount`. Each extra is optional, so the README call shapes still work.

## Open questions (for the spec owners)

- **Badge slots:** PROJECT_BRIEF §15 says "9 slots; slot 7 has Night and Hill variants", but GAMIFICATION_ENGINE §9 lists Night Ready (B7) and Ghat Ready (B8) as separate badges, plus B9. This package follows §9: nine distinct badges.
- **Failed repair:** the spec's state machine sends a failed repair to `active(0)` even when that week met the plain goal. This package follows it literally. A more forgiving rule would be `active(1)`.
- **Squad API:** PROJECT_BRIEF §7 marks API-39 "(adults only)". §15 and D-13 revised allow a minor's profile once the parent consents. This package follows §15.
