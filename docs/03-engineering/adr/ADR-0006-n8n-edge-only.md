# ADR-0006: n8n for internal and staff operations only
> Project: Margdarshak · Owner: Platform lead · Status: Accepted (revised 2026-10-24) · Date: 2026-10-23
> Related: [Architecture §9](../ARCHITECTURE.md) · [N8N_WORKFLOWS](../../05-ops/N8N_WORKFLOWS.md) · [Integrations §3.2–3.3](../INTEGRATIONS.md) · [API spec §1.10, §3.10](../API_SPEC.md) · ADR-0005
> Revision 2026-10-24: citizen messaging moves out of n8n into the backend notifier. n8n keeps schedules, human approvals and staff notifications. Reason: scalability at national volume (below).

## Context and problem statement
Every team has n8n Pro (sponsor perk). n8n is excellent at schedules, routing, WhatsApp "send and wait" approvals and editable workflows that non-developers can read. It is a poor place for rules: logic on a canvas is hard to test, version, audit or hand to NIC, and the adoption story must not depend on it (verification §2.1: "No business logic in n8n"). D-16 makes this a directive.

The original version (2026-10-23) also routed **citizen** WhatsApp and email through n8n. That does not survive national scale:
- ARCHITECTURE §13 estimates ≤ 660k citizen notifications a day at peak, plus 2–3 inbound receipts or replies per message.
- n8n Cloud Pro allows about 10k executions a month. Self-hosted queue mode can scale out, but it processes items in memory and stores execution data. At that volume we would be running a visual tool on the busiest path, for a job that is "read the outbox, call the channel API, retry".
- A SaaS hop holding millions of citizen phone numbers is a weak point for DPDP and India-hosting requirements.

## Decision drivers
- D-16: no business logic in n8n; SMS only after TRAI DLT.
- Scale: anything that grows with the number of citizens must run in code that scales with the API.
- Workflows has no cron, no sleep and no completion webhook (ADR-0005), so something must trigger schedules and hold multi-day human waits.
- Staff work (curators, moderators, school staff, RTO/state staff, on-call) is low-volume, human-paced, and changes often.
- n8n Pro budget ≈ 10k executions/month.

## Considered options
1. **v1: n8n owns schedules, citizen and staff messaging, inbound replies and approvals**, calling only `/internal/*`.
2. **v2: n8n owns schedules, human approvals and staff notifications only. Citizen messages go out through the backend notifier (`NotificationPort`).**
3. No n8n; all schedules, approvals and messaging in code.

## Decision outcome
Chosen option: **2**. n8n's load grows with the number of staff, offices and review tasks, never with the number of citizens. The citizen path is ordinary backend code with contract tests. If n8n fails, a staff task is late; no citizen message is delayed and no fact changes.

### What runs where
| Concern | Runs in |
|---|---|
| Citizen reminders, milestones, slot alerts, coach plans, family cards, retest reminders, letters | backend: TimelineEvents → `case_clock_sweep` → outbox → notifier (WhatsApp Cloud API, email, web push) |
| Citizen receipts, replies, STOP (EC-30) | backend API-66 |
| Daily case-clock trigger + watchdog | n8n W01 (1 run/day) |
| Clip review, Live Intel moderation of flagged reports, school lead routing | n8n W08, W09, W07 |
| On-call alerts, team digest, rule-source checks, field study | n8n W12, W13, W15, W14 |
| RTO morning brief, stall/SLA alerts with acknowledgement, staff task reminders | n8n W16, W17, W18 (government mode) |

### Consequences
- Good: the citizen path scales horizontally with the API; n8n executions stay roughly flat from 1k to 10M users.
- Good: no citizen personal data in n8n; only staff work contacts and aggregates (k ≥ 5).
- Good: staff get a useful, editable operations layer, including RTO staff once a state adopts.
- Bad: we build the notifier (quiet hours, daily cap, retries, fallback, receipts) in code. Most of it was already in the backend (`NotificationPort`, outbox, `WebPushNotifier`); WhatsApp Cloud API is one more adapter.
- Bad: the demo can no longer say "the citizen's phone buzzes via n8n". It shows n8n on the clip-review and moderation queues instead.
- Internal API surface for n8n (service bearer + HMAC): API-65 clock sweep, API-66 staff receipts/acks, API-67 jobs, API-68 intel decision, API-73 school leads, console alert acks.
- Execution budget: ≈ 3,500–4,000/month at hackathon scale (N8N_WORKFLOWS §4).
- Follow-up: n8n Sustainable Use License review for government self-hosting, or replace with CronJobs/Temporal schedules plus backend review pages (owner Platform lead, before any MoU).

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| n8n hosting | n8n Cloud Pro | self-hosted n8n in the state cluster (licence check), or replaced |
| Citizen channels | backend notifier: WhatsApp test number, email, web push | + business number, mGov SMS with DLT |
| Staff channels | team Telegram, email, staff WhatsApp number | NIC email, the state's WhatsApp business account, console inbox |

## Pros and cons of the options
### Option 1 (v1)
- Good: fastest to wire; the citizen message is visible on the canvas for the deck.
- Bad: n8n becomes the bottleneck and a store of citizen phone numbers at scale.
### Option 2 (v2)
- Good: scales; keeps n8n where it is strongest (time, routing, humans); clean answer to "what happens at a million users".
- Bad: one more adapter to build in the backend.
### Option 3
- Good: fewer systems.
- Bad: we would build approval UIs, timers and staff routing ourselves in 48 h; loses the sponsor perk.

## Validation
- CI fails if any exported workflow JSON contains a Postgres node, credentials, or a citizen WhatsApp template.
- An n8n-down drill shows citizen notifications still delivered and the in-app timeline unchanged.
- A load test of the notifier at the ARCHITECTURE §13 peak rate shows n8n executions unchanged.

## Links
- `research/ps1-deep/08-game-ai-n8n.md` §6 (original W1–W15)
- `research/B-sponsors.md` §3; https://docs.n8n.io/advanced-ai/human-in-the-loop-tools
