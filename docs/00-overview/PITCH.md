# Pitch
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Pitch lead (presenter) with Product lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [DEMO_SCRIPT](DEMO_SCRIPT.md) · [VISION](VISION.md) · [PROJECT_BRIEF](PROJECT_BRIEF.md) · [BUSINESS_MODEL](../07-business/BUSINESS_MODEL.md) · [FINANCIALS](../07-business/FINANCIALS.md) · [IMPACT](../07-business/IMPACT.md) · [GOVERNMENT_ADOPTION](../10-government/GOVERNMENT_ADOPTION.md) · `docs/08-project/HACKATHON_PLAN.md`
> Inputs: `research/C-judges.md` (heat-map), `research/G-inspiration-library.md` §1.3–1.4, §3 (BWMI patterns), `research/B-sponsors.md` (Render prize), `war-room/margdarshak-verification.md` §2 (judge personas, B-column flips), D-01–D-25, `field-kit/NAZAR-FIELD-KIT.md`.
> **Judging:** 6 judges each score Innovation, Technical Execution, Design & UX, Impact and Presentation (/10); the average decides, so the job is to avoid any low score. Most judges will watch the ≤ 5-min video and open the live URL on a phone, possibly days later (C-judges, `00-source/guides.md`). The bonus Render track judges "Innovation and creativity · Effective use of Render Workflows · Technical implementation · Real-world impact · Overall user experience" (B-sponsors §0).

---

## 0. Rules for every word we say on stage (D-19, D-22)
| Never say | Say instead |
|---|---|
| "first", "India's first", "doesn't exist" | "we found none on 23 Oct 2026" |
| "official", "MoRTH app", "government app" | "an independent prototype a department could host" |
| "integrated with Sarathi / Aadhaar / DigiLocker" | "mock adapters today; the department plugs in the real ones" |
| the compliance phrase for DPDP | "built to the DPDP Rules" |
| "certified", "STQC-certified", "verified licence" | "audit-ready", "Practice Record" |
| mortality claims of any kind | "better test readiness and hazard anticipation, measured and pre-registered" |
| "safe" (as a scam verdict), "unsafe driver", "you would crash" | "not on the allowlist", "practice score", "you tapped 1.4 s late" |
| "Kerala's test" | "Kerala's announced format" |
| "₹700 per class" | "₹700 for one class + ₹200 card; a second class adds about ₹450" |
| "10+ languages" | "English and Hindi in full, Dogri voice-in" |

Every rupee figure on screen comes from `fees.json` (CMVR r.32, checked 22 Oct 2026). The non-affiliation footer is visible in every screenshot and on the live URL.

---

## 1. The 30-second explanation (Karp: say what it is, who it's for, why it wins)
> "Margdarshak is a citizen front end for India's driving licence that a state can host. In three taps it tells you your exact plan: class, fee, documents, earliest test date. It carries you from learner's licence to licence, so you don't need an agent. And during the 30 days the system leaves silent, it trains the one skill India's test never checks: seeing danger before it happens. We tested it on real people this weekend. [X]% of [N] licence holders would fail Kerala's new hazard test. The government plugs in the real systems; we ship the socket and the spec."

**One sentence:** *The journey is the body; Nazar is the heart.*

---

## 2. The 3-minute pitch (Jobs structure: villain → hero → demo → "one more thing")
Live URL on the projector, phone mirrored. Timings are hard caps.

| Time | Beat | What's on screen | Words (say these) |
|---|---|---|---|
| 0:00–0:20 | **Villain: the portal** | The real parivahan.gov.in homepage, live, mega-menu open | "This is where a 19-year-old in Jammu starts. About 120 links. SLD Maker, Homologation, press coverage from 2019. Find 'apply for a learner's licence'. You have ten seconds." *(pause 3 s)* |
| 0:20–0:35 | **Villain: the agent** | Photo-free quote card: "₹4,000. Agent, Jammu. Our journey-test participant P0x" (or the persona card "Kabir" if no consented quote) | "So he pays an agent ₹4,000. The government fee for one class is ₹700 plus ₹200 for the card. And when he finally gets his licence, nobody has checked whether he can see a bus pulling out." |
| 0:35–1:00 | **Hero: 3 taps** | Margdarshak home (Hindi) → plan: age 19 · motorcycle + car pictures · J&K → plan card (MCWG + LMV-NT) | "Margdarshak. Three taps. His plan: bike and car on one learner's licence, ₹1,150 plus the ₹200 card, the documents, the earliest driving test on day 31, and every number with its source. Send to WhatsApp." |
| 1:00–1:15 | **Voice** | Mic: "Papa 52 saal ke hain, unko car ka licence chahiye" → Form 1A card + Helper mode | "His father needs one too. One sentence in Hindi. It knows Form 1A is needed over 40, and it opens Helper mode with consent on record. It can't pay, book or submit. That's on purpose." |
| 1:15–1:35 | **Apply + photo fixer** | One question per screen → bad selfie → fixed to spec → Check your answers → hand-off to Sarathi (labelled simulated) | "One question per screen, saved as he goes. A bad selfie fixed on the phone. Check your answers before paying, because the portal locks edits after payment. Aadhaar and payment stay on Sarathi." |
| 1:35–1:50 | **Readiness → day 31** | Readiness "78 = knowledge 84 − calibration 6" → persona switcher → "LL day 31" home: "Book your driving test" | "Readiness, honestly computed. Now it's day 31. The home screen changes by itself." |
| 1:50–2:20 | **Heart: Nazar** | Nazar clip (Jammu road) → tap → debrief: "You tapped 1.4 s late ≈ 16 m at 40 km/h. Next time scan parked buses." Provenance chip "numbers from scorer" | "Kerala starts a hazard perception test on 1 December. Ten clips, sixty to pass. These are Jammu roads. He tapped 1.4 seconds late. At 40 km/h, that's 16 metres. Code computed that; the AI only explains it." |
| 2:20–2:45 | **Proof** | Evidence slide: before/after + field numbers | "We ran it on real people this weekend. [X] of [N] licence holders scored below 60, and their licence-quiz scores didn't predict it: r = [Y]. On our journey test, full success went from [k₁]/[n] to [k₂]/[n], median [a] to [b] minutes. Pre-registered, commit [hash]." |
| 2:45–3:00 | **One more thing + close** | QR on screen: "Take the 3-minute hazard test" | "One more thing: you can take it now. Scan this. Learner se licence tak, bina agent ke." |

**If a number came out against us:** say it. "Our hypothesis was 30% or more. We got [X]%, with a confidence interval of [a–b]. Here's what we changed."

---

## 3. The 5-minute pitch (full script)
Same arc, with the Render Workflows beat, the adoption frame and the business model.

### 3.1 0:00–0:40 — The pain (villain)
- **Screen:** parivahan.gov.in live; open "Online Services" mega-menu; scroll past "SLD Maker", "VLTD Maker", "Homologation"; show the red "SYSTEM HACKED" fraud banner.
- **Say:** "This is where every licence in India starts. About 120 links; roughly one in ten is about a first licence, and none says 'start here'. The first image a nervous applicant sees is a 'system hacked' banner. Judges, find where to apply for a learner's licence. Ten seconds." *(pause)* "Kabir is 19, first year of B.Tech in Jammu. He wants a bike now and a car later. An agent quoted him ₹4,000. The government fee for one class is ₹700 plus ₹200 for the smart card. Agents across India charge ₹2,000 to ₹20,000, because the journey has no owner except them."
- **If we have a consented, audio-only quote** from the journey test: play 6 seconds of it here.

### 3.2 0:40–1:30 — Answer before you ask (hero)
- **Screen:** Margdarshak home: language first (each in its own script), one headline, four verb tiles, a mic, the trust line "Govt fee for one vehicle class: ₹700 + ₹200 card (your state may add a service charge). Never pay agents."
- **Taps:** हिन्दी → "Get my first licence" → age 19 → motorcycle-with-gears + car pictures → Jammu & Kashmir.
- **Plan card:** classes MCWG + LMV-NT on one LL; fee breakdown ₹1,150 + ₹200 card with "source: CMVR r.32, checked 22 Oct 2026" and "your state may add a service charge"; documents; maximum RTO visits; earliest DL test day 31; LL valid 6 months; low-confidence rows marked "verify at your RTO".
- **Say:** "Three taps, no login. Every number on this card is computed from the rules file with its source. The class planner puts bike and car on one learner's licence; if he'd otherwise do them one after the other, that saves him a second application and a second 30-day wait. Send to WhatsApp." *(tap; phone buzzes via n8n)*
- **Optional 5-second aside (Tanvi persona, EC-02):** switch age/address example to show the "Aadhaar address in another district" warning, only if time allows.

### 3.3 1:30–2:15 — Voice and family
- **Screen:** mic → "Mere papa 52 saal ke hain, unko car ka licence chahiye."
- **Result:** Hindi voice reply + card: LMV-NT, Form 1A medical certificate (age > 40), steps, "Start in Helper mode"; source chips with rule IDs.
- **Say:** "His father needs a car licence. One sentence in Hindi. The guide finds Form 1A because he's over 40, and opens Helper mode with consent recorded. The voice guide can navigate and fill fields inside Margdarshak. It cannot submit, pay or book on Sarathi. Dogri speech works too."

### 3.4 2:15–3:00 — Apply without errors
- **Screen:** guided LL application, one question per screen with "why we ask" → photo fixer (bad selfie: dark background, tilted) → auto-crop, background whitened, size checked → "Check your answers" with Change links → fee breakdown → "Continue on Sarathi" hand-off screen labelled "simulated: in production this step runs on Sarathi".
- **Say:** "Today it's about 16 screens, six captchas and four OTPs, and nothing is saved. Ours is about six screens, auto-saved. The photo is fixed on the phone; no image leaves it. 'Check your answers' comes before payment, because Sarathi locks edits after paying. Aadhaar, OTP and payment stay on Sarathi. Since 1 October MoRTH stopped sharing Vahan and Sarathi data with private companies. Good. Our design never needed it."

### 3.5 3:00–3:45 — The 30-day bridge and the heart (Nazar)
- **Screen:** Readiness "62" → practise 5 weak signs → "86 = knowledge 90 − calibration 4"; LL simulator guided first run (2 seconds). Persona switcher → "LL day 31": home now says "Book your driving test", slot finder with "notify me if an earlier slot opens".
- **Screen:** Nazar: Jammu clip; tap; debrief card: "How you did · where you lacked · what you could have done · your next drill": "You tapped 1.4 s late ≈ 16 m at 40 km/h. You missed the door opening twice. Next time scan parked cars." Provenance chip: "numbers computed by scorer, narrated by AI".
- **Say:** "Day 31. The home screen knows. Now the part India's test never checks. Kerala starts a hazard perception test on 1 December: ten clips, ten marks each, sixty to pass. These are Jammu roads, filmed by passengers, faces and plates blurred. 1.4 seconds late at 40 km/h is 16 metres. The scorer computed that. Gemini only explains it, choosing from a list of findings. If a number in its text didn't come from the scorer, it's replaced. We run 30 eval cases per agent in CI."

### 3.6 3:45–4:15 — Render Workflows (sponsor beat, 20–30 s)
- **Screen:** Render dashboard → Workflows → Runs: `ingest_clip` parent run fanning out to `transcode → blur → propose_windows → await_two_raters → compute_agreement → publish`, one child retrying after an injected failure; then the n8n canvas: Schedule Trigger → Render run-task API → `journey_sweep` → WhatsApp.
- **Say:** "Every clip goes through a durable pipeline on Render Workflows: transcode, blur faces and plates, Gemini proposes hazard windows, two humans rate, we compute agreement, then publish. Here's a real run retrying after a failure we injected. Workflows has no cron, so n8n's schedule triggers the case clock: LL-expiry warnings, the test-eve checklist, approval chasers."

### 3.7 4:15–4:45 — Proof and adoption
- **Screen:** evidence slide (before/after + field numbers), then the one-slide adoption frame.
- **Say:** "Evidence from this weekend, pre-registered before any data: [X]% of [N] licence holders scored below 60; quiz scores didn't predict it, r = [Y], CI [a, b]; after feedback, scores on fresh clips rose by [d]. Journey test with [n] first-time applicants: full success [k₁] → [k₂], median time [a] → [b] minutes, SUS [s₁] → [s₂], and 'would still pay an agent' [p] → [q]. Convenience sample, stated. Who pays? Citizens never. Driving schools first: Kerala requires three months of hazard training and inspects schools. States pay for hosting support, not code: it's Apache-2.0, containerised for MeghRaj, and the state owns the data."

### 3.8 4:45–5:00 — Close
- **Screen:** QR "Take the 3-minute hazard test" + tagline + team + non-affiliation line.
- **Say:** "Scan it and see if you'd pass Kerala's format. Learner se licence tak, bina agent ke."

---

## 4. Render Workflows prize angle
**What the Render seat is looking for (B-sponsors §7; verification §2.1):** work that outlives a request, survives failure with retries, fans out in parallel, or runs later and repeatedly. A single synchronous LLM call wrapped in a task is decorative.

| Workflow | Load-bearing because | What we show | Criterion it scores |
|---|---|---|---|
| **`ingest_clip` (headline)**: transcode → blur faces/plates (M-09) → `propose_windows` (Gemini video, M-06, ±1 s) → `await_two_raters` → `compute_agreement` → `publish` | Long (minutes per clip), failure-prone (video, model 429s), parallel per clip, waits for humans | Runs page with a parent fanning into children and one **injected retry** | Effective use; technical implementation; innovation |
| `field_stats_nightly`: % < 60 with Wilson CI, r with Fisher-z CI, pre/post gain | Batch with retry; feeds the live counters (API-71) | The stats card updating | Real-world impact |
| `debrief_fanout`: score each scenario in parallel → assemble → narrate → n8n WhatsApp card | Fan-out + retry on Gemini 429 | One session's debrief landing on a phone | UX |
| `journey_sweep`: LL day 25 "book now", LL-expiry T-30/T-7, test-eve checklist, approval-stall letter | "Later and repeatedly"; **n8n Schedule Trigger → Render run-task API**, because Workflows has no cron | n8n canvas screenshot + WhatsApp on a real phone | Effective use; impact |

**Design facts we can defend:** each task run gets its own instance; retries default to 3 with exponential backoff; runs over compute limits queue rather than fail; Hobby allows 50 root runs/min, so we fan out through chained runs (1,000/min); run duration up to 24 h; flex compute at $0.20/CPU-h + $0.05/GB-h, no charge when idle (B-sponsors §1, [Render Workflows limits](https://render.com/docs/workflows-limits)). The tasks sit behind a `JobRunner` interface so a government cloud can run them on Celery or Temporal-style infrastructure (D-17).

---

## 5. Slide-by-slide deck outline (12 slides + appendix)
| # | Title | Content | Judge it targets | Visual |
|---|---|---|---|---|
| 1 | **Learner se licence tak, bina agent ke.** | Name, tagline, team Chanakya, QR "take the 3-minute hazard test", non-affiliation line | All | Dark road at dusk, a bus pulling out (our clip still, blurred) |
| 2 | **~120 links. ₹4,000 to an agent.** | Homepage screenshot with link counts by menu; the agent price vs ₹700 + ₹200 card; ~16 LL screens, ~6 captchas, nothing saved | Gaur, Dutta | Annotated screenshot |
| 3 | **Nobody owns the timeline.** | LL 6 months · 30-day minimum · slot wait · 7-day retest gap · remedial training · approval limbo → typical 2.5–4 months, worst 6–12+ | Gaur, Tickoo | Timeline with collision points |
| 4 | **The test never checks anticipation.** | 1,72,890 deaths (2023); two-wheelers 44.8%; ~8× crash/near-crash risk in the first 3 months; Kerala HPT from 1 Dec 2026 | Sambyal, Dutta | One big number + Kerala format icon |
| 5 | **One road, one next step.** | Stage map S0–S9 with the stage-aware home; three deep slices highlighted | Gaur, Dutta | Flow diagram |
| 6 | **Three taps → your plan.** | Plan card screenshot with fee line items and sources | Rutvik, Gaur | Phone mock-up |
| 7 | **Nazar: 1.4 s late ≈ 16 m.** | Clip still, tap timeline, debrief card, provenance chip | Sambyal, Tickoo | Timeline graphic |
| 8 | **Responsible AI.** | Code computes, Gemini narrates; allowlisted IDs; provenance guard; ≥ 30 evals per agent (pass rate [z]%); 18+ gate; "never sent to AI" list (Aadhaar, OTP, face); AI can't submit, pay or book | Sambyal | Boundary diagram: green (code) vs blue (AI) |
| 9 | **Evidence from this weekend.** | Nazar: n, % < 60 (95% CI), r (95% CI), pre/post; journey test: k/n, minutes, SUS, agent intent; before/after metrics; pre-registration hash; "convenience sample" footnote | Tickoo, Gaur | One chart: score distribution with the 60 line |
| 10 | **Architecture (who built what).** | Next.js 16 PWA · FastAPI + ADK 2.12 · Postgres 16 · Node score verifier · Render Workflows · n8n edge · adapters (mock/real). Each box has a team member's name (D-24) | Dutta, Kapoor | C4 container diagram |
| 11 | **Built to be hosted by a state.** | Adapter spec · Apache-2.0 · MeghRaj-ready containers · state owns data · audit-ready pack · J&K pilot plan · "MoRTH stopped private data sharing on 1 Oct 2026; our design never needed it" | Kapoor, Dutta, Rutvik | Plug-and-socket diagram |
| 12 | **Who pays.** | Citizens: never · Driving schools: Pro (Kerala HPT duty) · States: support licence · CSR/grants · Insurers: roadmap line only | Rutvik | Four columns |
| A1 | Render Workflows | Runs page screenshot with the retry; n8n canvas | Render seat | Screenshots |
| A2 | Performance | p95 per endpoint (measured), Lite mode KB on 3G, cold-start note, load-test result | Kapoor | Table |
| A3 | Edge cases | EC-01..EC-30 grid with screen state per case | Dutta, Sambyal | Grid |
| A4 | Unit economics | School LTV/CAC (HUNCH), cost per citizen journey ≈ ₹24–28 | Rutvik | Table |
| A5 | Accessibility | WCAG 2.1 AA checks, 48 px targets, screen-reader alternative to clips, ≤ 3 flashes/s | Dutta, Kapoor | Checklist |

**Video (≤ 5 min) structure** follows the BWMI winner's formula (G §1.4, §3 row 11): minute 1 is one continuous citizen run-through on a phone; then the Nazar beat; then build and evidence.

---

## 6. Judge Q&A bank
Answers are short enough to say in one breath. "[fill]" means a number measured on demo day. Owners: the team member who owns that module answers (D-24).

### 6.1 Shubham Gaur — Product Manager, Metropolis Healthcare (IIT Jammu alumnus)
*Lens: who is the user, what metric moves, usability, real-world impact (C-judges §1).*
| # | Question | Answer |
|---|---|---|
| 1 | Who exactly is the user? | Kabir: 19, first-year B.Tech in Jammu, Android, Hinglish, quoted ₹4,000 by an agent, wants a bike now and a car later. Everything is designed for him first. |
| 2 | What metric moves if this ships? | Our north star is ready, agent-free licences per month. The metrics you can see today: first-screen choices ~120 → 4, LL screens ~16 → ~6, and on our journey test full success [k₁] → [k₂] out of [n]. |
| 3 | What did you measure with real users? | A journey test with [n] first-time applicants (lab replica of the observed Sarathi sequence vs ours, counterbalanced) and a Nazar study with [N] licence holders. Both pre-registered. |
| 4 | Where do users drop off today, and how do you know? | At class choice, uploads, payment-pending and the 30-day silence. That comes from our journey map of 16 pain rows from FAQs, consumer complaints and news, and from watching people on the replica. |
| 5 | Why would anyone use this instead of NextGen mParivahan? | mParivahan is a document wallet with 100M+ downloads; its listing doesn't describe applying for an LL or DL. We're designed to sit inside it as an entry card, not compete with it. |
| 6 | What's the one moment you want users to remember? | The plan card: your exact fee, documents and earliest test date before you've typed anything. |
| 7 | What did you cut? | Route-risk maps, live commentary coaching, face match, the "10+ languages" claim, any booking bot. Three slices go deep; everything else works thin with no dead buttons. |
| 8 | How do you retain users across a 2.5–4-month journey? | The case clock: day-25 "book now", LL-expiry warnings from day 150, test-eve checklist, all on WhatsApp, at most one a day. The home screen changes by stage. |
| 9 | What happens after they get the licence? | The new-rider year: a voluntary pledge, a 2-minute monthly hazard refresher, first night and highway missions, and family mode for parents' renewals. |
| 10 | How would you run a pilot? | One J&K RTO/ARTO, 2 weeks baseline, 6 weeks live with a counter QR and CSC helpers, 4 weeks follow-up. KPIs: counter queries, LL expiries before a test, rejections, first-attempt pass rate. |
| 11 | What's your success threshold for the pilot? | Set before baseline: counter queries about fees and documents down ≥ 20%, LL expiries before a test down ≥ 30% for our users, no data incident. |
| 12 | How do you onboard someone who isn't digital? | Helper mode: a sibling or CSC operator acts with recorded consent, and "clear this device" at the end. Voice in Hindi and Dogri. |
| 13 | Why three taps and not a chatbot? | Answers must be exact. Three taps cover age, vehicle and state, and a rules engine gives the same answer every time. Voice is there for people who prefer to speak. |
| 14 | What's the hardest UX decision you made? | Making "book anyway" always visible even when readiness is below 85. The gate is advice, not a wall. |
| 15 | How do you know the plan card is right? | Every rule row has a source, a verified date and a confidence flag; a maker-checker approves changes; the card says "verify at your RTO" where confidence is low. |
| 16 | What if the user's state isn't covered yet? | The engine has all classes for the CMVR base pack; state overlays show "we don't know for your RTO yet" honestly, with the base rules. |
| 17 | What's the analogue in healthcare you'd recognise? | Registration → token → sample → report. Ours is plan → apply → test → licence, with a tracker like a parcel or a lab report. |
| 18 | How will you prioritise after the hackathon? | By the north star: whatever most increases ready, agent-free licences. First the J&K pilot and Kerala schools, then DigiLocker onboarding. |
| 19 | How do you measure satisfaction? | SUS in the journey test (68 is average); in production, a one-question exit survey at S7 and "would you still pay an agent?". |
| 20 | What would make Kabir stop using it? | A wrong fee, a nag, or a feeling of being tracked. That's why fees are computed with sources, nudges are capped at one a day, and there's no trip tracking. |
| 21 | What's next week, concretely? | Clean the repo, keep the Nazar challenge open, send a letter to the RTO/ARTO, and run 20 discovery calls with Kerala schools. |

### 6.2 Dr Nitigya Sambyal — Asst Prof CSE, Thapar; ex-postdoc Uppsala; co-editor, *Responsible AI: Principles and Practices* (Wiley, 2026)
*Lens: AI honestly scoped, evaluated, private; she will spot an LLM wrapper (C-judges §2; verification §2 row 2).*
| # | Question | Answer |
|---|---|---|
| 1 | Your AI says "1.4 s late". Who computed that? | Code. The scorer compares the tap time with the two-rater hazard window on `video.currentTime`, and converts seconds to metres at the logged speed. Gemini receives those numbers as tool output and only writes the sentence. |
| 2 | What if the model invents a number? | A provenance guard checks every ₹, day, age, metre and second in the output against the tool results. Anything that didn't come from a tool is replaced, and "unknown" is always allowed. |
| 3 | How do you evaluate the AI? | ADK evals with at least 30 cases per agent in CI: correct finding IDs, zero invented numbers, refusal on out-of-scope. On demo day: [pass]/[total] for the debrief agent. |
| 4 | What does the debrief agent have access to? | Two tools: get the session score and get a rule by ID. It chooses findings from a per-request allowlist of IDs. Nothing else. |
| 5 | What happens when the AI is down? | Template fallback (EC-29). The numbers are already computed, so the debrief still shows them. |
| 6 | Where is AI deliberately not used? | Eligibility, fees, timelines, scores, the scam verdict, the class planner and the golden-hour first-aid card. Those are deterministic or static. |
| 7 | How do you keep minors away from the AI? | Gemini's terms require 18+. Under-18 users get rules-only features: no AI, no telemetry, no streaks, no squads. The gate is server-side on DOB. |
| 8 | What personal data goes to Google? | None of the never-list: no Aadhaar number, OTP or face. Client-side regex redaction plus the ADK PII plugin if someone types them (EC-20). We use the paid tier, so prompts aren't used for human review as on the free tier. |
| 9 | Is voice audio stored? | No. It's streamed for transcription and discarded; transcripts are not used for training. |
| 10 | How well does it work in Dogri? | Dogri is speech-in only, through Sarvam Saaras, and the user sees the transcribed text before anything happens. We tested on [n] team recordings; we don't claim Dogri replies. |
| 11 | Could the voice guide take a harmful action? | It has a closed action enum: navigate and fill fields inside Margdarshak. It cannot submit, pay or book on Sarathi; there's no tool for it. |
| 12 | How are the hazard windows set? Isn't that subjective? | Gemini proposes a window offline; two humans set the final windows independently; we report inter-rater median \|Δonset\| (pre-registered H4 ≤ 0.5 s) and drop clips that disagree. |
| 13 | Is the hazard score biased against some users? | Possible sources: screen size, video buffering, motor impairment. We preload the full MP4, score on `video.currentTime`, and give screen-reader users an audio-described alternative, not a hard block. We'll report scores by device class. |
| 14 | What about photosensitivity? | ≤ 3 flashes per second (WCAG 2.3.1) and a reduced-motion mode. |
| 15 | How do you stop people gaming Nazar? | Pattern-clicking scores zero, as in the UK test; more than 3 taps a second is excluded; false alarms are penalised. |
| 16 | Isn't gamification manipulative? | XP only for learning, diminishing after 45 minutes a day, repairable weekly streaks, no public speed leaderboards. The 13 CCPA dark patterns are banned by lint. |
| 17 | The screenshot decoder reads Sarathi screens. What if it misreads? | It must match a verified error catalogue; if it can't, it says "unknown" and shows the screen's own text. It never tells the user to do something irreversible. |
| 18 | What's your model card? | Each agent M-01..M-09 has intended use, limits, fallback and eval set in `docs/04-ai/MODELS.md`. For example, Sign Snap confirms against our sign catalogue and says "not sure" below a threshold. |
| 19 | How do you handle prompt injection in screenshots or voice? | Model output can only pick IDs from allowlists, and tools are read-only. An injected instruction can't make it state a fee, because fees never come from the model. |
| 20 | Does the AI give medical advice in the golden-hour card? | No AI there at all. It's static content: call 112, the s.134A Good Samaritan protection, four do/don't steps from a cited source, "not medical training". |
| 21 | How do you know the training helps? | We don't claim road outcomes. We pre-registered three things: the share below 60, the weak correlation with quiz scores, and a pre/post gain on fresh clips. Crash research (UK HPT, NHTSA trial) is cited as the reason, not as our result. |
| 22 | Where are the bystanders' faces? | Blurred on the pipeline before publishing, audited 100% by a human, raw footage deleted after the blur check. |

### 6.3 Dr Simmi Dutta — HoD Computer Engineering, GCET Jammu (co-host)
*Lens: a working end-to-end system, clear architecture, the team understands its code, social relevance for J&K, women and rural users (C-judges §3).*
| # | Question | Answer |
|---|---|---|
| 1 | Show me the architecture. | Next.js 16 PWA → FastAPI backend with Google ADK agents → Postgres 16 → a Node verifier that replays game sessions → Render Workflows for durable jobs → n8n only for WhatsApp and schedules → adapters with mock and real versions for Sarathi, DigiLocker, Bhashini, payment and notifications. *(slide 10)* |
| 2 | Which part did *you* build, versus the AI tool? | Each module has an owner on slide 10, and each of us can open the code and explain it. [Owner names per module.] We used AI coding tools as assistants and say so in the README. |
| 3 | Walk me through what happens when I tap "J&K" on the plan. | The client sends age, classes and state to API-01. The rules engine loads the CMVR base pack plus the J&K overlay, checks eligibility per class, computes fees from `fees.json`, runs blocker rules, and returns the plan with rule IDs and sources. No AI. |
| 4 | How is this relevant to J&K? | Jammu roads in the clips, hill-road content for NH44, Dogri voice-in, the J&K rules (online LL at home or a CSC), and a pilot plan with one J&K RTO/ARTO. |
| 5 | What about women and rural users? | Helper mode for assisted applications, Hindi in full, Lite mode under 300 KB on 2G, picture-based class choice, and a migrant path for an Aadhaar address in another district, the case of students like our persona Tanvi (Aadhaar in Kathua, studying in Jammu). |
| 6 | Does it work offline? | Mock tests and cached clips work offline in the PWA; drafts save locally and sync. A Sarathi outage shows a status banner without data loss (EC-11). |
| 7 | How do you handle edge cases? | Thirty listed cases, EC-01..EC-30, each with a rule row or screen state and a test, e.g. Aadhaar showing only the year of birth, turning 40 mid-journey, a 17-year-old. |
| 8 | How do you test it? | Unit tests for rules and scoring, contract tests that mock and real adapters must both pass, Playwright end-to-end, axe accessibility checks, and AI evals in CI. |
| 9 | What's your database design? | 31 entities (E-01..E-31). Contacts are encrypted and kept separate from cases; there are no document images; licence numbers are hashed with the last 4 kept. |
| 10 | Why a PWA and not a native app? | Judges and citizens open a link; no install, works on low-end Android, and it can't be confused with the fake "apply" APKs that circulate. |
| 11 | How do you keep rules up to date? | A rule-pack studio with maker-checker approval: one person proposes, a second approves, and every row shows source and date. Changes mid-case trigger a notice (EC-27). |
| 12 | How secure is it? | OWASP ASVS L2 and OWASP LLM Top 10 checklists, PII redaction in logs, rate limits, and an audit log of every action. We say audit-ready, not certified. |
| 13 | Can it handle grievance and accountability? | It drafts facts-only escalation letters and an RTI template; corruption reports deep-link to the vigilance channel and CPGRAMS. We never host accusations. |
| 14 | Is there a README so I can run it? | Yes: clone, copy `.env.example`, `docker compose up`, seed data. It notes that the first load on Render can take up to a minute. |
| 15 | What was hardest technically? | Scoring taps fairly on video over a slow network: we preload the whole MP4 and score against `video.currentTime`, then replay the session on the server so client scores can't be faked. |
| 16 | What's mocked and what's real? | Real: rules engine, plan, application flow, photo fixer, learning, Nazar scoring, AI debrief, Workflows, WhatsApp via n8n. Mocked and labelled: Sarathi, DigiLocker, Aadhaar, payment, slots. |
| 17 | Could GCET students keep building this? | Yes. It's Apache-2.0 with contract tests, so a student team can implement a new state rule pack or adapter without touching the core. |
| 18 | Could it be used in teaching road safety? | The 22-module curriculum and the mini-games work as classroom material; the clip bank is CC-BY. |
| 19 | How do you handle deaf or blind applicants? | The hazard game is visual-only, which suits deaf users; blind users get an audio-described alternative path. Captions, screen-reader labels, 48 px targets, a rights card for adapted vehicles (EC-13). |
| 20 | How does a state adopt it? | Host the containers on NIC or MeghRaj, configure a tenant and rule pack, start with a deep-link hand-off to Sarathi, and switch to NIC's adapter later without code changes. |
| 21 | What happens with a shared phone at a cyber café? | Helper mode with recorded consent, auto-logout, and "clear this device" (EC-14). |

### 6.4 Rutvik Gupta — Product Owner, Aditya Birla Capital (lending, payments, API products)
*Lens: who pays, real APIs and data sources, correct money maths (C-judges §4; verification §2 row 4).*
| # | Question | Answer |
|---|---|---|
| 1 | Who pays? | Citizens never. Driving schools pay first, for a Pro tier (HUNCH ₹799 a month per branch). States pay for implementation and support (HUNCH ₹15–40 lakh a year), not for code. CSR and grants fund the public-good parts. Insurers are one roadmap line. |
| 2 | Why would a school pay? | Kerala's circular of 12 September requires three months of hazard-perception training with open-source computer tools, and RTOs inspect schools. Pro gives them a signed HPT log per student. |
| 3 | Is this on real APIs? | No, and we say so. Sarathi, DigiLocker, Aadhaar and payment are mock adapters with the same contracts a department would implement. Since 1 October MoRTH stopped private data sharing (NIC RTI reply); our design never needed it. |
| 4 | So where does the data come from in real life? | The citizen, with consent: what they type, plus DigiLocker pulls once NeGD onboards us as a requester (OAuth with PKCE, `partners.DRVLC`). In a government tenant, NIC's adapter. |
| 5 | Check your fee maths. | One class: LL ₹150 + LL test ₹50 + DL test ₹300 + DL ₹200 = ₹700, plus ₹200 smart card. A second class adds ₹450 (LL ₹150 + DL test ₹300), so two classes are ₹1,150 + ₹200 card = ₹1,350. CMVR r.32; states may add service charges. |
| 6 | Do you collect any money? | Never government fees: those stay on Sarathi or the state gateway. The only money we take is the school subscription, on UPI AutoPay. |
| 7 | What are your unit economics? | HUNCH: school LTV about ₹15,000 (₹799 × 75% margin × 25 months), CAC about ₹3,500, payback under 6 months. A citizen journey costs us about ₹24–28 to serve. |
| 8 | What's your biggest revenue risk? | The Kerala HPT being stayed; the school-owners' Samithi plans a challenge. Pro still works as progress tracking and parent updates, and J&K and automated-track states are the second market. |
| 9 | When do you break even? | In our model, Year 3, if one state signs in Year 2 and two more in Year 3. If no state signs, the school business alone doesn't cover a 16-person team; we've modelled that. |
| 10 | How does a state buy from a startup? | GeM: DPIIT startups get relief on prior experience, turnover and EMD where the tender allows it, and the Startup Runway covers products without a category. The pilot is free to the state, funded by grants. |
| 11 | What's the API product here? | The adapter specification: OpenAPI 3.1, versioned, idempotency keys, mutual TLS for the government side, contract tests every implementation must pass. |
| 12 | How do you version the adapter contract? | `/v1` paths, backward-compatible changes only within a major version, and contract tests pinned per version so a state can upgrade the core without breaking NIC's adapter. |
| 13 | Is there a consent layer like the Account Aggregator? | Yes: DEPA-style consent artefacts with purpose, fields, recipient and expiry, revocable, for every data share. |
| 14 | Any lending hook? | No loans or insurance selling. The first-vehicle checklist explains third-party cover and the ₹15 lakh PA cover factually. Mixing a learner's licence with credit selling would damage trust. |
| 15 | What would insurers get? | A user-held Practice Record shared with consent: practice hours and modules completed. Never priced on a game score (Online Gaming Act), never called a driver rating. IRDAI review first. |
| 16 | What's your pricing evidence? | Not yet. ₹799 is a hypothesis within the ₹499–999 range from our school research. We'll run a Van Westendorp survey with 30 owners in November. |
| 17 | How do you go from UAT to go-live with a state? | Discovery on site, rule pack approved by maker-checker, pre-audit pack, VAPT by an empanelled auditor, safe-to-host certificate, then a pilot RTO before state-wide rollout. |
| 18 | What's the payment-pending flow? | EC-09: a screen that explains the status, what not to do (don't pay twice), when to contact the cashier, and a complaint template, reconciled by receipt number. |
| 19 | What stops a competitor copying you? | The calibrated clip bank and its pipeline, versioned state rule packs, per-RTO data with k ≥ 5, and trust. The code is open; the operations are the moat. |
| 20 | What funding do you need? | Non-dilutive first: SISFS (₹20 lakh grant, ₹50 lakh debt), the J&K startup seed scheme, MeitY TIDE 2.0. We must apply to SISFS before taking more than ₹10 lakh from other government schemes. |
| 21 | Why should the state pay you if the code is free? | Because it's buying accountability: configuration for its reality, rule-pack upkeep, 24×7 support, audits and a clean exit. |

### 6.5 Dr Yuganshu Tickoo — Asst Prof, Sharda School of Business Studies (business analytics, service quality)
*Lens: evidence with n, measurement, one decision-driving chart (C-judges §5; verification §2 row 5).*
| # | Question | Answer |
|---|---|---|
| 1 | What does your data show? | [X]% of [N] licence holders scored below 60/100 (95% Wilson CI [a–b]); the correlation with the LL quiz was r = [Y] (Fisher-z CI [c, d]); after feedback, scores on fresh clips rose by [g] (one-sided Wilcoxon p = [p]). |
| 2 | What's your sample? | A convenience sample of [N] adults, 18+, from Jammu and Punjab colleges, recruited through WhatsApp groups. We state that on the slide. |
| 3 | Was it pre-registered? | Yes. `HYPOTHESES.md` was committed after the hackathon started and before any data; the hash is on the slide. H1 ≥ 30% below 60; H2 \|r\| < 0.3; H3 pre/post gain; H4 inter-rater ≤ 0.5 s. |
| 4 | Why Wilson intervals? | With small n and proportions near the edges, Wilson behaves better than the normal approximation. |
| 5 | With n = 40, can you detect anything? | We can estimate a proportion to about ±15 points. For the correlation, a CI tells you more than a p-value at this n, so we show the CI. We don't over-claim. |
| 6 | What about selection bias? | Students who like challenges self-select, so we probably *over*-estimate scores. That makes "X% below 60" conservative, but we say it's a convenience sample. |
| 7 | How do you know the clips are valid? | Two raters set windows independently, and we report inter-rater agreement. They're our clips, not Kerala's, so we compare to the format, not the test. |
| 8 | Is the pre/post gain just practice with the interface? | Partly, possibly. That's why the post clips are fresh and matched on difficulty, and the first run is guided. We report it as a learning effect within the session, not long-term. |
| 9 | Exclusions? | Sessions under 60 s total, more than 3 taps per second, or declared under 18. Defined before data. |
| 10 | Test-retest? | If at least 8 people retake, we report test-retest r. Otherwise we say we don't have it yet. |
| 11 | What did the journey test show? | [n] first-time applicants, counterbalanced: full success [k₁] → [k₂] (exact McNemar), median time [a] → [b] min (Wilcoxon), SUS [s₁] → [s₂] (paired t with CI), "would still pay an agent" [p] → [q]. Every participant's row is in the appendix. |
| 12 | What's SUS and what's a good score? | System Usability Scale, 10 items; 68 is average. We pre-registered B ≥ 75 and A ≤ 55. |
| 13 | What's the one chart that drives a decision? | For a Transport Commissioner: LL expiries before a test per RTO. For learners: the Nazar score distribution with the 60 line. |
| 14 | What decision would a department take from your console? | Where to add test capacity, which document check to publish, which fail reason to target in training, all aggregated with k ≥ 5. |
| 15 | How would you measure impact in a pilot? | Interrupted time series at one RTO: 2 weeks baseline, 6 weeks live, 4 weeks follow-up, with a comparison office if possible. Confounders listed up front. |
| 16 | What about survey instruments? | SUS, a pre/post agent-intent question with max ₹ willing to pay, confidence 1–5 on "I know every step", and an optional near-miss question with no names. |
| 17 | Effect sizes? | We report them with CIs, not just p-values: proportion difference, r, the median paired difference. |
| 18 | Any qualitative evidence? | Three Mom-Test interviews and think-aloud notes. Two quotes on the slide, audio-only with consent. |
| 19 | What if the result goes against you? | It goes on the slide. The field kit says so in writing. |
| 20 | Can others replicate it? | The scoring rule, clip windows, analysis script and anonymised data are in the repo. |
| 21 | What's your data-quality check? | Server-side replay of every session overwrites the client score; buffering can't move a tap because scoring uses `video.currentTime`. |

### 6.6 Ankush Kapoor — Project Engineer, C-DAC (HPC, National Supercomputing Mission)
*Lens: real deployment, performance under load, failure handling, sovereignty and open standards (C-judges §6; verification §2 row 6).*
| # | Question | Answer |
|---|---|---|
| 1 | 10,000 users at 9 a.m. — what breaks first? | Probably the Postgres connection pool on the API, then Gemini rate limits. The plan card and rules are cacheable and AI-free; we pool connections, cache rule packs in memory, and debriefs fall back to templates on 429. Load test: [fill] RPS at p95 [fill] ms. |
| 2 | Where does it run? | Render, Singapore region, for the hackathon, with synthetic data only. For adoption, the same containers on NIC or a MeitY-empanelled cloud in India. |
| 3 | Why not an India region now? | Render has none (Oregon, Ohio, Virginia, Frankfurt, Singapore). We say so in the README instead of hiding it. |
| 4 | What's your p95? | Targets: plan API p95 < 300 ms; measured on demo day [fill]. We'll show the table. |
| 5 | Cold start? | Render free services sleep after 15 minutes and take about a minute to wake, so we keep the instance warm before judging and note it in the README. |
| 6 | How heavy is the app on 2G? | Lite mode first load < 300 KB [measured: fill]; clips at 360p, 1–2 MB, cached; mock tests offline. |
| 7 | What's on Render Workflows and why not a queue? | Durable, retried, fan-out tasks: the clip pipeline, nightly stats, debrief fan-out and the journey sweep. Each run gets its own instance; runs over limits queue rather than fail. |
| 8 | What are the Workflows limits? | Hobby: 50 root runs a minute, so we fan out with chained runs (1,000/min). Runs can last up to 24 h. No cron, so n8n triggers the schedules. |
| 9 | What if Render goes away? | Tasks sit behind a `JobRunner` interface with a second implementation for Celery or Temporal-style infrastructure. Containers, Postgres and S3-compatible storage only. |
| 10 | How do you scale video? | Static clips on object storage behind a CDN; no server-side streaming; the scorer only needs tap timestamps, so the API load is tiny. |
| 11 | How do you stop fake scores? | A Node verifier replays every session with the same `game-core` code and overwrites the client score. |
| 12 | Observability? | OpenTelemetry traces, structured logs with PII redaction, Sentry. For government hosting: CERT-In 180-day log retention in India and NTP to NIC/NPL. |
| 13 | What happens when Sarathi is down? | Drafts are kept, a status banner shows, the hand-off waits; no data loss (EC-11). Telangana had a Sarathi outage in June 2026 that stalled about 4,000 applications. |
| 14 | Do you use Bhashini? | It's the government-preferred speech path behind our `BhashiniAdapter`. For the hackathon we use Gemini Live and Sarvam Saaras for Dogri, because Bhashini onboarding terms weren't available in time. |
| 15 | Open standards? | OpenAPI 3.1 for the core and the adapter contract, OpenTelemetry, Apache-2.0 code, CC-BY content, UX4G design tokens, WCAG 2.1 AA / GIGW 3.0. |
| 16 | How many services is that? Isn't it fragile? | One Python backend and one Postgres, a PWA, a small Node verifier, Workflows for jobs, n8n only at the messaging edge. Voice is not on the critical demo path. |
| 17 | Security audit path? | ASVS L2, OWASP LLM Top 10, ZAP in CI, SBOM, threat model, then VAPT by an STQC- or CERT-In-empanelled auditor for a safe-to-host certificate. |
| 18 | Data residency for AI? | Production uses Vertex AI in an Indian region or Bhashini/local models per state, behind an `LLMPort`. Hackathon AI calls go to the Gemini API on the paid tier. |
| 19 | What happens at a district-wide 2G drop? | The PWA keeps working offline for practice; the case clock runs on the server, so reminders still arrive by WhatsApp or SMS later (SMS after DLT). |
| 20 | Could the score verifier be a bottleneck? | A replay is a pure function over a few hundred events; it's horizontally scalable and stateless. |
| 21 | Load test method? | k6 against API-01, API-12 and API-35 with a ramp to [fill] virtual users; we report p50/p95/error rate. |
| 22 | Anything HPC-relevant? | Honestly, no. This is a latency and reliability problem, not a compute one. The heavy part (video blur and window proposals) runs offline in Workflows. |

---

## 7. Team ownership slide (D-24)
| Module | Owner (fill names) | Can explain |
|---|---|---|
| Rules engine + plan card (F-02–F-04, F-42) | [name] | Rule rows, sources, fees maths |
| Guided application + photo fixer (F-05–F-07) | [name] | One-question flow, on-device photo processing, hand-off |
| Nazar + game-core + verifier (F-23–F-24) | [name] | Scoring, two-rater windows, replay |
| AI agents + evals (F-25, F-30, M-01..M-05) | [name] | Allowlists, provenance guard, eval set |
| Workflows + n8n (F-09, clip pipeline) | [name] | Task graph, retries, schedules |
| Field study + stats | [name] | Pre-registration, CIs, exclusions |

## 8. Rehearsal checklist
- [ ] Run the 3-min script 5 times with a stopwatch; cut words, never beats.
- [ ] Each owner answers 3 random questions from §6 in under 20 seconds.
- [ ] Fill every [fill] from the Sat 18:00 data freeze; double-check every ₹ figure against `fees.json`.
- [ ] Check Kerala HPT status on demo morning (D-25).
- [ ] Read the wording table (§0) aloud once before going on.
