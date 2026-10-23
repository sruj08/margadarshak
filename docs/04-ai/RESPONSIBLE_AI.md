# Responsible AI
> Project: Margdarshak · Owner: AI lead + Product lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [MODELS](MODELS.md) · [AGENTS](AGENTS.md) · [PROMPTS](PROMPTS.md) · [AI_EVALS](AI_EVALS.md) · [DATA_PIPELINE](DATA_PIPELINE.md) · [PRIVACY / DPDP](../06-security-compliance/PRIVACY.md) · [THREAT_MODEL](../06-security-compliance/THREAT_MODEL.md) · [RISK_REGISTER](../06-security-compliance/RISK_REGISTER.md)
> Sources: 04 (§0 five findings, §3 verdicts); 08 (§4.10, §5.5); D-09..D-14, D-19, D-21, D-22; `research/C-judges.md` (Sambyal persona). MeitY guidelines: see §7 (SECONDARY sources, primary PDF not read).

---

## 1. Principles

1. **Code decides; AI narrates.** Eligibility, fees, timelines, scores, the scam verdict, golden hour and the class planner are deterministic code (D-09). The model chooses IDs from closed lists and writes glue text.
2. **No invented facts, structurally.** Closed outputs, number provenance, a no-digits rule in narration, and `UNKNOWN` as a first-class answer (04 §2). We prefer "we don't know" to a plausible guess.
3. **AI only where a form, table or rule can't do the job** (04's rule). Every AI feature has a non-AI fallback that says the same facts.
4. **Adults only, on the paid tier.** No AI for under-18s. No real person's data on the free tier (04 §0.1–0.2; D-13).
5. **Minimum data.** No Aadhaar, OTP, biometrics or face to any model. No audio or images stored. Telemetry is bounded and pseudonymous.
6. **Private and face-saving.** Fails and weak spots are shown to the user only. No public loss, no shame, no fear (05; 08 §4.10).
7. **Honest about limits.** On every AI surface: "AI can't book, pay or submit." Every rule shows `source` + `verified_on`. Every game is labelled "practice and familiarisation, not certification" (D-11).
8. **Humans own the content.** Clip windows, explanations, rule rows, Dogri strings and first-aid content are all human-reviewed before they ship.
9. **Measured, not asserted.** Eval gates in CI, human review weekly, and a pre-registered field study. We never claim "lives saved" (D-22).

---

## 2. Where we refused AI, and why

| Area | Decision | Why (source) |
|---|---|---|
| Eligibility, class choice, blockers (F-02, F-03, F-04) | **No AI**: rules engine | A 3-question form captures everything; an LLM adds latency, cost and risk (04 §3 "Where AI is rejected outright") |
| Fees and the "payment stuck" checklist (F-02, F-05) | **No AI**: `fees.json` (CMVR r.32) | A wrong fee is the costliest error (R-09); no rupee literal in any prompt (D-06) |
| Timeline, case clock, slot watcher (F-09, F-10) | **No AI** | Deterministic dates; server time is the source of truth (EC-15) |
| Escalation letters and the RTI template (F-13, F-14) | **No AI**: templates with filled slots | Facts only; the user approves and sends (04 §3 step 13) |
| Scam verdict (F-33) | **Rules decide; AI only explains red flags** | The model can never say "safe" or produce a verdict (04 §3.7; D-19) |
| Golden Hour first aid (F-15, G9) | **No generative AI at all**; static, medically reviewed, offline | Safety-critical; the debrief for G9 is template-only (D-14 row 12) |
| Runtime adaptive tutor that "explains rules" | **Rejected**; explanations are written offline and human-reviewed; runtime selection plus a bridge only | "Exactly where a made-up rule slips in" (04 §3.5) |
| Difficulty adaptation (ScenarioDirector) | **No runtime AI**: deterministic staircase + FSRS | Explainable, offline, testable (08 §0.6) |
| Game scoring | **No AI** | Pure TS scoring replayed server-side (08 §2.3) |
| Vehicle-buying advisor | **Rejected** | No pain cluster; it would invent prices and specs; affiliate-bias optics (04 §3.9) |
| Grounding with Google Search | **Off everywhere** | Brings back the YouTube/blog misinformation users complain about (04 §0.5) |
| Face match against the Aadhaar photo | **Cut** | A private entity can't do Aadhaar face authentication (D-07; council G1) |
| Live commentary coaching | **Cut to record-then-score** | Cost, latency, experimental Live (D-12) |
| Route-risk ("your route is safe") | **Roadmap** | Needs precise location and closed data; false reassurance (council row 7) |
| RTO Live Intel moderation by AI | **Code + humans** (k ≥ 5, no free text) | Defamation and intermediary risk (D-14) |
| Helmet strap detection | **Guided self-check**, on-device framing only | No stock model detects "strap fastened" (08 G8) |

---

## 3. Autonomy levels

Scale: **L0** = no AI. **L1** = AI suggests and a human decides every time. **L2** = AI acts inside a closed set, reversible, with confirmation for state changes. **L3** = AI acts without confirmation (closed set, low stakes). **L4** = AI acts on external systems. **No feature is L4.**

| Feature | Agent | Level | Human-in-the-loop point |
|---|---|---|---|
| Debrief narration | M-02 | L3 (text only; facts fixed by code) | Weekly human sample; the user can report |
| Coach plan wording | M-03 | L3 | Plan computed by code; user picks day and time |
| Tutor bridge | M-04 | L3 over reviewed text | Two-person review of every explanation offline |
| Voice navigation | M-01 | L3 for small jumps; **L2** for stage jumps | Spoken and visual confirmation |
| Voice field-fill | M-01 | **L2** | Read-back in both scripts plus a tap or affirmative; nothing is saved without it |
| Screen decoder | M-05 | **L1** | The user confirms the extracted values before any timeline change |
| Sign Snap | M-07 | L1 when unsure (top-3 picker), L3 when confident | The user can correct; meaning text always from the catalogue |
| Scam explainer | — | L3 (flags only; verdict L0 code) | n/a |
| Clip window proposals | M-06 | **L1** | Blur audit + two raters + adjudication; never auto-publish |
| Booking, payment, submission on Sarathi | — | **L0, never automated** | The user does it on Sarathi (F-07) |

---

## 4. Fairness analysis

**What we can and can't measure.**
- We don't collect caste, religion or income, and we won't.
- Gender is optional on the form (F-05) and is **never** sent to any model.
- So fairness is measured on **inputs we control**: language, accent, script, name origin, region, disability modes, age group (adults) and device class.

### 4.1 Slices and metrics

| Dimension | Slices | Metric | Gate [D] | Where |
|---|---|---|---|---|
| Language | en · hi · hinglish · doi | Debrief rule-ID precision; fluency; fallback rate | Precision gap ≤ 3 points; fluency ≥ 4/5 for hi and hinglish | `debrief_150` (balanced 50/50/50 across band cases) |
| Accent / dialect (voice) | Jammu Dogri, Kashmiri-accented Hindi, Punjabi-accented Hindi, standard Hindi, Indian English | Intent accuracy, slot exact-match | Max gap ≤ 10 points vs the best slice | Recorded voice set (≥ 10 per slice in Phase 3) |
| Speaker gender (voice) | women, men, (other where volunteers consent) | Intent accuracy | Gap ≤ 5 points | Recorded set: at least 40% women speakers, by design |
| Age (voice) | 18–25 (Kabir), 45–60 (Mohan-ji) | Intent accuracy, time to complete | Gap ≤ 10 points | Recorded set + journey test |
| Name origin (field-fill transliteration) | Hindu, Muslim, Sikh, Christian, Dogra and Kashmiri names; women's names with honorific variants | Exact-match after confirmation; correction rate | Correction-rate gap ≤ 5 points | 60-name synthetic list, spoken by the team |
| Region (content) | J&K hill roads vs plains; urban vs rural clips | Nazar clip difficulty calibration; false-alarm rate | Per-region empirical difficulty reported; no region > 2× the false-alarm rate | Clip bank stats (DATA_PIPELINE §2.6) |
| Disability | screen-reader users, deaf users, low vision, colour vision deficiency, motor (one-hand) | Task completion without the AI path; captions coverage | 100% of AI actions have a non-AI equivalent; captions 100% | Accessibility audit (axe + manual) |
| Device / network | ₹8–12k Android on 3G/4G vs flagship | Voice latency p90; fallback rate | Text fallback offered within 1 tap whenever p90 > 3 s | Latency harness |

### 4.2 Known risks and mitigations

| Risk | Mitigation |
|---|---|
| **Dogri speakers get a worse experience** (no Live, no TTS) | Disclosed. Hindi voice plus reviewed Dogri text; push-to-talk; a native reviewer. We **claim only Dogri voice-in** (D-21) |
| Hinglish judged "less fluent" by English-centric raters | Native Hinglish raters; a separate `hinglish` locale with its own rubric |
| Transliteration bias against less common names | Both scripts always shown; edit before save; correction rate tracked by name-origin slice |
| Women less represented in voice training data, so higher ASR errors `HUNCH` | Women ≥ 40% of the recorded eval set; gap gate |
| Hazard clips filmed only in Jammu city underrepresent rural/hill hazards | Clip quotas by road type (DATA_PIPELINE §2.2); hill-road content for J&K |
| Tone that shames failures (hurts the overconfident 19-year-old who fears failing in front of friends) | Tone lint, private debrief, face-saving copy in S6F, no outcome words in notification previews (fail follow-up TimelineEvents sent by the notifier; 08 §6) |
| Low-literacy users over-trust the AI | "AI can't book, pay or submit"; the source chip on every rule; read-back confirmations; the decoder shows "Did your screen say *this*?" |

### 4.3 Fairness audit cadence

- **Hackathon:** slices computed on the eval sets only.
- **Production:** quarterly audit by two people outside the AI team, published as a summary in the public `CHANGELOG` (D §3.3 Trust).

---

## 5. Misuse scenarios

| # | Scenario | Who | Control |
|---|---|---|---|
| MU-01 | A minor uses the AI by lying about age | P-07 | Server-side DOB from the case; year-only Aadhaar treated with the latest birthday (EC-01). Residual risk logged as R-04/R-13; parental-consent flow is roadmap |
| MU-02 | An agent/dalal uses voice or the decoder to run many clients' cases | P-04 misuse | Helper mode needs recorded consent per applicant (EC-25); rate limits per device; AI never touches Sarathi; consent revocation cascades |
| MU-03 | Someone extracts the answer key via the tutor | learners, coaching shops | Tutor works only on the user's own answered item; variants (3–6 per concept); answer-key requests flagged by P4 |
| MU-04 | Prompt injection to make the app state a fake fee or "no test needed" | scammers | Closed outputs, provenance, no rupee literals, judge; scam checker flags "no test needed" |
| MU-05 | Screenshots of a debrief used to "prove" competence | learners | Cards say "practice, not certification"; Practice Record signs only in-app events (council row 10) |
| MU-06 | Live Intel used to accuse officials | users | No free text, no names, k ≥ 5, moderation (D-14); never goes to a model |
| MU-07 | Voice used while riding | riders | Riding lock (> ~10 km/h): mic and camera disabled, "Pull over" (MV Act s.184) |
| MU-08 | Using the AI to harass or produce hate | anyone | Gemini safety categories at `BLOCK_MEDIUM_AND_ABOVE`; closed tools; voice refuses off-topic |
| MU-09 | Scraping Sarathi or slot bots via our agents | us / forks | No such tools exist; policy and code review ban them (IT Act s.43, D-08) |
| MU-10 | Bystanders identified in hazard clips | public | Blur faces and plates before any upload; 100% audit; CC-BY with blurred media; takedown on request (R-12) |

---

## 6. Explainability

### 6.1 To users

- **Debrief:** every number shows its source ("from your taps: 1.4 s after the hazard began; at 40 km/h that's ≈ 16 m"). Tapping the number opens "How we worked this out", which shows the formula (08 §0.3).
- **Readiness score:** shown as "78 = knowledge 84 − calibration 6", with a breakdown by topic (F-21).
- **Rule cards:** text plus `source_url` plus `verified_on`, on every AI-cited rule.
- **Labels:** "Coach notes" (AI) vs "Auto notes" (template), so the user always knows which they are reading (08 §5.6).
- **Unknowns:** "We don't know this one. Here's who decides: [RTO / grievance link]" (04 §2).
- **Privacy chip:** "Mic on · not stored", plus "What happens to my voice?".
- **Never sent to AI** list in the privacy centre: Aadhaar, OTP, face, name and DOB in debriefs, location.

### 6.2 To judges and auditors

- The `adk web` trace for one debrief: `load_and_gate` → `build_facts` → LLM draft → **validator rejects "₹0 fee"** → template. The demo shows a recorded trace (04 §4; 08 §5.9).
- `adk eval` report plus our gate table (AI_EVALS §3).
- A one-slide architecture with each agent's tools listed. "If the debrief agent has `get_session_score`, `get_rule(rule_id)` and nothing else, I believe the eval" (Bhagwat seat, council §2.1). Ours has no tools at all; facts are injected.
- Prompt registry with versions and hashes; the audit log of IDs chosen per debrief.

---

## 7. Alignment with MeitY's India AI Governance Guidelines (Nov 2025)

**Status of this section.**
- MeitY released the India AI Governance Guidelines on **5 Nov 2025**. They favour existing laws and sectoral regulators over a new AI law, and set out **seven "sutras"**, six pillars across three domains, and an action plan.
- Sources: [S.S. Rana summary, 14 Nov 2025](https://ssrana.in/articles/meity-unveils-indias-approach-towards-regulating-artificial-intelligence/); [Vikaspedia](https://en.vikaspedia.in/viewcontent/e-governance/digital-india/india-ai-governance-guidelines?lgn=en). These are **SECONDARY** sources: the primary PDF was not read.
- One secondary source lists the sutras differently, so the list below follows S.S. Rana.
- **[unverified]** Owner: Product lead, read the primary text before any stage claim, by H0 + 24 h.
- We say "aligned with", never "compliant with".

| Sutra (as summarised) | What Margdarshak does |
|---|---|
| **Trust is the foundation** | Source + date on every rule; "unknown" allowed; non-affiliation footer; no "official" wording (D-01, D-19) |
| **People first** (humans keep final control as far as possible) | Autonomy ≤ L3; confirmation for state changes; never acts on Sarathi; humans set clip windows and approve content |
| **Innovation over restraint** | AI used where it adds real value (voice for low-literacy users, warm Hinglish debriefs, screenshot decoding) with tight guardrails rather than banned outright |
| **Fairness and equity** | §4 slices and gates; Hindi + Dogri voice-in; low-end-device fallbacks; accessibility parity |
| **Accountability** | Named owner per agent (D-24); audit log; incident path via the CERT-In runbook; grievance officer in the privacy centre |
| **Understandable by design** | §6 explainability; "Coach notes" vs "Auto notes"; formulas shown |
| **Safety, resilience and sustainability** | Validators, fallbacks, circuit breaker; safety settings explicit; Golden Hour static; low-cost model choice (₹0.10 per debrief) |

Further points the summaries mention, and our response:
- **Grievance redressal for AI harms within a reasonable time:** the "Report a problem" button on every AI card goes to the grievance queue, with a target first response of 72 h [D].
- **CERT-In** monitoring AI vulnerabilities via its incident mechanism: our AI incidents follow the CERT-In runbook (6-h clock for reportable incidents).
- **Voluntary frameworks** (codes of practice, self-certification): this document plus a public eval summary act as our voluntary disclosure.
- **India AI Safety Institute** for technical validation: roadmap. We would offer our eval sets and the clip bank (CC-BY) for independent testing.

**EU AI Act tier:** not applicable (no EU deployment). For reference only, `HUNCH:` a driving-licence *training* aid without decision-making on licences would not be a high-risk use. Not relied on.

---

## 8. Legal touchpoints for AI (summary; detail in docs/06-security-compliance)

- **Gemini API terms:** 18+, no clients "likely to be accessed by" under-18s, paid tier for privacy (04 §0.1–0.2). The open question is logged as R-13.
- **DPDP Act 2023 + Rules 2025:** purpose-bound consent per AI feature (`ai_coach`, `voice`, `voice_fill`, `decoder`, `sign_snap`, `commentary`); children = under 18; no tracking of children (s.9(3)). Wording: "built to DPDP Rules", never "DPDP-compliant" (D-19).
- **Aadhaar Act:** no Aadhaar numbers, OTPs or biometrics, ever (D-07).
- **Online Gaming Act 2025:** stake-free educational games; the AI never awards anything redeemable.
- **CCPA dark-pattern guidelines 2023:** the coach never uses false urgency, nagging or confirm-shaming (08 §4.10).
- **IT Rules 2021:** Live Intel has no AI and no free text.

## 9. Hackathon build (Phase 1–2) vs production (Phase 3+)

| Topic | Hackathon | Production |
|---|---|---|
| Age gate | DOB-based server gate | Plus a legal opinion on "likely accessed" (R-13); verifiable parental consent flow for any minor feature (still no AI) |
| Fairness | Eval-set slices | Quarterly external audit; published summary |
| Grievance | Email + form | Named grievance officer, SLA, AI-harm category in the dashboard |
| Providers | Gemini Developer API (paid), Sarvam | Vertex AI India region under enterprise terms (legal review), Bhashini where proven |
| Disclosure | This doc + eval report in the repo | Public model and agent cards page; CHANGELOG of prompt and rule changes |
