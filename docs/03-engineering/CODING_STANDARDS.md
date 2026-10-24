# Coding Standards
> Project: Margdarshak · Owner: Tech lead · Status: Draft v0.2 · Last updated: 2026-10-23
> Related: [Project Brief](../00-overview/PROJECT_BRIEF.md) · [Build Conventions](../08-project/BUILD_CONVENTIONS.md) · [Frontend](FRONTEND.md) · [Backend](BACKEND.md) · [Git Workflow](GIT_WORKFLOW.md) · [Testing](TESTING.md) · [Security Architecture](../06-security-compliance/SECURITY_ARCHITECTURE.md) · [Privacy](../06-security-compliance/PRIVACY.md) · [Observability](../05-ops/OBSERVABILITY.md) · [ADR-0011 Go backend](adr/ADR-0011-go-backend.md)

These standards apply to every line in the monorepo:
- **Go:** `services/api` (module `github.com/sruj08/margadarshak/services/api`).
- **TypeScript:** `apps/*`, `packages/*`, `services/score-verifier`, `services/workflows` (Render Workflows tasks), `scripts/*`.

There is no Python in the repo (BUILD_CONVENTIONS §1, ADR-0011). Tooling enforces almost all of these rules; the review checklist (§10) covers the rest.

**Priority order when rules conflict:** safety and privacy of users → correctness of facts (rules, fees, dates, scores) → accessibility → readability → performance → brevity.

---

## 1. Tooling summary (pinned)

Go versions were checked on proxy.golang.org on 2026-10-23.

| Concern | TypeScript | Go (`services/api`) |
|---|---|---|
| Language | TypeScript 6.0.3, Node 22 | **Go 1.27** (`go 1.27.0` in `go.mod`; current stable go1.27.3) |
| Formatter | **Biome 2.6.2** (`biome format`) | **`gofmt`** (mandatory) + `goimports` grouping (std / third-party / module), run through golangci-lint `formatters` |
| Linter | **Biome 2.6.2** (`biome lint`), plus `eslint` 10.13.0 + `eslint-config-next` 16.4.3 **only** for the Next.js rules Biome lacks (`@next/next/*`, core-web-vitals) | **`go vet ./...`** + **golangci-lint v2.15.0** (`services/api/.golangci.yml`, linters in §4.2) |
| Types | `tsc --noEmit` (`strict` + extras, §3.1) | the Go compiler; `exhaustive` linter for enum switches |
| Architecture | Biome `noRestrictedImports` + `knip` 6.42.1 (unused exports/deps) | `internal/` visibility + golangci-lint **`depguard`** rules + an architecture test (`internal/archtest`, §4.6) |
| Security | `pnpm audit --prod`, Biome `noDangerouslySetInnerHtml` (error) | **`govulncheck`** (golang.org/x/vuln v1.9.0), golangci-lint `gosec` |
| Code generation | `openapi-typescript` → `packages/api-client` | `go generate ./...`: **oapi-codegen v2.8.0** (`api/openapi.yaml` → `services/api/api/`), **sqlc v1.31.1** (SQL → `internal/store/sqlcgen`) |
| Secrets | `detect-secrets` 1.5.0 (pre-commit hook + CI) | same |
| Git hooks | `lefthook` 2.2.2: pre-commit = Biome on staged TS; commit-msg = commitlint 21.2.4 | the same `lefthook` pre-commit runs `gofmt -l` and `go vet` on staged `.go` packages ([GIT_WORKFLOW](GIT_WORKFLOW.md) §3.1) |

Commands:
- **TS:** `pnpm lint` and `pnpm typecheck` at the root.
- **Go (in `services/api`):** `gofmt -l . && go vet ./... && golangci-lint run && govulncheck ./...`.

CI fails on any warning in changed files. Generated code (`services/api/api/*.gen.go`, `internal/store/sqlcgen/`) is committed. CI runs `go generate ./... && git diff --exit-code` so it never drifts from `api/openapi.yaml` or the SQL.

---

## 2. Universal rules (both languages)

1. **Facts come from code, never from strings.** Do not type rupee amounts, ages, day counts or pass marks into UI copy, prompts, messages or the expected UI text of tests. Golden fixtures are the only exception. Fees come from `fees.json`, dates from the rules engine and scores from `game-core` (D-06, D-09).
   - Lint: `md/no-inr-literal` (GritQL plugin in Biome; `scripts/lint_facts` for Go and data files) fails on `₹\s?\d`, `Rs\.?\s?\d` and `INR\s?\d`.
   - It checks `*.tsx`, `*.ts`, `messages/*.json`, `ai/prompts/**` and `*.go`. It skips `rulepacks/**`, `tests/golden/**` and `*_test.go` table data that cites a rule ID.
2. **Wording bans (D-19)** are lint errors in UI strings, prompts, docs-in-app and README. Banned:
   - "first" (as in first-ever), "official", "doesn't exist"
   - "DPDP-compliant", "STQC-certified", "integrated with Sarathi", "integrated with Aadhaar"
   - "verified licence", "lives saved", "Saarthi"
   - "safe" as a scam verdict, "you would crash", "unsafe driver"

   `scripts/lint_wording.ts` implements the bans. Its allow-list covers legitimate uses (e.g. "first name", "first-aid") and is reviewed in PRs.
3. **Never collect or log** an Aadhaar number, OTP, biometric or face template (D-07).
   - No input component may have a `name`/`id` matching `/aadhaar|uid|otp/i` (lint).
   - No Go request struct may have a JSON field matching that pattern (architecture test, §4.6).
4. **AI for everyone (D-13 revised).** Every AI feature is open to every user. A learner aged 16–17 uses a parent's account in **family mode**. The adult account holder gives consent, including verifiable parental consent for a minor family member's case. One function per side decides consent and family mode; never re-implement these checks inline:
   - TS UI: `useFamilyMode()` / `hasConsent(purpose)`.
   - Go: `privacy.Authorize(ctx, principal, action, resource)`.

   On a child's data there is no behavioural tracking, no analytics events and no targeted ads. Squads and share cards need the parent's consent.
5. **Time:** store and compare in UTC (`timestamptz` / `time.Time` / epoch ms) and compute calendar days in `Asia/Kolkata`. Server time is truth (EC-15). Domain code never calls `time.Now()` or `Date.now()`; inject `ports.Clock` / `serverClock`.
6. **Money:** integers in **paise**. In Go, use `domain.Paise` (`int64`); in TS, `number` integers branded `Paise`. No floats in money paths. Two lints enforce this:
   - Go: `forbidigo` bans `float32`/`float64` in `internal/rules/fees*` and `internal/domain/money*`.
   - TS: a Biome GritQL rule covers `features/plan`.
7. **IDs:** use UUIDv7 for entities (`uuid.NewV7()` from `github.com/google/uuid` v1.6.0); they sort by time. Never put sequential integers in URLs. Rule IDs are human-readable stable strings (`ELIG-MC50-16`).
8. **Determinism:** game scoring and rule evaluation are pure. Two places must stay free of randomness, wall-clock reads and I/O (lint + architecture test):
   - `packages/game-core/src/scoring|sim`: no `Math.random`, `Date` or `performance.now`.
   - The Go pure packages (`internal/domain`, the `internal/rules` engine, the `internal/journey` machine, the `internal/clock` schedule): no `math/rand`, `time.Now`, `os` or `net`.
9. **Accessibility is a correctness property:** a component that fails axe or keyboard use is a bug, not polish.
10. **Comments explain why, not what** (§7).

---

## 3. TypeScript standards

### 3.1 Compiler settings (from `tsconfig.base.json`)
- Flags: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `useUnknownInCatchVariables: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `moduleResolution: "bundler"`, `target: "ES2022"`.
- No `any` (Biome `noExplicitAny: error`); use `unknown` + Zod parsing.

### 3.2 Style
- Biome formatter: 2-space indent, line width 100, double quotes, semicolons always, trailing commas `all`, arrow parens always.
- Prefer `type` aliases for data, `interface` only for extendable contracts (Game SDK).
- Every state enum (journey stage, voice state, game event type) uses a discriminated union with an exhaustive `switch` + `assertNever(x)`.
- No default exports except where Next.js requires them (`page.tsx`, `layout.tsx`, `route.ts`, `sw.ts`, config files).
- No barrel re-exports inside `features/*` except the single public `index.ts`.
- `async` functions return `Promise<Result>`; errors crossing a boundary are typed `AppError` (from the problem+json `code`).
- `services/workflows` tasks follow the same rules. Each task is a thin orchestrator that calls the Go API for decisions ([BACKEND](BACKEND.md) §8). Tasks are idempotent by input.

### 3.3 React and Next.js
- Server Components by default; `"use client"` only for interactivity, browser APIs or HeroUI components that require it.
- Heavy client modules (Phaser, MediaPipe, Rive, Lottie, voice worklets) load only via `next/dynamic` with `ssr: false`.
- HeroUI v3: compound components (`<Card><Card.Header>`), semantic variants, `onPress`. No raw hex colours in components; use tokens/utilities.
- State: TanStack Query for server state, Zustand for UI state, the URL for navigation state (see [FRONTEND](FRONTEND.md) §4). No server data in Zustand.
- Hooks: one concern per hook, named `useX`. Effects must clean up (Phaser `destroy(true)`, `cancelVideoFrameCallback`, `AudioContext.close()`).
- Every interactive element has a visible text label (not only an icon), is at least 48 × 48 px and uses the focus ring from tokens.
- Forms:
  - The application flow asks one question per screen, with an error summary plus inline errors.
  - Set `autocomplete` attributes, and `inputmode` for numeric fields.
  - There is **never** a numeric field for Aadhaar/OTP, because those fields do not exist.
- i18n: all user-visible text goes through `next-intl` keys. No string literals in JSX except punctuation; Biome GritQL rule `md/no-jsx-literal` warns now and becomes an error before H24.

### 3.4 Import boundaries (Biome `noRestrictedImports` + paths)
| From | May import | May not import |
|---|---|---|
| `apps/web/src/features/<a>` | `@/lib/*`, `@/stores/*`, `@margdarshak/*`, own files, other features' `index.ts` | other features' internals |
| `packages/game-core` | `zod` only | React, Phaser, DOM, Node APIs |
| `packages/rules` | nothing at runtime (zero deps; TS mirror of the Go engine) | anything app-specific |
| `packages/ui` | React, HeroUI, tokens | `apps/*`, `api-client` |
| `apps/console` | `@margdarshak/ui`, `api-client`, `rules` | `game-core` runtime (types only) |
| `services/workflows` | `@renderinc/sdk`, `@margdarshak/api-client` types, Node std | `apps/*`, direct Postgres access (the API owns the data) |

### 3.5 Naming (TypeScript)
| Thing | Convention | Example |
|---|---|---|
| Files (components) | `PascalCase.tsx` | `FeeBreakdown.tsx` |
| Files (other) | `kebab-case.ts` | `server-clock.ts` |
| Components, types | `PascalCase` | `PlanCard`, `SessionResult` |
| Functions, variables | `camelCase` | `formatInr`, `primaryAction` |
| Constants | `SCREAMING_SNAKE_CASE` for true constants | `MAX_TAPS_PER_SECOND` |
| Zod schemas | `PascalCase` = schema, `type X = z.infer<typeof X>` | `GameEvent` |
| Query keys | `qk.<resource>(...)` | `qk.case(id)` |
| i18n keys | `feature.area.item` lowercase dot path | `plan.card.fee_total` |
| Event names (analytics) | `snake_case` `object_action` | `plan_card_viewed` |
| Booleans | `is/has/can/should` prefix | `isFamilyMode` |

---

## 4. Go standards (`services/api`)

### 4.1 Language level and layout
- **Go 1.27**, module `github.com/sruj08/margadarshak/services/api`. The `toolchain` line in `go.mod` matches the CI `setup-go` version.
- Use the standard library first: `net/http`, `log/slog`, `context`, `errors`, `iter`, `slices`, `maps`, `encoding/json`, `embed`, `testing/fstest`.
- Layout (detail in [BACKEND](BACKEND.md) §2):

```
services/api/
├── go.mod · go.sum · oapi-codegen.yaml · sqlc.yaml · .golangci.yml
├── api/                 # GENERATED by oapi-codegen from ../../api/openapi.yaml (package api) - never hand-edit
├── cmd/api/             # composition root: serve | migrate up|down|status | healthcheck
├── cmd/seed/            # synthetic demo seed (--profile demo --synthetic)
├── migrations/          # goose SQL (NNNNN_name.sql, -- +goose Up / -- +goose Down), embedded via embed.FS
└── internal/
    ├── platform/  httpapi/  domain/  ports/  adapters/  rules/  journey/
    └── clock/  privacy/  notify/  store/  audit/  jobs/  tenant/
```

### 4.2 golangci-lint v2 configuration (`services/api/.golangci.yml`)
- `version: "2"`, `run.timeout: 5m`, `run.tests: true`.
- `formatters`: `gofmt`, `goimports` (`local-prefixes: github.com/sruj08/margadarshak`).
- `linters.default: standard` (errcheck, govet, staticcheck, ineffassign, unused). Also enable:

| Linter | Why |
|---|---|
| `revive` | naming, exported-doc and receiver rules |
| `gosec` | security (SQL string building, weak crypto, file perms, `G104` unchecked errors) |
| `errorlint` | `errors.Is/As` instead of `==` and type assertions on errors; `%w` in `fmt.Errorf` |
| `wrapcheck` | errors from other packages are wrapped with context; **enforced in `internal/adapters/**` and `internal/store/**`** |
| `bodyclose`, `noctx` | every `http.Response.Body` is closed; every outbound request carries a `context.Context` |
| `contextcheck` | functions that receive a `ctx` pass it on instead of calling `context.Background()` |
| `sqlclosecheck`, `rowserrcheck` | pgx rows are closed and `rows.Err()` is checked |
| `exhaustive` | every `switch` on an enum (journey `Stage`, `EventType`, consent `Purpose`) covers all values or has an explicit `default` that returns an error |
| `depguard` | import boundaries (§4.6) |
| `forbidigo` | see the forbidden list below |

`forbidigo` bans:
- `fmt.Print*` and `log.*` everywhere (use `slog`).
- `time.Now` outside `internal/platform` and `internal/clock` (inject `ports.Clock`).
- `math/rand` in pure packages (use the injected seed source).
- `float32`/`float64` in `internal/rules/fees*` and `internal/domain/money*`.
- `os.Getenv` outside `internal/platform/config`.

Test files may use magic numbers and `require.NoError` without wrapping. `//nolint:<linter> // reason` needs the linter name and a reason; a bare `//nolint` fails review.

### 4.3 Errors
- Every error is handled or returned. Never use `_ = f()` on an error-returning call, except an explicitly commented `Close` in a `defer` whose error is already logged.
- Wrap with the operation as context: `return fmt.Errorf("load case %s: %w", id, err)`. Do not prefix with "failed to" or "error".
- **Domain errors are typed values** with a stable code (catalogue in [BACKEND](BACKEND.md) §14):

  ```go
  // internal/domain/errors.go
  type Code string

  const (
      CodeInvalidTransition Code = "JOURNEY_INVALID_TRANSITION"
      CodeConsentRequired   Code = "CONSENT_REQUIRED"
      CodeParentConsent     Code = "PARENT_CONSENT_REQUIRED" // minor family member's case without parental consent (D-13 revised)
      CodeRulePackMissing   Code = "RULEPACK_UNAVAILABLE"
  )

  type Error struct {
      Code    Code
      Detail  string            // safe for users; never contains PII or input echoes
      Pointer string            // JSON pointer for validation errors, optional
      Meta    map[string]string // e.g. {"purpose": "ai_coach"}
      Err     error             // wrapped cause, never serialised
  }

  func (e *Error) Error() string { return string(e.Code) + ": " + e.Detail }
  func (e *Error) Unwrap() error { return e.Err }
  ```

- Callers test errors with `errors.Is` (sentinels such as `store.ErrNotFound`) and `errors.As(err, &de)`.
- `internal/httpapi` maps errors to RFC 9457 problem+json in **one** function (`httpapi.writeProblem`). No handler writes its own error JSON.
- Never `panic` across a package boundary. A panic is acceptable only for programmer errors at init time (e.g. a malformed embedded rule schema in `cmd/api`). The HTTP recoverer middleware turns a stray panic into `INTERNAL` 500 with a `trace_id` and logs the stack.
- Validation at the edge: the oapi-codegen strict server decodes request bodies. A strict decoder (`json.Decoder.DisallowUnknownFields`) rejects unknown fields, which is the first wall against Aadhaar/OTP fields (D-07). Hand-written validators enforce lengths, enums and formats before any domain call.

### 4.4 Context, concurrency and resources
- Every function that does I/O or may block takes `ctx context.Context` as its **first** parameter.
- Never store a context in a struct, and never pass `nil`; use `context.TODO()` only in tests.
- Deadlines come from the request. Each outbound adapter sets its own budget with `context.WithTimeout` (§5) and `defer cancel()`.
- Goroutines are started only by an owner that can stop them:
  - Use `errgroup.WithContext` for fan-out.
  - Background loops (job-run poller, circuit-breaker reset) take a `ctx` and exit on `ctx.Done()`.
  - `cmd/api` cancels the root context on SIGTERM and drains the HTTP server with `Server.Shutdown` within 25 s.
- Shared mutable state is guarded by a `sync.Mutex` next to the field it protects, or replaced by channels. `go test -race` runs in CI ([TESTING](TESTING.md) §2).
- Close everything you open: `defer rows.Close()`, `defer resp.Body.Close()`, `defer tx.Rollback(ctx)` (a no-op after `Commit`).

### 4.5 Style and patterns
- **Global state:** none except in the composition root. `cmd/api/main.go` reads config (`caarlos0/env` v11.4.1 in `internal/platform/config`) and builds the pgx pool, adapters and services. It wires them through constructors (`journey.NewService(repo, rules, clock, audit)`). There are no package-level variables that hold connections, clients or config, and no `init()` with side effects.
- **Interfaces belong to the consumer** and stay small. Ports live in `internal/ports` (`ports.Clock`, `ports.Sarathi`, `ports.JobRunner`, `ports.Narrator` …). Constructors return concrete types, and a compile-time assertion checks each adapter: `var _ ports.Sarathi = (*deeplink.Adapter)(nil)`.
- **Generics** only where they remove real duplication (e.g. `store.Page[T]`, the idempotency wrapper). Use no generic "repository" abstraction.
- **SQL:** queries live in `internal/store/queries/*.sql`, and sqlc (`sql_package: pgx/v5`) generates typed Go into `internal/store/sqlcgen`. Rules:
  - No string-built SQL.
  - Dynamic filters use sqlc `sqlc.narg` / `CASE` patterns or a reviewed `pgx` call with bound parameters only.
  - Repositories in `internal/store` translate sqlcgen rows into domain types, so sqlcgen types never leave `internal/store`.
- **Tenant isolation:** every transaction goes through `store.UnitOfWork`. It runs `SET LOCAL app.tenant_id = $1` before the first query, so Postgres row-level security applies ([BACKEND](BACKEND.md) §12.3).
- **Migrations:** goose v3.29.0 SQL files in `services/api/migrations/`. Every file has a working `-- +goose Down`. Changes follow expand → migrate → contract: no `DROP`/`RENAME` in the same release as the code that stops using a column. Apply them with `go run ./cmd/api migrate up`.
- **JSON:** wire format is snake_case (`json:"rule_pack_version"`). Use `omitempty` only where the OpenAPI field is optional. Money fields are integers in paise; times are RFC 3339 with offset.
- **Time:** inject `ports.Clock`, whose `Now()` returns UTC. Load IST once with `time.LoadLocation("Asia/Kolkata")` in `internal/clock`. Build with `-tags timetzdata` so distroless images carry the zone database.
- **Workflows boundary:** the Go API starts Render Workflows runs through `ports.JobRunner`. The adapter calls the Render REST API `POST /v1/task-runs`, or `http://localhost:8120` in local dev. Business steps that tasks need are Go handlers called back over HMAC-signed `/internal/*` endpoints. Every handler is idempotent by input ([BACKEND](BACKEND.md) §8).

### 4.6 Architecture boundaries (`depguard` + `internal/archtest`)

| Package | May import | Must not import |
|---|---|---|
| `internal/domain` | standard library only (no `os`, `net`, `math/rand`) | anything else |
| `internal/rules` (engine), `internal/journey` (machine), `internal/clock` (schedule) | std, `internal/domain`, `internal/ports` (interfaces only) | `pgx`, `chi`, `net/http`, `google.golang.org/adk`, `google.golang.org/genai`, `go.opentelemetry.io/*`, `internal/adapters/**`, `internal/store`, `internal/httpapi` |
| `internal/ports` | std, `internal/domain` | any implementation package |
| `internal/adapters/<x>` | `ports`, `domain`, their own SDKs | other `internal/adapters/<y>` (adapters meet only in `cmd/api`) |
| `internal/store` | `pgx/v5`, `sqlcgen`, `ports`, `domain` | `httpapi`, `adapters` |
| `internal/httpapi` | `api` (generated), services, `ports`, `domain`, `chi` | `store/sqlcgen`, adapter packages |
| `cmd/api` | everything (composition root) | — |

```yaml
# excerpt of services/api/.golangci.yml
linters:
  settings:
    depguard:
      rules:
        pure:
          files: ["**/internal/domain/**", "**/internal/rules/**", "!**/internal/rules/load*.go", "**/internal/journey/machine*.go", "**/internal/clock/schedule*.go"]
          deny:
            - { pkg: "github.com/jackc/pgx", desc: "pure package: no database" }
            - { pkg: "github.com/go-chi/chi", desc: "pure package: no HTTP" }
            - { pkg: "net/http", desc: "pure package: no HTTP" }
            - { pkg: "google.golang.org/adk", desc: "pure package: no AI" }
            - { pkg: "google.golang.org/genai", desc: "pure package: no AI" }
            - { pkg: "math/rand", desc: "inject a seed source" }
            - { pkg: "github.com/sruj08/margadarshak/services/api/internal/adapters", desc: "domain never sees adapters" }
            - { pkg: "github.com/sruj08/margadarshak/services/api/internal/store", desc: "domain never sees storage" }
```

`internal/archtest/archtest_test.go` backs this up:
- It runs `go list -deps -json ./...` and fails if any pure package transitively imports a forbidden module. It catches what file-glob `depguard` rules miss.
- It also checks that no exported request struct in `api/` or `internal/httpapi` has a JSON tag matching `/aadhaar|uid|otp|biometric|face_match/i` (D-07).

### 4.7 Naming (Go)
| Thing | Convention | Example |
|---|---|---|
| Packages | short, lower case, no underscores, no `util`/`common` | `journey`, `renderworkflows` |
| Files | `snake_case.go`; tests `_test.go` | `fee_quote.go`, `machine_test.go` |
| Exported types | `PascalCase`, no package stutter | `journey.Machine` (not `journey.JourneyMachine`) |
| Ports | noun interfaces in `ports` | `ports.Sarathi`, `ports.Notifier`, `ports.JobRunner` |
| Adapters | package per tech, type `Adapter` / descriptive | `sarathi/deeplink.Adapter`, `jobs/renderworkflows.Runner` |
| Services | `<Noun>Service`, verb methods | `journey.CaseService.RecordEvent(ctx, …)` |
| Constructors | `New…` returning concrete types | `NewCaseService(...) *CaseService` |
| Initialisms | consistent case | `CaseID`, `HTTPClient`, `ParseURL` |
| Enum-like constants | typed string constants | `type Stage string; const StageBridge Stage = "BRIDGE"` |
| Error codes | `SCREAMING_SNAKE_CASE` strings, stable forever | `JOURNEY_INVALID_TRANSITION` |
| DB tables | plural `snake_case` | `timeline_events` |
| Rule IDs | `<KIND>-<SUBJECT>-<DETAIL>` | `TL-RETEST-GAP`, `BLK-DOB-YEAR-ONLY` |
| Env vars | `SCREAMING_SNAKE_CASE`, service prefix when not shared | `SCORE_VERIFIER_HOSTPORT` |
| Test names | `TestThing_condition`; EC tests carry the EC ID | `TestEC05_Minor50ccOnly`, subtest `"EC-07 LL expires before slot"` |

---

## 5. Error handling rules (both languages)
- Validate at the edge, trust inside: once a request is decoded and validated, the domain receives typed values.
- Separate **expected** outcomes from **unexpected** failures:
  - Expected (ineligible, blocker, quota) come back as values or typed `domain.Error` codes.
  - Unexpected (bugs, outages) are logged with `trace_id`, and the user sees a generic message.
- Every external call has a timeout and a documented fallback next to it (template debrief, cached plan, "simulated" status). Budgets:
  - Go `http.Client` default: `Timeout: 5 * time.Second`, dial timeout 2 s.
  - Gemini calls: per-agent budget.
  - Score verifier: 2 s.
  - Render REST API: 5 s.
- Retry only idempotent operations, with jittered exponential backoff. Go uses a small `internal/platform/retry` helper (max 3 attempts, honours `Retry-After`); TS uses the TanStack Query retry. Never retry a 4xx except 408/429.
- User-facing errors are calm and specific, with one action (design B12). Never "FAILED", never red for non-danger.

---

## 6. Logging and redaction

### 6.1 Format
- **Go:** `log/slog` with `slog.NewJSONHandler(os.Stdout, …)`, wrapped by `privacy.RedactingHandler` (§6.3). Built once in `internal/platform/logging` and passed down, so there is no global logger except `slog.SetDefault` in `cmd/api`.
  - Fields: `time` (UTC RFC 3339), `level`, `msg`, `service`, `env`, `version`, `trace_id`, `span_id`, `request_id`, `tenant`, `principal_ref` (HMAC, never raw), `route`, `status`, `duration_ms`.
  - Log with typed attributes (`slog.String("case_id", id.String())`, `slog.Int("status", 409)`), never `fmt.Sprintf` into the message.
  - OpenTelemetry trace and span IDs come from the context (`logger.InfoContext(ctx, …)`).
- **TS** (score verifier, Workflows tasks, Next.js server runtime): each service has a small `log.ts`. It writes one JSON object per line to stdout with the same field names and applies the same redaction patterns (§6.3). Browser logs reach the server only through Sentry (scrubbed) and API-63 (aggregated analytics).

### 6.2 What must never be logged
| Never | Why | Control |
|---|---|---|
| Aadhaar-like numbers, OTPs, PINs | Aadhaar Act, D-07 | redaction handler + tests |
| Phone, email, name, address, DOB | DPDP data minimisation | redact; log `contact_ref` (HMAC) instead |
| Session tokens, magic-link tokens, HMAC signatures, API keys (incl. `RENDER_API_KEY`, `GEMINI_API_KEY`) | security | header allow-list; `Authorization`, `Cookie`, `X-Signature` dropped |
| Request/response bodies of `/v1/cases/*`, `/v1/me/*`, AI endpoints | PII | body logging disabled; only sizes |
| Prompt text and model output | may echo PII, including a minor family member's | stored only in the `debriefs` table with 7-day prompt retention, never in logs |
| Camera frames, audio, screenshots | D-07, privacy | never leave memory; never logged |
| Exact location | not collected | — |

### 6.3 Redaction handler (shared patterns, unit-tested in both languages)
The pattern list below is normative. TS mirrors it in `log.ts`.

```go
// services/api/internal/privacy/redact.go
var redactions = []struct {
    re   *regexp.Regexp
    repl string
    // check, if set, must also pass (cuts false positives on 12-digit IDs)
    check func(match string) bool
}{
    {regexp.MustCompile(`\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b`), "[aadhaar]", verhoeffValid},
    {regexp.MustCompile(`[२-९][०-९]{3}[\s-]?[०-९]{4}[\s-]?[०-९]{4}`), "[aadhaar]", nil}, // Devanagari digits
    {regexp.MustCompile(`(?i)\b(otp|ओटीपी|code|कोड)\D{0,12}\d{4,8}\b`), "[otp]", nil},
    {regexp.MustCompile(`\b(?:\+?91[\s-]?)?[6-9]\d{9}\b`), "[phone]", nil},
    {regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`), "[email]", nil},
    {regexp.MustCompile(`(?i)bearer\s+[a-z0-9._-]+`), "bearer [token]", nil},
}

// RedactingHandler wraps any slog.Handler. It rewrites the message and every
// string attribute (recursively through groups, max depth 4), including error
// values rendered with err.Error(). Keys in dropKeys ("authorization", "cookie",
// "x-signature", "otp", "aadhaar") are removed entirely.
type RedactingHandler struct{ next slog.Handler }
```

`privacy.Redact(s string) string` is the same function. It is applied to every text that reaches an AI agent (EC-20) and to transcripts before storage.

Tests:
- A CI test feeds a corpus of synthetic identifiers through every logger constructor and asserts that nothing survives. The identifiers are generated at test time from a fixed seed with valid Verhoeff check digits, never committed as a list, and never paired with any personal data ([TESTING](TESTING.md) §2).
- A fuzz test (`FuzzRedact`) asserts that the output never contains a Verhoeff-valid 12-digit run.

### 6.4 Levels
| Level | Use |
|---|---|
| `DEBUG` | local only |
| `INFO` | state changes (case transitions with IDs only, job start/finish) |
| `WARN` | degraded paths (fallback template, adapter down, replay mismatch) |
| `ERROR` | unexpected failures, with `trace_id` |
| `ERROR` + `security=true` | security events (HMAC failures above threshold, RLS violation attempts) → n8n W12 alert |

slog has no CRITICAL level, so security events are `ERROR` with `security=true`. Audit events (E-30) go to the audit table through `internal/audit`, not to logs.

---

## 7. Comments and documentation
- Write comments for **why** (a legal source, a trade-off, a bug workaround with its issue link), not for what the code says.
- Every rule-derived constant in code cites its rule ID, not a law text: `// TL-RETEST-GAP (rulepack timelines.json)`.
- Exported identifiers in `internal/domain`, `internal/rules`, `internal/journey`, `internal/clock` and `packages/game-core` have doc comments (Go `// Name …`, TSDoc). Each states purpose, invariants, determinism guarantees and units (paise, ms, metres). `revive`'s `exported` rule enforces this for Go.
- Workarounds carry `// WORKAROUND(<issue-url>): … remove when …` and an owner.
- `TODO` requires an owner and a date: `TODO(backend-lead, 2026-10-30): …`. Lint rejects a bare `TODO`.
- No commented-out code (revive / Biome GritQL rule).
- ADRs record decisions (`docs/03-engineering/adr/`), and comments link to them (`see ADR-0011`).

---

## 8. AI-specific code rules
- Prompts live in `ai/prompts/<agent>.md` with a version header, and code references them by ID (embedded at build time or read from `PROMPT_DIR`). Changing a prompt requires the agent's eval suite to pass (`go test -tags evals ./internal/adapters/ai/evals/...`, see [TESTING](TESTING.md) §7).
- Agents use ADK for Go (`google.golang.org/adk` v1.9.0: `llmagent.New`, `runner.New`, `Runner.Run`, `Runner.RunLive` for voice) and the Go Gemini SDK (`google.golang.org/genai` v1.76.0).
- Model IDs come only from env (`GEMINI_MODEL_DEBRIEF`, `GEMINI_MODEL_VISION`, `GEMINI_MODEL_LIVE`, `GEMINI_MODEL_LIVE_FALLBACK`), read in `internal/platform/config`. Never hard-code them.
- LLM output is untrusted input. Decode it into the agent's Go struct (with `OutputSchema` set on the `llmagent.Config`), validate it (digits, IDs, placeholders, tone, script ratio) and escape it before render.
- Each agent exposes a closed list of tools (`functiontool.New` with typed args). Adding a tool needs an ADR and a red-team eval case. No tool may submit, pay, book or call Sarathi (D-09).
- No rupee literal or number in prompt text (D-06); facts are injected through state.
- AI for everyone (D-13 revised): agents do not branch on age. The only gate is consent:
  - The account holder's AI purpose consent.
  - For a minor family member's case, the parental consent artefact.

  Both are checked once in `privacy.Authorize`.

---

## 9. Game-core rules
- Pure TypeScript, `zod` only; built as ESM; consumed by the browser and `services/score-verifier`.
- Fixed 60 Hz step; seeded `mulberry32`; quantised inputs. No floating-point accumulation across frames without rounding to the quantum defined in the manifest.
- Every scoring change bumps `scoringVersion` (semver) and adds replay fixtures. Old versions stay importable so old sessions can be re-verified.
- Score = Σ components, each with an `explainKey`; findings carry the `facts` used by the debrief.

---

## 10. Review checklist (copy into PR review)

**Correctness and facts**
- [ ] No fee/age/date/score computed outside the rules engine, case clock or game-core.
- [ ] No ₹ literal or banned wording (lint green).
- [ ] New/changed rules have `source`, `verified_on`, `confidence`; `verify: true` where unverified.
- [ ] Golden tests updated for any rule/fee/journey change (Go engine and TS mirror both green).

**Privacy and security**
- [ ] No Aadhaar/OTP/biometric collection; no new PII field without a data-inventory entry in PRIVACY.
- [ ] Logs contain no PII (redaction test still green); no new body logging.
- [ ] AuthZ via `privacy.Authorize`; tenant scoping (`UnitOfWork`, RLS) respected.
- [ ] Family mode: parental consent checked for a minor's case; no analytics, streak nudges or ads on a child's data.
- [ ] External calls have timeouts and fallbacks; secrets only from env.

**Accessibility and UX**
- [ ] axe clean; keyboard and TalkBack path works; 48 px targets; 18 px text; no colour-only status.
- [ ] Strings via i18n keys in `en` and `hi`; layout survives +40% text.
- [ ] Reduced motion honoured; no > 3 flashes/s.
- [ ] Lite/2G budget unchanged or within headroom (`size-limit` green).

**Engineering**
- [ ] `gofmt`, `go vet`, golangci-lint and `govulncheck` green; TS types strict, no `any`.
- [ ] Every error handled and wrapped; `ctx` first on I/O functions; no goroutine without an owner.
- [ ] Architecture boundaries (`depguard`, `internal/archtest`, Biome restricted imports) green.
- [ ] Generated code regenerated (`go generate ./...` leaves no diff).
- [ ] Tests at the right level of the pyramid; contract tests for any adapter change.
- [ ] Idempotency for new mutations; error codes from the catalogue.
- [ ] Docs/ADR updated if behaviour or a decision changed.

---

## 11. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| Lint strictness | Errors on: facts, wording, a11y, security, types, `gofmt`, `go vet`. Full golangci-lint set runs if `.golangci.yml` is present; `md/no-jsx-literal` warns until H24, then errors | Everything errors; coverage gates enforced on all packages |
| Review | One reviewer (module owner per D-24) | Two reviewers for `internal/domain`, `internal/rules`, `rulepacks/`, auth, AI prompts; CODEOWNERS enforced |
| Security tools | `govulncheck`, `gosec`, `pnpm audit`, `detect-secrets` in CI | + SAST (CodeQL for Go and TS), DAST, SBOM (CycloneDX), signed builds, STQC/VAPT pre-audit |
