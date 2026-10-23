# Gamification Engine: XP, ranks, mastery, readiness, streaks, squads, badges
> Project: Margdarshak · Owner: Learning & Games lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [GAME_SDK](GAME_SDK.md) · [GAME_DESIGN](GAME_DESIGN.md) · [CURRICULUM](CURRICULUM.md) · [DEBRIEF_SPEC](DEBRIEF_SPEC.md) · [NAZAR](NAZAR.md) · [Design system](../02-design/DESIGN_SYSTEM.md) · [Privacy](../06-security-compliance/PRIVACY.md) · [Compliance](../06-security-compliance/COMPLIANCE.md) · [Metrics](../01-product/METRICS.md)
> Features: F-20, F-21, F-26, F-28, F-15 (refresh), F-53 (nudges), F-54 (minor gating) · Entities: E-18 TopicMastery, E-22 Achievement, E-23 Squad, E-27 PracticeLog, E-11 TestAttempt · APIs: API-31, API-32, API-33, API-38, API-39, API-46, API-47 · Directives: D-11, D-13, D-14, D-19, D-22 · Edge cases: EC-05, EC-14, EC-15, EC-22, EC-26
> Evidence: `research/ps1-deep/05-psychology.md` (principles 10–20, cheat vectors), `08-game-ai-n8n.md` §4, `06-design-language.md` §B11.

---

## 0. Principles (why this isn't "points slop")

| # | Principle | Evidence | What it rules out |
|---|---|---|---|
| 1 | Mechanics are delivery vehicles for **retrieval, spacing, error feedback and calibration** | Sailer & Homner 2020: cognitive g = .49, behavioural g = .25 (`05` insight 10) | XP for opening the app, sharing or inviting |
| 2 | Status comes from **anticipation and calibration, never speed** | peers raise young men's risk-taking (`05` insight 4); principle 17 | speed leaderboards, "fastest reaction" ranks |
| 3 | **Private by default**; sharing is a choice | failing feels like humiliation (`05` insight 6) | public loss, "your friend beat you" pushes |
| 4 | **Forgiving** streaks: weekly, repairable, silent on break | Silverman & Barasch 2023 (`05` principle 16) | daily streak guilt, sad-emoji pushes |
| 5 | **No tangible rewards for learning** | Deci, Koestner & Ryan 1999 (`05` principle 15) | cash, cash-back, coupons, redeemable prizes; also the Online Gaming Act 2025 stake-free requirement (verification G9) |
| 6 | The loop **ends at DL test day** | `05` principle 16 | lifetime DAU goals; the only post-licence loop is an opt-in Nazar refresh |
| 7 | **Honest copy, legally**: the CCPA 2023 dark-pattern list is a CI lint (§12) | CCPA Guidelines, 30 Nov 2023 | false urgency, confirm-shaming, nagging… |
| 8 | **Under 18 gets none of it** (D-13) | DPDP s.9(3) bans tracking and behavioural monitoring of children (verification G7) | XP history, streaks, squads, badges, share cards for minors |

---

## 1. Who gets what

| Mechanic | Adult (DOB ≥ 18, account) | Adult, anonymous device session | Under 18 (P-07) |
|---|---|---|---|
| FSRS reviews, mastery, readiness | server + device cache | device only, migrates on account creation | **device only**, never synced |
| XP, ranks | yes | device only, migrates | **no** |
| Weekly streak | yes | device only | **no** |
| Squads, pair mode | yes | no (needs an account) | **no** |
| Badges | yes | device only (except self-declared ones, which need an account) | **no** |
| Share card | yes | no | **no** |
| Practice Record | yes | no | **no** |
| Notifications | opt-in, ≤ 1/day | no | **no marketing; only guardian-configured case-clock reminders if the guardian opts in (F-17)** |

---

## 2. XP

### 2.1 Formula
```
XP_session = round( base(gameId, mode) × quality × diminish(minutes_today) × trustFactor )
quality     = max(0.3, score.pct / 100)            // failing still earns: error-management training (05 insight 10)
trustFactor = 1.0 if integrity.trust ≥ 0.6 else 0.5
XP_review   = 5 per due FSRS card reviewed (any rating), × diminish(minutes_today)
```

| Base | Value |
|---|---|
| mock (Nazar Kerala format, LL mock) | 40 |
| practice (any game) | 20 |
| learn (lessons, Nazar learn, Golden Hour first run) | 15 |
| due FSRS review | 5 per card |
| non-due re-review of the same card (cramming) | 0 |

### 2.2 Diminishing returns (spacing beats grinding)
`minutes_today` = server-computed active learning minutes (sum of verified session durations + review time) in the user's IST day (00:00–23:59 IST, server clock: EC-15).

| Minutes today | Multiplier |
|---|---|
| 0–45 | × 1.0 |
| 45–90 | × 0.5 |
| > 90 | × 0.2 |

A session that straddles a boundary is split pro rata. The UI shows a calm line once the user crosses 45 minutes: "Good session. Your brain keeps more if you come back tomorrow." (no lock, no nag).

### 2.3 What never earns XP
Opening the app; streak days by themselves; sharing; inviting; joining a squad; completing the profile; watching the MoRTH tutorial (it's a legal step, not a game); replaying a mock clip already seen (Nazar mocks are unseen-only anyway).

### 2.4 Examples
- Nazar mock at 58%, first session of the day, trust 1.0: `40 × 0.58 × 1.0 × 1.0 = 23 XP`.
- LL practice at 20%: `20 × 0.3 × 1.0 = 6 XP` (floor).
- 12 due reviews after 60 minutes of play: `12 × 5 × 0.5 = 30 XP`.

---

## 3. Skill tree and ranks gated by mastery

### 3.1 Skill tree (nodes = CURRICULUM modules)
```
LL syllabus:  SK-LL0 ─ SK-LL1 Signs ─ SK-LL2 Rules ─ SK-LL3 Signals ─ SK-LL4 Documents
Survival:     SK-M1 Stopping ──► SK-M2 Impact ──► SK-M7 Following ──► SK-M16 Fog/rain
              SK-M3 Helmet ──► SK-M13 Pillion
              SK-M4 No-zone ──► SK-M5 Left-overtake
              SK-M6 Junctions ──► SK-M18 Pedestrians/animals
              SK-M8 Night ──► SK-M16
              SK-M14 Hill (J&K) ──► SK-M15 Landslides/snow
              SK-M19 Golden hour (standalone)
DL test:      SK-DL1 Track (class-specific) ← requires SK-M1 + SK-LL1 at "learning"
```
Node states: **locked → learning** (any evidence) **→ mastered** (`M_t ≥ 0.8` and the module's game criterion, CURRICULUM §6) **→ fading** (`M_t < 0.7` after mastered). Fading shows a soft "Refresh" chip, never a red alarm (`08` §4.3). Every node lists its rule IDs and the MoRTH table behind its "why this matters" card.

### 3.2 Ranks (XP **and** mastery; XP alone can't buy a rank)
| Rank | Name | XP [D] | Mastery requirement | Badge shape on the rank chip |
|---|---|---|---|---|
| R1 | **Gali** (lane) | 0 | none | rectangle |
| R2 | **Mohalla** (neighbourhood) | 300 | SK-LL1 and SK-M1 at "learning" | rectangle |
| R3 | **Shehar** (city) | 900 | SK-LL1..LL4 at "learning"; SK-M1, SK-M3, SK-M6 at "learning"; ≥ 1 verified Nazar mock | circle |
| R4 | **Highway** | 2,000 | SK-M1, SK-M4, SK-M5, SK-M7 at "learning" or above, and SK-M1 + SK-M4 "mastered" | triangle |
| R5 | **Ghat** (hill) | 3,500 | Highway requirements + SK-M14 "mastered" (+ SK-M8 at "learning") | octagon |

- **Ranks never go down.** If a required node fades, the rank stays and the node shows "Refresh". Demotion would be loss-aversion punishment.
- Rank thresholds are design values, tuned after the field study; they're labelled design in config.

---

## 4. FSRS topic mastery

### 4.1 Library and pinning
- **`ts-fsrs`**, which implements FSRS v6 (`08` §4.4, [jsDelivr](https://www.jsdelivr.com/package/npm/ts-fsrs)). **Pinned to an exact 5.x release** (`"ts-fsrs": "5.4.1"` as the candidate seen in research; confirm with `npm view ts-fsrs version` at H0 and never take the 6.0 beta line [unverified latest 5.x]). Its README requires Node ≥ 20. It runs in the browser, so scheduling works offline.
- API used (names per the README, re-check on pin [K]): `generatorParameters({...})`, `fsrs(params)`, `createEmptyCard(now)`, `f.next(card, now, rating)`, `f.get_retrievability(card, now)`, `Rating.Again | Hard | Good | Easy`.
- **Parameters [D]:** `request_retention = 0.90`; `maximum_interval = 60` days (prep lasts 30–90 days; longer intervals are useless before the test); **`enable_fuzz = false`** so client and server compute identical due dates from the same review log (fuzz adds randomness); default FSRS-6 weights. Per-user weight optimisation is Production (needs a few hundred reviews per user; FSRS optimiser [K]).

### 4.2 Cards
- **One card per concept, not per question** (`C-<module>-<nnn>`, CURRICULUM §1.1). Question variants, Nazar clips of a hazard type and game items all post evidence to the same concept card.
- Card state + an append-only **review log** `(card_id, rating, reviewed_at, source_sid, confidence)` live in E-18. The **review log is the source of truth**: card state is recomputed by replaying logs in order, so device and server always converge.

### 4.3 Evidence → rating (deterministic, `game-core/learning`)
| Outcome | Rating |
|---|---|
| Wrong, missed, or a critical fault | 1 Again |
| Correct but late (Nazar band 4–5), slow (> 80% of the item timer), or at 50% confidence | 2 Hard |
| Correct, on time | 3 Good |
| Correct, early (Nazar band 1), at 100% confidence | 4 Easy |
| **Wrong at 100% confidence** | 1 Again **+ an overconfidence event** |

Multiple pieces of evidence for one card in one session collapse to the **worst** rating (one review per card per session), so a long session can't inflate stability.

### 4.4 Mastery per topic *t*
```
M_t = coverage_t × mean_{c ∈ seen_t} R_c(now)
coverage_t = |{ c ∈ t : reviews_c ≥ 2 and at least one Good/Easy }| / |concepts in t|
R_c(now)   = FSRS retrievability from ts-fsrs, capped at 0.6 when reviews_c < 2 (evidence floor) [D]
```
- `now` is **server time** online and device time offline; on sync, device review times within ±24 h of server receipt and monotonic per card are accepted, otherwise the receipt time is used (EC-15, clock tampering).
- **Placement for users who already hold an LL (EC-22):** a 10-item placement quiz across LL1–LL4 posts normal evidence; it can't mark concepts it didn't test.

### 4.5 Review queue (API-31)
Due cards first (by lowest retrievability), max 20 per sitting [D]; new concepts introduced at most 8 per day [D] to protect spacing; due Nazar hazard types are surfaced as "3 short clips" rather than as cards.

---

## 5. Test Readiness Score (F-21)

### 5.1 Formula (shown to the user)
```
Knowledge   = round(100 × Σ_t w_t × M_t)            t ∈ {LL1, LL2, LL3, LL4}
OC          = mean(stated confidence) − accuracy     over the last 40 confidence-rated LL answers
CalPenalty  = min(10, round(40 × max(0, OC − 0.05)))
Readiness   = max(0, Knowledge − CalPenalty)
```
- **Weights:** `w_t = 0.25` each. The real test's topic mix is unknown (`02` §4), so the UI says "equal weights: the real test's topic mix isn't published". A state rule pack may set weights only with a source.
- **Display:** "**78 = knowledge 84 − calibration 6**" (PROJECT_BRIEF F-21), with a tap-through to the four topic bars and the calibration chart. Example: topic masteries 0.90/0.85/0.80/0.81 → knowledge 84; stated confidence averages 0.85 at 0.65 accuracy → OC 0.20 → penalty `40 × 0.15 = 6` → 78.
- Under 15 confidence-rated answers, CalPenalty = 0 and the chip says "calibration: not enough answers yet".

### 5.2 The 85 gate is advisory
"Ready, book the test" (lock opens on the dial at 85) needs: `Readiness ≥ 85` **and** every LL topic `M_t ≥ 0.7` **and** the last 2 LL mocks ≥ the state pass mark + 10 percentage points (e.g. ≥ 70% where the pass mark is 60%) (`08` §4.4). **"Book anyway" is always visible**, whatever the score: blocking would be interface interference (CCPA) and against autonomy (`05` principle 15).

### 5.3 Calibrating the score itself (Brier on real outcomes)
Readiness is a *practice* indicator, not a probability. We only turn it into a pass prediction once data supports it:
1. Users may enter their real LL result (E-11 TestAttempt, API-15 `test_passed`/`test_failed`). Each result is paired with the Readiness shown in the 7 days before the test.
2. After **≥ 100 paired outcomes per tenant** [D], fit `p_pass = σ(a + b × Readiness)` (logistic regression, nightly stats Workflow) and report its **Brier score** `(1/N) Σ (p_i − o_i)²` and a reliability plot in the public stats (API-71) and the state console (F-41).
3. Until then, the only outcome line allowed is a count: "Of N users who reached 85 before testing, k passed" (shown when N ≥ 30 [D]); never a percentage chance for an individual.
4. If the fitted Brier is worse than the base-rate model (always predicting the tenant pass rate), the gate threshold is reviewed, and the change is logged in CHANGELOG.

### 5.4 Road Readiness (separate, never mixed with LL)
`RoadReadiness = 0.5 × 100 × mean(M_t for SK-M1, M3, M4, M6, M8, M19 [+ M14 in the J&K tenant]) + 0.5 × NazarScore` [D]. Shown on the Practice Record and the S8 new-rider screen. **Never a gate, never called "safety score"**.

---

## 6. Personal calibration (Brier)

- Every practice answer (LL Sim and quiz items in other games) asks "How sure?" with **50% / 75% / 100%** before feedback (`05` principle 11).
- **Brier** `B = (1/N) Σ (p_i − o_i)²` over the last 40 rated answers, `o_i = 1` if correct. Reference points: always saying 50% gives 0.25; always saying 100% with 61% accuracy gives 0.39 (`08` §4.5).
- **Calibration chart:** three bins (stated 50/75/100 vs actual accuracy), with n per bin.
- **Private nudge:** "You were sure and wrong 4 times this week" (only to the user; never in squads or share cards unless they choose the Calibrated badge).
- **Nazar calibration:** before a mock, "How many of 10 clips will you pass?" vs actual (finding `NAZ_OVERCONFIDENT`).
- **Calibrated badge:** `B ≤ 0.18` over ≥ 40 items and `|stated − actual| ≤ 0.10` in the 100% bin [D].

---

## 7. Weekly streaks (repairable, silent)

| Rule | Value |
|---|---|
| Week | Monday 00:00 – Sunday 23:59 IST, server clock |
| Goal | user picks 2–6 sessions per week; default 4 |
| What counts as a session | ≥ 1 verified scored game session, or ≥ 10 due reviews |
| Freeze tokens | +1 per completed week, max 2 banked; **applied automatically and silently** to a missed week |
| Repair | a missed week (with no token) is repaired by doing **goal + 2** sessions the next week |
| On break | **silent**: no push, no sad emoji; next visit shows "New week: 0/4" |
| Visual | the week as road-dots (one per goal session); a missed week shows a pothole you can "fill" by repairing (`06` B11, adapted from daily dots to the weekly rule) |
| End | archived on DL test day (E-11 `test_passed`) as "Prep streak: 5 weeks"; never a lifetime streak |
| Post-licence | opt-in weekly 2-minute Nazar refresh (F-15) with a plain counter ("refreshes: 6"), no streak and no guilt |
| Notifications | a streak alone never triggers a notification |

State machine (E-22 `streak`): `active(weeks, tokens)` → week closes → goal met → `active(weeks+1, min(2, tokens+1))`; goal missed + token → `active(weeks, tokens−1)` silently; goal missed, no token → `repairable(weeks)` → next week ≥ goal+2 → `active(weeks+1)`, else → `active(0)` silently.

---

## 8. Squads (co-op only)

| Rule | Value |
|---|---|
| Size | 3–5 members (E-23), invite-only link (expires 7 days) |
| Who | **adults only** (verified DOB ≥ 18). No under-18 squads of any kind (D-13 overrides the school-code idea in `08` §4.7) |
| Squad score | `mean over members with a Nazar Score of (NazarScore_i × (1 − B_i))`, shown only when ≥ 3 members contribute (so no individual's score can be inferred) |
| Weekly squad goal | `3 × members` sessions [D] (e.g. 15 for 5); **everyone gets the ribbon, or nobody does** |
| What members see of each other | display name (user-chosen), rank, whether they hit their weekly goal (yes/no). **Not** individual scores, calibration or failures |
| Communication | **no free-text chat**; preset reactions only ("Nice spot", "Let's go Sunday", "Need help on signs") → avoids hosting user-generated content (IT Rules 2021 intermediary duties: verification G12) |
| Pair mode | two members play the **same seed / same 10 clips**; each sees their own result and "you both spotted X of Y hazards". No winner is declared, no ranking |
| Challenge link | from a share card: the friend plays the same clips; the result is shown to the friend only, framed as their own score |
| Leaving | one tap, no confirm-shaming; the squad isn't told why |
| Pillion Pledge | after the DL (`05` principle 19): rider and most-frequent pillion sign a 3-line pact (helmet for both, no phone, the pillion may say "slow kar"); the squad sees that it exists, not its contents |
| Moderation | squad names from a filtered list or user text through the same PII/profanity filter as RTO Live Intel; report button; grievance officer in the footer |

**Squad Sangathan ribbon:** weekly squad goal met 3 times. It's a squad ribbon on the squad page, not one of the nine personal badges.

---

## 9. Badges (nine, road-sign shaped)

Shapes follow the Indian road-sign families (IRC:67) [K]: **circle** (mandatory), **triangle** (cautionary), **rectangle** (informatory), **octagon** (stop). Badges are drawn in brand tokens, not sign-red, so they never look like a government sign (`06` B11). Each badge's criteria are shown **before** you start (CCPA bait-and-switch).

| # | Badge | Shape | Criterion (deterministic) | Verified by | Label |
|---|---|---|---|---|---|
| B1 | **Khud Licence** | rectangle | user declares "I got my DL without an agent" and enters the DL issue date; optional DigiLocker "DL present" check (no number stored) | **self-declared** | "Your word" / "आपका वचन". Never shown as a government verification (`05` cheat table) |
| B2 | **Pehli Baar Pass** | rectangle | user declares a first-attempt DL pass | **self-declared** | "Your word" |
| B3 | **Nazar 90** | circle | Nazar Score ≥ 90 over ≥ 3 eligible mocks (unseen clips, trust ≥ 0.6, server-verified) | server | "Verified sessions: n" |
| B4 | **Calibrated** | circle | §6 criterion | server | |
| B5 | **No-Zone Navigator** | triangle | G3 Blind Spot ≥ 85 twice, ≥ 2 days apart | server | spacing built in |
| B6 | **Strap Streak** | circle | 7 helmet self-checks in 14 days | self-check | "Self-checked" |
| B7 | **Night Ready** | triangle | SK-M8 mastered (G8 mastered once it ships; in Phase 1–2, night-tagged Nazar types mastered) | server | |
| B8 | **Ghat Ready** | triangle | SK-M14 mastered (G9) | server | J&K pack first |
| B9 | **Golden Hour Ready** | octagon ("stop and help") | G7 ≥ 80 with no critical error | server | **available only after the medical sign-off** (CURRICULUM M19). Renamed from `08`'s "Rah-Veer Ready" so a badge is never confused with the government Rah-Veer scheme |

Rules: badges can't be bought, gifted or earned by sharing; they're private until the user puts one on a share card; self-declared badges need an account (no anonymous claims); revoking a self-declaration removes the badge silently.

---

## 10. Share cards

- **Server-rendered** OG image (1080 × 1350, `06` B11) at `https://<our-domain>/c/{shortId}` (domain never contains "parivahan", "sarathi" or "gov": verification G10). **No APK link, no install bait** (CCPA rogue malware; `05` insight 8).
- **Content:** display name or initials (user's choice), **Nazar Score** with "verified sessions: n", rank, one badge, the line "Rewards anticipation, not speed", and "Challenge me on the same 10 clips".
- **Footer on every card:** "Practice score on Margdarshak's clips · not a licence test · independent, not affiliated with MoRTH/NIC".
- **Kerala line (optional):** "Kerala's announced pass mark: 60/100". Never "Kerala would fail me" (overclaim; see the inconsistency note on the field-kit share text) and never "certified".
- **Never:** PII, RTO, dates, LL/DL status, failures, calibration details (unless the Calibrated badge is chosen).
- **Percentile** ("better than X% of takers") appears only once ≥ 200 verified mocks exist in the baseline [D], so it's never fake.
- Regenerated from server-recomputed scores (client edits can't inflate it). The user can delete the card (link returns 404); links expire after 90 days [D].
- Sharing earns no XP and unlocks nothing (CCPA forced action).

---

## 11. Practice Record (F-28)

| Aspect | Spec |
|---|---|
| What it is | A user-held record of **what happened inside Margdarshak**: practice sessions, Nazar Score, modules mastered, Road Readiness, and supervised-practice log entries with optional supervisor sign-offs |
| Name | "Practice Record" (renamed from "competence passport", D-14). Never "verified", "certified", "licence" or "passport" |
| Sections | (1) Nazar Score + n verified mocks + date range; (2) modules mastered (with dates); (3) in-app practice minutes (verified sessions only); (4) supervised practice log (E-27): date, duration, conditions (day/night, road type), **self-entered**, labelled as such; (5) supervisor/driving-school sign-off, a **separate attributed field** (who signed, when; school ID if a Pro school, F-40) |
| Export | PDF and JSON (API-46 `GET /v1/me/practice-record`) |
| Signature | Margdarshak signs the canonical JSON of sections (1)–(3) only, with Ed25519 (JWS, `alg: EdDSA`); key in a Render secret (hackathon) → cloud KMS/HSM (production). Sections (4)–(5) are signed by their author, not by us |
| QR check | the PDF carries a QR to `https://<our-domain>/v1/verify/practice-record/{token}` (API-47): a 128-bit random token, revocable, 180-day expiry [D]. The page shows exactly what was signed and the line "Signed by Margdarshak for in-app practice only. Not a licence and not a government record." |
| Privacy | no name unless the user adds one for export; no DOB, no RTO, no case data; revoke any time |
| Insurer use | one roadmap line only (verification row 10); a training-completion benefit could never depend on a game result (Online Gaming Act, verification G9) |

---

## 12. Anti-dark-pattern lint (CCPA Guidelines for Prevention and Regulation of Dark Patterns, 2023)

The Guidelines (notified 30 Nov 2023) specify **13 patterns** ([Mondaq](https://mondaq.com/india/consumer-trading-unfair-trading/1398262/ccpa-issues-guidelines-for-prevention-and-regulation-of-dark-patterns-2023-effective-30-november-2023), [JSA](https://jsalaw.com/wp-content/uploads/2023/12/JSA-Prism-Consumer-Protection-Guidelines-for-Prevention-and-Regulation-of-Dark-Patterns-20233-Final.pdf)). Each maps to a lint rule that runs in CI (`pnpm lint:patterns`) and in design review. **Enforcement types:** *copy* = i18n string scanner with banned/required phrases per locale; *component* = ESLint rule in `eslint-plugin-margdarshak` on JSX props; *e2e* = Playwright assertion; *review* = PR checklist item.

| Lint | CCPA pattern | Our rule | Enforcement |
|---|---|---|---|
| DP-01 | False urgency | Countdowns only from the rules engine (LL expiry, real test date). No "only N slots left" unless it comes from a moderated Live Intel report with a timestamp | component: `<Countdown>` requires `sourceRuleId`; copy: bans "hurry", "only * left", "जल्दी करें" without a source key |
| DP-02 | Basket sneaking | Nothing is added to any selection without an explicit tap; school bookings show the full total (incl. vehicle) before the tap | e2e: booking flow totals equal the line items; no pre-selected add-ons |
| DP-03 | Confirm shaming | Decline buttons are neutral ("Not now" / "अभी नहीं"); never "No, I like paying agents" | copy: decline-key strings checked against a shaming list; review |
| DP-04 | Forced action | Games work without camera, contacts, squads or sharing; sharing never unlocks content | e2e: each game completes with camera denied and no account; component: `requiresShare` prop banned |
| DP-05 | Subscription trap | No subscription in the MVP; any future school Pro tier cancels in one tap from the same screen | review; e2e when Pro ships |
| DP-06 | Interface interference | "Book anyway" visible whenever Readiness < 85; no pre-ticked consents; decline as visible as accept | e2e: `book-anyway` visible at Readiness 0, 60, 84; component: `<Checkbox defaultChecked>` banned on consent screens |
| DP-07 | Bait and switch | Badge criteria shown before starting; scores shown exactly as computed | review + unit test: badge copy generated from the criterion config |
| DP-08 | Drip pricing | Government fees from `fees.json` shown in full up front (₹700 for one class + ₹200 card, from the file, never a literal); school prices include everything | copy: rupee literals banned in UI strings and prompts (D-06); e2e: fee card total = sum of lines |
| DP-09 | Disguised advertisement | Paid school listings labelled "Sponsored" / "प्रायोजित" | component: `<SchoolCard paid>` must render the label |
| DP-10 | Nagging | ≤ 1 push or WhatsApp per day, tied to a real deadline; quiet hours 22:00–07:00 IST [D]; one-tap opt-out per channel; WhatsApp "STOP" honoured (EC-30) | backend unit test on the notification scheduler; the backend notifier enforces the same cap for every channel |
| DP-11 | Trick question | Consent copy is a plain yes/no in the user's language; no double negatives | copy: consent strings checked for negation patterns ("don't not", "न… नहीं…" pairs); review |
| DP-12 | SaaS billing | No recurring billing in the MVP; any future billing shows the renewal date and amount before each charge | review |
| DP-13 | Rogue malware | No APK links anywhere; share links only on our domain | copy + e2e: link scanner rejects `.apk` and non-allowlisted domains |
| DP-14 | (ours) Variable-ratio rewards | No loot boxes, random XP or mystery rewards; variety only in content (new clip types) | review; unit test: XP is a pure function of the session |
| DP-15 | (ours) Public loss and comparison pushes | No "your friend beat you", no public fail states | copy + review |
| DP-16 | (ours) Money for learning | No cash, cash-back, coupons or redeemable prizes (also Online Gaming Act 2025) | review |
| DP-17 | (ours) Fear content | No gore, death splash screens or injury imagery | copy lint (banned words) + asset review |
| DP-18 | (ours) Minors | No AI, telemetry, streaks, squads, badges or share cards under 18 | e2e with a u18 profile: none of these elements render; network log shows no game telemetry |

A PR that fails any DP lint can't merge. Waivers need the product lead's sign-off in the PR and a CHANGELOG line.

---

## 13. Under-18 rules (D-13, P-07, EC-05)

1. Age band comes from the DOB on the case (E-01 age band); EC-01 (Aadhaar with only a year of birth) keeps the user in the u18 band until a DOB document is confirmed when the computed age is within a year of 18.
2. Allowed: plan card, checklists, static lessons, LL practice and the games marked `local_only`, all on the device, with **template** debriefs rendered on the device.
3. Not allowed: any AI (Gemini terms are 18+, verification G8), game telemetry leaving the device, XP history, ranks, streaks, squads, pair mode, badges, share cards, Practice Record, marketing messages, Nazar mock and commentary.
4. On turning 18 (server-computed from the DOB), the user is offered (never auto-enrolled) an account; device-only progress may be imported with their consent.
5. Guardian-facing content (M20, F-17 minor-riding awareness) is shown to adults.

## 14. Data and APIs

| Entity | Holds | Retention (proposed to DATA_MODEL owner) |
|---|---|---|
| E-18 TopicMastery | card states, append-only review log, mastery cache per topic, calibration stats, staircase levels | until account deletion |
| E-22 Achievement | XP ledger (per session, with multiplier breakdown), rank, badges (+ self-declaration flags), streak state | until account deletion |
| E-23 Squad | members (user IDs), goal, ribbon history, preset reactions | until disbanded + 30 days |
| E-27 PracticeLog | supervised practice entries, sign-offs (author, time, signature) | until account deletion |
| Share cards | rendered image + token | 90 days or user delete |

| API | Use |
|---|---|
| API-31 `GET /v1/learn/review-queue` | due cards (§4.5) |
| API-32 `POST /v1/learn/answers` | evidence for non-game answers (lessons, quizzes), with confidence |
| API-33 `GET /v1/readiness` | `{readiness, knowledge, calPenalty, topics[], gate: {met, reasons[]}, bookAnywayVisible: true}` |
| API-38 `GET /v1/me/achievements` | XP, rank, badges, streak, refresh counter |
| API-39 `POST /v1/squads` | create / join by link / leave |
| API-46 / API-47 | Practice Record export / QR check |

## 15. Hackathon build (Phase 1–2) vs production (Phase 3+)

| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| XP, ranks | full rules; thresholds as design values | thresholds tuned from field data |
| FSRS | ts-fsrs pinned, default weights, review-log replay | per-user weight optimisation; A/B of retention targets |
| Readiness | formula + advisory gate + dial | outcome calibration (§5.3) once ≥ 100 outcomes per tenant |
| Streaks | weekly with tokens and repair | same |
| Squads | create/join, squad score, pair mode on Nazar | squad goals across games; school-run cohorts for adult learners (driving-school Pro) |
| Badges | B1–B6 live; B7 via Nazar night types; B8 J&K storyboard only; B9 only after medical sign-off | all |
| Share cards | Nazar Score card via WhatsApp (test number), sent by the backend notifier | full |
| Practice Record | JSON + PDF, Ed25519 signature, QR check page | KMS keys, driving-school sign-off via Pro portal |
| DP lint | DP-01, 03, 04, 06, 08, 10, 13, 18 automated; others review-only | all automated where possible |

## 16. Open items

| Item | Owner | Due |
|---|---|---|
| Pin `ts-fsrs` exact version; confirm API names; confirm `enable_fuzz=false` behaviour | game-core owner | H0 |
| Implement `eslint-plugin-margdarshak` DP rules listed as automated for Phase 1–2 | Frontend lead | Phase 1 |
| Decide the share-card domain (must not contain parivahan/sarathi/gov) | Product lead | 2026-10-24 |
| Confirm with LOCALIZATION whether Hinglish is a Hindi display option | Learning & Games lead | 2026-10-24 |
