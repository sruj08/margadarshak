# Team
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Product/design lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) · [BACKLOG](BACKLOG.md) · [FIELD_STUDY](FIELD_STUDY.md) · [GLOSSARY](GLOSSARY.md) · [PITCH](../00-overview/PITCH.md) · [Architecture](../03-engineering/ARCHITECTURE.md) · [CONTRIBUTING](../../CONTRIBUTING.md) · [CLAUDE.md](../../CLAUDE.md)

Team Chanakya is three people plus AI coding agents. This file says who owns what, how decisions are made and recorded, how agents are used safely, and who answers which judge. Roles are named by function; the person in each role is written into §1.1 at G0.

---

## 1. Roles

### 1.1 Role register (fill at G0)
| Role code | Role | Person | Backup for | Contact channel |
|---|---|---|---|---|
| **PD** | Product/design lead (and field-study lead) | _name at G0_ [unverified: owner PD, 2026-10-23] | FE for copy and UX review | Team WhatsApp group + GitHub |
| **FE** | Frontend + game engineer | _name at G0_ [unverified: owner PD, 2026-10-23] | PD for demo driving; BE for front-end CI | Team WhatsApp group + GitHub |
| **BE** | Backend + AI engineer | _name at G0_ [unverified: owner PD, 2026-10-23] | FE for deploys; PD for the n8n canvas | Team WhatsApp group + GitHub |
| **AG** | AI coding agents (e.g. Claude Code sessions), 1–3 concurrent | n/a: always paired to a human role | none: an agent is never a backup for a human | PRs only |

### 1.2 PD · Product/design lead
- **Mission:** the product is right, honest and usable by Kabir, Tanvi and Mohan-ji; the evidence is real.
- **Owns (accountable):** EP-00 gates and branding; design tokens, copy and voice (EP-03 content); rule-pack *content* (MD-030..032 rows, sources, confidence); question bank review (MD-209); finding templates (MD-242); clip capture, rating and blur audit (MD-216, MD-218); the journey-test lab check (MD-139 sheet); field studies (EP-17, EP-38); legal and compliance text (EP-37, MD-135); school product (EP-30); adoption (EP-42); demo, video and deck (EP-39).
- **Decides:** scope and cut-list order on the showcase ladder; wording; what is claimed on stage; whether a rule row is published (with BE as checker until MD-511).
- **Does not decide alone:** architecture, model choice, security controls (BE); game feel and engine choice (FE).
- **Hard lines:** never signs off a claim that is not in a sourced rule row, a measured result or a pre-registered analysis.

### 1.3 FE · Frontend + game engineer
- **Mission:** every screen is calm, fast on a ₹8–12k Android phone, accessible, and has no dead buttons; every game is deterministic and fair.
- **Owns (accountable):** monorepo front-end tooling (MD-006, MD-008, MD-009, MD-010, MD-012); component kit, shell, i18n, motion and a11y primitives (EP-03 build); journey screens (EP-07..EP-09 UI, lab replica MD-139/140); `@margdarshak/game-core` and every game (EP-12 client side, EP-13, EP-14 player and scoring, EP-15, EP-16 UI, EP-24, EP-27 games, EP-29); front-end performance and Lite mode (EP-36); photosensitivity audit.
- **Decides:** component patterns, front-end state and data fetching, engine choice per game (ADR after MD-229), bundle splits.
- **Hard lines:** no `Math.random`/`Date.now` in scoring logic; no camera frame or image leaves the device; no colour-only status.

### 1.4 BE · Backend + AI engineer
- **Mission:** one Python backend that is correct, private and boringly reliable; AI that only narrates numbers code computed.
- **Owns (accountable):** Python layout and backend core (EP-06); CI/CD deploy and contracts (EP-02 except front-end jobs); rules engine (MD-027..029, MD-033, MD-034); adapters and the adapter spec (EP-05, EP-41); case clock and all Render Workflows RW-1..RW-4; the backend notifier and all n8n workflows (W1, W7–W9, W12–W18); privacy controls and analytics (EP-11 back end); score-verifier service (MD-206 with FE); the whole AI layer and evals (EP-18..EP-22); slots, intel, letters, scam checker, Practice Record back end (EP-23, EP-26, parts of EP-27/28); console, studio and multi-tenancy back ends (EP-31..EP-33); security hardening and load (EP-35, MD-614, MD-615).
- **Decides:** data model, API contracts, model IDs and fallbacks, guardrail thresholds (with PD on tone), infrastructure.
- **Hard lines:** no Aadhaar number, OTP, biometric or face-for-matching stored or sent anywhere; no business logic in n8n; every AI number comes from a tool or facts.

### 1.5 AG · AI coding agents
- **Mission:** multiply the humans on well-specified, verifiable work.
- **Good fits (label `agent-ready`):** golden cases and EC tests (MD-034, MD-801..830), mock adapters and contract tests (MD-039..044), Storybook stories (MD-026), re-pin and Renovate (MD-008), eval-case drafting (MD-321..325), red-team drafts (MD-326), n8n workflow JSON exports (MD-127, MD-141, MD-521), question-variant drafts for human approval (MD-209), dark-pattern checks (MD-235).
- **Never:** rule rows without `source_url` + `verified_on`; rupee/day/age literals; scoring constants; `banned-terms.json`; consent, privacy or legal text; prompt guardrail sections; real-looking Aadhaar/phone/OTP fixtures; calls to government domains; merging their own PRs.
- **Accountability:** the first human role in `owner=` (e.g. `BE+AG` → BE) reviews line by line and must be able to explain the code (D-24).

### 1.6 External contributors (named when engaged)
| Role | Needed for | Ticket | Status |
|---|---|---|---|
| Two hazard raters (teammates or friends, independent) | Nazar windows, H4 | MD-219, MD-220 | Line up at G0 (field kit §0) |
| Two passengers who film (never the rider) | Clip capture | MD-216 | Line up at G0 |
| Medical reviewer (MBBS/EMS) | Golden Hour sign-off | MD-426 | [unverified: none named; owner PD, 2026-10-23] |
| Native Hindi reviewer | Catalogues, templates, eval fluency | MD-603, MD-321 | [unverified: owner PD, 2026-10-23] |
| Native Dogri speaker | Voice prompts and any Dogri text | MD-315, MD-603 | [unverified: owner PD, 2026-10-23] |
| Faculty adviser or counsel | Claims review; study ethics sign-off | MD-624, FIELD_STUDY §10 | [unverified: owner PD, 2026-10-23] |
| Field-study observers (1–2) | Journey test sessions | MD-625 | Recruit with the participants |

---

## 2. Ownership map (D-24: every module has a named owner who can explain it)

| Module (architecture slide box) | Path | Owner | Backup | Can explain |
|---|---|---|---|---|
| Citizen PWA shell, routes, i18n | `apps/web` | FE | PD | Routing, offline, Lite budget |
| Design system | `packages/ui` | FE (build), PD (tokens, copy) | — | Contrast, 48 px, Hindi type |
| Rules engine + packs | `services/api/.../rules`, `packages/rules`, `rulepacks/` | BE (engine), PD (content) | FE (TS mirror) | Why each number appears, source chips, golden suite |
| Journey state machine + case clock | `services/api/.../journey`, `services/workflows` (RW-2) | BE | FE | Stage transitions, server time, idempotency |
| Government adapter layer + spec | `services/api/.../adapters`, `api/adapters.openapi.yaml` | BE | PD (policy story) | Mock vs real, why no scraping, NIC RTI fact |
| game-core + games | `packages/game-core`, `apps/web/games/*` | FE | BE (verifier) | Deterministic scoring, seeds, pattern-click rule |
| Score verifier | `services/score-verifier` | BE | FE | Replay and overwrite, integrity flags |
| Nazar clip pipeline (RW-1) | `services/workflows/clips` | BE | PD (rating, audit) | Each task, retries, two raters, blur audit |
| AI layer (ADK agents, validator, evals) | `services/api/.../agents`, `ai/prompts`, `ai/evals` | BE | PD (tone, review) | Gate, PII, provenance, enums, fallback, eval gates |
| n8n workflows | `n8n/` | BE | PD | Why n8n holds no logic and sends nothing to citizens; W1, W7–W9, W12–W18 |
| Privacy centre + consent | `services/api/.../consent`, `apps/web/privacy` | BE (controls), PD (text) | FE | Consent artefacts, export/delete, family mode and parental consent |
| Console, school portal, rule studio | `apps/console` | FE (UI), BE (APIs), PD (product) | — | RBAC, k ≥ 5, maker-checker |
| Field study + analysis | `analysis/`, `apps/web/lab` | PD (protocol), BE (scripts) | FE (lab replica) | Pre-registration, every statistic on the slide |

`CODEOWNERS` mirrors this table (MD-010).

---

## 3. RACI by workstream

R = responsible (does it) · A = accountable (one per row) · C = consulted · I = informed. AG appears only as R, under a human A.

| Workstream | PD | FE | BE | AG | External |
|---|---|---|---|---|---|
| WS-PLAT Platform, CI/CD, infra | I | R (front-end tooling) | **A**, R | R (re-pin, stories) | — |
| WS-DES Design system, a11y, l10n | **A**, R (tokens, copy, audit) | R (build) | C | R (stories) | Hindi/Dogri reviewers C |
| WS-RULE Rules, packs, studio | **A** for content, R | C (TS mirror) | **A** for engine, R | R (golden cases) | — |
| WS-GOV Government adapters | C (policy, wording) | I | **A**, R | R (mocks, contract tests) | NIC/state C (P7) |
| WS-JRNY Journey screens and logic | C (copy, flows) | **A** for screens, R | **A** for state/clock, R | R (EC tests) | — |
| WS-GAME Games and learning | R (content, templates) | **A**, R | C (verifier) | R (golden replays, variants) | Raters R (windows) |
| WS-AI AI layer and evals | C (tone, Hindi rating) | R (UI) | **A**, R | R (eval drafts) | Hindi rater C |
| WS-AUTO Render Workflows + n8n | C (message copy) | I | **A**, R | R (n8n exports) | — |
| WS-EVID Field evidence | **A**, R | R (lab, observer) | R (export, analysis scripts) | — | Observers R, adviser C |
| WS-PRIV Privacy, security, legal | **A** for legal text, R | C | **A** for controls, R | — | Counsel/adviser C |
| WS-ECO Ecosystem | **A** (product), R | R (UI) | R (APIs) | — | Pilot schools C |
| WS-ADOPT Adoption | **A**, R | I | R (real adapters, infra) | — | State dept, NeGD C |
| WS-PITCH Demo and submission | **A**, R | R (video capture) | R (warm-up, fallbacks) | — | Adviser C |

Where a row shows two "A" (rules, journey, privacy) the split is by artefact: content vs engine, screens vs logic, text vs controls. Each ticket in BACKLOG still has exactly one accountable role (the first in `owner=`).

---

## 4. Rituals and communication

| Ritual | When | Length | Who | Output |
|---|---|---|---|---|
| **Stand-up** | Start of each working session | ≤ 10 min | PD, FE, BE | Each person: done / next / blocked; WIP check (≤ 2 tickets + 2 agent PRs each) |
| **Contract freeze review** | Before each freeze in IMPLEMENTATION_PLAN §4.3 | 20 min | Owner + consumers | Freeze recorded in the decision log |
| **PR review** | Continuous; SLA: first review within one working session | — | Any human who did not write it | Approve / changes; agent PRs reviewed by the accountable human |
| **Phase kickoff** | Entry criteria met | 20 min | All | Ticket order for the phase; who pairs which agent |
| **Demo checkpoint** | End of each phase (plan §5.x) and each ladder rung | 15 min | Run by someone who did not build it | Recording + bug list |
| **Field-study huddle** | Before and after each study session block | 10 min | PD + observer | Protocol deviations logged in `analysis/DEVIATIONS.md` |
| **Rehearsal** | From ladder rung 1 onwards, then 3 timed runs in P6 | 5 min + Q&A | All | Rehearsal log (MD-633) |
| **Retro** | End of each phase | 20 min | All | 1 keep, 1 change, 1 try; updates to CLAUDE.md agent rules if agents caused rework |
| **Incident review** | After any S1/S2 or guardrail incident | 20 min | BE + whoever saw it | Runbook update; new eval/red-team case within a day |

**Channels**
- GitHub Issues and PRs are the system of record for work (imported with `scripts/gh_import_backlog.mjs`).
- The team WhatsApp group is for coordination only; any decision taken there is copied into the decision log within the session.
- Alerts (W12) go to a separate on-call channel so they don't drown the team chat.
- No participant data, secrets or screenshots containing personal data in any chat.

**Working agreements**
- Small PRs (≤ 400 changed lines excluding generated files), Conventional Commits, ticket ID in the branch name (`md-217-clip-pipeline`).
- "Done" means the BACKLOG §0.3 DoD, not "works on my machine".
- When stuck for more than 30 minutes, say so at the next stand-up or in the group.
- Anyone can stop a claim from going on a slide if they cannot trace it to a source, a measurement or a pre-registered analysis.

---

## 5. Working with AI coding agents

### 5.1 Flow
1. A human labels a ticket `agent-ready` only if it meets Definition of Ready (BACKLOG §0.2) and lists the files the agent may touch.
2. The agent works on a branch, cites the ticket in the PR, and runs the full CI locally.
3. The accountable human reviews line by line with the checklist below, and either merges or returns it. An agent never merges.
4. If the same agent PR needs a second round on a rules, privacy or scoring issue, the ticket is taken back by the human.

### 5.2 Review checklist for agent PRs
- [ ] No rule row, fee, day count or age typed as a literal; every new rule row has `source_url`, `verified_on`, `confidence`.
- [ ] No change to scoring constants, banned terms, consent/legal text or guardrail prompt sections.
- [ ] No real-looking Aadhaar, phone, OTP, name+address fixtures; synthetic only.
- [ ] No network calls in tests; no calls to government domains anywhere.
- [ ] Tests actually assert behaviour (not snapshots of whatever came out).
- [ ] The reviewer can explain every changed line.
- [ ] Commit messages carry the agent attribution line the tooling adds.

### 5.3 Capacity rule of thumb
Budget about 30% of an agent-assisted ticket's estimate for human specification and review. Agents raise throughput on tests, mocks, fixtures and drafts; they do not shorten the critical path through RW-1 and the field study, which waits on people (filming, rating, participants).

---

## 6. Decision process

1. **Who decides:** the accountable role for the artefact (§1–§3). Product scope and claims: PD. Architecture, data, AI and security: BE. Front-end and game engine: FE.
2. **When to escalate to all three:** anything that changes a directive's application (D-01..D-25), a freeze, the showcase ladder order, or a public claim.
3. **How:** write the options and the evidence in two lines each; decide in the next stand-up; if two of three agree and the accountable role is one of them, it stands. A directive from the council can only be overridden with a written reason in the log.
4. **Record:** every decision gets a DEC-xxx row below, and an ADR in `docs/03-engineering/adr/` when it is architectural.
5. **Reversal:** a decision can be reopened with new evidence; the old row is marked "superseded by DEC-yyy", never deleted.

---

## 7. Decision log

| ID | Date | Decision | Why (evidence) | Decided by | Status |
|---|---|---|---|---|---|
| DEC-001 | G0 | Confirmed hackathon start and submission deadline | Start disputed (Fri 00:00 vs Fri 21:30 IST); deadline guide Sat 23:59 vs API Sun 21:30 (R-14) | PD | **Open**: record the organiser's written answer (MD-001) |
| DEC-002 | 2026-10-23 | Product name **Margdarshak**, team **Chanakya** | Earlier working names conflicted with the government Sarathi system and BWMI entries (D-01; verification §1 row 4) | Council, accepted by team | Accepted; trademark check open (MD-003) |
| DEC-003 | 2026-10-23 | Positioning: reference citizen front end + open adapter spec that MoRTH/NIC/a state can host; never claim live integration | Private Aadhaar eKYC needs Central Government approval; NIC RTI says private data sharing stopped 1 Oct 2026 (D-02, D-07, VG-1, VG-3) | Council | Accepted |
| DEC-004 | 2026-10-23 | Journey is the body, Nazar + debrief is the heart; Nazar leads the hook, the evidence slide and the closing QR | 26 Parivahan redesigns in BWMI top 250, none in the final 10 (D-03) | Council | Accepted |
| DEC-005 | 2026-10-23 | Depth contract: three deep slices; everything else thin on mocks with no dead buttons | Scope-explosion veto (D-04, R-01) | Council | Accepted; implemented as the showcase ladder |
| DEC-006 | 2026-10-23 | Fees computed from `fees.json` (CMVR r.32): ₹700 for one class + ₹200 card; a second class adds about ₹450; no rupee literal in UI or prompts | REFINED-OVERVIEW's "per class" wording was wrong (D-06) | Council | Accepted |
| DEC-007 | 2026-10-23 | Never collect Aadhaar numbers, OTPs, biometrics or faces for matching; Aadhaar steps are hand-offs to Sarathi | D-07, VG-1 | Council | Accepted |
| DEC-008 | 2026-10-23 | Stack: one Python backend (FastAPI + ADK + Render Workflows Python SDK), Postgres 16, Next.js 16 PWA, Phaser 4 for top-down sims, `game-core` in TS with a Node verifier | D-17, PROJECT_BRIEF §8 | Team | Accepted; versions re-pinned at G0 (MD-008) |
| DEC-009 | 2026-10-23 | Render Singapore for the hackathon with synthetic data; containerised for MeitY-empanelled cloud/NIC later; JobRunner interface | Render has no India region (VG-4) | Team | Accepted |
| DEC-010 | 2026-10-23 | Render Workflows headline = RW-1 clip pipeline; also RW-2 sweep, RW-3 debrief fan-out, RW-4 stats; n8n Schedule triggers because Workflows has no cron | D-15; B-sponsors §7 | Team | Accepted |
| DEC-011 | 2026-10-23 | n8n = messaging edge and schedules only; no business logic; SMS off until TRAI DLT | D-16 | Team | Superseded by DEC-022 |
| DEC-012 | 2026-10-23 | Commentary coach = record, then score; Gemini Live commentary is roadmap | Cost and fragility of live streaming (D-12) | Council | Accepted |
| DEC-013 | 2026-10-23 | Under 18: rules only (no AI, telemetry, streaks, squads, account history) | DPDP children = under 18; Gemini terms 18+ (D-13, VG-7, VG-8) | Council | **Superseded by DEC-021** |
| DEC-014 | 2026-10-23 | Feature verdicts: Live Intel thin (structured, k ≥ 5, no names); route-risk to roadmap; "Practice Record" (not passport); Golden Hour static, no AI; test record = RTI template; test vehicle = checklist + listing; novice year voluntary + riding lock | D-14 | Council | Accepted |
| DEC-015 | 2026-10-23 | Code licence Apache-2.0; rule packs and clip bank CC-BY 4.0 | GoI OSS policy; adoption (07 §B5) | Team | Accepted |
| DEC-016 | 2026-10-23 | Languages claimed: English + Hindi in full, Dogri voice input only | D-21 | Council | Accepted |
| DEC-017 | 2026-10-23 | Nazar scoring for the product and the pre-registered primary analysis: UK-style 5 bands inside the rater-set window, Kerala 10 × 10 scaling, pattern clicks = 0; the field kit's linear-decay rule kept as a pre-registered sensitivity analysis | Field kit and 08 §G1 described different rules; one must be primary before data (FIELD_STUDY §6) | PD + BE | **Proposed**: confirm before MD-241 |
| DEC-018 | 2026-10-24 | Phaser 4 vs last Phaser 3.x | MD-229: keep Phaser 4.2.1, lazy-loaded, fixed-step; DOM decision version on Lite / no WebGL / screen reader (ADR-0012). On-device numbers on the slowest team phone still to be added | FE | Decided |
| DEC-019 | pending | Email provider for transactional mail | Needed by MD-042 | BE | Open (decide at G0) |
| DEC-020 | pending | Gemini paid-tier billing active before any participant session | Gemini terms (the free tier allows human review of prompts) | BE | Open (before MD-626) |
| DEC-021 | 2026-10-23 | D-13 revised, AI for everyone: every feature, including AI, for every user; a learner under 18 uses a parent's (adult) account in family mode with verifiable parental consent; no behavioural tracking or targeted ads on a child's data; squads and share cards for a minor's profile need the parent's consent | User decision; residual R-13 (Gemini/Vertex terms on services likely accessed by under-18s) owned by the legal lead | User | Accepted |
| DEC-022 | 2026-10-24 | n8n = internal and staff operations only (schedules, approvals, staff and RTO notifications); citizen messages go through the backend notifier so n8n load never grows with citizens; no business logic; SMS off until TRAI DLT | D-16, ADR-0006 rev. | Team | Accepted |

---

## 8. Who answers which judge

Judges average five criteria (Innovation, Technical Execution, Design & UX, Impact, Presentation; 10 each). The lever is to leave no judge with a low score. Profiles and attack lines are from `research/C-judges.md` and the council's verification §2 (reconstructions, not quotes).

| Judge | Lens | Their likely questions | Primary answerer | Backup | Show |
|---|---|---|---|---|---|
| **Shubham Gaur** (Product Manager, Metropolis Healthcare) | Who is the user, which metric moves | "Who exactly is this for?" · "What changed for them, in numbers?" · "Why would they stop paying an agent?" | **PD** | FE | Kabir and Tanvi; before/after (choices ~120 → 4, LL screens ~16 → ~6, minutes to find fee + documents); journey-test agent-intent result |
| **Dr Nitigya Sambyal** (Asst Prof CSE, Thapar; Responsible AI) | Who computed the number, what if the AI is wrong | "Who computed '1.4 s late'?" · "What happens when Gemini is wrong?" · "How do you evaluate it?" · "What never goes to the model?" · "What about minors?" | **BE** | PD | Code-computes / Gemini-narrates diagram; validator rejecting "₹0 fee"; `adk eval` results; the "never sent to AI" list; family mode with parental consent; inter-rater Δ; HYPOTHESES.md hash |
| **Dr Simmi Dutta** (HoD Computer Engineering, GCET Jammu; co-host) | Which part did *you* build; architecture; J&K relevance | "Show me the architecture." · "Who built which module?" · "Does it work for J&K users?" | **Each owner for their module** (§2); BE leads the architecture walk-through | — | One-slide architecture with owner names on each box; README; Jammu clips; Dogri voice-in; J&K rule pack |
| **Rutvik Gupta** (Product Owner, Aditya Birla Capital; lending, payments, APIs) | Who pays; is it on real APIs; is the money maths right | "Is this on real government APIs?" · "Who pays you?" · "How do fees work for two classes?" | **PD** (business), **BE** (API honesty) | — | Honest API line (NIC RTI, adapter spec, DigiLocker onboarding checklist); driving-school Pro tier with Kerala's hazard-training mandate; computed FeeQuote for 1 and 2 classes |
| **Dr Yuganshu Tickoo** (Asst Prof, Sharda School of Business Studies; analytics) | What does the data show | "What's your n?" · "Is the correlation meaningful?" · "Is this a convenience sample?" | **PD** (study lead) | BE (ran the analysis) | The evidence slide: N, % below 60 with Wilson CI, r with Fisher CI, pre/post gain, exclusions, "convenience sample" footnote; live counters |
| **Ankush Kapoor** (Project Engineer, C-DAC; HPC) | 10,000 users at 9 am; where it runs; what breaks | "Where does it run?" · "What's your p95?" · "What happens on 2G?" · "What if Render is down?" | **BE** | FE (Lite, offline) | Render Workflows Runs page; p95 from the load test; Lite < 300 KB on 3G; offline mock test; JobRunner interface; "Singapore today, MeitY-empanelled India cloud for adoption" |
| **Render Workflows prize** (judged on innovation, effective use of Workflows, technical implementation, impact, UX) | Is the Workflow load-bearing | "What is long-running and failure-prone here?" | **BE** | PD | RW-1 with an injected retry and the human wait for two raters; RW-2 triggered by n8n Schedule |

**Rules for answering**
- Answer with a number and its source, or say "we don't know yet; here is how we'd find out".
- Never use the D-19 banned terms; never claim live integration, certification or safety outcomes.
- Hand off to the module owner when the question is about their module; the hand-off is part of Dutta's test.
- Every answerer rehearses their judge's questions without notes (MD-633).

---

## 9. Judging-day on-call
| Duty | Primary | Backup |
|---|---|---|
| Warm-up script and service health (MD-615) | BE | FE |
| Demo driving on the phone | PD | FE |
| Fallback recordings ready (MD-635) | FE | PD |
| W12 alert channel watch | BE | — |
| Kerala HPT status re-check on demo morning (MD-622) | PD | — |

---

## 10. Onboarding a new member or agent session
1. Read in this order: PROJECT_BRIEF → `war-room/margdarshak-verification.md` §5 (directives) → IMPLEMENTATION_PLAN §0–§3 → this file → CLAUDE.md.
2. Run `pnpm dev:all`, open the preview URL, and walk the P1 demo checkpoint.
3. Pick an `agent-ready` or `good-first` ticket in the current phase; pair with its accountable owner for the first review.
