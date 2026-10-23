# Runbook
> Project: Margdarshak · Owner: Ops lead (Team Chanakya) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [OBSERVABILITY](OBSERVABILITY.md) (alerts A-01..A-21) · [DEPLOYMENT](DEPLOYMENT.md) (flags, rollback) · [INFRASTRUCTURE](INFRASTRUCTURE.md) (backups, DR) · [N8N_WORKFLOWS](N8N_WORKFLOWS.md) · [PITCH](../00-overview/PITCH.md) (demo script) · [PRIVACY](../06-security-compliance/PRIVACY.md) · [COMPLIANCE](../06-security-compliance/COMPLIANCE.md) · [RISK_REGISTER](../06-security-compliance/RISK_REGISTER.md)

## 0. How to use this page
Find the alert ID in OBSERVABILITY §7 → open the playbook → do the **first 5 minutes** steps before diagnosing. Every playbook ends with "close": write a 5-line incident note in `docs/05-ops/incidents/YYYY-MM-DD-<slug>.md` (what, impact, timeline, fix, follow-up).

## 1. On-call basics
| | Hackathon (23–24 Oct 2026 build; judging per the organiser schedule) | Production (state tenant) |
|---|---|---|
| Primary | Ops lead | Nestiq on-call engineer (weekly rotation) |
| Secondary | Backend lead | Nestiq backend lead |
| AI issues | AI lead | AI lead |
| Content / clips | Nazar content lead | content lead |
| Comms / judges / state | Product lead | Product lead + the state's nodal officer |
| Paging | Telegram group "md-oncall" + phone call for SEV-1 | phone + Telegram/Slack; the state's SOC copied on security events |
| Access | Render dashboard, n8n, Sentry, Grafana, GitHub, Meta app, R2 | Kubernetes namespace (break-glass role), Grafana, Vault (read-only), CSP console (read-only) |

Golden rules:
- **Stop the bleeding first.** Flip the kill switch (DEPLOYMENT §5) before you look for the root cause.
- **Never** hot-fix in the dashboard without writing it down in the incident channel.
- **Never** touch real citizen data during an incident unless the state's incident commander asks for it, and log every access.
- Facts users see (fees, eligibility, dates, scores) come from code and rule packs. If they're wrong, **hide them** (flag) rather than guessing a correction.

## 2. Severity levels
| Sev | Definition | Examples | Response | Update cadence |
|---|---|---|---|---|
| **SEV-1** | Users harmed or exposed, or the product is down at a critical moment | data breach; a minor's data reached the AI (A-08); site down during judging; wrong fee/eligibility shown at scale | page now; all hands; incident commander = Ops lead | every 15 min |
| **SEV-2** | Major feature broken or a legal duty at risk | API 5xx > 2 %; case-clock reminders not sent; WhatsApp down on test eve; log shipping broken (CERT-In) | respond ≤ 15 min | every 30 min |
| **SEV-3** | Degraded with a workaround | AI fallback active (template cards); one Workflows task failing with retries; Live Intel queue backed up | respond ≤ 1 h (hackathon: ≤ 15 min) | every 2 h |
| **SEV-4** | Minor / cosmetic / budget warning | n8n execution budget at 85 %; stale rule warning | next working day | — |

## 3. Playbooks
| ID | Playbook | Alerts |
|---|---|---|
| PB-01 | Gemini outage, errors or spend spike → template fallback | A-05, A-06, A-07, A-21 |
| PB-02 | WhatsApp delivery failure | A-09 |
| PB-03 | Render cold start / service not responding | A-03, A-04 |
| PB-04 | Rule-pack error (wrong fee, wrong rule, stale source) | A-15, A-16 |
| PB-05 | Kerala HPT stayed or postponed (EC-28) | A-20 |
| PB-06 | Data breach / security incident (DPDP + CERT-In 6 h) | A-17 |
| PB-07 | API errors, latency, DB or log-shipping trouble | A-01, A-02, A-18, A-19 |
| PB-08 | Render Workflows failures / case-clock sweep missed | A-10, A-11 |
| PB-09 | n8n down or execution budget exhausted | A-12, A-13 |
| PB-10 | Score replay mismatch / cheating wave | A-14 |
| PB-11 | Live Intel abuse, defamation or takedown notice (IT Rules 2021) | manual, W09 |
| PB-12 | Sarathi outage or broken hand-off link (EC-11) | manual, user reports |
| PB-13 | A minor reached an AI feature (D-13) | A-08 |

---

### PB-01 Gemini outage, errors or spend spike → template fallback
**Symptoms:** A-05 (fallback > 20 % / 5 min, breaker open), A-06 (5xx/429 > 10 %), A-21 (spend), debrief cards labelled "Auto notes" for everyone.
**First 5 minutes**
1. Check https://status.cloud.google.com / AI Studio status and D3 (AI dashboard): is it provider-wide (5xx), our quota (429), or our validator (rejections)?
2. If provider or quota: confirm the breaker is open (`/v1/health` → `ai_breaker: open`). If not, set flag `ai_debrief=off` (and `ai_screen_decoder=off`, `ai_voice_guide=off` if those are affected). **Users now get the reviewed template cards: same facts, less fluent (08 §5.6, EC-29).** Nothing is broken for the user.
3. If validator rejections spiked (model behaviour changed): leave the breaker doing its job; check `md.validator.reasons`; if `digit_outside_placeholder` dominates, the model is ignoring instructions. Pin `GEMINI_MODEL_DEBRIEF` back to the last known-good ID.
**Diagnose and fix**
- 429: raise the quota on the paid project or reduce `debrief_fanout` concurrency; spread nightly jobs.
- Model ID retired or renamed (04 notes the naming is in flux): set the env var to the fallback ID; run `evals.yml` (workflow_dispatch) before re-enabling.
- Spend spike: check voice minutes vs the 10-min/user/month cap (04 §5); set `ai_voice_guide=off` if the cap logic failed.
**Never:** switch to the **free tier** to "keep it running" (D-13, war-room G8: human review of prompts and 18+ terms). Never turn off the validator.
**Close:** re-enable flags one by one; watch fallback < 5 % for 15 min.

### PB-02 WhatsApp delivery failure
**Symptoms:** A-09; W01/W04 receipts show `failed`; users say "no reminder".
**First 5 minutes**
1. n8n → W01/W04 executions → read the Meta error code. Common: token expired (401), template not approved / paused, recipient not in the test-number allow-list (hackathon: max about 5 verified recipients), 24-hour customer-service window rules for non-template messages.
2. Set flag `whatsapp_outbound=off` if failures are total; the backend NotificationAdapter switches to **email + web push** for the same outbox rows (no message is lost; the outbox keeps them).
3. If it's test-eve (W04) and the test is tomorrow: run W04 manually after the fix; the backend's idempotency key `test-eve:<date>` prevents duplicates.
**Fix:** refresh the system-user token in the n8n credential; resubmit/fix the template; add the recipient to the allow-list (demo phone).
**Never:** fall back to SMS (not DLT-registered; D-16), or to personal WhatsApp accounts.
**User-facing:** the stage-aware home (F-08) shows the same reminder in-app, so the information is never only on WhatsApp.

### PB-03 Render cold start / service not responding
**Symptoms:** A-03 (first request > 10 s), A-04 (probe down), "the page is loading forever" from a judge.
**First 5 minutes**
1. Render dashboard → service → **Events / Logs**: is it deploying, crashed (OOM), or sleeping?
2. **Sleeping** should be impossible on paid plans; if someone switched a service to `free` (it sleeps after 15 min idle, ~1 min wake-up, B-sponsors §0), switch it back to `0.5c-512mb` / `1c-2g`.
3. **OOM / crash loop:** roll back to the previous deploy (Events → Rollback). For the API, bump to `2c-4g` temporarily.
4. Run `scripts/ops/warmup.sh` (6 web routes, 4 API routes).
**Judging-day rule:** if the live site doesn't answer within 60 s, switch to the **pre-recorded demo video** (§8) and keep talking; don't debug on stage.
**Prevention:** warm-up after each deploy (deploy.yml) and at T-30 min; a 5-min uptime probe keeps instances hot and gives us the latency trace; README notes "the first load can take up to a minute" (organiser guide, B-sponsors §0).

### PB-04 Rule-pack error (wrong fee, wrong rule, stale source)
**Symptoms:** A-16 (≥ 3 "this looks wrong" reports on one rule in 24 h), A-15 (stale or source changed), a judge or user points at a wrong number.
**First 5 minutes**
1. Identify the rule ID (every rule chip shows it) and the tenant.
2. **Hide, don't guess:** in the rule-pack studio (F-42) mark the row `confidence: low` + `display: verify_at_rto`. The plan card then shows "verify at your RTO" for that line instead of a number (war-room §3.3: "we don't know for your RTO yet" is a valid answer).
3. If a whole pack version is bad: set the tenant's `rulepack_version` back to the previous signed version (data change, no deploy).
**Fix:** correct the row with a primary source and `verified_on` = today; maker-checker approval; the golden tests run in CI on the new pack; `rulepack_reevaluate` re-plans open cases and notifies affected users (EC-27).
**Fee sanity:** one class = ₹700 (LL ₹150 + LL test ₹50 + DL test ₹300 + DL ₹200) + ₹200 smart card; a second class adds about ₹450 (CMVR r.32). The golden suite asserts this; if production disagrees, production is wrong.
**Close:** add the case to `tests/golden/rules/`; publish the change in the public rules changelog.

### PB-05 Kerala HPT stayed or postponed (EC-28)
**Context:** Kerala announced a hazard-perception test from 1 December 2026 (10 clips × 10 marks, pass 60; onmanorama 14 Sep 2026). No stay was found as of 23 Oct 2026 (war-room G13). This is R-10.
**Trigger:** A-20, news, or the demo-morning check (D-25: "recheck on demo morning").
**Steps**
1. Verify from two sources (Kerala MVD / a court order report on Bar & Bench or LiveLaw). Record the URL and time.
2. Set flag `nazar_hpt_format=practice_only`. Copy switches from "Kerala's announced format" to "practice in the format Kerala announced (status: <stayed/postponed> on <date>)". Scoring is unchanged; Nazar stays a hazard-anticipation trainer.
3. Update the pitch line (Product lead): the why-now becomes "the skill India never tests"; never claim the test is live.
4. Update the rule pack row for KL (`hpt_required`, `effective_from`) with the source and `verified_on`.
**Never:** delete the feature or invent a new date.

### PB-06 Data breach / security incident (DPDP + CERT-In 6 hours)
**Trigger:** A-17, a researcher report (SECURITY.md), a leaked key in gitleaks, unexpected data in logs, a lost laptop with database access.
**Clock starts when we notice.** CERT-In Directions (28 Apr 2022) require reporting specified incidents **within 6 hours** of noticing them (war-room G6; SECONDARY sources). The DPDP Act 2023 and Rules 2025 require intimating the Data Protection Board and affected data principals; the Rules' text on timing (intimation without delay and a detailed report within 72 hours) must be checked against the gazette [SECONDARY/unverified; owner Nestiq legal; before the first real-user pilot]. Most DPDP fiduciary duties apply from about 13 May 2027 (war-room G7, CARRIED); we follow them now anyway.

| Time | Action | Owner |
|---|---|---|
| T+0 | Declare SEV-1 in md-oncall; incident commander = Ops lead; start a timeline doc | first responder |
| T+15 min | **Contain:** rotate the exposed secret (Render env / n8n Variables / GitHub), revoke sessions (`SESSION_SIGNING_KEY` rotation), disable the affected route via flag or WAF, suspend the n8n workflow if it's the leak path | Ops lead |
| T+30 min | **Preserve evidence:** export logs for the window (Render/Grafana/Loki), n8n executions, Sentry events, audit log (E-30); snapshot the DB; don't wipe anything | Backend lead |
| T+1 h | **Scope:** which data classes (E-14 contacts? E-16 game sessions? field-study rows?), how many principals, which tenant, real or synthetic | Backend lead + Product lead |
| **≤ T+6 h** | **CERT-In report** if it's a reportable incident type: submit via the CERT-In incident reporting channel (email `incident@cert-in.org.in` / the online form [unverified contact; owner Ops lead; confirm on cert-in.org.in before launch]) with the prescribed details; for a state tenant, the **state's CISO** reports and we support (the state is the fiduciary, we are the processor) | Ops lead / state CISO |
| T+24 h → 72 h | **DPDP:** notify the Data Protection Board and affected principals in the prescribed form (nature, extent, timing, likely impact, mitigation, contact); for a state tenant the state does this and we supply facts within the processor contract SLA | Nestiq grievance officer / state |
| After | Root cause, fix, regression test, post-incident review within 5 working days; update THREAT_MODEL.md | all |

**Hackathon note:** the hackathon holds synthetic data plus consented pseudonymous field-study rows. A leak of synthetic data is still a SEV-1 drill: rotate, scope, write it up. If field-study rows leaked, tell the participants (we hold only the pseudonymous code and the contact they gave voluntarily for results, if any).
**Never:** pay a ransom, contact the attacker, or announce on social media before the incident commander approves the wording. Never say "no data was affected" before scoping is done.

### PB-07 API errors, latency, DB or log-shipping trouble
**First 5 minutes:** Sentry → top new error since the last deploy marker. If it started with a deploy → **roll back** (CICD §6). If DB: Render Postgres metrics (connections, CPU, storage). Connection exhaustion → lower `WEB_CONCURRENCY` or pool size, restart the API; slow query → `pg_stat_statements` top 5, add the missing index in an expand migration.
- Storage full on `0.1c-256mb`: upgrade the plan (one click), then prune `game_events` older than the retention.
- **Production log shipping gap (A-19)** is a compliance issue (CERT-In 180-day retention): treat it as SEV-2, buffer in the Collector (persistent queue), fix Loki, backfill from the Collector's file buffer.
- **NTP drift (A-18):** restart chrony on the node, cordon the node if it persists.

### PB-08 Render Workflows failures / case-clock sweep missed
**Symptoms:** A-10 (no completed sweep by 08:30 IST), A-11 (failures after retries, queued > 10 min).
**First 5 minutes**
1. Render dashboard → Workflows → Runs: failed task, attempt count, error. Remember: runs over the compute limits are **queued, not rejected**; Hobby allows 50 root runs/min (B-sponsors §1).
2. Re-run safely: `POST /internal/clock/sweep` with the same `run_date` (idempotent: `TimelineEvent` keys and the outbox dedupe), or `render workflows tasks start case_clock_sweep --input='["2026-10-24"]'`.
3. If Workflows itself is unavailable: set `JOB_RUNNER=inline` on the API (env change, restart) and trigger the sweep; it runs in-process in shards. Clip ingest waits (it's not user-facing).
**Demo note:** the injected retry on `blur_faces_plates` (`FAULT_INJECTION_CLIP_BLUR=once`) is expected; it should show attempt 2 succeeding. Reset to `off` after the demo.

### PB-09 n8n down or execution budget exhausted
**Symptoms:** A-13 heartbeat missing, A-12 budget > 85 %.
- **Down:** nothing the user sees changes except message delay (D-16). The backend outbox holds messages. Set `whatsapp_outbound=off` to route through email + web push from the backend; reminders still show in-app. For the 06:30 sweep, trigger API-65 from the ops script (`scripts/ops/sweep.sh`).
- **Budget:** pause W12's schedule (biggest consumer if misconfigured, 08 §6) and switch it to webhook-only alerts; check for a loop (a workflow re-triggering itself); batch more per run.
- **Approvals stuck** (W08/W09 Wait nodes): the backend keeps pending tasks; when n8n recovers, Waits resume by time limit and re-notify. Moderation can be done directly in `/admin/intel` (the backend applies the decision and n8n's later resume is ignored by the idempotency key).

### PB-10 Score replay mismatch / cheating wave
**Symptoms:** A-14; the leaderboard (squad/personal only) shows impossible scores.
- The server score always overwrites the client's (API-35), so no fake score is stored. A mismatch means either a client/verifier version skew or a tampered client.
- Version skew (after a deploy): deploy order is verifier → API → web; if the web app is ahead, roll it back. Check `game_core_version` on sessions.
- Tampering: rate-limit by device session, flag sessions, exclude them from field-study stats; no public shaming, no bans for 19-year-olds testing limits; the Practice Record (F-28) only lists verified sessions.

### PB-11 Live Intel abuse, defamation or takedown notice
- Structured fields only, no free text, no names (D-14), so the attack surface is small. Abuse = coordinated fake "slots opened" reports, or a "setting"/agent offer (EC-24).
- **Immediate:** flag `live_intel_public=off` for the office (or globally); reports keep flowing into the queue.
- **Takedown notice** (court order or a government agency under the IT Rules 2021): the grievance officer acknowledges, removes the content within the required time [unverified exact timelines; owner Nestiq legal; before public launch] and logs it in the audit log.
- Corruption reports are never hosted: deep-link to the state ACB/vigilance and CPGRAMS (war-room §1 row 6).

### PB-12 Sarathi outage or broken hand-off link (EC-11)
- We don't run Sarathi; we only hand off (F-07 Mode A). Check `sarathi.parivahan.gov.in` reachability from two networks.
- Show the **status banner** ("Sarathi seems unavailable; your Margdarshak draft is saved") via flag `banner_sarathi_down=on`; drafts auto-save (F-05); the case clock adds a "try again" reminder.
- Broken deep link / changed form: switch the hand-off to the copy-pack only (no prefilled URL) for that state; open a rule-pack row change for the new URL with source and date.
- **Never** scrape Sarathi or automate its forms (D-08, IT Act s.43).

### PB-13 A minor reached an AI feature (D-13)
**This must be impossible; treat any occurrence as SEV-1.**
1. Set `ai_debrief=off`, `ai_voice_guide=off`, `ai_screen_decoder=off` globally until fixed (template cards for everyone).
2. Find the path: which endpoint, which age band, why the server-side gate didn't stop it (the gate reads verified DOB ≥ 18 on the server, never a client flag).
3. Delete the related AI traces and stored outputs for that user; record the deletion in the audit log.
4. Add a regression test to `tests/ai/age_gate`; `evals.yml` offline job must fail without the fix.
5. Assess notification duties with Nestiq legal (children's data under DPDP s.9; Gemini API terms are 18+, war-room G8).

## 4. Communication templates
- **Status line (users, in-app banner):** "Some features are slow right now. Your saved progress is safe. Reminders may arrive late." (No blame, no jargon, no promise of a time.)
- **Judges (if live demo degrades):** "We're seeing slow responses from our hosting. Here is the same flow recorded an hour ago, and here is our runbook entry for exactly this." (A runbook is itself evidence of Technical Execution.)
- **State nodal officer:** incident summary within 1 h of SEV-1/2: what, who's affected, what we've done, next update time.

## 5. Backup and restore procedures
| Task | Hackathon command / steps | Production |
|---|---|---|
| Take an ad-hoc backup | `pg_dump --format=custom --no-owner "$DATABASE_URL" > md-$(date -u +%Y%m%dT%H%MZ).dump` (from the Render shell or a laptop with the external URL temporarily allow-listed) → upload to R2 `margdarshak-backups` | CloudNativePG `Backup` CR or CSP snapshot |
| Restore into staging | create an empty Postgres → `pg_restore --clean --if-exists --no-owner -d "$STAGING_DATABASE_URL" md-….dump` → `alembic upgrade head` → smoke tests | PITR to a timestamp into a new cluster, then switch the app secret |
| Verify | row counts per table vs the source; `GET /v1/health?deep=true`; open 3 seeded cases; replay 3 golden sessions | the same + checksum report |
| Drill cadence | once before judging | monthly restore, quarterly DR |

## 6. Disaster recovery (RPO / RTO)
Targets and scenarios are in INFRASTRUCTURE.md §7. Summary: hackathon RPO ≤ 24 h (nightly dump; the data is synthetic), RTO ≤ 60 min best effort, with the recorded demo as the real fallback. Production RPO ≤ 15 min, RTO ≤ 4 h for a data-centre loss (restore into a second Indian region).

## 7. Routine operations
| When | Task |
|---|---|
| Daily 08:30 IST | check D1, D4 (sweep done?), D5 (executions, pending approvals), D3 (fallback, spend) |
| Daily 19:30 IST | W04 receipts; failed WhatsApp count |
| Weekly | W15 rule-source changes triaged; security.yml findings triaged; restore test (production) |
| Before every demo | §8 checklist |

## 8. Demo-day emergency plan (judging, HackCache '26)
### 8.1 T-24 h to T-0
| When | Check | Owner |
|---|---|---|
| T-24 h | Staging rehearsal of the full demo script (PITCH.md) on 4G with the low-end phone; restore drill done; **record the fallback video** (≤ 5 min, the same script; also the submission video) | whole team |
| T-12 h | Kerala HPT status recheck (PB-05); trademark/rules items from D-25 noted | Product lead |
| T-3 h | Deploy freeze begins at T-60 min; last deploy must be green on smoke | Ops lead |
| T-60 min | **Freeze.** Gemini paid-tier quota headroom checked; WhatsApp token valid (send a test template to the demo phone); n8n W01/W04/W08/W09 active; Workflows Runs page open in a tab | Ops lead, AI lead |
| T-30 min | `scripts/ops/warmup.sh`; `/v1/health` all ok; D1 on a laptop; `FAULT_INJECTION_CLIP_BLUR=once` set **only if** the clip retry beat is in the script | Ops lead |
| T-10 min | Phones charged, hotspot on (two carriers: Jio + Airtel), screen mirroring tested, the QR (closing CTA: "take the 3-minute test") printed and on the slide | Presenter |
| T-0 | Demo; one person watches D1 and the Telegram channel silently | Ops lead |

### 8.2 If something fails on stage
| Failure | Do this (no debugging on stage) |
|---|---|
| Venue Wi-Fi dies | switch the laptop to the phone hotspot (second carrier as backup) |
| Live site slow > 60 s / down | play the **recorded video** from the same point; say the runbook line (§4) |
| Gemini fails during the debrief | let it happen: the template card appears instantly ("Auto notes"). Say: "the AI is optional; the facts come from code". This is the guardrail story (D-09) |
| Voice guide fails | voice is not on the critical demo path (war-room risk 5); skip to the next beat, show the pre-recorded clip |
| WhatsApp message doesn't arrive | show the n8n execution and the in-app reminder; say that Meta test numbers reach only allow-listed phones |
| Workflows run doesn't show a retry | show a previous run's retry on the Runs page (keep a tab with yesterday's run) |
| A judge finds a wrong rule | thank them, open the rule chip (source + verified date), flag it live in the studio (PB-04): this shows the trust mechanism working |
| Laptop dies | second laptop with the deck (PDF) and the video locally; the live URL on any phone |

### 8.3 Offline kit (on two laptops and one USB stick)
- Deck PDF; the ≤ 5-min video (MP4, 1080p); a 60-s cut of the Nazar beat; screenshots of the Render Runs page with a retry, the n8n canvas, the `adk eval` output and the validator rejecting "₹0 fee" (08 §5.9).
- The QR code image and the live URL in large type.
- This runbook as PDF.
