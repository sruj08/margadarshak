# User Stories
> Project: Margdarshak · Owner: Product lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [PRD](PRD.md) · [PERSONAS](PERSONAS.md) · [USER_JOURNEYS](USER_JOURNEYS.md) · [FEATURES](FEATURES.md) · [METRICS](METRICS.md) · [API spec](../03-engineering/API_SPEC.md) · [Backlog](../08-project/BACKLOG.md)

---

## 0. Conventions

- **IDs.** Epics `EP-01..EP-20`; stories `US-001..US-316` (gaps are deliberate, for insertion). Features `F-xx`, edge cases `EC-xx`, endpoints `API-xx`, entities `E-xx`, models `M-xx` come from [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md).
- **Story line.** As *persona (P-xx)*, I want *capability*, so that *outcome*.
- **Meta line.** `F-xx · MoSCoW · Estimate · Stage · EC · API · Depth`.
  - **MoSCoW** inherits the feature's product priority from PROJECT_BRIEF §5.1 unless a story narrows it.
  - **Estimate:** S ≤ 4 h, M ≤ 1 day, L ≤ 3 days of one engineer (production estimate; hackathon builds the thin version).
  - **Depth** (hackathon, D-04): **Deep-A** (plan → guided LL → check answers), **Deep-B** (Nazar + AI debrief + field study), **Deep-C** (stage-aware home + journey sweeper on Render Workflows + WhatsApp from the backend notifier), **Thin** (works end to end on mocks, no dead buttons), **Roadmap** (Phase 3+; not built in the hackathon; may appear as a labelled, disabled state).
- **Gherkin.** Each story has at least one scenario. Numbers in "Then" steps come from the rule pack or fixtures (`fees.json`, `rules/<STATE>.json`, `game-config.json`), never from AI text (D-09, D-10). Example values use the J&K tenant unless stated.
- **Global background** (implicit in every scenario unless overridden):
  ```gherkin
  Background:
    Given the tenant is "JK" with rule pack version "jk-2026.10.23-r1"
    And every page shows the footer "Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State Transport Department. Uses simulated government data."
    And government adapters run in "mock" mode with visible "simulated" chips
  ```
- **Age gate** (implicit): stories marked **18+** are hidden and their endpoints refuse requests (HTTP 403 `age_gate`) for users whose verified age band is under 18 (D-13).

### 0.1 Epic index
| Epic | Name | Stages | Features | Stories |
|---|---|---|---|---|
| EP-01 | Home and entry | S0 | F-01, F-08 | US-001–US-009 |
| EP-02 | Licence plan and blockers | S1 | F-02, F-03, F-04 | US-010–US-025 |
| EP-03 | Guided LL application and hand-off | S2 | F-05, F-06, F-07 | US-030–US-042 |
| EP-04 | LL test preparation | S3 | F-20, F-21, F-22, F-27, F-31 | US-050–US-061 |
| EP-05 | 30-day bridge: Nazar and simulations | S4 | F-23, F-24, F-28 | US-070–US-092 |
| EP-06 | AI assistance | Cross | F-25, F-30, F-31, F-32, F-33 | US-100–US-114 |
| EP-07 | Gamification | S3–S8 | F-26 | US-120–US-129 |
| EP-08 | Book the DL test and RTO Live Intel | S5 | F-09, F-10, F-11 | US-140–US-149 |
| EP-09 | Driving test, fail and recover | S6, S6F | F-12, F-13 | US-160–US-172 |
| EP-10 | Licence issued | S7 | F-14 | US-180–US-185 |
| EP-11 | New-rider year | S8 | F-15 | US-190–US-197 |
| EP-12 | Renew, fix, family and helper | S9, Cross | F-16, F-17 | US-200–US-209 |
| EP-13 | Case clock and notifications | S2–S7, Cross | F-09, F-53 | US-220–US-228 |
| EP-14 | Driving-school portal | Eco | F-40 | US-230–US-240 |
| EP-15 | State / RTO console | Eco | F-41 | US-250–US-257 |
| EP-16 | Rule-pack studio | Eco | F-42 | US-260–US-267 |
| EP-17 | Privacy, consent and age gates | Cross | F-54, F-55 | US-270–US-278 |
| EP-18 | Languages, Lite mode and accessibility | Cross | F-50, F-51, F-52 | US-290–US-297 |
| EP-19 | Platform, adapters and tenancy | Platform | F-56, F-58 | US-300–US-306 |
| EP-20 | Field study and evidence | Evidence | F-57 | US-310–US-316 |

---

## EP-01 Home and entry (S0)
**Goal:** replace the ~120-link portal homepage with one headline, four verbs and a mic ([team report teardown](../../../research/ps1-deep/team-saarthi-report.md)). **PS1 boxes:** 7, 11, 13.

#### US-001 · Choose my language in its own script
As Mohan-ji (P-03), I want to pick हिन्दी before anything else, so that I never have to decode English menus.
`F-01, F-50 · Must · S · S0 · EC-19 · — · Deep-C`
```gherkin
Scenario: Language first on first launch
  Given I open Margdarshak for the first time on a phone with browser locale "hi-IN"
  When the home screen loads
  Then the first element is a language picker listing "English" and "हिन्दी" each in its own script
  And "हिन्दी" is pre-highlighted but not applied until I tap it
  And other languages appear as "coming soon" without being selectable (D-21)

Scenario: Language persists without an account
  Given I selected "हिन्दी"
  When I return the next day on the same device
  Then the UI opens in Hindi and the choice is stored only on the device
```

#### US-002 · See one headline and four verb tiles
As Kabir (P-01), I want four big actions instead of a menu, so that I can start in one tap.
`F-01 · Must · S · S0 · — · — · Deep-C`
```gherkin
Scenario: Four tiles, verbs only
  When the logged-out home loads
  Then I see exactly 4 tiles: "Get my first licence", "Practise for the test", "Renew or fix my licence", "Check my application"
  And each tile has an icon, a verb label and one helper line
  And no tile says "Read More"
  And the headline reads "Get your driving licence, step by step."
```

#### US-003 · A calm trust line with the computed fee
As Tanvi (P-02), I want to see the government fee and a "never pay agents" line, so that I know what is fair before I start.
`F-01, F-02 · Must · S · S0 · — · API-03 · Deep-C`
```gherkin
Scenario: Fee line computed from the rule pack
  Given fees.json for "JK" gives LL 150, LL test 50, DL test 300, DL 200, smart card 200
  When the home loads
  Then the trust line reads "Govt fee for one vehicle class: ₹700 + ₹200 card (your state may add a service charge). Never pay agents."
  And the rupee values are rendered from API-03, not from a string literal
  And tapping the line opens the fee breakdown with "source: CMVR r.32, checked 22 Oct 2026"

Scenario: No fear imagery
  When the home loads
  Then no red alarm banner, hacker image or death statistic appears above the fold
```

#### US-004 · "All services" grouped by who I am
As the Helper (P-04), I want every other transport service grouped by user type, so that I can find a rare service without scanning 120 links.
`F-01 · Must · M · S0 · — · — · Thin`
```gherkin
Scenario: Grouped services with search
  When I open "All services"
  Then groups are "Citizen", "Vehicle owner", "Driving school", "Dealer / manufacturer", "Government staff"
  And a search box filters services by name in English and Hindi
  And services Margdarshak does not run show "Opens on parivahan.gov.in" with the external-link icon
```

#### US-005 · Speak instead of tapping
As Mohan-ji (P-03), I want to tap a mic and say what I need, so that I don't have to read.
`F-01, F-30 · Must · M · S0 · EC-20 · API-40 · Deep-C (one scripted Hindi flow)`
```gherkin
Scenario: Mic routes to a plan (18+)
  Given my verified age band is "50-59"
  When I tap the mic and say "Mere papa 52 saal ke hain, unko car ka licence chahiye"
  Then the voice guide navigates to the Licence Plan with age 52 and vehicle "car" prefilled
  And it shows the "Form 1A required (age 40+)" warning with its rule-ID chip
  And it does not submit, pay or book anything

Scenario: Mic hidden for minors
  Given my declared age band is "16-17"
  When the home loads
  Then no mic is shown and the tile helper text says "Tap to start"
```

#### US-006 · Non-affiliation disclaimer on first launch
As any user, I want to be told plainly that this is not a government site, so that I am not misled.
`F-01 · Must · S · S0 · — · — · Deep-C`
```gherkin
Scenario: First-launch disclaimer and persistent footer
  When I open Margdarshak for the first time
  Then a one-screen notice explains "Independent prototype. Not affiliated with MoRTH, NIC or any State Transport Department. Government steps happen on Sarathi or your state's portal."
  And no State Emblem, Parivahan logo or tricolour government header appears anywhere
  And the footer text is present on every route (checked by an e2e test)
```

#### US-007 · A home that knows my stage
As Kabir (P-01), I want the home screen to show the one thing I should do now, so that I never wonder what's next.
`F-08 · Must · L · All · EC-15 · API-11, API-14 · Deep-C`
```gherkin
Scenario Outline: One primary action per stage
  Given my case is at stage "<stage>" with server date "<today>"
  When I open the home
  Then the single primary button is "<action>"

  Examples:
    | stage | today | action |
    | S1 no case | 2026-10-24 | Start my licence plan |
    | S2 draft saved at step 3 of 6 | 2026-10-24 | Continue where I left off |
    | S3 LL test not taken | 2026-10-24 | Practise 10 questions |
    | S4 LL issued 2026-10-12 | 2026-10-24 | Today's 3-minute Nazar session |
    | S5 LL issued 2026-09-20 | 2026-10-24 | Book your driving test |
    | S6F failed 2026-10-20 | 2026-10-24 | See your retest plan |
    | S7 passed, approval pending | 2026-10-24 | Track your licence |
    | S8 DL held | 2026-10-24 | This month's hazard refresher |

Scenario: Server time wins over device time (EC-15)
  Given my phone clock is set 40 days ahead
  When I open the home
  Then the countdowns use server time from API-14 and the stage does not change
```

#### US-008 · Parcel-style tracker
As Tanvi (P-02), I want to see my whole road with the next step highlighted, so that I always know where I am.
`F-08 · Must · M · All · — · API-14 · Deep-C`
```gherkin
Scenario: Tracker shows all stages with dates
  Given my LL was issued on 2026-10-12
  When I open "My Licence"
  Then the tracker lists Plan → Apply → LL test → 30-day bridge → Book DL test → Driving test → Licence issued
  And completed steps show dates, the current step is highlighted, and future steps show earliest dates
  And "DL test unlocks on 2026-11-11" is computed from the rule "LL + 30 days"
```

#### US-009 · I already have a learner's licence
As Kabir (P-01), I want to start Margdarshak halfway through, so that I get the countdown and practice without redoing the plan.
`F-08 · Must · S · S3–S5 · EC-22 · API-10, API-15 · Deep-C`
```gherkin
Scenario: Mid-journey onboarding
  When I choose "I already have a learner's licence"
  And I enter the LL issue date 2026-09-01 and class "MCWG"
  Then my case is created at stage S4 or S5 according to the date
  And the LL number is never requested (E-04 stores no LL number in clear)
  And the LL-expiry countdown shows 2027-02-28 computed as issue + 6 months − 1 day per the rule pack
```

---

## EP-02 Licence plan and blockers (S1)
**Goal:** "answer before you ask": the e-Visa moment ([team report §2](../../../research/ps1-deep/team-saarthi-report.md)). **PS1 boxes:** 1, 7, 8, 14.

#### US-010 · My licence plan in 3 taps, no login
As Kabir (P-01), I want my class, steps, fee, documents and earliest date from three answers, so that I know my whole road before filling any form.
`F-02 · Must · M · S1 · — · API-01 · Deep-A`
```gherkin
Scenario: Plan card for a 19-year-old, bike with gears, J&K
  Given I am not logged in
  When I enter DOB 2007-03-14, choose the picture "bike with gears" and state "Jammu & Kashmir"
  Then within 1 second I see "Your licence plan" with:
    | line | value |
    | Eligible class | Motorcycle with gear (MCWG) |
    | Steps | 6 steps, at most 2 RTO visits |
    | Earliest licence date | 31 days after your LL is issued |
    | Government fee | ₹700 + ₹200 card (breakdown) |
    | Documents | Aadhaar or other age and address proof, photo, signature |
    | Warnings | none |
  And every line has a source chip with rule ID and verified_on date
  And buttons "Start my application" and "Send this plan to WhatsApp" are shown

Scenario: Unknown state data is honest
  Given the rule pack for my state marks "LL test mode" as confidence "low"
  When the plan card renders
  Then that line reads "Verify at your RTO" with an amber "unverified" chip
```

#### US-011 · Pick my vehicle by picture
As Tanvi (P-02), I want to choose a picture of a scooter, so that I don't need to know "MCWOG".
`F-02 · Must · S · S1 · EC-05 · API-02 · Deep-A`
```gherkin
Scenario: Pictures map to classes silently
  When I tap the picture "scooter (no gears)"
  Then my class is MCWOG and the label reads "Scooter without gears (MCWOG)"
  And the code is shown second, in smaller text

Scenario: Scooter for a 17-year-old (EC-05)
  Given my DOB makes me 17
  When I tap "scooter (no gears)"
  Then the plan says "At 17 you can only get a licence for a gearless vehicle up to 50 cc, with your guardian's consent. Most scooters are above 50 cc."
```

#### US-012 · Fee breakdown I can trust
As Mohan-ji (P-03), I want each fee line with its source, so that nobody can overcharge me.
`F-02, F-03 · Must · S · S1 · — · API-03 · Deep-A`
```gherkin
Scenario: One class
  When the plan has one class
  Then the breakdown lists LL ₹150, LL test ₹50, driving test ₹300, DL ₹200 = ₹700, plus smart card ₹200
  And a note says "Your state may add a service charge" with the J&K slot-booking amount shown as "₹1,050 reported at slot booking incl. ₹50 postage (secondary source)"

Scenario: Two classes
  When the plan has MCWG and LMV-NT
  Then the second class adds LL ₹150 and driving test ₹300 = about ₹450
  And the total is computed by the rules engine, not typed in copy
```

#### US-013 · Earliest date and RTO visits
As Kabir (P-01), I want to know the earliest date I could hold a licence and how many times I must go to the RTO, so that I can plan around semester exams.
`F-02 · Must · S · S1 · EC-10 · API-01 · Deep-A`
```gherkin
Scenario: Online LL test available
  Given J&K offers the LL test online at home or at a CSC
  When my plan renders
  Then "RTO visits: at most 1 (driving test)" is shown
  And "Earliest DL test: LL issue date + 30 days" is shown

Scenario: No online LL test in the state (EC-10)
  Given the tenant is "KL" whose rule pack says the online LL test is not offered
  When my plan renders
  Then the LL step reads "LL test at the RTO" and RTO visits read "at most 2"
```

#### US-014 · Send my plan to WhatsApp
As Kabir (P-01), I want the plan on WhatsApp, so that I can show my father and find it later.
`F-02, F-53 · Must · S · S1 · EC-30 · API-04 · Deep-C`
```gherkin
Scenario: Opt-in send
  When I tap "Send this plan to WhatsApp" and enter my number and tick "Send me this plan"
  Then a pre-approved template message with a link on Margdarshak's own domain is sent
  And my number is stored encrypted in E-14, separate from the case
  And no other message is sent unless I opt in to reminders separately

Scenario: Without a phone number
  When I tap "Copy link instead"
  Then a share link is copied and nothing is stored about me
```

#### US-015 · Bike and car together
As Kabir (P-01), I want to add the car class to the same LL, so that I avoid a second LL cycle later.
`F-03 · Must · M · S1 · EC-21 · API-01 · Deep-A`
```gherkin
Scenario: Saving shown honestly
  Given I chose "bike with gears" and add "car"
  When the class planner renders
  Then it shows MCWG + LMV-NT on one LL with the extra ₹450 for the second class
  And it says "If you'd otherwise apply for the car separately later, this saves a second application and another 30-day wait"
  And it does not claim fees are lower per class

Scenario: Different eligibility ages (EC-21)
  Given I am 19 and add "auto-rickshaw (transport)"
  Then the transport class is shown as "not eligible until 20" and is not added to the LL
```

#### US-016 · Aadhaar shows only my year of birth
As Kabir (P-01), I want to be warned if my Aadhaar has only a year, so that the age gate doesn't reject me.
`F-04 · Must · S · S1 · EC-01 · API-13 · Deep-A`
```gherkin
Scenario: YOB-only Aadhaar
  When I answer "My Aadhaar shows only the year of birth"
  Then a blocker row says "Systems may read your date of birth as 1 January. Keep another DOB proof (birth certificate, Class 10 certificate) ready."
  And the row shows fix, source and confidence "medium"
  And the earliest-eligibility date is computed from 1 January if no DOB proof is chosen
```

#### US-017 · Aadhaar address is not where I live
As Tanvi (P-02), I want my options before I pay, so that I don't get stuck at scrutiny.
`F-04 · Must · M · S1 · EC-02 · API-13 · Deep-A`
```gherkin
Scenario: Migrant path
  Given my Aadhaar district is "Kathua" and I live in "Jammu"
  When the blocker check runs
  Then I see two options with trade-offs:
    | option | consequence |
    | Apply with another address proof | non-Aadhaar path, at least 1 extra RTO visit |
    | Update Aadhaar address first | wait for the update, then contactless path |
  And the J&K-specific behaviour shows "Ask at the counter; tell us what you were told" with confidence "low"
```

#### US-018 · Blank "son/daughter of" line
As Tanvi (P-02), I want to know that Sarathi may leave the relation field blank, so that I fix it first.
`F-04 · Must · S · S1 · EC-03 · API-13 · Deep-A`
```gherkin
Scenario: Missing relation line
  When I answer "My Aadhaar shows C/o, not S/o or D/o"
  Then a blocker row says "The relation-name field may come back blank and uneditable from Aadhaar. Options: update Aadhaar, or use the non-Aadhaar path with an RTO visit."
  And the source chip links the India Herald report of 19 Feb 2026 as "news report, not a rule"
```

#### US-019 · Over 40 or turning 40 mid-journey
As Mohan-ji (P-03), I want Form 1A flagged up front, so that I get the medical before applying.
`F-04 · Must · S · S1, S5 · EC-04 · API-13, API-14 · Deep-A`
```gherkin
Scenario: Age 52
  Given my DOB makes me 52
  Then a blocker row says "Medical certificate (Form 1A) needed because you are 40 or older"

Scenario: Turning 40 mid-journey (EC-04)
  Given I turn 40 on 2026-12-01 and my DL test is planned for 2026-12-10
  When the case clock evaluates my case
  Then a warning appears "You turn 40 before your driving test: Form 1A may be needed" with confidence "medium" and "verify at your RTO"
```

#### US-020 · I am 17
As Rahul (P-07), I want to see what I can legally do now, so that I'm not turned away at the counter.
`F-04 · Must · S · S1 · EC-05, EC-17 · API-01 · Thin`
```gherkin
Scenario: Minor path, rules only
  Given my DOB makes me 17
  When my plan renders
  Then only "MC ≤ 50 cc with guardian consent" is offered
  And a "Your 18th-birthday plan" card shows the date I can apply for MCWOG/MCWG
  And no account, AI, streak, squad or analytics event is created
```

#### US-021 · Transport classes under 20
As Kabir (P-01), I want to know I can't get a transport licence yet, so that I don't apply for a commercial class.
`F-04 · Must · S · S1 · EC-06 · API-02 · Thin`
```gherkin
Scenario: Transport class blocked
  Given I am 19 and choose "truck/bus" or "auto-rickshaw (transport)"
  Then the plan says "Transport classes need age 20" with source
  And a second row says "Other conditions (for example, holding an LMV licence first) vary: verify at your RTO" with an amber chip
  And the note "LMV holders may drive transport vehicles up to 7,500 kg (Supreme Court, 6 Nov 2024); verify for commercial use" is shown to LMV holders asking about light transport
```

#### US-022 · My state has no online LL test
As a Kerala learner, I want the plan to switch to an RTO test, so that I don't wait for an online option my state doesn't offer.
`F-04 · Must · S · S1 · EC-10 · API-02 · Thin`
```gherkin
Scenario: Kerala tenant
  Given the tenant is "KL"
  When my plan renders
  Then the LL step says "LL test at the RTO" with the source and verified_on date
  And the device pre-check (US-039) is not offered
```

#### US-023 · Disability and adapted vehicles
As an applicant with a disability, I want my rights and the process, so that I am not refused unfairly.
`F-04, F-52 · Must · M · S1, S6 · EC-13 · API-13 · Thin`
```gherkin
Scenario: Rights card
  When I answer "I have a disability or a medical condition"
  Then I see a rights card with the MoRTH advisory that deaf applicants may be licensed, an adapted-vehicle checklist and the non-faceless path note
  And colour-vision questions in the LL simulator offer a text alternative
```

#### US-024 · I am moving state, hold a foreign licence or am an NRI
As an applicant who is moving, I want to know which state's rules apply and what to do with a foreign licence, so that I don't apply in the wrong place.
`F-04, F-16 · Should · M · S1, S9 · EC-12 · API-02 · Thin`
```gherkin
Scenario: Foreign licence
  When I answer "I have a foreign licence"
  Then the plan says "No direct conversion found; you follow the LL → DL path. Some RTOs may exempt tests." with confidence "low"

Scenario: Moving mid-journey
  Given my case is at S4 in "JK"
  When I change my state to "DL"
  Then the case is re-evaluated against the Delhi rule pack and changes are listed before I confirm
```

#### US-025 · "Show papa" family card
As Kabir (P-01), I want a one-screen card for my father, so that he backs the legal path instead of the agent.
`F-02, F-17 · Should · S · S1 · — · API-04 · Thin`
```gherkin
Scenario: Family card
  When I tap "Show papa"
  Then a card shows the government fee for my plan, the agent quote I entered (optional) labelled "your quote", the date plan, and "Vehicle papers needed on test day: RC, insurance, PUC"
  And it can be shared as an image or link; nothing personal is on it except the first name I choose
```

---

## EP-03 Guided LL application and hand-off (S2)
**Goal:** ~16 Sarathi screens → ~6 guided screens; never collect Aadhaar numbers, OTPs or biometrics (D-07). **PS1 boxes:** 2, 7, 8, 13, 14.

#### US-030 · One question per screen with "why we ask"
As Mohan-ji (P-03), I want one question at a time with a reason, so that I don't feel lost.
`F-05 · Must · M · S2 · — · API-12 · Deep-A`
```gherkin
Scenario: One decision per screen
  When I start the guided application
  Then each screen has exactly one question, one primary button and a "Why we ask" line
  And a progress indicator shows "Step 2 of 6"
  And date of birth is asked once and reused everywhere
```

#### US-031 · Autosave and resume on any device
As Tanvi (P-02), I want my answers saved after every step, so that a dropped network doesn't make me start again.
`F-05 · Must · M · S2 · EC-11, EC-19 · API-12, API-11 · Deep-A`
```gherkin
Scenario: Autosave
  Given I answered 3 screens
  When my network drops and I reopen the app 2 hours later
  Then I resume at screen 4 with all answers intact

Scenario: Resume on another device
  Given I created an optional account with email magic link
  When I log in on the hostel laptop
  Then the same draft opens at the same step
```

#### US-032 · Check my answers before I pay
As Kabir (P-01), I want a summary with "Change" links before payment, so that I don't get locked into a wrong class.
`F-05 · Must · S · S2 · — · API-11 · Deep-A`
```gherkin
Scenario: Check answers
  When I reach the last step
  Then I see every answer with a "Change" link
  And a notice says "On Sarathi, details can't be edited after payment"
  And "Continue to Sarathi" is enabled only after I tick "I've checked these"
```

#### US-033 · Fix my photo before upload
As Tanvi (P-02), I want my photo checked and resized on my phone, so that it isn't rejected.
`F-06 · Must · M · S2 · EC-19 · API-20 · Deep-A`
```gherkin
Scenario: On-device fix
  When I take a selfie with a yellow wall behind me
  Then the fixer detects the face, crops to the configured dimensions, whitens the background and compresses below the configured KB limit
  And it shows before/after
  And only metadata (dimensions, size, pass/fail) is sent to API-20; no image leaves the device

Scenario: Unfixable photo
  When my face is not detected
  Then I see "Move closer, face the light" with an illustration and can retake
```

#### US-034 · Fix my signature
As Mohan-ji (P-03), I want my signature photo cleaned up, so that the upload doesn't fail with "invalid format".
`F-06 · Must · S · S2 · — · API-20 · Deep-A`
```gherkin
Scenario: Signature cleanup
  When I photograph my signature on paper
  Then the fixer converts it to high-contrast black on white, crops and exports JPG under the size limit
```

#### US-035 · Hand-off to Sarathi with a copy-pack (Mode A)
As the Helper (P-04), I want what to pick on each real Sarathi screen with copy buttons, so that I fill the government form correctly.
`F-07 · Must · M · S2, S5 · EC-11 · API-16 · Deep-A`
```gherkin
Scenario: Copy-pack
  When I tap "Continue to Sarathi"
  Then I see the ordered list of Sarathi screens for my state with the value to choose on each and a copy button per field
  And a button opens the Sarathi state-selection page in a new tab
  And Margdarshak never performs the eKYC, OTP, payment or submission

Scenario: Sarathi is down (EC-11)
  Given the status adapter reports Sarathi unavailable
  Then a calm banner says "Sarathi seems unavailable now. Your draft is safe here. We'll remind you to try again."
```

#### US-036 · Simulated eKYC screen in the demo
As a judge, I want the Aadhaar step clearly labelled as simulated, so that I know what is real.
`F-07, F-56 · Must · S · S2 · — · API-16 · Deep-A`
```gherkin
Scenario: Mock eKYC
  Given adapters run in mock mode
  When the flow reaches the Aadhaar step
  Then the screen is labelled "Simulated: in production this step runs on Sarathi"
  And it accepts no Aadhaar number input field at all
```

#### US-037 · Money debited, status pending
As Kabir (P-01), I want to know what to do if my payment is stuck, so that I don't pay twice or cancel and lose the fee.
`F-05 · Must · S · S2, S5 · EC-09 · API-15 · Thin`
```gherkin
Scenario: Payment pending guidance
  When I report "Money debited, status pending"
  Then I see: don't pay again; wait the stated reconciliation window; check "Verify payment" on Sarathi; cancelling may forfeit the fee; a complaint template with the facts I enter
  And a reminder is scheduled to check again in 24 hours
```

#### US-038 · Outage-proof drafts
As Tanvi (P-02), I want to keep working when Sarathi is down, so that an outage doesn't cost me progress.
`F-05 · Must · S · S2 · EC-11 · API-12 · Thin`
```gherkin
Scenario: Offline draft
  Given I am offline
  When I answer a question
  Then the answer is queued locally and synced when I am online, with a "saved on this phone" chip
```

#### US-039 · Device check before the online LL test
As Kabir (P-01), I want to check my webcam, browser and lighting the night before, so that face authentication doesn't fail 20 times.
`F-05, F-22 · Must · S · S2–S3 · EC-10 · — · Thin`
```gherkin
Scenario: Pre-check
  When I run the device check
  Then it tests camera permission, browser type and version, pop-up permission and lighting
  And shows "Sarathi asks for a 1366×768 or larger screen; a laptop is safer" when on a phone
  And no frame is uploaded
```

#### US-040 · A helper fills my form with my consent
As Mohan-ji (P-03), I want my son to fill my form for me with a record of my consent, so that I stay in control.
`F-17 · Should · M · S2 · EC-14 · API-10 · Thin`
```gherkin
Scenario: Helper fills, applicant sees
  Given I granted Kabir a helper link for my renewal case
  When Kabir fills 3 screens
  Then each action is recorded in my case history as "filled by helper Kabir" with time
  And I can review before he hands off to Sarathi
```

#### US-041 · State-hosted submission via adapter (Mode B)
As a state transport department (P-06), I want Margdarshak to submit through our Sarathi adapter, so that citizens never leave our front end.
`F-07, F-56 · Must (spec), Roadmap (live) · L · S2, S5 · — · API-16 · Roadmap`
```gherkin
Scenario: Mode B behind a flag
  Given tenant "JK" enables flag ff_sarathi_mode_b with a real SarathiAdapter that passed the contract tests
  When I confirm my answers
  Then the adapter creates the application on Sarathi and returns the application reference
  And the Aadhaar step runs on Sarathi's own eKYC, never in Margdarshak
```

#### US-042 · Tell Margdarshak my LL is issued
As Kabir (P-01), I want to record my LL issue date, so that my countdowns start.
`F-08 · Must · S · S2–S3 · EC-22 · API-15 · Deep-C`
```gherkin
Scenario: ll_issued event
  When I tap "I got my LL" and enter the issue date
  Then API-15 records event ll_issued with an idempotency key
  And timeline events for day 25, day 30, T-30 and T-7 before expiry are scheduled (E-12)
```

---

## EP-04 LL test preparation (S3)
**Goal:** a mock that teaches, variants not a bank, calibrated readiness. **PS1 boxes:** 3, 4, 5, 9, 10.

#### US-050 · Learn hub with short modules
As Kabir (P-01), I want 3-minute lessons on signs, rules and what actually kills riders, so that I learn more than the question bank.
`F-20 · Must · M · S3–S4 · — · API-30 · Deep-A (LL topics) / Thin (survival modules)`
```gherkin
Scenario: Modules listed with sources
  When I open Learn
  Then I see the LL syllabus topics and survival modules M1, M3, M4, M6, M8, M14, M19 first
  And each module card shows "why this matters" with a MoRTH data source (for example "Trucks and buses killed 18,556 two-wheeler riders in 2023, RAI23 T4.5")
  And modules for classes without deep content show "learning content coming" (D-05)
```

#### US-051 · Question variants so memorising fails
As Kabir (P-01), I want new versions of the same concept, so that screenshotting answers doesn't help my squad cheat.
`F-20 · Must · M · S3 · — · API-31 · Deep-A`
```gherkin
Scenario: Variant served
  Given I answered concept "sign.no_entry" correctly yesterday
  When it is due again
  Then I get a different variant (different image or wording) of the same concept
  And the answer key is never sent to the client before I answer
```

#### US-052 · Spaced review queue
As Kabir (P-01), I want the app to bring back what I'm forgetting, so that I remember it on test day.
`F-20 · Must · M · S3–S4 · — · API-31, API-32 · Deep-A`
```gherkin
Scenario: FSRS schedule
  When I answer "wrong at 100% confidence"
  Then the card is rated "Again" and logged as an overconfidence event
  And it is due again within the same session window computed by ts-fsrs
```

#### US-053 · Say how sure I am
As Kabir (P-01), I want to rate 50/75/100% before seeing the answer, so that I learn whether my confidence is right.
`F-21 · Must · S · S3 · — · API-32 · Deep-A`
```gherkin
Scenario: Confidence before feedback
  When a practice question appears
  Then I must choose 50%, 75% or 100% sure before the answer is revealed
  And my weekly calibration chart shows stated vs actual in three bins
```

#### US-054 · Readiness score with its parts
As Kabir (P-01), I want to see why my readiness is 78, so that I know what to fix.
`F-21 · Must · M · S3–S6 · — · API-33 · Deep-A`
```gherkin
Scenario: Score decomposed
  Given my weighted topic mastery is 0.84 and my overconfidence penalty is 6
  When I open Readiness
  Then I see "78 = knowledge 84 − calibration 6"
  And a note says "Topic weights are equal because the government topic mix is unknown"
  And the 3 weakest topics are listed with a "Practise" button each
```

#### US-055 · Advisory gate, never a block
As Kabir (P-01), I want to book whenever I choose, so that the app advises but doesn't control me.
`F-21 · Must · S · S3 · — · API-33 · Deep-A`
```gherkin
Scenario: Below 85
  Given my readiness is 62
  Then "Ready to book" is not highlighted
  And a "Book anyway" link is visible with equal-weight text (no confirm-shaming)
```

#### US-056 · LL test simulator in my state's format
As Kabir (P-01), I want a mock with the same timer, count and pass mark as my state's test, so that the real test feels familiar.
`F-22 · Must · M · S3 · EC-10 · API-30 · Deep-A`
```gherkin
Scenario: J&K format from config
  Given rules/JK.json says 10 questions, 6 correct to pass (source: Kashmir Life, secondary)
  When I start the simulator
  Then I get 10 questions with the configured timer and the pass mark 6
  And the source and confidence chip are shown on the start screen

Scenario: Unknown format
  Given a tenant has no verified format
  Then the simulator uses "15 questions, 9 to pass (common default, unverified)" with an amber label
```

#### US-057 · Guided first run of the simulator
As Mohan-ji (P-03), I want the screen explained the first time, so that the timer and buttons don't panic me.
`F-22 · Must · S · S3 · — · — · Deep-A`
```gherkin
Scenario: Coach marks
  When I start the simulator for the first time
  Then coach marks explain "This is the timer", "This is how you change an answer", "This is how you submit"
  And I can skip them; they never reappear unless I ask
```

#### US-058 · Explain my wrong answer (18+)
As Kabir (P-01), I want to know why my answer was wrong in plain Hinglish, so that I understand the rule.
`F-31 · Should · M · S3–S4 · EC-29 · API-41 · Thin`
```gherkin
Scenario: Tutor from reviewed content
  Given I answered "sign.give_way" wrong
  When I tap "Why?"
  Then the TutorAgent (M-04) explains using only the reviewed explanation for that concept and cites its rule ID
  And if the AI is unavailable, the reviewed explanation text is shown directly (EC-29)
```

#### US-059 · Road Sign Snap
As Kabir (P-01), I want to point my camera at a sign and add it to my deck, so that my commute becomes practice.
`F-27 · Could · M · S3 · — · — · Roadmap (demo optional)`
```gherkin
Scenario: Recognise and confirm
  When I photograph a "No parking" sign
  Then SignSnap (M-07) proposes a sign ID which is confirmed against the sign catalogue
  And if confidence is low it says "Not sure; pick from these 3"
  And the sign is added to my FSRS deck
```

#### US-060 · Offline mock tests
As Rahul (P-07) on a 2G connection, I want mock tests that work offline, so that weak signal doesn't stop me.
`F-51, F-22 · Must · M · S3 · EC-19 · — · Thin`
```gherkin
Scenario: Cached mock
  Given I opened Learn once on Wi-Fi
  When I go offline
  Then a full mock test runs from the service-worker cache
  And for users under 18 results stay on the device only
```

#### US-061 · Hindi question parity
As Mohan-ji (P-03), I want every question in Hindi too, so that I am not tested on translation.
`F-50 · Must · M · S3 · — · API-30 · Deep-A`
```gherkin
Scenario: Parity check
  When the content build runs
  Then every published LL question has reviewed English and Hindi text, or the build fails
```

---

## EP-05 30-day bridge: Nazar and simulations (S4)
**Goal:** turn the silent 30 days into calibrated anticipation (the heart, D-03). Scores are computed by code; Gemini only narrates (D-09, D-11). **PS1 boxes:** 3, 4, 9, 10, 15.

#### US-070 · A day-by-day bridge plan
As Kabir (P-01), I want "DL test unlocks in 12 days" and today's 3-minute plan, so that the wait has a purpose.
`F-09, F-08 · Must · M · S4 · EC-15 · API-14, API-31 · Deep-C`
```gherkin
Scenario: Bridge home
  Given my LL was issued 18 days ago (server time)
  When I open the home
  Then I see "DL test unlocks in 12 days" and a plan of at most 3 items (one Nazar session, one survival game, due reviews)
  And a legal-practice card says "Riding on an LL needs an L-plate and a licensed companion"
```

#### US-071 · Nazar mock in Kerala's announced format (18+)
As Kabir (P-01), I want a 10-clip, 100-mark hazard test, so that I know where I stand against a 60/100 pass mark.
`F-23 · Must (hero) · L · S4 · EC-18, EC-28 · API-37, API-34, API-35 · Deep-B`
```gherkin
Scenario: Mock session
  Given 10 unseen published clips exist for my tenant
  When I start a Nazar mock
  Then the start screen says "Kerala's announced format: 10 clips × 10 marks, pass 60. Practice and familiarisation, not certification."
  And each clip is preloaded in full before it plays
  And I tap anywhere when I see a developing hazard; a flag marks each tap
  And the session score is recomputed by the server from my tap times and the clip windows (API-35)
  And the result shows my score out of 100 against "60 (Kerala's announced pass mark)"

Scenario: Kerala HPT stayed or postponed (EC-28)
  Given the rule-pack flag "kl_hpt_status" is "stayed"
  When I start a mock
  Then the copy changes to "Hazard practice (format based on Kerala's proposal)" and no date claim is shown
```

#### US-072 · Nazar learn mode with prediction
As Kabir (P-01), I want the clip to freeze and ask "what happens next?", so that I learn to anticipate rather than react.
`F-23 · Must · M · S4 · — · API-37 · Deep-B`
```gherkin
Scenario: Occlusion and prediction
  When I play a learn-mode clip
  Then it freezes 0.5 s before hazard onset (game-config, source "design")
  And asks "What happens next?" with 4 picture options from the hazard_type enum, then "Tap where the danger comes from"
  And the answer reveals the curated hazard with a one-line reason
```

#### US-073 · Replay my clip with the hazard band
As Kabir (P-01), I want to see where the hazard began and where I tapped, so that "late" means something concrete.
`F-23, F-25 · Must · S · S4 · — · API-36 · Deep-B`
```gherkin
Scenario: Replay facts from code
  Given hazard onset 4.2 s, my first valid tap 5.6 s and clip speed estimate 40 km/h
  When I open the replay
  Then the scrub bar shows the hazard window as a striped band with my taps marked
  And the fact line reads "1.4 s late ≈ 16 m at 40 km/h", where 1.4 and 16 come from the scoring package
```

#### US-074 · Pattern-clicking scores zero
As a fair player, I want spam-tapping to score nothing, so that the score measures anticipation.
`F-23 · Must · S · S4 · EC-18 · API-35 · Deep-B`
```gherkin
Scenario: Spam taps
  When I tap more than 3 times in any 1.0 s, or more than (2 × hazards + 4) times in a clip
  Then that clip scores 0
  And the debrief says "Tapping a lot scores zero, like the UK test. Tap once when you see it develop."
```

#### US-075 · Buffering never steals my marks
As Tanvi (P-02) on a slow network, I want a clip that buffered to be scored fairly, so that my network isn't my score.
`F-23 · Must · S · S4 · EC-18, EC-19 · API-37 · Deep-B`
```gherkin
Scenario: Score on media time
  Given the clip is fully preloaded before play
  When a stall occurs anyway
  Then taps are timed on video.currentTime (requestVideoFrameCallback), not wall-clock
  And a stall longer than 300 ms or a tab-hidden event voids that clip and offers a replacement
```

#### US-076 · An honest alternative for screen-reader users
As a blind user, I want an accessible hazard lesson, so that I'm not locked out of learning.
`F-23, F-52 · Must · M · S4 · EC-18, EC-13 · — · Thin`
```gherkin
Scenario: Screen-reader alternative
  Given TalkBack is on
  When I open Nazar
  Then I am offered "Audio-described hazard lessons" and a still-frame "which one is the hazard?" mode
  And it is labelled "a substitute, not the same skill"; there is no hard block
```

#### US-077 · Photosensitivity-safe and reduced motion
As a user with photosensitive epilepsy, I want no flashing content, so that the app is safe for me.
`F-24, F-52 · Must · S · S4 · EC-18 · — · Deep-B`
```gherkin
Scenario: Flash limit
  When any clip or game is published
  Then the publishing check confirms no more than 3 flashes per second (WCAG 2.3.1)
  And with prefers-reduced-motion, celebrations and camera shakes are disabled
```

#### US-078 · Stopping Distance game
As Kabir (P-01), I want to guess where I'd stop at 40, 60 and 80 km/h on dry and wet roads, so that I feel how speed changes distance.
`F-24 · Must (deep) · M · S4 · — · API-34, API-35 · Deep-B`
```gherkin
Scenario: Physics-scored guess
  When I place my stop marker for 60 km/h on a wet road
  Then the code computes reaction distance v·t_r plus braking v²/(2µg) with conservative µ
  And the result shows my guess vs the computed distance in metres
  And there is no high-speed trial beyond the configured maximum and no crash imagery
```

#### US-079 · Blind Spot game (truck and bus)
As Kabir (P-01), I want to place my bike around a truck and see where the driver can't see me, so that I stop lingering in the no-zone.
`F-24 · Must (deep) · M · S4 · — · API-34, API-35 · Deep-B`
```gherkin
Scenario: No-zone geometry
  When I drag my 2W beside a truck
  Then zones are computed from vehicle-type geometry and drawn with stripes and an "eye-off" icon (not colour alone)
  And the debrief cites "Trucks and buses killed 18,556 two-wheeler riders in 2023 (RAI23 T4.5)"
```

#### US-080 · Junction Scan game
As Kabir (P-01), I want to practise looking right-left-mirror before entering an uncontrolled junction, so that I build a scanning habit.
`F-24 · Must (deep) · M · S4 · — · API-34, API-35 · Deep-B`
```gherkin
Scenario: Scan-order scoring
  When I enter a T-junction without checking the threat side
  Then finding JS_NO_SCAN_THREAT_SIDE is recorded with side and last_look_s
  And "go fast to beat the gap" is never rewarded; short gaps are penalised (JS_SHORT_GAP)
```

#### US-081 · Track Test Twin
As Mohan-ji (P-03), I want to rehearse the figure-8, reverse parking and gradient start layout, so that the track holds no surprises.
`F-24, F-12 · Must (deep) · L · S4, S6 · — · API-34, API-35 · Deep-B (figure-8)`
```gherkin
Scenario: Layout familiarisation
  When I play the figure-8 on the schematic for my RTO type
  Then path tolerance and timing are scored and "foot down" events are recorded (TT_FOOT_DOWN)
  And the screen says "Layout familiarisation: this does not train balance or clutch control"
  And time limits are shown only where published, with source; otherwise "not published"
```

#### US-082 · Helmet Fit on my phone
As Kabir (P-01), I want my phone to guide a helmet-fit check, so that I wear it properly.
`F-24 · Should · M · S4 · — · — · Thin`
```gherkin
Scenario: On-device check
  When I start Helmet Fit
  Then MediaPipe runs on the device to guide framing, then a checklist covers ISI mark, two-finger strap and no rocking
  And no camera frame leaves the device
```

#### US-083 · Golden Hour decisions (static)
As Kabir (P-01), I want to practise what to do at a crash scene, so that I help without causing harm.
`F-24, F-15 · Should · M · S4, S8 · — · — · Thin (draft until medical review)`
```gherkin
Scenario: Static, cited, no AI
  When I play Golden Hour
  Then every step comes from a cited medical source shown on screen and no generative AI is involved
  And the first action is a one-tap 112 call card and the "you are protected under s.134A" card
  And the module shows "Draft: pending medical review" until ff_golden_hour_reviewed is true
```

#### US-084 · Night & Glare
As Kabir (P-01), I want to practise dipping my beam and handling glare, so that night riding is less risky.
`F-24 · Should · M · S4 · — · API-34 · Roadmap (storyboard in demo)`
```gherkin
Scenario: Dipping rule
  When an oncoming vehicle is within the configured distance and I keep high beam
  Then finding NG_HIGH_BEAM_ONCOMING is recorded with dist_m
```

#### US-085 · Hill Road (J&K)
As a J&K rider, I want to practise uphill priority and blind bends, so that NH44 hill stretches are familiar.
`F-24 · Should · M · S4 · — · API-34 · Roadmap (storyboard in demo)`
```gherkin
Scenario: Unverified rule is not cited by AI
  Given rule "uphill_priority" has verified=false
  When I fail to yield uphill
  Then HR_NO_YIELD_UPHILL is recorded but the AI debrief does not cite the rule; the template shows "rule being verified"
```

#### US-086 · Commentary: say what I see, then get scored (18+)
As Kabir (P-01), I want to narrate a clip aloud and see which hazards I named, so that I learn to scan out loud.
`F-25, F-23 · Must · M · S4 · EC-20, EC-29 · API-34, API-36 · Deep-B (one clip)`
```gherkin
Scenario: Record then score
  When I record my commentary over a clip
  Then the audio is transcribed (Gemini, or Sarvam Saaras for Dogri) and the transcript is matched deterministically to the clip's annotated hazard list
  And the debrief lists hazards named, missed and named late, with numbers from the matcher
  And the audio is discarded after transcription unless I opt in to keep it for 30 days
```

#### US-087 · My Practice Record
As Kabir (P-01), I want a record of my practice hours, Nazar score and modules, so that I can show my school or parents.
`F-28 · Should · M · S4–S7 · — · API-46 · Thin`
```gherkin
Scenario: Export
  When I open Practice Record
  Then I see sessions, hours, Nazar Score, modules done and supervisor sign-offs as a separate attributed field
  And the PDF/JSON export is signed by Margdarshak only for what happened in the app
  And the words "verified", "certified" and "licensed" do not appear
```

#### US-088 · Check a Practice Record by QR
As a driving-school owner (P-05), I want to scan a learner's QR to see their record, so that I know where to start lessons.
`F-28 · Should · S · S4–S7 · — · API-47 · Thin`
```gherkin
Scenario: Token verify
  When I scan the QR
  Then API-47 returns the signed record summary for that token, if the learner hasn't revoked it
  And no contact or identity data is included
```

#### US-089 · Curator ingests a new clip
As a curator, I want to upload raw footage and have it transcoded and blurred automatically, so that clips are safe to publish.
`F-23 · Must · L · Content · — · API-55 · Deep-B (headline Render Workflow)`
```gherkin
Scenario: Clip pipeline on Render Workflows
  When I upload a raw clip
  Then a durable workflow runs transcode → blur faces/plates → proposeWindows (Gemini video, offline) → awaitTwoRaters → computeAgreement → publish
  And a failed step retries per policy and the retry is visible on the Workflows run page
  And nothing is published before a 100% blur audit passes (US-091)
```

#### US-090 · Two raters set the hazard window
As a curator, I want two people to set onsets independently, so that the window isn't one person's opinion.
`F-23 · Must · M · Content · — · API-55 · Deep-B`
```gherkin
Scenario: Agreement gate
  Given rater A sets onset 4.1 s and rater B sets 4.4 s
  Then the final onset is their mean 4.25 s and |Δ| = 0.3 s is stored (E-21)
  And a clip with |Δ| > 1.0 s goes back for adjudication and is not published
  And AI-proposed windows are shown only as a suggestion layer
```

#### US-091 · Blur audit before publish
As a bystander filmed on a public road, I want my face and number plate blurred, so that my privacy is protected.
`F-23 · Must · M · Content · — · API-55 · Deep-B`
```gherkin
Scenario: 100% audit
  When a clip reaches publish
  Then a human has checked every frame range flagged by the detector and signed off
  And raw footage is deleted after the blur check
  And the clip carries licence CC-BY 4.0 metadata
```

#### US-092 · The server's score wins
As a fair player, I want the server to replay every session, so that edited client scores never reach share cards.
`F-24, F-26 · Must · M · S3–S8 · — · API-35 · Deep-B`
```gherkin
Scenario: Replay mismatch
  Given the client reports 92 and the server replay computes 71
  Then the stored score is 71, an integrity flag is logged, and the UI says "this session wasn't counted for your card"
  And the user is never accused of cheating
```

---

## EP-06 AI assistance (cross-cutting, 18+)
**Goal:** AI that helps without inventing facts. Code computes numbers; Gemini narrates from allowlists (D-09, D-10). **PS1 box:** 12.

#### US-100 · A debrief after every session (18+)
As Kabir (P-01), I want "how you did, where you lacked, what you could have done, your next drill", so that every session ends with a plan.
`F-25 · Must · M · S3–S8 · EC-29 · API-36 · Deep-B`
```gherkin
Scenario: Four-part debrief
  When a game session completes
  Then the debrief shows 4 parts in this order: how you did, where you lacked, what you could have done, your next drill
  And the template version appears immediately and the AI narration replaces it when ready (p95 ≤ 4 s)
```

#### US-101 · Numbers only from code
As Dr Sambyal (judge persona), I want to know every number in the debrief came from a tool, so that the AI can't invent facts.
`F-25 · Must · M · S3–S8 · — · API-36 · Deep-B`
```gherkin
Scenario: Provenance validator
  Given the DebriefAgent (M-02) output contains a digit that is not in the findings JSON
  Then the validator rejects the narration and the template is shown
  And the rejection is counted in the eval and alert metrics
  And the model only chooses finding IDs, rule IDs and drill IDs from per-request allowlists
```

#### US-102 · Template fallback when AI is down
As any user, I want a useful debrief even when the AI fails, so that the app never breaks.
`F-25 · Must · S · S3–S8 · EC-29 · API-36 · Deep-B`
```gherkin
Scenario: AI unavailable
  Given Gemini returns 429 or times out after 3 s
  Then the deterministic template debrief is shown with the same facts
  And no error message blames the user
```

#### US-103 · Minors get the template only
As Rahul (P-07), I want feedback on my practice, so that I learn, without my data going to an AI.
`F-25 · Must · S · S3–S4 · EC-05 · — · Thin`
```gherkin
Scenario: Under-18 debrief
  Given my age band is under 18
  When I finish a static lesson quiz
  Then a template debrief is rendered on the device and nothing is sent to any AI or analytics endpoint
```

#### US-104 · Voice guide navigates and fills fields (18+)
As Mohan-ji (P-03), I want to say what I need and have the app take me there and fill fields, so that I can use it without reading much.
`F-30 · Must · L · Cross · EC-20 · API-40 · Deep-C (scripted Hindi flow live)`
```gherkin
Scenario: Closed action set
  When I say "mujhe apna licence renew karna hai"
  Then the VoiceGuideAgent (M-01) picks an action from the closed enum {navigate, fill_field, read_screen, explain_rule, open_help}
  And it navigates to Renew / fix and asks for my DL expiry date
```

#### US-105 · The voice guide refuses to submit, pay or book
As P-06 (state), I want the AI never to act on Sarathi, so that no unauthorised transaction happens.
`F-30 · Must · S · Cross · — · API-40 · Deep-C`
```gherkin
Scenario: Refusal
  When I say "mera slot book kar do"
  Then the guide says "I can't book, pay or submit. I can open the slot page and remind you."
  And there is no "book", "pay" or "submit" value in its action enum
```

#### US-106 · Every AI answer shows its rule source
As Tanvi (P-02), I want each AI answer to show where it came from, so that I can trust or check it.
`F-30, F-31 · Must · S · Cross · — · API-40, API-41 · Deep-C`
```gherkin
Scenario: Rule-ID chip
  When the guide answers "Form 1A is needed at 40+"
  Then a chip shows rule ID, source and verified_on date
  And if no verified rule exists, the guide answers "I don't know that for your RTO yet"
```

#### US-107 · Speak in Dogri
As Mohan-ji (P-03), I want to speak in Dogri, so that I can use the language I think in.
`F-30, F-50 · Must · M · Cross · — · API-40 · Thin`
```gherkin
Scenario: Dogri speech in
  When I speak in Dogri
  Then Sarvam Saaras (M-08) transcribes it and the guide responds in Hindi text and voice
  And the UI never claims Dogri text support beyond voice input (D-21)
```

#### US-108 · My Aadhaar number or OTP never reaches the AI
As any user, I want anything that looks like an Aadhaar number or OTP removed before it is sent, so that I can't leak it by mistake.
`F-30, F-54 · Must · S · Cross · EC-20 · API-40, API-41, API-42 · Deep-C`
```gherkin
Scenario: Client-side redaction
  When I type "my aadhaar is 1234 5678 9012 and otp 482913"
  Then the client replaces them with "[removed]" before sending
  And the ADK PII plugin redacts any remaining pattern server-side
  And the guide says "Never share your Aadhaar number or OTP with anyone, including us"
```

#### US-109 · Decode a Sarathi screenshot (18+)
As Kabir (P-01), I want to upload a screenshot of a confusing status, so that I learn what it means and what to do.
`F-32 · Should · M · S2–S7 · EC-20 · API-42 · Thin`
```gherkin
Scenario: Known status
  When I upload a screenshot showing "SCRUTINY"
  Then ScreenDecoderAgent (M-05) matches it to the verified error catalogue entry "scrutiny" and shows its meaning and next step
  And personal fields visible in the image are masked on the device before upload where detectable
```

#### US-110 · The decoder may say "unknown"
As Tanvi (P-02), I want the decoder to admit when it doesn't know, so that I'm not misled.
`F-32 · Should · S · S2–S7 · — · API-42 · Thin`
```gherkin
Scenario: No catalogue match
  When the screenshot doesn't match any catalogue entry above the threshold
  Then the answer is "We don't recognise this screen yet" with a link to the state helpline and an option to submit it for the catalogue (with consent)
```

#### US-111 · Is this message real?
As Mohan-ji (P-03), I want to paste a challan SMS or link, so that I know whether it's a scam before clicking.
`F-33 · Should · M · S8 · — · API-43 · Thin`
```gherkin
Scenario: Rules decide, AI explains
  When I paste a message with a link ending ".apk"
  Then the verdict is "Do not open. Government services never send APK files." decided by rules
  And the AI (if 18+) only explains the red flags
  And no verdict ever says "safe"; the best verdict is "Sender and domain match the allowlist; still check on the government site yourself"
```

#### US-112 · My weekly coach plan (18+)
As Kabir (P-01), I want a short weekly plan, so that I know which 4 sessions to do.
`F-25 · Must · S · S3–S5 · — · — · Thin`
```gherkin
Scenario: Coach wording only
  Given FSRS and the staircase computed my plan in code
  When CoachAgent (M-03) writes the message
  Then the message contains no digits from the model and is validated like the debrief
  And it offers implementation-intention buttons "Mon 7 pm / Tue 7 pm / Pick a time"
```

#### US-113 · AI only after verified 18+
As P-06 (state) and a parent, I want AI features locked behind a verified adult age, so that minors never reach Gemini.
`F-54 · Must · S · Cross · EC-05 · API-40–API-43 · Deep-C`
```gherkin
Scenario: Server-side gate
  Given my account has no verified DOB ≥ 18
  When any AI endpoint is called
  Then it returns 403 age_gate and the UI hides AI entry points
```

#### US-114 · "AI can't book, pay or submit" on every AI surface
As any user, I want a plain reminder of what the AI can't do, so that I don't expect it to.
`F-30 · Must · S · Cross · — · — · Deep-C`
```gherkin
Scenario: Boundary line
  When any AI panel opens
  Then it shows "AI can't book, pay or submit. It can guide, explain and fill fields here."
```

---

## EP-07 Gamification (S3–S8)
**Goal:** mechanics as vehicles for retrieval, spacing, feedback and calibration; status from anticipation, never speed; stake-free (Online Gaming Act 2025; CCPA 2023). **PS1 boxes:** 9, 10.

#### US-120 · XP for learning only
As Kabir (P-01), I want XP that reflects real practice, so that grinding doesn't pay.
`F-26 · Must · S · S3–S8 · — · API-38 · Deep-B`
```gherkin
Scenario: Diminishing XP
  Given I played 50 minutes today
  When I finish a mock
  Then XP = base × quality × 0.5 (after 45 min), ×0.2 after 90 min
  And opening the app, sharing or inviting earns no XP
```

#### US-121 · Ranks gated by mastery
As Kabir (P-01), I want ranks that mean something, so that "Highway" says I know highway skills.
`F-26 · Must · S · S3–S8 · — · API-38 · Thin`
```gherkin
Scenario: XP alone can't buy a rank
  Given I have enough XP for "Highway" but M4 is "locked"
  Then my rank stays "Shehar" and the card shows "Unlock: No-zone (M4)"
```

#### US-122 · Weekly streak that forgives
As Kabir (P-01), I want a weekly goal with freeze tokens, so that one bad week doesn't make me quit.
`F-26 · Must · S · S3–S6 · — · API-38 · Thin`
```gherkin
Scenario: Silent on break
  Given I missed my weekly goal and have no freeze token
  When the new week starts
  Then the home shows "New week: 0/4" with no sad emoji and no push notification
  And the streak ends and is archived on DL test day
```

#### US-123 · Create or join a squad (18+)
As Kabir (P-01), I want a 3–5 friend squad, so that we prepare together.
`F-26 · Must · S · S4 · — · API-39 · Thin`
```gherkin
Scenario: Invite-only squad
  When I create a squad and share the invite link
  Then friends join by link; squads have 3–5 members
  And under-18 users cannot create or join squads (D-13)
  And the squad score is the mean of (Nazar Score × (1 − Brier))
```

#### US-124 · Duel on the same clips
As Kabir (P-01), I want to challenge a friend on the same 10 clips, so that the comparison is fair.
`F-26 · Should · M · S4 · — · API-34 · Roadmap`
```gherkin
Scenario: Same seed
  When I send a duel
  Then both players get the same seed and clips, played live
  And the result shows anticipation and calibration, not raw reaction speed
```

#### US-125 · Badges with criteria shown up front
As Kabir (P-01), I want to see what a badge needs before I start, so that there's no bait and switch.
`F-26 · Must · S · S3–S8 · — · API-38 · Thin`
```gherkin
Scenario: Nine badges
  When I open Badges
  Then 9 badges are listed with their deterministic criteria: Khud Licence, Pehli Baar Pass, Nazar 90, Calibrated, No-Zone Navigator, Strap Streak, Night Ready / Ghat Ready, Rah-Veer Ready, Squad Sangathan
```

#### US-126 · "Khud Licence" as my word
As Kabir (P-01), I want to declare I got my licence without an agent, so that I can be proud of it honestly.
`F-26 · Must · S · S7 · — · API-15, API-38 · Thin`
```gherkin
Scenario: Honour-framed
  When I declare "I got my DL without an agent" and enter the issue date
  Then the badge reads "Khud Licence: self-declared"
  And it is never described as a government verification
```

#### US-127 · Share card on Margdarshak's own domain
As Kabir (P-01), I want a card for WhatsApp/Instagram, so that I can flex anticipation, not speed.
`F-26 · Must · M · S4–S8 · — · API-38 · Deep-B`
```gherkin
Scenario: Safe share
  When I share my Nazar card
  Then it links to margdarshak.<domain>/c/{shortId} with no APK or install bait
  And it shows my chosen name or initials, Nazar Score, "verified sessions: n", one badge and "Challenge me on the same 10 clips"
  And a percentile appears only after ≥ 200 verified mocks exist in the baseline
```

#### US-128 · Dark-pattern lint
As P-06 (state) and the CCPA, I want the 13 dark patterns blocked in CI, so that the app never manipulates users.
`F-26 · Must · M · Cross · — · — · Deep-C`
```gherkin
Scenario: CI rule
  When a PR adds a countdown not backed by a rules-engine date, a pre-ticked consent, or a decline button with shaming copy
  Then the design-lint job fails with the matching CCPA pattern name
```

#### US-129 · Low-trust sessions don't count for cards
As a fair player, I want suspicious sessions excluded from cards without accusations, so that cards stay meaningful.
`F-26 · Must · S · S4 · EC-18 · API-35 · Deep-B`
```gherkin
Scenario: Trust below 0.6
  Given my session trust is 0.5 (tab hidden twice)
  Then it counts for practice and FSRS, not for the share card or percentiles
  And the copy says "this session wasn't counted for your card"
```

---

## EP-08 Book the DL test and RTO Live Intel (S5)
**Goal:** honest slot help (reminders, never bots, D-08) and structured local truth (D-14). **PS1 boxes:** 6, 8, 14.

#### US-140 · Day-25 "book now" nudge
As Kabir (P-01), I want a reminder to book on day 25, so that I get a slot near day 31.
`F-09 · Must · S · S4–S5 · EC-30 · API-65 · Deep-C`
```gherkin
Scenario: Journey sweeper
  Given my LL was issued 25 days ago and I opted in to WhatsApp reminders
  When the n8n Schedule trigger calls API-65 at 06:30 IST
  Then the Render Workflow sweep computes my milestone and queues it, and the backend notifier sends the approved template "Book your driving test: it unlocks on <date>"
  And at most 1 nudge is sent to me that day
```

#### US-141 · Offices on a map and calendar
As Tanvi (P-02), I want RTOs and accredited centres near me with distance, so that I can choose where to test.
`F-10 · Must · M · S5 · — · API-25, API-26 · Thin`
```gherkin
Scenario: Office list
  When I open "Book driving test"
  Then I see offices of type RTO/ARTO/accredited centre/CSC with distance from the district I chose (no GPS required)
  And slot availability from the mock SlotAdapter is labelled "simulated"
  And "Book on Sarathi" opens the government site
```

#### US-142 · Tell me if an earlier slot opens
As Kabir (P-01), I want to watch for earlier slots, so that I don't miss one.
`F-10 · Must · S · S5 · — · API-27 · Thin`
```gherkin
Scenario: Honest watcher
  When I create a slot watch for ARTO Jammu
  Then I am told "We can't see Sarathi slots. We'll alert you when other users report slots opening, and remind you to check."
  And alerts come only from moderated Live Intel reports with timestamps (fired by the backend when a "slots opened" report is published)
```

#### US-143 · LL expiry collision warning
As Kabir (P-01), I want to be warned if my LL could expire before I pass, so that I act early.
`F-09 · Must · M · S5–S6F · EC-07 · API-14 · Deep-C`
```gherkin
Scenario: Collision
  Given my LL expires in 20 days and the reported slot lead time is 14 days and the retest gap is 7 days
  When the clock evaluates expiry − today < 2 × (slot lead + retest gap)
  Then a red-amber banner says "Your LL may expire before a retest. Book the earliest slot now."
  And it explains "Renewing an expired LL can create a new application number, which can break an existing slot booking"
```

#### US-144 · Accredited centre option
As Mohan-ji (P-03), I want to know if an accredited centre near me waives the RTO test, so that I can consider it.
`F-10 · Must · S · S5 · — · API-25 · Thin`
```gherkin
Scenario: ADTC row
  When an accredited driver training centre (ADTC) is listed in my district
  Then it shows "Graduates of an accredited course skip the RTO driving test (MV Act s.12, 2019)" with source
  And if none is known, it says "None known in your district yet"
```

#### US-145 · Read RTO Live Intel
As Tanvi (P-02), I want to know what people were actually asked at my RTO, so that I bring the right papers.
`F-11 · Should · M · S5–S6 · EC-24 · API-29 · Thin`
```gherkin
Scenario: k-threshold
  Given ARTO Jammu has 7 reports of "documents asked" in the last 30 days and 3 reports of "track type"
  When I open Live Intel
  Then "documents asked" is shown with n = 7 and "track type" shows "Not enough reports yet (need 5)"
  And seeded rows carry a "sample data" chip
  And no names of officials, examiners or agents appear anywhere
```

#### US-146 · Submit a structured report
As Kabir (P-01), I want to report what happened after my visit in a few taps, so that the next person benefits.
`F-11 · Should · S · S5–S6 · — · API-28 · Thin`
```gherkin
Scenario: Fields only
  When I submit a report
  Then I can only choose from structured fields: slot-release time seen, documents asked, track type, wait time
  And there is no free-text box
```

#### US-147 · Report a fake slot or a "setting" offer
As Kabir (P-01), I want to flag that someone offered "setting", so that others are warned without naming anyone.
`F-11 · Should · S · S5–S6 · EC-24 · API-28 · Thin`
```gherkin
Scenario: Route to the right authority
  When I choose "Someone offered to arrange a pass for money"
  Then the report is counted as an aggregate "setting offers reported" field (no names)
  And I am shown links to the state Anti-Corruption Bureau / vigilance and CPGRAMS; Margdarshak does not host the allegation
```

#### US-148 · Moderate reports
As a moderator, I want risky reports queued for review, so that nothing defamatory or personal is published.
`F-11 · Should · M · Ops · — · API-66 · Thin`
```gherkin
Scenario: n8n W9 moderation
  When a report arrives
  Then the backend precheck strips PII patterns and flags duplicates
  And low-risk reports with ≥ 3 corroborations in 24 h auto-publish; others go to a moderator "Send and wait" in n8n
  And the grievance officer contact is in the footer (IT Rules 2021)
```

#### US-149 · Record that I booked a slot
As Kabir (P-01), I want to record my slot date, so that I get test-eve help.
`F-08 · Must · S · S5 · — · API-15 · Deep-C`
```gherkin
Scenario: slot_booked event
  When I enter my slot date and office
  Then event slot_booked is recorded idempotently and the test-eve reminder (TimelineEvent `test_eve`, `send_after` 19:00 IST) is scheduled for the day before
```

---

## EP-09 Driving test, fail and recover (S6, S6F)
**Goal:** demystify the track; fail kindly and privately; replan instantly. **PS1 boxes:** 4, 6, 10, 14, 15.

#### US-160 · Animated track explainer
As Kabir (P-01), I want to see the figure-8, reverse parking and gradient start animated, so that I know what is checked.
`F-12 · Must · M · S6 · — · — · Thin`
```gherkin
Scenario: Explainer per RTO type
  When I open the track explainer for "automated track (ADTT)"
  Then a Rive animation shows each element, what is checked and common fail reasons with sources
  And parameters not published for my RTO show "not published"
```

#### US-161 · What to bring tomorrow
As Tanvi (P-02), I want a checklist the evening before, so that I don't get turned away.
`F-12, F-09 · Must · S · S6 · — · API-14 · Deep-C`
```gherkin
Scenario: Test-eve message
  Given my slot is tomorrow
  When the test-eve TimelineEvent's send time (19:00 IST) arrives
  Then the backend notifier sends me a template with: LL, vehicle RC, insurance, PUC, L-plate, helmet, and an ICS calendar file
```

#### US-162 · Test-day co-pilot
As Mohan-ji (P-03), I want the counter steps and a QR summary on test day, so that I don't get lost at the RTO.
`F-12 · Must · S · S6 · — · API-11 · Thin`
```gherkin
Scenario: Co-pilot
  When I open the co-pilot on test day
  Then I see counter steps for my office (or "ask at reception" if unknown), a papers check and a "show at counter" QR containing only my plan summary (no identifiers)
```

#### US-163 · A vehicle for the test
As Tanvi (P-02), I want a borrowed-vehicle checklist and a list of places that offer one, so that I can test without owning a scooter.
`F-12 · Must · S · S6 · — · API-50 · Thin`
```gherkin
Scenario: Checklist and listing
  When I choose "I don't have a vehicle"
  Then I see the checklist (valid RC, insurance, PUC, L-plate, helmet, owner consent note)
  And a list of schools/ADTCs that offer a test-day vehicle, seeded rows labelled "sample", with no booking or payment and no AI-generated prices
```

#### US-164 · Two-minute calm-down
As Kabir (P-01), I want a breathing guide before my turn, so that nerves don't make me fail.
`F-12 · Must · S · S6 · — · — · Thin`
```gherkin
Scenario: Calm-down
  When I tap "Calm down" on test day
  Then a 2-minute guided routine plays with visual and haptic cues (no audio required)
```

#### US-166 · Record my test result
As Kabir (P-01), I want to record pass or fail with the reason I was given, so that the app replans.
`F-08 · Must · S · S6 · — · API-15 · Deep-C`
```gherkin
Scenario: test_failed with reason code
  When I record "failed" and pick the reason "time out" from the reason list
  Then event test_failed with reason_code "TIME_OUT" is stored (E-11) and S6F starts
```

#### US-167 · Private fail debrief
As Kabir (P-01), I want a private, kind debrief after a fail, so that I recover without shame.
`F-13 · Must · M · S6F · — · API-36 · Deep-C (thin content)`
```gherkin
Scenario: Face-saving
  When I record a fail
  Then nothing is posted to my squad and no badge or streak reacts
  And notification previews contain no outcome words ("Your next plan is ready")
  And the debrief shows what to practise, one drill, and the retest plan on the same screen
```

#### US-168 · Retest plan with the 7-day gap and remedial training
As Kabir (P-01), I want my earliest retest date and the training I need, so that I rebook correctly.
`F-13 · Must · M · S6F · EC-08 · API-14 · Thin`
```gherkin
Scenario: Retest
  Given I failed on 2026-11-12
  Then the earliest retest date is computed from the rule pack's retest gap (7 days, flagged "verify")
  And a remedial-training note cites the 2019 s.9(5) proviso with a list of schools (fail follow-up TimelineEvent, sent by the notifier)
  And "Book retest on Sarathi" is on the same screen
```

#### US-169 · Will my LL expire before the retest?
As Kabir (P-01), I want an LL-expiry check right after a fail, so that I don't lose the LL.
`F-13 · Must · S · S6F · EC-07 · API-14 · Thin`
```gherkin
Scenario: Expiry before retest
  Given my LL expires on 2026-11-16 and my earliest retest is 2026-11-19
  Then the plan says "Your LL expires before the earliest retest" and lists options with their costs from fees.json
```

#### US-170 · Ask for my test record (RTI template)
As Kabir (P-01), I want a ready RTI application for my test record, so that I can understand an opaque fail.
`F-13 · Must · S · S6F · — · API-45 · Thin`
```gherkin
Scenario: Template only
  When I tap "Ask for my test record"
  Then an RTI Act 2005 s.6 application to the RTO's PIO is generated with my entered facts (fee ₹10, reply in 30 days)
  And it says "A video may not exist; ask for the result sheet and any recording"
  And Margdarshak never files it for me
```

#### US-171 · Three or more fails
As Kabir (P-01), I want extra support after repeated fails, so that I don't give up or go to an agent.
`F-13 · Must · S · S6F · EC-08 · — · Thin`
```gherkin
Scenario: Third fail
  Given I have 3 recorded fails
  Then the plan suggests a structured lesson block at a school, Track Test Twin drills on my reason codes, and the RTI template
  And it shows a support line: "Failing more than once is common. You haven't done anything wrong by trying."
  And no streak, rank or badge reacts negatively
```

#### US-172 · One class passed, another failed
As Kabir (P-01), I want classes tracked separately, so that a car fail doesn't hide my bike pass.
`F-13, F-08 · Must · S · S6–S7 · — · API-15 · Thin`
```gherkin
Scenario: Split result
  When I record MCWG passed and LMV-NT failed
  Then MCWG moves to S7 tracking and LMV-NT moves to S6F with its own retest plan
```

---

## EP-10 Licence issued (S7)
**PS1 boxes:** 6, 14.

#### US-180 · Approval tracker
As Kabir (P-01), I want to track approval, printing and dispatch, so that I know when my card arrives.
`F-14 · Should · S · S7 · — · API-14, API-15 · Thin`
```gherkin
Scenario: Parcel-style stages
  When my status is "passed"
  Then the tracker shows Passed → Approved → Printed → Dispatched → Received, each updated by events I record (or the adapter in Mode B)
```

#### US-181 · Passed but no SMS in 3 days
As Kabir (P-01), I want to know what to do if nothing happens after passing, so that I don't get fined meanwhile.
`F-14 · Should · S · S7 · EC-23 · API-14 · Thin`
```gherkin
Scenario: No SMS
  Given I passed 3 days ago and recorded no "approved" event
  Then I see "Check status on Sarathi; carry proof of passing; the state's grievance route is …"
  And a note: "Driving without a licence carries a ₹5,000 penalty (s.181)" with source
```

#### US-182 · Escalation letter I approve and send
As Tanvi (P-02), I want a factual letter when approval stalls, so that I can escalate without a lawyer or agent.
`F-14 · Should · M · S7 · — · API-45 · Thin`
```gherkin
Scenario: Human-approved letter (backend letter flow)
  Given my case has been at "Approval of DL" for more than the configured days
  When I open the drafted letter
  Then it contains only facts I entered and the rule-pack timeline (or "no notified timeline found")
  And it is sent only after I tap "Approve" and only to me by email, with optional CC to the published RTO grievance address
  And Margdarshak never files on CPGRAMS for me
```

#### US-183 · DigiLocker pointer
As Kabir (P-01), I want to know how to get my DL into DigiLocker, so that I can show it to police.
`F-14 · Should · S · S7 · — · — · Thin`
```gherkin
Scenario: Pointer, not integration
  When my DL is approved
  Then I see steps to pull the DL into DigiLocker myself, labelled "opens DigiLocker"
  And in mock mode a DigiLocker consent screen demonstrates purpose, documents and validity, labelled "simulated"
```

#### US-184 · Card received
As Kabir (P-01), I want to close my case when the card arrives, so that the app moves to new-rider mode.
`F-14 · Should · S · S7 · — · API-15 · Thin`
```gherkin
Scenario: card_received
  When I record card_received
  Then my case moves to S8 and the bridge streak is archived
```

#### US-185 · The Khud prompt
As Kabir (P-01), I want to be asked whether I did it without an agent, so that I can claim the badge and count toward the north star.
`F-26 · Must · S · S7 · — · API-15 · Thin`
```gherkin
Scenario: Self-declaration
  When my DL is recorded as issued
  Then a neutral question asks "Did you use an agent at any step?" with "No", "Yes", "Prefer not to say"
  And all three answers are equally styled; only "No" offers the Khud badge
```

---

## EP-11 New-rider year (S8)
**Goal:** the highest-risk months, voluntary and thin; never encourage phone use while riding. **PS1 boxes:** 3, 14.

#### US-190 · Voluntary novice pledge
As Kabir (P-01), I want to take a self-declared novice pledge, so that I commit to safer habits for a year.
`F-15 · Should · S · S8 · — · — · Thin`
```gherkin
Scenario: Pledge
  When I take the Nazar Pledge
  Then it lists helmet always, no phone while riding, no triple riding, and is marked "self-declared"
```

#### US-191 · Monthly hazard refresher
As Kabir (P-01), I want a 2-minute monthly refresher, so that my skill doesn't decay.
`F-15 · Should · S · S8 · — · API-37 · Thin`
```gherkin
Scenario: Refresher
  When the month's refresher is due
  Then one notification (opt-in) offers 3 new clips; no streak pressure applies after the DL
```

#### US-192 · First night and highway missions
As Kabir (P-01), I want guided "first time" missions, so that I prepare before my first night or highway ride.
`F-15 · Should · S · S8 · — · — · Thin`
```gherkin
Scenario: Mission card
  When I open "First highway ride"
  Then I get a pre-ride checklist (T-CLOCS), M7 and M22 refreshers and a "plan your breaks" card; no GPS tracking
```

#### US-193 · First-vehicle checklist
As Mohan-ji (P-03), I want a checklist for buying Kabir's first bike, so that we choose a safer one.
`F-15 · Should · S · S8 · — · — · Thin`
```gherkin
Scenario: Checklist without prices
  When I open "Buying a first vehicle"
  Then I see ABS/CBS, Bharat NCAP (cars), ISI helmet, third-party insurance plus the owner-driver PA cover amount from the rule pack, PUC and RC check
  And no AI-generated prices or model recommendations appear
```

#### US-194 · Challan check and scam shield
As Mohan-ji (P-03), I want a safe way to check challans and spot fakes, so that I'm not tricked.
`F-15, F-33 · Should · S · S8 · — · API-43 · Thin`
```gherkin
Scenario: Link and shield
  When I open "Check challans"
  Then a link opens the government e-challan site in a new tab
  And a card explains "Genuine challan numbers have 19 digits (reported); fake APK messages have been reported with 14" with sources, and "Never install APKs"
```

#### US-195 · Golden-hour card works offline
As Kabir (P-01), I want the golden-hour card offline, so that I can help at a crash without signal.
`F-15 · Should · S · S8 · — · — · Thin`
```gherkin
Scenario: Offline card
  Given I am offline
  When I open the golden-hour card
  Then 112 call, s.134A protection, 4 cited do/don't steps and "don't move the neck" are shown, with "not medical training"
```

#### US-196 · Riding lock
As P-06 (state) and Kabir's parents, I want the app to refuse use while riding, so that it never encourages phone use on the move.
`F-15 · Should · S · S8 · — · — · Thin`
```gherkin
Scenario: Moving > 10 km/h
  Given device motion indicates speed above 10 km/h (only if the user granted motion permission)
  Then the app shows only "Pull over to use Margdarshak"
  And no location is stored or sent
```

#### US-197 · Pillion pledge
As Kabir (P-01), I want my most frequent pillion to sign a pact with me, so that we keep each other safe.
`F-15, F-26 · Could · S · S8 · — · API-39 · Roadmap`
```gherkin
Scenario: Pact
  When I invite my pillion
  Then we both agree to 3 lines (helmets for both, no phone, "slow kar" allowed) and my squad sees the pact
```

---

## EP-12 Renew, fix, family and helper (S9 and cross-cutting)
**PS1 boxes:** 1, 13, 14.

#### US-200 · Renewal reminder with no grace period
As Mohan-ji (P-03), I want reminders before my DL expires and the truth about the grace period, so that I never drive illegally.
`F-16 · Should (surface) · S · S9 · EC-16 · API-14 · Thin`
```gherkin
Scenario: No grace
  Given my DL expires on 2027-03-12
  Then reminders are scheduled at T-365, T-60 and T-7
  And the copy says "There is no grace period: from 2027-03-13 you can't legally drive until you renew (MV Act s.14 as amended 2019)"
```

#### US-201 · Expired more than a year ago
As Mohan-ji (P-03), I want to know I need a test again, so that I plan for it.
`F-16 · Should · S · S9 · EC-16 · API-13 · Thin`
```gherkin
Scenario: Late renewal
  Given my DL expired 14 months ago
  Then the plan says "Renewal more than 1 year after expiry requires the driving test again" and adds Form 1A for age 40+
  And late-fee amounts are shown only if present in the rule pack; otherwise "check on Sarathi"
```

#### US-202 · Add a class
As Kabir (P-01), I want to add a car to my bike licence, so that I reuse my case.
`F-16 · Should · S · S9 · EC-21 · API-10 · Thin`
```gherkin
Scenario: New case type
  When I choose "Add a class"
  Then a case of type "add_class" starts at S1 with my existing DL facts (validity only, no number)
```

#### US-203 · Address change or duplicate
As Tanvi (P-02), I want guidance to change my DL address after moving, so that I don't need an agent.
`F-16 · Should · S · S9 · EC-12 · API-10 · Thin`
```gherkin
Scenario: Surface flow
  When I choose "Change address"
  Then I see the documents, steps and a hand-off to Sarathi's service, with the scrutiny-delay warning
```

#### US-204 · International Driving Permit
As a student going abroad, I want IDP steps, so that I apply in time.
`F-16 · Should · S · S9 · EC-12 · API-02 · Thin`
```gherkin
Scenario: DL holders only
  Given I hold a DL
  Then "IDP" appears in Renew / fix with requirements (valid DL, passport, visa) marked with confidence
  And it never appears to someone without a DL
```

#### US-205 · Manage my parent's case
As Kabir (P-01), I want to manage my father's renewal from my account, so that he doesn't have to use the app alone.
`F-17 · Should · M · S9 · — · API-10 · Thin`
```gherkin
Scenario: Family mode
  When I add "Papa" as a family case
  Then a separate case is created whose data is visible only to me and to him if he logs in
  And reminders for his DL, RC, insurance and PUC dates are available
```

#### US-206 · Helper link with recorded consent
As the Helper (P-04), I want the applicant to grant me access with recorded consent, so that I can help legitimately.
`F-17 · Should · M · Cross · EC-14 · API-60 · Thin`
```gherkin
Scenario: Consent artefact
  When the applicant scans my helper QR and approves "Arjun may fill my LL application for 7 days"
  Then a ConsentArtefact (E-15) records purpose, scope, duration and the HelperLink (E-29)
  And the applicant sees the helper's actions in the case history
```

#### US-207 · Clear this device
As the Helper (P-04), I want to wipe a customer's data from the café computer, so that the next customer can't see it.
`F-17 · Should · S · Cross · EC-14 · — · Thin`
```gherkin
Scenario: One-tap wipe
  When I tap "Clear this device"
  Then local storage, IndexedDB, caches and service-worker data for Margdarshak are cleared and the session is logged out
  And shared-device mode auto-logs-out after 10 minutes idle
```

#### US-208 · Revoke a helper
As Mohan-ji (P-03), I want to revoke a helper at any time, so that I stay in control.
`F-17 · Should · S · Cross · EC-25 · API-60 · Thin`
```gherkin
Scenario: Revocation
  When I revoke Arjun's helper link
  Then his next request returns 403 and his screen shows "Access ended by the applicant"
  And the revocation is recorded in the audit log (E-30)
```

#### US-209 · Minor riding the family scooter
As Mohan-ji (P-03), I want to understand the law if my 17-year-old rides, so that our family stays safe and legal.
`F-17 · Should · S · Cross · EC-17 · — · Thin`
```gherkin
Scenario: s.199A card for parents
  When I open "My child wants to ride"
  Then I see s.199A consequences (guardian liability up to 3 years and ₹25,000, registration cancelled 12 months, no LL/DL until 25) with source
  And the copy is factual, not shaming, and offers the ≤ 50 cc legal path and an 18th-birthday plan
```

---

## EP-13 Case clock and notifications
**Goal:** durable, honest timers (Render Workflows), citizen messages sent by the backend notifier; n8n only triggers the daily sweep (D-15, D-16). **PS1 box:** 14.

#### US-220 · Opt in per channel
As Kabir (P-01), I want to choose WhatsApp, email or web push separately, so that I control how I'm contacted.
`F-53 · Must · S · Cross · — · API-60 · Deep-C`
```gherkin
Scenario: Granular opt-in
  When I open Notifications
  Then WhatsApp, email and web push each have their own off-by-default toggle
  And SMS shows "Coming after TRAI DLT registration" and cannot be enabled
```

#### US-221 · Approved WhatsApp templates
As P-06 (state), I want only pre-approved templates sent, so that messages are compliant and recognisable.
`F-53 · Must · S · Cross · — · API-66 · Deep-C`
```gherkin
Scenario: Template only
  When the backend notifier messages a user
  Then it sends only a template_id from the approved list with variables computed by the backend
  And no citizen message passes through n8n, which holds no business logic (D-16)
```

#### US-222 · STOP means stop
As Kabir (P-01), I want "STOP" to end messages immediately, so that I'm not spammed.
`F-53 · Must · S · Cross · EC-30 · API-66 · Deep-C`
```gherkin
Scenario: Opt-out reply
  When I reply "STOP" on WhatsApp
  Then within 1 minute my WhatsApp consent is withdrawn (E-15), pending WhatsApp jobs are cancelled and one confirmation is sent
  And in-app reminders continue unless I turn them off
```

#### US-223 · One nudge a day, quiet at night
As Kabir (P-01), I want at most one nudge a day and none at night, so that the app respects me.
`F-53 · Must · S · Cross · — · API-65 · Deep-C`
```gherkin
Scenario: Rate limit and quiet hours
  Given two milestones are due for me today
  Then only the higher-priority one is sent and none between 22:00 and 07:00 IST
```

#### US-224 · Server time is the source of truth
As P-06 (state), I want countdowns computed from server time, so that changing the phone clock changes nothing.
`F-09 · Must · S · Cross · EC-15 · API-14 · Deep-C`
```gherkin
Scenario: Tampered clock
  Given the device clock is 30 days ahead
  Then all countdowns, unlocks and reminders use server time synced to NTP
  And the client shows a subtle "your phone's clock looks wrong" note
```

#### US-225 · A rule changes mid-case
As Kabir (P-01), I want to be told if a rule that affects my plan changes, so that I'm not surprised at the RTO.
`F-09, F-42 · Must · M · Cross · EC-27 · API-14 · Thin`
```gherkin
Scenario: Re-evaluation notice
  Given rule pack jk-2026.10.23-r1 is replaced by r2 changing the LL test format
  When r2 is published by maker-checker
  Then every open case is re-evaluated and affected users see "Your plan changed: LL test is now 15 questions" with old vs new and the source
```

#### US-226 · Idempotent timeline events
As the Tech lead, I want every scheduled event keyed idempotently, so that retries never double-send.
`F-09 · Must · S · Platform · — · API-65 · Deep-C`
```gherkin
Scenario: Retry safety
  Given the sweep job retried after a timeout
  Then a TimelineEvent with key (case_id, milestone, due_date) is sent at most once
```

#### US-227 · Email and web push fallback
As Tanvi (P-02), I want reminders by email if I don't use WhatsApp, so that I still get them.
`F-53 · Must · S · Cross · — · API-66 · Deep-C`
```gherkin
Scenario: Channel routing
  Given I opted in to email only
  Then every milestone template is rendered as email with the same facts
```

#### US-228 · SMS stays off until DLT
As P-06 (state), I want SMS disabled until TRAI DLT registration is complete, so that we stay compliant.
`F-53 · Must · S · Platform · — · — · Deep-C`
```gherkin
Scenario: Flag guard
  Given ff_sms_channel is false
  Then no code path can enqueue an SMS and the notifier has no SMS adapter enabled
```

---

## EP-14 Driving-school portal (Eco)
**Goal:** the first buyer (D-23): Kerala's 3-month HPT mandate and inspections.

#### US-230 · List my school
As Sreeja (P-05), I want a free listing, so that learners near me find me.
`F-40 · Should · S · Eco · — · API-50 · Thin`
```gherkin
Scenario: Listing
  When I register my school with name, location, classes taught and contact
  Then it appears in school search for my district with "Accredited centre" shown only if I uploaded proof that an admin checked
```

#### US-231 · Paid placement is labelled
As Kabir (P-01), I want paid listings labelled, so that I'm not misled.
`F-40 · Should · S · Eco · — · API-50 · Thin`
```gherkin
Scenario: Sponsored label
  Given a school paid for placement
  Then its card shows "Sponsored" in the same size as the school name
```

#### US-232 · See my students' progress with their consent
As Sreeja (P-05), I want each student's readiness and Nazar progress, so that I teach what they lack.
`F-40 · Should · M · Eco · — · API-52 · Thin`
```gherkin
Scenario: Consent-scoped view
  Given student Kabir linked to my school and consented to "share progress with Sreeja Driving School"
  Then I see his readiness parts, Nazar Score trend and weak modules, not his contact details or DOB
  And if he revokes consent, his row disappears within 1 minute
```

#### US-233 · Export HPT training logs for inspection
As Sreeja (P-05), I want hazard-training hours and scores per student exported, so that I can show the RTO inspector.
`F-40, F-23 · Should · M · Eco · EC-28 · API-52 · Thin`
```gherkin
Scenario: Inspection pack
  When I export "Hazard training log" for October 2026
  Then a PDF/CSV lists per consenting student: sessions, total minutes, clips seen, mock scores, dates
  And the header says "Practice records generated by Margdarshak; not a government certification"
```

#### US-234 · Sign off practice
As Sreeja (P-05), I want to sign off supervised practice, so that the student's Practice Record shows it.
`F-40, F-28 · Should · S · Eco · — · API-52 · Thin`
```gherkin
Scenario: Attributed sign-off
  When I sign off "2 h figure-8 practice on 2026-11-02"
  Then the student's Practice Record shows it in a separate field "Signed off by Sreeja Driving School" with time
```

#### US-235 · Parent updates
As Sreeja (P-05), I want parents to get progress updates, so that families trust my school.
`F-40 · Should · S · Eco · — · API-52 · Roadmap`
```gherkin
Scenario: Opted-in parent card
  Given an adult student opted in to share with a named parent
  Then the weekly parent card (weekly TimelineEvent, sent by the notifier) includes attendance and next date
```

#### US-236 · List a test-day vehicle
As Sreeja (P-05), I want to list that I offer a test-day vehicle, so that learners without one find me.
`F-40 · Should · S · Eco · — · API-51 · Thin`
```gherkin
Scenario: Listing only
  When I tick "Offers test-day vehicle"
  Then learners see it in the vehicle listing with my contact; Margdarshak handles no booking or payment for it
```

#### US-237 · Receive remedial-training referrals
As Sreeja (P-05), I want failed learners who choose me to be referred, so that I can offer the required remedial course.
`F-40, F-13 · Should · S · Eco · — · API-51 · Thin`
```gherkin
Scenario: Referral with consent
  When a learner in S6F taps "Send my details to this school"
  Then I receive their first name, class and fail reason codes (no contact until they consent to share it)
```

#### US-238 · Accept or decline a lead
As Sreeja (P-05), I want to accept leads on WhatsApp, so that I respond quickly.
`F-40 · Should · S · Eco · — · API-66 · Thin`
```gherkin
Scenario: n8n W7 routing
  When a lead arrives
  Then I get a WhatsApp "Send and wait" with Accept / Decline
  And if I don't reply in 4 h, the lead goes to the next school and the learner is told who accepted
```

#### US-239 · Cancel Pro in one tap
As Sreeja (P-05), I want to cancel Pro easily, so that I'm never trapped.
`F-40 · Should · S · Eco · — · API-52 · Roadmap`
```gherkin
Scenario: No subscription trap
  When I tap "Cancel Pro"
  Then it cancels at period end with one confirmation and no retention dark patterns
```

#### US-240 · Kerala HPT stayed or postponed
As Sreeja (P-05), I want the portal to update its wording if the HPT is stayed, so that I don't mislead students.
`F-40, F-42 · Should · S · Eco · EC-28 · API-54 · Thin`
```gherkin
Scenario: Status flag
  Given the KL rule pack sets kl_hpt_status = "postponed"
  Then the school dashboard replaces "compliance" wording with "hazard practice" and shows the status with source and date
```

---

## EP-15 State / RTO console (Eco)
**Goal:** Palantir-style decision views for P-06, aggregated and anonymised.

#### US-250 · Where applications stall
As the Transport Commissioner (P-06), I want to see where cases stall by stage and office, so that I fix the worst bottleneck.
`F-41 · Should · M · Eco · — · API-53 · Thin`
```gherkin
Scenario: Stall funnel
  When I open "Where it stalls"
  Then I see median days per stage per office over the last 30 days, with n per cell
  And cells with n < 5 are suppressed as "fewer than 5"
```

#### US-251 · Why people fail
As the Transport Commissioner (P-06), I want fail reasons per office, so that I see whether a track or a rule is the problem.
`F-41 · Should · M · Eco · — · API-53 · Thin`
```gherkin
Scenario: Reason codes
  Then fail reasons (user-entered reason codes) are shown per office as shares with n and a "self-reported" label
```

#### US-252 · Demand forecast
As the ARTO (P-06), I want to see how many learners will be eligible for a test next month, so that I plan slots.
`F-41 · Should · M · Eco · — · API-53 · Thin`
```gherkin
Scenario: Eligible-soon count
  Then the console shows counts of Margdarshak cases reaching day 30 per week for the next 6 weeks, labelled "Margdarshak users only"
```

#### US-253 · Slot utilisation
As the ARTO (P-06), I want slot utilisation and no-shows, so that I can overbook safely.
`F-41 · Should · M · Eco · — · API-53 · Roadmap (needs real SlotAdapter)`
```gherkin
Scenario: Requires adapter
  Given the SlotAdapter is "mock"
  Then the panel shows "Available when your slot system is connected"
```

#### US-254 · Query deflection
As the ARTO (P-06), I want to know which questions citizens asked the app, so that I see what the counter no longer has to answer.
`F-41 · Should · S · Eco · — · API-53 · Thin`
```gherkin
Scenario: Topic counts
  Then the console lists voice/tutor intents by topic (e.g. "Form 1A", "documents") as counts, with no transcripts
```

#### US-255 · k-anonymity everywhere
As a citizen, I want console data to never identify me, so that sharing with government is safe.
`F-41, F-55 · Must · S · Eco · — · API-53 · Thin`
```gherkin
Scenario: Suppression
  When any console cell aggregates fewer than 5 people
  Then it is suppressed and cannot be derived by subtraction from other cells (complementary suppression)
```

#### US-256 · Export for an officer
As the ARTO (P-06), I want to export a monthly summary, so that I can report upward.
`F-41 · Should · S · Eco · — · API-53 · Thin`
```gherkin
Scenario: Export with audit
  When I export the monthly summary
  Then a CSV with the same suppression rules is produced and the export is logged in E-30
```

#### US-257 · Examiner variance flags for audit only
As the Transport Commissioner (P-06), I want statistical variance flags on pseudonymous examiner IDs, so that audits target outliers without public naming.
`F-41 · Could · M · Eco · — · API-53 · Roadmap`
```gherkin
Scenario: Pseudonymous flags
  Given the state adapter supplies pseudonymous examiner IDs
  Then the console shows pass-rate variance flags per pseudonymous ID to authorised audit roles only
  And no examiner name is ever stored by Margdarshak
```

---

## EP-16 Rule-pack studio (Eco)
**Goal:** every fee, class, format and timeline is data with source, date, confidence and approver (D-05, D-06).

#### US-260 · Draft a rule change with its source
As a state rules officer (P-06), I want to edit a rule with a source and confidence, so that citizen screens are traceable.
`F-42 · Must · M · Eco · — · API-54 · Thin`
```gherkin
Scenario: Draft
  When I change "LL test question count" for JK from 10 to 15
  Then I must enter source URL or document, verified_on date and confidence (high/medium/low) before saving the draft
```

#### US-261 · Maker-checker approval
As a senior officer (P-06), I want to approve changes made by someone else, so that no single person can change fees.
`F-42 · Must · S · Eco · — · API-54 · Thin`
```gherkin
Scenario: Two people
  Given the maker is "officer A"
  When officer A tries to approve their own draft
  Then approval is refused; officer B can approve or reject with a comment
```

#### US-262 · Publish a version to a tenant
As a state rules officer (P-06), I want to publish a versioned pack, so that every screen updates at once.
`F-42, F-58 · Must · S · Eco · — · API-54 · Thin`
```gherkin
Scenario: Versioned publish
  When an approved pack is published
  Then it gets an immutable version id (e.g. jk-2026.11.02-r2) and API-02/API-03 serve it within 5 minutes
```

#### US-263 · See which cases a change affects
As a state rules officer (P-06), I want the impact before publishing, so that I can warn citizens.
`F-42 · Must · M · Eco · EC-27 · API-54 · Thin`
```gherkin
Scenario: Impact preview
  When I preview a change
  Then I see the diff and the count of open cases whose plan would change (suppressed below 5)
```

#### US-264 · Source freshness check
As a content owner, I want to know when a cited source changes or disappears, so that "verified_on" stays honest.
`F-42 · Must · S · Eco · — · API-66 · Thin`
```gherkin
Scenario: n8n W15
  When the weekly check finds a source URL hash changed or returning 404
  Then a review task is created and the rule's confidence badge shows "re-verifying" until a reviewer acts
```

#### US-265 · Public changelog
As Tanvi (P-02), I want to see what rules changed and when, so that I trust the app.
`F-42 · Must · S · Eco · — · API-02 · Thin`
```gherkin
Scenario: Changelog page
  When I open "Rule changes"
  Then each published change lists date, state, rule, old → new and source
```

#### US-266 · Content state per class
As Mohan-ji (P-03), I want to know when a class has no learning content yet, so that I'm not surprised.
`F-42 · Must · S · Eco · — · API-02 · Thin`
```gherkin
Scenario: Honest content state
  Given class "HGMV" has rules but no deep content
  Then Learn shows "Learning content coming for this class" and the plan shows "verify at your RTO"
```

#### US-267 · Kerala HPT status flag
As a KL rules officer, I want a status field for the HPT, so that all copy updates if it is stayed.
`F-42 · Must · S · Eco · EC-28 · API-54 · Thin`
```gherkin
Scenario: Status values
  Then kl_hpt_status accepts "announced", "in_force", "stayed", "postponed" with source and date
  And Nazar, school portal and plan copy read from it
```

---

## EP-17 Privacy, consent and age gates
**Goal:** built to DPDP Rules (never "DPDP-compliant"); no Aadhaar numbers, OTPs or biometrics ever (D-07, D-13, D-18).

#### US-270 · Consent per purpose
As Kabir (P-01), I want to grant consent for each purpose separately, so that I control my data.
`F-54 · Must · M · Cross · — · API-60 · Deep-C`
```gherkin
Scenario: Purpose-bound artefacts
  When I opt in to "reminders on WhatsApp" and "share progress with my school"
  Then two ConsentArtefacts (E-15) are created with purpose, data, recipient, validity and a revoke link
  And nothing is pre-ticked
```

#### US-271 · Export my data
As Tanvi (P-02), I want to download everything Margdarshak holds about me, so that I know what's stored.
`F-54 · Must · S · Cross · — · API-61 · Thin`
```gherkin
Scenario: Export
  When I request an export
  Then I receive a JSON bundle of my case, events, sessions, consents and contacts within 24 hours (target: minutes)
```

#### US-272 · Delete my account mid-case
As Tanvi (P-02), I want to delete my account even mid-journey, so that I can leave cleanly.
`F-54 · Must · M · Cross · EC-26 · API-62, API-17 · Thin`
```gherkin
Scenario: Deletion
  When I delete my account while my case is at S5
  Then pending notifications are cancelled first, then case, contacts and sessions are deleted
  And aggregated, anonymised counts already computed remain
  And schools and helpers linked to me lose access immediately
  And I see what was deleted and what anonymised statistics remain
```

#### US-273 · Grievance officer
As any user, I want a named grievance contact, so that I can complain about data or content.
`F-54 · Must · S · Cross · — · — · Deep-C`
```gherkin
Scenario: Contact in footer
  Then the footer links a grievance page with the grievance officer's name, email and response timeline
```

#### US-274 · Under-18 gating
As Rahul (P-07), I want the features I'm allowed, so that I can prepare legally.
`F-54 · Must · M · Cross · EC-05 · — · Deep-C`
```gherkin
Scenario: Minor experience
  Given I declare a DOB under 18
  Then I get plan card, checklist and static lessons without an account
  And AI, telemetry, streaks, squads, share cards and WhatsApp marketing are hidden and blocked server-side
```

#### US-275 · Verified 18+ for AI and history
As P-06 (state), I want progress history and AI only for verified adults, so that children's data rules are respected.
`F-54 · Must · M · Cross · — · API-60 · Deep-C`
```gherkin
Scenario: Age verification mode
  Given hackathon mode
  Then 18+ is self-declared with an attestation and the AI gate checks it server-side
  And in production the DOB is verified via DigiLocker (adapter) before account history or AI is enabled
```

#### US-276 · We never ask for Aadhaar numbers or OTPs
As Mohan-ji (P-03), I want the app never to ask for my Aadhaar number or OTP, so that I know it isn't a scam.
`F-54, F-07 · Must · S · Cross · EC-20 · — · Deep-A`
```gherkin
Scenario: No field exists
  Then no form in Margdarshak has an Aadhaar-number, OTP or biometric input
  And a lint test fails the build if a field named or labelled aadhaar/otp is added
```

#### US-277 · Analytics carry no personal data
As Kabir (P-01), I want usage analytics to be anonymous, so that using the app doesn't profile me.
`F-55 · Must · M · Cross · — · API-63 · Deep-C`
```gherkin
Scenario: Schema-enforced
  When the client sends an analytics event
  Then API-63 rejects any property not in the event's allowlisted schema
  And IP addresses are dropped at ingress and session IDs rotate daily
```

#### US-278 · Use it without an account
As Kabir (P-01), I want to try the plan and practice without signing up, so that I decide later.
`F-54 · Must · S · Cross · — · API-01 · Deep-C`
```gherkin
Scenario: Anonymous device session
  When I use the plan and a practice quiz
  Then an anonymous device session is created; I can upgrade to an email magic link or Google account later and keep my progress
```

---

## EP-18 Languages, Lite mode and accessibility
**PS1 boxes:** 11, 13.

#### US-290 · English and Hindi in full
As Mohan-ji (P-03), I want every screen in Hindi, so that nothing is half-translated.
`F-50 · Must · M · Cross · — · — · Deep-C`
```gherkin
Scenario: Missing key fails CI
  When a new string is added in English without a reviewed Hindi value
  Then the i18n check fails the build
```

#### US-291 · Rule-pack-ready translations
As a state (P-06), I want to add my language through the rule pack and translation files, so that we can localise without code.
`F-50, F-58 · Must · M · Platform · — · API-54 · Roadmap`
```gherkin
Scenario: Tenant language
  Given tenant KL adds "ml" translations reviewed by a native speaker
  Then Malayalam appears in the language picker for the KL tenant only after 100% key coverage
```

#### US-292 · Lite mode under 300 KB
As Rahul (P-07) on 2G, I want a light version that loads fast, so that I can use it on a weak network.
`F-51 · Must · M · Cross · EC-19 · — · Deep-C`
```gherkin
Scenario: Budget
  When I open the home on a 2G/3G throttled profile
  Then the first load transfers < 300 KB (compressed) and the plan works without images
  And CI fails if the Lite bundle exceeds the budget
```

#### US-293 · Cached clips offline
As Tanvi (P-02), I want clips I've downloaded to work offline, so that I can practise in the hostel without data.
`F-51 · Must · M · S4 · EC-19 · API-37 · Thin`
```gherkin
Scenario: 360p cache
  When I tap "Download 10 clips" on Wi-Fi
  Then 360p clips of about 1–2 MB each are cached and playable offline; scores sync later
```

#### US-294 · Screen-reader friendly
As a blind user, I want every flow to work with TalkBack, so that I can apply independently.
`F-52 · Must · M · Cross · EC-13, EC-18 · — · Deep-C`
```gherkin
Scenario: axe and manual check
  Then automated axe checks pass on every route and TalkBack completes the plan and the application flow in manual tests
```

#### US-295 · Big targets, readable text, never colour alone
As Mohan-ji (P-03), I want big buttons and text, so that I don't mis-tap.
`F-52 · Must · S · Cross · — · — · Deep-C`
```gherkin
Scenario: Baseline
  Then touch targets are ≥ 48 px, body text ≥ 18 px, and every status uses icon + colour + words
```

#### US-296 · Games without audio, with captions
As a deaf user, I want every game playable without sound and every video captioned, so that I learn like everyone else.
`F-52 · Must · S · S4 · EC-13 · — · Deep-B`
```gherkin
Scenario: No-audio default
  Then games start muted, every audio cue has a visual and haptic cue, and explainer videos have captions
```

#### US-297 · Deaf applicants know their rights
As a deaf applicant, I want to know deaf people can be licensed, so that I'm not turned away.
`F-52, F-04 · Must · S · S1, S6 · EC-13 · — · Thin`
```gherkin
Scenario: Rights card
  Then the rights card quotes the MoRTH advisory that "driving is primarily a visual function" with its source
```

---

## EP-19 Platform, adapters and tenancy
**Goal:** the socket and the spec that government plugs in (D-02, D-08).

#### US-300 · Mock and real adapters pass the same contract tests
As NIC/state engineers (P-06), I want contract tests, so that we can swap mocks for real systems safely.
`F-56 · Must · L · Platform · — · — · Deep-C`
```gherkin
Scenario: Contract suite
  Given SarathiAdapter, DigiLockerAdapter, AadhaarOfflineAdapter, BhashiniAdapter, PaymentAdapter, NotificationAdapter and SlotAdapter
  Then each has a mock implementation passing the shared contract test suite in CI
  And the government-side interface is published as OpenAPI
```

#### US-301 · Simulated chips on mock data
As a judge, I want every mock-backed value labelled, so that nothing looks integrated when it isn't.
`F-56 · Must · S · Platform · — · — · Deep-C`
```gherkin
Scenario: Chips
  When a value comes from a mock adapter
  Then a "simulated" chip appears next to it
```

#### US-302 · Tenant theme
As a state (P-06), I want my own theme on the same product, so that it fits our identity without impersonating anyone.
`F-58 · Should · M · Platform · — · — · Thin`
```gherkin
Scenario: UX4G skin
  When tenant KL sets a theme
  Then colours and logo change via tokens; the State Emblem may only be used by the state itself under its own hosting
```

#### US-303 · Tenant languages and rule pack
As a state (P-06), I want my tenant to carry its rule pack, languages and adapters, so that one codebase serves many states.
`F-58 · Should · M · Platform · — · API-54 · Thin`
```gherkin
Scenario: Tenant config
  Then tenant JK and tenant KL resolve different rule packs, language sets and adapter modes from E-31
```

#### US-304 · Health and warm instance
As the demo owner, I want a health endpoint and warm instance, so that judges never hit a cold start.
`F-56 · Must · S · Platform · — · API-64 · Deep-C`
```gherkin
Scenario: Health
  When API-64 is called
  Then it returns status of DB, cache, rule pack version and adapter modes within 200 ms
```

#### US-305 · Payment is a redirect, never handled by us
As P-06 (state), I want payment always to happen on the government gateway, so that Margdarshak never touches money.
`F-56 · Must · S · Platform · — · — · Deep-A`
```gherkin
Scenario: PaymentAdapter
  Then the mock PaymentAdapter shows a clearly labelled simulated page; the real one redirects to the Sarathi/state gateway and reconciles by receipt number
```

#### US-306 · DigiLocker consent pattern (mock)
As a judge, I want to see the real consent pattern, so that the adoption path is credible.
`F-56 · Must · S · Platform · — · — · Thin`
```gherkin
Scenario: Mock consent
  Then the mock DigiLocker screen shows purpose, documents (e.g. DRVLC), validity and revoke, labelled "simulated"
```

---

## EP-20 Field study and evidence
**Goal:** real numbers from real people, pre-registered (D-22).

#### US-310 · Journey-test lab replica
As the Field lead, I want an unbranded replica of the observed Sarathi sequence, so that we can compare fairly.
`F-57 · Must · M · Evidence · — · API-70 · Deep-B`
```gherkin
Scenario: Replica
  Then /lab/sarathi-sequence reproduces the observed screens with no emblem or logo, a red "Research replica, not a government site" banner and noindex
  And it is enabled only with ff_lab_replica on the field-study build
```

#### US-311 · Nazar study consent
As a participant, I want clear consent and anonymity, so that I can take part safely.
`F-57 · Must · S · Evidence · — · API-70 · Deep-B`
```gherkin
Scenario: 18+ consent
  Then the consent screen states 18+, the data stored (anonymous ID, age band, licence type, years driving, scores, tap times) and not stored (name, phone, licence number, face, location)
```

#### US-312 · Pre-registered hypotheses
As Dr Tickoo (judge persona), I want the hypotheses committed before data, so that results aren't cherry-picked.
`F-57 · Must · S · Evidence · — · — · Deep-B`
```gherkin
Scenario: Commit order
  Then HYPOTHESES.md (H1–H4, J1–J4) is committed after the confirmed hackathon start and before the first participant row, and its hash appears on the evidence slide
```

#### US-313 · Live public counters
As a judge, I want live counters, so that I can see the study is real.
`F-57 · Must · S · Evidence · — · API-71 · Deep-B`
```gherkin
Scenario: Public stats
  Then API-71 returns N, % below 60/100 with Wilson CI, r(LL mock, Nazar) with CI, updated by the nightly job and on demand
```

#### US-314 · Nightly stats job
As the Field lead, I want stats recomputed automatically, so that the slide is always current.
`F-57 · Must · S · Evidence · — · — · Deep-B`
```gherkin
Scenario: Render Workflow
  Then a scheduled workflow (triggered by n8n) recomputes the statistics with retries and writes them for API-71
```

#### US-315 · Delete my study data
As a participant, I want to delete my data with my anonymous ID, so that I can withdraw.
`F-57, F-54 · Must · S · Evidence · — · API-62 · Deep-B`
```gherkin
Scenario: Withdrawal
  When I enter my anonymous ID and tap delete
  Then my rows are deleted and excluded from the next stats run
```

#### US-316 · Inter-rater agreement report
As Dr Sambyal (judge persona), I want inter-rater agreement shown, so that I trust the clip windows.
`F-57, F-23 · Must · S · Evidence · — · API-71 · Deep-B`
```gherkin
Scenario: Agreement
  Then the evidence page shows median |Δonset| across published clips and the share within 0.5 s (H4)
```

---

## 21. Traceability

### 21.1 Feature → stories
| Feature | Stories |
|---|---|
| F-01 | US-001–US-006 |
| F-02 | US-003, US-010–US-014, US-025 |
| F-03 | US-012, US-015 |
| F-04 | US-016–US-024, US-297 |
| F-05 | US-030–US-032, US-037–US-039 |
| F-06 | US-033, US-034 |
| F-07 | US-035, US-036, US-041, US-276 |
| F-08 | US-007–US-009, US-042, US-149, US-166, US-172 |
| F-09 | US-070, US-140, US-143, US-161, US-224–US-226 |
| F-10 | US-141, US-142, US-144 |
| F-11 | US-145–US-148 |
| F-12 | US-081, US-160–US-164 |
| F-13 | US-167–US-172, US-237 |
| F-14 | US-180–US-184 |
| F-15 | US-083, US-190–US-197 |
| F-16 | US-024, US-200–US-204 |
| F-17 | US-025, US-040, US-205–US-209 |
| F-20 | US-050–US-052 |
| F-21 | US-053–US-055 |
| F-22 | US-039, US-056, US-057, US-060 |
| F-23 | US-071–US-076, US-086, US-089–US-091, US-233, US-316 |
| F-24 | US-077–US-085, US-092 |
| F-25 | US-073, US-086, US-100–US-103, US-112 |
| F-26 | US-092, US-120–US-129, US-185, US-197 |
| F-27 | US-059 |
| F-28 | US-087, US-088, US-234 |
| F-30 | US-005, US-104–US-108, US-114 |
| F-31 | US-058, US-106 |
| F-32 | US-109, US-110 |
| F-33 | US-111, US-194 |
| F-40 | US-230–US-240 |
| F-41 | US-250–US-257 |
| F-42 | US-225, US-260–US-267 |
| F-50 | US-001, US-061, US-107, US-290, US-291 |
| F-51 | US-060, US-292, US-293 |
| F-52 | US-023, US-076, US-077, US-294–US-297 |
| F-53 | US-014, US-220–US-223, US-227, US-228 |
| F-54 | US-108, US-113, US-270–US-276, US-278 |
| F-55 | US-255, US-277 |
| F-56 | US-036, US-041, US-300, US-301, US-304–US-306 |
| F-57 | US-310–US-316 |
| F-58 | US-262, US-291, US-302, US-303 |

### 21.2 Edge case → stories (D-20: every EC has a screen state or rule row, plus a test)
| EC | Stories | EC | Stories |
|---|---|---|---|
| EC-01 | US-016 | EC-16 | US-200, US-201 |
| EC-02 | US-017 | EC-17 | US-020, US-209 |
| EC-03 | US-018 | EC-18 | US-071, US-074–US-077, US-129, US-294 |
| EC-04 | US-019 | EC-19 | US-001, US-031, US-033, US-075, US-292, US-293 |
| EC-05 | US-011, US-020, US-103, US-113, US-274 | EC-20 | US-005, US-086, US-108, US-109, US-276 |
| EC-06 | US-021 | EC-21 | US-015, US-202 |
| EC-07 | US-143, US-169 | EC-22 | US-009, US-042 |
| EC-08 | US-168, US-171 | EC-23 | US-181 |
| EC-09 | US-037 | EC-24 | US-145, US-147 |
| EC-10 | US-013, US-022, US-039, US-056 | EC-25 | US-208 |
| EC-11 | US-031, US-035, US-038 | EC-26 | US-272 |
| EC-12 | US-024, US-203, US-204 | EC-27 | US-225, US-263 |
| EC-13 | US-023, US-076, US-294, US-296, US-297 | EC-28 | US-071, US-233, US-240, US-267 |
| EC-14 | US-040, US-206, US-207 | EC-29 | US-058, US-086, US-102 |
| EC-15 | US-007, US-070, US-224 | EC-30 | US-014, US-140, US-222 |

### 21.3 Stage coverage
| Stage | Epics |
|---|---|
| S0 Home | EP-01 |
| S1 Licence plan | EP-02 |
| S2 Apply for LL | EP-03 |
| S3 LL test | EP-04, EP-06, EP-07 |
| S4 30-day bridge | EP-05, EP-06, EP-07 |
| S5 Book DL test | EP-08, EP-13 |
| S6 Driving test | EP-09 |
| S6F Fail and recover | EP-09 |
| S7 Licence issued | EP-10 |
| S8 New-rider year | EP-11 |
| S9 Renew / fix / family | EP-12 |
| Cross / Eco / Platform / Evidence | EP-13–EP-20 |

