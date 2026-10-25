# n8n workflows
> Project: Margdarshak · Owner: Ops lead (Team Chanakya) · Status: Draft v0.2 · Last updated: 2026-10-24
> Related: [ADR-0006](../03-engineering/adr/ADR-0006-n8n-edge-only.md) · [n8n/README](../../n8n/README.md) · [INFRASTRUCTURE](INFRASTRUCTURE.md) · [OBSERVABILITY](OBSERVABILITY.md) · [RUNBOOK](RUNBOOK.md) (PB-02, PB-08, PB-09) · [COST](COST.md) §5 · [API_SPEC](../03-engineering/API_SPEC.md) · [PRIVACY](../06-security-compliance/PRIVACY.md) · [research 08 §6](../../../research/ps1-deep/08-game-ai-n8n.md)
> Exported JSON: [W01](../../n8n/workflows/W01-case-clock-tick.json) · [W08](../../n8n/workflows/W08-clip-review-queue.json) · [W09](../../n8n/workflows/W09-live-intel-moderation.json) · [W13](../../n8n/workflows/W13-analytics-digest.json) · [W14](../../n8n/workflows/W14-field-test-capture.json) · [W02](../../n8n/workflows/W02-milestone-notifier.json) (P1 citizen relay, retiring)

## 0. The rule
**n8n is the internal operations layer, used by staff, not citizens** (ADR-0006 rev. 2026-10-24; D-16).
- It fires schedules, waits for human decisions, and notifies **staff**: our team (curators, moderators, on-call), driving-school staff, and RTO/state staff once a state adopts.
- **No citizen message goes through n8n.** Reminders, milestones, slot alerts, coach plans, family cards and letters are queued by the backend and sent by the backend notifier (`NotificationPort`, §0.2).
- Every decision comes from the backend over signed HTTP: who is due, which date, which rule, which threshold, whether a report is risky. n8n moves a staff message and waits for the human.
- **If n8n fails, a staff task is late. No fact a citizen sees changes, and no citizen message is delayed.**
- **Never in n8n:** the rules engine, fee and timeline maths, eligibility, scoring, FSRS, the ADK graph and validators, the PII gate, the scam verdict, the share-card renderer, k-anonymity thresholds, moderation risk scores, alert thresholds. n8n "Code" nodes only reshape JSON (split, map, collect receipts); a Code node with an `if` on business data fails review.
- SMS isn't wired anywhere until TRAI DLT registration (D-16).

### 0.1 Why this scales (the answer for judges)
**n8n's load grows with the number of staff, offices and review tasks. It does not grow with the number of citizens.**

| Load | Grows with | Where it runs |
|---|---|---|
| Citizen notifications (up to ≈ 660k/day at the national peak in ARCHITECTURE §13, capped at ≤ 1 nudge/user/day) | citizens | backend notifier: outbox → queue → WhatsApp Cloud API / email / web push, horizontally scaled with the API |
| Inbound receipts, replies, STOP (2–3 per message) | citizens | Go API-66, stateless replicas |
| Daily case-clock trigger (W01) | nothing: 1 run/day | n8n |
| Clip ratings (W08), flagged Live Intel reports (W09), school leads (W07) | how many decisions humans can make | n8n |
| RTO briefs, alerts and staff reminders (W16–W18) | offices and staff | n8n |

So at 1k users or 10M users, n8n runs about the same number of executions. The high-volume path is ordinary backend code that scales with the API, has contract tests, and can be handed to NIC.

**Why n8n at all:** Render Workflows has **no cron trigger, no sleep and no completion webhook** (B-sponsors §1). n8n gives us schedules, multi-day human waits, WhatsApp approval buttons for staff, a run log a non-developer can read, and changes to staff routing without a deploy. n8n Pro is a sponsor perk (B-sponsors §0).

### 0.2 What moved to the backend (and why)
These were n8n workflows in v0.1. Each one sends to citizens, so its volume grows with users. They are now TimelineEvents (E-12) that the daily case-clock sweep turns into outbox rows. The backend notifier sends each row inside the user's send window (quiet hours, ≤ 1 nudge/day, opt-outs; all in `NotificationPort`).

| Was | What | Now |
|---|---|---|
| W01 delivery half | LL day 25 "book now", LL expiry T-30/T-7, renewal window, approval stall (F-09) | `case_clock_sweep` queues; notifier sends. W01 keeps only the trigger and watchdog |
| W02 | milestone messages (LL issued, payment pending, result entered, approved) with fallback | case reducer writes the outbox row on the event; notifier sends and falls back to email/web push after 24 h unseen |
| W03 | slot-watch alerts after a moderated "slots opened" report (F-10, F-11) | the API-68 decision handler fires watchers (API-69 logic) straight into the outbox |
| W04 | test-eve "what to bring" + ICS (F-12) | TimelineEvent `test_eve` with `send_after` 19:00 IST on the eve; ICS link is a presigned URL from the backend |
| W05 | weekly family card (F-17) | weekly TimelineEvent per opted-in adult learner, or to the account holder for a family-mode case of a minor (D-13 revised); card rendered by `mg-web` OG route |
| W06 | weekly coach plan + intention replies (F-21, M-03) | weekly TimelineEvent; CoachAgent wording runs in the sweep's Workflows run; replies land on API-66 |
| W10 | fail follow-up and retest reminder (F-13) | `test_failed` event schedules TimelineEvents for "plan ready" (+18 h) and the retest date from the rules engine (EC-08) |
| W11 | escalation letter after the user approves (F-14) | backend letter flow: draft → in-app approval → PDF → email to the user via the notifier → API-72 dispatch |

**As built (P1 code, 24 Oct):** the Go API still delivers citizen messages through the n8n W02 webhook (`n8n/workflows/W02-milestone-notifier.json`, `services/api/internal/adapters/notify/n8n.go`). The rows above are the decided target; moving the code to the notifier is open in [`WHATS_LEFT.md`](../08-project/WHATS_LEFT.md).

Notifier adapters (BACKEND §3): `WhatsAppCloudNotifier` (Meta WhatsApp Cloud API, per-tenant number), `EmailNotifier` (SMTP to the transactional provider chosen at G0), `WebPushNotifier` (VAPID), `ConsoleNotifier` (dev). `MgovSmsNotifier` after TRAI DLT. All pass the NotificationPort contract suite (quiet hours, daily cap, STOP within one message, EC-30).

## 1. Common contract
### 1.1 Endpoints n8n calls
| Path | Brief ID | Used by | Purpose |
|---|---|---|---|
| `POST /internal/clock/sweep` | **API-65** | W01 | start the Workflows task `case_clock_sweep`; returns `{sweep_id, task_run_id}` |
| `GET /internal/clock/sweep/{id}/status` | (API-65 family) | W01 | run status + counts only (no recipients) |
| `POST /internal/webhooks/n8n` | **API-66** | all | staff receipts, button choices, acknowledgements, heartbeats (`X-MD-Event` header selects the handler) |
| `POST /internal/jobs/{analytics-digest, rules-sources, rto-brief, staff-tasks}` | **API-67** family (proposed job names) | W13, W15, W16, W18 | batch "which staff get what" lists, computed in code |
| `POST /internal/intel/{id}/decision` | **API-68** | W09 | record the moderator's decision (precheck already ran in the backend) |
| `POST /internal/clips/{id}/review-tasks`, `POST /internal/jobs/clip_finalize` (API-67), `POST /internal/clips/{id}/status` | **API-55 internal / API-67** | W08 | clip review tasks and finalize (bearer + `Margdarshak-Signature` HMAC) |
| `POST /internal/leads/{id}/...` | **API-73** | W07 | school lead routing |
| `POST /internal/console/alerts/{id}/ack` | API-53 family (proposed) | W17 | record an RTO/state acknowledgement or escalation |

### 1.2 Auth
| Direction | Mechanism |
|---|---|
| n8n → backend | `Authorization: Bearer <MD_N8N_READ_TOKEN>` (one of the API's `INTERNAL_BEARER_TOKENS`) **and** `Margdarshak-Signature: t=<unix>,v1=<hex HMAC-SHA256(MD_HMAC_SECRET, t + "." + body)>` (GETs sign the empty body, `t + "."`), plus `Idempotency-Key` on writes. The backend rejects a clock skew over 300 s and replays; the replay cache is keyed on method + path (with query) + signature, so two different calls signed in the same second do not collide, and every retry is signed again with a fresh `t`. |
| Render Workflows tasks → backend (`/internal/job-steps/{step}`) | Same scheme: `Margdarshak-Signature` with `INTERNAL_HMAC_SECRET` **and** `Authorization: Bearer $INTERNAL_BEARER_TOKEN`. Decision (24 Oct 2026): job steps are **not** exempt from the bearer check; the workflow service gets `INTERNAL_BEARER_TOKEN` in `infra/render.yaml` (same value as one entry of the API's `INTERNAL_BEARER_TOKENS`). |
| backend / Workflows → n8n webhooks | n8n Header Auth credential (`X-MD-Webhook-Token`, API env `N8N_WEBHOOK_TOKEN`) **and** a signed envelope `{ts, payload, sig}` with `sig = "sha256=" + hex(HMAC-SHA256(MD_HMAC_SECRET, ts + "." + payload))` (API env `N8N_HMAC_SECRET`), verified with the Crypto/Code node before any work (W08, W09, W17; and the P1 W02 relay while it lasts: `POST {N8N_BASE_URL}/webhook/md/milestone`, `payload` = the JSON string `{event, event_id, tenant, messages:[{notification_id, idempotency_key, channel, template_id, lang, to, vars}]}`). |
| our page → n8n Wait node | the browser never sees `$execution.resumeUrl`; the backend stores it on the task row and POSTs to it with the `X-MD-Resume-Token` header after the human acts (W08, W15, W17). |
| n8n → Meta / email / Telegram | n8n credential vault; tokens rotated after the event. The n8n WhatsApp number is a **staff** number, separate from the citizen tenant number used by the backend. |

### 1.3 Error handling (all workflows)
- **HTTP nodes:** `retryOnFail: true`, 3 tries, 5–10 s apart. All backend calls are idempotent (idempotency keys or natural keys), so retries are safe.
- **Channel nodes** (WhatsApp, email): `onError: continueErrorOutput` or `continueRegularOutput`, so one bad address doesn't stop a batch; failures are acked to API-66.
- **Workflow-level:** Settings → Error workflow = **W12**, which posts to on-call with the runbook link and dedupes for 30 min.
- **Execution data:** staff-messaging workflows save **failed** executions only (`saveDataSuccessExecution: none`); approval workflows save all executions for audit.
- **Timeouts:** every Wait node has a time limit; the timeout branch is explicit (never "approve on timeout").

### 1.4 Data in n8n
- **No citizen personal data.** No citizen phone numbers, emails, names, DOB, Aadhaar data, LL/DL numbers, case facts or free text. Payloads carry IDs and aggregates.
- **Staff contact data only:** work email or opted-in work WhatsApp of named team members, school staff and RTO/state staff (stored in the backend; n8n receives it per run, or holds team numbers in Variables).
- **Aggregates for RTO staff are k-anonymous** (k ≥ 5) and never name applicants, examiners or agents (D-14).
- **Until the notifier lands (P1 build):** the W02 relay still receives phone number + first name, and only for users who opted in to that channel (E-14, E-15); for a learner under 18 in family mode (D-13 revised) that is the account holder's channel. No Aadhaar data, DOB, LL/DL numbers, case facts or free text.

## 2. Approval patterns that work
| Pattern | How | Use for | Notes |
|---|---|---|---|
| **A. WhatsApp "Send and Wait for Response"** | WhatsApp node `sendAndWait` with approve/reject buttons and a wait limit | quick yes/no by a known staff member: moderator (W09), school accept/decline (W07), RTO acknowledge (W17) | test on our n8n version on Day 1 |
| **B. Our page resumes a Wait node** | backend stores `$execution.resumeUrl` → staff act in **our** UI (rich, accessible, audited) → backend POSTs the decision to the resume URL | anything needing context: clip windows (W08), rule re-verification (W15), W09 and W17 fallback | **our default**: decisions are stored in our DB first, so n8n is only the timer |
| C. Telegram / Gmail send-and-wait | — | **avoid for approvals** | reports of executions not resuming ([n8n #13331](https://github.com/n8n-io/n8n/issues/13331), 08 §6). Telegram is used for **notifications only** |
| D. n8n AI Agent with human review of tool calls | — | not used | we keep all AI in the backend (ADK) behind the provenance validator |

## 3. The workflows
Columns: **Trigger · main nodes · inputs → outputs · error handling · executions/month · why n8n, not code.** "Exported" marks the JSON files in `n8n/workflows/`. Retired numbers (W02–W06, W10, W11) are listed in §0.2 and not reused.

### W01 Daily case-clock trigger and watchdog (F-09) · exported
- **Trigger:** Schedule, cron `0 30 6 * * *`, workflow timezone `Asia/Kolkata`.
- **Nodes:** Schedule → Code (build body + idempotency key `case-clock:<date>`) → Crypto (HMAC) → HTTP `POST /internal/clock/sweep` (**API-65**; backend starts the Render Workflows task `case_clock_sweep`) → Wait 3 min → HTTP `GET …/status` → IF completed → Done; else loop (max 10 polls) → Stop and Error → W12.
- **What the sweep does (in code):** scans due TimelineEvents, applies quiet hours, the daily cap and opt-outs, writes outbox rows with `send_after`. The backend notifier delivers them. n8n never sees a recipient.
- **Errors:** HTTP retries; sweep not done in 30 min → W12 (A-10, PB-08).
- **Executions:** 31, at any number of users.
- **Why n8n:** the schedule (Workflows has no cron) and a visible watchdog.

### W07 Driving-school lead routing (F-40) · school staff
- **Trigger:** Webhook "book a school" (learner consent recorded as a ConsentArtefact, E-15).
- **Nodes:** Webhook → verify → HTTP `POST /internal/leads/{id}/candidates` (**API-73**; backend ranks schools by area, class and test-vehicle need) → WhatsApp **send-and-wait** to the school's staff number (accept/decline, 4 h limit) → IF declined or timeout → next school (max 3) → HTTP `POST /internal/leads/{id}/assigned` → **backend** notifies the learner → SLA metric.
- **Data:** the school sees a lead ID, area and class only until it accepts; contact details are released by the backend after acceptance.
- **Executions:** 1 per lead ⇒ ≈ 50–200 at hackathon scale.
- **Scale trigger:** above ≈ 2,000 leads/month, lead offers move to the school portal inbox (F-40) and W07 keeps only SLA escalations (no answer in 4 h).
- **Why n8n:** ops routing with waits, timeouts and SLAs that change weekly; the partnerships team edits it without a deploy. Ranking stays in code.

### W08 Hazard-clip review queue (F-23, D-15) · exported · curators
- **Trigger:** Webhook `md/clip-ready`, called by the Render Workflows task `clip_ingest` after transcode → blur faces/plates → propose windows (M-06, offline).
- **Nodes:** Webhook → Crypto (HMAC of the envelope) → IF valid & fresh (else 401) → Respond 202 → Code (parse payload, validate `clip_id`) → HTTP `POST /internal/clips/{id}/review-tasks` (**API-55**, stage `rater_1`, with `$execution.resumeUrl`) → Telegram notify curators → **Wait (resume webhook, header auth, ≤ 48 h)** → Switch(windows_set / reject / timeout) → HTTP create `rater_2` task (blind to rater 1, different person) → Telegram → **Wait ≤ 48 h** → IF windows_set → HTTP `POST /internal/jobs/clip_finalize` (API-67; starts the Workflows task `clip_finalize`: agreement in code → publish to the public bucket + manifest + CDN warm) → Telegram "finalizing" ; reject/timeout → HTTP `POST /internal/clips/{id}/status` → Telegram "stopped".
- **Inputs → outputs:** clip → published manifest entry (or rejected).
- **Why the split:** a Workflows run is capped at 24 h and has no sleep/pause (B-sponsors §1), but rating takes days. So **compute lives in Workflows runs before and after; the human wait lives in n8n**. The demo shows both: the Runs page (with the injected blur retry) and the n8n canvas.
- **Approval pattern:** B (our curator page resumes the Wait node). Telegram is notification only.
- **Errors:** retries; timeouts explicit; < 12 usable clips by Fri 12:00 triggers the Ruko backup (grand-council §5, R-06).
- **Executions:** 1 per clip ⇒ ≈ 40–120 during the build.
- **Why n8n:** long human approvals (hours to days) with reminders. **AI never auto-publishes** (04).

### W09 RTO Live Intel moderation (F-11, D-14) · exported · moderators
- **Trigger:** Webhook `md/intel-report`, called by the backend **only for reports its precheck flags for a human**. The precheck runs inline on API-28 (PII regex, phone/UPI, duplicates, velocity, agent-promotion classifier on Flash-Lite **in the backend**, corroboration count, k-threshold). Low-risk reports auto-publish in the backend and never reach n8n.
- **Nodes:** Webhook → Crypto → IF valid (else 401) → 202 → Code (parse, incl. `risk`, `reasons`, `corroborating_24h`, `summary_for_moderator`) → **WhatsApp send-and-wait** to the moderator (Publish / Reject, ≤ 12 h) → Code normalise (timeout ≠ approval → `timeout_hold`) → HTTP `/decision` (**API-68**; backend publishes/rejects, writes the audit log, re-checks k ≥ 5 before any field is visible, and fires slot-watch alerts to citizens itself).
- **Rules (in code):** structured fields only, no free text, no names of officials, examiners or agents; seeded rows labelled "sample data"; show a field only when n ≥ 5 reports in 30 days; corruption reports deep-link to ACB/vigilance and CPGRAMS (D-14). A "setting"/fake-slot offer (EC-24) is always high risk.
- **Approval pattern:** A (WhatsApp), with B (`/admin/intel` page) as the fallback.
- **Executions:** 1 per flagged report ⇒ ≈ 20–100 at hackathon scale; bounded by moderator capacity, and the backend raises the auto-publish share as the classifier earns trust.
- **Why n8n:** a moderation queue with human decisions; thresholds stay in code.

### W12 Incident and guardrail alerts · on-call
- **Trigger:** (a) Error Trigger (it is every workflow's error workflow); (b) webhooks from Sentry/Grafana alerting; (c) Schedule every **15 min** (not 5: 5 min ≈ 8.6k executions/month, 08 §6) calling `GET /internal/ops/metrics` and pinging the backend heartbeat (A-13).
- **Nodes:** triggers → IF the backend says a threshold is crossed (5xx > 2 %, debrief fallback > 20 %, validator rejection spike, Live errors, notifier failure rate, outbox backlog age, the scam checker marking a reported scam as "not a scam" (the verdict is code; this is a review trigger)) → dedupe 30 min (static data key) → Telegram on-call with the runbook link (OBSERVABILITY §7).
- **Executions:** ≈ 2,900 (15-min schedule) + errors. At scale: webhook-only (≈ 300).
- **Why n8n:** on-call routing and dedupe are glue. **Thresholds also live in Grafana alerting**, so W12 is a convenience, not the only alarm.

### W13 Analytics digest (F-55) · team
- **Trigger:** Schedule 21:00 IST daily (hackathon), Monday later.
- **Nodes:** Schedule → HTTP `POST /internal/jobs/analytics-digest` (backend runs the versioned SQL in `ops/queries/*.sql`, aggregated, no PII: funnel plan → apply → LL → bridge → DL; Nazar latency day 1 → N; readiness distribution; fallback rate; notifier delivery rate; ₹ cost) → Code (format) → Telegram/Slack post + Google Sheets append.
- n8n doesn't query Postgres directly; it calls the backend (keeps DB credentials out of n8n).
- **Executions:** 31.
- **Why n8n:** cadence and channel change without a deploy.

### W14 Field-test capture and export (F-57, D-22) · research team, hackathon only
- **Trigger:** n8n Form trigger (consent + pseudonymous participant code, 18+ confirmation) and webhook `session_end` for cohort `field_test`.
- **Nodes:** Form → HTTP `POST /v1/lab/trials` (API-70; backend creates the pseudonymous participant and the ConsentArtefact) → on each `session_end`: HTTP get the **server-rescored** result → Google Sheets append (code, game, score, latency, calibration) → hourly summary to Slack.
- **No names stored.** Delete on request removes the sheet rows too (backend calls a W14 sub-flow).
- **Executions:** ≈ 40–80 participants × ≈ 5 sessions ⇒ ≈ 400.
- **Why n8n:** the fastest way to get the judges' "real people" evidence into a sheet the whole team can see.

### W15 Rules and source freshness check (F-42) · rules owner
- **Trigger:** Schedule weekly (Monday 09:00 IST).
- **Nodes:** Schedule → HTTP `POST /internal/jobs/rules-sources` (list of `{rule_id, source_url, last_hash}`) → Split → HTTP GET each source (timeout 20 s) → Crypto hash → IF changed or 404 → HTTP create a review task (resume URL) → Telegram "rule {id} source changed, re-check" → **Wait (pattern B)** for the reviewer's decision in the rule-pack studio → HTTP `POST /v1/admin/rulepacks/.../verify` (API-54, maker-checker).
- Includes the Kerala HPT sources (A-20, PB-05) and the CMVR fee source.
- **Executions:** ≈ 4–5 (+ review waits).
- **Why n8n:** keeps the "checked on" date honest; the review is human.

### W16 RTO morning brief (F-41) · RTO/ARTO staff · government mode
- **Trigger:** Schedule 08:00 IST, Monday–Saturday.
- **Nodes:** Schedule → HTTP `POST /internal/jobs/rto-brief` (backend returns one brief per office for staff who opted in) → Split → Batches (50) → email (or WhatsApp template to an opted-in work number) → receipts → API-66.
- **Content (computed in code, aggregated, k ≥ 5):** tests expected today (slot adapter or self-reports), applications stalled > N days by stage, top query themes the app answered, LL expiries due this week in the office's area (counts only), Live Intel items about the office awaiting a response, and a link to the office's console view (API-53).
- **Never:** applicant names, examiner names, individual cases, or rankings of named staff (D-14).
- **Executions:** ≈ 26/month (one run covers every office).
- **Why n8n:** a schedule and channel routing for a small, known audience whose preferences change per state; the brief itself is a backend query.

### W17 Stall and SLA alerts with acknowledgement (F-41) · RTO and state staff · government mode
- **Trigger:** Webhook `md/console-alert` from the backend when a code-computed threshold is crossed: a stage's stall rate at an office above its 4-week baseline, approval backlog past the state's right-to-service days, a fail-reason spike, or slot utilisation dropping. The backend sends at most one alert per office per metric per week.
- **Nodes:** Webhook → Crypto verify → 202 → WhatsApp **send-and-wait** to the office's nominated officer ("Acknowledge" / "Not ours", 48 h) → IF acknowledged → HTTP `POST /internal/console/alerts/{id}/ack`; IF timeout → notify the state nodal officer → Wait 48 h → HTTP ack/escalation record.
- **Approval pattern:** A, with B (the console's alert page) as the fallback.
- **Executions:** ≈ 2–4 per office per month.
- **Why n8n:** acknowledgement and escalation chains with timeouts, editable per state without a deploy.

### W18 Staff task reminders · all staff roles
- **Trigger:** Schedule 10:00 IST daily.
- **Nodes:** Schedule → HTTP `POST /internal/jobs/staff-tasks` (backend returns one digest per staff member) → Split → email / Telegram (team) / WhatsApp (opted-in work number) → receipts → API-66.
- **Covers:** rule-pack changes waiting for a checker (F-42 maker-checker), Live Intel moderation items older than 6 h, overdue clip ratings, practice sign-off requests pending > 3 days for school staff (API-49), privacy grievance tickets near their response deadline (F-54).
- **One digest per person, never one message per task.**
- **Executions:** 31.
- **Why n8n:** one schedule, many staff channels; the task lists come from the backend.

## 4. Execution budget (Pro ≈ 10k/month)
| Group | Workflows | Executions/month (hackathon) | Grows with |
|---|---|---|---|
| Daily schedules | W01, W13, W16, W18 | ≈ 120 | nothing |
| Weekly schedules | W15 | ≈ 5 | nothing |
| Alerts | W12 (15-min) | ≈ 2,900 | nothing (webhook-only at scale) |
| Human queues | W07, W08, W09, W17 | ≈ 150–500 | leads, clips, flagged reports, offices |
| Field study | W14 | ≈ 400 | participants (hackathon only) |
| **Total** | | **≈ 3,500–4,000 (fits Pro)** | |

Rules: batch per run, never one execution per citizen; no polling loops faster than 3 min; a monthly burn-down on dashboard D5 with an alert at 85 % (A-12). In government mode n8n is self-hosted (no execution cap); the budget still matters as a design check that n8n never fans out per citizen.

## 5. Versioning, testing and change control
- Every workflow is exported to `n8n/workflows/Wxx-*.json` on change and committed (CI runs `check-wording.mjs` on these files: no fee literals, no banned words).
- CI fails if any exported workflow contains a Postgres node or credentials, **or any WhatsApp template registered for citizens** (those belong to the backend notifier).
- Credentials are never exported (references read `REPLACE_ON_IMPORT`).
- Test with pinned data in n8n before activation; then one end-to-end run against staging.
- A change in *who/when/what* is a backend change with a test, never an n8n edit.
- Owners: Ops lead (W01, W12, W13, W18), Nazar content lead (W08), Trust & safety lead (W09), Research lead (W14), Rules owner (W15), Partnerships (W07), Government partnerships lead (W16, W17).

## 6. Production (state) notes
- n8n is **self-hosted in the state's cluster** (queue mode with Redis workers if needed) or **replaced**: schedules → Kubernetes CronJobs or Temporal schedules calling the same `/internal/*` endpoints; human queues → the backend's own review pages with the JobRunner (Temporal) waiting for the decision signal. Citizens notice nothing either way, because their messages never used n8n (D-16).
- The n8n licence (Sustainable Use License) needs legal review for government self-hosting [unverified; owner Nestiq legal; before the first state MoU].
- Staff channels follow the state's choice: NIC email, the state's approved WhatsApp business account, or the console inbox only.
