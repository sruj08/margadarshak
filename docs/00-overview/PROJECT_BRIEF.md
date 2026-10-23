# Margdarshak: Project Brief (single source of truth)
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Product lead · Status: v1.0 · Last updated: 2026-10-23
> Every document in this repository must agree with this file. If a document disagrees, this file wins and the document is corrected.
> Inputs: `../../../research/` (all research), `../../../war-room/margdarshak-verification.md` (council directives D-01..D-25), `../../../research/ps1-deep/REFINED-OVERVIEW.md`, `06-design-language.md`, `07-govt-plug-and-play.md`, `08-game-ai-n8n.md`.

## 1. Identity
| Field | Value |
|---|---|
| Name | **Margdarshak** (मार्गदर्शक, "the one who shows the way") |
| Tagline | *Learner se licence tak, bina agent ke.* (From learner's licence to licence, without an agent.) |
| One-liner | A reimagined, government-adoptable mParivahan that turns India's driving-licence process into one guided road. It tells you your exact plan before you apply, carries you through every step, and uses short simulations with AI coaching to train the skills India's test never checks. |
| Hackathon | HackCache '26 (CachedInfo × GCET Jammu), PS1 "Making mParivahan & Driving Licence Services Accessible to Everyone" |
| Positioning (D-02) | A **reference citizen front end plus an open adapter specification** that MoRTH, NIC or a State Transport Department can adopt over Sarathi, DigiLocker and Bhashini. The hackathon build is a working product on mock adapters. It is **not affiliated** with MoRTH or NIC: no national emblem, no "official" wording, and a non-affiliation footer on every page (D-01, D-19) |
| Product shape (council ruling) | **The journey is the body; Nazar plus the game debrief is the heart.** Nazar leads the hook, the evidence slide and the closing QR (D-03) |

## 2. The problem (evidence in `research/`)
1. **The front end went online; the journey didn't.**
   - parivahan.gov.in shows about 120 links, roughly 1 in 10 relevant to a first licence.
   - A learner's licence (LL) takes about 16 screens, about 6 captchas and 4 or more OTPs, and date of birth is typed about 6 times.
   - Nothing is saved: the official FAQ says "the applicant should apply again".
   - Edits are locked after payment.
   - The application is desktop-first (Sarathi asks for 1366×768).
2. **Nobody owns the timeline.** LL validity (6 months), the 30-day minimum wait, slot scarcity, the 7-day retest gap, remedial training after a fail and approval limbo all collide. Typical time to a licence is 2.5–4 months; the worst case is 6–12+ months.
3. **The driving test is opaque.** Delhi's automated tracks fail about 50%; Gujarat's fail 94% of car applicants on 4 AI tracks. Criteria aren't published, so agents sell certainty at ₹2k–20k against an official ₹700 + ₹200 card for one class.
4. **What kills is never taught or tested.**
   - 1,72,890 deaths in 2023.
   - Over-speeding is cited in 68–70%; two-wheelers are 44.8%; 54,568 died without a helmet.
   - Heavy vehicles killed 18,556 two-wheeler riders.
   - Night accounts for 42% of accidents; highways carry 59% of deaths.
   - Uncontrolled and T-junctions account for 37,782 deaths.
   - A licensed driver was at the wheel in 70.9% of accidents.
   - India tests knowledge and vehicle control, never hazard anticipation. Kerala adds a hazard-perception test from December 2026.
5. **The first months after licensing are the most dangerous.** Crash and near-crash rates are about 8× higher in the first 3 months, and no follow-up exists.
6. **Trust is broken.** Fake "apply" apps have 1M+ installs, fake e-challan APKs circulate, and a "SYSTEM HACKED" banner greets users on the official homepage.

## 3. The secret (why this is a monopoly, not a feature)
India's licence journey has one owner today: the agent. What agents legitimately sell is the right class, a check for blockers, documents that pass, the dates, a slot, a test vehicle and chasing the approval. All of that is software. India also tests *knowledge* and *control* but never *anticipation*, the skill that predicts crashes.

The moat is threefold:
1. A calibrated Indian hazard-clip bank, with difficulty per clip fitted on thousands of takers.
2. Versioned state rule packs with sources.
3. Per-RTO "where it stalls / why people fail" data, a network of driving schools and parents, and trust.

## 4. Users
| ID | Persona | Summary |
|---|---|---|
| P-01 | **Kabir** (primary) | 19, B.Tech first year in Jammu. Wants a bike licence now and a car later. Android phone, Hinglish, has been quoted ₹4,000 by an agent. Overconfident, afraid of failing in front of friends. |
| P-02 | **Tanvi** | 19, student in Jammu whose Aadhaar address is in Kathua (the migrant case). No vehicle of her own. |
| P-03 | **Mohan-ji** | 52, Kabir's father. Renewal and a car re-test; needs Form 1A; low digital literacy. Family mode. |
| P-04 | **Helper** | Elder sibling or cyber-café/CSC operator who fills forms for others, with recorded consent. |
| P-05 | **Driving-school owner** | Runs a school near the RTO. Wants students and must now give hazard training in Kerala. |
| P-06 | **RTO officer / Transport Commissioner** | Wants fewer counter queries, fewer re-tests and visibility of where applications stall. |
| P-07 | **Rahul** (edge) | 17. Only a ≤50 cc gearless licence is possible, with guardian consent. Rules-only features: no AI, no telemetry, no streaks. |

## 5. Product flow (stages S0–S9) and features
**Stages:**
- S0 Home
- S1 Licence plan
- S2 Apply for LL
- S3 LL test
- S4 30-day bridge
- S5 Book DL test
- S6 Driving test
- S6F Fail and recover
- S7 Licence issued
- S8 New-rider year
- S9 Renew / fix / family

**Cross-cutting:** the stage-aware home, the voice guide, notifications, Helper mode, Lite mode and accessibility.

### 5.1 Feature list (MoSCoW for the product; build phases are in IMPLEMENTATION_PLAN)
| ID | Feature | Stage | MoSCoW |
|---|---|---|---|
| F-01 | **Home**:<br>• language first (each language in its own script)<br>• one headline<br>• 4 verb tiles (Get my first licence · Practise for the test · Renew or fix my licence · Check my application)<br>• mic<br>• calm trust line<br>• "All services" grouped by *who you are* | S0 | Must |
| F-02 | **Licence Plan in 3 taps**: age/DOB · vehicle pictures · state → eligible classes, steps, max RTO visits, earliest licence date, fee breakdown from `fees.json`, documents, warnings. No login. Send to WhatsApp. | S1 | Must |
| F-03 | **Smart class planner**: several classes on one LL (e.g. motorcycle + car), with the saving shown | S1 | Must |
| F-04 | **Blocker check**: the identity and eligibility edge cases (EC-01..EC-06, EC-12, EC-13, EC-21) as rule rows with fix, source and confidence; other EC rows are owned by the features listed in PRD §8 | S1–S2 | Must |
| F-05 | **Guided LL application**:<br>• one question per screen with "why we ask"<br>• auto-save and resume on any device<br>• "Check your answers" before payment<br>• fee breakdown<br>• payment-pending guidance | S2 | Must |
| F-06 | **Photo and signature fixer**: on-device camera guide, crop, resize, background whiten, size check | S2 | Must |
| F-07 | **Sarathi hand-off**: the Aadhaar eKYC, OTP, payment and submission happen on Sarathi or the state gateway, never in Margdarshak (D-07).<br>• Mode A: prefilled hand-off + copy-pack, works today<br>• Mode B: adapter, once a state adopts | S2, S5 | Must |
| F-08 | **Stage-aware home + parcel-style tracker**: a journey state machine decides the single primary action for each stage | All | Must |
| F-09 | **Case clock**: LL expiry countdown from day 180, day-30 unlock, test-eve checklist, approval chase. Timers are TimelineEvent rows in Postgres, swept by n8n-triggered Render Workflows runs (Workflows has no cron or sleep). | S2–S7 | Must |
| F-10 | **Slot finder**: RTO and accredited centre map + calendar, "notify me if an earlier slot opens" (mock adapter; no scraping or booking bots, D-08) | S5 | Must |
| F-11 | **RTO Live Intel**: structured crowd reports per RTO (when slots really open, documents asked, what was checked on the track, wait time). No names, no free-text accusations, moderated (D-14) | S5–S6 | Should |
| F-12 | **Driving-test readiness**:<br>• animated track explainer<br>• test-eve "what to bring"<br>• test-day co-pilot (counter steps, papers check, "show at counter" QR, calm-down)<br>• vehicle-for-test checklist + listing | S6 | Must |
| F-13 | **Fail and recover**: private, face-saving debrief → drill → retest booking from the same screen; remedial-training referral; LL-expiry check; test-record request (RTI template) | S6F | Must |
| F-14 | **Approval tracker + escalation letter**: facts only, the user approves and sends; DigiLocker pointer when issued | S7 | Should |
| F-15 | **New-rider year**:<br>• voluntary novice pledge<br>• phone-free riding guidance<br>• monthly hazard refresher<br>• first night/highway missions<br>• first-vehicle checklist (ABS/CBS, Bharat NCAP, ISI helmet, third-party + ₹15 lakh PA cover, PUC, RC check)<br>• challan check link + fake e-challan/APK scam shield<br>• golden-hour card (static content, D-14) | S8 | Should |
| F-16 | **Renew / fix**: renewal reminders (no grace period since 2019; more than 1 year late means a retest), add a class, address change, duplicate, IDP. Shown only to DL holders. | S9 | Should (surface) |
| F-17 | **Family and Helper mode**: manage a parent's case; cyber-café helper with recorded consent; "clear this device"; minor-riding (s.199A) awareness for parents | Cross | Should (surface) |
| F-20 | **Learn hub**: LL syllabus + road-safety curriculum (22 modules from MoRTH data). Question variants so memorising fails; FSRS spaced repetition. | S3–S4 | Must |
| F-21 | **Test Readiness Score** = 100 × weighted topic mastery − calibration penalty. Shown as "78 = knowledge 84 − calibration 6". The 85 gate is advisory, with "book anyway" always visible. | S3–S6 | Must |
| F-22 | **LL Test Simulator**: the state's real format from config (timer, count, pass mark), with a guided first run | S3 | Must |
| F-23 | **Nazar hazard perception** on real Indian clips, in Kerala's announced format: 10 clips × 10 marks, pass 60, UK-style 5-band scoring, pattern-clicking scores zero. Plus the clip pipeline. | S4 | Must (hero) |
| F-24 | **Simulation mini-games** (under-18: play runs locally with no server session or stored score, D-13):<br>• Stopping Distance<br>• Blind Spot (truck/bus)<br>• Junction Scan<br>• Track Test Twin (figure-8, reverse park, gradient start)<br>• Helmet Fit (on-device camera)<br>• Golden Hour (first-aid decisions)<br>• Night & Glare<br>• Hill Road (J&K)<br>No speed or stunt content, false alarms penalised, no stakes (D-11) | S4 | Must: Stopping Distance, Blind Spot, Junction Scan, Track Test Twin deep (plus Nazar F-23 and the LL simulator F-22); Should: the rest |
| F-25 | **AI Debrief**: after every session, "how you did · where you lacked · what you could have done · your next drill". Code computes every number; Gemini only narrates, choosing IDs from allowlists (D-09). The commentary mode is recorded, then scored (D-12). | S3–S8 | Must |
| F-26 | **Gamification engine**:<br>• XP for learning only, diminishing after 45 min/day<br>• ranks gated by mastery<br>• weekly repairable streaks<br>• co-op squads<br>• 9 badges, "Khud Licence" shown as self-declared<br>• share cards<br>• the 13 CCPA dark patterns banned by lint | S3–S8 | Must |
| F-27 | **Road Sign Snap**: point the camera at a sign → meaning + add it to your deck | S3 | Could |
| F-28 | **Practice Record** (renamed from competence passport): practice hours, Nazar score, modules done, supervisor sign-offs; QR-checkable (shows what was counted, never "verified") | S4–S7 | Should |
| F-30 | **Voice Guide**: ADK live mode + Gemini Live (Hindi/English); Sarvam Saaras for Dogri speech in. Navigates and fills fields inside Margdarshak. Never submits, pays or books on Sarathi. Answers carry a rule-ID source chip. | Cross | Must |
| F-31 | **Personal tutor**: explains *your* wrong answers from reviewed content | S3–S4 | Should |
| F-32 | **Sarathi screen/status decoder**: screenshot → meaning + next step, matched to a verified error catalogue | S2–S7 | Should |
| F-33 | **Scam checker**: rules decide (domain/sender allowlist, VK-MORTH style IDs, APK = never); AI only explains | S8 | Should |
| F-40 | **Driving-school portal**: listing; Pro tier with learner progress, hazard-training logs for RTO inspections, practice sign-off, parent updates, test-vehicle hire, remedial-training referrals | Eco | Should |
| F-41 | **State / RTO console** (Palantir-style decision views): where applications stall, fail reasons per RTO, demand forecast, slot utilisation, query deflection. Anonymised and aggregated. | Eco | Should |
| F-42 | **Rule-pack studio**: versioned state rule packs (classes, fees, formats, timelines) with maker-checker approval, source, date, confidence | Eco | Must |
| F-50 | **Languages**: English + Hindi in full; Dogri voice input; others as rule-pack-ready translations (D-21) | Cross | Must |
| F-51 | **Lite mode / offline PWA**: < 300 KB first load, offline mock tests and cached clips | Cross | Must |
| F-52 | **Accessibility**: WCAG 2.1 AA / GIGW 3.0 / UX4G, screen readers, no-audio games, photosensitivity-safe, 48 px targets | Cross | Must |
| F-53 | **Notifications**: WhatsApp (templates), email, web push; SMS only after TRAI DLT registration (D-16) | Cross | Must |
| F-54 | **Privacy centre**: consent records (DEPA-style artefacts), export, delete, grievance officer; minor gating | Cross | Must |
| F-55 | **Privacy-preserving analytics** (no PII, aggregated) | Cross | Must |
| F-56 | **Government adapter layer** (plug-and-play): SarathiAdapter, DigiLockerAdapter, AadhaarOfflineAdapter (**mock-only** in Margdarshak; real offline QR/XML verification brings OVSE duties, so in government mode it runs through the state), BhashiniAdapter, PaymentAdapter, NotificationAdapter, SlotAdapter, each with mock and real implementations passing the same contract tests | Platform | Must |
| F-57 | **Field-study module**: journey-test lab (unbranded replica of the observed Sarathi sequence), Nazar study, pre-registered hypotheses | Evidence | Must |
| F-58 | **Multi-tenancy per state + white-label theming** (UX4G skin) | Platform | Should |

**Cut or roadmap (council):**
- "your route, your risks" (roadmap; needs iRAD access)
- live commentary coaching (replaced by record-then-score)
- face match against the Aadhaar photo
- the "10+ languages" claim
- the name "Saarthi"
- any "official" or "integrated with Sarathi" wording

## 6. Domain ontology (Palantir-style; full model in DATA_MODEL)
| ID | Object | Purpose |
|---|---|---|
| E-01 | Applicant (User) | Pseudonymous person; age band; language; flags (minor, helper) |
| E-02 | Case | One licence journey; stage; state; classes; path; dates |
| E-03 | ClassSelection | Vehicle class per case (MC50CC, MCWOG, MCWG, LMV-NT, transport classes) |
| E-04 | LearnerLicenceMirror | User-entered or adapter-fetched LL facts (issue/expiry); never the LL number in clear |
| E-05 | DrivingLicenceMirror | Same, for the DL (validity, renewal window) |
| E-06 | DocumentCheck | Checklist item and on-device check result (no document images stored) |
| E-07 | FeeQuote | Computed from the rule pack (line items) |
| E-08 | Rule / RulePack | Versioned rules per state with source, date, confidence, approver |
| E-09 | Office | RTO/ARTO/accredited centre/CSC |
| E-10 | Slot | Slot availability (adapter) |
| E-11 | TestAttempt | LL or DL test result entered by the user or adapter; fail reason codes |
| E-12 | TimelineEvent | Scheduled journey events (idempotent keys) |
| E-13 | Notification | Outbound messages and their delivery state |
| E-14 | Contact | Phone/email, encrypted, separate from the case |
| E-15 | ConsentArtefact | Purpose-bound consent records (DPDP) |
| E-16 | GameSession | One play of a game; seed, inputs digest, server-verified score |
| E-17 | GameEvent | Telemetry events (bounded, no PII) |
| E-18 | TopicMastery | FSRS state per topic; calibration (Brier) |
| E-19 | Debrief | Deterministic findings + AI narration (IDs only) + validator verdict |
| E-20 | Clip | Nazar clip: blurred media, hazard type, difficulty, licence |
| E-21 | ClipRating | Two-rater hazard windows; agreement |
| E-22 | Achievement | XP, rank, badges, streak state |
| E-23 | Squad | Co-op group of friends |
| E-24 | RtoReport | Structured crowd intel (moderated) |
| E-25 | DrivingSchool | Listing, accreditation, Pro status |
| E-26 | Booking | School lesson/vehicle bookings |
| E-27 | PracticeLog | Supervised practice entries + sign-offs (Practice Record) |
| E-28 | Letter | Escalation/RTI drafts (user-sent) |
| E-29 | HelperLink | Helper ↔ applicant consented link |
| E-30 | AuditLog | Append-only actions (CERT-In, admin) |
| E-31 | Tenant | State tenant: theme, rule pack, adapters, languages |

## 7. API surface (names; contract in `api/openapi.yaml`)
| Group | Endpoints |
|---|---|
| Plan and rules | API-01 `POST /v1/plans` (3-tap plan, no auth) · API-02 `GET /v1/rules/{state}/classes` · API-03 `GET /v1/rules/{state}/fees` · API-04 `POST /v1/plans/{id}/whatsapp` · API-05 `GET /v1/rules/{state}/ll-format` (LL test format: count, pass mark, timer, source, date) |
| Cases | API-10 `POST /v1/cases` · API-11 `GET /v1/cases/{id}` · API-12 `PATCH /v1/cases/{id}` (autosave) · API-13 `GET /v1/cases/{id}/blockers` · API-14 `GET /v1/cases/{id}/timeline` · API-15 `POST /v1/cases/{id}/events` (status updates: ll_issued, slot_booked, test_failed, test_passed, approved, card_received) · API-16 `GET /v1/cases/{id}/handoff` (Sarathi copy-pack/prefill) · API-17 `DELETE /v1/cases/{id}` |
| Documents | API-20 `POST /v1/checks/photo` (metadata only; the check runs on device) |
| Slots and offices | API-25 `GET /v1/offices` · API-26 `GET /v1/offices/{id}/slots` · API-27 `POST /v1/slot-watches` · API-28 `POST /v1/offices/{id}/reports` (Live Intel) · API-29 `GET /v1/offices/{id}/intel` |
| Learning and games | API-30 `GET /v1/learn/modules` · API-31 `GET /v1/learn/review-queue` (FSRS) · API-32 `POST /v1/learn/answers` · API-33 `GET /v1/readiness` · API-34 `POST /v1/games/{gameId}/sessions` · API-35 `POST /v1/games/sessions/{id}/complete` (server replay) · API-36 `GET /v1/games/sessions/{id}/debrief` · API-37 `GET /v1/nazar/clips` · API-38 `GET /v1/me/achievements` · API-39 `POST /v1/squads`, `POST /v1/squads/{id}/join` (adults only) · API-44 `POST /v1/me/declarations/khud-licence` (self-declared) · API-57 `GET /v1/share-cards/{kind}/{id}.png` |
| AI | API-40 `WS /v1/voice` (ADK live) · API-41 `POST /v1/tutor/explain` · API-42 `POST /v1/decode/screenshot` · API-43 `POST /v1/scam/check` |
| Letters and records | API-45 `POST /v1/cases/{id}/letters` · API-46 `GET /v1/me/practice-record` · API-47 `GET /v1/check/practice-record/{token}` (QR check page; never says "verified") · API-48 `DELETE /v1/me/practice-record/tokens/{token}` (revoke) · API-49 `POST /v1/me/signoff-requests` (ask a school/supervisor to sign off) |
| Ecosystem | API-50 `GET /v1/schools` · API-51 `POST /v1/schools/{id}/bookings` · API-52 school Pro endpoints (`/v1/school/...`) · API-53 state console (`/v1/console/...`) · API-54 rule-pack studio (`/v1/admin/rulepacks/...`, maker-checker) · API-55 clip admin (`/v1/admin/clips/...`) |
| Privacy and platform | API-60 `GET/POST /v1/me/consents` · API-61 `POST /v1/me/export` · API-62 `DELETE /v1/me` · API-63 `POST /v1/events/analytics` · API-64 `GET /v1/health` · API-65 `POST /internal/clock/sweep` (n8n → Workflows) · API-66 `POST /internal/webhooks/n8n` (staff events from n8n; citizen channel receipts and STOP from Meta/email) · API-67 `POST /internal/jobs/{job}` (n8n-triggered jobs) · API-68 `POST /internal/intel/{reportId}/precheck|decision` (Live Intel moderation) · API-69 `POST /internal/watchers/{id}/fire` (slot watches) · API-72 `POST /internal/letters/{id}/dispatch` (after user approval) · API-73 `POST /internal/leads` (school lead routing). n8n never queries the database directly |
| Field study | API-70 `POST /v1/lab/trials` · API-71 `GET /v1/stats/public` (live counters for judges) |

## 8. Architecture and stack (versions verified in research; re-pin at H0)
**Shape:** hexagonal core. **Ports:** rules, cases, games, AI, notifications, government adapters. Mock and real adapters pass the same contract tests. Multi-tenant per state. Containerised, so it deploys on Render for the hackathon and on MeghRaj or a MeitY-empanelled Indian cloud for adoption (D-17).

| Layer | Choice |
|---|---|
| Web app | **Next.js 16** (App Router, React 19, TypeScript), Tailwind CSS 4, **HeroUI v3** (team's Vakyam stack), Motion (Framer), Rive (voice orb, track explainer), Lottie (celebrations only), next-intl, Serwist PWA |
| Game layer | **Phaser 4** for the top-down sims; HTML video + SVG + React for Nazar, Stopping Distance, Golden Hour and the LL simulator; **MediaPipe** on device for Helmet Fit; `@margdarshak/game-core` (pure TS scoring + Game SDK contract, Zod) |
| Learning | **ts-fsrs** (pinned 5.x) for spaced repetition; Brier-score calibration |
| API backend | **Python 3.12, FastAPI**, Pydantic v2, SQLAlchemy 2 + Alembic, **PostgreSQL 16**, Redis/Key Value (rate limits, sessions) |
| Score verifier | Node service running `game-core` to replay sessions server-side and overwrite client scores (anti-cheat) |
| AI | **Google ADK 2.12 (Python)**: VoiceGuideAgent (live), DebriefAgent, CoachAgent, TutorAgent, ScreenDecoderAgent; **Gemini** models (§10); Sarvam Saaras (Dogri ASR); provenance validator + ADK PII plugin |
| Durable jobs | **Render Workflows (Python SDK)**: clip pipeline (headline), case-clock sweep, debrief fan-out, nightly stats. n8n triggers the scheduled ones. |
| Citizen notifications | **Backend notifier** (`NotificationPort`): outbox → WhatsApp Cloud API, email, web push; quiet hours, ≤ 1 nudge/day, STOP. Scales with the API (ADR-0006) |
| Automation | **n8n Pro**: internal and staff operations only: schedules, clip-review and moderation queues, school lead routing, on-call alerts, digests, field-test export, and RTO/state staff briefs, alerts and reminders. Never citizen messages, never business logic (D-16, ADR-0006). Load grows with staff and offices, not citizens |
| Storage | Cloudflare R2 (blurred clips, static assets) in the hackathon; an Indian object store in production |
| Auth | Anonymous device session → optional account (email magic link / Google); helper links with consent. Production: DigiLocker OAuth (PKCE) / Jan Parichay via adapters. |
| Observability | OpenTelemetry, structured logs with PII redaction, Sentry; CERT-In 180-day retention in India in production |
| CI/CD | GitHub Actions; contract tests for adapters; evals for agents; Playwright e2e; axe accessibility |
| Licence | Apache-2.0 (code); CC-BY 4.0 (clip bank, rule packs) |

## 9. Edge cases (each needs a rule row or screen state and a test; D-20)
EC-01..EC-20 as listed in `war-room/margdarshak-verification.md` §3.2:
- **Identity and eligibility:**
  - EC-01 Aadhaar shows only the year of birth
  - EC-02 Aadhaar address ≠ residence
  - EC-03 the "son/daughter of" line on Aadhaar is blank
  - EC-04 turning 40 mid-journey
  - EC-05 aged 16–17, ≤50 cc only
  - EC-06 transport classes under 20
- **Timeline and payment:**
  - EC-07 LL expires while waiting for a slot; a new application number breaks the slot
  - EC-08 3 or more fails, the 7-day gap, remedial training
  - EC-09 payment debited but pending
  - EC-10 no online LL test in the state
  - EC-11 Sarathi outage
- **Special situations:**
  - EC-12 moving state, foreign licence, NRI, IDP
  - EC-13 disability and adapted vehicles, deaf applicants, colour vision
  - EC-14 shared phone or cyber café
  - EC-15 device clock tampering
  - EC-16 expired DL, no grace period
  - EC-17 a minor riding the family scooter
- **Technical and privacy:**
  - EC-18 game edge cases: buffering, spam taps, screen readers, photosensitivity
  - EC-19 low-end phone on 2G
  - EC-20 a user types an Aadhaar number or OTP into the AI

Further cases from product research (EC-21..EC-30):
- EC-21 two classes with different eligibility ages
- EC-22 an LL already held before using Margdarshak (mid-journey onboarding)
- EC-23 a passed test but no SMS within 3 days
- EC-24 a fake slot or "setting" offer reported in Live Intel
- EC-25 helper misuse (consent revoked)
- EC-26 the account is deleted mid-case
- EC-27 a rule pack changes mid-case (re-evaluation and notice)
- EC-28 the Kerala HPT is stayed or postponed
- EC-29 the AI is unavailable (template fallback)
- EC-30 a WhatsApp opt-out ("STOP")

## 10. AI models (IDs pinned at H0 against `04-ai-adk-gemini.md`; model names live in env vars)
| ID | Agent / model | Job | Guardrail |
|---|---|---|---|
| M-01 | VoiceGuideAgent: ADK live + Gemini Live native-audio (Hindi/English) | Navigation and field-fill by voice | No submit/pay/book; rule-ID answers only; 18+ only |
| M-02 | DebriefAgent: Gemini Flash-Lite | Narrates deterministic findings (how you did, gaps, what to do, next drill) | Chooses IDs from per-request allowlists; no digits in model text; validator; template fallback |
| M-03 | CoachAgent: Gemini Flash-Lite | Weekly plan wording | Same as M-02 |
| M-04 | TutorAgent: Gemini Flash-Lite | Picks one offline-reviewed explanation for a wrong answer and writes a short bridge sentence | Never writes new explanations at runtime |
| M-05 | ScreenDecoderAgent: Gemini Flash (vision) | Sarathi screenshot → meaning + next step | Matches the verified error catalogue; "unknown" allowed |
| M-06 | ClipWindowProposer: Gemini Flash (video) | Proposes hazard windows offline | Two humans set the final windows |
| M-07 | SignSnap: Gemini Flash (vision) | Recognises road signs | Confirms against the sign catalogue |
| M-08 | Sarvam Saaras v3 | Dogri/Kashmiri speech to text | Output reviewed text only |
| M-10 | ScamExplainer: Gemini Flash-Lite | Explains the rule-decided scam verdict in plain words | Never decides "safe"; the rules verdict is final |
| M-11 | CommentaryScorer: Gemini (audio transcription + classifier) | Transcribes recorded Nazar commentary and maps it to hazard IDs | Record-then-score; audio deleted after scoring |
| M-09 | On-device MediaPipe / YuNet / plate detector | Helmet fit; face/plate blur in the clip pipeline | No frames leave the device (helmet); blur audited 100% before publish |

**Cross-cutting AI rules:**
- Code computes every number; Gemini only narrates (D-09).
- Provenance guard plus ADK evals of at least 30 cases per agent (D-10).
- Under-18 users get no AI, no telemetry and no streaks; real users run on the paid Gemini tier (D-13).

## 11. Legal and compliance frame (detail in docs/06-security-compliance)
- **Data protection:**
  - DPDP Act 2023 + Rules 2025: purpose-bound consent, children = under 18, rights, grievance.
  - Aadhaar Act: no Aadhaar numbers, OTPs or biometrics, ever (D-07).
  - DigiLocker requester onboarding through NeGD after the event.
- **Security and hosting:**
  - CERT-In: report within 6 h, 180-day logs, NTP sync.
  - GIGW 3.0 / UX4G / WCAG 2.1 AA; STQC/CERT-In-empanelled audit before any government hosting.
  - OWASP ASVS L2 + OWASP LLM Top 10.
- **DPDP timing and retention:**
  - DPDP Rules notified 13/14 Nov 2025; consent managers from about Nov 2026; most duties from 13 May 2027.
  - Rule 7: tell the Board and affected users without delay, with a detailed report within 72 h.
  - Rule 8: logs kept for at least 1 year.
- **IT Rules amendment (in force 20 Feb 2026):** 3-hour takedown on court/government orders (applies to Live Intel); AI-generated media labelled (applies to the voice guide's synthetic audio).
- **Gemini terms:** data may be cached in any country, so the AI notice discloses it (cross-border); Vertex AI `asia-south1` (Mumbai) is the production path.
- **Platform and product rules:**
  - Online Gaming Act 2025: no stakes or prizes.
  - CCPA dark-pattern guidelines 2023.
  - IT Rules 2021 (intermediary duties for Live Intel).
  - Gemini API terms: 18+, paid tier.
  - TRAI DLT before SMS.
  - Motor Vehicles Act and CMVR as the rule sources.
  - Impersonation: no emblem, "not affiliated".
- **Wording bans (D-19, full council list):** "first" (first-ever), "official", "DPDP-compliant", "integrated with Sarathi", "lives saved", "doesn't exist", "STQC-certified", "verified licence", "safe" as a scam verdict, "you would crash", "unsafe driver", "Saarthi" (except the archived research file name).

## 12. Evidence plan (D-22)
1. **Journey test:** 5–8 first-time applicants, real-portal sequence vs Margdarshak. Measures: time, errors, blockers caught, SUS, "would you still pay an agent?".
2. **Nazar study:** 40+ licence holders; % below Kerala's 60/100, and r with LL-quiz score.
3. **Before/after metrics:** first-screen choices ~120 → 4; LL screens ~16 → ~6; fields typed vs autofilled; KB on 3G.

All three are pre-registered in `HYPOTHESES.md` at the confirmed start. We never claim "lives saved".

## 13. Top risks (full register in RISK_REGISTER)
| ID | Risk |
|---|---|
| R-01 | Scope explosion |
| R-02 | Seen as the 27th Parivahan redesign |
| R-03 | Legal overclaim on stage |
| R-04 | AI error, or a minor reaching the AI |
| R-05 | Fragile multi-service stack |
| R-06 | Too few usable Nazar clips |
| R-07 | Field recruitment shortfall |
| R-08 | WhatsApp/SMS approvals delayed |
| R-09 | Wrong rule or fee shown |
| R-10 | Kerala HPT stayed |
| R-11 | Cold start or outage during judging |
| R-12 | Bystander privacy in clips |
| R-13 | Gemini terms (18+) / data on the free tier |
| R-14 | Disputed hackathon start time and the "built during the event" rule |

## 14. Hackathon constraints (the build plan is phase-based; time is managed by the team)
- **Submission:** public GitHub repo · live URL · ≤5-min video · deck.
- **Judging:** 6 judges average Innovation, Technical Execution, Design & UX, Impact and Presentation (10 each).
- **Bonus track:** Render Workflows.
- **Start time:** disputed (Fri 00:00 vs Fri 21:30 IST). No commits or participant data before the confirmed start.

## 15. Resolved conflicts (23 Oct 2026, consistency decisions)
| Topic | Decision |
|---|---|
| Nazar scoring | UK-style 5 bands per hazard (F-23); the field kit was updated to match before any data is collected |
| Nazar spam-tap rule | More than 3 taps per second voids the clip (config value) |
| Streaks | Weekly, repairable, silent when broken |
| Under-18 users | No squads, no AI, no telemetry, no streaks; games run locally (D-13) |
| Badges | 9 slots; slot 7 has Night and Hill variants |
| "Verified" wording | Never used for user records; use "counted" / "checked" |
| Golden Hour | Template only, no AI; draft label until medical review |
| Helmet Fit | Fit/position guidance only; no claim that it detects the strap |
| Readiness display | Equation form "78 = knowledge 84 − calibration 6" |
| Kill switch (too few clips) | Nazar shrinks to 6 clips; journey test carries evidence |
| Kerala HPT date | Say "from December 2026" (sources say 1 or 31 Dec) |
| Stopping distance figures | Total stopping distance (reaction + braking), never braking alone |
| Copy-pack personal values | Name, relation name and address live in an **on-device vault**; API-16 returns only the template (field order and labels) |
| Day-30 unlock | The date comes from the rule pack's `min_wait_days` (research: DL test from day 31 after LL issue) |
| Login | Email magic link / Google (P1–2); DigiLocker OAuth via adapter in government mode. Never Aadhaar-OTP login |
| Trust strip | "Designed to UX4G and GIGW 3.0 guidelines", never wording that reads as certification |
| Clip pipeline | Split for Workflows limits: `clip_ingest` run → human two-rater wait in n8n (W08) → `clip_finalize` run |
| Notifications fallback | Email + web push sent by the backend; SMS only after TRAI DLT |
| n8n scope (24 Oct 2026) | Citizen messages go through the backend notifier, not n8n. n8n keeps schedules, human approvals and staff notifications (team, schools, RTO/state staff), so it never fans out per citizen. Retired workflows W02–W06, W10, W11 moved to the backend; new staff workflows W16–W18 (ADR-0006 rev., N8N_WORKFLOWS) |
| Voice field-fill | Dictating your own name/address sends speech to Gemini; this is a documented exception behind separate consent (18+ only) |
| Rule IDs | `rulepacks/` is the canonical rule-ID source; AI allowlists are generated from it |
| AI hosting | Agents run inside the FastAPI service on Render (hackathon); Cloud Run or Vertex AI India region as the production alternative |
| Packages | `packages/game-core` (single game package), `packages/ui` (tokens), `packages/rules` (rule-pack schemas), `packages/api-client` (generated from `api/openapi.yaml`) |
| Derived stages | LL_EXPIRING and similar warnings are derived `displayStage` values, not stored stages |
| Nazar spam rule | >3 taps in any 1 s, or >(2 × hazards + 4) taps in a clip, scores the clip 0 |
| JSON casing | snake_case on the wire; the generated `packages/api-client` maps to camelCase |
| Production job runner | JobRunner port: Render Workflows (hackathon) → **Temporal** (production) → inline (dev/CI) |
| Node exception to D-17 | The score verifier is the single Node service (it runs `game-core` so client and server scoring are identical); all other backend code is Python |
| Log retention | Application/security logs kept ≥1 year (DPDP Rule 8); 180 days of them held in India (CERT-In) |
| Case events (API-15) | ll_application_started, handoff_done, payment_pending, payment_confirmed, ll_issued, ll_test_failed, slot_booked, test_failed, test_passed, approved, card_received, reapply, renewed |
| Extra endpoints | API-06..09 auth · API-23 tenant config · API-24 payment callback · API-58 helper links · proposed (`x-proposed` in OpenAPI): API-18 Aadhaar offline (mock), API-19 payment intents, API-21/22 DigiLocker, API-56 admin moderation, API-59 `/v1/me`, `POST /v1/voice/ticket` |
| Helpline | Show only the verified email helpdesk-mparivahan@gov.in until a phone number is verified |
