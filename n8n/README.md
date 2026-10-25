# n8n: Margdarshak's internal operations layer (schedules, staff approvals, staff notifications)
> Project: Margdarshak · Owner: Ops lead · Status: Draft v0.2 · Last updated: 2026-10-24
> Related: [N8N_WORKFLOWS](../docs/05-ops/N8N_WORKFLOWS.md) (full spec) · [ADR-0006](../docs/03-engineering/adr/ADR-0006-n8n-edge-only.md) · [RUNBOOK](../docs/05-ops/RUNBOOK.md) · [COST](../docs/05-ops/COST.md) · [render.yaml](../infra/render.yaml)

**Rule (D-16, ADR-0006):** n8n fires schedules, waits for human decisions and notifies **staff** (team, school staff, RTO/state staff). **It never decides anything, and it never messages citizens.** Citizen messages are queued and sent by the backend notifier. Who is due, which date, which rule, which threshold, and whether a report is risky are all answered by the backend over signed HTTP. If n8n is down, a staff task is late; no citizen message is delayed and no fact changes.

**Why this scales:** n8n's executions grow with staff, offices and review tasks, not with citizens. At 1k or 10M users it runs about the same number of times (N8N_WORKFLOWS §0.1).

The team has **n8n Pro (cloud)** through the HackCache all-team perk ("n8n pro membership worth $60", `research/B-sponsors.md` §0). Pro gives about 10,000 executions a month, Global Variables, 25K saved executions and 30-day logs (B-sponsors §3, from https://n8n.io/pricing/). Recheck on the pricing page at H0.

## Folder
```
n8n/
├── README.md
└── workflows/
    ├── P01-demo-sweep.json                 Manual + 08:00 IST demo sweep → API-65
    ├── W01-case-clock-tick.json            Schedule 06:30 IST → API-65 → Render Workflows sweep → watchdog (the backend notifier delivers)
    ├── W08-clip-review-queue.json          Webhook from Workflows → rater 1 → rater 2 (our page resumes the Wait node) → finalize
    ├── W09-live-intel-moderation.json      Webhook for reports the backend flags → moderator WhatsApp approve/reject → API-68
    ├── W14-field-test-capture.json         Webhook for consented field-study session-end summaries
    └── W15-sarathi-outage-watchdog.json    Every 5m + 1-click judge webhook (`/webhook/sarathi-watchdog`) → probes `sarathi.parivahan.gov.in` / simulates HTTP 503 outage for EC-11 offline prep fallback
```
W07 and W12–W18 are specified in N8N_WORKFLOWS.md and exported here as they are built. W02–W06, W10 and W11 were citizen-facing and moved to the backend (N8N_WORKFLOWS §0.2); their numbers are not reused.

## Import (n8n Cloud)
1. **Variables** (Settings → Variables; Pro feature). Create:

   | Variable | Example | Used by |
   |---|---|---|
   | `MD_API_BASE` | `https://margdarshak-api.onrender.com` | all |
   | `MD_HMAC_SECRET` | 32+ random bytes, same as the API's `N8N_HMAC_SECRET` | all (signing / verifying) |
   | `MD_N8N_READ_TOKEN` | bearer token, scope `n8n` | all calls to `/internal/*` and API-55 |
   | `MD_WA_PHONE_NUMBER_ID` | Meta id of the **staff** test number (not the citizen number the backend uses) | W07, W09, W17 |
   | `MD_MODERATOR_WA` | the moderator's opted-in number (team member) | W09 |
   | `MD_CURATOR_TELEGRAM_CHAT` | curators' group chat id | W08 |
   | `MD_CONSOLE_BASE` | `https://margdarshak-web.onrender.com` | W08 |

   Variables are readable by anyone who can edit workflows in the workspace. Keep the editor list to the two ops owners and rotate `MD_HMAC_SECRET` after the event.
2. **Credentials** (vault): `WhatsApp API` (Meta access token for the staff test number), `Gmail OAuth2` (staff notifications mailbox), `Telegram API` (curators' bot), and two `Header Auth` credentials: *MD inbound webhook token* (header `X-MD-Webhook-Token`) and *MD resume token* (header `X-MD-Resume-Token`).
3. **Import** each JSON (Workflows → Import from file). Every credential reference is `REPLACE_ON_IMPORT`; re-select it in each node. Replace `REPLACE_WITH_W12_WORKFLOW_ID` in Settings → Error workflow with the id of W12.
4. **Check node parameters against your n8n version.** The JSON targets current node versions (Schedule 1.2, HTTP Request 4.2, IF 2.2, Switch 3.2, Wait 1.1, Webhook 2, Code 2, WhatsApp 1). WhatsApp template components and send-and-wait options are the fields most likely to differ; open each WhatsApp node once after import and re-save it. [unverified against the live n8n Cloud version; owner Ops lead; H0 on 2026-10-24]
5. **Test with pinned data**, then activate. Executions with success are not saved (`saveDataSuccessExecution: none`) on the staff-messaging workflows; W08 and W09 keep them for audit (no phone numbers flow through W08; W09 holds only the moderator's number from Variables).

## Security pattern (all workflows)
- **Outbound (n8n → backend):** `Authorization: Bearer <MD_N8N_READ_TOKEN>` + `Margdarshak-Signature: t=<unix>,v1=<hex HMAC-SHA256(MD_HMAC_SECRET, t + "." + body)>` (a GET signs the empty body: `t + "."`) + `Idempotency-Key` on writes. The backend rejects a skew over 300 s and replays; its replay cache is keyed on method + path + signature, so sign every attempt again with a fresh `t`.
- **Inbound (backend/Workflows → n8n):** Header Auth credential **plus** a signed envelope `{ ts, payload: "<JSON string>", sig }`, verified in-workflow with the Crypto node before any work. The envelope avoids raw-body handling in n8n.
- **Resume (our page → n8n Wait node):** the browser never sees `$execution.resumeUrl`. The backend stores it on the task row and POSTs to it with the `X-MD-Resume-Token` header after the human acts in our UI.
- **Data:** no citizen personal data at all (no citizen phone, email, name, DOB, Aadhaar data, case facts or free text). n8n sees IDs, k-anonymous aggregates and staff work contacts only. SMS is not wired until TRAI DLT registration (D-16).

## Approval patterns that work (and the one we avoid)
| Pattern | Use it for | Status |
|---|---|---|
| WhatsApp **Send and Wait for Response** (approve / reject buttons) | moderator decisions (W09), school accept/decline (W07), RTO acknowledgement (W17) | Works per n8n docs; test on our version first |
| **Our page → backend → Wait-node resume webhook** | anything that needs a rich UI: clip windows (W08), rule re-verification (W15), W09/W17 fallback | Our recommended default |
| Telegram / Gmail send-and-wait | — | **Avoid** for approvals: reports of non-resuming executions ([n8n #13331](https://github.com/n8n-io/n8n/issues/13331)). Telegram is used for notifications only |

## Execution budget (Pro ≈ 10k/month)
Batch per run, never one execution per citizen. ≈ 3,500–4,000/month at hackathon scale and roughly flat as users grow; see N8N_WORKFLOWS.md §4 and COST.md §5.
