# Environment Setup
> Project: Margdarshak · Owner: Tech lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [Project Brief](../00-overview/PROJECT_BRIEF.md) · [Git Workflow](GIT_WORKFLOW.md) · [Frontend](FRONTEND.md) · [Backend](BACKEND.md) · [Testing](TESTING.md) · [Deployment](../05-ops/DEPLOYMENT.md) · [CI/CD](../05-ops/CICD.md) · root `.env.example`

Goal: a new developer goes from a clean Windows 11 or macOS machine to the citizen app, console, API, score verifier, Workflows tasks and n8n running locally on mock adapters in **under 45 minutes**. Linux follows the macOS commands with the distro's package manager.

---

## 1. What you will run locally

```mermaid
flowchart LR
  subgraph Host
    WEB[apps/web :3000]
    CON[apps/console :3001]
    API[services/api :8000]
    SV[services/score-verifier :8090]
    WF[render workflows dev :8120]
  end
  subgraph Docker
    PG[(Postgres 16 :5432)]
    RD[(Redis 7 :6379)]
    N8N[n8n :5678]
    MINIO[(MinIO :9000 — optional R2 stand-in)]
  end
  WEB --> API
  CON --> API
  API --> PG
  API --> RD
  API --> SV
  API --> WF
  WF --> PG
  API <--> N8N
  WF --> MINIO
```

| Port | Service | Notes |
|---|---|---|
| 3000 | `apps/web` (Next.js dev, Turbopack) | service worker disabled in dev |
| 3001 | `apps/console` | — |
| 8000 | `services/api` (Uvicorn reload) | OpenAPI UI at `/docs` in dev only |
| 8090 | `services/score-verifier` | private in production |
| 8120 | Render Workflows local task server | started by `render workflows dev` |
| 5432 | Postgres 16 | `margdarshak` / `margdarshak` (local only) |
| 6379 | Redis 7 (stand-in for Render Key Value) | — |
| 5678 | n8n | local instance for workflow development |
| 9000/9001 | MinIO (optional) | S3-compatible stand-in for R2 |

---

## 2. Prerequisites (pinned)

| Tool | Version | Why |
|---|---|---|
| Git | ≥ 2.45 | — |
| **Node.js** | **22.23.4 LTS ("Jod")** (released 2026-10-20) | Vitest 5 needs `^22.12`; `@axe-core/playwright`, commitlint, msw need `>=22.12` |
| Corepack | bundled with Node 22 | activates the pinned pnpm |
| **pnpm** | **12.15.0** | workspaces; pinned via `packageManager` |
| **uv** | **0.13.5** | Python toolchain + lockfiles |
| **Python** | **3.12.x** (installed by uv) | `requires-python = ">=3.12,<3.13"` |
| **Docker** | Docker Desktop 4.x (Windows: WSL 2 backend) | Postgres, Redis, n8n, MinIO |
| **Render CLI** | ≥ 2.12.0 (latest seen: v2.31.0, 2026-10-22) | `render workflows dev` needs ≥ 2.12.0 (`B-sponsors.md` §1) |
| ffmpeg | 7.x | clip pipeline tasks (transcode) |
| k6 | v2.3.0 | load tests (optional) |
| mkcert or cloudflared | latest | HTTPS for testing camera/mic on a phone over LAN (optional) |

Accounts you need (ask the Tech lead; never share keys in chat): GitHub org access, Render workspace (Workflows enabled), Google AI Studio / Gemini API key on the **paid tier** for anything beyond synthetic data (D-13), Sarvam API key (Dogri ASR, optional), n8n Pro cloud (for shared workflows), Cloudflare R2 (optional; MinIO works locally), Sentry DSN (optional).

---

## 3. Windows 11 setup (PowerShell)

> Run PowerShell as your normal user unless a step says "Administrator".

**3.1 Core tools via winget**
```powershell
winget install --id Git.Git -e
winget install --id Docker.DockerDesktop -e          # then enable WSL 2 backend when prompted, reboot
winget install --id Schniz.fnm -e                     # Node version manager
winget install --id Gyan.FFmpeg -e
winget install --id GrafanaLabs.k6 -e                 # optional
```

**3.2 Node 22 + pnpm**
```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression   # add this line to $PROFILE too
fnm install 22.23.4
fnm use 22.23.4
node -v            # v22.23.4
corepack enable
corepack prepare pnpm@12.15.0 --activate
pnpm -v            # 12.15.0
```

**3.3 uv + Python 3.12**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# restart the terminal so uv is on PATH
uv --version       # uv 0.13.5 (run `uv self update` if older)
uv python install 3.12
```

**3.4 Render CLI**
Install from the Render CLI GitHub releases (`render-oss/cli`, Windows zip) or winget (`B-sponsors.md` §1 lists winget as an option; the exact package ID is [unverified], check with `winget search render`; owner Tech lead, 2026-10-24). Put `render.exe` on PATH, then:
```powershell
render --version   # ≥ 2.12.0
render login
render skills install render-workflows   # optional: Claude Code skill for Workflows (launch blog)
```

**3.5 Git settings for this repo (Windows specifics)**
```powershell
git config --global core.autocrlf false        # the repo's .gitattributes normalises line endings
git config --global core.longpaths true        # node_modules paths can exceed 260 chars
```
Also enable long paths in Windows (Administrator PowerShell, once):
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

Recommended: clone into a short path on an NTFS drive, e.g. `G:\HACKATHON_PROJECTS\HACKCACHE26\margdarshak`, and exclude it from real-time antivirus scanning if `pnpm install` is very slow.

---

## 4. macOS setup (zsh)

```bash
# Homebrew: https://brew.sh
brew install git fnm ffmpeg k6 mkcert
brew install --cask docker            # Docker Desktop; start it once
brew install render                   # Render CLI (B-sponsors.md §1 lists brew)

# Node 22 + pnpm
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc && source ~/.zshrc
fnm install 22.23.4 && fnm use 22.23.4
corepack enable && corepack prepare pnpm@12.15.0 --activate

# uv + Python
curl -LsSf https://astral.sh/uv/install.sh | sh
exec $SHELL -l
uv python install 3.12

render --version && render login
```

Apple Silicon: all images used (`postgres:16`, `redis:7`, n8n, MinIO) publish arm64 builds.

---

## 5. Clone, install, configure

```bash
git clone https://github.com/<org>/margdarshak.git      # org name: Tech lead to confirm before build-start
cd margdarshak

pnpm install                       # TS workspaces (apps, packages, score-verifier, e2e)
pnpm py:sync                       # = uv sync in services/api and services/workflows (creates .venv per service)

cp .env.example .env               # Windows PowerShell: Copy-Item .env.example .env
```

Edit `.env` — the minimum for a mock-only local run:

| Variable | Local value |
|---|---|
| `APP_ENV` | `local` |
| `DATABASE_URL` | `postgresql+psycopg://margdarshak:margdarshak@localhost:5432/margdarshak` |
| `REDIS_URL` | `redis://localhost:6379/0` |
| `SESSION_SECRET`, `HMAC_N8N_SECRET`, `SCORE_VERIFIER_HMAC_SECRET`, `FIELD_ENCRYPTION_KEY` | generate: `uv run python -c "import secrets;print(secrets.token_urlsafe(48))"` (the encryption key needs `python -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())"`) |
| `ADAPTER_SARATHI` … `ADAPTER_SLOTS` | `mock` (or `deeplink` for Sarathi Mode A) |
| `JOB_RUNNER` | `inline` (switch to `render` in §7) |
| `NARRATOR` | `template` (no Gemini key needed); `adk` once `GEMINI_API_KEY` is set |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` |

Every variable is documented in `.env.example`, grouped and commented. `.env` is git-ignored; never commit it.

---

## 6. Start the stack

**6.1 Infrastructure containers**

The dev compose file lives at `infra/docker/compose.dev.yml` (owned by the Ops lead; its reference content):
```yaml
name: margdarshak-dev
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: margdarshak, POSTGRES_PASSWORD: margdarshak, POSTGRES_DB: margdarshak, TZ: UTC }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U margdarshak"], interval: 5s, retries: 10 }
  redis:
    image: redis:7
    ports: ["6379:6379"]
  n8n:
    image: docker.n8n.io/n8nio/n8n:2.44.6     # npm latest on 2026-10-23; confirm the image tag exists [unverified]
    environment:
      GENERIC_TIMEZONE: Asia/Kolkata
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
      EXECUTIONS_DATA_SAVE_ON_SUCCESS: none        # minimal execution-data retention (PII rule)
      EXECUTIONS_DATA_PRUNE: "true"
    ports: ["5678:5678"]
    volumes: [n8ndata:/home/node/.n8n]
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: minio, MINIO_ROOT_PASSWORD: minio-local-only }
    ports: ["9000:9000", "9001:9001"]
    profiles: ["storage"]
volumes: { pgdata: {}, n8ndata: {} }
```

```bash
pnpm infra:up            # docker compose -f infra/docker/compose.dev.yml up -d
pnpm db:migrate          # uv run alembic upgrade head (services/api)
pnpm db:seed             # loads rulepacks (IN-base, JK, DL, KL), offices/slots (simulated), synthetic personas P-01..P-07, demo clips manifest
```

**6.2 Apps and services**
```bash
pnpm dev                 # runs in parallel: web :3000, console :3001, api :8000, score-verifier :8090
```
Open http://localhost:3000/hi — you should see the language picker and the non-affiliation footer.

Individually:
```bash
pnpm --filter @margdarshak/web dev
pnpm --filter @margdarshak/console dev
pnpm api:dev             # cd services/api && uv run uvicorn margdarshak.main:create_app --factory --reload --port 8000
pnpm --filter @margdarshak/score-verifier dev
```

**6.3 Smoke test**
```bash
curl http://localhost:8000/v1/health          # {"status":"ok","rulePacks":{"JK":"2026.10.0",…},"adapters":{…}}
pnpm test:smoke                               # plan → case → autosave → game session → template debrief
```

---

## 7. Render Workflows locally

```bash
cd services/workflows
render workflows dev -- uv run python -m margdarshak_workflows     # local task server on :8120
```
Then in `.env`: `JOB_RUNNER=render`, `RENDER_USE_LOCAL_DEV=true`, `WORKFLOW_SLUG=margdarshak-workflows`. Start a task from another terminal:
```bash
render workflows tasks start case_clock_sweep --input='["JK","2026-10-23"]' --local
render workflows runs list case_clock_sweep --local
```
For deploys and `RENDER_API_KEY` handling see [DEPLOYMENT](../05-ops/DEPLOYMENT.md). Never put a production `RENDER_API_KEY` in a local `.env`.

---

## 8. n8n locally

1. Open http://localhost:5678, create the owner account (local only).
2. Import workflows: `pnpm n8n:import` (runs `n8n import:workflow --separate --input=/n8n/workflows` inside the container; credentials are **not** in Git).
3. Create credentials in the n8n UI: `Margdarshak API HMAC` (header auth using `HMAC_N8N_SECRET`), WhatsApp Cloud API test number (optional), SMTP (optional).
4. Set n8n variables: `API_BASE_URL=http://host.docker.internal:8000` (Docker Desktop on Windows/macOS resolves `host.docker.internal` to the host).
5. In `.env`, set `N8N_WEBHOOK_BASE_URL=http://localhost:5678/webhook`.
6. Trigger W1 manually to run a clock sweep end to end.

n8n is the messaging edge only (D-16): if your local n8n is off, the app still works; notifications just stay queued.

---

## 9. Optional: AI, voice and Dogri

| To enable | Set | Notes |
|---|---|---|
| AI debrief / coach / tutor | `NARRATOR=adk`, `GEMINI_API_KEY`, model env vars (defaults in `.env.example`) | synthetic data only unless `GEMINI_BILLING_CONFIRMED=true` (paid tier, D-13) |
| Voice guide | `VOICE_ENABLED=true`, `VOICE_MODEL`, `VOICE_MODEL_FALLBACK` | the mic needs a secure context: `localhost` is fine; for a phone on LAN use HTTPS (below) |
| Dogri speech in | `SARVAM_API_KEY`, `ASR_DOGRI_PROVIDER=sarvam` | Sarvam is a disclosed processor |
| ADK dev UI | `cd services/api && uv run adk web src/margdarshak/adapters/outbound/ai/agents` | dev only; never exposed |
| Run evals | `pnpm ai:eval` (`adk eval` over `ai/evals/*.evalset.json`) | costs tokens; uses the configured key |

**Testing camera/mic on a real phone:** browsers require HTTPS outside `localhost`. Either `pnpm --filter @margdarshak/web dev:https` (Next.js `--experimental-https`, uses mkcert) and open `https://<your-LAN-IP>:3000`, or run `cloudflared tunnel --url http://localhost:3000` and use the temporary URL (never share it publicly with real data).

---

## 10. Everyday commands

| Command | Does |
|---|---|
| `pnpm dev` | web + console + api + verifier |
| `pnpm lint` / `pnpm format` | Biome + ESLint (Next) + Ruff + wording/fact lints |
| `pnpm typecheck` | tsc (all) + mypy strict |
| `pnpm test` | Vitest + pytest (unit, golden, contract on mocks) |
| `pnpm test:golden` | rules/fees/journey/clock golden suites |
| `pnpm test:e2e` | Playwright + axe (`pnpm exec playwright install --with-deps chromium webkit` once) |
| `pnpm test:load` | k6 scripts against `LOAD_TARGET_URL` |
| `pnpm gen:api` | regenerate `packages/api-client` from `api/openapi.yaml` |
| `pnpm gen:rules` | regenerate `packages/rules` types from `rulepacks/schema` |
| `pnpm db:migrate` / `pnpm db:revision -m "msg"` | Alembic |
| `pnpm size` | size-limit budgets incl. Lite < 300 KB |
| `pnpm clean` | remove build outputs and caches |

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm: command not found` after install | Corepack not enabled in this shell / fnm not in profile | `corepack enable`; add the `fnm env` line to `$PROFILE` / `~/.zshrc` |
| `ERR_PNPM_UNSUPPORTED_ENGINE` | wrong Node version | `fnm use 22.23.4` (the repo has `.node-version`) |
| `EPERM` / `ENAMETOOLONG` on Windows during install | long paths or antivirus lock | enable long paths (§3.5); exclude the repo from real-time scanning; retry `pnpm install` |
| Docker: "WSL 2 installation is incomplete" | WSL not installed | Administrator: `wsl --install`, reboot, restart Docker Desktop |
| Port 5432 already in use | a local Postgres service | stop it (`Stop-Service postgresql*` / `brew services stop postgresql`) or change the host port in compose and `DATABASE_URL` |
| `psycopg.OperationalError: connection refused` | containers not up yet | `pnpm infra:up`, wait for the healthcheck; `docker compose ps` |
| Alembic "Target database is not up to date" | stale DB volume | `pnpm db:reset` (drops the local volume; local data only) |
| `uv sync` fails building a wheel | missing build tools for a package without wheels | we pin packages with wheels for 3.12 on Windows/macOS; run `uv python install 3.12` and ensure the venv is 3.12 (`uv run python -V`) |
| `mypy` cannot find `render_sdk` types | SDK is early access | covered by a scoped `ignore_missing_imports` override in `pyproject.toml` |
| Service worker serving stale UI | SW from a previous prod build on `localhost:3000` | DevTools → Application → Service Workers → Unregister; dev builds do not register the SW |
| Video taps feel "late" in dev | React StrictMode double effects or devtools open | test timing in a production build (`pnpm --filter @margdarshak/web build && start`) on a real phone |
| Phaser canvas blank after hot reload | game not destroyed on unmount | ensure `game.destroy(true)` in cleanup; full reload |
| Mic/camera permission never prompts | non-secure origin | use `localhost` or HTTPS (§9) |
| `render workflows dev` "command not found" / old version | CLI < 2.12.0 | update the CLI (§3.4 / `brew upgrade render`) |
| Tasks run locally but API never sees results | `RENDER_USE_LOCAL_DEV` not set or wrong `WORKFLOW_SLUG` | set both in `.env`, restart the API |
| n8n cannot reach the API | `localhost` inside the container is the container | use `http://host.docker.internal:8000`; on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]` |
| n8n webhook returns 401 from API | HMAC secret mismatch or clock skew > 5 min | same `HMAC_N8N_SECRET` in both; sync system time (Windows: `w32tm /resync`) |
| Gemini 403 / "user location not supported" | key/project restriction | check the key's project and billing; keep `NARRATOR=template` meanwhile |
| AI features disabled although key set | `APP_ENV` is `field`/`production` without `GEMINI_BILLING_CONFIRMED=true` | intended guard (D-13); confirm the paid tier first |
| Hindi text renders as boxes | font subset not loaded | run `pnpm --filter @margdarshak/ui build` (copies font subsets); clear cache |
| Playwright fails to launch WebKit on Windows | missing browser deps | `pnpm exec playwright install --with-deps webkit` |
| CRLF diffs on every file | `core.autocrlf=true` | set `false`; `git add --renormalize .` |

---

## 12. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| Local adapters | all `mock` (Sarathi `deeplink`) | sandbox adapters per state behind VPN/allow-lists |
| Secrets | `.env` on the developer machine; shared via the team password manager | secrets manager in the Indian cloud; no secrets on laptops |
| Data | synthetic seed only; no participant data before the confirmed start (R-14) | anonymised staging snapshots only |
| Devices | team phones + DevTools throttling | device lab of low-end Android phones |
