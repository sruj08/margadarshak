# n8n workflows
> Project: Margdarshak · Owner: Ops lead (Team Chanakya) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [n8n/README](../../n8n/README.md) · [INFRASTRUCTURE](INFRASTRUCTURE.md) · [OBSERVABILITY](OBSERVABILITY.md) · [RUNBOOK](RUNBOOK.md) (PB-02, PB-08, PB-09) · [COST](COST.md) §5 · [API_SPEC](../03-engineering/API_SPEC.md) · [PRIVACY](../06-security-compliance/PRIVACY.md) · [research 08 §6](../../../research/ps1-deep/08-game-ai-n8n.md)
> Exported JSON: [W01](../../n8n/workflows/W01-case-clock-tick.json) · [W04](../../n8n/workflows/W04-test-eve-whatsapp-reminder.json) · [W08](../../n8n/workflows/W08-clip-review-queue.json) · [W09](../../n8n/workflows/W09-live-intel-moderation.json)

## 0. The rule
**n8n handles timing, routing, humans-in-the-loop and notifications. Code handles the logic** (08 §0 decision 7; D-16).
- Every decision comes from the backend over signed HTTP: who is due, which date, which rule, which fee, which score, whether a report is risky, what text to send. n8n moves the message and waits for the human.
- **If n8n fails, a message is late. No fact the user sees changes** (08 §6).
- **Never in n8n:** the rules engine, fee and timeline maths, eligibility, scoring, FSRS, the ADK graph and validators, the PII gate, the scam verdict, the share-card renderer, k-anonymity thresholds, moderation risk scores. n8n "Code" nodes only reshape JSON (split, map, collect receipts); a Code node with an `if` on business data fails review.
- SMS isn't wired anywhere until TRAI DLT registration (D-16). The 08 §6 "SMS fallback" in W01/W02 is replaced by **email + web push sent by the backend**.

**Why n8n at all** (the honest answer for judges): Render Workflows has **no cron trigger, no sleep and no completion webhook** (B-sponsors §1). n8n gives us schedules, multi-day human waits, WhatsApp approval buttons, a run log a non-developer can read, and copy/routing changes without a deploy. n8n Pro is a sponsor perk (B-sponsors §0). Putting the canvas in the deck shows real sponsor use without making the product depend on a SaaS canvas.

## 1. Common contract
### 1.1 Endpoints n8n calls
| Path | Brief ID | Used by | Purpose |
|---|---|---|---|
| `POST /internal/clock/sweep` | **API-65** | W01 | start the Workflows task `case_clock_sweep`; returns `{sweep_id, task_run_id}` |
| `GET /internal/clock/sweep/{id}/outbox` | (API-65 family) | W01 | run status + due messages |
| `POST /internal/webhooks/n8n` | **API-66** | all | receipts, replies, button choices, heartbeats (`X-MD-Event` header selects the handler) |
| `POST /internal/jobs/{test-eve, parent-cards, coach, analytics-digest, rules-sources}` | proposed (not in PROJECT_BRIEF §7) | W04, W05, W06, W13, W15 | batch "who gets what" lists |
| `POST /internal/intel/{id}/precheck`, `/decision` | proposed | W09 | moderation pre-check and decision |
| `POST /internal/clips/{id}/review-tasks`, `POST /internal/jobs/clip_finalize` (API-67), `POST /internal/clips/{id}/status` | **API-55 internal / API-67** | W08 | clip review tasks and finalize (bearer + `Margdarshak-Signature` HMAC) |
| `GET /internal/watchers?office_id=` | proposed | W03 | slot-watch subscribers |
| `POST /internal/letters/{id}/render` | proposed (API-45 family) | W11 | PDF render after approval |
| `POST /internal/leads/{id}/...` | proposed (API-51 family) | W07 | school lead routing |

### 1.2 Auth
| Direction | Mechanism |
|---|---|
| n8n → backend | `Authorization: Bearer <MD_N8N_READ_TOKEN>` (one of the API's `INTERNAL_BEARER_TOKENS`) **and** `Margdarshak-Signature: t=<unix>,v1=<hex HMAC-SHA256(MD_HMAC_SECRET, t + "." + body)>` (GETs sign the empty body, `t + "."`), plus `Idempotency-Key` on writes. The backend rejects a clock skew over 300 s and replays; the replay cache is keyed on method + path (with query) + signature, so two different calls signed in the same second do not collide, and every retry is signed again with a fresh `t`. |
| Render Workflows tasks → backend (`/internal/job-steps/{step}`) | Same scheme: `Margdarshak-Signature` with `INTERNAL_HMAC_SECRET` **and** `Authorization: Bearer $INTERNAL_BEARER_TOKEN`. Decision (24 Oct 2026): job steps are **not** exempt from the bearer check; the workflow service gets `INTERNAL_BEARER_TOKEN` in `infra/render.yaml` (same value as one entry of the API's `INTERNAL_BEARER_TOKENS`). |
| backend / Workflows → n8n webhooks | n8n Header Auth credential (`X-MD-Webhook-Token`, API env `N8N_WEBHOOK_TOKEN`) **and** a signed envelope `{ts, payload, sig}` with `sig = "sha256=" + hex(HMAC-SHA256(MD_HMAC_SECRET, ts + "." + payload))` (API env `N8N_HMAC_SECRET`), verified with the Crypto/Code node before any work (W02, W08, W09). W02 is `POST {N8N_BASE_URL}/webhook/md/milestone`; `payload` is the JSON string `{event, event_id, tenant, messages:[{notification_id, idempotency_key, channel, template_id, lang, to, vars}]}`. |
| our page → n8n Wait node | the browser never sees `$execution.resumeUrl`; the backend stores it on the task row and POSTs to it with the `X-MD-Resume-Token` header after the human acts (W08, W11, W15). |
| n8n → Meta / Gmail / Telegram | n8n credential vault; tokens rotated after the event. |

### 1.3 Error handling (all workflows)
- **HTTP nodes:** `retryOnFail: true`, 3 tries, 5–10 s apart. All backend calls are idempotent (idempotency keys or natural keys), so retries are safe.
- **Channel nodes** (WhatsApp, Gmail): `onError: continueErrorOutput` or `continueRegularOutput`, so one bad number doesn't stop a batch; failures are collected and acked to API-66, and the **backend** decides the fallback channel.
- **Workflow-level:** Settings → Error workflow = **W12**, which posts to on-call with the runbook link and dedupes for 30 min.
- **Execution data:** messaging workflows save **failed** executions only (`saveDataSuccessExecution: none`) to keep phone numbers out of logs; approval workflows save all executions for audit.
- **Timeouts:** every Wait node has a time limit; the timeout branch is explicit (never "approve on timeout").

### 1.4 PII in n8n
Phone number + first name, and only for users who opted in to that channel (E-14, E-15). No Aadhaar data, DOB, LL/DL numbers, case facts or free text. **A learner under 18 is in a parent's account (family mode, D-13 revised).** Every message goes to the account holder's opted-in channels: reminders, the coach plan and the family card, all with the parent's consent. A minor's case never gets WhatsApp marketing or engagement nudges built on behavioural tracking.

## 2. Approval patterns that work
| Pattern | How | Use for | Notes |
|---|---|---|---|
| **A. WhatsApp "Send and Wait for Response"** | WhatsApp node `sendAndWait` with approve/reject buttons (double approval type) and a wait limit | quick yes/no by a known person: moderator (W09), driving school accept/decline (W07) | the n8n docs list approval buttons, free text and custom forms with a wait-limit timeout (B-sponsors §3; verify the docs page on docs.n8n.io). Test on our n8n version on Day 1 |
| **B. Our page resumes a Wait node** | n8n stores `$execution.resumeUrl` through the backend → human acts in **our** UI (rich, accessible, audited) → backend POSTs the decision to the resume URL | anything needing context or a rich UI: clip windows (W08), the user approving their own escalation letter (W11), rule re-verification (W15), moderator fallback for W09 | **our default**: decisions are stored in our DB first, so n8n is only the timer |
| C. Telegram / Gmail send-and-wait | — | **avoid for approvals** | reports of executions not resuming ([n8n #13331](https://github.com/n8n-io/n8n/issues/13331), 08 §6). Telegram is used for **notifications only** |
| D. n8n AI Agent with human review of tool calls | n8n "human-in-the-loop tools" (B-sponsors §3) | not used | we keep all AI in the backend (ADK) behind the provenance validator |

## 3. The 15 workflows
Columns: **Trigger · main nodes · inputs → outputs · auth · error handling · executions/month (at 1k MAU) · why n8n, not code.** "Exported" marks the 4 JSON files in `n8n/workflows/`.

### W01 Daily case-clock tick (F-09) · exported
- **Trigger:** Schedule, cron `0 30 6 * * *`, workflow timezone `Asia/Kolkata`.
- **Nodes:** Schedule → Code (build body + idempotency key `case-clock:<date>`) → Crypto (HMAC) → HTTP `POST /internal/clock/sweep` (**API-65**; backend starts the Render Workflows task `case_clock_sweep`) → Wait 3 min → HTTP `GET …/outbox` → IF completed? (else loop, max 10 polls → Stop and Error → W12) → Split Out messages → Split in Batches (50) → Switch(channel) → WhatsApp template / Gmail → Code (receipt per item) → Aggregate → HTTP `POST /internal/webhooks/n8n` (**API-66**, receipts) → next batch.
- **Inputs → outputs:** none → `[{notification_id, channel, to, template_id, lang, vars[]}]` → delivery receipts on E-13.
- **Milestones computed in code:** LL day 25 "book now" (30-day minimum wait), LL expiry T-30/T-7 (6-month validity), DL renewal window, approval-stall escalation at day X (rules engine; EC-07, EC-16, EC-23).
- **Auth:** HMAC out; bearer token for the outbox read.
- **Errors:** HTTP retries; per-message `continueRegularOutput`; failed WhatsApp → backend sends email/web push; sweep not done → W12 (A-10, PB-08).
- **Executions:** 31.
- **Why n8n:** the schedule (Workflows has no cron), per-channel routing, a visible run log. Dates come from the rules engine.

### W02 Milestone event notifier (real time)
- **Trigger:** Webhook `md/milestone` from the backend (LL issued, payment pending > 2 h (EC-09), test result entered, licence approved).
- **Nodes:** Webhook → Crypto verify envelope → IF valid → Respond 202 → Switch(milestone) → WhatsApp template → Wait 24 h → HTTP `GET /internal/notifications/{id}/seen` → IF not seen and the backend says "fallback allowed" → HTTP `POST /internal/webhooks/n8n` (`X-MD-Event: request_fallback`; the backend sends email/web push).
- **Inputs → outputs:** event → 1–2 messages.
- **Auth:** envelope + Header Auth.
- **Errors:** as §1.3; a 24-h Wait has a resume limit and a timeout branch.
- **Executions:** ≈ 1–1.5 per active case per month ⇒ ≈ 1,000–1,500.
- **Why n8n:** event fan-out with a delay and a fallback, and copy changes without a deploy. **Moves to the backend at 100k MAU** (COST §5).

### W03 Slot-watch alerts (crowd-sourced, honest) (F-10, F-11)
- **Trigger:** Webhook `md/slot-watch-alert`, called by W09 when a **published** Live Intel report says slots opened at an office.
- **Nodes:** Webhook (Header Auth `X-MD-Internal`) → HTTP `GET /internal/watchers?office_id=` (backend applies the ≤ 1 nudge/day rule and opt-in) → Split → Batches → WhatsApp template "Reported by {n} users at {time}. Check Sarathi now." → receipts → API-66.
- **Inputs → outputs:** office_id → alerts.
- **Errors:** as §1.3.
- **Executions:** ≈ 50–200.
- **Why n8n:** we have **no Sarathi integration** and never scrape or book (D-08), so "notify me" can only relay moderated crowd reports. The message says so; no fake urgency (CCPA dark patterns).

### W04 Test-eve "what to bring" + ICS (F-12) · exported
- **Trigger:** Schedule `0 0 19 * * *` IST.
- **Nodes:** Schedule → Code (tomorrow's date, IST) → Crypto → HTTP `POST /internal/jobs/test-eve` → IF any → Split Out → Batches (40) → WhatsApp template `md_test_eve_v1` (header: ICS document via a 24-h presigned URL; body vars: first name, test kind, office, slot time; URL button to the test-day co-pilot) → receipts (sent/failed outputs) → Aggregate → API-66 (+ sets the `copilot_ready` flag) → next batch.
- **Inputs → outputs:** test list → messages; the stage-aware home shows the co-pilot (F-08).
- **Checklist content** (RC, insurance, PUC, LL, helmet, L-plate, owner consent note for a borrowed vehicle) comes from the rule pack via the co-pilot page; the template text carries no checklist or fee literal (D-06).
- **Errors:** failed sends go to the backend, which uses email/web push.
- **Executions:** 31.
- **Why n8n:** time-zoned batch messaging with attachments.

### W05 Weekly family card (F-17)
- **Trigger:** Schedule Sunday 10:00 IST.
- **Nodes:** Schedule → HTTP `POST /internal/jobs/parent-cards` → Split → backend-rendered card image URL → WhatsApp image template → receipts → API-66.
- **Scope change vs 08 W5:** only **learners who chose to share with a named family member** (e.g. Kabir → Mohan-ji, P-01/P-03). For a learner under 18 in family mode (D-13 revised), the card goes to the account holder (the parent), with the parent's consent. The card shows progress, the next date and "Govt fee for one class: computed from the rule pack" vs the agent quote the learner entered, never the word "official" (D-19).
- **Executions:** ≈ 4–5.
- **Why n8n:** calendar batch + media sending; rendering stays in the backend.

### W06 Weekly coach plan (F-21, M-03)
- **Trigger:** Schedule Monday 07:00 IST.
- **Nodes:** Schedule → HTTP `POST /internal/jobs/coach` (FSRS plan computed in code → CoachAgent wording through the validator; template fallback) → Split → web push or WhatsApp "your 4 sessions this week" with implementation-intention reply buttons ("On __ at __ I will…", 05 principle 4) → replies → API-66 (`X-MD-Event: intention_reply`).
- **Rules:** every learner (D-13 revised; a minor's plan goes to the account holder in family mode, with parental consent); ≤ 1 nudge/day; opt-in.
- **Executions:** ≈ 4–5 (+ reply events ≈ 200).
- **Why n8n:** orchestration around the AI and capturing button replies.

### W07 Driving-school lead routing (F-40)
- **Trigger:** Webhook "book a school" (learner consent recorded as a ConsentArtefact, E-15).
- **Nodes:** Webhook → verify → HTTP `POST /internal/leads/{id}/candidates` (backend ranks schools by area, class and test-vehicle need) → WhatsApp **send-and-wait** to school 1 (accept/decline, 4 h limit) → IF declined or timeout → next school (max 3) → HTTP `POST /internal/leads/{id}/assigned` → backend notifies the learner → SLA metric.
- **Executions:** 1 per lead ⇒ ≈ 50–200.
- **Why n8n:** ops routing with waits, timeouts and SLAs that change weekly; the schools' team can edit it without a deploy. Ranking stays in code.

### W08 Hazard-clip review queue (F-23, D-15) · exported
- **Trigger:** Webhook `md/clip-ready`, called by the Render Workflows task `clip_ingest` after transcode → blur faces/plates → propose windows (M-06, offline).
- **Nodes:** Webhook → Crypto (HMAC of the envelope) → IF valid & fresh (else 401) → Respond 202 → Code (parse payload, validate `clip_id`) → HTTP `POST /internal/clips/{id}/review-tasks` (**API-55**, stage `rater_1`, with `$execution.resumeUrl`) → Telegram notify curators → **Wait (resume webhook, header auth, ≤ 48 h)** → Switch(windows_set / reject / timeout) → HTTP create `rater_2` task (blind to rater 1, different person) → Telegram → **Wait ≤ 48 h** → IF windows_set → HTTP `POST /internal/jobs/clip_finalize` (API-67; starts the Workflows task `clip_finalize`: agreement in code → publish to the public bucket + manifest + CDN warm) → Telegram "finalizing" ; reject/timeout → HTTP `POST /internal/clips/{id}/status` → Telegram "stopped".
- **Inputs → outputs:** clip → published manifest entry (or rejected).
- **Why the split:** a Workflows run is capped at 24 h and has no sleep/pause (B-sponsors §1), but rating takes days. So **compute lives in Workflows runs before and after; the human wait lives in n8n**. The demo shows both: the Runs page (with the injected blur retry) and the n8n canvas.
- **Approval pattern:** B (our curator page resumes the Wait node). Telegram is notification only.
- **Errors:** retries; timeouts explicit; < 12 usable clips by Fri 12:00 triggers the Ruko backup (grand-council §5, R-06).
- **Executions:** 1 per clip ⇒ ≈ 40–120 during the build.
- **Why n8n:** long human approvals (hours to days) with reminders. **AI never auto-publishes** (04).

### W09 RTO Live Intel moderation (F-11, D-14) · exported
- **Trigger:** Webhook `md/intel-report` from API-28 after the report is stored as `pending`.
- **Nodes:** Webhook → Crypto → IF valid (else 401) → 202 → Code (parse) → HTTP `POST /internal/intel/{id}/precheck` (backend: PII regex, phone/UPI, duplicates, velocity, agent-promotion classifier on Flash-Lite **in the backend**, corroboration count, k-threshold) → IF `auto_publish_allowed` → record decision; else → **WhatsApp send-and-wait** to the moderator (Publish / Reject, ≤ 12 h) → Code normalise (timeout ≠ approval → `timeout_hold`) → HTTP `/decision` (backend publishes/rejects, writes the audit log, re-checks k ≥ 5 before any field is visible) → IF published "slots opened" → W03.
- **Rules (in code):** structured fields only, no free text, no names of officials, examiners or agents; seeded rows labelled "sample data"; show a field only when n ≥ 5 reports in 30 days; corruption reports deep-link to ACB/vigilance and CPGRAMS (D-14). A "setting"/fake-slot offer (EC-24) is always high risk.
- **Approval pattern:** A (WhatsApp), with B (`/admin/intel` page) as the fallback.
- **Executions:** 1 per report ⇒ ≈ 100–500.
- **Why n8n:** a moderation queue with human decisions and fan-out; thresholds stay in code.

### W10 Fail follow-up and retest plan (F-13)
- **Trigger:** Webhook `test_failed` (self-entered or decoded from a screenshot, F-32).
- **Nodes:** Webhook → verify → Wait 18 h → WhatsApp template "your retest plan is ready" (**no outcome words in the preview**, to save face) → HTTP `GET /internal/cases/{id}/retest-date` (7-day gap and remedial-training rule from the rules engine, EC-08) → Wait until that date (resume by time; Wait node "at specified time") → reminder + remedial-training referral list (from the backend).
- **Executions:** 1 per fail ⇒ ≈ 100–300.
- **Why n8n:** multi-day timers and branches without a cron table in our DB. **Moves to the JobRunner at 100k MAU.**

### W11 Escalation letter with the user's approval (F-14)
- **Trigger:** Webhook from the backend when a stage has stalled > N days (right-to-service timelines from the rules engine; EC-23 "passed but no SMS in 3 days").
- **Nodes:** Webhook → verify → HTTP `POST /internal/letters/{id}/draft` (template filled with facts only) → web push "review your letter" → **Wait (resume webhook) for the user's explicit approval in our app** (pattern B, 7-day limit) → HTTP render PDF → Gmail: send the PDF **to the user** with "how to file on CPGRAMS" steps → optional, only if the user ticked it: email to the published RTO grievance address from our domain, user in CC → API-66 log.
- **Never:** file on CPGRAMS for the user (it needs their login/OTP, which we never touch, D-07).
- **Executions:** ≈ 20–100.
- **Why n8n:** multi-day human approval and document dispatch.

### W12 Incident and guardrail alerts
- **Trigger:** (a) Error Trigger (it is every workflow's error workflow); (b) webhooks from Sentry/Grafana alerting; (c) Schedule every **15 min** (not 5: 5 min ≈ 8.6k executions/month, 08 §6) calling `GET /internal/ops/metrics` and pinging the backend heartbeat (A-13).
- **Nodes:** triggers → IF thresholds crossed (5xx > 2 %, debrief fallback > 20 %, validator rejection spike, Live errors, the scam checker marking a reported scam as "not a scam" (the verdict is code; this is a review trigger)) → dedupe 30 min (static data key) → Telegram on-call with the runbook link (OBSERVABILITY §7).
- **Executions:** ≈ 2,900 (15-min schedule) + errors. At scale: webhook-only (≈ 300).
- **Why n8n:** on-call routing and dedupe are glue; thresholds editable live during the hackathon. **Thresholds also live in Grafana alerting**, so W12 is a convenience, not the only alarm.

### W13 Analytics digest (F-55)
- **Trigger:** Schedule 21:00 IST daily (hackathon), Monday later.
- **Nodes:** Schedule → HTTP `POST /internal/jobs/analytics-digest` (backend runs the versioned SQL in `ops/queries/*.sql`, aggregated, no PII: funnel plan → apply → LL → bridge → DL; Nazar latency day 1 → N; readiness distribution; fallback rate; ₹ cost) → Code (format) → Telegram/Slack post + Google Sheets append.
- **Change vs 08 W13:** n8n doesn't query Postgres directly; it calls the backend (keeps DB credentials out of n8n).
- **Executions:** 31.
- **Why n8n:** cadence and channel change without a deploy.

### W14 Field-test capture and export (F-57, D-22)
- **Trigger:** n8n Form trigger (consent + pseudonymous participant code, 18+ confirmation) and webhook `session_end` for cohort `field_test`.
- **Nodes:** Form → HTTP `POST /v1/lab/trials` (API-70; backend creates the pseudonymous participant and the ConsentArtefact) → on each `session_end`: HTTP get the **server-rescored** result → Google Sheets append (code, game, score, latency, calibration) → hourly summary to Slack.
- **No names stored.** Delete on request removes the sheet rows too (backend calls a W14 sub-flow).
- **Executions:** ≈ 40–80 participants × ≈ 5 sessions ⇒ ≈ 400.
- **Why n8n:** the fastest way to get the judges' "real people" evidence into a sheet the whole team can see.

### W15 Rules and source freshness check (F-42)
- **Trigger:** Schedule weekly (Monday 09:00 IST).
- **Nodes:** Schedule → HTTP `POST /internal/jobs/rules-sources` (list of `{rule_id, source_url, last_hash}`) → Split → HTTP GET each source (timeout 20 s) → Crypto hash → IF changed or 404 → HTTP create a review task (resume URL) → Telegram "rule {id} source changed, re-verify" → **Wait (pattern B)** for the reviewer's decision in the rule-pack studio → HTTP `POST /v1/admin/rulepacks/.../verify` (API-54, maker-checker).
- Includes the Kerala HPT sources (A-20, PB-05) and the CMVR fee source.
- **Executions:** ≈ 4–5 (+ review waits).
- **Why n8n:** keeps the "verified on" promise honest without code; the review is human.

## 4. Execution budget (Pro ≈ 10k/month)
| Group | Workflows | Executions/month at 1k MAU |
|---|---|---|
| Daily schedules | W01, W04, W13 | ≈ 93 |
| Weekly schedules | W05, W06, W15 | ≈ 14 |
| Alerts | W12 (15-min) | ≈ 2,900 |
| Events | W02, W03, W07, W08, W09, W10, W11, W14 | ≈ 3,000–5,000 |
| **Total** | | **≈ 6,000–8,000 (fits Pro)** |

Rules: batch per run, never one execution per user; no polling loops faster than 3 min; a monthly burn-down on dashboard D5 with an alert at 85 % (A-12). Above 1k MAU, see COST.md §5 for what moves into code.

## 5. Versioning, testing and change control
- Every workflow is exported to `n8n/workflows/Wxx-*.json` on change and committed (CI runs `check-wording.mjs` on these files: no fee literals, no banned words).
- Credentials are never exported (references read `REPLACE_ON_IMPORT`).
- Test with pinned data in n8n before activation; then one end-to-end run against staging.
- A change that alters *what* is sent (template text) goes through Meta template approval; a change in *who/when* is a backend change with a test, never an n8n edit.
- Owners: Ops lead (W01–W06, W10–W13), Nazar content lead (W08), Trust & safety lead (W09), Research lead (W14), Rules owner (W15), Partnerships (W07).

## 6. Production (state) notes
- n8n may be **self-hosted in the state's cluster** or **replaced**: schedules → Kubernetes CronJobs calling the same `/internal/*` endpoints; human queues → the backend's own review pages with the JobRunner (Temporal) waiting for the decision signal. Nothing about the user-facing behaviour changes (D-16).
- The n8n licence (Sustainable Use License) needs legal review for government self-hosting [unverified; owner Nestiq legal; before the first state MoU].
- Messaging moves to the state's channels: NIC/mGov SMS with DLT templates, WhatsApp through the state's approved business account if it has one.
