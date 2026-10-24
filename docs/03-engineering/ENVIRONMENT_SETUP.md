# Environment Setup
> Project: Margdarshak · Owner: Tech lead · Status: Draft v0.2 · Last updated: 2026-10-23
> Related: [Project Brief](../00-overview/PROJECT_BRIEF.md) · [Build Conventions](../08-project/BUILD_CONVENTIONS.md) · [Git Workflow](GIT_WORKFLOW.md) · [Frontend](FRONTEND.md) · [Backend](BACKEND.md) · [Testing](TESTING.md) · [Deployment](../05-ops/DEPLOYMENT.md) · [CI/CD](../05-ops/CICD.md) · root `.env.example`

**Goal:** a new developer goes from a clean Windows 11 or macOS machine to all of these running locally on mock adapters in **under 45 minutes**:
- the citizen app and the console;
- the Go API;
- the score verifier;
- the Render Workflows tasks (TypeScript);
- n8n.

Linux follows the macOS commands with the distro's package manager.

**Languages:**
- **Go 1.27** for the API (`services/api`).
- **TypeScript on Node 22** for everything else, including the Render Workflows tasks in `services/workflows`.

There is no Python toolchain to install (ADR-0011).

**Docker is not required.** Go tests run against a real Postgres 16 through `github.com/fergusstrange/embedded-postgres`, and Key Value is optional in dev. `infra/docker/compose.yaml` stays for teammates who have Docker (§6.1, option C).

---

## 1. What you will run locally

```mermaid
flowchart LR
  subgraph Host
    WEB[apps/web :3000]
    CON[apps/console :3001]
    API[services/api Go :8000]
    SV[services/score-verifier :8081]
    WF[render workflows dev :8120<br/>services/workflows TS]
    PG[(Postgres 16 :5432<br/>native or embedded)]
  end
  subgraph Optional
    RD[(Redis/Valkey :6379)]
    N8N[n8n :5678]
    MINIO[(MinIO :9000 — R2 stand-in)]
  end
  WEB --> API
  CON --> API
  API --> PG
  API -.-> RD
  API --> SV
  API -->|POST /v1/task-runs| WF
  WF -->|HMAC /internal/*| API
  API <--> N8N
  WF --> MINIO
```

| Port | Service | Notes |
|---|---|---|
| 3000 | `apps/web` (Next.js dev, Turbopack) | service worker disabled in dev |
| 3001 | `apps/console` | — |
| 8000 | `services/api` (`go run ./cmd/api`) | `/v1/health`; the OpenAPI document is `api/openapi.yaml` (no generated UI) |
| 8081 | `services/score-verifier` | private in production |
| 8120 | Render Workflows local task server | started by `render workflows dev` |
| 5432 | Postgres 16 | native install, embedded dev DB, or compose; `margdarshak` / `margdarshak` (local only) |
| 6379 | Redis / Valkey (stand-in for Render Key Value) | optional: with `REDIS_URL` empty, the API uses in-memory rate limits and sessions in dev |
| 5678 | n8n | local instance for workflow development (optional) |
| 9000/9001 | MinIO (optional) | S3-compatible stand-in for R2 |

---

## 2. Prerequisites (pinned)

| Tool | Version | Why |
|---|---|---|
| Git | ≥ 2.45 | — |
| **Go** | **1.27** (go.dev stable go1.27.3; the team machine has go1.27.0) | API build and tests; `go.mod` says `go 1.27.0` |
| **Node.js** | **22.x LTS** (team machine: 22.19; `engines` says `>=22.12.0 <23`) | Vitest 5, Playwright, Workflows tasks |
| Corepack | bundled with Node 22 | activates the pinned pnpm |
| **pnpm** | `packageManager` says **12.15.0**; 11.9 also works | Use `corepack pnpm` if it works, else the installed pnpm (BUILD_CONVENTIONS §2) |
| **Postgres 16** | 16.x | Only to *run* the API locally (tests bring their own embedded Postgres). Native install or the embedded dev DB (§6.1) |
| golangci-lint | **v2.15.0** | Go lint (CODING_STANDARDS §4.2) |
| govulncheck | golang.org/x/vuln **v1.9.0** | Go vulnerability scan |
| **Render CLI** | ≥ 2.12.0 (winget `Render.CLI` 2.31.0 on 2026-10-23) | `render workflows dev` needs ≥ 2.12.0 (`B-sponsors.md` §1); optional unless you work on jobs |
| ffmpeg | 7.x | clip pipeline tasks (transcode); optional |
| k6 | v2.3.0 | load tests (optional) |
| mkcert or cloudflared | latest | HTTPS for testing camera/mic on a phone over LAN (optional) |
| Docker | optional | only for `infra/docker/compose.yaml`, the e2e stack as CI runs it, or a local n8n |

You do not need to install `sqlc` or `oapi-codegen`. `go generate ./...` runs them pinned through `go run`:
- `github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1`
- `github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0`

Accounts you need (ask the Tech lead; never share keys in chat):
- GitHub org access.
- A Render workspace with Workflows enabled.
- A Google AI Studio / Gemini API key on the **paid tier** for any real-user data (AI is on for every user, D-13 revised).
- Sarvam API key (Dogri ASR, optional).
- n8n Pro cloud (for shared workflows).
- Cloudflare R2 (optional; MinIO or the local filesystem adapter work locally).
- Sentry DSN (optional).

---

## 3. Windows 11 setup (PowerShell; Git Bash works for the same commands)

> Run PowerShell as your normal user unless a step says "Administrator".

**3.1 Core tools via winget** (IDs checked with `winget search` on 2026-10-23)
```powershell
winget install --id Git.Git -e
winget install --id GoLang.Go -e                      # Go 1.27.x
winget install --id Schniz.fnm -e                     # Node version manager
winget install --id PostgreSQL.PostgreSQL.16 -e       # optional: native Postgres 16 for running the API (§6.1 option A)
winget install --id Render.CLI -e                     # optional: render workflows dev (§7)
winget install --id Gyan.FFmpeg -e                    # optional: clip pipeline
winget install --id GrafanaLabs.k6 -e                 # optional
```
Restart the terminal, then:
```powershell
go version         # go version go1.27.x windows/amd64
go env GOPATH      # binaries from `go install` land in $(go env GOPATH)\bin; make sure it is on PATH
```

**3.2 Node 22 + pnpm**
```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression   # add this line to $PROFILE too
fnm install 22
fnm use 22
node -v            # v22.x
corepack enable
corepack pnpm -v   # 12.15.0 from packageManager; if corepack fails, use the installed pnpm (11.9)
```

**3.3 Go tools**
```powershell
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
golangci-lint version
govulncheck -version
```
`go test -race` needs cgo and a C compiler. It runs in CI on Linux; on Windows without gcc, skip `-race` locally.

**3.4 Render CLI**
```powershell
render --version   # ≥ 2.12.0
render login
render skills install render-workflows   # optional: Claude Code skill for Workflows (launch blog)
```

**3.5 Git settings for this repo (Windows specifics)**
```powershell
git config --global core.autocrlf false        # the repo's .gitattributes normalises line endings (gofmt expects LF)
git config --global core.longpaths true        # node_modules paths can exceed 260 chars
```
Also enable long paths in Windows (Administrator PowerShell, once):
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

Recommended: clone into a short path on an NTFS drive, e.g. `G:\HACKATHON_PROJECTS\HACKCACHE26\margdarshak`. If `pnpm install` or `go build` is very slow, exclude the repo, `%LOCALAPPDATA%\go-build` and `$(go env GOMODCACHE)` from real-time antivirus scanning.

---

## 4. macOS setup (zsh)

```bash
# Homebrew: https://brew.sh
brew install git go fnm ffmpeg k6 mkcert
brew install postgresql@16            # optional: native Postgres for running the API
brew install render                   # Render CLI (B-sponsors.md §1 lists brew)

# Node 22 + pnpm
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc && source ~/.zshrc
fnm install 22 && fnm use 22
corepack enable && corepack pnpm -v

# Go tools
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
export PATH="$PATH:$(go env GOPATH)/bin"   # add to ~/.zshrc

go version && render --version && render login
```

Apple Silicon: embedded-postgres ships darwin/arm64 binaries, and the optional images (`postgres:16`, `valkey/valkey:8`, n8n, MinIO) publish arm64 builds.

---

## 5. Clone, install, configure

```bash
git clone https://github.com/sruj08/margadarshak.git   # confirm the org/repo with the Tech lead before build-start
cd margdarshak

corepack pnpm install              # TS workspaces (apps, packages, score-verifier, workflows, e2e)
cd services/api
go mod download                    # Go dependencies from go.sum (only BE-platform runs `go get` / `go mod tidy`, BUILD_CONVENTIONS §3)
go generate ./...                  # oapi-codegen + sqlc; generated code is committed, so this should leave no diff
go build ./...
cd ../..
```

Create `services/api/.env`. Copy it from the root `.env.example`, or write it by hand. The API reads env vars through `internal/platform/config` (`caarlos0/env` v11), and in `APP_ENV=dev` it also loads `services/api/.env`. The minimum for a mock-only local run:

| Variable | Local value |
|---|---|
| `APP_ENV` | `dev` |
| `PORT` | `8000` |
| `DATABASE_URL` | `postgres://margdarshak:margdarshak@localhost:5432/margdarshak?sslmode=disable` (pgx v5 URL; no driver prefix) |
| `REDIS_URL` | empty (in-memory limiter and session store in dev) or `redis://localhost:6379/0` |
| `RULEPACK_DIR` | `../../rulepacks` |
| `PROMPT_DIR` | `../../ai/prompts` |
| `SESSION_SIGNING_KEY`, `N8N_HMAC_SECRET`, `VERIFIER_SHARED_SECRET` | random, ≥ 32 bytes (commands below) |
| `CONTACT_ENCRYPTION_KEY` | 32 random bytes, base64 |
| `ADAPTER_SARATHI`, `ADAPTER_DIGILOCKER`, `ADAPTER_PAYMENT`, `ADAPTER_BHASHINI`, `ADAPTER_SLOT` | `mock` (or `deeplink` for Sarathi Mode A) |
| `ADAPTER_NOTIFICATION` | `console` |
| `SCORE_VERIFIER_HOSTPORT` | `localhost:8081` |
| `JOB_RUNNER` | `inline` (switch to `render_workflows` in §7) |
| `AI_MODE` | `template` (no Gemini key needed); `gemini` once `GEMINI_API_KEY` is set (§9) |
| `DATA_CLASS` | `synthetic-only` |

Web: `apps/web/.env.local` with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`.

Generate secrets:
```bash
# Git Bash / macOS / Linux
openssl rand -base64 48        # signing keys and HMAC secrets
openssl rand -base64 32        # CONTACT_ENCRYPTION_KEY
```
```powershell
# PowerShell 5.1
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Every variable is documented in `.env.example`, grouped and commented. `.env` files are git-ignored; never commit one.

---

## 6. Start the stack

**6.1 Postgres for running the API.** Tests do not need any of these, because they start their own embedded Postgres. Pick one:

| Option | How | When |
|---|---|---|
| **A. Native Postgres 16** (recommended on Windows) | Install (§3.1/§4), then create the role and database once: `psql -U postgres -c "CREATE ROLE margdarshak LOGIN PASSWORD 'margdarshak';" -c "CREATE DATABASE margdarshak OWNER margdarshak;"` | Everyday development |
| **B. Embedded dev DB** | `DEV_EMBEDDED_PG=true go run ./cmd/api` starts embedded-postgres (Postgres 16) on `localhost:5432` with data under `services/api/.devdb/` and points `DATABASE_URL` at it | **Only if implemented by BE-platform**; otherwise use A |
| **C. Docker** (teammates who have it) | `docker compose -f infra/docker/compose.yaml up -d db kv` | Matches the CI e2e stack; also gives Valkey |

**6.2 Migrate and seed** (from `services/api`)
```bash
go run ./cmd/api migrate up                         # goose v3 migrations embedded in the binary
go run ./cmd/api migrate status
go run ./cmd/seed --profile demo --synthetic        # rule packs (base + JK, DL, KL, MH, TN, PB), simulated offices/slots, synthetic personas P-01..P-07
```

**6.3 Apps and services**
```bash
# terminal 1: API
cd services/api && go run ./cmd/api                 # serve is the default subcommand; listens on :8000

# terminal 2: web + console + score verifier
corepack pnpm --filter @margdarshak/web dev
corepack pnpm --filter @margdarshak/console dev
corepack pnpm --filter @margdarshak/score-verifier dev
```
Open http://localhost:3000/hi. You should see the language picker and the non-affiliation footer.

The root `pnpm dev`, `pnpm api:dev`, `pnpm db:migrate` and `pnpm db:seed` scripts still point at the old toolchain. The tooling owner (FE agent, BUILD_CONVENTIONS §3) is updating them. Until then, use the Go commands above. The intended aliases are:

| Alias | Runs |
|---|---|
| `pnpm api:dev` | `cd services/api && go run ./cmd/api` |
| `pnpm db:migrate` | `cd services/api && go run ./cmd/api migrate up` |
| `pnpm db:seed` | `cd services/api && go run ./cmd/seed --profile demo --synthetic` |
| `pnpm test:go` | `cd services/api && go test ./...` |

**6.4 Smoke test**
```bash
curl http://localhost:8000/v1/health          # {"status":"ok","rule_packs":{"JK":"2026.10.0",…},"adapters":{…}}
cd services/api && go run ./cmd/api healthcheck   # exit code 0 when /v1/health is ok (the same probe the distroless image uses)
corepack pnpm test:smoke                      # plan → case → autosave → game session → template debrief
```

---

## 7. Render Workflows locally

The tasks are TypeScript (`services/workflows`, `@renderinc/sdk` 1.4.0). The Go API starts runs through `ports.JobRunner`, whose Render adapter calls `POST /v1/task-runs`. With `RENDER_USE_LOCAL_DEV=true`, that adapter targets the local task server at `http://localhost:8120` (override with `RENDER_LOCAL_DEV_URL`) instead of `https://api.render.com`.

```bash
# terminal A: local task server (registers every task() in services/workflows)
render workflows dev -- corepack pnpm --filter @margdarshak/workflows dev
```
Then set these in `services/api/.env` and restart the API:

| Variable | Value |
|---|---|
| `JOB_RUNNER` | `render_workflows` |
| `RENDER_USE_LOCAL_DEV` | `true` |
| `WORKFLOW_SLUG` | `margdarshak-workflows` |
| `API_INTERNAL_HOSTPORT` | `localhost:8000` (set for the tasks' `/internal/job-steps/*` calls; same name as in `infra/render.yaml`) |

Tasks call back into the API's HMAC-signed `/internal/job-steps/*` endpoints, so set the same `INTERNAL_HMAC_SECRET` for both (as in `infra/render.yaml`).

Start a task from another terminal:
```bash
render workflows tasks start case_clock_sweep --input='["JK","2026-10-23"]' --local
render workflows runs list case_clock_sweep --local
```
For deploys and `RENDER_API_KEY` handling see [DEPLOYMENT](../05-ops/DEPLOYMENT.md). Never put a production `RENDER_API_KEY` in a local `.env`.

Without the Render CLI, keep `JOB_RUNNER=inline`. The Go step handlers then run in-process. The media steps of `clip_ingest` (transcode, blur) are skipped, and dev uses the pre-blurred fixture clips.

---

## 8. n8n locally (optional; needs Docker or n8n Cloud)

1. Start n8n (`docker run -p 5678:5678 docker.n8n.io/n8nio/n8n` or a team n8n Cloud dev instance), open http://localhost:5678 and create the owner account (local only).
2. Import the workflows from `n8n/workflows/` (n8n UI → Import from file, or `n8n import:workflow --separate --input=/n8n/workflows` inside the container). Credentials are **not** in Git.
3. Create credentials in the n8n UI:
   - `Margdarshak API HMAC`: header auth using `N8N_HMAC_SECRET`.
   - WhatsApp Cloud API test number (optional).
   - SMTP (optional).
4. Set the n8n variable `API_BASE_URL=http://host.docker.internal:8000`. Docker Desktop on Windows/macOS resolves `host.docker.internal` to the host.
5. In `services/api/.env`, set `N8N_BASE_URL=http://localhost:5678` and `ADAPTER_NOTIFICATION=n8n`.
6. Trigger W1 manually to run a clock sweep end to end.

n8n is the messaging edge only (D-16). If your local n8n is off, the app still works; notifications just stay queued.

---

## 9. Optional: AI, voice and Dogri

AI is available to every user (D-13 revised). A learner aged 16–17 uses it inside a parent's account in family mode, after the parent's consent. There is no age switch to configure.

| To enable | Set | Notes |
|---|---|---|
| AI debrief / coach / tutor / decoder | `AI_MODE=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL_DEBRIEF`, `GEMINI_MODEL_VISION` (defaults in `.env.example`) | synthetic data only unless `GEMINI_BILLING_CONFIRMED=true` (paid tier) |
| Voice guide (ADK for Go `Runner.RunLive`) | `GEMINI_MODEL_LIVE`, `GEMINI_MODEL_LIVE_FALLBACK` | the mic needs a secure context: `localhost` is fine; for a phone on LAN use HTTPS (below) |
| Dogri speech in | `SARVAM_API_KEY`, `ASR_DOGRI_PROVIDER=sarvam` | Sarvam is a disclosed processor |
| Run evals | `cd services/api && EVAL_MODE=offline go test -tags evals ./internal/adapters/ai/evals/... -count=1` (no key); `EVAL_MODE=model` uses Gemini | `model` mode costs tokens and uses the configured key ([TESTING](TESTING.md) §7) |

ADK for Go has no `adk web` dev UI wired into this repo; inspect agent runs through the API's debug logs (`LOG_LEVEL=debug`, redacted) and the eval reports.

**Testing camera/mic on a real phone:** browsers require HTTPS outside `localhost`. Two options:
- Run `corepack pnpm --filter @margdarshak/web dev:https` (Next.js `--experimental-https`, uses mkcert) and open `https://<your-LAN-IP>:3000`.
- Run `cloudflared tunnel --url http://localhost:3000` and use the temporary URL. Never share it publicly with real data.

---

## 10. Everyday commands

**Go** (run in `services/api`)

| Command | Does |
|---|---|
| `go run ./cmd/api` | run the API on `:8000` |
| `go run ./cmd/api migrate up` / `down` / `status` | goose migrations (new file: `go run github.com/pressly/goose/v3/cmd/goose@v3.29.0 -dir migrations -s create <name> sql`) |
| `go run ./cmd/seed --profile demo --synthetic` | synthetic demo seed |
| `go generate ./...` | regenerate `api/` (oapi-codegen) and `internal/store/sqlcgen` (sqlc) |
| `gofmt -l .` / `golangci-lint fmt` | list / fix formatting |
| `go vet ./...` | vet |
| `golangci-lint run` | full lint set (CODING_STANDARDS §4.2) |
| `govulncheck ./...` | known-vulnerability scan |
| `go test -short ./...` | unit tests only |
| `go test ./...` | unit + integration on embedded Postgres 16 (first run downloads the binaries) |
| `go test ./internal/rules/ -run Golden` | golden suite (Go engine) |
| `go test ./internal/adapters/... -run Contract` | adapter contract suites on mocks |

**TypeScript** (run at the repo root)

| Command | Does |
|---|---|
| `corepack pnpm lint` / `corepack pnpm format` | Biome + ESLint (Next) + wording/fact lints |
| `corepack pnpm typecheck` | `tsc --noEmit` across workspaces |
| `corepack pnpm test` | every workspace's tests (Vitest; `node --test` for rules, workflows, game-core, score-verifier) |
| `corepack pnpm --filter @margdarshak/rules test` | golden suite (TS mirror, `node --test --experimental-strip-types`) |
| `corepack pnpm test:e2e` | Playwright + axe on the mock-mode build (`pnpm --filter @margdarshak/web build` first; `pnpm --filter @margdarshak/e2e exec playwright install chromium` once) |
| `corepack pnpm test:e2e:real` | full stack: builds the web into `.next-real` against the Go API, starts the API on embedded Postgres with the seed personas, runs `tests/e2e/specs/real-*.spec.ts` (P1 demo checkpoint) |
| `corepack pnpm gen:api` | regenerate `packages/api-client` from `api/openapi.yaml` |
| `corepack pnpm size` | size-limit budgets incl. Lite < 300 KB |
| `corepack pnpm clean` | remove build outputs and caches |

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `go: command not found` / old version | PATH not refreshed after winget | restart the terminal; `go version` must show 1.27.x |
| `go: go.mod requires go >= 1.27.0` | older Go installed | upgrade (`winget upgrade GoLang.Go`); or let `GOTOOLCHAIN=auto` download it |
| `golangci-lint` / `govulncheck` not found | `$(go env GOPATH)\bin` not on PATH | add it to PATH and restart the terminal |
| embedded-postgres test fails with "download" error | first run needs network to fetch the Postgres 16 binaries | retry online once; they are cached afterwards. Behind a proxy set `HTTPS_PROXY` |
| embedded-postgres "port already in use" | a native Postgres or another test run uses the port | tests pick a free port per package; stop stray `postgres` processes (`Get-Process postgres \| Stop-Process`) |
| `go test -race` fails with "cgo: C compiler not found" (Windows) | no gcc | skip `-race` locally; CI runs it on Linux |
| `dial tcp 127.0.0.1:5432: connect: connection refused` | no Postgres for the running API | start native Postgres (`Start-Service postgresql-x64-16`), the embedded dev DB, or compose (§6.1) |
| `password authentication failed for user "margdarshak"` | role not created | run the `CREATE ROLE` / `CREATE DATABASE` lines in §6.1 option A |
| goose "no next version found" / dirty state | migration edited after it ran locally | `go run ./cmd/api migrate down` then `up`; never edit a migration that is on `main`; add a new one |
| `go generate` leaves a diff | spec or SQL changed without regenerating | commit the regenerated files; CI fails on drift |
| Times off by 5h30 / `unknown time zone Asia/Kolkata` | no tzdata on the machine/image | binaries are built with `-tags timetzdata`; for `go run` on a minimal system add `-tags timetzdata` |
| `pnpm: command not found` after install | Corepack not enabled in this shell / fnm not in profile | `corepack enable`; add the `fnm env` line to `$PROFILE` / `~/.zshrc` |
| `ERR_PNPM_UNSUPPORTED_ENGINE` | wrong Node or pnpm version | `fnm use 22`; use `corepack pnpm`, or the installed pnpm (BUILD_CONVENTIONS §2) |
| `EPERM` / `ENAMETOOLONG` on Windows during install | long paths or antivirus lock | enable long paths (§3.5); exclude the repo from real-time scanning; retry `pnpm install` |
| Service worker serving stale UI | SW from a previous prod build on `localhost:3000` | DevTools → Application → Service Workers → Unregister; dev builds do not register the SW |
| Video taps feel "late" in dev | React StrictMode double effects or devtools open | test timing in a production build (`corepack pnpm --filter @margdarshak/web build && start`) on a real phone |
| Phaser canvas blank after hot reload | game not destroyed on unmount | ensure `game.destroy(true)` in cleanup; full reload |
| Mic/camera permission never prompts | non-secure origin | use `localhost` or HTTPS (§9) |
| `render workflows dev` "command not found" / old version | CLI < 2.12.0 | update the CLI (`winget upgrade Render.CLI` / `brew upgrade render`) |
| Tasks run locally but the API never sees results | `RENDER_USE_LOCAL_DEV` not set or wrong `WORKFLOW_SLUG` | set both in `services/api/.env`, restart the API |
| Task callbacks to the API return 401 | HMAC secret mismatch or clock skew > 5 min | same `N8N_HMAC_SECRET` for API and tasks; sync time (`w32tm /resync`) |
| n8n cannot reach the API | `localhost` inside the container is the container | use `http://host.docker.internal:8000`; on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]` |
| Gemini 403 / "user location not supported" | key/project restriction | check the key's project and billing; keep `AI_MODE=template` meanwhile |
| AI features disabled although key set | `APP_ENV` is `field`/`production` without `GEMINI_BILLING_CONFIRMED=true` | intended guard (paid tier for real users); confirm the paid tier first |
| AI returns 403 `PARENT_CONSENT_REQUIRED` for a family member's case | the seeded minor's case has no parental consent artefact | record the parent's consent in Family settings (or seed with `--with-parental-consent`); this is the D-13 revised rule, not a bug |
| Hindi text renders as boxes | font subset not loaded | run `corepack pnpm --filter @margdarshak/ui build` (copies font subsets); clear cache |
| Playwright fails to launch WebKit on Windows | missing browser deps | `corepack pnpm exec playwright install --with-deps webkit` |
| CRLF diffs on every file / gofmt reports every file | `core.autocrlf=true` | set `false`; `git add --renormalize .` |

---

## 12. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| Local adapters | all `mock` (Sarathi `deeplink`) | sandbox adapters per state behind VPN/allow-lists |
| Secrets | `.env` on the developer machine; shared via the team password manager | secrets manager in the Indian cloud; no secrets on laptops |
| Data | synthetic seed only; no participant data before the confirmed start (R-14) | anonymised staging snapshots only |
| Devices | team phones + DevTools throttling | device lab of low-end Android phones |
