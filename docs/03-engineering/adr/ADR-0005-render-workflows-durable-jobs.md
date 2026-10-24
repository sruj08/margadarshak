# ADR-0005: Render Workflows (TypeScript SDK) for durable jobs, behind the Go `JobRunner` port
> Project: Margdarshak · Owner: Platform lead · Status: Accepted (amended 2026-10-23 for ADR-0011: tasks in TypeScript, API in Go) · Date: 2026-10-23
> Related: [Architecture §8, §10.3, §10.6](../ARCHITECTURE.md) · [Backend §7–§8](../BACKEND.md) · [Integrations §3.1](../INTEGRATIONS.md) · ADR-0006 · [ADR-0011](ADR-0011-go-backend.md)

> **Amendment (23 Oct 2026, ADR-0011):** the backend is Go and there is no Python in the repository. The Workflows tasks are written with the **TypeScript SDK** `@renderinc/sdk` 1.4.0 in `services/workflows`. They are thin orchestrators: business steps run in the Go API through HMAC-signed calls to `/internal/job-steps/{step}`, and media steps (ffmpeg, blur, flash check) run in the task. The Go API starts runs over Render REST (`POST /v1/task-runs` with `idempotencyKey`).

## Context and problem statement
Several jobs outlive a request, fail often, fan out, or wait for humans: the Nazar clip pipeline (transcode → blur → AI window proposals → two raters → agreement → publish), the case-clock sweep (LL day 25/30, expiry T-30/T-7, test eve, retest, approval chase), debrief retries on Gemini 429, nightly field statistics, rule-pack re-evaluation (EC-27), export/erasure. The bonus track is "best use of Render Workflows", judged on effective use (B-sponsors §0). The Anurag Goel seat warned: "If your debrief is one synchronous Gemini call wrapped in a task, that's decorative" (verification §2.1).

Render Workflows facts (B-sponsors §1): public beta (7 Apr 2026); per-run instances; `ctx.run()` chaining; `Promise.all` fan-out (TS SDK); automatic retries with backoff; 30 s–24 h timeouts; queued over limits; **no cron, no documented sleep, no completion webhook**; no India region.

## Decision drivers
- Load-bearing use of the sponsor tech (D-15): clip pipeline as the headline with a visible retry.
- Idempotent, retry-safe jobs.
- Portability to NIC/MeitY clouds (D-17).

## Considered options
1. **Render Workflows (TypeScript SDK `@renderinc/sdk` 1.4.0) behind the Go `JobRunner` port; Temporal (Go SDK) for production; inline Go runner for dev/CI.**
2. A queue + worker pool (e.g. a Redis-backed Go job queue) on Render.
3. Render cron jobs + a single background worker.
4. Temporal everywhere, including the hackathon.

## Decision outcome
Chosen option: **1**, because Workflows gives retries, fan-out and per-run isolation without running a queue, scores on the sponsor track, and the port keeps the code portable (Temporal adds the durable timers that Workflows lacks).

### Consequences
- Good: `clip_ingest` shows a real failure-and-retry on the Runs page; `case_clock_sweep` fans out `clock_batch` (TS `Promise.all` of `ctx.run`), and each batch calls the Go step `clock.fire_batch`, which uses `FOR UPDATE SKIP LOCKED` and idempotent keys. There is no business logic in tasks: every decision and DB write is in the Go API, and the workflows service has no `DATABASE_URL`.
- Design forced by the missing features:
  - **No cron** → n8n W1 Schedule → API-65 → JobRunnerPort (the API sets `asOf` from server time).
  - **No sleep, 24 h cap** → the clip pipeline is split: `clip_ingest` run → **two-rater wait in n8n W08** → n8n calls API-67 → `clip_finalize` run.
  - **No completion webhook** → the Go API polls `GET /v1/task-runs/{id}` into `ops.job_runs`.
- Bad: beta SDK ("early access, subject to breaking changes"); plan names differ between the TS SDK README (`starter/standard/pro`) and the renamed compute IDs in the Blueprint spec → verify at H0 (owner Backend lead, 2026-10-24).
- Bad: Singapore only → synthetic data only in the hackathon.

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Runner | `jobs/renderworkflows` (Go REST client) + TS tasks (+ `jobs/inline` degraded mode, same Go step handlers) | `jobs/temporal` (Temporal Go SDK `go.temporal.io/sdk` v1.50.0; Go workflows, step handlers as activities) on Kubernetes |
| Human waits | n8n W08 between runs | Temporal signals inside one workflow |
| Schedules | n8n Schedule triggers | Temporal schedules or n8n/notifier |

## Pros and cons of the options
### Option 1
- Good: sponsor fit, zero queue ops, retries and fan-out built in, portable via the port.
- Bad: beta; missing cron/sleep/webhook (designed around).
### Option 2 — queue + workers
- Good: mature.
- Bad: we run Redis + workers + beat; no durable timers; not a sponsor showcase.
### Option 3 — cron + worker
- Good: simple.
- Bad: no fan-out/retry semantics; cron is $1/month minimum per service and UTC-scheduled.
### Option 4 — Temporal now
- Good: best durability.
- Bad: a server cluster to run in 48 h; no sponsor credit.

## Validation
Demo: inject one Gemini 429 in `propose_windows` and show the retry; CI: the Go step handlers run under the inline runner with the same tests, and the TS tasks are tested with Vitest against a mocked SDK; idempotency tests (duplicate sweep triggers send each message once).

## Links
- https://render.com/docs/workflows · https://render.com/docs/workflows-limits · https://render.com/changelog/render-workflows-now-in-public-beta
- npm `@renderinc/sdk` 1.4.0 (README: `task`, `ctx.run`, `startTask`; REST `POST /v1/task-runs`); proxy.golang.org `go.temporal.io/sdk` v1.50.0 (2026-10-15)
