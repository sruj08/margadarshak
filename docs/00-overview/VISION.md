# Vision
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Founder · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](PROJECT_BRIEF.md) · [PITCH](PITCH.md) · [DEMO_SCRIPT](DEMO_SCRIPT.md) · [IMPACT](../07-business/IMPACT.md) · [BUSINESS_MODEL](../07-business/BUSINESS_MODEL.md) · [GOVERNMENT_ADOPTION](../10-government/GOVERNMENT_ADOPTION.md)

---

## 1. Vision
**Every Indian earns a driving licence on their own, without an agent, and arrives on the road able to see danger before it happens.**

## 2. Mission
Turn India's licence process into one guided road that any state can host and own:
- tell each person their exact plan before they apply;
- carry them through every step, in their language, on any phone;
- train the skill the test never checks (hazard anticipation) with short simulations and honest AI coaching;
- give the department that runs it a clear view of where the journey breaks.

**Tagline:** *Learner se licence tak, bina agent ke.* (From learner's licence to licence, without an agent.)

## 3. North-star metric
**Ready, agent-free licences per month (RAL/month).**

A case counts when all three hold:
1. it reaches S7 (licence issued) or `card_received`;
2. the user answers "no" to "Did you pay anyone to help with this licence?" (self-declared, recorded at S7);
3. the user reached the readiness gates **before** the DL test: Test Readiness Score ≥ 85 (advisory gate, F-21) and a Nazar practice score ≥ 60/100 in Kerala's announced format (F-23).

| Input metric | Why it drives the north star | Event |
|---|---|---|
| Plans created per week | Top of the funnel; answers before asking | `plan_created` |
| Plan → case conversion | Certainty turns into action | `case_created` |
| LL-issued cases that reach day 31 with a booked test | The 30-day bridge works | `stage_entered{S5}` |
| LL expiries before a test (lower is better) | The case clock works (EC-07) | `ll_expired_without_test` |
| Nazar ≥ 60 before the DL test | Anticipation readiness | `readiness_gate_met{nazar}` |
| First-attempt pass rate (self-reported or adapter) | Readiness pays off | `test_passed{attempt=1}` |
| Weekly active learners in S3–S4 | Learning habit | `learn_session` |

**Guardrail metrics (must not get worse):** complaints about wrong rules or fees (R-09), AI provenance violations (D-10, target 0), under-18 users reaching AI (target 0, D-13), dark-pattern lint failures (target 0, F-26).

## 4. The 1 / 5 / 10-year picture (Musk: work backwards from the end state)

### 4.1 One year (Oct 2027)
- Margdarshak is a working public product in **J&K and Kerala**: English + Hindi in full, Dogri voice-in, Lite mode on 2G.
- One **J&K RTO/ARTO pilot** has published its KPIs with confidence intervals; the Transport Commissioner has a decision to make, with data.
- **60 paying driving-school branches**, most of them in Kerala using Pro for HPT training logs.
- A CC-BY Indian hazard-clip bank with **≥ 200 calibrated clips** from J&K and Kerala roads, faces and plates blurred, built by a Render Workflows pipeline that anyone can rerun.
- The Nazar study and the journey test have been replicated outside Jammu and published, including any result that went against us.
- DigiLocker requester onboarding done through NeGD; VAPT done; audit-ready pack published.

### 4.2 Five years (Oct 2031)
- **10+ states/UTs** run their own tenant on NIC or a MeitY-empanelled cloud, each with its own rule pack, maker-checker approvals and a public change log.
- Margdarshak sits as an **entry card inside mParivahan or UMANG** in at least one state, using Mode B adapters that NIC operates (the RaktKhoj pattern: upgrade the existing government asset).
- Hazard-perception practice is a normal part of learning in every state that adopts an HPT; the clip bank covers hills, highways, night, fog and the junction types behind 37,782 deaths.
- Driving schools across the country use a shared, open curriculum and a Practice Record the learner owns.
- An independent, pre-registered study (academic partner + a state) has looked at novice outcomes. We report what it finds, whatever it finds.

### 4.3 Ten years (Oct 2036)
- The agent's business in licensing has shrunk to the few people who genuinely need a human helper, and those helpers (CSCs, family members) act with consent on record.
- India's licensing journey is planned, not guessed: every applicant knows the fee, documents, dates and test format before day 0, in their language.
- The **new-rider year** is a voluntary norm: a pledge, monthly hazard refreshers, first night and highway missions, with family support.
- The ontology, adapter spec and rule-pack format are open standards that other licensing and permit journeys (vehicle registration, permits, renewals) reuse.

## 5. Principles
1. **Answer before you ask.** Show the plan (classes, steps, ₹, documents, dates, warnings) before any login or form field.
2. **One screen, one decision.** One primary button per screen. Four verb tiles on the home page, not ~120 links.
3. **Show the whole road, highlight the next step.** The stage-aware home always knows where you are.
4. **Fail early and kindly.** Blockers before payment; fails are private and face-saving, with the next drill on the same screen.
5. **Code computes; AI narrates.** Eligibility, fees, timelines, scores, scam verdicts and golden-hour content are deterministic. Gemini explains, using IDs from allowlists; "unknown" is always allowed (D-09, D-10).
6. **Never pretend to be the government.** No emblem, no "official" wording, a non-affiliation footer, no government-looking domain (D-01, D-19).
7. **Never touch what isn't ours.** No Aadhaar number, OTP, biometrics or face matching; no scraping; no booking bots; no government fee collection (D-07, D-08).
8. **The state owns its data.** Host anywhere in India, export everything, leave at any time.
9. **Practice, not certification.** Scores are practice scores. No "safe" or "unsafe driver" labels. No speed, stunt or skid content (D-11).
10. **Measure in public.** Pre-register, publish the method and the result, including the parts that went against us. Claim readiness and anticipation, never mortality.
11. **Build for the worst phone and the hardest case first.** 2G, a shared phone, a parent who can't read English, a migrant whose address doesn't match.
12. **Respect attention.** At most one nudge a day, no fake urgency, repairable streaks, no public speed leaderboards (CCPA dark-pattern guidelines 2023).

## 6. Why now (sources)
| Trigger | Date | Why it matters | Source |
|---|---|---|---|
| **Kerala adds a hazard perception test** to licensing (10 clips × 10 marks, pass 60/100) and requires driving schools to give 3 months of HPT training with open-source computer tools; school inspections since 1 Oct 2026 | Circular 12 Sep 2026; in effect from 1 Dec 2026 | The anticipation skill becomes something a state tests and schools must teach; an open trainer has a buyer | `02-rules-process.md` l.91–98; [Onmanorama](https://www.onmanorama.com/news/kerala/2026/09/14/kerala-adds-hazard-perception-test-for-driving-licences-from-dec-1-first-in-india.html) (SECONDARY). No stay found as of 23 Oct 2026 (G13) |
| **MoRTH stopped Vahan/Sarathi data sharing with private entities** | 1 Oct 2026 (NIC RTI reply of 16 Oct) | A private front end that depends on government data has no future; one that the government hosts does. Our design never needed the data | [IFF, 20 Oct 2026](https://internetfreedom.in/who-reads-your-vehicle-record-nic-gave-us-numbers-morth-gave-us-a-generic-webpage/) |
| **Aadhaar Good Governance Amendment Rules** | 31 Jan 2025 | Private Aadhaar authentication needs Central Government approval, so the right design keeps eKYC on Sarathi | [Scroll](https://scroll.in/latest/1078654/it-ministry-notifies-rules-allowing-private-entities-to-carry-out-aadhaar-authentication) (SECONDARY) |
| **DPDP Rules 2025** | Most fiduciary duties from ~13 May 2027 | Purpose-bound consent and child-data rules shape the product from day one | `verification.md` row 19 (CARRIED) |
| **Online Gaming Act 2025**; Rules in force 1 May 2026 | 2025–26 | Educational, stake-free games are recognised and promoted; money games banned | [India Code](https://www.indiacode.nic.in/bitstream/123456789/22148/1/a2025-32.pdf) (SECONDARY reading) |
| **UX4G 3.0** design system and GIGW 3.0 | Current | A government-ready design language and audit path exist, so a front end can be built adoptable from day one | [ux4g.gov.in](https://ux4g.gov.in/) |
| **AI that can narrate safely** (ADK + Gemini with evals) and **durable workflows** (Render Workflows public beta 7 Apr 2026) | 2026 | Honest, evaluated coaching and long-running pipelines (clip ingest with human raters) are cheap enough for a public service | [Render changelog](https://render.com/changelog/render-workflows-now-in-public-beta); `04-ai-adk-gemini.md` |
| **The size of the problem** | 2023 data | 1,72,890 road deaths; two-wheeler riders 44.8%; ~8× crash/near-crash risk in the first 3 months of solo driving | PROJECT_BRIEF §2; [PMC3088306](https://pmc.ncbi.nlm.nih.gov/articles/PMC3088306) |
| **The agent economy** | Ongoing | ₹2k–20k for what costs ₹700 + ₹200 card in government fees for one class | `00-JOURNEY-MAP.md` row 15; CMVR r.32 |

## 7. Impact thesis
If a learner knows the whole plan before applying, is carried through every step, and practises anticipation during the 30 days the system currently leaves silent, then:
- they need no agent (fewer rupees lost, fewer bribes invited);
- they waste fewer RTO visits and fewer LLs expire;
- they pass the test more often on the first attempt;
- they leave with a measurably better anticipation score than the test alone would give them.

The department that hosts it gets a live view of where its process breaks and a cheaper counter. We measure the first four links (pre-registered, published) and treat any effect on crashes as a question for independent researchers, not a claim of ours. Detail: [IMPACT](../07-business/IMPACT.md).
