# CI/CD
> Project: Margdarshak · Owner: Ops lead (Team Chanakya) · Status: Draft v0.2 (Go backend, ADR-0011) · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [INFRASTRUCTURE](INFRASTRUCTURE.md) · [DEPLOYMENT](DEPLOYMENT.md) · [OBSERVABILITY](OBSERVABILITY.md) · [RUNBOOK](RUNBOOK.md) · [TESTING](../03-engineering/TESTING.md) · [BACKEND](../03-engineering/BACKEND.md) · [AI_EVALS](../04-ai/AI_EVALS.md) · [SECURITY_ARCHITECTURE](../06-security-compliance/SECURITY_ARCHITECTURE.md)
> Real files: [`ci.yml`](../../.github/workflows/ci.yml) · [`evals.yml`](../../.github/workflows/evals.yml) · [`security.yml`](../../.github/workflows/security.yml) · [`deploy.yml`](../../.github/workflows/deploy.yml) · [`render.yaml`](../../infra/render.yaml) · [`infra/docker/`](../../infra/docker/)

## 0. Summary
- **Two languages, no Python.** The API (`services/api`) is **Go 1.27** (ADR-0011, supersedes ADR-0002). Everything else is **TypeScript**: `apps/*`, `packages/*`, the score verifier and the Render Workflows tasks (`services/workflows`, `@renderinc/sdk` 1.4.0). CI therefore has one Go track and one TS track that meet at the golden-rules parity check.
- **Four workflows.** `ci.yml` (quality and correctness), `evals.yml` (the AI gate, D-10), `security.yml` (secrets, dependencies, SAST, containers, IaC, DAST) and `deploy.yml` (Render for the hackathon, Helm for a state).
- **One required check.** `ci-gate` aggregates every CI job, so branch protection names one status and never goes stale when a job is renamed.
- **No Docker needed for Go tests.** Integration tests run against a real Postgres 16 started in-process by `github.com/fergusstrange/embedded-postgres` v1.34.0 (binaries cached in `~/.embedded-postgres-go`). Docker is used only for the image smoke builds, the compose-based e2e job and a few scanners.
- **What makes this pipeline Margdarshak-specific**, beyond a normal web app's:
  1. **golden rules tests**: fees, eligibility and timelines must match the rule pack for every edge case (EC-01..EC-30), with the **same JSON fixtures** run by the Go engine and its TS mirror;
  2. **adapter contract tests**: mock and real government adapters pass the same suite (F-56);
  3. **game determinism**: same seed + same events ⇒ the same `SessionResult` hash on client and server (the anti-cheat basis);
  4. **an AI evals gate**: ≥ 30 cases per agent, zero invented numbers (D-10);
  5. **wording and rupee-literal lint** (D-06, D-19).
- **CI never touches a real government system, real users or Gemini.** All adapters are `mock`, `AI_MODE=template`, `JOB_RUNNER=inline` and the data is synthetic. Model calls happen only in `evals.yml`, on a paid-tier eval key with a ₹ spend cap.

## 1. Pipeline diagram
```mermaid
flowchart LR
  subgraph PR["Pull request / push to main"]
    direction LR
    L1["lint + typecheck TS<br/>Biome, ESLint (Next apps), tsc,<br/>wording + ₹-literal ban"] --> U1[unit TS<br/>Vitest + coverage<br/>incl. workflows tasks]
    L2["lint + vet Go<br/>gofmt, go vet, golangci-lint,<br/>codegen drift, govulncheck"] --> U2["unit Go<br/>go test -short -race"]
    U1 & U2 --> GR[golden rules<br/>fees, eligibility,<br/>EC-01..EC-30, Go = TS parity]
    U2 --> AC[adapter contracts<br/>7 adapters × mock,deeplink<br/>+ no-Aadhaar DTO guard]
    U1 --> GD[game determinism<br/>replay hash match,<br/>60/30 fps, anti-cheat]
    U2 --> AI["api integration<br/>embedded PG16 + Valkey,<br/>goose up/down/up, OpenAPI diff"]
    L1 --> BW["web build<br/>Lite &lt; 300 KB budget"]
    BW & AI & GR & AC & GD --> E2E[e2e Playwright<br/>+ axe WCAG 2.1 AA<br/>low-end + desktop]
    DS[docker smoke<br/>hadolint, build, non-root]
    E2E & DS --> GATE{{ci-gate}}
  end
  subgraph EV["evals.yml (AI paths, nightly)"]
    O[offline guardrails<br/>validator, templates, PII,<br/>consent / family mode] --> M["Go eval harness × 4 agents<br/>go test -tags evals<br/>paid key, ₹ cap"] --> R[PR comment]
  end
  subgraph SEC["security.yml (PR, main, weekly)"]
    G[gitleaks] ; V[govulncheck + go-licenses] ; N[pnpm audit + licences] ; Q["CodeQL ×3<br/>go, js-ts, actions"] ; T[Trivy config + image + SBOM] ; Z[ZAP baseline<br/>staging, weekly]
  end
  GATE -->|"main, success"| D
  M -.->|"must not be failed"| D
  subgraph D["deploy.yml"]
    direction TB
    RA["Render: verifier → API + goose migrate → Workflows (Node) → web"] --> SM[smoke + warm-up] --> TAG[release summary]
    RB[gov-tenant: build → cosign sign → attest → mirror to state registry] --> APPROVE{{GitHub Environment<br/>required reviewers}} --> HELM[helm upgrade --atomic<br/>self-hosted runner in state network]
  end
```

## 2. Stages and gates
All Go steps run in `services/api` with `actions/setup-go@v7` reading `go-version-file: services/api/go.mod` (`go 1.27.0`) and caching on `services/api/go.sum`. TS steps use `pnpm/action-setup@v4` (version from `packageManager`) and Node 22.

| # | Stage (job) | Tool, pinned | What it proves | Gate (fails the PR) | Typical time |
|---|---|---|---|---|---|
| 1 | `lint-ts` | Biome 2.6 (`pnpm biome check .`), ESLint (Next.js apps only), `tsc --noEmit` (strict, every workspace incl. `services/workflows`), `scripts/ci/check-wording.mjs` | Code style; **13 CCPA dark patterns banned by lint** (F-26); no hard-coded ₹ string in UI, prompts, n8n templates (D-06); no banned words "official", "first", "DPDP-compliant", "integrated with Sarathi", "lives saved", "Saarthi", "STQC-certified", "verified licence", "safe" as a scam verdict (D-19) | any error or warning (`--max-warnings=0`) | 2–3 min |
| 2 | `lint-go` | `go mod tidy` diff, `gofmt -l`, `go vet`, `go generate` drift (oapi-codegen v2.8.0 + sqlc v1.31.1), golangci-lint v2.15.0 (`services/api/.golangci.yml`), govulncheck v1.9.0 | Go formatting, vet, lint (incl. `depguard` import boundaries: pure packages never import `net/http`, pgx, chi, ADK or genai); the committed generated code (`services/api/api/` from `api/openapi.yaml`, `internal/store/sqlcgen`) matches its sources; no reachable known vulnerability | any finding; any diff after `go generate` or `go mod tidy` | 2–3 min |
| 3 | `unit-ts` | Vitest 5 + `@vitest/coverage-v8` | `@margdarshak/game-core` scoring, `@margdarshak/rules` evaluation, UI components, Workflows tasks with `@renderinc/sdk` mocked | coverage: game-core ≥ 90 % lines, rules ≥ 95 %, ui ≥ 70 % | 2–4 min |
| 4 | `unit-go` | `go test -short -race -count=1 -coverprofile` (testify v1.12.1) | domain, rules engine, journey state machine, case clock, PII redactor, handlers on fakes, ADK agents with a stubbed model, JobRunner port with the inline runner; `-short` skips the embedded-Postgres tests | any failure or race; coverage: `internal/domain`, `internal/journey`, `internal/clock` ≥ 90 %, `internal/rules` ≥ 95 % | 2–3 min |
| 5 | `golden-rules` | `go test ./internal/rules/ -run Golden` + `pnpm --filter @margdarshak/rules test:golden` (`node --test --experimental-strip-types`) on one fixture set (`tests/golden/rules/*.json`) | (a) every rule row has `source`, `verified_on`, `confidence` (D-05; `TestRulepackSchema`, `TestRulepackProvenance`); (b) **fee maths**: one class = LL ₹150 + LL test ₹50 + DL test ₹300 + DL ₹200 = **₹700**, card **₹200**, second class ≈ **+₹450** (CMVR r.32, `fees.json`, integer paise); (c) eligibility per class incl. EC-05 (16–17 → MC50CC only), EC-06 (transport < 20), EC-21; (d) timelines: LL 6 months, 30-day wait, 7-day retest (EC-08), EC-07, EC-16 renewal > 1 year late ⇒ retest; (e) EC-27 rule-pack change re-evaluates open cases; (f) the Go engine (authoritative) and the TS mirror write outputs to `tests/golden/rules/.out/{go,ts}` and these are **byte-identical JSON** | any mismatch; any row older than 120 days without re-verification | 2 min |
| 6 | `adapter-contracts` | `go test ./internal/adapters/... -run Contract`, matrix of 7 adapters (`CONTRACT_ADAPTER`, `CONTRACT_IMPLS=mock,deeplink`) | Sarathi, DigiLocker, Aadhaar-offline, Bhashini, Payment, Notification and Slot adapters: mock and deeplink pass the **same** suite a real adapter must pass (F-56, 07 §B1). DTO guard `TestNoForbiddenFields` (reflection over every adapter DTO): no field named or shaped like an Aadhaar number, OTP, biometric or face-match (D-07) | any failed contract; any forbidden field | 1–2 min |
| 7 | `game-determinism` | Vitest + `services/score-verifier` CLI | Golden sessions (Nazar, Junction Scan, Stopping Distance, Blind Spot, Track Twin, LL simulator) replay to the **same SHA-256** of `SessionResult` on client build and verifier, with rendering at 60 and 30 fps; anti-cheat: spam taps penalised, pattern clicking scores 0 (Kerala format, F-23), device clock skew ignored (EC-15), buffering uses `video.currentTime` (EC-18) | hash mismatch; anti-cheat case passes when it should fail | 2 min |
| 8 | `api-integration` | embedded-postgres v1.34.0 (Postgres 16, in-process), Valkey 8 service container, goose v3.29.0, oasdiff v1.11 | goose migrations up → down 1 → up on a throwaway database (`TestMigrationsUpDownUp`); expand/contract lint on new `migrations/*.sql` (no `DROP TABLE/COLUMN` or `RENAME` in the same release); full `go test -race ./...` incl. integration: HMAC on `/internal/*`, idempotency keys, Live Intel k ≥ 5 (D-14), Postgres RLS per tenant, family-mode parental consent (D-13 revised); **no breaking OpenAPI change** vs `main`. Contract-first: handlers are generated from `api/openapi.yaml`, so "spec equals code" is enforced by the codegen drift check in `lint-go` | any failure; breaking OpenAPI change without a `/v2` | 4–6 min |
| 9 | `build-web` | `next build` (Next.js 16), `scripts/ci/check-bundle-budget.mjs` | The PWA builds; **Lite route first load < 300 KB gzip** (F-51); per-game chunk ≤ 350 KB gzip (08 §1.3) | budget exceeded | 3–5 min |
| 10 | `e2e` (matrix: `mobile-chrome-lowend`, `desktop-chrome`) | Playwright 1.64 + `@axe-core/playwright` 4.14 on `infra/docker/compose.yaml` (goose `migrate` job, then `/app/seed --profile demo --synthetic`) | Journeys S0–S9 on mocks; the three deep slices (plan → LL application → check answers; Nazar + debrief; stage-aware home + case clock); EC screens (EC-09 payment pending, EC-11 Sarathi outage banner, EC-14 helper "clear device", EC-20 Aadhaar redaction, EC-29 AI down ⇒ template card); the non-affiliation footer on every page (D-01); axe on every visited page (`wcag2a`, `wcag2aa`, `wcag21aa`); low-end profile throttled to slow-3G | any failed test; **any serious or critical axe violation** | 8–12 min |
| 11 | `docker-smoke` | hadolint 2.12, Buildx | The three images build (api = Go multi-stage → distroless static), run as uid 10001, pass Dockerfile lint. Runs on PRs that touch `infra/docker/**` or `services/api/**`, and always on `main` | any failure | 3–6 min (cached) |
| — | `ci-gate` | shell | aggregates 1–11 | any `failure`/`cancelled` | < 10 s |

**Target wall-clock for a PR: ≤ 15 minutes** (parallel jobs, Go module + build cache via setup-go, embedded-Postgres binary cache, pnpm cache, Buildx GHA cache).

### 2.1 AI evals gate (`evals.yml`)
Runs on PRs touching `ai/**`, `services/api/internal/adapters/ai/**`, `services/api/internal/privacy/**` or `rulepacks/**`, on push to `main` for AI paths, and nightly at 02:00 IST.

ADK for Go (`google.golang.org/adk` v1.9.0) has no `adk eval` CLI, so the evals are a Go test harness behind the `evals` build tag: `go test -tags evals -count=1 ./internal/adapters/ai/evals/...`. It reads the JSONL suites in `ai/evals/` (`EVAL_SUITE_DIR`), runs each agent through an ADK `runner.Runner` (`EVAL_MODE=model`) or only the deterministic layers (`EVAL_MODE=offline`), applies the thresholds in `ai/evals/thresholds.yaml`, compares with the `origin/main` baseline and writes `.ci/evals/<agent>.summary.json`.

| Job | Model? | Checks | Gate |
|---|---|---|---|
| `offline-guardrails` | no | eval sets well-formed with ≥ 30 cases per agent (D-10, `TestEvalSetsWellFormed`); the validator rejects digits outside `{{fact:*}}`, unknown finding/rule/drill IDs and `verified:false` rules (08 §5.5); every `finding_id × locale` has a template (08 §5.6, EC-29); PII redaction of Aadhaar-like numbers (Verhoeff), OTPs, phones and UPI IDs before any model call (EC-20); a request without the purpose consent, or a family-mode minor's case without the parent's recorded consent, never reaches a model (D-13 revised: AI is for every user, consent is what is checked) | 100 % |
| `model-evals` (debrief M-02, coach M-03, tutor M-04, screen decoder M-05) | Gemini paid tier, eval project | `TestAgentEvals/<agent>`: hallucination and safety rubrics plus Margdarshak metrics (provenance, rule-ID precision, top-finding coverage, fallback, cost) | schema-valid 100 %; **invented numbers 0**; rule-ID precision ≥ 95 %; top-finding coverage 100 %; hallucination flags 0; safety 0; fallback < 5 %; no metric regresses > 2 points vs `main`; spend ≤ ₹150 per run |
| `nightly-multimodal` | yes | clip-window proposer (M-06) vs two-rater gold windows ±1 s (`TestClipWindows`); sign snap (M-07) top-1 ≥ 0.90 (`TestSignSnap`); model-ID drift (pinned model still listed and not legacy, `TestModelDrift`, warn only) | report + alert on regression |
| `report` | — | posts a PR comment table: cases, schema, invented numbers, rule-ID precision, fallback, ₹ spent, PASS/FAIL | — |

Fork PRs never get the Gemini key. A maintainer adds the `run-evals` label to run the model job. `deploy.yml` refuses a commit whose `evals` run **failed** (an absent run, because no AI path changed, is allowed).

### 2.2 Security scans (`security.yml`)
| Scan | Tool and version | Scope | Fails on |
|---|---|---|---|
| Secrets | gitleaks v8.28 (CLI in Docker) | PR diff; **full history** weekly | any finding |
| Go deps | govulncheck v1.9.0 (Go vulnerability database, call-graph reachability) | `services/api` modules + standard library | any reachable known vulnerability |
| Go licences | go-licenses v2.0.1 `check --disallowed_types=forbidden,restricted` | `services/api` dependency graph | AGPL/SSPL/BUSL-class licences |
| Node deps | `pnpm audit --prod --audit-level high` | prod deps (apps, packages, score verifier, workflows tasks) | high/critical |
| Licences | license-checker-rseidelsohn 4.4 + `dependency-review-action` | shipped deps | AGPL-3.0, SSPL-1.0, BUSL-1.1 (we ship Apache-2.0, 07 §B5) |
| SAST | CodeQL `security-extended` for `go` (autobuild), `javascript-typescript`, `actions` | whole repo | alerts triaged in code scanning; high blocks merge via ruleset |
| IaC / config | Trivy v0.67 `config` | Dockerfiles, `render.yaml`, `compose.yaml`, Helm (rendered in Phase 3) | HIGH/CRITICAL |
| Images | Trivy `image` (OS + library, ignore-unfixed; reads Go module info embedded in the API binary) | api, web, score-verifier | HIGH/CRITICAL |
| SBOM | Trivy CycloneDX | each image | artefact kept 90 days for the **STQC / CERT-In pre-audit pack** (D-18) |
| DAST | OWASP ZAP baseline v0.14 (passive) | staging web URL, weekly | report-only; triaged weekly |

## 3. Environments
| Env | Purpose | Where | Data | Adapters | AI | Deploy trigger | Protection |
|---|---|---|---|---|---|---|---|
| **dev** | each developer's machine | No Docker required: `go run ./cmd/api` in `services/api` against a local or embedded Postgres 16 + `pnpm dev` for the web (see ENVIRONMENT_SETUP). Optional: `docker compose -f infra/docker/compose.yaml up`; `render workflows dev -- <start command>` in `services/workflows` for real task runs on :8120 | synthetic seed (`go run ./cmd/seed --profile demo --synthetic`) | mock | `template` by default; `live` with a personal paid key | manual | none |
| **ci** | ephemeral | GitHub-hosted `ubuntu-24.04` runners | synthetic fixtures | mock, deeplink | `template` (evals.yml uses the eval key) | every PR | — |
| **staging** | rehearsal of the demo and of migrations | Render, Singapore, separate services suffixed `-staging` (second Blueprint, `infra/render.staging.yaml`, created at H0) | synthetic | mock | live (paid tier, low quota) | `deploy.yml` → `render-staging` (manual) | GitHub Environment `staging` |
| **hackathon-prod** | the judged live URL | Render, Singapore (`infra/render.yaml`) | **synthetic only** + consented field-study rows (pseudonymous; a learner under 18 only inside a parent's account with parental consent, D-13 revised, D-22) | mock (Sarathi Mode A hand-off) | live, paid tier | automatic after `ci` passes on `main` | Environment `hackathon-prod`; deploy freeze 60 min before judging (RUNBOOK §8) |
| **state-tenant** (`prod-gov-<tenant>`, e.g. `prod-gov-jk`) | a State Transport Department's production | Kubernetes on MeghRaj/NIC or a MeitY-empanelled CSP, India region (Helm, `infra/helm/`) | real citizens under the state's DPDP notice | per tenant: `sarathi=deeplink→real`, `digilocker=real`, `payment=sarathi-redirect`, `notification=mgov` | Vertex AI in an Indian region [unverified], per-tenant kill switch | `deploy.yml` → `gov-tenant`, **release tag vX.Y.Z only** | Environment with **required reviewers** (state nodal officer + Nestiq ops lead), self-hosted runner inside the state network, images cosign-verified |

Promotion path: `dev → ci → staging → hackathon-prod`. For government: `vX.Y.Z tag → staging (state UAT namespace) → prod-gov-<tenant>`, the same image digests moving forward; nothing is rebuilt between environments.

## 4. Secrets handling
| Secret | Lives in | Used by | Rotation |
|---|---|---|---|
| `RENDER_API_KEY` | GitHub Environment secret (`hackathon-prod`, `staging`) and Render env (`sync: false`) | deploy.yml (trigger deploys); the Go API's Render Workflows JobRunner (`POST https://api.render.com/v1/task-runs` with `Authorization: Bearer`) | after the event; on any leak |
| `GEMINI_API_KEY` (prod) / `GEMINI_API_KEY_EVALS` | Render env / GitHub Environment `ai-evals` | API (ADK for Go + `google.golang.org/genai`), Workflows tasks / evals.yml | 90 days; separate projects so an eval leak can't spend prod quota |
| `N8N_HMAC_SECRET` ⇄ n8n Variable `MD_HMAC_SECRET` | Render env + n8n Variables | backend ⇄ n8n signing; Workflows tasks → API job steps | after the event |
| `CONTACT_ENCRYPTION_KEY` (E-14) | Render env; production: state KMS via External Secrets | API | yearly + envelope re-encryption |
| `SESSION_SIGNING_KEY`, `NEXTAUTH_SECRET`, `VERIFIER_SHARED_SECRET` | `generateValue: true` in render.yaml | API, web, verifier | redeploy regenerates only if the key is deleted |
| R2 keys | Render env | API, Workflows | after the event |
| `TENANT_KUBECONFIG_B64`, `STATE_REGISTRY_*` | GitHub Environment `prod-gov-<tenant>` (reviewers required) | gov-deploy job | per state policy; short-lived service-account tokens |

Rules:
- No secret in the repo, ever. gitleaks runs on every PR and on full history weekly.
- `.env.example` lists every variable with a comment and no values.
- Workflows use `permissions: contents: read` by default and widen per job (`security-events: write` for SARIF, `id-token: write` only for cosign).
- `pull_request` from forks gets no secrets; `pull_request_target` is **never** used.
- Third-party actions are tagged here for readability and **pinned to full commit SHAs at H0** with Dependabot (`github-actions` ecosystem) proposing bumps.

## 5. Preview deploys
- **Render preview environments are off** (`previews.generation: off`). Render Workflows are **not supported in preview environments** (B-sponsors §1), and the journey needs the Workflows path.
- Instead: each PR gets (a) the Playwright HTML report and axe results as artefacts; (b) on request (`/preview` label, Phase 3), a temporary namespace on the staging cluster.
- For the hackathon, **staging is the preview**: deploy a branch with `workflow_dispatch → render-staging, ref=<branch>`.

## 6. Rollback
| Situation | Action | Time |
|---|---|---|
| Bad web/API deploy on Render | Render dashboard → service → **Events → Rollback** to the last live deploy; or re-run `deploy.yml` with `ref=<previous sha>` | 1–3 min |
| Bad migration | Migrations are expand/contract, so the previous code still runs on the expanded schema. Roll back the code first, then `/app/api migrate down` (goose, one step) only if the migration's `-- +goose Down` is marked reversible and no contract step ran | 5–10 min |
| Bad rule pack (wrong fee or rule) | Rule packs are **data**: switch the tenant's `rulepack_version` to the previous signed version in the rule-pack studio (F-42), no deploy needed; RUNBOOK PB-04 | < 5 min |
| Bad prompt / model ID | env var `GEMINI_MODEL_*` back to the previous value, or flag `ai_debrief=off` ⇒ template cards (EC-29) | < 2 min |
| Bad n8n workflow | n8n keeps workflow versions; deactivate and restore the previous version; the backend outbox keeps undelivered messages | < 5 min |
| State tenant (Helm) | `--atomic` already rolls back a failed upgrade; otherwise `helm rollback margdarshak <rev> -n margdarshak-<tenant>` | 2–5 min |

## 7. Release process (summary; full in DEPLOYMENT.md §7)
- Conventional Commits; `release-please` (Phase 3) writes `CHANGELOG.md` and tags `vX.Y.Z`.
- Hackathon: every green `main` commit deploys.
- Government: only tags, with a change ticket that links the CI run, the evals summary, the SBOMs, the Trivy reports and the rule-pack diff.

## 8. Supply-chain hardening checklist
- [ ] Pin every `uses:` to a commit SHA (H0, owner Ops lead, 2026-10-24); Dependabot for `github-actions`, `gomod` (`services/api`), `npm`, `docker`.
- [ ] Pin base images by digest in the Dockerfiles once the first green build lands (`golang:1.27-bookworm` build stage, `gcr.io/distroless/static-debian12` runtime for the API).
- [ ] `--frozen-lockfile` (pnpm) everywhere; Go: `go.sum` committed, `GOFLAGS=-mod=readonly` in builds, `go mod tidy` diff checked in `lint-go`, checksum database on (`GONOSUMDB` empty); tools run as `go run module@vX.Y.Z` (exact versions, never `@latest`).
- [ ] cosign keyless signing + `actions/attest-build-provenance` for government images; `cosign verify` before mirroring into a state registry.
- [ ] Branch protection on `main`: `ci-gate` required, 1 review, linear history, no force-push.
- [ ] CODEOWNERS: `rulepacks/**` → rules owner + a second reviewer (maker-checker mirrors F-42); `ai/prompts/**` → AI lead; `.github/**`, `infra/**` → Ops lead.

## 9. Scripts and tests referenced by the workflows (built in Phase 1, see BACKLOG)
| Script / test | Purpose |
|---|---|
| `scripts/ci/check-wording.mjs` | banned words (D-19) and rupee literals (D-06) in UI strings, prompts, n8n JSON and rule-pack copy. Context-aware: "first" is banned only as a claim ("first-ever", "India's first"); an allow-list covers "first name", "first load", "first-launch disclaimer"; "safe" is banned only in scam-verdict strings; "official" is allowed only inside quoted source titles in rule rows. Rupee amounts may appear only in `fees.json` / rule packs |
| `scripts/ci/check-bundle-budget.mjs` | Lite < 300 KB, game chunk ≤ 350 KB (gzip) |
| `scripts/ci/diff-golden.mjs` | Go vs TS golden output parity (`tests/golden/rules/.out/go` vs `.out/ts`) |
| `scripts/ci/axe-gate.mjs` | aggregate axe JSON; fail on serious/critical |
| `go generate ./...` (in `services/api`) | oapi-codegen v2.8.0 (`chi-server` + `strict-server` + models from `api/openapi.yaml` into `services/api/api/`) and sqlc v1.31.1 (`internal/store/sqlcgen`); CI fails on any diff |
| `internal/rules`: `TestRulepackSchema`, `TestRulepackProvenance`, `TestGolden*` | rule-pack JSON Schema + provenance + staleness (`RULEPACK_MAX_VERIFICATION_AGE_DAYS`); golden fixtures from `GOLDEN_DIR`, outputs to `GOLDEN_OUT` |
| `internal/adapters`: `TestContract*`, `TestNoForbiddenFields` | contract suites per adapter (`CONTRACT_ADAPTER`, `CONTRACT_IMPLS`); forbidden identity fields in adapter DTOs (D-07) |
| `migrations`: `TestMigrationsUpDownUp` | goose up → down 1 → up on embedded Postgres 16 |
| inline shell in `ci.yml` (`api-integration`) | expand/contract lint on new goose SQL files |
| `internal/adapters/ai/evals` (build tag `evals`): `TestEvalSetsWellFormed`, `TestAgentEvals`, `TestClipWindows`, `TestSignSnap`, `TestModelDrift` | AI eval gates (env `EVAL_SUITE_DIR`, `EVAL_MODE`, `EVAL_AGENT`, `EVAL_THRESHOLDS`, `EVAL_MAX_INR`, `EVAL_OUT`) |
| `services/score-verifier/dist/cli/replay.js` | replay golden sessions and compare hashes |
| `/app/api migrate up` and `/app/seed` (in the API image) | goose migrations (Render `preDeployCommand`, compose `migrate` job, Helm pre-upgrade Job); synthetic demo seed |

## 10. Validation of these files (done 2026-10-23)
- **actionlint v1.7.12** (`go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12`, built with go1.27.0) reports **0 errors** on all four workflows after the Go migration. shellcheck and pyflakes were not installed, so the shell-script checks inside `run:` blocks were skipped; re-run with shellcheck at H0.
- Every `needs:` points at an existing job (actionlint checks this); `ci-gate` lists all 11 required jobs.
- Versions used in the files were checked on 2026-10-23: golangci-lint v2.15.0, govulncheck (`golang.org/x/vuln`) v1.9.0 and go-licenses v2.0.1 on proxy.golang.org; `actions/setup-go` v7.0.0 and `golangci/golangci-lint-action` v9.3.0 are the latest GitHub releases.
- `render.yaml` follows the field list on https://render.com/docs/blueprint-spec (fetched 2026-10-23). One field is [unverified]: `startCommand` on a `workflow` service (owner Ops lead; check with `render blueprint validate` at H0).
- The tests, test names and env variables in §9 are a **contract the Go code must meet**. Caution: `go test -run X` with no matching test exits 0 ("no tests to run"), so a missing test is **not** caught by CI. The owners (BE-platform, RULES, AI) add them in P0/P1 and the Ops lead checks the `-v` logs for the expected test names (tracked in BACKLOG). Steps that depend on packages that do not exist yet (`./migrations/...`, `./internal/adapters/ai/evals/...`) fail with "no Go files" until they are created.

## Appendix A: the workflow files, inline
These copies are generated from `.github/workflows/*.yml` and `infra/render.yaml` on 2026-10-23 (regenerated after the Go switch, ADR-0011). **The files in the repo win** if they ever differ.

### `.github/workflows/ci.yml`
```yaml
# Margdarshak CI: every PR and every push to main.
# Stages: lint -> typecheck -> unit -> golden rules -> adapter contracts -> game determinism
#         -> API integration (embedded Postgres 16 + goose migrations + OpenAPI diff)
#         -> web build + Lite budget -> e2e (Playwright) + axe -> docker build smoke
#         -> ci-gate (the single required check)
# Languages: Go 1.27 for services/api (ADR-0011); TypeScript for apps/*, packages/*,
# services/score-verifier and services/workflows (Render Workflows tasks, @renderinc/sdk).
# AI evals live in evals.yml, security scans in security.yml, deploys in deploy.yml.
# Spec: docs/05-ops/CICD.md. Action versions are tags; pin to commit SHAs at H0 (CICD.md §8).
name: ci

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "22"
  GOLANGCI_LINT_VERSION: "v2.15.0"
  GOVULNCHECK_VERSION: "v1.9.0"
  TZ: UTC
  # CI never talks to Gemini, n8n, Render or any government system; all adapters are mocks.
  AI_MODE: template
  ADAPTER_SARATHI: mock
  ADAPTER_DIGILOCKER: mock
  ADAPTER_PAYMENT: mock
  ADAPTER_BHASHINI: mock
  ADAPTER_NOTIFICATION: console
  ADAPTER_SLOT: mock
  JOB_RUNNER: inline
  DATA_CLASS: synthetic-only

jobs:
  changes:
    name: detect changes
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: read
    outputs:
      ts: ${{ steps.filter.outputs.ts }}
      go: ${{ steps.filter.outputs.go }}
      workflows: ${{ steps.filter.outputs.workflows }}
      rules: ${{ steps.filter.outputs.rules }}
      game: ${{ steps.filter.outputs.game }}
      web: ${{ steps.filter.outputs.web }}
      api: ${{ steps.filter.outputs.api }}
      docker: ${{ steps.filter.outputs.docker }}
    steps:
      - uses: actions/checkout@v4
      - id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            ts:
              - 'apps/**'
              - 'packages/**'
              - 'services/score-verifier/**'
              - 'services/workflows/**'
              - 'package.json'
              - 'pnpm-lock.yaml'
            go:
              - 'services/api/**'
              - 'tests/golden/**'
            workflows:
              - 'services/workflows/**'
            rules:
              - 'rulepacks/**'
              - 'packages/rules/**'
              - 'services/api/internal/rules/**'
              - 'tests/golden/rules/**'
            game:
              - 'packages/game-core/**'
              - 'services/score-verifier/**'
              - 'tests/golden/games/**'
            web:
              - 'apps/web/**'
              - 'packages/ui/**'
            api:
              - 'services/api/**'
              - 'api/openapi.yaml'
            docker:
              - 'infra/docker/**'

  # ---------------------------------------------------------------------------
  # 1. Lint + typecheck (TypeScript: apps, packages, score-verifier, workflows tasks)
  # ---------------------------------------------------------------------------
  lint-ts:
    name: lint + typecheck (ts)
    # Path filters are used only for docker-smoke: skipping a lint job would cascade-skip
    # the golden/contract/e2e jobs that depend on it, which is exactly what we must not skip.
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4   # pnpm version comes from "packageManager" in package.json
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Biome (lint + format, whole repo)
        run: pnpm biome check .
      - name: ESLint (Next.js apps only; no-dark-patterns + no-rupee-literal custom rules)
        run: pnpm -r --filter "./apps/**" --if-present lint --max-warnings=0
      - name: TypeScript (tsc --noEmit, strict; includes services/workflows once it exists)
        run: pnpm -r --if-present typecheck
      - name: Wording bans (D-19) + rupee literals (D-06) in UI strings, messages and prompts
        run: node scripts/ci/check-wording.mjs --paths apps packages ai/prompts n8n/workflows rulepacks --fail-on-match

  # ---------------------------------------------------------------------------
  # 2. Lint + vet + codegen drift + vulnerabilities (Go: services/api)
  # ---------------------------------------------------------------------------
  lint-go:
    name: lint + vet (go)
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    defaults:
      run:
        working-directory: services/api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: go mod tidy is clean
        run: |
          go mod tidy
          git diff --exit-code -- go.mod go.sum
      - name: gofmt (must print nothing)
        run: |
          out="$(gofmt -l .)"
          if [ -n "$out" ]; then echo "::error::gofmt needed on:"; echo "$out"; exit 1; fi
      - name: go vet
        run: go vet ./...
      - name: Codegen drift (oapi-codegen from api/openapi.yaml + sqlc; generated code is committed)
        run: |
          go generate ./...
          git diff --exit-code
      - name: golangci-lint
        uses: golangci/golangci-lint-action@v9
        with:
          version: ${{ env.GOLANGCI_LINT_VERSION }}
          working-directory: services/api
          args: --timeout=5m
      - name: govulncheck (reachable vulnerabilities in Go deps + stdlib)
        run: go run "golang.org/x/vuln/cmd/govulncheck@${GOVULNCHECK_VERSION}" ./...

  # ---------------------------------------------------------------------------
  # 3. Unit tests
  # ---------------------------------------------------------------------------
  unit-ts:
    name: unit (ts, vitest)
    needs: lint-ts
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Vitest with coverage (game-core >= 90 % lines, rules >= 95 %, ui >= 70 %; workflows tasks with @renderinc/sdk mocked)
        run: pnpm -r --if-present test -- --coverage --reporter=default --reporter=junit --outputFile=reports/junit.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: unit-ts-reports
          path: |
            **/reports/junit.xml
            **/coverage/coverage-summary.json
          retention-days: 14

  unit-go:
    name: unit (go test -short -race)
    needs: lint-go
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    defaults:
      run:
        working-directory: services/api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: go test (unit only; -short skips the embedded-Postgres integration tests)
        run: |
          mkdir -p reports
          set -o pipefail
          go test -short -race -count=1 -coverprofile=reports/coverage.out ./... 2>&1 | tee reports/unit.txt
      - name: Coverage gates (internal/domain, journey, clock >= 90 %; internal/rules >= 95 %; TESTING.md §10)
        run: |
          go tool cover -func=reports/coverage.out | tail -n 1
          check() {
            pkg="$1"; min="$2"
            pct=$(go tool cover -func=reports/coverage.out | grep "/internal/${pkg}/" | awk '{gsub("%","",$3); s+=$3; n++} END {if (n>0) printf "%.1f", s/n; else print "100"}')
            echo "internal/${pkg}: ${pct}% (min ${min}%)"
            if awk -v p="$pct" -v m="$min" 'BEGIN { exit !(p+0 < m+0) }'; then
              echo "::error::coverage of internal/${pkg} is ${pct}% (< ${min}%)"; return 1
            fi
          }
          check domain 90 && check journey 90 && check clock 90 && check rules 95
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: unit-go-reports
          path: services/api/reports/
          retention-days: 14

  # ---------------------------------------------------------------------------
  # 4. Golden rules tests: fees, eligibility, timelines, EC-01..EC-30
  #    The SAME JSON fixtures (tests/golden/rules) run against the Go engine and the TS mirror.
  # ---------------------------------------------------------------------------
  golden-rules:
    name: golden rules (fees, eligibility, EC-01..EC-30)
    needs: [unit-go, unit-ts]
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Rule-pack schema + provenance (every row has source, verified_on, confidence; D-05)
        working-directory: services/api
        env:
          RULEPACK_DIR: ${{ github.workspace }}/rulepacks
          RULEPACK_MAX_VERIFICATION_AGE_DAYS: "120"
        run: go test -count=1 ./internal/rules/ -run 'TestRulepackSchema|TestRulepackProvenance' -v
      - name: Golden fixtures, Go engine (authoritative)
        working-directory: services/api
        env:
          GOLDEN_DIR: ${{ github.workspace }}/tests/golden/rules
          GOLDEN_OUT: ${{ github.workspace }}/tests/golden/rules/.out/go
        run: go test -count=1 ./internal/rules/ -run Golden -v
      - name: Golden fixtures, TS mirror (parity; node --test --experimental-strip-types)
        env:
          GOLDEN_OUT: ${{ github.workspace }}/tests/golden/rules/.out/ts
        run: pnpm --filter @margdarshak/rules test:golden
      - name: Cross-engine parity diff (byte-equal JSON outputs)
        run: node scripts/ci/diff-golden.mjs tests/golden/rules/.out/go tests/golden/rules/.out/ts

  # ---------------------------------------------------------------------------
  # 5. Adapter contract tests (F-56): mock adapters must pass the same suite real ones will
  # ---------------------------------------------------------------------------
  adapter-contracts:
    name: adapter contracts (mock + deeplink)
    needs: unit-go
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        adapter: [sarathi, digilocker, aadhaaroffline, bhashini, payment, notification, slot]
    defaults:
      run:
        working-directory: services/api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: Contract suite for ${{ matrix.adapter }}
        env:
          CONTRACT_ADAPTER: ${{ matrix.adapter }}
          CONTRACT_IMPLS: mock,deeplink
        run: go test -count=1 ./internal/adapters/... -run Contract -v
      - name: Guard - no Aadhaar number / OTP / biometric field in any adapter DTO (D-07)
        run: go test -count=1 ./internal/adapters/ -run TestNoForbiddenFields -v

  # ---------------------------------------------------------------------------
  # 6. Game determinism: same seed + same events => identical SessionResult hash,
  #    on client build (vitest/node), score-verifier, at 60 Hz and simulated 30 fps render.
  # ---------------------------------------------------------------------------
  game-determinism:
    name: game determinism (replay golden)
    needs: unit-ts
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build game-core + score-verifier
        run: pnpm --filter "@margdarshak/score-verifier..." build
      - name: Replay golden sessions (Nazar, Junction Scan, Stopping Distance, Blind Spot, Track Twin, LL sim)
        run: pnpm --filter @margdarshak/game-core test:determinism -- --golden ../../tests/golden/games --render-fps 60,30
      - name: Verifier replay must match client hashes
        run: node services/score-verifier/dist/cli/replay.js --dir tests/golden/games --expect-hash-match
      - name: Anti-cheat cases (spam taps, pattern clicking = 0, clock skew EC-15, buffering EC-18)
        run: pnpm --filter @margdarshak/game-core test -- --run tests/anticheat

  # ---------------------------------------------------------------------------
  # 7. API integration: embedded Postgres 16 (real Postgres, no Docker service needed),
  #    goose migrations up/down/up, integration tests, OpenAPI breaking-change diff.
  # ---------------------------------------------------------------------------
  api-integration:
    name: api integration (embedded pg16, goose, openapi)
    needs: [unit-go]
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    services:
      kv:
        image: valkey/valkey:8-bookworm
        ports: ["6379:6379"]
    env:
      REDIS_URL: redis://localhost:6379/0
      N8N_HMAC_SECRET: ci-only-hmac
      CONTACT_ENCRYPTION_KEY: Y2ktb25seS1jb250YWN0LWtleS0zMi1ieXRlcy0tLS0=
      SESSION_SIGNING_KEY: ci-only-session
      RULEPACK_DIR: ${{ github.workspace }}/rulepacks
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: Cache embedded-postgres binaries (Postgres 16)
        uses: actions/cache@v4
        with:
          path: ~/.embedded-postgres-go
          key: embedded-pg16-${{ runner.os }}-${{ hashFiles('services/api/go.sum') }}
          restore-keys: embedded-pg16-${{ runner.os }}-
      - name: goose migrations up -> down 1 -> up on a throwaway embedded Postgres (reversibility)
        working-directory: services/api
        run: go test -count=1 ./migrations/... -run TestMigrationsUpDownUp -v
      - name: Expand/contract lint (no DROP/RENAME in the same release as code that stops using it)
        run: |
          git diff --name-only --diff-filter=AM origin/main...HEAD -- 'services/api/migrations/*.sql' > new_migrations.txt || true
          cat new_migrations.txt
          if [ -s new_migrations.txt ] && xargs grep -nEi '^[[:space:]]*(drop[[:space:]]+(table|column)|alter[[:space:]]+table[[:space:]]+[^[:space:]]+[[:space:]]+rename)' < new_migrations.txt; then
            echo "::error::Destructive DDL in a new migration: ship it as a separate contract release (DEPLOYMENT.md §6)"; exit 1
          fi
      - name: Integration tests on embedded Postgres 16 (HMAC on /internal/*, idempotency keys, k>=5 Live Intel, family-mode consent, RLS)
        working-directory: services/api
        run: |
          mkdir -p reports
          set -o pipefail
          go test -race -count=1 ./... 2>&1 | tee reports/integration.txt
      - name: OpenAPI breaking-change diff vs main (oasdiff)
        if: github.event_name == 'pull_request'
        run: |
          mkdir -p .ci
          git show origin/main:api/openapi.yaml > .ci/openapi.main.yaml || exit 0
          docker run --rm -v "$PWD:/w" -w /w tufin/oasdiff:v1.11.7 breaking .ci/openapi.main.yaml api/openapi.yaml --fail-on ERR
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: api-integration-reports
          path: services/api/reports/
          retention-days: 14

  # ---------------------------------------------------------------------------
  # 8. Web build + performance budget (Lite mode < 300 KB first load, F-51)
  # ---------------------------------------------------------------------------
  build-web:
    name: web build + Lite budget
    needs: lint-ts
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: actions/cache@v4
        with:
          path: apps/web/.next/cache
          key: next-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ hashFiles('apps/web/**/*.{ts,tsx}') }}
          restore-keys: next-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-
      - name: next build
        env:
          NEXT_PUBLIC_API_BASE_URL: http://localhost:8000
          NEXT_PUBLIC_BUILD_SHA: ${{ github.sha }}
        run: pnpm --filter "@margdarshak/web..." build
      - name: Bundle budgets (Lite route first load < 300 KB gzip; per-game chunk <= 350 KB gzip)
        run: node scripts/ci/check-bundle-budget.mjs --app apps/web --lite-max-kb 300 --game-chunk-max-kb 350
      - uses: actions/upload-artifact@v4
        with:
          name: web-build-stats
          path: apps/web/.next/analyze/
          if-no-files-found: ignore
          retention-days: 7

  # ---------------------------------------------------------------------------
  # 9. End-to-end (Playwright) + accessibility (axe-core, WCAG 2.1 AA) on the compose stack
  # ---------------------------------------------------------------------------
  e2e:
    name: e2e + axe (playwright)
    needs: [build-web, api-integration, golden-rules, adapter-contracts, game-determinism]
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        project: [mobile-chrome-lowend, desktop-chrome]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Start stack (mock adapters, AI_MODE=template, goose migrate job, synthetic seed)
        run: |
          docker compose -f infra/docker/compose.yaml up --build -d --wait api web
          docker compose -f infra/docker/compose.yaml run --rm api /app/seed --profile demo --synthetic
      - name: Install Playwright browsers
        run: pnpm --filter @margdarshak/e2e exec playwright install --with-deps chromium
      - name: Playwright (journeys S0-S9, three deep slices, EC screens) + axe on every page
        env:
          BASE_URL: http://localhost:3000
          API_URL: http://localhost:8000
          # 3G-ish throttling on the low-end project: 400 ms RTT, 400 kbps down (Lite mode budget)
          E2E_NETWORK_PROFILE: ${{ matrix.project == 'mobile-chrome-lowend' && 'slow-3g' || 'none' }}
        run: pnpm --filter @margdarshak/e2e exec playwright test --project=${{ matrix.project }} --reporter=html,junit
      - name: axe gate (0 serious/critical violations; wcag2a, wcag2aa, wcag21aa tags)
        run: node scripts/ci/axe-gate.mjs --report tests/e2e/axe-results --max-serious 0 --max-critical 0
      - name: Compose logs on failure
        if: failure()
        run: docker compose -f infra/docker/compose.yaml logs --no-color > compose-logs.txt
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-${{ matrix.project }}
          path: |
            tests/e2e/playwright-report/
            tests/e2e/axe-results/
            compose-logs.txt
          retention-days: 14

  # ---------------------------------------------------------------------------
  # 10. Docker build smoke (no push; deploy.yml builds + pushes signed images)
  # ---------------------------------------------------------------------------
  docker-smoke:
    name: docker build smoke
    needs: changes
    if: needs.changes.outputs.docker == 'true' || needs.changes.outputs.go == 'true' || github.event_name != 'pull_request'
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        image: [api, web, score-verifier]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Hadolint
        run: docker run --rm -i hadolint/hadolint:v2.12.0 hadolint --failure-threshold warning - < infra/docker/${{ matrix.image }}.Dockerfile
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/${{ matrix.image }}.Dockerfile
          push: false
          load: true
          tags: margdarshak-${{ matrix.image }}:ci
          cache-from: type=gha,scope=${{ matrix.image }}
          cache-to: type=gha,mode=max,scope=${{ matrix.image }}
      - name: Runs as non-root
        run: test "$(docker inspect --format '{{.Config.User}}' margdarshak-${{ matrix.image }}:ci)" = "10001:10001"

  # ---------------------------------------------------------------------------
  # Single required status check for branch protection (and for Render checksPass, if used)
  # ---------------------------------------------------------------------------
  ci-gate:
    name: ci-gate
    if: always()
    needs: [lint-ts, lint-go, unit-ts, unit-go, golden-rules, adapter-contracts, game-determinism, api-integration, build-web, e2e, docker-smoke]
    runs-on: ubuntu-24.04
    steps:
      - name: Fail if any required job failed or was cancelled (skipped by path filter is OK)
        run: |
          echo '${{ toJSON(needs) }}' > needs.json
          if grep -E '"result": "(failure|cancelled)"' needs.json; then
            echo "::error::A required CI job failed"; exit 1
          fi
          echo "All required CI jobs passed or were skipped by path filters."
```

### `.github/workflows/evals.yml`
```yaml
# Margdarshak AI evals gate (D-10): >= 30 cases per agent, run by the Go eval harness
# (`go test -tags evals ./internal/adapters/ai/evals/...`; ADK for Go has no `adk eval` CLI).
#   - offline job: validators, provenance guard, template fallback, PII redaction. No model, no secret.
#   - model job:   real Gemini (PAID tier key, D-13) for M-02..M-05 (+ M-06/M-07 nightly).
# Suites: ai/evals/*.jsonl (debrief_150, decoder_30, tutor_30, voice_nav_30, ...).
# Gates (from docs/04-ai/AI_EVALS.md and research 08 §5.9):
#   schema-valid after validator 100 % · invented numbers 0 · rule-ID precision >= 95 %
#   top-finding coverage 100 % · hallucinations_v1 flagged 0 · safety_v1 + banned-phrase 0
#   fallback rate in eval < 5 % · regression vs main baseline <= 2 pts on any rubric metric
# Fork PRs never receive the Gemini key: they run the offline job only, and a maintainer
# re-runs the model job with the `run-evals` label.
name: evals

on:
  pull_request:
    paths:
      - "ai/**"
      - "services/api/internal/adapters/ai/**"
      - "services/api/internal/privacy/**"
      - "rulepacks/**"
      - ".github/workflows/evals.yml"
    types: [opened, synchronize, reopened, labeled]
  push:
    branches: [main]
    paths:
      - "ai/**"
      - "services/api/internal/adapters/ai/**"
  schedule:
    - cron: "30 20 * * *"   # 02:00 IST nightly: full suite incl. vision/video agents + drift check
  workflow_dispatch:
    inputs:
      agents:
        description: "Comma-separated agents (debrief,coach,tutor,screen_decoder,clip_window,sign_snap,voice_text)"
        required: false
        default: "debrief,coach,tutor,screen_decoder"
      max_inr:
        description: "Hard spend cap for this run in INR"
        required: false
        default: "150"

permissions:
  contents: read

concurrency:
  group: evals-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  TZ: UTC
  EVAL_SUITE_DIR: ${{ github.workspace }}/ai/evals

jobs:
  # ---------------------------------------------------------------------------
  # Offline: deterministic guardrails. Always runs, needs no secrets.
  # ---------------------------------------------------------------------------
  offline-guardrails:
    name: guardrails (offline, no model)
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      AI_MODE: template
      EVAL_MODE: offline
    defaults:
      run:
        working-directory: services/api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: Eval sets are well-formed and big enough (>= 30 cases per agent)
        env:
          EVAL_MIN_CASES: "30"
        run: go test -tags evals -count=1 ./internal/adapters/ai/evals/... -run TestEvalSetsWellFormed -v
      - name: Validator rejects digits outside {{fact:*}}, unknown IDs, unverified rules (08 §5.5)
        run: go test -count=1 ./internal/adapters/ai/... -run 'Validator|Provenance' -v
      - name: Template fallback renders for every finding_id x locale (en, hi) (EC-29)
        run: go test -count=1 ./internal/adapters/ai/... -run TemplateFallback -v
      - name: PII redaction (Aadhaar-like 12 digits with Verhoeff, OTP, phone, UPI) before any model call (EC-20)
        run: go test -count=1 ./internal/privacy/... ./internal/adapters/ai/... -run 'Redact|EC20' -v
      - name: No consent / no parental consent for a family-mode minor case never reaches a model (D-13 revised)
        run: go test -count=1 ./internal/adapters/ai/... ./internal/privacy/... -run 'Consent|FamilyMode' -v
      - name: Offline eval pass (validators + guard + fallback over every suite, no model)
        run: go test -tags evals -count=1 ./internal/adapters/ai/evals/... -v
      - name: No rupee literal or banned wording in prompts (D-06, D-19)
        working-directory: .
        run: node scripts/ci/check-wording.mjs --paths ai/prompts --fail-on-match

  # ---------------------------------------------------------------------------
  # Model evals: real Gemini, paid tier. Skipped on fork PRs unless labelled.
  # ---------------------------------------------------------------------------
  model-evals:
    name: model evals (${{ matrix.agent }})
    needs: offline-guardrails
    if: >
      github.event_name != 'pull_request' ||
      github.event.pull_request.head.repo.full_name == github.repository ||
      contains(github.event.pull_request.labels.*.name, 'run-evals')
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    environment: ai-evals            # holds GEMINI_API_KEY_EVALS (paid project, low quota cap)
    strategy:
      fail-fast: false
      max-parallel: 2                # respect Gemini RPM on the eval project
      matrix:
        agent: [debrief, coach, tutor, screen_decoder]
    env:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY_EVALS }}
      GOOGLE_GENAI_USE_VERTEXAI: "false"
      GEMINI_MODEL_DEBRIEF: ${{ vars.GEMINI_MODEL_DEBRIEF || 'gemini-3.1-flash-lite' }}
      GEMINI_MODEL_VISION: ${{ vars.GEMINI_MODEL_VISION || 'gemini-3.8-flash' }}
      EVAL_MAX_INR: ${{ github.event.inputs.max_inr || '150' }}
      EVAL_MODE: model
      AI_MODE: live
    defaults:
      run:
        working-directory: services/api
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: Skip if the agent is not selected (workflow_dispatch)
        id: sel
        env:
          WANT: ${{ github.event.inputs.agents }}
          AGENT: ${{ matrix.agent }}
        run: |
          if [ -n "$WANT" ] && ! echo ",$WANT," | grep -q ",${AGENT},"; then
            echo "skip=true" >> "$GITHUB_OUTPUT"; else echo "skip=false" >> "$GITHUB_OUTPUT"; fi
      - name: Eval ${{ matrix.agent }} + Margdarshak gates (provenance, rule-ID precision, coverage, fallback, cost)
        if: steps.sel.outputs.skip == 'false'
        env:
          EVAL_AGENT: ${{ matrix.agent }}
          EVAL_THRESHOLDS: ${{ github.workspace }}/ai/evals/thresholds.yaml
          EVAL_BASELINE_REF: origin/main
          EVAL_MAX_REGRESSION_PTS: "2"
          EVAL_OUT: ${{ github.workspace }}/.ci/evals/${{ matrix.agent }}.summary.json
        run: |
          mkdir -p ../../.ci/evals
          set -o pipefail
          go test -tags evals -count=1 -timeout 25m ./internal/adapters/ai/evals/... -run "TestAgentEvals/${EVAL_AGENT}" -v \
            | tee "../../.ci/evals/${EVAL_AGENT}.log"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: evals-${{ matrix.agent }}
          path: .ci/evals/
          retention-days: 30

  nightly-multimodal:
    name: nightly multimodal evals (clip windows M-06, sign snap M-07)
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    needs: offline-guardrails
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    environment: ai-evals
    env:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY_EVALS }}
      GOOGLE_GENAI_USE_VERTEXAI: "false"
      GEMINI_MODEL_DEBRIEF: ${{ vars.GEMINI_MODEL_DEBRIEF || 'gemini-3.1-flash-lite' }}
      GEMINI_MODEL_VISION: ${{ vars.GEMINI_MODEL_VISION || 'gemini-3.8-flash' }}
      EVAL_MAX_INR: "300"
      EVAL_MODE: model
    defaults:
      run:
        working-directory: services/api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: Clip-window proposer vs two-rater gold windows (+-1 s tolerance)
        env:
          EVAL_TOLERANCE_S: "1.0"
        run: go test -tags evals -count=1 -timeout 30m ./internal/adapters/ai/evals/... -run TestClipWindows -v
      - name: Sign snap vs sign catalogue (top-1 accuracy >= 0.90, "unknown" allowed)
        env:
          EVAL_MIN_TOP1: "0.90"
        run: go test -tags evals -count=1 ./internal/adapters/ai/evals/... -run TestSignSnap -v
      - name: Model-ID drift check (pinned env models still listed, not legacy; warn only)
        env:
          EVAL_WARN_ONLY: "true"
        run: go test -tags evals -count=1 ./internal/adapters/ai/evals/... -run TestModelDrift -v

  report:
    name: eval summary
    if: always() && github.event_name == 'pull_request'
    needs: [offline-guardrails, model-evals]
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          pattern: evals-*
          path: evals
          merge-multiple: true
      - name: Comment summary on the PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const path = require('path');
            let rows = ['| agent | cases | schema | invented numbers | rule-ID precision | fallback | ₹ spent | gate |', '|---|---|---|---|---|---|---|---|'];
            if (fs.existsSync('evals')) {
              for (const f of fs.readdirSync('evals').filter(f => f.endsWith('.summary.json'))) {
                const s = JSON.parse(fs.readFileSync(path.join('evals', f), 'utf8'));
                rows.push(`| ${s.agent} | ${s.cases} | ${s.schema_valid_pct}% | ${s.invented_numbers} | ${s.rule_id_precision_pct}% | ${s.fallback_pct}% | ${s.spend_inr} | ${s.passed ? 'PASS' : 'FAIL'} |`);
              }
            }
            const body = `### AI evals (D-10)\n${rows.join('\n')}\n\nOffline guardrails: **${{ needs.offline-guardrails.result }}** · model evals: **${{ needs.model-evals.result }}**`;
            await github.rest.issues.createComment({ ...context.repo, issue_number: context.issue.number, body });
```

### `.github/workflows/security.yml`
```yaml
# Margdarshak security scans (secure SDLC; OWASP ASVS L2 evidence for the STQC/CERT-In pre-audit pack)
#   secrets:      gitleaks (full history on schedule, diff on PR)
#   deps:         govulncheck (Go api), pnpm audit (prod deps incl. services/workflows), GitHub dependency review
#   SAST:         CodeQL (go, javascript-typescript, actions)
#   containers:   Trivy image scan (api, web, score-verifier) + SBOM (CycloneDX via Trivy)
#   IaC/config:   Trivy config (Dockerfiles, render.yaml, Helm chart, compose)
#   DAST:         OWASP ZAP baseline against staging (schedule / manual only)
# Findings are uploaded as SARIF to GitHub code scanning. HIGH/CRITICAL fail the job.
name: security

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "0 21 * * 0"     # Mon 02:30 IST weekly full scan (history + DAST)
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: security-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "22"
  GOVULNCHECK_VERSION: "v1.9.0"
  TRIVY_VERSION: "v0.67.2"

jobs:
  gitleaks:
    name: secrets (gitleaks)
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # full history so a secret committed and removed is still caught
      - name: gitleaks (CLI, avoids the org-licence requirement of gitleaks-action for orgs)
        run: |
          docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.28.0 \
            git --redact --no-banner --exit-code 1 \
            --report-format sarif --report-path /repo/gitleaks.sarif \
            ${{ github.event_name == 'pull_request' && format('--log-opts={0}..{1}', github.event.pull_request.base.sha, github.sha) || '' }}
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: gitleaks.sarif
          category: gitleaks

  govulncheck:
    name: go deps (govulncheck)
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    defaults:
      run:
        working-directory: services/api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - name: govulncheck (Go vulnerability database; reachable symbols in deps + stdlib fail the job)
        run: go run "golang.org/x/vuln/cmd/govulncheck@${GOVULNCHECK_VERSION}" ./...
      - name: Licence allowlist for Go modules (Apache-2.0 compatible; no AGPL/SSPL/BUSL)
        run: |
          go run github.com/google/go-licenses/v2@v2.0.1 check ./... \
            --disallowed_types=forbidden,restricted --ignore github.com/sruj08/margadarshak

  pnpm-audit:
    name: node deps (pnpm audit)
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4   # pnpm version from "packageManager"
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
      - name: pnpm audit (production deps, high and above fail)
        run: pnpm audit --prod --audit-level high
      - name: Licence allowlist (Apache-2.0 compatible; no AGPL/SSPL in shipped deps)
        run: pnpm dlx license-checker-rseidelsohn@4.4.2 --production --excludePrivatePackages --failOn "AGPL-3.0;AGPL-3.0-only;AGPL-3.0-or-later;SSPL-1.0;BUSL-1.1"

  dependency-review:
    name: dependency review (PR)
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
          deny-licenses: AGPL-3.0, SSPL-1.0, BUSL-1.1
          comment-summary-in-pr: on-failure

  codeql:
    name: CodeQL (${{ matrix.language }})
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
      security-events: write
      actions: read
    strategy:
      fail-fast: false
      matrix:
        language: [go, javascript-typescript, actions]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v7
        if: matrix.language == 'go'
        with:
          go-version-file: services/api/go.mod
          cache-dependency-path: services/api/go.sum
      - uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          build-mode: ${{ matrix.language == 'go' && 'autobuild' || 'none' }}   # Go has no build-mode none
          queries: security-extended
      - uses: github/codeql-action/analyze@v3
        with:
          category: "/language:${{ matrix.language }}"

  trivy-config:
    name: IaC + config (trivy)
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@0.33.1
        with:
          version: ${{ env.TRIVY_VERSION }}
          scan-type: config
          scan-ref: .
          severity: HIGH,CRITICAL
          exit-code: "1"
          format: sarif
          output: trivy-config.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-config.sarif
          category: trivy-config

  trivy-image:
    name: image scan + SBOM (${{ matrix.image }})
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
      security-events: write
    strategy:
      fail-fast: false
      matrix:
        image: [api, web, score-verifier]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/${{ matrix.image }}.Dockerfile
          push: false
          load: true
          tags: margdarshak-${{ matrix.image }}:scan
          cache-from: type=gha,scope=${{ matrix.image }}
      - name: Trivy image (OS + language packages)
        uses: aquasecurity/trivy-action@0.33.1
        with:
          version: ${{ env.TRIVY_VERSION }}
          image-ref: margdarshak-${{ matrix.image }}:scan
          vuln-type: os,library
          ignore-unfixed: true
          severity: HIGH,CRITICAL
          exit-code: "1"
          format: sarif
          output: trivy-${{ matrix.image }}.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-${{ matrix.image }}.sarif
          category: trivy-image-${{ matrix.image }}
      - name: SBOM (CycloneDX) for the pre-audit pack
        uses: aquasecurity/trivy-action@0.33.1
        with:
          version: ${{ env.TRIVY_VERSION }}
          image-ref: margdarshak-${{ matrix.image }}:scan
          format: cyclonedx
          output: sbom-${{ matrix.image }}.cdx.json
          exit-code: "0"
      - uses: actions/upload-artifact@v4
        with:
          name: sbom-${{ matrix.image }}
          path: sbom-${{ matrix.image }}.cdx.json
          retention-days: 90

  zap-baseline:
    name: DAST (OWASP ZAP baseline, staging)
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - name: ZAP baseline against staging web + API (passive scan only, synthetic data)
        uses: zaproxy/action-baseline@v0.14.0
        with:
          target: ${{ vars.STAGING_WEB_URL }}
          rules_file_name: .zap/rules.tsv
          cmd_options: "-a -j"
          allow_issue_writing: true
          issue_title: "ZAP baseline findings (staging)"
          fail_action: false   # report-only; triaged weekly into SECURITY_ARCHITECTURE.md
```

### `.github/workflows/deploy.yml`
```yaml
# Margdarshak deploy pipeline (docs/05-ops/DEPLOYMENT.md)
#   Track A, hackathon (Render, Singapore, synthetic data):
#     main green on ci + evals -> trigger Render deploys (API first; its preDeployCommand runs
#     goose migrations via `/app/api migrate up`) -> wait for "live" -> smoke tests -> warm-up.
#   Services: api (Go 1.27, Docker, distroless), score-verifier (Node), workflows (Render
#     Workflows, Node runtime, TypeScript tasks with @renderinc/sdk), web (Next.js).
#   Track B, production for a state tenant (Docker + Helm on MeghRaj/NIC or a MeitY-empanelled
#     CSP, India region): build -> sign (cosign keyless) -> SBOM attest -> push to GHCR ->
#     mirror into the state registry -> helm upgrade --atomic from a self-hosted runner INSIDE the
#     state network, gated by a GitHub Environment with required reviewers (state + Nestiq).
# Environments (GitHub): hackathon-prod, staging, prod-gov-<tenant> (e.g. prod-gov-jk).
name: deploy

on:
  workflow_run:
    workflows: [ci]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      target:
        description: "Where to deploy"
        type: choice
        options: [render-hackathon, render-staging, gov-tenant]
        default: render-hackathon
      tenant:
        description: "State tenant id for gov-tenant (e.g. jk, kl)"
        required: false
        default: jk
      ref:
        description: "Git ref / tag to deploy (gov-tenant requires a vX.Y.Z tag)"
        required: false
        default: main

permissions:
  contents: read

concurrency:
  group: deploy-${{ github.event.inputs.target || 'render-hackathon' }}-${{ github.event.inputs.tenant || 'na' }}
  cancel-in-progress: false      # never cancel a deploy half-way

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ghcr.io/${{ github.repository_owner }}/margdarshak
  RENDER_API: https://api.render.com/v1

jobs:
  # ---------------------------------------------------------------------------
  # Gate: only deploy a commit whose ci run succeeded (workflow_run) or a manual dispatch.
  # ---------------------------------------------------------------------------
  gate:
    name: gate
    runs-on: ubuntu-24.04
    if: >
      github.event_name == 'workflow_dispatch' ||
      (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push')
    outputs:
      sha: ${{ steps.meta.outputs.sha }}
      target: ${{ steps.meta.outputs.target }}
    steps:
      - id: meta
        run: |
          if [ "${{ github.event_name }}" = "workflow_run" ]; then
            echo "sha=${{ github.event.workflow_run.head_sha }}" >> "$GITHUB_OUTPUT"
            echo "target=render-hackathon" >> "$GITHUB_OUTPUT"
          else
            echo "sha=${{ github.event.inputs.ref }}" >> "$GITHUB_OUTPUT"
            echo "target=${{ github.event.inputs.target }}" >> "$GITHUB_OUTPUT"
          fi
      - name: Require evals to be green on this commit (AI gate, D-10)
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          sha="${{ steps.meta.outputs.sha }}"
          # evals.yml only runs when AI paths change; absence of a run is OK, a failed run is not.
          concl=$(gh api "repos/${{ github.repository }}/actions/workflows/evals.yml/runs?head_sha=${sha}&per_page=1" --jq '.workflow_runs[0].conclusion // "none"' || echo none)
          echo "evals conclusion for ${sha}: ${concl}"
          if [ "$concl" = "failure" ]; then echo "::error::AI evals failed on ${sha}"; exit 1; fi

  # ---------------------------------------------------------------------------
  # Track A: Render (hackathon prod / staging)
  # ---------------------------------------------------------------------------
  render:
    name: render deploy (${{ needs.gate.outputs.target }})
    needs: gate
    if: startsWith(needs.gate.outputs.target, 'render-')
    runs-on: ubuntu-24.04
    timeout-minutes: 40
    environment:
      name: ${{ needs.gate.outputs.target == 'render-staging' && 'staging' || 'hackathon-prod' }}
      url: ${{ vars.WEB_URL }}
    env:
      RENDER_API_KEY: ${{ secrets.RENDER_API_KEY }}
      SVC_API: ${{ vars.RENDER_SERVICE_ID_API }}
      SVC_WEB: ${{ vars.RENDER_SERVICE_ID_WEB }}
      SVC_VERIFIER: ${{ vars.RENDER_SERVICE_ID_VERIFIER }}
      SVC_WORKFLOWS: ${{ vars.RENDER_SERVICE_ID_WORKFLOWS }}
      SHA: ${{ needs.gate.outputs.sha }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gate.outputs.sha }}
      - name: Helper - deploy a Render service at a commit and wait until live
        run: |
          cat > /tmp/render_deploy.sh <<'EOS'
          #!/usr/bin/env bash
          # usage: render_deploy.sh <service-id> <label>
          set -euo pipefail
          svc="$1"; label="$2"
          echo "Triggering ${label} (${svc}) at ${SHA}"
          dep=$(curl -fsS -X POST "${RENDER_API}/services/${svc}/deploys" \
                 -H "Authorization: Bearer ${RENDER_API_KEY}" -H "Content-Type: application/json" \
                 -d "{\"commitId\":\"${SHA}\",\"clearCache\":\"do_not_clear\"}")
          id=$(echo "$dep" | jq -r '.id')
          for i in $(seq 1 120); do
            st=$(curl -fsS "${RENDER_API}/services/${svc}/deploys/${id}" -H "Authorization: Bearer ${RENDER_API_KEY}" | jq -r '.status')
            echo "  ${label}: ${st}"
            case "$st" in
              live) exit 0 ;;
              build_failed|update_failed|canceled|pre_deploy_failed|deactivated) echo "::error::${label} deploy ${id} ended ${st}"; exit 1 ;;
            esac
            sleep 10
          done
          echo "::error::${label} deploy timed out"; exit 1
          EOS
          chmod +x /tmp/render_deploy.sh
      # Order matters for zero downtime (expand/contract migrations, DEPLOYMENT.md §6):
      # 1) score-verifier (backward compatible replays) 2) API (runs goose migrations in preDeployCommand)
      # 3) workflows (TS tasks call the new API job steps) 4) web (calls the new API).
      - name: Deploy score-verifier
        run: /tmp/render_deploy.sh "$SVC_VERIFIER" score-verifier
      - name: Deploy API (+ goose migrate up via preDeployCommand /app/api migrate up)
        run: /tmp/render_deploy.sh "$SVC_API" api
      - name: Deploy Render Workflows service (Node runtime, TypeScript tasks)
        # [unverified, owner Ops lead, H0] that POST /services/{id}/deploys accepts a workflow
        # service id. Fallback: `render workflows` CLI or autoDeployTrigger: checksPass on it.
        run: /tmp/render_deploy.sh "$SVC_WORKFLOWS" workflows
      - name: Deploy web
        run: /tmp/render_deploy.sh "$SVC_WEB" web
      - name: Smoke tests
        env:
          WEB_URL: ${{ vars.WEB_URL }}
          API_URL: ${{ vars.API_URL }}
        run: |
          set -euo pipefail
          curl -fsS "${API_URL}/v1/health" | tee /tmp/health.json
          jq -e '.status == "ok" and .db == "ok" and .kv == "ok"' /tmp/health.json
          jq -e --arg sha "$SHA" '.build_sha == $sha' /tmp/health.json
          # API-01: 3-tap plan, no auth. Fee total must come from fees.json (one class LL+test+DL test+DL = 700, card 200)
          curl -fsS -X POST "${API_URL}/v1/plans" -H 'Content-Type: application/json' \
            -d '{"dob":"2007-05-01","vehicles":["MCWG"],"state":"JK"}' | tee /tmp/plan.json
          jq -e '.fees.total_without_card.amount_inr == 700 and .fees.smart_card.amount_inr == 200' /tmp/plan.json
          curl -fsS "${WEB_URL}/" -o /tmp/home.html
          grep -q "Not affiliated with MoRTH" /tmp/home.html
          curl -fsS "${API_URL}/v1/stats/public" > /dev/null
      - name: Workflows smoke (start a no-op task and wait for it)
        env:
          API_URL: ${{ vars.API_URL }}
          OPS_TOKEN: ${{ secrets.OPS_SMOKE_TOKEN }}
        run: |
          curl -fsS -X POST "${API_URL}/internal/ops/smoke-task" -H "Authorization: Bearer ${OPS_TOKEN}" | tee /tmp/task.json
          jq -e '.status == "completed"' /tmp/task.json
      - name: Warm-up (avoid cold paths before judging, R-11)
        env:
          WEB_URL: ${{ vars.WEB_URL }}
          API_URL: ${{ vars.API_URL }}
        run: |
          for p in / /plan /practice/nazar /learn /track /lite; do curl -fsS -o /dev/null -w "%{http_code} %{time_total}s ${p}\n" "${WEB_URL}${p}" || true; done
          for p in /v1/health /v1/rules/JK/classes /v1/rules/JK/fees /v1/nazar/clips; do curl -fsS -o /dev/null -w "%{http_code} %{time_total}s ${p}\n" "${API_URL}${p}" || true; done
      - name: Record the release
        if: success()
        run: |
          echo "### Deployed ${SHA} to ${{ needs.gate.outputs.target }}" >> "$GITHUB_STEP_SUMMARY"
          echo "Rollback: Render dashboard -> service -> Events -> 'Rollback' on the previous live deploy (or re-run this workflow with ref=<previous sha>)." >> "$GITHUB_STEP_SUMMARY"

  # ---------------------------------------------------------------------------
  # Track B: production for a state tenant
  # ---------------------------------------------------------------------------
  images:
    name: build + sign images
    needs: gate
    if: needs.gate.outputs.target == 'gov-tenant'
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    permissions:
      contents: read
      packages: write
      id-token: write          # cosign keyless (Sigstore OIDC)
      attestations: write
    strategy:
      fail-fast: true
      matrix:
        image: [api, web, score-verifier]
    outputs:
      digest-api: ${{ steps.out.outputs.digest-api }}
      digest-web: ${{ steps.out.outputs.digest-web }}
      digest-score-verifier: ${{ steps.out.outputs.digest-score-verifier }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gate.outputs.sha }}
      - name: Require a release tag for government deploys
        run: |
          git fetch --tags --force
          git describe --exact-match --tags HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || { echo "::error::gov-tenant deploys need a vX.Y.Z tag"; exit 1; }
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_PREFIX }}-${{ matrix.image }}
          tags: |
            type=sha,format=long
            type=semver,pattern={{version}}
      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/${{ matrix.image }}.Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: mode=max
          sbom: true
          cache-from: type=gha,scope=${{ matrix.image }}
          cache-to: type=gha,mode=max,scope=${{ matrix.image }}
          build-args: |
            NEXT_PUBLIC_BUILD_SHA=${{ needs.gate.outputs.sha }}
      - uses: sigstore/cosign-installer@v3
      - name: Sign image (keyless)
        run: cosign sign --yes "${{ env.IMAGE_PREFIX }}-${{ matrix.image }}@${{ steps.build.outputs.digest }}"
      - uses: actions/attest-build-provenance@v2
        with:
          subject-name: ${{ env.IMAGE_PREFIX }}-${{ matrix.image }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
      - id: out
        run: echo "digest-${{ matrix.image }}=${{ steps.build.outputs.digest }}" >> "$GITHUB_OUTPUT"

  gov-deploy:
    name: helm deploy (tenant ${{ github.event.inputs.tenant }})
    needs: [gate, images]
    if: needs.gate.outputs.target == 'gov-tenant'
    # Self-hosted runner inside the state's network segment: the cluster API is never exposed
    # to the internet. Label convention: md-<tenant>.
    runs-on: [self-hosted, linux, "md-${{ github.event.inputs.tenant }}"]
    timeout-minutes: 60
    environment:
      name: prod-gov-${{ github.event.inputs.tenant }}     # required reviewers: state nodal officer + Nestiq ops lead
      url: ${{ vars.TENANT_WEB_URL }}
    env:
      TENANT: ${{ github.event.inputs.tenant }}
      STATE_REGISTRY: ${{ vars.STATE_REGISTRY }}           # e.g. harbor.<state-dc>.internal/margdarshak
      KUBE_NAMESPACE: margdarshak-${{ github.event.inputs.tenant }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gate.outputs.sha }}
      - uses: sigstore/cosign-installer@v3
      - uses: azure/setup-helm@v4
        with:
          version: v3.19.0
      - name: Verify signatures before anything enters the state network
        run: |
          for img in api web score-verifier; do
            case $img in
              api) d="${{ needs.images.outputs.digest-api }}";;
              web) d="${{ needs.images.outputs.digest-web }}";;
              score-verifier) d="${{ needs.images.outputs.digest-score-verifier }}";;
            esac
            cosign verify "${IMAGE_PREFIX}-${img}@${d}" \
              --certificate-identity-regexp "^https://github.com/${{ github.repository }}/.github/workflows/deploy.yml@" \
              --certificate-oidc-issuer https://token.actions.githubusercontent.com
          done
      - name: Mirror images into the state registry (data and images stay in India)
        env:
          STATE_REGISTRY_USER: ${{ secrets.STATE_REGISTRY_USER }}
          STATE_REGISTRY_PASSWORD: ${{ secrets.STATE_REGISTRY_PASSWORD }}
        run: |
          echo "$STATE_REGISTRY_PASSWORD" | docker login "${STATE_REGISTRY%%/*}" -u "$STATE_REGISTRY_USER" --password-stdin
          for pair in "api:${{ needs.images.outputs.digest-api }}" "web:${{ needs.images.outputs.digest-web }}" "score-verifier:${{ needs.images.outputs.digest-score-verifier }}"; do
            img="${pair%%:*}"; d="${pair#*:}"
            docker buildx imagetools create -t "${STATE_REGISTRY}/${img}:${{ needs.gate.outputs.sha }}" "${IMAGE_PREFIX}-${img}@${d}"
          done
      - name: Kubeconfig (namespaced deployer service account, short-lived token)
        env:
          KUBECONFIG_B64: ${{ secrets.TENANT_KUBECONFIG_B64 }}
        run: |
          mkdir -p ~/.kube && echo "$KUBECONFIG_B64" | base64 -d > ~/.kube/config && chmod 600 ~/.kube/config
      - name: helm diff (visible in the approval log)
        run: |
          helm plugin install https://github.com/databus23/helm-diff --version v3.13.1 || true
          helm diff upgrade margdarshak infra/helm/margdarshak -n "$KUBE_NAMESPACE" \
            -f infra/helm/margdarshak/values.yaml -f "infra/helm/tenants/values-${TENANT}.yaml" \
            --set global.imageRegistry="$STATE_REGISTRY" --set global.imageTag="${{ needs.gate.outputs.sha }}" || true
      - name: helm upgrade --atomic (pre-upgrade hook Job runs /app/api migrate up; rolling update maxUnavailable 0)
        run: |
          helm upgrade --install margdarshak infra/helm/margdarshak \
            -n "$KUBE_NAMESPACE" --create-namespace \
            -f infra/helm/margdarshak/values.yaml -f "infra/helm/tenants/values-${TENANT}.yaml" \
            --set global.imageRegistry="$STATE_REGISTRY" \
            --set global.imageTag="${{ needs.gate.outputs.sha }}" \
            --atomic --wait --timeout 15m --history-max 20
      - name: Post-deploy smoke (from inside the network)
        env:
          TENANT_API_URL: ${{ vars.TENANT_API_URL }}
        run: |
          curl -fsS "${TENANT_API_URL}/v1/health" | jq -e '.status=="ok" and .ntp_offset_ms < 1000 and .log_shipping=="ok"'
      - name: Rollback hint
        if: failure()
        run: |
          echo "helm --atomic already rolled back the release. Inspect: helm history margdarshak -n $KUBE_NAMESPACE" >> "$GITHUB_STEP_SUMMARY"
```

### `infra/render.yaml`
```yaml
# Margdarshak: Render Blueprint (hackathon build, Phase 1-2)
# ---------------------------------------------------------------------------
# Spec: https://render.com/docs/blueprint-spec (fetched 2026-10-23).
# Workflow services in Blueprints: supported since 16 Sep 2026 (https://render.com/changelog).
#
# Facts this file relies on (from the spec page, 2026-10-23):
#   - service types: web | pserv | worker | cron | keyvalue | workflow
#   - region values: oregon | ohio | virginia | frankfurt | singapore (no India region)
#   - workflow services: runtime node (we use TypeScript, ADR-0005) or Render's other SDK runtime; `region` REQUIRED; `plan`, `previews`,
#     `preDeployCommand` and Docker fields NOT supported (compute plan is set per task in code).
#   - new compute plan IDs (renamed 26 Aug 2026, "no changes to pricing"):
#       starter -> 0.5c-512mb, standard -> 1c-2g, pro -> 2c-4g (https://render.com/docs/compute-plans-update)
#   - Postgres plan IDs: free, 0.1c-256mb (default), 0.5c-1g, 1c-2g ...
#   - Key Value plan IDs: free, 256mb (default), 1g, 3g; ipAllowList REQUIRED.
#   - autoDeployTrigger: commit | checksPass | off (replaces deprecated autoDeploy)
#   - fromService property `slug` exists for workflows; `hostport` for private services.
#
# [unverified, owner: Ops lead, 2026-10-24 H0] The spec page did not document a start-command
# field for workflow services. We use `startCommand` (the dashboard calls it "Start command",
# see research/B-sponsors.md §1 "Deploy"). If `render blueprint validate` rejects it, create the
# workflow service with `render workflows create ... --run-command "node services/workflows/dist/main.js"`
# and delete the block below.
#
# Languages (ADR-0011, ADR-0005): the API is Go 1.27 (one static binary in a distroless image);
# Render Workflows tasks are TypeScript (`@renderinc/sdk` 1.4.0) in services/workflows; the score
# verifier is Node. No Python service exists.
#
# DATA: the hackathon deployment holds SYNTHETIC data only. Render has no India region, so we
# use Singapore (closest; D-17, war-room G4). Production for a state runs on MeghRaj/NIC or a
# MeitY-empanelled CSP in India: see docs/05-ops/INFRASTRUCTURE.md §4.
#
# Deploys are driven by .github/workflows/deploy.yml (autoDeployTrigger: off) so that a deploy
# only happens after ci.yml + evals gate pass, and so we can smoke-test and warm the services.
# ---------------------------------------------------------------------------

previews:
  generation: off            # Workflows are not supported in preview environments (B-sponsors §1)

envVarGroups:
  - name: margdarshak-shared
    envVars:
      - key: APP_ENV
        value: hackathon-prod
      - key: TENANT_DEFAULT
        value: jk                      # Jammu & Kashmir demo tenant (E-31)
      - key: TZ
        value: UTC                     # store UTC, render Asia/Kolkata in the UI
      - key: LOG_LEVEL
        value: info
      - key: LOG_FORMAT
        value: json
      - key: PII_REDACTION
        value: "strict"
      - key: OTEL_SERVICE_NAMESPACE
        value: margdarshak
      - key: OTEL_TRACES_SAMPLER
        value: parentbased_traceidratio
      - key: OTEL_TRACES_SAMPLER_ARG
        value: "0.2"
      - key: OTEL_EXPORTER_OTLP_PROTOCOL
        value: http/protobuf
      - key: OTEL_EXPORTER_OTLP_ENDPOINT
        sync: false                     # e.g. Grafana Cloud OTLP gateway; prompted at Blueprint creation
      - key: OTEL_EXPORTER_OTLP_HEADERS
        sync: false
      - key: SENTRY_DSN
        sync: false
      - key: SENTRY_ENVIRONMENT
        value: hackathon-prod
      - key: FEATURE_FLAGS_SOURCE
        value: db                       # flags table, per tenant (DEPLOYMENT.md §5)
      - key: DATA_CLASS
        value: synthetic-only           # banner + guard: refuses real Aadhaar-like input (EC-20)

services:
  # -------------------------------------------------------------------------
  # 1. Citizen PWA (Next.js 16, standalone output)
  # -------------------------------------------------------------------------
  - type: web
    name: margdarshak-web
    runtime: docker
    region: singapore
    plan: 0.5c-512mb                   # legacy "starter"; never `free` (15-min sleep, ~1 min cold start)
    dockerfilePath: ./infra/docker/web.Dockerfile
    dockerContext: .
    healthCheckPath: /api/health
    numInstances: 1
    autoDeployTrigger: off
    buildFilter:
      paths:
        - apps/web/**
        - packages/**
        - infra/docker/web.Dockerfile
        - pnpm-lock.yaml
    envVars:
      - fromGroup: margdarshak-shared
      - key: PORT
        value: "3000"
      - key: OTEL_SERVICE_NAME
        value: margdarshak-web
      - key: NEXT_PUBLIC_API_BASE_URL
        sync: false                     # public URL of margdarshak-api (custom domain later)
      - key: NEXT_PUBLIC_SITE_DISCLAIMER
        value: "Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State Transport Department. Uses simulated government data."
      - key: API_INTERNAL_HOSTPORT
        fromService:
          name: margdarshak-api
          type: web
          property: hostport            # server-side fetches stay on Render's private network
      - key: NEXTAUTH_SECRET
        generateValue: true

  # -------------------------------------------------------------------------
  # 2. API (Go 1.27: chi, pgx + sqlc, goose, ADK for Go agents, adapters) - the one backend (D-17, ADR-0011)
  #    runtime: docker = the same distroless image we ship to a state cloud. Native alternative:
  #      runtime: go
  #      buildCommand: cd services/api && go build -trimpath -tags timetzdata -o bin/api ./cmd/api
  #      startCommand: ./services/api/bin/api serve
  #    (then RULEPACK_DIR/PROMPT_DIR must point at ./rulepacks and ./ai/prompts in the checkout).
  # -------------------------------------------------------------------------
  - type: web
    name: margdarshak-api
    runtime: docker
    region: singapore
    plan: 0.5c-512mb                   # legacy "starter": one static Go binary (pgx pool, ADK/genai Go) fits well under
                                       # 512 MB with GOMEMLIMIT=400MiB; re-check under the k6 burst (PERFORMANCE.md) and
                                       # move to 1c-2g if RSS > 70 % or p95 slips
    dockerfilePath: ./infra/docker/api.Dockerfile
    dockerContext: .
    healthCheckPath: /v1/health         # API-64
    preDeployCommand: /app/api migrate up   # goose migrations embedded in the binary (distroless: no shell)
    numInstances: 1
    autoDeployTrigger: off
    buildFilter:
      paths:
        - services/api/**
        - rulepacks/**
        - ai/prompts/**
        - infra/docker/api.Dockerfile
    envVars:
      - fromGroup: margdarshak-shared
      - key: PORT
        value: "8000"
      - key: GOMEMLIMIT
        value: 400MiB                   # soft heap limit below the 512 MB plan; GC works harder instead of OOM
      - key: OTEL_SERVICE_NAME
        value: margdarshak-api
      - key: DATABASE_URL
        fromDatabase:
          name: margdarshak-db
          property: connectionString
      - key: REDIS_URL
        fromService:
          name: margdarshak-kv
          type: keyvalue
          property: connectionString
      - key: SCORE_VERIFIER_HOSTPORT
        fromService:
          name: margdarshak-score-verifier
          type: pserv
          property: hostport
      - key: WORKFLOW_SLUG
        fromService:
          name: margdarshak-workflows
          type: workflow
          property: slug                # task slug = {WORKFLOW_SLUG}/{task_name}
      - key: JOB_RUNNER
        value: render_workflows         # JobRunner port: inline | render_workflows | temporal (production, INFRASTRUCTURE.md §4.5)
      - key: RENDER_API_KEY
        sync: false                     # Go adapter internal/jobs/renderworkflows: POST https://api.render.com/v1/task-runs
                                        # {task: "<WORKFLOW_SLUG>/<task>", input: [...], idempotencyKey} -> 202 TaskRun;
                                        # GET /v1/task-runs/{id} is polled into job_runs (no completion webhook)
      - key: INTERNAL_HMAC_SECRET
        sync: false                     # verifies HMAC on /internal/job-steps/* calls from the Workflows tasks (same value there)
      - key: GEMINI_API_KEY
        sync: false                     # PAID tier only (D-13, war-room G8)
      - key: GEMINI_MODEL_DEBRIEF
        value: gemini-3.1-flash-lite    # M-02/M-03/M-04 (04 §1.7); re-pin at H0
      - key: GEMINI_MODEL_VISION
        value: gemini-3.8-flash         # M-05/M-06/M-07
      - key: GEMINI_MODEL_LIVE
        value: gemini-3.8-live          # M-01; fallback below
      - key: GEMINI_MODEL_LIVE_FALLBACK
        value: gemini-2.5-flash-native-audio-preview-12-2025
      - key: AI_DEBRIEF_TIMEOUT_MS
        value: "6000"                   # > 6 s -> template fallback (08 §5.6)
      - key: AI_CIRCUIT_BREAKER_FALLBACK_RATE
        value: "0.20"                   # fallback > 20 % over 5 min opens the breaker
      - key: SARVAM_API_KEY
        sync: false                     # M-08 Dogri ASR (disclosed processor)
      - key: N8N_BASE_URL
        sync: false
      - key: N8N_HMAC_SECRET
        sync: false                     # shared with n8n Variables `MD_HMAC_SECRET`
      - key: N8N_RESUME_AUTH_TOKEN
        sync: false                     # header token our pages send when resuming n8n Wait nodes
      - key: R2_ACCOUNT_ID
        sync: false
      - key: R2_ACCESS_KEY_ID
        sync: false
      - key: R2_SECRET_ACCESS_KEY
        sync: false
      - key: R2_BUCKET_CLIPS
        value: margdarshak-clips-public  # blurred, published clips only
      - key: R2_BUCKET_INGEST
        value: margdarshak-clips-ingest  # raw uploads; lifecycle delete after 14 days
      - key: CONTACT_ENCRYPTION_KEY
        sync: false                     # E-14 field-level encryption (32-byte base64)
      - key: SESSION_SIGNING_KEY
        generateValue: true
      - key: ADAPTER_SARATHI
        value: mock                     # mock | deeplink | real (F-56)
      - key: ADAPTER_DIGILOCKER
        value: mock
      - key: ADAPTER_PAYMENT
        value: mock
      - key: ADAPTER_BHASHINI
        value: mock
      - key: ADAPTER_NOTIFICATION
        value: n8n                      # n8n edge; SMS stays off until TRAI DLT (D-16)
      - key: ADAPTER_SLOT
        value: mock
      - key: CORS_ALLOWED_ORIGINS
        sync: false

  # -------------------------------------------------------------------------
  # 3. Score verifier (Node 22, runs @margdarshak/game-core replays) - private only
  # -------------------------------------------------------------------------
  - type: pserv
    name: margdarshak-score-verifier
    runtime: docker
    region: singapore
    plan: 0.5c-512mb
    dockerfilePath: ./infra/docker/score-verifier.Dockerfile
    dockerContext: .
    numInstances: 1
    autoDeployTrigger: off
    buildFilter:
      paths:
        - services/score-verifier/**
        - packages/game-core/**
        - infra/docker/score-verifier.Dockerfile
        - pnpm-lock.yaml
    envVars:
      - fromGroup: margdarshak-shared
      - key: PORT
        value: "8081"
      - key: OTEL_SERVICE_NAME
        value: margdarshak-score-verifier
      - key: VERIFIER_SHARED_SECRET
        generateValue: true             # copy to the API's env after first sync (fromService cannot read secrets)

  # -------------------------------------------------------------------------
  # 4. Render Workflows (TypeScript SDK `@renderinc/sdk` 1.4.0) - durable jobs (D-15, ADR-0005)
  #    Tasks: clip_ingest (headline), clip_finalize, case_clock_sweep (+ clock_batch subtask),
  #           session_debrief, debrief_backfill, nightly_stats, rulepack_reevaluate,
  #           user_export, user_delete, replay_pending_sessions
  #    Tasks are thin TS orchestrators (retries, fan-out with Promise.all over ctx.run):
  #      - media steps run inside the task: ffmpeg transcode, face/plate blur (onnxruntime-node,
  #        YuNet + plate model), flash check; they read/write R2 directly;
  #      - every business step (clock batches, debrief, AI window proposals, stats, rule-pack
  #        re-evaluation, export/delete, n8n hand-offs) is a call to the Go API over the private
  #        network: POST http://$API_INTERNAL_HOSTPORT/internal/job-steps/{step} with HMAC
  #        (INTERNAL_HMAC_SECRET). The API owns the database, Gemini and n8n; this service has
  #        NO DATABASE_URL, no Gemini key and no n8n secret.
  #    Build: services/workflows is the pnpm workspace member @margdarshak/workflows (its owner adds
  #    it to pnpm-workspace.yaml), so the build runs from the repo root (no rootDir).
  # -------------------------------------------------------------------------
  - type: workflow
    name: margdarshak-workflows
    runtime: node
    region: singapore                  # REQUIRED for workflows
    buildCommand: corepack enable && pnpm install --frozen-lockfile --filter "@margdarshak/workflows..." && pnpm --filter @margdarshak/workflows build
    startCommand: node services/workflows/dist/main.js   # registers tasks; the SDK task server auto-starts. See [unverified] note in the header
    envVars:
      - fromGroup: margdarshak-shared
      - key: OTEL_SERVICE_NAME
        value: margdarshak-workflows
      - key: API_INTERNAL_HOSTPORT
        fromService:
          name: margdarshak-api
          type: web
          property: hostport
      - key: INTERNAL_HMAC_SECRET
        sync: false                     # same value as the API's INTERNAL_HMAC_SECRET
      - key: R2_ACCOUNT_ID
        sync: false
      - key: R2_ACCESS_KEY_ID
        sync: false
      - key: R2_SECRET_ACCESS_KEY
        sync: false
      - key: FAULT_INJECTION_CLIP_BLUR
        value: "off"                    # "once" makes blur fail on 1st attempt: visible retry for the demo (D-15)

  # -------------------------------------------------------------------------
  # 5. Key Value (rate limits, anonymous sessions, idempotency keys, circuit breaker)
  # -------------------------------------------------------------------------
  - type: keyvalue
    name: margdarshak-kv
    region: singapore
    plan: 256mb
    maxmemoryPolicy: volatile-lru      # only keys with TTL are evicted; idempotency keys carry TTLs
    ipAllowList: []                    # empty list = private network only, no external access

databases:
  - name: margdarshak-db
    region: singapore
    plan: 0.1c-256mb                   # legacy "basic-256mb"; synthetic data; upgrade if load test needs it
    postgresMajorVersion: "16"         # PROJECT_BRIEF §8: PostgreSQL 16
    databaseName: margdarshak
    user: margdarshak
    ipAllowList: []                    # private network only
```
