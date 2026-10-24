# ADR-0011: Go 1.27 backend (chi, oapi-codegen, pgx + sqlc, goose, ADK for Go); TypeScript for everything else
> Project: Margdarshak · Owner: Backend lead · Status: Accepted · Date: 2026-10-23 · **Supersedes [ADR-0002](ADR-0002-python-fastapi-adk-backend.md)**
> Related: [Build Conventions §1](../../08-project/BUILD_CONVENTIONS.md) · [PROJECT_BRIEF §8, §15](../../00-overview/PROJECT_BRIEF.md) · [Backend](../BACKEND.md) · [Architecture](../ARCHITECTURE.md) · [Tech stack](../TECH_STACK.md) · ADR-0001 · ADR-0004 · ADR-0005 · ADR-0009

## Context and problem statement
ADR-0002 chose one Python backend for three reasons:
- ADK live voice (`run_live`) was believed to be Python/Java only.
- Render Workflows had a Python SDK.
- The team knew FastAPI.

Three facts have changed (checked on 23 Oct 2026):
1. **ADK for Go now ships live mode.** `google.golang.org/adk` v1.9.0 (proxy.golang.org, 2026-10-15) exposes `(*runner.Runner).RunLive(ctx, userID, sessionID, agent.LiveRunConfig) (agent.LiveSession, iter.Seq2[*session.Event, error], error)`. `LiveSession.Send` accepts realtime audio blobs. The module ships a bidi example (`examples/bidi`). The Go Gemini SDK `google.golang.org/genai` v1.76.0 (2026-10-22) has the Live API (`client.Live.Connect`). The F-30 voice guide therefore no longer forces Python.
2. **Render Workflows has an official TypeScript SDK.** `@renderinc/sdk` 1.4.0 provides `task()`, `ctx.run()` and `Promise.all` fan-out. Runs are started over a plain REST API (`POST /v1/task-runs` with `task`, `input`, `idempotencyKey`). So a Go API can start runs without an SDK, and the task code lives next to the rest of our TypeScript.
3. **The team decided on one backend language that is fast to deploy and easy to review**, with **no Python anywhere**:
   - one static binary;
   - low memory on small Render plans;
   - goroutines for the WS voice bridge and fan-out;
   - generated, type-checked HTTP and SQL layers.

   TypeScript remains for everything else: the web app and console (Next.js 16), `packages/*`, the score verifier (same `game-core` as the browser, ADR-0004) and the Workflows tasks.

## Decision drivers
- Live voice (F-30) must stay possible, alongside Gemini structured output for M-02..M-05.
- Contract-first API: handlers generated from `api/openapi.yaml`, so the spec cannot drift.
- Deterministic, auditable rules engine (D-05) with golden tests shared with a TS mirror.
- Small, secure containers for Render now and for MeitY/NIC clouds later (D-17): distroless, non-root, no interpreter.
- Tests without Docker: the build machines have no Docker (BUILD_CONVENTIONS §2).
- No Python anywhere in the repo, scripts included.

## Considered options
1. **Go 1.27**, with:
   - chi v5.5.0;
   - oapi-codegen v2.8.0 (`chi-server` + `strict-server` + `models`);
   - pgx v5.11.0 + sqlc v1.31.1;
   - goose v3.29.0;
   - embedded-postgres v1.34.0 for tests;
   - `log/slog` with PII redaction;
   - OpenTelemetry Go v1.47.0;
   - ADK for Go v1.9.x + genai v1.76.x.

   Workflows tasks in TypeScript (`@renderinc/sdk` 1.4.0).
2. Keep Python (ADR-0002): FastAPI + ADK Python + SQLAlchemy + Alembic + Render Workflows Python SDK.
3. TypeScript backend (Node) with ADK JS / Mastra: one language across the whole repo.

## Decision outcome
Chosen option: **1 (Go)**. ADK for Go now covers live voice, and Go gives the smallest and most reviewable backend. The Workflows TS SDK keeps durable jobs on the sponsor track without a second backend language for business logic. All decisions and all database writes stay in Go. The TS tasks only orchestrate steps and do media work, and they call the Go API for every business step (`/internal/job-steps/{step}`, BACKEND §8.1).

### What changes
| Concern | Before (ADR-0002) | Now (ADR-0011) |
|---|---|---|
| HTTP | FastAPI + Pydantic | chi v5 + oapi-codegen strict server; RFC 9457 problem+json |
| Validation | Pydantic `extra="forbid"` | generated types + `DisallowUnknownFields` + explicit `Validate()` caps + a reflection test for forbidden fields (D-07) |
| DB access | SQLAlchemy 2 (async) | pgx v5 (pgxpool) + sqlc-generated queries; UnitOfWork with `SET LOCAL app.tenant_id` (ADR-0009) |
| Migrations | Alembic | goose v3 SQL files, embedded; `api migrate up\|down\|status` |
| Tests | pytest + Postgres container | `go test` + testify + embedded-postgres (real Postgres 16, no Docker); golden JSON shared with the TS mirror |
| Logging | structlog | `log/slog` JSON + redacting handler (`internal/privacy`) |
| AI | ADK Python 2.x, `run_live` | ADK for Go v1.9.x (`llmagent`, `runner.Run`, `runner.RunLive`, `functiontool`, `plugin`), genai v1.76.x Live API |
| AI evals | `adk eval` | Go eval harness: `go test -tags evals` over `ai/evals/*.jsonl` (ADK Go has no eval CLI) |
| Durable jobs | Workflows Python SDK; tasks imported the app | Workflows **TS** SDK tasks → Go step endpoints; the Go `JobRunner` starts runs over Render REST |
| Lint | ruff + mypy + import-linter | gofmt, go vet, golangci-lint v2.15.0 (depguard layers), govulncheck |
| Image | python-slim + uv (~300 MB) | distroless static, non-root (~20–30 MB) |

### Consequences
**Good:**
- One binary with fast cold starts, so a smaller Render plan suffices (re-check with k6). The image has no interpreter, which shrinks the attack surface.
- Handlers and SQL are generated and type-checked. CI runs `go generate ./... && git diff --exit-code`.
- The tests run on any laptop without Docker.
- The goroutine-per-direction WS bridge maps directly onto `RunLive`'s iterator and `LiveSession.Send`.

**Bad:**
- **ADK for Go is younger than ADK Python.** It has no graph workflows and no `adk eval` / `adk web` for judges. Mitigations:
  - The debrief is a plain Go pipeline around one `Runner.Run` call (BACKEND §10).
  - Evals are our own `go test` harness.
- **Per-request `OutputSchema` enums and `gemini-3.8-live` support must be confirmed at H0.** Fallback: call `genai` directly behind the same `Narrator` port, and use the fallback live model.
- **Two runtimes in the backend** (Go API, Node tasks/verifier). Mitigation: the TS tasks hold no business logic and no DB access; they are tested with Vitest using a mocked SDK.
- **Workflows has no Go SDK.** The REST client is ours, about 150 lines in `internal/jobs/renderworkflows`. The public-beta API may change.

**Follow-ups:**

| Follow-up | Owner | Due |
|---|---|---|
| `/internal/job-steps/{step}` added to `api/openapi.yaml` as `x-proposed` | API owner | — |
| `AI_AGE_GATED` / `MINOR_LOCAL_ONLY` removed (D-13 revised) | API owner | — |
| ADK Go `RunLive` + `OutputSchema` checks | AI lead | 2026-10-24 |
| Render REST idempotency + private-network reachability from Workflows | Backend lead | 2026-10-24 |

### AI for everyone (D-13 revised, applied in this backend)
- Every AI feature is available to every user.
- A learner aged 16–17 uses the product in a parent's (adult) account in family mode. The account holder records verifiable parental consent for that case.
- The backend enforces **consent gates, not age gates**: 403 `PARENT_CONSENT_REQUIRED` (WS close 4403) when parental consent is missing for a minor family member's case.
- A minor's case has no analytics events, no behavioural tracking and no targeted ads.

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Hosting | Render web service (Docker, distroless Go image), Singapore | Kubernetes on NIC / MeitY-empanelled cloud (same image) |
| Jobs | Render Workflows (TS tasks) + inline Go runner | Temporal Go SDK (`go.temporal.io/sdk` v1.50.0) worker in the same binary [design only] |
| Models | Gemini API (paid tier before real users) | Vertex AI `asia-south1`, Bhashini where possible |

## Pros and cons of the options
### Option 1: Go
- Good: live voice via ADK Go; contract-first codegen; small secure images; Docker-free tests; strong typing across the HTTP and SQL layers.
- Bad: younger ADK; no `adk eval`; Workflows tasks must be TypeScript.
### Option 2: keep Python
- Good: the most mature ADK, with `adk eval` / `adk web`; the Workflows Python SDK.
- Bad: conflicts with the team decision (no Python); heavier images and more RAM; runtime type checks only; Alembic + async SQLAlchemy + RLS complexity.
### Option 3: TypeScript backend
- Good: one language everywhere; the Workflows TS SDK is native.
- Bad: ADK TS live mode was not confirmed for our needs (`04` §1.1); a heavier runtime for the voice bridge; the team prefers Go for the backend.

## Validation
- `go vet ./...`, `gofmt -l` (empty), golangci-lint and `go test ./...` are green in CI (CICD.md).
- The golden rules suite gives byte-equal outputs from Go and the TS mirror.
- p95 targets from ARCHITECTURE §13 are measured with k6.
- The Go eval harness gives ≥ 30 cases per agent, green (AI_EVALS.md).
- The architecture test plus depguard keep the pure packages framework-free.

## Links
- proxy.golang.org, checked 2026-10-23:

  | Module | Version | Released |
  |---|---|---|
  | `google.golang.org/adk` | v1.9.0 | 2026-10-15 |
  | `google.golang.org/genai` | v1.76.0 | 2026-10-22 |
  | `github.com/go-chi/chi/v5` | v5.5.0 | 2026-10-14 |
  | `github.com/oapi-codegen/oapi-codegen/v2` | v2.8.0 | 2026-07-17 |
  | `github.com/jackc/pgx/v5` | v5.11.0 | 2026-09-07 |
  | `github.com/sqlc-dev/sqlc` | v1.31.1 | 2026-04-22 |
  | `github.com/pressly/goose/v3` | v3.29.0 | 2026-10-11 |
  | `github.com/fergusstrange/embedded-postgres` | v1.34.0 | 2026-03-17 |
  | `go.opentelemetry.io/otel` | v1.47.0 | 2026-10-02 |
  | `github.com/golangci/golangci-lint/v2` | v2.15.0 | 2026-10-16 |
  | `go.temporal.io/sdk` | v1.50.0 | 2026-10-15 |

- npm `@renderinc/sdk` 1.4.0 (README: `task`, `ctx.run`, `render.workflows.startTask`; REST `POST /v1/task-runs`).
- Go releases: https://go.dev/dl/ (stable go1.27.3).
- `research/ps1-deep/04-ai-adk-gemini.md` §0.4, §1.1 (the original live-mode constraint, now obsolete for Go).
