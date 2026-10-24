# Product Requirements Document (PRD)
> Project: Margdarshak · Owner: Product lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [PERSONAS](PERSONAS.md) · [USER_JOURNEYS](USER_JOURNEYS.md) · [USER_STORIES](USER_STORIES.md) · [FEATURES](FEATURES.md) · [ROADMAP](ROADMAP.md) · [METRICS](METRICS.md) · [COMPETITIVE_ANALYSIS](COMPETITIVE_ANALYSIS.md) · [Architecture](../03-engineering/ARCHITECTURE.md) · [Privacy](../06-security-compliance/PRIVACY.md) · [AI evals](../04-ai/AI_EVALS.md)
> Council directives: [margdarshak-verification.md §5 D-01..D-25](../../../war-room/margdarshak-verification.md). This PRD obeys all 25. Where it cites a directive it writes "(D-nn)".

---

## 0. Summary

**Margdarshak** (मार्गदर्शक, "the one who shows the way") is a reimagined, government-adoptable mParivahan front end for the driving-licence journey. It tells you your exact plan before you apply, carries you through every step from learner's licence (LL) to licence in hand and beyond, and uses short simulations with AI coaching to train the skill India's test never checks: hazard anticipation.

- **Tagline:** *Learner se licence tak, bina agent ke.*
- **Positioning (D-02):** a reference citizen front end plus an open adapter specification that MoRTH, NIC or a State Transport Department can host over Sarathi, DigiLocker and Bhashini. The hackathon build is a working product on mock adapters. It is **not affiliated** with MoRTH or NIC (D-01).
- **Shape (D-03):** the journey is the body; **Nazar** (hazard perception) plus the game debrief is the heart. The demo hook, the evidence slide and the closing QR belong to Nazar.
- **Depth contract (D-04):** three deep slices (A: plan → guided LL → check answers; B: Nazar + AI debrief + field study; C: stage-aware home + journey sweeper on Render Workflows + WhatsApp from the backend notifier). Every other stage works end to end on mocks with **no dead buttons**.

---

## 1. Background and problem

All figures are carried from the research files with their tags; links go to the file that holds the primary source.

### 1.1 The front end went online; the journey didn't
| Evidence | Value | Source |
|---|---|---|
| Links on parivahan.gov.in homepage | ~120; about 1 in 10 relevant to a first licence; none says "Start here" | [team report teardown](../../../research/ps1-deep/team-saarthi-report.md) |
| LL application (Aadhaar path) | ~16 screens, ~6 captchas, 4+ OTPs, DOB typed ~6 times; ~18 screens without Aadhaar | [00-JOURNEY-MAP row 3](../../../research/ps1-current-state/00-JOURNEY-MAP.md), [01-sarathi-screens](../../../research/ps1-current-state/01-sarathi-screens.md) |
| Nothing saved | The FAQ says: "The session does not save any data. The applicant should apply again." | [MoRTH FAQ](https://parivahan.gov.in/en/faq/learners-license-related-services?page=2) |
| Edits locked after payment | Particulars change only before fee payment | [MoRTH FAQ p.3](https://parivahan.gov.in/en/faq/learners-license-related-services?page=3) |
| Desktop-first | Sarathi asks for a 1366×768 or larger screen | [Sarathi](https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do) |
| Payment failures | 15 of 33 Sarathi consumer complaints are payment-related | [03-user-pain step 5](../../../research/ps1-current-state/03-user-pain.md) |
| Outages | ~4,000 applications stalled in Telangana, Jun 2026; AP 24×7 control room, Oct 2026 | [team report](../../../research/ps1-deep/team-saarthi-report.md) |

### 1.2 Nobody owns the timeline
LL validity (6 months), the 30-day minimum wait, slot scarcity ("no slot for 30/40 days"; Kerala up to 2 years in extreme reports), the 7-day retest gap [MK/S-low], remedial training after a fail (2019 s.9(5) proviso) and approval limbo collide. **Typical time to a licence is ~2.5–4 months; the worst case is 6–12+ months** ([03-lifecycle §A](../../../research/ps1-deep/03-lifecycle.md)). Renewing an expired LL creates a new application number that breaks the slot booking (Q39–Q41).

### 1.3 The driving test is opaque and the agent sells certainty
- Delhi automated tracks fail about 50%; Gujarat fails 94% of car applicants on 4 AI tracks; Kerala's pass rate fell to 40–45% after its reforms ([03-user-pain step 11](../../../research/ps1-current-state/03-user-pain.md)).
- Criteria aren't published per track. Agents charge **₹2,000–20,000** (18 observed price points) against the government **₹700 for one class + ₹200 card** (CMVR r.32, [02-rules-process §7](../../../research/ps1-current-state/02-rules-process.md)). R:128 agent/bribe keyword hits across 594 relevant Reddit posts.
- In the Delhi licence experiment, 69% of people paid to get a licence fast failed an independent driving test ([NBER w12274](https://www.nber.org/papers/w12274)).

### 1.4 What kills is never taught or tested
| Fact (MoRTH 2023) | Value | Source |
|---|---|---|
| Road deaths | 1,72,890 | [02-accident-curriculum §1.1](../../../research/ps1-deep/02-accident-curriculum.md) |
| Over-speeding cited | 68–70% of deaths | RAI23 T3.1 |
| Two-wheeler share of deaths | 44.8%; 54,568 killed without a helmet | RAI23 |
| Two-wheeler riders killed by heavy vehicles | 18,556 | RAI23 T4.5 |
| Night share of accidents | ~42% (18:00–21:00 peak) | RAI23 T7.3 |
| Highways' share of deaths | 59% | RAI23 |
| Uncontrolled + T-junction deaths | 25,471 + 12,311 = 37,782 | RAI23 T3.6–3.7 |
| Licensed driver at the wheel | 70.9% of accidents | RAI23 |

India tests knowledge and vehicle control, never hazard anticipation. **Kerala adds a hazard-perception test (HPT) from 1 December 2026**: 10 one-minute clips, 10 marks each, up to 2 hazards per clip, pass 60/100, as reported ([Onmanorama, 14 Sep 2026](https://www.onmanorama.com/news/kerala/2026/09/14/kerala-adds-hazard-perception-test-for-driving-licences-from-dec-1-first-in-india.html)); the MVD circular text was not found, so the format is "as reported" [unverified: owner Nazar lead (B), recheck on demo morning].

### 1.5 The first months after licensing are the most dangerous
Crash/near-crash rates are ~8× higher in the first 3 months of solo driving than on the learner permit ([PMC3088306](https://pmc.ncbi.nlm.nih.gov/articles/PMC3088306)). Calibration does not improve over two years after the test ([SWOV](https://swov.nl/nl/publicatie/investigating-calibration-ability-young-novice-drivers-relative-experienced-drivers)). India has no probation or novice follow-up ([01-abroad §0.2](../../../research/ps1-deep/01-abroad.md)).

### 1.6 Trust is broken
Fake "apply online" apps with 1M+ installs (Q109–Q110), fake e-challan APKs (~570 Kerala cases, up to ₹1.5 lakh lost), a fake-website LL gang (Jalna, Jan 2026), and a red "SYSTEM HACKED" banner on the government homepage ([team report](../../../research/ps1-deep/team-saarthi-report.md)).

### 1.7 Two legal facts that shape the product (council §3.1)
1. **A private team cannot do Aadhaar eKYC** without Central Government approval under the Jan 2025 Good Governance amendment (G1, SECONDARY). → Margdarshak never collects an Aadhaar number, OTP, biometrics or a face for matching (D-07).
2. **MoRTH stopped Vahan/Sarathi data sharing with private entities on 1 Oct 2026**, per NIC's RTI reply ([IFF, 20 Oct 2026](https://internetfreedom.in/who-reads-your-vehicle-record-nic-gave-us-numbers-morth-gave-us-a-generic-webpage/)). → "Plug-and-play" means **adapters that government runs**; our build ships mocks (D-08).

---

## 2. Goals and non-goals

### 2.1 Product goals
| # | Goal | Measure (detail in [METRICS](METRICS.md)) |
|---|---|---|
| G1 | Make the licence journey **certain** enough that nobody needs an agent | North star: agent-free licences; "would still pay an agent" falls in the journey test (J4) |
| G2 | Answer before you ask: the right class, blockers, fee and dates before any form | Plan card in ≤ 3 taps; class-correct rate in the journey test (J2) |
| G3 | Cut the LL application effort | First-screen choices ~120 → 4; LL screens ~16 → ~6; median time −40% (J1) |
| G4 | Own the timeline from LL to licence in hand | LL expiries prevented; reminders delivered on time; retest rebooked from the fail screen |
| G5 | Train anticipation and calibration, not just recall | Nazar score gain on fresh clips (H3); calibration (Brier) improvement; readiness |
| G6 | Be adoptable by government | Adapter OpenAPI published, contract tests green, audit-ready pack, one state pilot conversation by Phase 3 |
| G7 | Be honest: every rule sourced, every number computed, every AI claim validated | 0 invented numbers in the debrief eval set (≥ 30 cases per agent, D-10) |

### 2.2 Hackathon goals (Phase 1–2)
1. Score ≥ 8.2 average across the six judge personas (council projection after directives: 8.23, verification §2).
2. Show **one field number** from real people (Nazar study n ≥ 40; journey test n = 5–8), pre-registered (D-22).
3. Show the **clip-ingest pipeline** on Render Workflows with a visible retry (D-15) for the bonus track.
4. Zero dead buttons; live URL stays warm during judging.

### 2.3 Non-goals (explicit)
| Non-goal | Why | Directive |
|---|---|---|
| Submitting, paying or booking on Sarathi on the user's behalf | Private access stopped 1 Oct 2026; IT Act s.43 | D-07, D-08 |
| Aadhaar eKYC, OTP capture, face match against the Aadhaar photo | Needs Central Govt approval | D-07 |
| Slot-booking bots or scraping | Unauthorised access | D-08 |
| Live commentary coaching (Gemini Live streaming) | Cost and risk; replaced by record-then-score | D-12 |
| "Your route, your risks" (black spots on the commute) | Needs iRAD access and precise location; false reassurance | §1 row 7 |
| Speed, stunt or skid scenarios; gore; public speed leaderboards | Skid training raised crashes (+12%, Elvik); fear appeals backfire | D-11 |
| Money, prizes, entry fees in games | Online Gaming Act 2025 | D-11 |
| "10+ languages" | Claim only what ships: English + Hindi in full, Dogri voice-in | D-21 |
| A child holding their own account | The account holder is always an adult; a learner under 18 uses the full product, AI included, inside a parent's account (family mode) with verifiable parental consent; residual risk R-13 (legal lead) | D-13 revised |
| Rental marketplace for test vehicles | Insurance, payment and liability | §1 row 14 |
| Insurer pricing on Practice Record | Not validated; one roadmap line only | D-10 row 10, D-23 |
| Any "official" or "integrated with Sarathi" wording, the State Emblem, gov-style domains | Impersonation | D-01, D-19 |

---

## 3. Success metrics (summary)
Full definitions, AARRR funnel and the event taxonomy are in [METRICS.md](METRICS.md).

| Layer | Metric | Hackathon target (Phase 1–2) | Pilot target (Phase 3) |
|---|---|---|---|
| North star | **Agent-free licences**: cases reaching S7 with the self-declared "no agent at any step" | Demonstrated end to end on synthetic cases | ≥ 200 in the J&K pilot cohort |
| Journey | Journey-test full success (class + path + blockers) | Margdarshak ≥ 6/8 vs Sarathi replica ≤ 3/8 (J2) | n/a |
| Journey | Median time to complete the LL application task | ≥ 40% lower than the replica (J1) | n/a |
| Journey | SUS | ≥ 75 vs replica ≤ 55 (J3) | ≥ 75 |
| Trust | "Would still pay an agent" | Falls pre → post (J4) | ≤ 20% of active applicants |
| Learning | % of licence holders below 60/100 on Kerala-format clips | Report H1 (prediction ≥ 30%) | n/a |
| Learning | r(LL mock, Nazar) | Report H2 (prediction |r| < 0.3) | n/a |
| Learning | Fresh-clip score gain after feedback | Report H3 (one-sided) | ≥ +10 points median over 3 sessions |
| AI quality | Invented numbers in debrief eval | 0 / ≥ 30 cases | 0 in weekly regression |
| Performance | Lite first load | < 300 KB | < 300 KB |

---

## 4. Personas (summary)
Detail in [PERSONAS.md](PERSONAS.md).

| ID | Persona | Need in one line |
|---|---|---|
| P-01 | **Kabir** (primary), 19, Jammu, 2W now, car later | Get it himself, first attempt, privately; be actually able to read Indian roads |
| P-02 | **Tanvi**, 19, Aadhaar in Kathua, lives in Jammu, no vehicle | Know her address and D/o-line blockers before paying; find a legal test vehicle |
| P-03 | **Mohan-ji**, 52, lapsed DL, Form 1A, low digital literacy | Renew or re-test with fewest visits; not be scammed; back his son's legal path |
| P-04 | **Helper** (sibling or CSC/cyber-café operator) | Fill forms correctly with recorded consent; leave no data on shared PCs |
| P-05 | **Driving-school owner** (Kerala/J&K) | HPT compliance logs for inspection; better first-attempt pass rates; leads |
| P-06 | **RTO officer / Transport Commissioner** | Fewer counter queries and re-tests; see where cases stall; adopt something auditable |
| P-07 | **Rahul**, 17 (edge) | Know the ≤ 50 cc legal path; full product incl. AI in family mode (parent's account, parent's consent) |

---

## 5. Scope

### 5.1 Release scopes
| Release | Phase | What ships | Data | Hosting |
|---|---|---|---|---|
| **R0 Hackathon (MVP)** | Phase 1–2 (Oct 2026) | All Must features working end to end on mocks; three deep slices; Nazar field study; clip pipeline on Render Workflows; backend notifier for citizen messages; n8n for schedules and staff queues | Synthetic cases; field-study data anonymous and 18+ | Render Singapore (stated in README), Cloudflare R2 for blurred clips |
| **R1 Pilot (v1)** | Phase 3 (Nov 2026–Mar 2027) | Should features to "thin+" depth: Live Intel with real reports, school Pro beta, console beta on pilot data, DigiLocker requester onboarding started, paid Gemini tier, WhatsApp approved templates | Adult account holders; learners under 18 in family mode with parental consent; consent artefacts | India-region object store; India copy of logs (CERT-In) |
| **R2 State adoption (v2)** | Phase 4–5 (2027–2028+) | Mode B adapters with a state, tenant theming, rule-pack studio in state hands, console on adapter data, Bhashini, SMS after DLT | State data under MoU; Sarathi stays system of record | NIC or MeitY-empanelled Indian cloud; Vertex AI India region [unverified: asia-south1 availability; owner Tech lead; 2026-11-15] |

### 5.2 Depth contract for R0 (D-04)
| Slice | Stages | Features | What "deep" means |
|---|---|---|---|
| **Deep-A** | S0–S2 | F-01, F-02, F-03, F-04, F-05, F-06, F-07 (Mode A) | Real rules engine over `fees.json` + `rules/JK.json` with sources; every EC-01..EC-06, EC-09..EC-11 rule row; guided 6-screen flow with autosave/resume; photo/signature fixer on device; check-answers; copy-pack hand-off |
| **Deep-B** | S4 (+S3 sim) | F-23, F-24 (4 deep games), F-25, F-26 (core), F-22, F-57 | Clip bank with two-rater windows; server replay scoring; Kerala-format mock; AI debrief with provenance validator and template fallback; ≥ 30-case eval per agent; field study live |
| **Deep-C** | All | F-08, F-09, F-53, F-30 (one scripted Hindi flow), F-54 (core), F-55, F-56 | Journey state machine with persona switcher; journey sweeper Workflow triggered by n8n Schedule; WhatsApp test number + email sent by the backend notifier; family mode and parental consent; consent artefacts; analytics schema enforcement; adapters with contract tests |
| **Thin** | S5–S9, Eco | F-10–F-17, F-20, F-21, F-27, F-28, F-31–F-33, F-40–F-42, F-50–F-52, F-58 | Works end to end on mocks, honest labels, no lorem ipsum |

---

## 6. Product principles (non-negotiable)
1. **Answer before you ask.** Tell users what applies to them before any form field ([team report](../../../research/ps1-deep/team-saarthi-report.md)).
2. **One screen, one decision.** One primary button per screen.
3. **Show the whole road, highlight the next step.**
4. **Fail early and kindly.** Catch eligibility and upload problems before payment; fail debriefs are private.
5. **Code computes, AI narrates** (D-09). Every ₹, day, age, metre or second comes from a tool (D-10).
6. **Every rule carries `source`, `verified_on`, `confidence`** (D-05). "We don't know for your RTO yet" is a valid answer.
7. **Lower fear of the process; raise humility about the road** ([05 §4](../../../research/ps1-deep/05-psychology.md)).
8. **No dark patterns** (13 CCPA patterns as lint, [08 §4.10](../../../research/ps1-deep/08-game-ai-n8n.md)).
9. **Claim only what ships** (D-19, D-21).
10. **Never encourage phone use while riding** (riding lock, MV Act s.184).

---

## 7. Functional requirements

Format per feature: **Description · Personas · Stories · Acceptance criteria (FR-xx.n) · Priority (MoSCoW, from PROJECT_BRIEF §5.1) · R0 depth · Edge cases handled · Dependencies · Production notes**. Acceptance criteria are testable; Gherkin versions live in [USER_STORIES](USER_STORIES.md).

---

### F-01 Home
- **Description.** Language first (each language in its own script), one headline, four verb tiles (*Get my first licence · Practise for the test · Renew or fix my licence · Check my application*), a mic, a calm trust line and "All services" grouped by who you are. Replaces ~120 links.
- **Personas.** P-01, P-02, P-03, P-04, P-07. **Stories.** US-001–US-006.
- **Acceptance criteria.**
  - FR-01.1 The first interactive element on first launch is the language picker (English, हिन्दी); other languages show "coming soon" and are not selectable.
  - FR-01.2 Exactly four tiles with verb labels; no "Read More" anywhere on the home.
  - FR-01.3 The trust line renders the one-class fee and card fee from API-03 (no rupee literal in UI strings or prompts; a CI grep fails on `₹` followed by digits in `/messages/*` and `/prompts/*`).
  - FR-01.4 First-launch non-affiliation notice and a persistent footer on every route; no State Emblem, Parivahan logo, "official" wording or gov-style domain (e2e test checks the footer on all routes).
  - FR-01.5 "All services" groups: Citizen, Vehicle owner, Driving school, Dealer / manufacturer, Government staff; external services open on parivahan.gov.in with an external-link icon.
  - FR-01.6 Mic appears for every user once mic consent is given (in family mode the parent consents); until then tiles say "Tap to start".
  - FR-01.7 No red alarm imagery, hacker stock photos or death statistics above the fold.
- **Priority.** Must. **R0 depth.** Deep-C.
- **Edge cases.** EC-19 (Lite render), EC-05 (mic hidden).
- **Dependencies.** F-50 (i18n), F-02 (fees), F-30 (voice), F-08 (logged-in home).
- **Production notes.** Tenant theming (F-58) may change colours and add the state's own logo **only** when the state hosts it.

### F-02 Licence Plan in 3 taps
- **Description.** Age/DOB · vehicle pictures · state → eligible classes, steps, max RTO visits, earliest licence date, fee breakdown from `fees.json`, documents, warnings. No login. Send to WhatsApp.
- **Personas.** P-01, P-02, P-03, P-07. **Stories.** US-010–US-014, US-025.
- **Acceptance criteria.**
  - FR-02.1 API-01 returns a plan for any valid (DOB, vehicle, state) in p95 ≤ 300 ms server time; the card renders in ≤ 1 s on a mid-range phone on 4G.
  - FR-02.2 Vehicle choice is by picture (scooter without gears, bike with gears, car, auto/e-rickshaw, truck/bus); class codes appear second, smaller.
  - FR-02.3 Each line on the card has a source chip (rule ID, source, `verified_on`, confidence); low-confidence lines read "Verify at your RTO".
  - FR-02.4 Fee breakdown is computed from the tenant rule pack: one class ₹700 (LL ₹150 + LL test ₹50 + driving test ₹300 + DL ₹200) + smart card ₹200; each further class adds LL ₹150 + driving test ₹300 (about ₹450); state charges shown separately with their source tag.
  - FR-02.5 Earliest licence date = LL issue + 30 days (rule), expressed relative until an LL date exists.
  - FR-02.6 Max RTO visits computed from the state's LL test mode (online/CSC/RTO) and the applicant's path.
  - FR-02.7 "Send to WhatsApp" requires an explicit opt-in tick for that one message; a "Copy link" alternative stores nothing.
  - FR-02.8 A plan for a learner under 18 can be saved as a family member's case in the parent's account (family mode); its data is never used for behavioural tracking, profiling or targeted ads (DPDP s.9(3), D-13 revised).
- **Priority.** Must. **R0 depth.** Deep-A.
- **Edge cases.** EC-01, EC-02, EC-03, EC-04, EC-05, EC-06, EC-10, EC-21 (via F-03, F-04).
- **Dependencies.** F-42 rule packs, F-53 (WhatsApp), API-01–API-04.
- **Production notes.** Rule packs approved by the state via maker-checker (F-42). The J&K amount of ₹1,050 at slot booking (incl. ₹50 postage) is shown as "reported" until the state confirms [unverified: breakdown; owner Rules owner (A); confirm at ARTO counter 2026-10-23/24].

### F-03 Smart class planner
- **Description.** Several classes on one LL (e.g. motorcycle + car), with the saving shown.
- **Personas.** P-01. **Stories.** US-012, US-015.
- **Acceptance criteria.**
  - FR-03.1 Adding a class recomputes eligibility per class; classes with a higher minimum age are shown but not added (EC-21).
  - FR-03.2 The saving copy is exactly: "If you'd otherwise apply for the <class> separately later, this saves a second application and another 30-day wait." No claim that per-class fees are lower (council §1 row 9).
  - FR-03.3 LMV holders asking about light transport see the SC 6 Nov 2024 ≤ 7,500 kg note with "verify for commercial use".
- **Priority.** Must. **R0 depth.** Deep-A. **Edge cases.** EC-21, EC-06.
- **Dependencies.** F-02, F-42.

### F-04 Blocker check
- **Description.** The edge cases as rule rows with fix, source and confidence, shown before the user starts.
- **Personas.** P-01, P-02, P-03, P-07. **Stories.** US-016–US-024, US-297.
- **Acceptance criteria.**
  - FR-04.1 API-13 evaluates every applicable blocker rule for the case and returns rows `{rule_id, severity, message_key, fix_key, source, verified_on, confidence}`.
  - FR-04.2 Rule rows exist for EC-01, EC-02, EC-03, EC-04, EC-05, EC-06, EC-10, EC-12, EC-13, EC-16, EC-17, EC-21 (see §8). Each has a unit test with fixtures.
  - FR-04.3 State-specific behaviour that is unknown shows "Ask at the counter; tell us what you were told" (confidence low), never a guess.
  - FR-04.4 Blockers render on the plan card before "Start my application" and again on the check-answers screen.
- **Priority.** Must. **R0 depth.** Deep-A.
- **Edge cases.** EC-01–EC-06, EC-10, EC-12, EC-13, EC-16, EC-17, EC-21.
- **Dependencies.** F-42. **Note.** PROJECT_BRIEF says "the 20 edge cases in §9"; §9 now lists 30. F-04 owns the identity/eligibility rows; the others belong to the features listed in §8.

### F-05 Guided LL application
- **Description.** One question per screen with "why we ask"; auto-save and resume on any device; "Check your answers" before payment; fee breakdown; payment-pending guidance.
- **Personas.** P-01, P-02, P-03, P-04. **Stories.** US-030–US-032, US-037–US-039.
- **Acceptance criteria.**
  - FR-05.1 ≤ 6 primary screens for the Aadhaar path (target from ~16), counted by the e2e test.
  - FR-05.2 DOB and name asked once and reused; no field asks for an Aadhaar number, OTP or biometric (lint test).
  - FR-05.3 Autosave via API-12 after every answer (debounced ≤ 1 s); offline answers queue locally and sync; resume on another device after login.
  - FR-05.4 Check-answers screen lists every answer with "Change"; "Continue to Sarathi" is enabled only after the user ticks "I've checked these"; the screen states that Sarathi locks edits after payment.
  - FR-05.5 Payment-pending guide (EC-09): don't pay again; reconciliation window; "verify payment" on Sarathi; cancelling may forfeit the fee; complaint template; 24 h reminder.
  - FR-05.6 Outage banner when the status adapter reports Sarathi unavailable (EC-11); drafts never lost.
  - FR-05.7 Device pre-check for the online LL test (camera permission, browser, pop-ups, lighting), no frames uploaded.
- **Priority.** Must. **R0 depth.** Deep-A. **Edge cases.** EC-09, EC-11, EC-14, EC-19.
- **Dependencies.** F-06, F-07, F-54 (account), API-10–API-12.

### F-06 Photo and signature fixer
- **Description.** On-device camera guide, crop, resize, background whiten, size check.
- **Personas.** P-02, P-03, P-04. **Stories.** US-033, US-034.
- **Acceptance criteria.**
  - FR-06.1 Face detection, crop, background whitening and compression run in the browser; only metadata (`width, height, bytes, checks[]`) is sent to API-20; zero image bytes leave the device (network test).
  - FR-06.2 Target dimensions and KB limits come from tenant config with source; when unpublished, the screen says "Sarathi doesn't publish exact specs; this matches the most common limits" [unverified: per-state photo specs; owner Rules owner (A); 2026-10-24].
  - FR-06.3 Before/after preview; actionable failure messages ("Move closer, face the light").
- **Priority.** Must. **R0 depth.** Deep-A. **Edge cases.** EC-19 (works on low-end phones; WASM fallback to canvas).

### F-07 Sarathi hand-off
- **Description.** Aadhaar eKYC, OTP, payment and submission happen on Sarathi or the state gateway, never in Margdarshak (D-07). Mode A: prefilled hand-off + copy-pack, works today. Mode B: adapter, once a state adopts.
- **Personas.** P-01, P-02, P-04, P-06. **Stories.** US-035, US-036, US-041, US-276.
- **Acceptance criteria.**
  - FR-07.1 Mode A: API-16 returns an ordered copy-pack of Sarathi screens for the tenant, each with the value to choose and a copy button; a button opens the Sarathi state page.
  - FR-07.2 Mock eKYC screen labelled "Simulated: in production this step runs on Sarathi", with no Aadhaar input field.
  - FR-07.3 Mode B is behind `ff_sarathi_mode_b`, enabled per tenant only after the real SarathiAdapter passes the contract suite (F-56).
- **Priority.** Must. **R0 depth.** Deep-A (Mode A + mock), Roadmap (Mode B live). **Edge cases.** EC-11.
- **Dependencies.** F-56. **Production notes.** In government-hosted mode the adapter calls Sarathi's existing eKYC (G1).

### F-08 Stage-aware home + parcel-style tracker
- **Description.** A journey state machine decides the single primary action per stage.
- **Personas.** All applicants. **Stories.** US-007–US-009, US-042, US-149, US-166, US-172.
- **Acceptance criteria.**
  - FR-08.1 State machine over stages S0–S9 incl. S6F, per class (E-03), with transitions only via API-15 events: `ll_issued, slot_booked, test_failed, test_passed, approved, card_received` (+ `case_created`, `plan_changed`).
  - FR-08.2 Exactly one primary action per state (table in US-007); persona switcher in demo mode to show each state.
  - FR-08.3 All dates and countdowns use server time (EC-15).
  - FR-08.4 Mid-journey onboarding (EC-22) creates the case at the right stage from user-entered dates; no LL/DL number stored in clear (E-04, E-05).
  - FR-08.5 Classes progress independently (one passed, one failed).
- **Priority.** Must. **R0 depth.** Deep-C. **Edge cases.** EC-15, EC-22.

### F-09 Case clock
- **Description.** LL-expiry countdown from day 180, day-30 unlock, test-eve checklist, approval chase. Durable timers on Render Workflows, with n8n as the daily trigger and watchdog; the backend notifier delivers (ADR-0006).
- **Personas.** P-01, P-02, P-03. **Stories.** US-070, US-140, US-143, US-161, US-224–US-226.
- **Acceptance criteria.**
  - FR-09.1 TimelineEvents (E-12) for: LL day 25 ("book now"), day 30 (unlock), LL expiry T-30 and T-7, test-eve 19:00, approval stall day N (from rule pack or "no notified timeline"), DL renewal T-365/T-60/T-7.
  - FR-09.2 n8n Schedule (06:30 IST) calls API-65; the Render Workflow computes due milestones and writes outbox rows `{uid, milestone_id, channel, template_id, vars, send_after}`; the backend notifier sends them; n8n never sees a recipient (D-16).
  - FR-09.3 Idempotency key `(case_id, milestone, due_date)`; a retried run never double-sends.
  - FR-09.4 Collision warning when `expiry − today < 2 × (slot_lead + retest_gap)` (EC-07), with the new-application-number warning.
  - FR-09.5 Rule-pack change mid-case triggers re-evaluation and a diff notice (EC-27).
  - FR-09.6 ≤ 1 nudge per user per day; quiet hours 22:00–07:00 IST.
- **Priority.** Must. **R0 depth.** Deep-C. **Edge cases.** EC-07, EC-15, EC-27, EC-30.
- **Dependencies.** Render Workflows (Python SDK), n8n Pro, F-53. Workflows has no native cron, so n8n triggers (B-sponsors §7).

### F-10 Slot finder
- **Description.** RTO and accredited-centre map + calendar; "notify me if an earlier slot opens" (mock adapter; no scraping or booking bots, D-08).
- **Personas.** P-01, P-02, P-03. **Stories.** US-141, US-142, US-144.
- **Acceptance criteria.**
  - FR-10.1 API-25 lists offices (E-09) by district chosen by the user (no GPS needed); distance from the district centroid.
  - FR-10.2 API-26 slot data from SlotAdapter (mock) carries a "simulated" chip.
  - FR-10.3 Slot watches (API-27) alert only on moderated Live Intel "slots opened" reports, with timestamp and n; copy states we can't see Sarathi slots.
  - FR-10.4 ADTC rows explain the test exemption (MV Act s.12 as amended 2019) with source.
- **Priority.** Must. **R0 depth.** Thin. **Dependencies.** F-11, F-56 (SlotAdapter).

### F-11 RTO Live Intel
- **Description.** Structured crowd reports per RTO (when slots really open, documents asked, what was checked on the track, wait time). No names, no free text, moderated (D-14).
- **Personas.** P-01, P-02, P-06. **Stories.** US-145–US-148.
- **Acceptance criteria.**
  - FR-11.1 Report form has only structured fields; no free-text input exists (UI and API schema).
  - FR-11.2 A field is shown only when n ≥ 5 reports in 30 days; otherwise "Not enough reports yet".
  - FR-11.3 Seeded rows carry a "sample data" chip.
  - FR-11.4 "Setting"/bribe reports are counted as an aggregate and deep-link to the state ACB/vigilance and CPGRAMS; we never host allegations.
  - FR-11.5 Backend precheck inline on API-28 (PII regex, duplicates); only flagged reports go to moderators via n8n W9; grievance officer in the footer (IT Rules 2021).
- **Priority.** Should. **R0 depth.** Thin. **Edge cases.** EC-24.

### F-12 Driving-test readiness
- **Description.** Animated track explainer; test-eve "what to bring"; test-day co-pilot (counter steps, papers check, "show at counter" QR, calm-down); vehicle-for-test checklist + listing.
- **Personas.** P-01, P-02, P-03. **Stories.** US-081, US-160–US-164.
- **Acceptance criteria.**
  - FR-12.1 Explainer per track type (manual, ADTT) with "not published" for unknown parameters.
  - FR-12.2 Test-eve template (TimelineEvent `test_eve`, sent by the notifier at 19:00 IST) with LL, RC, insurance, PUC, L-plate, helmet + ICS.
  - FR-12.3 QR contains only the plan summary; no identifiers.
  - FR-12.4 Vehicle listing is seeded and labelled; no booking, no payment, no AI prices.
- **Priority.** Must. **R0 depth.** Thin.

### F-13 Fail and recover
- **Description.** Private, face-saving debrief → drill → retest booking from the same screen; remedial-training referral; LL-expiry check; test-record request (RTI template).
- **Personas.** P-01, P-03. **Stories.** US-167–US-172, US-237.
- **Acceptance criteria.**
  - FR-13.1 No public signal of a fail: squads, streaks, badges and share cards do not react; notification previews have no outcome words.
  - FR-13.2 Earliest retest date computed from the rule pack (7-day gap flagged "verify"); remedial-training note cites the s.9(5) proviso; school referral needs the learner's consent.
  - FR-13.3 Immediate LL-expiry check against the earliest retest (EC-07).
  - FR-13.4 RTI s.6 template (₹10 fee, 30-day reply) generated from user facts; "a video may not exist" copy; never filed by us.
  - FR-13.5 After 3+ fails (EC-08): structured lesson suggestion, drills on reason codes, support line; no negative gamification.
- **Priority.** Must. **R0 depth.** Thin (content), Deep-C (state transitions). **Edge cases.** EC-07, EC-08.

### F-14 Approval tracker + escalation letter
- **Description.** Facts-only letter the user approves and sends; DigiLocker pointer when issued.
- **Personas.** P-01, P-02. **Stories.** US-180–US-184.
- **Acceptance criteria.**
  - FR-14.1 Stages Passed → Approved → Printed → Dispatched → Received from events (or adapter in Mode B).
  - FR-14.2 "No SMS within 3 days" state (EC-23) with status-check steps, proof-to-carry and the s.181 ₹5,000 note.
  - FR-14.3 Letter drafted only from user facts + rule-pack timelines; human approval in-app (backend letter flow); email to the user via the notifier; optional CC to the published grievance address; never filed on CPGRAMS by us.
- **Priority.** Should. **R0 depth.** Thin. **Edge cases.** EC-23.

### F-15 New-rider year
- **Description.** Voluntary novice pledge; phone-free riding guidance; monthly hazard refresher; first night/highway missions; first-vehicle checklist (ABS/CBS, Bharat NCAP, ISI helmet, third-party + PA cover, PUC, RC check); challan check link + fake e-challan/APK scam shield; golden-hour card (static, D-14).
- **Personas.** P-01, P-03. **Stories.** US-083, US-190–US-197.
- **Acceptance criteria.**
  - FR-15.1 Pledge labelled "self-declared"; no trip tracking.
  - FR-15.2 Riding lock: if motion permission is granted and speed > 10 km/h, only "Pull over to use Margdarshak" is shown; no location stored.
  - FR-15.3 Golden-hour card works offline, uses no generative AI, shows 112, s.134A protection, 4 cited steps, "don't move the neck", "not medical training"; Rah-Veer/cashless amounts appear only after re-verification (D-25).
  - FR-15.4 First-vehicle checklist shows no prices and no model recommendations; PA cover amount comes from the rule pack with source [unverified: ₹15 lakh owner-driver PA figure carried from REFINED-OVERVIEW; owner Rules owner (A); 2026-10-24].
  - FR-15.5 Scam shield never says "safe".
- **Priority.** Should. **R0 depth.** Thin.

### F-16 Renew / fix
- **Description.** Renewal reminders (no grace period since 2019; more than 1 year late means a retest), add a class, address change, duplicate, IDP. Shown only to DL holders.
- **Personas.** P-03, P-02. **Stories.** US-024, US-200–US-204.
- **Acceptance criteria.**
  - FR-16.1 Hidden unless the user holds a DL (E-05 present) or chooses "Renew or fix" explicitly.
  - FR-16.2 Grace-period copy cites the 2019 amendment; >1 year late → retest required (EC-16); Form 1A at 40+.
  - FR-16.3 Late fees, duplicate and IDP fees shown only if in the rule pack with confidence; otherwise "check on Sarathi" [unverified: renewal late fee ₹300 + ₹1,000/yr, duplicate ~₹200, IDP ~₹1,000, all MK in 03-lifecycle; owner Rules owner (A); 2026-11-01].
  - FR-16.4 Each service hands off to the Sarathi service with a copy-pack.
- **Priority.** Should (surface). **R0 depth.** Thin. **Edge cases.** EC-12, EC-16.

### F-17 Family and Helper mode
- **Description.** Manage a parent's case or a 16–17-year-old's case (family mode); cyber-café helper with recorded consent; "clear this device"; minor-riding (s.199A) awareness for parents.
- **Personas.** P-03, P-04, P-01. **Stories.** US-025, US-040, US-205–US-209.
- **Acceptance criteria.**
  - FR-17.1 HelperLink (E-29) requires a ConsentArtefact (E-15) with purpose, scope, duration; all helper actions appear in the applicant's history.
  - FR-17.2 Revocation (EC-25) ends access within 60 s; helper sees "Access ended by the applicant"; audit-logged (E-30).
  - FR-17.3 "Clear this device" wipes local storage, IndexedDB, caches and SW data; shared-device mode auto-logs-out after 10 min idle (EC-14).
  - FR-17.4 s.199A parent card factual, never shaming (EC-17).
  - FR-17.5 Max active helper links per helper account: 10 [design default; owner Product lead; review in Phase 3].
- **Priority.** Should (surface). **R0 depth.** Thin. **Edge cases.** EC-14, EC-17, EC-25.

### F-20 Learn hub
- **Description.** LL syllabus + road-safety curriculum (22 modules from MoRTH data). Question variants so memorising fails; FSRS spaced repetition.
- **Personas.** P-01, P-02, P-03, P-07. **Stories.** US-050–US-052.
- **Acceptance criteria.**
  - FR-20.1 MVP survival modules M1, M3, M4, M6, M8, M14, M19 ([02 §3](../../../research/ps1-deep/02-accident-curriculum.md)); each card cites its MoRTH data.
  - FR-20.2 One FSRS card per concept; ts-fsrs pinned 5.x; scheduling works offline.
  - FR-20.3 Variants: ≥ 3 variants per LL concept in the MVP bank; answer keys never shipped to the client before answering.
  - FR-20.4 Deep content only for MCWOG/MCWG/LMV; other classes show "learning content coming" (D-05).
  - FR-20.5 Family mode: a minor's lessons and FSRS state sync to the parent's account like any other case.
- **Priority.** Must. **R0 depth.** Deep-A (LL topics), Thin (survival text).

### F-21 Test Readiness Score
- **Description.** 100 × weighted topic mastery − calibration penalty, shown as "78 = knowledge 84 − calibration 6". The 85 gate is advisory, with "book anyway" always visible.
- **Personas.** P-01. **Stories.** US-053–US-055.
- **Acceptance criteria.**
  - FR-21.1 `Readiness = 100 × Σ_t w_t·M_t − CalPenalty`; `CalPenalty = min(10, 40 × max(0, OC − 0.05))`; OC over the last 40 answers ([08 §4.4](../../../research/ps1-deep/08-game-ai-n8n.md)).
  - FR-21.2 Equal topic weights labelled as such because the government topic mix is unknown.
  - FR-21.3 Confidence (50/75/100%) captured before feedback on every practice answer; Brier computed per user.
  - FR-21.4 "Book anyway" link always visible, equal visual weight.
- **Priority.** Must. **R0 depth.** Deep-A.

### F-22 LL Test Simulator
- **Description.** The state's real format from config (timer, count, pass mark), with a guided first run.
- **Personas.** P-01, P-03, P-07. **Stories.** US-039, US-056, US-057, US-060.
- **Acceptance criteria.**
  - FR-22.1 Format from `rules/<STATE>.json` with source: J&K 10 questions, 6 to pass [S: Kashmir Life]; fallback "15/9 (common default, unverified)" with an amber label.
  - FR-22.2 Guided first run with skippable coach marks.
  - FR-22.3 Works offline after one load; results sync when back online (a minor's results go to the parent's account).
  - FR-22.4 No liveness check and no face match (council §1 row 4).
- **Priority.** Must. **R0 depth.** Deep-B (as the 4th deep game per 08 §3.11). **Edge cases.** EC-10, EC-19.

### F-23 Nazar hazard perception (hero)
- **Description.** Real Indian clips in Kerala's announced format: 10 clips × 10 marks, pass 60, UK-style 5-band scoring, pattern-clicking scores zero. Plus the clip pipeline.
- **Personas.** P-01, P-02, P-05. **Stories.** US-071–US-076, US-086, US-089–US-091, US-233, US-316.
- **Acceptance criteria.**
  - FR-23.1 Mock: 10 unseen clips; first valid tap per hazard scored 5/4/3/2/1 by band; scaled to 10 marks per clip; total /100; result vs "60 (Kerala's announced pass mark)".
  - FR-23.2 Pattern-click rule: > 3 taps in any 1.0 s or > (2 × hazards + 4) taps per clip → 0 for that clip.
  - FR-23.3 Clips preloaded fully; timing on `video.currentTime` via `requestVideoFrameCallback`; stall > 300 ms or tab hidden voids the clip (EC-18).
  - FR-23.4 Server replay (API-35) recomputes every score; client scores are overwritten on mismatch; integrity flags logged.
  - FR-23.5 Learn mode: freeze 0.5 s before onset, "what happens next?" (4 picture options) + "tap where".
  - FR-23.6 Replay shows the hazard band and taps; fact lines like "1.4 s late ≈ 16 m at 40 km/h" are produced by code (`metres = late_s × speed_kmh_est / 3.6`).
  - FR-23.7 Clip pipeline on Render Workflows: transcode → blur faces/plates → propose windows (M-06, offline) → await two raters → compute agreement → publish; visible retry; 100% blur audit; raw footage deleted after audit; CC-BY 4.0 metadata.
  - FR-23.8 Two-rater onset mean; |Δ| > 1.0 s returns for adjudication.
  - FR-23.9 Screen-reader alternative (audio-described lessons and still-frame mode) labelled "a substitute, not the same skill".
  - FR-23.10 Copy: "practice and familiarisation, not certification"; "Kerala's announced format", never "the Kerala test"; status from `kl_hpt_status` (EC-28).
  - FR-23.11 Available to every user, AI debrief included; a learner under 18 plays in family mode. The field study recruits 18+ participants only (study consent).
- **Priority.** Must (hero). **R0 depth.** Deep-B. **Edge cases.** EC-18, EC-19, EC-28.
- **Dependencies.** Render Workflows, R2 storage, MediaPipe/YuNet + plate detector (M-09), M-06, F-25, F-57.
- **Backup trigger.** < 12 usable blurred clips by Fri 12:00 → 6-clip mock scaled to /100, and the journey test carries the evidence ([field kit §9](../../../field-kit/NAZAR-FIELD-KIT.md)).

### F-24 Simulation mini-games
- **Description.** Stopping Distance, Blind Spot (truck/bus), Junction Scan, Track Test Twin (figure-8, reverse park, gradient start), Helmet Fit (on-device camera), Golden Hour (first-aid decisions), Night & Glare, Hill Road (J&K). No speed or stunt content, false alarms penalised, no stakes (D-11).
- **Personas.** P-01, P-03. **Stories.** US-077–US-085, US-092.
- **Acceptance criteria.**
  - FR-24.1 Every game implements the Game SDK contract (`@margdarshak/game-core`, Zod), emits the shared event envelope and returns `SessionResult`; server replay overwrites client scores.
  - FR-24.2 Deterministic scoring per [verification §1.1](../../../war-room/margdarshak-verification.md): Stopping Distance physics (v·t_r + v²/(2µg)); Blind Spot zone geometry; Junction Scan scan-order + gap margin; Track Twin path tolerance and timing on the announced layout.
  - FR-24.3 Deterministic difficulty staircase (+1 after 2 passes, −1 after 1 fail).
  - FR-24.4 A11y baseline: no-audio default, Okabe-Ito palette with shape/pattern encoding, ≥ 48 dp controls in the bottom 40%, tap-only mode, reduced motion, `screen_reader_alt`, ≤ 3 flashes/s.
  - FR-24.5 Labels: "practice and familiarisation, not certification"; Track Twin: "does not train balance or clutch control".
  - FR-24.6 Golden Hour has no generative AI and stays "draft" until medical review.
- **Priority.** Must (4 deep: Stopping Distance, Blind Spot, Junction Scan, Track Test Twin figure-8), Should (Helmet Fit, Golden Hour, Night & Glare, Hill Road). **R0 depth.** Deep-B for the four; Thin for Helmet Fit and Golden Hour; Roadmap storyboards for Night & Glare and Hill Road. **Edge cases.** EC-18.
- **Note.** [08 §3.11](../../../research/ps1-deep/08-game-ai-n8n.md) lists Junction Scan and Track Twin as thin; PROJECT_BRIEF says "4 deep". This PRD follows PROJECT_BRIEF and records the inconsistency (see §13 Q-07).

### F-25 AI Debrief
- **Description.** After every session: how you did · where you lacked · what you could have done · your next drill. Code computes every number; Gemini only narrates, choosing IDs from allowlists (D-09). Commentary mode is recorded, then scored (D-12).
- **Personas.** P-01, P-07. **Stories.** US-073, US-086, US-100–US-103, US-112.
- **Acceptance criteria.**
  - FR-25.1 ADK graph: deterministic findings → one LLM node (M-02 Flash-Lite) → provenance validator → render.
  - FR-25.2 Output schema enums are built per request from the findings; the model writes glue text with **no digits**; any digit not from findings → reject → template.
  - FR-25.3 Template debrief renders first; AI narration replaces it when valid; p95 total ≤ 4 s on 4G; Gemini 429/timeout (3 s) → template (EC-29).
  - FR-25.4 Eval set ≥ 30 cases for M-02 and M-03 in CI (`adk eval`), 0 invented numbers, shown in the demo.
  - FR-25.5 Commentary: record → transcribe (Gemini or Saaras for Dogri) → deterministic matcher vs annotated hazards → debrief; audio discarded after transcription unless the user opts in for 30 days.
  - FR-25.6 Available to every user; a minor's debrief runs in family mode under the parent's consent, with the same validator and template fallback.
  - FR-25.7 Cost target ≈ ₹0.11 per debrief ([08 §5.8](../../../research/ps1-deep/08-game-ai-n8n.md)); paid tier for real users (D-13 revised).
- **Priority.** Must. **R0 depth.** Deep-B. **Edge cases.** EC-05, EC-20, EC-29.

### F-26 Gamification engine
- **Description.** XP for learning only, diminishing after 45 min/day; ranks gated by mastery; weekly repairable streaks; co-op squads; 9 badges, "Khud Licence" shown as self-declared; share cards; the 13 CCPA dark patterns banned by lint.
- **Personas.** P-01. **Stories.** US-092, US-120–US-129, US-185, US-197.
- **Acceptance criteria.**
  - FR-26.1 XP = base × quality (floored 0.3); ×0.5 after 45 min/day, ×0.2 after 90 min; no XP for opening, sharing or inviting.
  - FR-26.2 Ranks Gali → Mohalla → Shehar → Highway → Ghat need XP **and** skill-tree nodes.
  - FR-26.3 Weekly goal 2–6 sessions, freeze tokens (max 2), repair by goal + 2, silent on break, archived on DL test day.
  - FR-26.4 Squads 3–5, invite-only; a minor's profile joins only with the parent's consent (D-13 revised); squad score = mean(Nazar Score × (1 − Brier)).
  - FR-26.5 Badges with criteria visible before starting; Khud Licence and Pehli Baar Pass honour-framed.
  - FR-26.6 Share cards on Margdarshak's own domain; "verified sessions: n"; percentile only after ≥ 200 verified mocks; server-rendered from recomputed scores.
  - FR-26.7 CI design-lint covering the 13 CCPA patterns; no loot boxes or variable-ratio XP; no money or prizes (Online Gaming Act 2025).
- **Priority.** Must. **R0 depth.** Deep-B (XP, badges, share card), Thin (streaks, squads), Roadmap (duels).

### F-27 Road Sign Snap
- **Description.** Point the camera at a sign → meaning + add it to your deck.
- **Stories.** US-059. **Acceptance.** FR-27.1 M-07 proposes a sign ID confirmed against the sign catalogue; low confidence → "pick from these 3". **Priority.** Could. **R0 depth.** Roadmap (optional demo).

### F-28 Practice Record
- **Description.** Practice hours, Nazar score, modules done, supervisor sign-offs; QR verifiable. Renamed from "competence passport" (D-14).
- **Stories.** US-087, US-088, US-234.
- **Acceptance.** FR-28.1 Signed (Ed25519) by Margdarshak only for in-app events; FR-28.2 sign-offs are separate attributed fields; FR-28.3 the words "verified", "certified", "licensed" never appear; FR-28.4 API-47 returns the summary for a revocable token with no contact data. **Priority.** Should. **R0 depth.** Thin.

### F-30 Voice Guide
- **Description.** ADK live mode + Gemini Live (Hindi/English); Sarvam Saaras for Dogri speech in. Navigates and fills fields inside Margdarshak. Never submits, pays or books on Sarathi. Answers carry a rule-ID source chip.
- **Personas.** P-03, P-01, P-07. **Stories.** US-005, US-104–US-108, US-114.
- **Acceptance criteria.**
  - FR-30.1 Closed action enum `{navigate, fill_field, read_screen, explain_rule, open_help}`; no book/pay/submit action exists.
  - FR-30.2 Rule answers only from verified rule IDs; "I don't know that for your RTO yet" allowed.
  - FR-30.3 Client regex redaction of 12-digit Aadhaar-like numbers and 4–8-digit OTP-like strings before send + ADK PII plugin server-side (EC-20).
  - FR-30.4 "AI can't book, pay or submit" line on every AI surface.
  - FR-30.5 Voice is not on the critical demo path; a pre-recorded fallback exists (verification §4 risk 5).
- **Priority.** Must. **R0 depth.** Deep-C (one scripted Hindi flow live), Thin (Dogri). **Edge cases.** EC-20, EC-29.

### F-31 Personal tutor
- **Stories.** US-058, US-106. **Acceptance.** FR-31.1 M-04 explains only from reviewed explanations for the concept answered wrong; cites rule ID; FR-31.2 AI down → show the reviewed text. **Priority.** Should. **R0 depth.** Thin.

### F-32 Sarathi screen/status decoder
- **Stories.** US-109, US-110. **Acceptance.** FR-32.1 M-05 matches screenshots to the verified error catalogue; FR-32.2 "unknown" allowed below threshold; FR-32.3 on-device masking of detectable personal fields before upload; FR-32.4 available to every user (family mode for minors). **Priority.** Should. **R0 depth.** Thin.

### F-33 Scam checker
- **Stories.** US-111, US-194. **Acceptance.** FR-33.1 Rules decide (domain/sender allowlist, VK-MORTH-style sender IDs, any `.apk` = do not open); FR-33.2 AI only explains; FR-33.3 no verdict says "safe". **Priority.** Should. **R0 depth.** Thin.

### F-40 Driving-school portal
- **Description.** Listing; Pro tier with learner progress, hazard-training logs for RTO inspections, practice sign-off, parent updates, test-vehicle hire, remedial-training referrals.
- **Personas.** P-05. **Stories.** US-230–US-240.
- **Acceptance criteria.** FR-40.1 Paid placement labelled "Sponsored"; FR-40.2 learner data visible only under a per-school consent artefact, revocable within 60 s; FR-40.3 HPT log export (PDF/CSV) with "not a government certification"; FR-40.4 lead routing via n8n W7 with 4 h timeout; FR-40.5 one-tap cancel; FR-40.6 EC-28 status-aware copy.
- **Priority.** Should. **R0 depth.** Thin (listing + log export demo). **Business.** Pro price hypothesis ₹499–999/month [unverified; owner Product lead; validate with 5 Kerala schools by 2026-11-15].

### F-41 State / RTO console
- **Description.** Palantir-style decision views: where applications stall, fail reasons per RTO, demand forecast, slot utilisation, query deflection. Anonymised and aggregated.
- **Personas.** P-06. **Stories.** US-250–US-257.
- **Acceptance criteria.** FR-41.1 Every cell with n < 5 suppressed, with complementary suppression; FR-41.2 labels "Margdarshak users only" and "self-reported" where applicable; FR-41.3 exports audit-logged; FR-41.4 slot utilisation and examiner variance only with real adapters, pseudonymous IDs, audit roles only.
- **Priority.** Should. **R0 depth.** Thin (on seeded synthetic aggregates labelled "sample").

### F-42 Rule-pack studio
- **Description.** Versioned state rule packs (classes, fees, formats, timelines) with maker-checker approval, source, date, confidence.
- **Personas.** P-06. **Stories.** US-225, US-260–US-267.
- **Acceptance criteria.** FR-42.1 Draft requires source, `verified_on`, confidence; FR-42.2 maker ≠ checker enforced; FR-42.3 immutable version IDs; served within 5 min of publish; FR-42.4 impact preview (open cases affected, suppressed < 5); FR-42.5 weekly freshness check (n8n W15); FR-42.6 public changelog; FR-42.7 content-state per class; FR-42.8 `kl_hpt_status` enum.
- **Priority.** Must. **R0 depth.** Thin (studio UI) over Deep-A rule packs.

### F-50 Languages
- **Description.** English + Hindi in full; Dogri voice input; others as rule-pack-ready translations (D-21).
- **Stories.** US-001, US-061, US-107, US-290, US-291. **Acceptance.** FR-50.1 100% key coverage EN/HI enforced in CI; FR-50.2 every LL question in both; FR-50.3 Dogri limited to voice-in; FR-50.4 tenant languages appear only at 100% reviewed coverage. **Priority.** Must. **R0 depth.** Deep-C.

### F-51 Lite mode / offline PWA
- **Stories.** US-060, US-292, US-293. **Acceptance.** FR-51.1 < 300 KB compressed first load (CI budget); FR-51.2 offline mock tests; FR-51.3 cached 360p clips ~1–2 MB each; FR-51.4 Serwist service worker; FR-51.5 auto-suggest Lite on `navigator.connection.effectiveType` ∈ {slow-2g, 2g, 3g} or Save-Data. **Priority.** Must. **R0 depth.** Deep-C. **Edge cases.** EC-19.

### F-52 Accessibility
- **Stories.** US-023, US-076, US-077, US-294–US-297. **Acceptance.** FR-52.1 WCAG 2.1 AA / GIGW 3.0 / UX4G; axe in CI zero serious/critical; FR-52.2 ≥ 48 px targets, ≥ 18 px body text, icon + colour + words; FR-52.3 no-audio games, captions, reduced motion, ≤ 3 flashes/s; FR-52.4 TalkBack walk-through of plan and application. **Priority.** Must. **R0 depth.** Deep-C. **Edge cases.** EC-13, EC-18.

### F-53 Notifications
- **Description.** WhatsApp (templates), email, web push; SMS only after TRAI DLT registration (D-16).
- **Stories.** US-014, US-220–US-223, US-227, US-228. **Acceptance.** FR-53.1 per-channel opt-in, off by default; FR-53.2 templates only; FR-53.3 STOP → consent withdrawn ≤ 1 min (EC-30); FR-53.4 ≤ 1/day, quiet hours; FR-53.5 `ff_sms_channel` false blocks SMS code paths. **Priority.** Must. **R0 depth.** Deep-C (WhatsApp test number + email). **Risk.** Meta test number reaches ~5 allow-listed recipients [HUNCH; owner Tech lead; pre-register testers 2026-10-23].

### F-54 Privacy centre
- **Description.** Consent records (DEPA-style artefacts), export, delete, grievance officer; family mode with parental consent.
- **Stories.** US-108, US-113, US-270–US-276, US-278. **Acceptance.** FR-54.1 purpose-bound consent artefacts with revoke; FR-54.2 export ≤ 24 h; FR-54.3 delete mid-case cancels jobs first, then deletes, keeps only anonymised aggregates (EC-26); FR-54.4 grievance officer page; FR-54.5 family mode: a minor's case lives in the parent's account and parental consent (DPDP s.9(1), Rule 10) is enforced server-side; FR-54.6 no Aadhaar/OTP/biometric fields (lint); FR-54.7 anonymous device session → optional account. Wording "built to DPDP Rules", never "DPDP-compliant". **Priority.** Must. **R0 depth.** Deep-C.

### F-55 Privacy-preserving analytics
- **Stories.** US-277. **Acceptance.** FR-55.1 allowlisted per-event schemas at API-63; FR-55.2 IP dropped at ingress, daily-rotating session IDs; FR-55.3 events from a minor's profile are never used for behavioural tracking, profiling or targeted ads (s.9(3)); FR-55.4 console/public stats only via k ≥ 5 aggregates. **Priority.** Must. **R0 depth.** Deep-C. Taxonomy in [METRICS §7](METRICS.md#7-analytics-event-taxonomy).

### F-56 Government adapter layer
- **Description.** SarathiAdapter, DigiLockerAdapter, AadhaarOfflineAdapter (offline QR/XML only), BhashiniAdapter, PaymentAdapter, NotificationAdapter, SlotAdapter, each with mock and real implementations passing the same contract tests.
- **Stories.** US-036, US-041, US-300, US-301, US-304–US-306. **Acceptance.** FR-56.1 contract suite in CI for every adapter; FR-56.2 OpenAPI for government-side versions; FR-56.3 "simulated" chips on mock data; FR-56.4 adapter mode per tenant (E-31); FR-56.5 health endpoint reports modes. **Priority.** Must. **R0 depth.** Deep-C (mocks + specs).

### F-57 Field-study module
- **Description.** Journey-test lab (unbranded replica of the observed Sarathi sequence), Nazar study, pre-registered hypotheses.
- **Stories.** US-310–US-316. **Acceptance.** FR-57.1 replica unbranded, noindex, banner, flag-gated; FR-57.2 consent 18+ with stored/not-stored lists; FR-57.3 HYPOTHESES.md (H1–H4, J1–J4) committed after the confirmed start and before data; FR-57.4 API-71 public counters with CIs; FR-57.5 nightly stats Workflow; FR-57.6 deletion by anonymous ID. **Priority.** Must. **R0 depth.** Deep-B.

### F-58 Multi-tenancy per state + white-label theming
- **Stories.** US-262, US-291, US-302, US-303. **Acceptance.** FR-58.1 tenant (E-31) holds theme tokens, rule pack, adapters, languages; FR-58.2 UX4G skin; FR-58.3 state branding only under the state's own hosting. **Priority.** Should. **R0 depth.** Thin (JK + KL tenants).

---

## 8. Edge-case coverage (D-20)
Every edge case needs a rule row or screen state **and** a test. Test IDs follow `T-EC-nn-k` in [TESTING](../03-engineering/TESTING.md).

| EC | Case | Handled by | Mechanism | Rule row / screen state | Story |
|---|---|---|---|---|---|
| EC-01 | Aadhaar shows only year of birth | F-04 | Rule `id.yob_only` | Blocker row + DOB-proof prompt | US-016 |
| EC-02 | Aadhaar address ≠ residence | F-04 | Rule `id.address_mismatch` | Two-option trade-off row | US-017 |
| EC-03 | Blank S/o / D/o line | F-04 | Rule `id.relation_blank` | Blocker row with news source | US-018 |
| EC-04 | Turning 40 mid-journey | F-04, F-09 | Rule `med.form1a_age40` + clock re-check | Warning before DL test | US-019 |
| EC-05 | Age 16–17, ≤ 50 cc only | F-02, F-04, F-54 | Rule `age.mc50_guardian` + family mode | Minor's plan in the parent's account; full features incl. AI; parental consent | US-020, US-274 |
| EC-06 | Transport classes under 20 | F-04 | Rule `age.transport_20` + `transport.lmv_prereq` (verify) | Class shown not eligible | US-021 |
| EC-07 | LL expires while waiting; new app number breaks slot | F-09, F-13 | Collision formula | Red-amber banner | US-143, US-169 |
| EC-08 | 3+ fails, 7-day gap, remedial training | F-13 | Rule `dl.retest_gap` (verify), `dl.remedial_s9_5` | Retest plan + support | US-168, US-171 |
| EC-09 | Payment debited but pending | F-05 | Screen state `payment_pending` | Guide + 24 h reminder | US-037 |
| EC-10 | No online LL test in the state | F-02, F-04, F-22 | Rule `ll.test_mode` | Plan switches to RTO test | US-013, US-022 |
| EC-11 | Sarathi outage | F-05, F-07 | Status adapter + offline queue | Calm banner, drafts safe | US-035, US-038 |
| EC-12 | Moving state, foreign licence, NRI, IDP | F-04, F-16 | Rules `move.state`, `foreign.no_conversion` (low), `idp.requirements` | Re-evaluation diff; IDP for DL holders only | US-024, US-204 |
| EC-13 | Disability, adapted vehicles, deaf, colour vision | F-04, F-52 | Rule `rights.deaf_advisory`, adapted-vehicle checklist | Rights card; text alternative | US-023, US-297 |
| EC-14 | Shared phone or cyber café | F-17 | Shared-device mode | Clear-device, 10-min auto-logout | US-206, US-207 |
| EC-15 | Device clock tampering | F-08, F-09 | Server time | Clock-wrong note | US-224 |
| EC-16 | Expired DL, no grace period | F-16 | Rules `dl.no_grace_2019`, `dl.retest_after_1y` | Renewal plan with test | US-200, US-201 |
| EC-17 | Minor riding the family scooter | F-17 | Content card | s.199A parent card | US-209 |
| EC-18 | Game buffering, spam taps, screen readers, photosensitivity | F-23, F-24, F-52 | Preload + rVFC; pattern rule; SR alternative; flash check | Voided clip; 0-score clip; alt mode | US-074–US-077 |
| EC-19 | Low-end phone on 2G | F-51 | Lite bundle, 360p clips | Lite mode | US-292, US-293 |
| EC-20 | Aadhaar number or OTP typed into the AI | F-30, F-54 | Client regex + ADK PII plugin | "[removed]" + warning | US-108 |
| EC-21 | Two classes with different eligibility ages | F-03 | Per-class eligibility | Class not added | US-015 |
| EC-22 | LL already held (mid-journey onboarding) | F-08 | Onboarding path | Case at S4/S5 | US-009 |
| EC-23 | Passed but no SMS within 3 days | F-14 | Timer state | Status-check guide | US-181 |
| EC-24 | Fake slot or "setting" offer in Live Intel | F-11 | Aggregate field + ACB/CPGRAMS links | No hosting of allegations | US-147 |
| EC-25 | Helper misuse (consent revoked) | F-17 | Consent revoke | Access ended in ≤ 60 s | US-208 |
| EC-26 | Account deleted mid-case | F-54 | Ordered deletion | Deletion receipt | US-272 |
| EC-27 | Rule pack changes mid-case | F-09, F-42 | Re-evaluation + diff | "Your plan changed" notice | US-225, US-263 |
| EC-28 | Kerala HPT stayed or postponed | F-23, F-40, F-42 | `kl_hpt_status` enum | Copy switches to "hazard practice" | US-071, US-240, US-267 |
| EC-29 | AI unavailable | F-25, F-31, F-30 | Template fallback | Template debrief | US-102 |
| EC-30 | WhatsApp opt-out ("STOP") | F-53 | Consent withdrawal | Confirmation message | US-222 |

---

## 9. Non-functional requirements

### 9.1 Performance (hackathon targets are measured and shown; Kapoor persona)
| ID | Requirement | R0 target | R1+ target | How measured |
|---|---|---|---|---|
| NFR-P1 | Lite first load (compressed) | < 300 KB | < 300 KB | CI bundle budget (size-limit) |
| NFR-P2 | LCP, mid-range Android, 4G (p75) | ≤ 2.5 s | ≤ 2.5 s | Lighthouse CI + RUM (anonymous) |
| NFR-P3 | LCP on throttled 3G (Lite) | ≤ 4.0 s | ≤ 4.0 s | Lighthouse "Slow 3G" profile |
| NFR-P4 | API-01 plan, server p95 | ≤ 300 ms | ≤ 200 ms | OpenTelemetry |
| NFR-P5 | API-12 autosave p95 | ≤ 250 ms | ≤ 200 ms | OpenTelemetry |
| NFR-P6 | API-35 session replay p95 | ≤ 800 ms | ≤ 500 ms | OpenTelemetry |
| NFR-P7 | Debrief end-to-end p95 (template first paint ≤ 300 ms) | ≤ 4 s | ≤ 3 s | Trace from session complete to narration |
| NFR-P8 | Load: "10,000 users at 9 am" | Load-test 200 RPS on API-01/02/03 with p95 ≤ 500 ms on one instance + Redis cache | Horizontal scale on NIC/MeitY cloud | k6 script in CI (manual trigger) |
| NFR-P9 | Clip bytes | 360p ~1–2 MB per clip; full preload before play | same | Pipeline output check |

### 9.2 Availability and resilience
| ID | Requirement | R0 | R1+ |
|---|---|---|---|
| NFR-A1 | Availability | Instance pre-warmed before and during judging; health check API-64; README notes ~1-min cold start | 99.5% monthly (pilot), 99.9% (state) |
| NFR-A2 | Degradation | AI down → templates; n8n down → staff tasks delayed, citizen messages and facts unchanged; Sarathi down → drafts safe | same, with status page |
| NFR-A3 | Durable jobs | Render Workflows retries per policy; idempotent timeline keys | `JobRunner` second implementation for NIC/MeitY (Celery/Temporal-style) |
| NFR-A4 | Backups | Daily Postgres snapshot (Render) | RPO ≤ 15 min, RTO ≤ 4 h, in India |

### 9.3 Offline
- NFR-O1 The plan card, checklists, mock tests, golden-hour card and downloaded clips work offline (Serwist precache + runtime caching).
- NFR-O2 Offline answers queue in IndexedDB and sync with conflict rule "last write per field wins, server time".
- NFR-O3 Offline state is visible ("saved on this phone").

### 9.4 Languages
- NFR-L1 English and Hindi at 100% key coverage (next-intl); Devanagari via Noto Sans Devanagari.
- NFR-L2 Dogri speech input (Sarvam Saaras v3); no Dogri text UI claim.
- NFR-L3 ₹ formatting en-IN / hi-IN (`₹1,05,000`), dates DD MMM YYYY, IST.

### 9.5 Accessibility
- NFR-X1 WCAG 2.1 AA, GIGW 3.0 self-assessment matrix, UX4G components where suitable.
- NFR-X2 axe-core in CI (0 serious/critical); manual TalkBack pass on Deep-A flow before release.
- NFR-X3 ≥ 48 px targets, ≥ 18 px body text, icon + colour + words, captions, reduced motion, ≤ 3 flashes/s, no-audio games, screen-reader alternative for Nazar.

### 9.6 Security
- NFR-S1 OWASP ASVS L2 checklist; OWASP LLM Top 10 mitigations for every agent (prompt-injection defences, output validation, least-privilege tools).
- NFR-S2 TLS 1.2+; encryption at rest; E-14 contacts encrypted with a separate key and stored apart from cases.
- NFR-S3 Rate limits (Redis): API-01 60/min/IP-hash, AI endpoints 20/min/user, report submission 5/day/user.
- NFR-S4 Secrets in the host secret store; none in the repo (gitleaks in CI).
- NFR-S5 Audit log (E-30) append-only for admin, rule-pack, helper and export actions.
- NFR-S6 Production: CERT-In 6 h reporting, 180-day logs in India, NTP to NIC/NPL [unverified: hostnames; owner Tech lead; 2026-11-15]; audit-ready pack (VAPT scope, threat model, SBOM). Say "audit-ready", never "STQC-certified".

### 9.7 Privacy
- NFR-PR1 Built to DPDP Act 2023 + Rules 2025: purpose-bound consent, notice, rights, grievance; children = under 18.
- NFR-PR2 Never collected: Aadhaar number, OTP, biometrics, face for matching, document images, LL/DL numbers in clear, precise location.
- NFR-PR3 Retention: case data until deletion or 24 months after S7 inactivity [design default; owner Product lead; DPIA by Phase 3]; field-study data until study close + 12 months, anonymous; analytics events 13 months; logs 180 days (production, India).
- NFR-PR4 Processors disclosed: Google (Gemini, paid tier), Sarvam (Dogri ASR), Meta (WhatsApp), email provider, Render, Cloudflare.

### 9.8 Observability
- NFR-OB1 OpenTelemetry traces across web → API → Workflows → n8n webhooks; structured logs with PII redaction; Sentry for errors.
- NFR-OB2 LLM observability: tokens, latency, validator rejections, fallback rate; alert if fallback > 20% or validator rejections spike (n8n W12).

### 9.9 Maintainability and portability
- NFR-M1 Hexagonal core; adapters behind ports; containerised; cloud-agnostic (Docker, Postgres, S3-compatible storage, OTel).
- NFR-M2 Apache-2.0 code; CC-BY 4.0 clip bank and rule packs.
- NFR-M3 Every model name in env vars; pinned dependency versions re-pinned at H0.

### 9.10 Compliance and content integrity
- NFR-C1 No rupee literal in UI strings or prompts (CI grep).
- NFR-C2 Wording-ban lint over UI strings, docs and prompts: "official", "first" (as in first-ever), "doesn't exist", "DPDP-compliant", "STQC-certified", "integrated with Sarathi/Aadhaar", "verified licence", "safe" (as a scam verdict), "you would crash", "unsafe driver", "lives saved" (D-19).
- NFR-C3 Every rule row has `source`, `verified_on`, `confidence`; a rule with `verified: false` can be used by games but cannot be cited by AI.

---

## 10. AI requirements (summary; detail in [04-ai](../04-ai/MODELS.md))
| Model | Feature | Must | Must not |
|---|---|---|---|
| M-01 VoiceGuideAgent | F-30 | Closed action enum; rule-ID answers | Submit, pay, book; answer fees from memory |
| M-02 DebriefAgent | F-25 | IDs from per-request allowlists; no digits; validator; template fallback | Compute or state any number |
| M-03 CoachAgent | F-25 | Wording of a code-computed plan | Change the plan |
| M-04 TutorAgent | F-31 | Explain from reviewed bank | Generate new rules |
| M-05 ScreenDecoderAgent | F-32 | Match the verified error catalogue; "unknown" allowed | Guess a status |
| M-06 ClipWindowProposer | F-23 | Propose windows offline | Publish; set final windows |
| M-07 SignSnap | F-27 | Confirm against the sign catalogue | Teach a sign not in the catalogue |
| M-08 Sarvam Saaras v3 | F-30, F-25 | Dogri/Kashmiri speech → text | — |
| M-09 On-device MediaPipe/YuNet/plate detector | F-24, F-23 | Helmet fit on device; blur in pipeline (100% audited) | Send helmet frames off device |

No AI in: eligibility, fees, timelines, scores, scam verdicts, golden hour, class planner (D-09).

---

## 11. Assumptions
| # | Assumption | Risk if wrong | Mitigation |
|---|---|---|---|
| AS-1 | Kerala's HPT starts 1 Dec 2026 in the reported format | Hook weakens (R-10) | `kl_hpt_status` flag; "Kerala's announced format" wording; recheck on demo morning |
| AS-2 | J&K LL format is 10 questions / 6 to pass | Simulator mismatch (quit trigger) | Source chip; confirm at ARTO counter |
| AS-3 | Users will self-report stage events (LL issued, slot, results) | Clock accuracy | Low-friction prompts tied to reminders; Mode B adapters later |
| AS-4 | WhatsApp test number suffices for the demo | Messaging fails on stage (R-08) | Pre-register testers; email/web-push fallback |
| AS-5 | ≥ 12 usable clips filmed and blurred by Fri 12:00 | Nazar shrinks (R-06) | Backup trigger (6 clips) |
| AS-6 | 40+ licence holders take the Nazar study in 48 h | Weak evidence (R-07) | Recruitment kit; over-recruit |
| AS-7 | Gemini paid tier active before any real user | Terms breach (R-13) | Gate in deploy checklist |
| AS-8 | Schools see value in HPT logs | Business model (D-23) | Interviews in Phase 3 |

## 12. Dependencies
| Dependency | Type | Used by | Status | Fallback |
|---|---|---|---|---|
| Render (web services, Postgres, Key Value, Workflows Python SDK) | Platform | All; clip pipeline, sweeper, stats | Available (Singapore region) | Docker on any host; `JobRunner` alt |
| n8n Pro | Schedules, staff queues and notifications (no citizen messages) | F-09, F-11, F-23, F-40, F-41, F-42 | Team has Pro | Direct call to API-65 for the sweep; backend review pages for staff queues |
| Google ADK 2.12 (Python) + Gemini | AI | F-25, F-30–F-32 | Pin at H0 | Templates |
| Sarvam Saaras v3 | Dogri ASR | F-30 | API key needed | Hindi-only voice |
| Meta WhatsApp Cloud API | Notifications | F-53 | Test number | Email, web push |
| Cloudflare R2 | Clip storage | F-23 | Available | Render disk (demo only) |
| MediaPipe Tasks Vision, YuNet, plate detector | On-device/pipeline vision | F-06, F-23, F-24 | OSS | Manual blur review |
| ts-fsrs 5.x | Spaced repetition | F-20 | Pin after `npm view` | Leitner boxes |
| Phaser 4 | Games | F-24 | v4.2.1 (Jul 2026) | Phaser 3 |
| Sarathi, DigiLocker, Bhashini, PayGov/state gateway | Government (real adapters) | F-07, F-14, F-50, F-56 | Not accessible to private entities now | Mocks with identical contracts |

## 13. Open questions
| # | Question | Owner | Due |
|---|---|---|---|
| Q-01 | Confirmed hackathon start time (Fri 00:00 vs Fri 21:30 IST) and deadline (Sat 23:59 vs Sun 21:30) | Product lead | 2026-10-23 (HackCache WhatsApp group) |
| Q-02 | Jammu track type for 2W/4W; whether an out-of-district Aadhaar blocks applying at Jammu; J&K PSGA DL day-limit | Field lead (C) | 2026-10-24 (ARTO counter visit) |
| Q-03 | J&K amount ₹1,050 at slot booking: breakdown | Rules owner (A) | 2026-10-24 |
| Q-04 | Kerala HPT status and MVD circular text | Nazar lead (B) | Demo morning |
| Q-05 | Rah-Veer / cashless-treatment amounts | Rules owner (A) | Before Golden Hour leaves draft |
| Q-06 | Transport-class LMV-prerequisite rule after 2019 | Rules owner (A) | 2026-11-01 |
| Q-07 | F-24 "4 deep" (PROJECT_BRIEF) vs 08 §3.11 (2 deep + 4 thin): which four games are demo-deep | Nazar lead (B) | H6 of the build |
| Q-08 | Retention defaults (24 months case data) in the DPIA | Product lead | Phase 3 (2026-12-15) |
| Q-09 | Margdarshak trademark availability (IP India) | Product lead | Before any post-event launch (2026-11-30) |
| Q-10 | DigiLocker requester onboarding through @Nestiq Pvt Ltd | Product lead | Start 2026-11-01 |

## 14. Release criteria

### R0 Hackathon submission (Phase 2 exit)
- [ ] All Must features reachable and working end to end on mocks; **zero dead buttons** (Playwright crawl clicks every interactive element on every route; no 404/500).
- [ ] Deep-A, Deep-B, Deep-C acceptance criteria above pass in CI.
- [ ] Every EC-01..EC-30 has its rule row or screen state and a passing test (§8).
- [ ] AI evals: ≥ 30 cases for M-02 and M-03 (and the voice script for M-01), 0 invented numbers; validator and template fallback demonstrated.
- [ ] Clip pipeline run visible on the Render Workflows dashboard with an injected retry.
- [ ] Field study: HYPOTHESES.md committed after the confirmed start and before data; API-71 live; honesty footnote on the slide.
- [ ] Lite < 300 KB; axe 0 serious/critical; TalkBack pass on Deep-A.
- [ ] Footer and first-launch disclaimer on every route; wording-ban lint green; no emblem/logo; domain without "parivahan", "sarathi" or "gov".
- [ ] No rupee literal in UI/prompts; fees computed and sourced.
- [ ] Family mode verified: a minor's case in the parent's account gets every feature incl. AI; parental consent recorded; no behavioural tracking or targeted ads; squads and share cards need the parent's consent.
- [ ] README states Render Singapore + synthetic data; instance pre-warmed; p95 numbers captured for the deck.
- [ ] Public repo, live URL, ≤ 5-minute video, deck (submission constraints, PROJECT_BRIEF §14).
- [ ] Each architecture module has a named owner who can explain it (D-24).

### R1 Pilot (Phase 3 exit)
- [ ] Gemini paid tier; DPIA done; grievance officer named; WhatsApp templates approved; India copy of logs.
- [ ] Live Intel with real reports at k ≥ 5 for ≥ 3 offices; moderation SLA ≤ 24 h.
- [ ] School Pro beta with ≥ 5 schools; HPT log export used in ≥ 1 inspection [target].
- [ ] Console beta reviewed by one RTO/ARTO.
- [ ] Security: ASVS L2 self-assessment; external VAPT scoped.

### R2 State adoption (Phase 4 exit)
- [ ] MoU with a State Transport Department; rule pack signed off via maker-checker by the state.
- [ ] At least one real adapter (DigiLocker or Sarathi read/status) passing the contract suite in the state's environment.
- [ ] Hosting on NIC or a MeitY-empanelled Indian cloud; safe-to-host certificate from an authorised auditor.
- [ ] GIGW 3.0 compliance checklist complete; state languages at 100% reviewed coverage.
