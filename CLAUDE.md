# CLAUDE.md: instructions for AI coding agents working on Margdarshak

## Read first
1. `docs/00-overview/PROJECT_BRIEF.md`: the single source of truth for every ID and decision (F-, E-, API-, M-, EC-, R-, D-), including §15 "Resolved conflicts".
2. `docs/08-project/BUILD_CONVENTIONS.md`: binding build rules (Go backend per ADR-0011, AI for everyone per D-13 revised, ownership, quality gates).
3. `docs/README.md`: where everything is.
4. The ticket you were given, in `docs/08-project/BACKLOG.md` (MD-xxx).

## Repo layout
| Path | What |
|---|---|
| `apps/web` | Next.js 16 citizen PWA |
| `apps/console` | Next.js app for schools, the RTO/state console and the rule studio |
| `services/api` | Go 1.27 API (module `github.com/sruj08/margadarshak/services/api`): `cmd/api`, `cmd/seed`, `internal/{platform,httpapi,domain,ports,adapters,rules,journey,clock,privacy,notify,store,audit,jobs,tenant}`, `migrations/` (goose SQL), `api/` (oapi-codegen output). ADK for Go agents live in `internal/adapters/ai` |
| `services/score-verifier` | Node service that replays game sessions with `packages/game-core` |
| `services/workflows` | Render Workflows tasks in TypeScript (`@renderinc/sdk`); business steps call the Go API |
| `packages/game-core` | Game SDK contract + deterministic scoring (TS) |
| `packages/ui` | Design tokens |
| `packages/rules` | Rule-pack types + TS mirror of the Go rules engine (conformance-tested on `tests/golden`) |
| `packages/api-client` | Generated from `api/openapi.yaml` |
| `tests/golden/` | Shared golden cases (JSON) run by the Go engine and the TS mirror |
| `rulepacks/` | State rule packs (data, CC-BY), with source/date/confidence per rule |
| `ai/prompts`, `ai/evals` | Agent prompts and eval sets |
| `n8n/` | Exported workflows |
| `infra/` | render.yaml, Dockerfiles, Helm outline |

## Commands
| Task | Command |
|---|---|
| Install | `pnpm install` · `cd services/api && go mod download` (Go 1.27; no Docker needed) |
| Dev | `pnpm dev` · `cd services/api && go run ./cmd/api` · `render workflows dev -- pnpm --filter @margdarshak/workflows start` (see ENVIRONMENT_SETUP) |
| Test (Go) | `cd services/api && go vet ./... && go test ./...` (store tests use embedded Postgres 16, no Docker; `go test -short ./...` skips them) |
| Test (TS) | `pnpm test` (Vitest) · `pnpm --filter @margdarshak/rules test:golden` · `pnpm test:e2e` |
| Lint / type | Go: `gofmt -l .` (must print nothing) · `go vet ./...` · `golangci-lint run` · `govulncheck ./...` · TS: `biome check .` · `tsc --noEmit` |
| Codegen | `cd services/api && go generate ./...` (oapi-codegen from `api/openapi.yaml`, sqlc) · `pnpm gen:api` (TS client) |
| Evals | `cd services/api && go test -tags evals ./internal/adapters/ai/evals/...` (see `docs/04-ai/AI_EVALS.md`) |

## Non-negotiable rules (council directives)
- **Aadhaar and identity data:** never collect, store, log or send to a model any Aadhaar number, VID, OTP, biometric or face image. Those steps hand off to Sarathi or the state (D-07). The AadhaarOffline adapter is mock-only.
- **Numbers:** code computes every number (fees from `fees.json` in paise, dates from rule packs). LLMs only narrate and may only choose IDs from allowlists generated from `rulepacks/` (D-09). Never put ₹ literals in UI copy.
- **AI for everyone (D-13 revised):** every AI feature is available to every user. A learner aged 16–17 uses Margdarshak on a parent's phone, inside the parent's adult account, in family mode, with verifiable parental consent. No behavioural tracking or targeted ads on a child's data; squads and share cards only with the parent's consent. There is no "under 18 = rules only" gate.
- **Government integrations:** no scraping and no booking bots. Integrations go through adapters (mock + real, same contract tests) (D-08).
- **Wording:** every page carries the non-affiliation footer. Never use "official", "first", "DPDP-compliant", "integrated with Sarathi", "lives saved", "verified licence", "safe" as a scam verdict, "unsafe driver" or "you would crash" (D-19). The copy lint enforces this.
- **Games:**
  - No speed or stunt content.
  - False alarms are penalised.
  - No stakes or prizes.
  - The server replay score wins (D-11).
- **CCPA dark patterns:** banned by lint.

## Conventions
- **Languages:** Go for the API; TypeScript for web, console, `packages/*`, the score verifier (Node) and Render Workflows tasks. No Python anywhere (ADR-0011).
- **TypeScript:** strict; Zod at boundaries; Biome + `tsc --noEmit` + Vitest.
- **Go:**
  - gofmt, `go vet` and golangci-lint clean.
  - Contract-first: handlers implement `api/openapi.yaml` (oapi-codegen strict server on chi v5); errors are RFC 9457 problem+json.
  - Data: pgx v5 + sqlc; goose SQL migrations; tests on embedded Postgres 16 (`fergusstrange/embedded-postgres`) with testify.
  - Wrap errors with `fmt.Errorf("...: %w", err)`; `context.Context` is the first parameter of every I/O call.
  - Logs only through `log/slog` with the PII redaction handler; OpenTelemetry Go for traces and metrics.
  - Pure packages (`internal/domain`, `internal/rules`, the journey machine) import no I/O libraries (depguard).
  - AI: ADK for Go (`google.golang.org/adk` v1.9.x, `Runner.RunLive` for the voice guide) + Go Gemini SDK (`google.golang.org/genai` v1.76.x, Live API).
- **Commits:** Conventional Commits that reference MD-xxx and F-xx.
- **Tests:** every rule change needs a golden test; every EC-xx has a test (name it `EC-xx`).
- **Workflows:** every task is idempotent (`caseId:type:dueOn`).

## Key docs
- **Overview:** README · PROJECT_BRIEF · VISION · PITCH
- **Engineering:** BUILD_CONVENTIONS · ADR-0011 (Go backend) · ARCHITECTURE · DATA_MODEL · API_SPEC (+ `api/openapi.yaml`) · BACKEND · FRONTEND · TESTING
- **Games and AI:** GAME_SDK · DEBRIEF_SPEC · AGENTS · PROMPTS · AI_EVALS
- **Security:** SECURITY_ARCHITECTURE · EDGE_CASES
- **Delivery:** IMPLEMENTATION_PLAN
