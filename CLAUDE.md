# CLAUDE.md: instructions for AI coding agents working on Margdarshak

## Read first
1. `docs/00-overview/PROJECT_BRIEF.md`: the single source of truth for every ID and decision (F-, E-, API-, M-, EC-, R-, D-), including §15 "Resolved conflicts".
2. `MAP.md`: where everything is.
3. The ticket you were given, in `docs/08-project/BACKLOG.md` (MD-xxx).

## Repo layout
| Path | What |
|---|---|
| `apps/web` | Next.js 16 citizen PWA |
| `apps/console` | Next.js app for schools, the RTO/state console and the rule studio |
| `services/api` | FastAPI (Python 3.12, uv): domain, ports, adapters, ADK agents |
| `services/score-verifier` | Node service that replays game sessions with `packages/game-core` |
| `services/workflows` | Render Workflows (Python SDK) tasks |
| `packages/game-core` | Game SDK contract + deterministic scoring (TS) |
| `packages/ui` | Design tokens |
| `packages/rules` | Rule-pack schemas |
| `packages/api-client` | Generated from `api/openapi.yaml` |
| `rulepacks/` | State rule packs (data, CC-BY), with source/date/confidence per rule |
| `ai/prompts`, `ai/evals` | Agent prompts and eval sets |
| `n8n/` | Exported workflows |
| `infra/` | render.yaml, Dockerfiles, Helm outline |

## Commands
| Task | Command |
|---|---|
| Install | `pnpm install` · `cd services/api && uv sync` |
| Dev | `pnpm dev` · `render workflows dev` (see ENVIRONMENT_SETUP) |
| Test | `pnpm test` · `pnpm test:golden` · `pnpm test:contracts` · `pnpm test:games` · `pnpm e2e` · `cd services/api && uv run pytest` |
| Lint / type | `pnpm lint` · `pnpm typecheck` · `uv run ruff check` · `uv run mypy` |
| Evals | `pnpm evals` (see `docs/04-ai/AI_EVALS.md`) |
| Backlog check | `python scripts/gh_import_backlog.py --check` |

## Non-negotiable rules (council directives)
- **Aadhaar and identity data:** never collect, store, log or send to a model any Aadhaar number, VID, OTP, biometric or face image. Those steps hand off to Sarathi or the state (D-07). The AadhaarOffline adapter is mock-only.
- **Numbers:** code computes every number (fees from `fees.json` in paise, dates from rule packs). LLMs only narrate and may only choose IDs from allowlists generated from `rulepacks/` (D-09). Never put ₹ literals in UI copy.
- **Under-18 users:** no AI, no telemetry, no streaks, no squads; games run locally (D-13).
- **Government integrations:** no scraping and no booking bots. Integrations go through adapters (mock + real, same contract tests) (D-08).
- **Wording:** every page carries the non-affiliation footer. Never use "official", "first", "DPDP-compliant", "integrated with Sarathi", "lives saved", "verified licence", "safe" as a scam verdict, "unsafe driver" or "you would crash" (D-19). The copy lint enforces this.
- **Games:**
  - No speed or stunt content.
  - False alarms are penalised.
  - No stakes or prizes.
  - The server replay score wins (D-11).
- **CCPA dark patterns:** banned by lint.

## Conventions
- **TypeScript:** strict; Zod at boundaries.
- **Python:** mypy strict; Pydantic v2; hexagonal imports enforced by import-linter.
- **Commits:** Conventional Commits that reference MD-xxx and F-xx.
- **Tests:** every rule change needs a golden test; every EC-xx has a test.
- **Workflows:** every task is idempotent (`caseId:type:dueOn`).

## Key docs
- **Overview:** PROJECT_BRIEF · IDEA.md · RESEARCH.md
- **Engineering:** ARCHITECTURE · DATA_MODEL · API_SPEC (+ `api/openapi.yaml`) · BACKEND · FRONTEND · TESTING
- **Games and AI:** GAME_SDK · DEBRIEF_SPEC · AGENTS · PROMPTS · AI_EVALS
- **Security:** SECURITY_ARCHITECTURE · EDGE_CASES
- **Delivery:** IMPLEMENTATION_PLAN
