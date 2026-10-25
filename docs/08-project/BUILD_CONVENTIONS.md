# Build Conventions (P0 + P1 implementation, 23 Oct 2026)
> Binding for every person and AI agent writing code. If this file disagrees with older docs, this file and PROJECT_BRIEF win until the docs are updated.

## 1. Decisions made today
1. **Backend language is Go** (ADR-0011 supersedes ADR-0002).
   - Go 1.27 (installed locally).
   - Module `github.com/sruj08/margadarshak/services/api`.
   - No Python anywhere in the repo.
2. **AI for everyone** (D-13 revised). Every AI feature is available to every user. A learner aged 16–17 uses Margdarshak on a parent's phone, inside the parent's (adult) account, in family mode. There is no "u18 = rules only" gate.
   - What remains: the *account holder* is an adult who gives consent, including verifiable parental consent for a minor family member's case.
   - What remains: no behavioural tracking or targeted ads on a child's data.
   - What remains: squads and share cards for a minor's profile need the parent's consent.
3. **TypeScript is used for everything else:**
   - web and console (Next.js 16)
   - the `packages/*`
   - the score verifier (Node)
   - Render Workflows tasks (`services/workflows`, TS SDK `@renderinc/sdk`)
4. **Commits:** do not `git commit` or `git push`. The team reviews and commits.

## 2. Environment facts
| Item | Value |
|---|---|
| OS | Windows 11 (bash and PowerShell available) |
| Go | 1.27 |
| Node | 22.19 |
| pnpm | 11.9 installed; `packageManager` says 12.15.0. Use `corepack pnpm` if that works, else the installed pnpm; never fail on this |
| Docker | **Not available.** Go tests use `github.com/fergusstrange/embedded-postgres` (real Postgres 16, no Docker). `infra/docker/compose.yaml` stays for teammates who have Docker |
| Network | Available (Go proxy, npm registry) |

## 3. Repository layout and ownership
| Path | What | Owner (agent) |
|---|---|---|
| `services/api/` | Go API. `cmd/api` (main), `cmd/seed`, `internal/{platform,httpapi,domain,ports,adapters,rules,journey,clock,privacy,notify,store,audit,jobs,tenant}`, `migrations/` (goose SQL), `api` codegen output | BE-platform (P0), BE-journey (P1); **rules** subpackage: RULES agent |
| `services/api/internal/rules/` | Authoritative rules engine (Go) | RULES |
| `rulepacks/` | `schema/rulepack.schema.json`, `base/cmvr.json`, `states/{JK,DL,KL,MH,TN,PB}.json`, `fees.json`, `classes.json`, `CHANGELOG.md` | RULES |
| `tests/golden/` | Shared golden cases (JSON) run by both the Go engine and the TS mirror | RULES |
| `packages/rules/` | TS mirror of the engine + types (zero runtime deps; tested with `node --test --experimental-strip-types`) | RULES |
| `packages/ui/` | Tokens (exists) + component kit | FE |
| `apps/web/` | Citizen PWA | FE (P0), FE-journey (P1) |
| `packages/api-client/` | Typed client generated from `api/openapi.yaml` | FE |
| Root tooling (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `scripts/lint_*`) | Monorepo tooling | FE |
| `.github/`, `infra/`, `docs/`, `CLAUDE.md`, `README.md` | Docs, CI and infra | DOCS agents |
| `services/workflows/` | Render Workflows tasks (TS) | WORKFLOWS (P1) |
| `n8n/workflows/` | n8n exports | WORKFLOWS (P1) |

**Go dependencies:** only BE-platform may run `go get` / `go mod tidy` in P0, so `go.mod` never conflicts. Other agents use what is in `go.mod`. If they need something new, they ask in their final report.

## 4. Engineering rules (from the bible)
- **Contract-first:** HTTP handlers implement `api/openapi.yaml` (oapi-codegen `chi-server` + strict server, or hand-written handlers that match the spec exactly). Errors are RFC 9457 `application/problem+json`.
- **Money:** integer paise only. ₹700 for one class = 70000. Fees always come from `rulepacks/fees.json` (CMVR r.32), never from literals in UI copy.
- **Time:** server time in IST (`Asia/Kolkata`) is the source of truth (EC-15).
- **Identity and PII:** never collect, store or log Aadhaar numbers, VIDs, OTPs, biometrics or face images. The PII redactor masks 12-digit Aadhaar-like numbers (Verhoeff), OTP-like codes and phone numbers in logs and AI inputs.
- **Wording:** every user-facing page shows the non-affiliation footer. The D-19 bans are enforced by `scripts/lint_wording.*`.
- **Tests:** every rule change ships with golden tests. Every EC owned by P0/P1 has a test (named `EC-xx` in the test name).
- **Quality gates:**
  - Go: `go vet ./...`, `go test ./...`, `gofmt` (golangci-lint if available).
  - TS: Biome + `tsc --noEmit` + Vitest.

## 5. Definition of done for this build (P0 + P1)
- P0 and P1 definitions of done from `IMPLEMENTATION_PLAN.md` §5.1 and §5.2.
- Adjustments:
  - "Python" reads as "Go".
  - The u18 gating test becomes a family-mode/parental-consent test.
  - "Render deploy" and "WhatsApp test number" items are prepared and documented, but need team credentials to run live.
  - Every agent reports exactly what was run and passed.
