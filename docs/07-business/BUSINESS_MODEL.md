# Business Model
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Business lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [VISION](../00-overview/VISION.md) · [GTM](GTM.md) · [FINANCIALS](FINANCIALS.md) · [IMPACT](IMPACT.md) · [GOVERNMENT_ADOPTION](../10-government/GOVERNMENT_ADOPTION.md) · [PALANTIR_METHOD](../10-government/PALANTIR_METHOD.md) · [PITCH](../00-overview/PITCH.md)
> Inputs: `research/ps1-deep/03-lifecycle.md` §C–D (schools, insurance), `07-govt-plug-and-play.md` (adoption, licence), `research/C-judges.md` (Rutvik Gupta's "who pays?"), `war-room/margdarshak-verification.md` D-23, §1 rows 10, 15; G9.
> Conventions: **HUNCH** = a pricing or market hypothesis we have not tested with a paying customer. **[unverified]** = a fact we have not confirmed against a primary source; each carries an owner and a check-by date. All ₹ figures exclude GST unless stated.

---

## 0. The model in one paragraph
Citizens never pay. The licence journey (plan, guided application, readiness, Nazar, case clock) is free forever, because charging the person we are freeing from a ₹2k–20k agent fee would rebuild the toll booth we are tearing down. Money comes from the **institutions that benefit when a learner arrives prepared**:
1. **Driving schools buy first.** A **Pro tier** turns Kerala's new hazard-training duty (3 months of HPT training "using open-source computer-based tools", with RTO inspections of schools since 1 Oct 2026) into a dashboard they can show an inspector.
2. **States pay for the service, not the code.** The code is Apache-2.0 and free. A State Transport Department pays for a **B2G implementation, support and hosting-operations licence**: forward-deployed configuration, rule-pack upkeep, SLA support, clip-bank refresh and audits.
3. **CSR and grants fund the public-good parts**: the open clip bank, J&K pilots, Dogri and Kashmiri voice.
4. **Insurers come later, as a roadmap line only.** The product would be a user-held, consented **training-completion signal**. It is never tied to a game score (Online Gaming Act 2025, G9) and never priced before IRDAI and legal review.

---

## 1. Lean canvas

| Block | Margdarshak |
|---|---|
| **Problem** | (1) The licence journey has no owner except the agent: ~120 homepage links, ~16 LL screens, nothing saved, edits locked after payment. (2) Nobody owns the timeline: LL validity of 6 months, the 30-day minimum gap, slot scarcity, the 7-day retest gap and remedial training all collide, so a licence typically takes 2.5–4 months and up to 6–12+. (3) India tests knowledge and control, never **anticipation**, and new riders are ~8× more likely to crash or nearly crash in their first 3 months (PROJECT_BRIEF §2). |
| **Existing alternatives** | Agents (₹2k–20k against ₹700 + ₹200 card for one class in government fees; 18 price points in `00-JOURNEY-MAP` row 15); driving schools that "handle the LL and slot"; YouTube and Play Store LL-question apps, some of them fakes with 1M+ installs; NextGen mParivahan (100M+ downloads, a document wallet whose listing does not describe applying for an LL or DL in-app; `01-sarathi-screens.md` E6); the organiser's sample "Licence Saathi" app (12 screens; `E-competition.md` l.34). |
| **Customer segments** | **Users (free):** P-01 Kabir (19, Jammu, 2W then car), P-02 Tanvi (migrant address case), P-03 Mohan-ji (52, renewal + Form 1A), P-04 Helper (sibling or CSC operator), P-07 Rahul (17, family mode in a parent's account). **Payers:** P-05 driving-school owners (Kerala first, then J&K and states with automated tracks); P-06 State Transport Departments / Transport Commissioners; CSR arms of mobility companies **[unverified which ones]**; grant bodies; insurers later. |
| **Early adopters** | Kerala driving schools facing HPT inspections from 1 Oct 2026 and the 1 Dec 2026 HPT start; Jammu college students (GCET, University of Jammu, IIT Jammu) who are 18–21 and about to apply; the J&K ARTO/RTO counter as the pilot site (see [GOVERNMENT_ADOPTION §8](../10-government/GOVERNMENT_ADOPTION.md)). |
| **Unique value proposition** | *Learner se licence tak, bina agent ke.* Your exact plan before you apply: classes, steps, ₹, documents, earliest date. One guided road that remembers you. Training in the skill the test never checks (Nazar hazard perception, Kerala's announced 10 × 10 format). For schools: "hazard-training evidence your inspector can read." For states: "a citizen front end and open adapter spec your NIC team can host, audit and own." |
| **Solution** | F-02 3-tap plan · F-03 class planner · F-04 blocker check · F-05/F-06 guided LL application with photo fixer · F-07 Sarathi hand-off (Mode A today, Mode B adapter) · F-08/F-09 stage-aware home + case clock · F-20–F-25 learn hub, readiness, LL simulator, Nazar, mini-games, AI debrief · F-40 school portal · F-41 state console · F-42 rule-pack studio · F-56 government adapter layer · F-58 multi-tenancy. |
| **Channels** | College WhatsApp groups and Instagram Reels (citizens); driving-school associations and walk-in visits near RTOs (schools); CSCs (helpers, P-04); Transport Commissioner office via a pilot MoU (state); GeM listing (procurement). Detail in [GTM](GTM.md). |
| **Revenue streams** | School Pro subscription (HUNCH); school lead-gen fee on verified bookings (HUNCH, Year 2+, disclosed); state implementation + annual support/ops licence (HUNCH); CSR programme grants; government startup grants (SISFS, TIDE 2.0, J&K Startup Policy); insurer partnership (roadmap). |
| **Cost structure** | People (engineering, forward-deployed field team, content and clip raters); AI inference (Gemini paid tier, ≈ ₹2.5/active user/month text, voice ≈ ₹20 per 10 min and capped; `04-ai-adk-gemini.md` §5); hosting (Render for the hackathon; MeitY-empanelled cloud for adoption); audits (VAPT, STQC/CERT-In-empanelled safe-to-host); WhatsApp template messages; legal (DPDP, trademark). |
| **Key metrics** | North star: **ready, agent-free licences per month** ([VISION §3](../00-overview/VISION.md)). Inputs: plans created → cases started → LL issued → Nazar ≥ 60 before the DL test → DL test passed on the first attempt → card received; schools on Pro; learners per school; state KPIs ([GOVERNMENT_ADOPTION §10](../10-government/GOVERNMENT_ADOPTION.md)). |
| **Unfair advantage** | (1) A calibrated Indian hazard-clip bank (two-rater windows, per-clip difficulty, CC-BY), built through a Render Workflows pipeline; (2) versioned state rule packs with source, date and confidence; (3) per-RTO "where it stalls, why people fail" data plus a school and parent network and trust; (4) a pre-registered field-evidence habit that competitors don't have (PROJECT_BRIEF §3, §12). |

---

## 2. Customer segments and value propositions

### 2.1 Who uses, who pays, who decides
| Segment | ID | Uses | Pays | Decides | Value we deliver | Evidence of the pain |
|---|---|---|---|---|---|---|
| First-time applicant | P-01, P-02 | ✔ | ✘ (free forever) | ✔ | Certainty: the exact plan, fees, documents and dates; no agent; readiness for the test that fails ~50% in Delhi | Agents ₹2k–20k (`00-JOURNEY-MAP` row 15); Delhi ADTT ~50% fail (`02-rules-process` l.79) |
| Family / elder | P-03 | ✔ | ✘ | Parent often decides | Renewal with no grace period since 2019; Form 1A at 40+; s.199A warning for parents of 16–17-year-olds | `03-lifecycle` §0.1, §0.4 |
| Helper / CSC operator | P-04 | ✔ | ✘ (HUNCH: a CSC bundle in Year 3) | ✔ | Recorded consent, "clear this device", fewer rejected applications per customer | CSCs run LL applications and tests in J&K (`02-rules-process` l.146) |
| Driving-school owner | P-05 | ✔ (portal) | **✔ first buyer** | ✔ | HPT training logs for inspections; learner progress; parent updates; fewer failed students who then blame the school | Kerala HPT circular 12 Sep 2026; pass rate 40–45% after the 2024 reform (`02-rules-process` l.82, l.91–98) |
| Transport Commissioner / RTO | P-06 | ✔ (console) | **✔ B2G** | ✔ (with NIC) | Fewer counter queries, fewer re-tests and LL expiries, visibility of where applications stall | Approval limbo, payment-pending complaints (15 of 33), outages (`team-saarthi-report` pain table) |
| CSR funder | — | ✘ | ✔ | CSR committee | Measurable road-safety education outcomes in a named district, reported with CIs, never as mortality claims | HUNCH |
| Insurer | — | ✘ | Roadmap | Product / actuarial | A consented, user-held training-completion record (F-28 Practice Record) | HUNCH; Rutvik will test it (C-judges §4) |

### 2.2 Value propositions by segment (the one sentence we say to each)
- **Kabir:** "In 3 taps you'll know your exact plan and fee, ₹700 + ₹200 card for one class. Nobody needs to be paid to stand in a queue for you."
- **Mohan-ji (through Kabir):** "Papa's licence has no grace period. We'll remind you a year ahead, and tell you about Form 1A."
- **Driving-school owner (Kerala):** "Your students practise Kerala's announced HPT format at home, and your inspector sees a log of hours and scores per student, signed by your instructor."
- **Driving-school owner (J&K):** "Students who come to you already pass the LL simulator and know the track. You spend lesson time on the road, not on paperwork."
- **Transport Commissioner:** "A citizen front end your NIC team hosts on MeghRaj, with an adapter spec, Apache-2.0 code, an audit pack and a console that shows where applications stall, per RTO, this week."
- **CSR head:** "Fund 1,000 hazard-trained learners in a J&K district. We'll report the pre/post anticipation score with confidence intervals."

---

## 3. Revenue streams (who pays, how much, when)

### 3.1 Stream summary
| # | Stream | Payer | Starts | Pricing (all **HUNCH** unless noted) | Share of Year-3 revenue (HUNCH, see [FINANCIALS](FINANCIALS.md)) |
|---|---|---|---|---|---|
| R1 | **School Pro subscription** | Driving schools | Pilot Dec 2026 (Kerala), paid from Jan 2027 | ₹799/month or ₹7,999/year per branch, up to 40 active learners; ₹15 per extra active learner per month | ~31% |
| R2 | School lead-gen (verified bookings) | Driving schools | Year 2 | 5% of the course fee on bookings made through Margdarshak, capped at ₹400 per learner; disclosed on the listing; never ranks schools by fee paid | ~7% |
| R3 | **State implementation (one-time)** | State Transport Dept | Year 2 | ₹25–60 lakh per state, scaled by RTO count and adapter modes | ~24% |
| R4 | **State support, hosting-ops and rule-pack licence (annual)** | State Transport Dept | Year 2 | ₹15–40 lakh per state per year (SLA tiers, see §3.4) | ~18% |
| R5 | CSR programmes | Corporate CSR | Year 1 | ₹5–25 lakh per district programme | ~15% |
| R6 | Grants (non-dilutive) | DPIIT/MeitY/J&K | Year 1 | Scheme amounts in [FINANCIALS §5](FINANCIALS.md) | Not revenue (funding) |
| R7 | Insurer training-completion partnership | General insurers | **Roadmap** (Year 3 earliest) | Not priced. Requires IRDAI and legal review | ~3% (pilot only) |
| — | Citizens | — | Never | ₹0. No ads, no data sale, no paid "fast track" | 0% |

### 3.2 R1: School Pro (the first buyer)
**Why schools buy now (the forcing function):** Kerala's Transport Commissioner circular of 12 Sep 2026 requires driving schools to give 3 months of hazard-perception training "using open-source computer-based tools", and RTO/Joint RTO inspections of schools have run since 1 Oct 2026 (`02-rules-process.md` l.91–98; [Onmanorama, 14 Sep 2026](https://www.onmanorama.com/news/kerala/2026/09/14/kerala-adds-hazard-perception-test-for-driving-licences-from-dec-1-first-in-india.html); [South First](https://thesouthfirst.com/kerala/how-fast-can-you-spot-danger-keralams-new-licence-test-faces-driving-school-block/)). A school owner who has no tool must improvise one. The owners' Samithi plans a legal challenge, so this forcing function can disappear (R-10, EC-28): see §7.

| Tier | Price (HUNCH) | Includes | Excludes |
|---|---|---|---|
| **Free** | ₹0 | Listing (F-40) with accreditation status; student invite link; basic lesson calendar; access for every student to the free citizen app | Logs, exports, parent updates |
| **Pro** | ₹799/month or ₹7,999/year per branch (range tested: ₹499–999/month, from `03-lifecycle` §C) | Learner progress board; **HPT training log** (sessions, minutes, Nazar scores per student, instructor sign-off) exportable as a signed PDF/CSV for RTO inspection; F-28 Practice Record sign-off; parent WhatsApp updates (templates, opt-in, ≤ 1 per day); test-vehicle listing (F-12, listing only); remedial-training referral inbox (F-13); "LL day 30 is X, suggest a test window" planner | Payments collection, insurance or loan selling |
| **Pro Multi-branch** | ₹1,999/month for up to 4 branches | Pro plus cross-branch dashboard and instructor roles | — |
| **ADTC / IDTR** | Custom (HUNCH ₹50k–2 lakh/year) | White-label HPT content, cohort exports, API access to logs | — |

**Pricing logic (HUNCH, to test in the first 20 sales calls):**
- A local car course costs ~₹4,000–8,000 and an MSDS course ₹5,500–9,000 + GST (`03-lifecycle` §C, [Maruti Driving School](https://www.marutisuzuki.com/more-from-us/maruti-driving-school)). At 15 learners a month, ₹799 is about ₹53 per learner, or 1% of a ₹5,000 course.
- The alternative is a desktop simulator or a self-built clip set, which a one-car school cannot build. ADTC rules require simulators and land beyond a typical school (`03-lifecycle` §C).
- **Price test protocol:** Van Westendorp 4-question survey with 20 Kerala and 10 J&K school owners in Nov 2026 (owner: Business lead, by 2026-11-30). If the "too expensive" median is below ₹799, drop to ₹499 and keep the per-learner add-on.

**What Pro must never do (trust guardrails):**
- No "guaranteed pass" claims, and no ranking of schools by money paid. Ratings come only from verified students' outcomes, with k ≥ 5 (same rule as F-11).
- The log records only what happened in-app. It is "practice and familiarisation, not certification" (D-11) and is never called "verified" (D-14, D-19).
- Students' data is visible to a school only after the student links to it with consent (E-15 ConsentArtefact, E-25 DrivingSchool, E-27 PracticeLog). A student under 18 (P-07) is linked to a school only from the parent's account, with the parent's consent; a child's data is never used for behavioural tracking or targeted ads (D-13 revised).

### 3.3 R2: Lead-gen on verified bookings (Year 2, HUNCH)
- 5% of the course fee on bookings made through API-51 `POST /v1/schools/{id}/bookings`, capped at ₹400/learner. On a ₹6–10k course the uncapped fee would be ₹300–500; the 5–10% band comes from `03-lifecycle` §C.
- Disclosure: "Margdarshak receives a fee from this school if you book here" appears on the listing. Search order is by distance and verified outcomes, never by fee.
- Margdarshak never collects the course fee. The school sends the learner a UPI payment link; we reconcile the booking status only (see §5, fintech hooks).

### 3.4 R3–R4: State licence (B2G)
**What the state is buying:** not software (that is Apache-2.0 and free, D-02, G14) but **outcomes and accountability**: someone who configures it for that state's reality, keeps rule packs current, answers at 2 a.m. during an outage, passes the audit, and hands over cleanly if the state leaves.

| Component | Price (HUNCH) | Basis |
|---|---|---|
| Forward-deployed discovery + configuration (one-time) | ₹25–60 lakh per state | 2 forward-deployed engineers + 1 field researcher for 6–10 weeks, rule pack v1, tenant theme, adapter configuration (Mode A deep-link; Mode B with NIC), training of RTO staff, pre-audit pack. Scales with RTO count. See [PALANTIR_METHOD §5](../10-government/PALANTIR_METHOD.md) |
| Annual support + hosting-ops + rule-pack upkeep | ₹15–40 lakh per state per year | SLA tier (Basic 8×5 / Standard 12×7 / Premium 24×7), rule-pack change management (maker-checker, F-42), clip-bank refresh for the state's roads, quarterly accessibility and security re-tests, console (F-41) |
| Hosting | At cost, paid by the state to its MeghRaj/MeitY-empanelled CSP or NIC directly | We never resell cloud. The state owns the account and the data ([GOVERNMENT_ADOPTION §6](../10-government/GOVERNMENT_ADOPTION.md)) |
| Security audit (safe-to-host) | At cost, paid by the state to an STQC- or CERT-In-empanelled auditor | GIGW 3.0 guideline 5.3.1 (SECONDARY: [TCSA](https://www.tcsa.in/learn/gigw-compliance-before-go-live)) |

**Pilot pricing:** the J&K pilot (one RTO/ARTO, 6 weeks) is **₹0 to the state**, funded by grants and CSR (see [FINANCIALS §5](FINANCIALS.md)). The pilot's job is to produce baseline-vs-pilot KPIs the Transport Commissioner can take to a procurement committee.

**Procurement route:** GeM (DPIIT-recognised startups can register and get exemptions on prior experience, prior turnover and EMD **where the tender allows it**; the GeM Startup Runway takes innovative products that don't fit an existing category) ([Startup India note](https://www.startupindia.gov.in/content/sih/en/reources/startup_india_notes/regulations_and_policies/MakeTheGovernmentYourPrimeCustomer.html); [Startup India kit](https://www.startupindia.gov.in/content/dam/invest-india/Templates/public/startup_kit%20(2).pdf)). Whether the relaxation applies to a software service and not only to manufacturing startups is **[unverified]**, sources conflict (owner: Business lead, by 2026-11-30). See [GOVERNMENT_ADOPTION §9](../10-government/GOVERNMENT_ADOPTION.md).

### 3.5 R5: CSR
- **Fit (HUNCH):** road-safety education programmes in a district, delivered through schools, colleges and CSCs: learners trained, Nazar pre/post gain, LL simulator readiness.
- **Eligibility under Companies Act s.135 / Schedule VII:** whether road-safety education qualifies under a specific Schedule VII item (e.g., "promoting education") is **[unverified]** (owner: Business lead, check MCA Schedule VII text and FAQs by 2026-11-30). We need a registered CSR-eligible implementing agency (CSR-1 filing) or a partner NGO that holds one. Nestiq Private Limited's eligibility is **[unverified]**.
- **Prospects:** two-wheeler and car makers, insurers and tyre companies that already run road-safety programmes. **No company has been approached**, and none is named on stage.
- **What CSR funds:** the open clip bank (CC-BY 4.0), Dogri/Kashmiri voice data, free Pro seats for schools in aspirational or hill districts, the J&K pilot field team.

### 3.6 R7: Insurers (roadmap line only, D-23)
- **The signal:** a user-held F-28 Practice Record (practice hours, Nazar score, modules completed, supervisor sign-offs, QR-verifiable via API-47) that the user may choose to share with an insurer through a ConsentArtefact (E-15).
- **Hard limits:**
  - Never tied to a game result. A benefit may follow **training completion** only (Online Gaming Act 2025, G9: no redeemable prizes tied to games).
  - Never called "verified", "certified" or a "driver rating", and never "safe driver" or "unsafe driver" (D-19).
  - No telematics or trip tracking (D-14 novice-year rule).
  - IRDAI rules on discounts and on data-sharing with insurers are **[unverified]** (owner: Business lead, legal review before any insurer conversation, not before 2027-Q2).
- **Rutvik answer (C-judges §4):** "Insurers are one roadmap line, not a revenue line in this pitch. When we get there, it is a consented, user-held record of training, with no score-based pricing."

---

## 4. Pricing hypotheses register (all HUNCH)
| ID | Hypothesis | Test | Kill/adjust signal | Owner | By |
|---|---|---|---|---|---|
| PH-01 | Kerala schools will pay ₹799/month for HPT logs | 20 discovery calls + 5 paid pilots at ₹1 for month 1 | < 3 of 20 say "would pay" at ≥ ₹499 | Business lead | 2026-12-15 |
| PH-02 | J&K schools will pay ₹499–799 without a mandate | 10 visits near RTO Jammu and ARTO offices | < 2 of 10 convert after a free month | Business lead | 2027-01-31 |
| PH-03 | A state pays ₹15–40 lakh/year for support once a free pilot shows KPI movement | Pilot KPIs + Transport Commissioner debrief | No budget line identified within 90 days of the pilot | Founder | 2027-06-30 |
| PH-04 | CSR funders fund ₹5–25 lakh per district programme | 5 conversations with CSR heads | 0 term sheets after 5 meetings | Business lead | 2027-03-31 |
| PH-05 | Lead-gen at 5% (cap ₹400) does not damage trust | A/B of listing disclosure copy; complaint rate | Complaint rate > 1% of bookings | Product lead | Year 2 |
| PH-06 | Citizens stay free with no conversion loss | No test needed; principle | — | Founder | — |

---

## 5. Fintech hooks (what money flows touch us, and which never do)
| Flow | Do we touch it? | How |
|---|---|---|
| Government fees (LL ₹150, LL test ₹50, DL test ₹300, DL ₹200, card ₹200; CMVR r.32) | **Never.** | F-07 hand-off: payment happens on Sarathi or the state gateway. `PaymentAdapter.real` = redirect plus receipt reconciliation by challan/receipt number (`07-govt-plug-and-play` §A5). EC-09 payment-pending guidance only |
| School course fees | No (school collects) | The school sends a UPI payment link from its own account. We record `Booking.status` (E-26) only |
| School Pro subscription | Yes, as a merchant | Razorpay or a similar PA subscription with UPI AutoPay mandate **[unverified provider choice]** (owner: Engineering lead, Year 1 Q1). GST invoice |
| State licence | Yes | Purchase order via GeM or a tender; invoices against milestones |
| Insurance or loans | **No** in Year 1–2 | No selling, no referral fees on loans. The first-vehicle checklist (F-15) explains third-party cover and the ₹15 lakh PA cover factually (`03-lifecycle` §D) without selling |

**For Rutvik (lending PO):** the honest fintech line is "we deliberately stay out of the money path for government fees, and the only money we take is a school subscription on UPI AutoPay". The money maths in the product is exact: the plan card computes ₹700 for one class + ₹200 card, and a second class adds ₹450 (LL ₹150 + DL test ₹300), so two classes are ₹1,150 + ₹200 card = ₹1,350, all from `fees.json` with "source: CMVR r.32, checked 22 Oct 2026" (D-06).

---

## 6. Moat (Buffett: durable advantage; Thiel: monopoly on a small market first)

### 6.1 Thiel: the secret and the small market
- **The secret:** the agent's job (right class, blocker check, documents that pass, dates, slot, test vehicle, chasing approval) is all software. And India tests knowledge and control but never **anticipation**, the skill that predicts crashes (UK HPT associated with an 11.3% fall in non-low-speed crashes, [Horswill 2016 review](https://www.psychologicalscience.org/journals/current-directions/0963721416663186/); `team-saarthi-report` l.229).
- **Small market to dominate first:** Kerala driving schools that must give HPT training from now on, plus Jammu first-time applicants. Monopoly there before going wide.
- **Last mover:** once the calibrated clip bank and state rule packs exist, the next team has to re-film, re-rate and re-calibrate.

### 6.2 Buffett: the four walls of the moat
| Wall | What it is | Why it compounds | Why a copier can't catch up fast |
|---|---|---|---|
| **1. Calibrated Indian hazard-clip bank** (E-20, E-21) | Real Indian clips with faces and plates blurred, two-rater hazard windows, per-clip difficulty fitted on thousands of takers, CC-BY 4.0 | Every taker improves difficulty estimates; every new state adds road types (hill roads in J&K, NH44) | The clips are open, but the *calibration data* (taker responses) and the pipeline that keeps producing clips (Render Workflows: transcode → blur → propose → two raters → agreement → publish) take months of field work |
| **2. Versioned state rule packs** (E-08, F-42) | Classes, fees, test formats, timelines per state, each row with `source`, `verified_on`, `confidence`, maker-checker approver | Every state adopted adds a pack that other states can reference; changes are logged (public CHANGELOG) | Rules change by circular; keeping 36 states/UTs current is a service, not a one-off scrape |
| **3. Per-RTO operational data + network** (E-24, E-25) | Structured, k ≥ 5 crowd reports (slot release times, documents asked, track type, wait), school network, parent links | More learners → better intel → more learners (data network effect); schools bring cohorts | Cold start: seeded rows are labelled "sample data" (D-14), so a copier starts at zero real rows |
| **4. Trust + adoption position** | No emblem, no "official" wording, non-affiliation footer, open code, published evidence, state-owned data | Trust accrues slowly and is lost fast; open source invites NIC to adopt rather than compete | A closed competitor cannot offer a state source code, escrow and data ownership; a fake-app scammer cannot offer published pre-registered evidence |

**The open-source paradox:** if the code is free, what is defended? Three things: (a) the **trademark** "Margdarshak" (IP India check pending, D-25; `HUNCH:` close to AICTE's "Margdarshan" scheme), so quality-controlled distribution stays ours; (b) **maintainer status** and the forward-deployed relationship with each state; (c) the **calibration and operations data**, which the state owns for its own tenant but which the shared clip difficulty model benefits from only with consent and aggregation (see [GOVERNMENT_ADOPTION §6](../10-government/GOVERNMENT_ADOPTION.md)).

### 6.3 Competitive position (short; full analysis in `docs/01-product/COMPETITIVE_ANALYSIS.md`)
| Alternative | What it does | Where it stops | Our edge |
|---|---|---|---|
| Agents / dalals | Everything, for ₹2k–20k | Opaque, sometimes illegal, no learning | Same certainty, free, with training |
| NextGen mParivahan (NIC) | Virtual DL/RC wallet, 100M+ downloads | Listing does not describe LL/DL application in-app (`01-sarathi-screens` E6) | We are designed to sit **inside** it as an entry card (the RaktKhoj pattern, G §1.4) |
| LL question-bank apps | Memorise 200+ questions | Memorisation; some are fakes | Variants so memorising fails, FSRS, calibration, plus Nazar |
| Organiser sample "Licence Saathi" | 12 screens incl. mock test and FAQ chat | No hazard training, no adoption path, keyword chat | Journey + Nazar heart + adapter spec + field evidence |
| 26 BWMI Parivahan/DL redesigns | Cleaner portal screens | None reached the BWMI final 10 (G §1.5) | We lead with Nazar and a real field number, not with a redesign |

---

## 7. Risks to the model and what we do about them
| Risk | Link | Effect on revenue | Mitigation |
|---|---|---|---|
| Kerala HPT stayed or postponed (Samithi challenge) | R-10, EC-28 | R1's forcing function weakens | Pro still sells as a learner-progress and parent-update tool; J&K and automated-track states (Delhi ~50% fail) give a second reason; recheck status on demo morning (D-25) |
| States don't buy software services from a startup | R-02 | R3/R4 slip by a year | Free pilot funded by grants/CSR; GeM listing; partner with an existing state system integrator as a sub-contractor (HUNCH) |
| AI costs rise (Flash prices double on 2027-01-01 per `04-ai-adk-gemini` §5) | R-13 | Citizen cost per MAU roughly doubles | Voice cap 10 min/user/month; template fallbacks (EC-29); Bhashini path for states; numbers computed by code, so AI is narration only |
| A school misuses logs ("certified safe") | D-19 | Trust and legal risk | Contract clause + automatic watermark "practice and familiarisation, not certification" on every export |
| Wrong fee or rule shown | R-09 | Trust collapse | Rule rows carry source + date; maker-checker; "verify at your RTO" banner; public CHANGELOG |

---

## 8. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| Area | Hackathon build | Production |
|---|---|---|
| Revenue | None. Pitch shows the model only | R1 from Jan 2027 (Kerala), R5 CSR from 2027-Q1, R3/R4 from Year 2 |
| School portal (F-40) | Thin: listing + Pro dashboard on seeded data labelled "sample data" | Real schools, consent links, signed exports |
| State console (F-41) | Thin: aggregated mock data, k ≥ 5 | Tenant-scoped, aggregated, state-owned |
| Payments | No money flows at all | School subscriptions on UPI AutoPay; government fees always on Sarathi/state gateway |
| Claims allowed on stage | "Free for citizens; schools are the first buyer because of Kerala's HPT duty; states pay for service, not code; insurers are a roadmap line" | Same, plus real pilot numbers |

## 9. Open items
| Item | Status | Owner | By |
|---|---|---|---|
| IP India trademark search for "Margdarshak" | [unverified] | Founder | 2026-11-15 |
| Nestiq Pvt Ltd: DPIIT recognition and incorporation date (gates SISFS eligibility, ≤ 2 years) | [unverified] | Founder | 2026-11-07 |
| CSR Schedule VII fit for road-safety education | [unverified] | Business lead | 2026-11-30 |
| GeM startup relaxations for software services | [unverified], sources conflict | Business lead | 2026-11-30 |
| IRDAI position on training-completion benefits | [unverified] | Business lead + counsel | 2027-04-30 |
| Kerala driving-school count (for SOM) | unknown | Business lead | 2026-11-30 |
