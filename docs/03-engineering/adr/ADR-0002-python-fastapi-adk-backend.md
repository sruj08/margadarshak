# ADR-0002: Python 3.12 + FastAPI + Google ADK as the single backend
> Project: Margdarshak · Owner: Backend lead · Status: **Superseded by [ADR-0011](ADR-0011-go-backend.md)** (23 Oct 2026) · Date: 2026-10-23
> Related: [Architecture §2, §7](../ARCHITECTURE.md) · [Backend](../BACKEND.md) · [Tech stack §4, §6](../TECH_STACK.md) · ADR-0004 · ADR-0005

> **Superseded.** On 23 Oct 2026 the team switched the backend to **Go 1.27** (chi, oapi-codegen, pgx + sqlc, goose, ADK for Go with `RunLive`) and moved the Render Workflows tasks to the TypeScript SDK. See [ADR-0011](ADR-0011-go-backend.md). This record is kept unchanged below as history; nothing in it is current. There is no Python in the repository.

## Context and problem statement
The product needs: a rules engine and journey state machine, an AI layer with a **live voice guide** (F-30), debrief/coach/tutor/decoder agents (M-02..M-05), durable jobs on Render Workflows (sponsor track), Postgres, and an OpenAPI contract. The council ruled "one Python backend (FastAPI + ADK + Render Workflows Python SDK) and Postgres" to keep the demo stack robust (D-17, risk 5 in verification §4). ADK's live (voice) mode is Python or Java only and experimental (`04` §0.4).

## Decision drivers
- ADK `run_live` availability (Python/Java only).
- Render Workflows has Python and TypeScript SDKs (`render-sdk` 1.4.0 on PyPI).
- One codebase, one deploy, one owner who can explain it (D-24).
- Pydantic gives strict input validation (`extra="forbid"`) — the first wall against Aadhaar/OTP fields (D-07).

## Considered options
1. **Python 3.12 + FastAPI 0.161.1 + Pydantic 2.14 + SQLAlchemy 2.1 + google-adk 2.12.0.**
2. TypeScript (Node) backend with `@google/adk` 2.3.0 + Mastra.
3. Java/Spring + ADK Java 1.13.0.

## Decision outcome
Chosen option: **1**, because it is the only option that combines ADK live voice, the Workflows Python SDK and the team's FastAPI experience in one service, and it satisfies D-17.

### Consequences
- Good: agents, rules, jobs and API share domain code (`margdarshak.domain`); `adk eval` and `adk web` are available for the judges; FastAPI generates OpenAPI we diff against `api/openapi.yaml`.
- Bad: game scoring is TypeScript (browser), so a small Node score verifier is needed (ADR-0004) — the one exception to "one Python backend".
- Bad: ADK 2.x live mode is experimental; model naming is in flux → model IDs only in env vars, with a fallback live model.
- Follow-ups: verify `run_live` with `gemini-3.8-live` and `output_schema` with dynamic enums on 2.12 (owner AI lead, 2026-10-24).

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Hosting | Render web service (Docker), Singapore | Kubernetes on NIC / MeitY-empanelled cloud |
| Models | Gemini API (paid tier before real users) | Vertex AI `asia-south1`, Bhashini where possible |

## Pros and cons of the options
### Option 1
- Good: ADK live; Workflows Python SDK; strict validation; mature ORM/migrations.
- Bad: two runtimes overall (verifier in Node).
### Option 2
- Good: one language with the frontend and game-core.
- Bad: no ADK live voice in TypeScript (`04` §1.1); would drop or re-architect F-30.
### Option 3
- Good: ADK Java has live mode.
- Bad: team unfamiliar; slower to build in 48 h; heavier containers.

## Validation
p95 targets from ARCHITECTURE §13 measured with k6; `adk eval` ≥ 30 cases per agent green in CI; the import-linter contract keeps the domain framework-free.

## Links
- `research/ps1-deep/04-ai-adk-gemini.md` §0.4, §1.1, §2
- `research/B-sponsors.md` §1
- PyPI: https://pypi.org/project/google-adk/ (2.12.0, 2026-10-13), https://pypi.org/project/fastapi/ (0.161.1, 2026-10-22)
