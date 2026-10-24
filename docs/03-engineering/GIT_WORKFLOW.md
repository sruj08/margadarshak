# Git Workflow
> Project: Margdarshak · Owner: Tech lead · Status: Draft v0.2 · Last updated: 2026-10-23
> Related: [Project Brief](../00-overview/PROJECT_BRIEF.md) · [Coding Standards](CODING_STANDARDS.md) · [Testing](TESTING.md) · [CI/CD](../05-ops/CICD.md) · [Deployment](../05-ops/DEPLOYMENT.md) · [Environment Setup](ENVIRONMENT_SETUP.md) · [Hackathon Plan](../08-project/IMPLEMENTATION_PLAN.md)

---

## 0. The hackathon rule that overrides everything (R-14)
The HackCache '26 start time is disputed (Fri 00:00 vs Fri 21:30 IST, PROJECT_BRIEF §14). **No application code is committed and no participant data is collected before the confirmed start.** Bible documents and config skeletons (this repo's `docs/`, root config files) are planning artefacts.
- The first commit after the confirmed start is tagged `build-start` and its timestamp is shown in the README.
- Every commit after that is pushed within 30 minutes (no local-only history that could look back-dated).
- Never rewrite published history (`git push --force` to `main` is blocked).
- **Humans commit; AI agents do not.** Agents that write code or docs for this repo never run `git commit` or `git push`. The team reviews the working tree and commits (BUILD_CONVENTIONS §1.4).

---

## 1. Repository shape: one monorepo, two toolchains

| Ecosystem | Tool | Workspace definition | Lockfile |
|---|---|---|---|
| TypeScript (apps, packages, score verifier, Render Workflows tasks) | **pnpm** via Corepack (`packageManager: pnpm@12.15.0` in root `package.json`; the installed 11.9 also works, BUILD_CONVENTIONS §2) | `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `services/score-verifier`, `services/workflows`, `tests/e2e` | `pnpm-lock.yaml` |
| Go (API) | **Go 1.27** modules | `services/api/go.mod` (module `github.com/sruj08/margadarshak/services/api`) | `services/api/go.sum` |

There is no Python in the repo (ADR-0011). Root `pnpm` scripts orchestrate the TS side and call `go` for the API. The tooling owner is moving the old aliases over; see [ENVIRONMENT_SETUP](ENVIRONMENT_SETUP.md) §6.3 for the Go commands to use meanwhile.

`services/workflows` must be listed in `pnpm-workspace.yaml`. That file belongs to the tooling owner, who adds the entry when the package is created.

```
margdarshak/
├── apps/web, apps/console           (pnpm)
├── packages/ui, game-core, rules, api-client (pnpm)
├── services/score-verifier          (pnpm, Node)
├── services/workflows               (pnpm, Render Workflows TS tasks, @renderinc/sdk)
├── services/api                     (Go: cmd/, internal/, migrations/, api/ generated)
├── tests/golden                     (shared JSON fixtures, run by Go and TS)
├── rulepacks/                       (data, versioned with CalVer per pack)
├── api/openapi.yaml                 (contract; generated clients committed)
├── ai/prompts, ai/evals             (versioned prompts + eval sets)
├── n8n/                             (exported workflow JSON, credentials excluded)
├── infra/ (render.yaml, docker), tests/ (e2e, load, security), scripts/
└── docs/
```

---

## 2. Branching: trunk-based

```mermaid
gitGraph
  commit id: "build-start" tag: "build-start"
  branch feat/F-23-nazar-rvfc
  commit id: "feat(web): rVFC tap timing"
  commit id: "test(game-core): replay fixtures"
  checkout main
  merge feat/F-23-nazar-rvfc id: "squash #12"
  branch fix/EC-01-year-only-dob
  commit id: "fix(api): min age for year-only DOB"
  checkout main
  merge fix/EC-01-year-only-dob id: "squash #13"
  commit id: "chore(release): v0.1.0" tag: "v0.1.0"
```

- **`main` is always deployable.** Render auto-deploys `main` to the hackathon environment after CI is green.
- Branches live **≤ 1 day** in Phase 1–2 (≤ 3 days in Phase 3+). Integrate small; hide unfinished work behind tenant feature flags, not long branches.
- No `develop` or release branches. Hotfixes are normal short branches off `main`.
- Rebase your branch on `main` before merge (`git pull --rebase`); merge via **squash** so each PR is one Conventional Commit on `main`.

### 2.1 Branch naming
`<type>/<id>-<slug>` where `<type>` matches the Conventional Commit type and `<id>` is a PROJECT_BRIEF/backlog ID when one exists.

| Example | Use |
|---|---|
| `feat/F-02-plan-card` | feature |
| `fix/EC-09-payment-pending-copy` | bug / edge case |
| `test/EC-01-EC-30-golden` | tests only |
| `chore/deps-renovate-2026-10-26` | tooling |
| `docs/adr-0006-job-runner` | docs |
| `rules/JK-2026.10.1-retest-gap` | rule-pack change (goes through the studio's maker-checker too) |
| `ai/debrief-prompt-v3` | prompt change (eval gate) |

---

## 3. Conventional Commits

Format: `<type>(<scope>)!?: <summary in imperative, ≤ 72 chars>` + optional body + footers.

| Type | When |
|---|---|
| `feat` | user-visible capability |
| `fix` | bug or edge-case handling |
| `perf` | performance without behaviour change |
| `refactor` | internal change without behaviour change |
| `test` | tests only |
| `docs` | documentation only |
| `build` | build system, dependencies |
| `ci` | GitHub Actions |
| `chore` | everything else (tooling, housekeeping) |
| `rules` | rule-pack data change (custom type; triggers the golden suite and the public rules changelog) |
| `ai` | prompt / agent config / eval set change (custom type; triggers evals) |
| `revert` | reverts |

**Scopes** (closed list, enforced by commitlint): `web`, `console`, `ui`, `game-core`, `rules`, `api-client`, `api`, `workflows`, `verifier`, `rulepacks`, `ai`, `n8n`, `infra`, `e2e`, `load`, `docs`, `deps`, `repo`.

**Footers**: `Refs: F-23, EC-18` (IDs from PROJECT_BRIEF), `BREAKING CHANGE: …`, `Co-Authored-By: …`.

Examples:
```
feat(web): score Nazar taps on media time via requestVideoFrameCallback

Taps are mapped to the last presented frame's mediaTime so buffering cannot
shift the score. Falls back to currentTime with timingMode=fallback.

Refs: F-23, EC-18
```
```
rules(rulepacks): JK 2026.10.1 — mark transport LMV prerequisite as verify

Refs: D-05, D-25, EC-06
```

`commitlint.config.cjs` extends `@commitlint/config-conventional` 21.2.4 with the custom types and the scope enum; `lefthook` runs it on `commit-msg`.

### 3.1 Git hooks (`lefthook.yml`, lefthook 2.2.2)
```yaml
pre-commit:
  parallel: true
  commands:
    biome:
      glob: "*.{ts,tsx,js,mjs,cjs,json,jsonc,css}"
      run: corepack pnpm biome check --no-errors-on-unmatched {staged_files}
    gofmt:
      root: "services/api/"
      glob: "*.go"
      run: test -z "$(gofmt -l {staged_files})" || (gofmt -l {staged_files}; echo "run gofmt -w"; exit 1)
    govet:
      root: "services/api/"
      glob: "*.go"
      run: go vet ./...
    secrets:
      run: detect-secrets-hook --baseline .secrets.baseline {staged_files}
commit-msg:
  commands:
    commitlint:
      run: corepack pnpm commitlint --edit {1}
```
- Hooks are a fast local guard. CI repeats every check, plus golangci-lint, `govulncheck` and the full test suites.
- `go vet ./...` runs at package level because vet cannot check a single file. It is quick for this module.
- `lefthook install` runs from the root `prepare` script.

---

## 4. Pull requests

### 4.1 Rules
- Every change to `main` goes through a PR (branch protection: required checks, 1 approval in Phase 1–2, 2 for protected paths in Phase 3+, linear history, no force push, conversation resolution required).
- PR title = the squash commit message (Conventional Commit format; checked by a CI job).
- Size target ≤ 400 changed lines excluding generated files and fixtures; larger PRs need a reason in the description.
- Generated files must match their sources. CI regenerates them and diffs:
  - `packages/api-client/src/schema.d.ts` and `packages/rules/src/generated/*`.
  - Go: `services/api/api/*.gen.go` (oapi-codegen) and `services/api/internal/store/sqlcgen/` (sqlc), via `go generate ./... && git diff --exit-code`.
- Draft PRs welcome; CI runs on drafts.

### 4.2 Required checks (names as they appear in GitHub; workflow YAML in [CI/CD](../05-ops/CICD.md))
| Check | What |
|---|---|
| `lint` | Biome, ESLint (Next rules), wording/fact lints, commitlint on PR title; Go: `gofmt -l`, `go vet ./...`, golangci-lint v2.15.0 |
| `typecheck` | `tsc --noEmit` all TS projects; `go build ./...` and the generated-code drift check |
| `unit` | Vitest (TS), `go test -race ./...` (Go, incl. integration on embedded Postgres 16), with coverage gates ([TESTING](TESTING.md) §10) |
| `golden` | rules + fees + journey golden suites (EC-01..EC-30) on the Go engine and the TS mirror, plus the parity diff. Required for any change under `rulepacks/`, `tests/golden/`, `services/api/internal/{rules,journey,clock,domain}/`, `packages/rules/` |
| `contract` | adapter contract tests (`go test -run Contract`; mock adapters always; real adapters on nightly) |
| `replay` | game-core determinism + replay fixtures (browser build vs score-verifier build) |
| `e2e` | Playwright + axe on the three deep slices (all stages on nightly) |
| `evals` | Go eval harness (`go test -tags evals`) for changed agents/prompts (`ai/**`, `services/api/internal/adapters/ai/**`) |
| `size` | `size-limit` (Lite < 300 KB) + Lighthouse CI budget |
| `security` | `pnpm audit --prod`, `govulncheck ./...`, `gosec` (via golangci-lint), `detect-secrets`, OpenAPI breaking-change diff |

The exact job names live in `.github/workflows/ci.yml`. The single required status check is `ci-gate`, which aggregates them ([CI/CD](../05-ops/CICD.md)).

### 4.3 PR template (`.github/pull_request_template.md`)
```markdown
## What and why
<!-- One paragraph. Link IDs: F-xx, EC-xx, D-xx, API-xx, E-xx, ADR-xxxx -->

Refs:

## How it was tested
- [ ] Unit / golden / contract / replay / e2e (tick what applies)
- [ ] Manually on a low-end Android (Chrome) or DevTools "Moto G Power" + Slow 3G
- [ ] Screen reader pass (TalkBack/VoiceOver) for changed screens

## Screenshots / recordings
<!-- en + hi, light + dark, Lite if affected -->

## Facts, privacy and safety
- [ ] No fee/age/date/score computed outside rules engine / case clock / game-core
- [ ] No ₹ literal, no banned wording (D-19)
- [ ] No new PII; or PRIVACY data inventory updated
- [ ] Family mode respected (D-13 revised): AI works for every user; a minor's case needs the parent's consent; no analytics, behavioural tracking or ads on a child's data; squads/share cards only with the parent's consent
- [ ] AI changes: eval suite green, no new tools that submit/pay/book

## Rollout
- [ ] Behind a feature flag: `<flag>` / not needed
- [ ] Migration: none / expand-only / contract (link plan)
- [ ] Docs / ADR updated

## Owner who can explain this module on stage (D-24)
@<handle>
```

### 4.4 Review expectations
- Reviewer responds within 2 hours during the hackathon build (within 1 working day in Phase 3+).
- Use the review checklist in [CODING_STANDARDS](CODING_STANDARDS.md) §10.
- "Approve with nits" is allowed; the author fixes nits before merge or files a follow-up with an owner and date.

---

## 5. CODEOWNERS (`.github/CODEOWNERS`)
Team handles are placeholders until the GitHub org/team names are fixed (owner: Tech lead, before `build-start`). Each line names the module owner who can explain it to the judges (D-24).

```
# Default
*                                   @margdarshak/tech-lead

# Frontend
/apps/web/                          @margdarshak/frontend
/apps/console/                      @margdarshak/frontend
/packages/ui/                       @margdarshak/frontend @margdarshak/design
/packages/api-client/               @margdarshak/frontend @margdarshak/backend

# Games
/packages/game-core/                @margdarshak/games
/services/score-verifier/           @margdarshak/games @margdarshak/backend
/apps/web/src/features/games/       @margdarshak/games

# Backend (Go)
/services/api/                      @margdarshak/backend
/services/api/go.mod                @margdarshak/backend-platform
/services/api/go.sum                @margdarshak/backend-platform
/services/api/migrations/           @margdarshak/backend-platform
/services/api/internal/rules/       @margdarshak/backend @margdarshak/rules
/services/api/internal/privacy/     @margdarshak/backend @margdarshak/tech-lead
/api/openapi.yaml                   @margdarshak/backend @margdarshak/frontend

# Render Workflows tasks (TypeScript)
/services/workflows/                @margdarshak/backend @margdarshak/ops

# Rules data (maker-checker also enforced in the studio)
/rulepacks/                         @margdarshak/rules
/tests/golden/                      @margdarshak/rules
/packages/rules/                    @margdarshak/rules

# AI
/ai/                                @margdarshak/ai
/services/api/internal/adapters/ai/ @margdarshak/ai

# Automation and infra
/n8n/                               @margdarshak/ops
/infra/                             @margdarshak/ops
/.github/                           @margdarshak/ops @margdarshak/tech-lead

# Compliance-sensitive docs
/docs/06-security-compliance/       @margdarshak/tech-lead @margdarshak/product
```

---

## 6. Versioning and release tags

### 6.1 What gets a version
| Artefact | Scheme | Example tag | Where recorded |
|---|---|---|---|
| Product (web + console + API, released together) | **SemVer** `vMAJOR.MINOR.PATCH` | `v0.1.0` | `CHANGELOG.md` (Keep a Changelog) |
| `@margdarshak/game-core` | SemVer; **`scoringVersion`** pinned per session | `game-core@1.2.0` | `packages/game-core/CHANGELOG.md` |
| Rule packs | **CalVer** `YYYY.MM.N` per pack | `rulepack/JK@2026.10.1` | `rulepacks/CHANGELOG.md` (public rules changelog, D-05 trust) |
| Prompts / agents | `v<N>` per agent | `ai/debrief@v3` | `ai/prompts/<agent>/CHANGELOG.md` with eval scores |
| OpenAPI | `info.version` follows product SemVer; breaking changes only in a new `/v2` path | — | `api/openapi.yaml` |
| Hackathon submission | fixed tag | `hackcache26-submission` | README + submission form |

### 6.2 How a release is cut
1. `main` green → the `release-please` GitHub Action (release-please 17.11.2, manifest mode, reading Conventional Commits) keeps a release PR open with version bumps and CHANGELOG entries. (`pnpm release` only prints this pointer; releases are never cut from a laptop.)
2. Merge the release PR → GitHub Actions creates the tag(s) and a GitHub Release, builds images, and deploys (see [DEPLOYMENT](../05-ops/DEPLOYMENT.md)).
3. Rule-pack tags are created by the rule-pack studio's publish step (after checker approval), not by humans.

SemVer meaning for the product: MAJOR = breaking API (`/v2`) or data contract; MINOR = new features (F-xx); PATCH = fixes. Pre-1.0 (`0.x`) during the hackathon and pilot.

### 6.3 Hackathon tags
| Tag | When |
|---|---|
| `build-start` | first commit after the confirmed start |
| `slice-a`, `slice-b`, `slice-c` | each deep slice is demo-ready (D-04) |
| `v0.1.0` | feature-complete for judging |
| `hackcache26-submission` | the exact commit behind the live URL and the video |

---

## 7. Dependencies and generated code
- Exact versions in `package.json` (see the file) and in `services/api/go.mod` (Go modules are always exact). Lockfiles are committed: `pnpm-lock.yaml` and `go.sum`.
- Only the BE-platform owner runs `go get` / `go mod tidy` during P0, so `go.mod` never conflicts (BUILD_CONVENTIONS §3). Others request a new module in their PR description.
- Renovate:
  - Phase 1–2: weekly, grouped, automerge for patch devDependencies only.
  - Phase 3+: also security PRs immediately.
  - It covers both the npm and the `gomod` managers.
  - Major upgrades of Next, React, HeroUI, Phaser, ADK for Go (`google.golang.org/adk`), `google.golang.org/genai`, `@renderinc/sdk`, pgx or chi require an ADR note.
- Code generation (CI fails on drift):
  - `pnpm gen:api` regenerates `packages/api-client` from `api/openapi.yaml`.
  - `pnpm gen:rules` regenerates `packages/rules` types from `rulepacks/schema/`.
  - `cd services/api && go generate ./...` regenerates the Go server interfaces and models (oapi-codegen v2.8.0) and the typed queries (sqlc v1.31.1).
- Never commit: `.env*` (except `.env.example`), secrets, real participant data, raw (unblurred) clips, n8n credentials, model API keys. `detect-secrets` baseline is committed and must stay clean.

---

## 8. Large files and data
- Clips are **not** in Git. Raw clips stay on the curator's encrypted drive; blurred, published clips live in R2 (the pipeline's output). Git holds the clip manifest (IDs, hashes, hazard windows, licence CC-BY 4.0).
- Fixture media for tests (≤ 5 synthetic or CC0 clips, ≤ 2 MB each) live under `tests/fixtures/media/` and are tracked with Git LFS.
- Field-study exports never enter Git (pseudonymous sheet only, via n8n W14).

---

## 9. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| Approvals | 1 reviewer (module owner) | 2 for `services/api/internal/{domain,rules,privacy}/`, `rulepacks/`, auth, AI prompts, infra |
| Deploy | Auto-deploy `main` to Render | Tag-based promotion dev → staging → prod; change advisory for state tenants |
| Signing | Not required | Signed commits and tags (Sigstore/gitsign), SBOM per release |
| Release cadence | As needed | Fortnightly; rule packs on their own cadence with notice to users (EC-27) |
| Branch life | ≤ 1 day | ≤ 3 days |
