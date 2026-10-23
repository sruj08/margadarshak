# ADR-0006: n8n as the messaging and scheduling edge only
> Project: Margdarshak · Owner: Platform lead · Status: Accepted · Date: 2026-10-23
> Related: [Architecture §9](../ARCHITECTURE.md) · [Integrations §3.2–3.3](../INTEGRATIONS.md) · [API spec §1.10, §3.10](../API_SPEC.md) · ADR-0005

## Context and problem statement
Every team has n8n Pro (sponsor perk). n8n is excellent at schedules, channel routing, WhatsApp "send and wait" approvals and editable copy. It is a poor place for rules: logic on a SaaS canvas is hard to test, version, audit or hand to NIC, and the adoption story must not depend on it (verification §2.1: "No business logic in n8n"). D-16 makes this a directive.

## Decision drivers
- D-16: messaging edge + schedules only; SMS only after TRAI DLT.
- Workflows has no cron (ADR-0005) — something must trigger schedules.
- Two-rater clip review needs a multi-day human wait.
- n8n Pro budget ≈ 10k executions/month.

## Considered options
1. **n8n owns schedules, WhatsApp/email delivery, inbound replies and human approvals; it calls only `/internal/*` endpoints that return what to send, and never queries Postgres directly.**
2. n8n reads Postgres and implements reminder logic (common n8n pattern).
3. No n8n; all messaging and schedules in code.

## Decision outcome
Chosen option: **1**, because it uses n8n where it is strongest (time, routing, humans) while every fact the user sees comes from tested code. If n8n fails, messages are delayed, never wrong.

### Consequences
- Internal API surface for n8n (service bearer + HMAC): API-65 clock sweep, API-66 receipts/replies/STOP, API-67 start job (e.g. `clip_finalize`), API-68 intel precheck/decision, API-69 fire slot watcher, API-72 dispatch letter, API-73 next school lead.
- Outbound: signed webhooks from our transactional outbox (`notify-batch`, `milestone`, `clip-review`, `intel-moderation`, …), at-least-once with idempotency keys `{timelineEventKey}:{channel}`.
- PII in n8n limited to phone + first name of users who opted in to that channel; execution-data retention minimal; credentials only in the n8n vault.
- Execution budget: batch per run (one sweep run fans out inside our Workflows run), alerts every 15 min not 5 (`08` §6).
- Bad: one more SaaS hop; mitigated by the outbox, in-app inbox and web push not depending on n8n.
- Follow-up: n8n Sustainable Use License review for government self-hosting, or a small notifier service replacement (owner Platform lead, before any MoU).

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Hosting | n8n Cloud Pro | self-hosted n8n (licence check) or `notifier` service |
| Channels | WhatsApp test number, email, web push | + business number, mGov SMS with DLT |

## Pros and cons of the options
### Option 1
- Good: testable logic; replaceable edge; canvas screenshot for the deck; send-and-wait approvals.
- Bad: more internal endpoints to secure.
### Option 2
- Good: fastest to wire.
- Bad: logic untestable and unauditable; DB credentials in a SaaS; breaks the adoption story.
### Option 3
- Good: fewer systems.
- Bad: we would build approval UIs, retries and channel routing ourselves in 48 h; loses the sponsor perk.

## Validation
A CI check fails if any exported workflow JSON contains a Postgres node or credentials; an n8n-down drill shows the in-app timeline unchanged.

## Links
- `research/ps1-deep/08-game-ai-n8n.md` §6 (W1–W15, execution budget)
- `research/B-sponsors.md` §3; https://docs.n8n.io/advanced-ai/human-in-the-loop-tools
