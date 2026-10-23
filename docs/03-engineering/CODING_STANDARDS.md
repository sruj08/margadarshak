# Coding Standards
> Project: Margdarshak · Owner: Tech lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [Project Brief](../00-overview/PROJECT_BRIEF.md) · [Frontend](FRONTEND.md) · [Backend](BACKEND.md) · [Git Workflow](GIT_WORKFLOW.md) · [Testing](TESTING.md) · [Security Architecture](../06-security-compliance/SECURITY_ARCHITECTURE.md) · [Privacy](../06-security-compliance/PRIVACY.md) · [Observability](../05-ops/OBSERVABILITY.md)

These standards apply to every line in the monorepo: TypeScript (`apps/*`, `packages/*`, `services/score-verifier`) and Python (`services/api`, `services/workflows`, `scripts/*.py`). Tooling enforces almost all of it; the review checklist (§10) covers the rest.

**Priority order when rules conflict:** safety and privacy of users → correctness of facts (rules, fees, dates, scores) → accessibility → readability → performance → brevity.

---

## 1. Tooling summary (pinned)

| Concern | TypeScript | Python |
|---|---|---|
| Formatter | **Biome 2.6.2** (`biome format`) | **Ruff 0.17.2** (`ruff format`) |
| Linter | **Biome 2.6.2** (`biome lint`), plus `eslint` 10.13.0 + `eslint-config-next` 16.4.3 **only** for Next.js-specific rules Biome lacks (`@next/next/*`, core-web-vitals) | **Ruff 0.17.2** (`ruff check`, rule sets in §4.2) |
| Types | `tsc --noEmit` (TypeScript 6.0.3, `strict` + extras, §3.1) | **mypy 2.4.0 `--strict`** + Pydantic plugin |
| Architecture | Biome `noRestrictedImports` + `knip` 6.42.1 (unused exports/deps) | **import-linter 2.15** contracts (§4.6), `deptry` 0.25.1 |
| Security | `pnpm audit --prod`, Biome `noDangerouslySetInnerHtml` (error) | `pip-audit` 2.10.1, `bandit` 1.9.4 |
| Secrets | `detect-secrets` 1.5.0 (pre-commit hook + CI) | same |
| Git hooks | `lefthook` 2.2.2: pre-commit = format + lint staged; commit-msg = commitlint 21.2.4 | same hooks call `uv run ruff` |

`pnpm lint` and `pnpm typecheck` at the root run everything (see root `package.json`). CI fails on any warning in changed files.

---

## 2. Universal rules (both languages)

1. **Facts come from code, never from strings.** No rupee amounts, ages, day counts or pass marks typed in UI copy, prompts, messages or tests' expected UI text except golden fixtures. Fees come from `fees.json`, dates from the rules engine, scores from `game-core` (D-06, D-09).
   - Lint: `md/no-inr-literal` (GritQL plugin in Biome; a Ruff-compatible check in `scripts/lint_facts.py`) fails on `₹\s?\d`, `Rs\.?\s?\d`, `INR\s?\d` in `*.tsx`, `*.ts`, `messages/*.json`, `ai/prompts/**`, `*.py` (except `rulepacks/**` and `tests/golden/**`).
2. **Wording bans (D-19)** are lint errors in UI strings, prompts, docs-in-app and README: "first" (as in first-ever), "official", "doesn't exist", "DPDP-compliant", "STQC-certified", "integrated with Sarathi", "integrated with Aadhaar", "verified licence", "lives saved", "Saarthi", "safe" as a scam verdict, "you would crash", "unsafe driver". Implemented by `scripts/lint_wording.ts` with an allow-list for legitimate uses (e.g. "first name", "first-aid") reviewed in PRs.
3. **Never collect or log** an Aadhaar number, OTP, biometric or face template (D-07). No input component may have `name`/`id` matching `/aadhaar|uid|otp/i` (lint).
4. **Under-18 gating** is decided by one function per side (`isAdult(principal)` in TS UI, `authorize()` in Python). Do not re-implement age checks inline.
5. **Time:** store and compare in UTC (`timestamptz` / `Date` epoch ms); compute calendar days in `Asia/Kolkata`. Server time is truth (EC-15). Never call `datetime.now()` / `Date.now()` in domain code; inject `ClockPort` / `serverClock`.
6. **Money:** integers in **paise**. No floats in money paths (Ruff banned-API + Biome GritQL rule on `domain/fees` and `features/plan`).
7. **IDs:** UUIDv7 for entities (sortable), never sequential integers in URLs. Rule IDs are human-readable stable strings (`ELIG-MC50-16`).
8. **Determinism:** game scoring and rule evaluation must be pure; no `Math.random`, `Date`, `performance.now` or I/O inside `packages/game-core/src/scoring|sim` or `services/api/src/margdarshak/domain` (lint).
9. **Accessibility is a correctness property:** a component that fails axe or keyboard use is a bug, not polish.
10. **Comments explain why, not what** (§7).

---

## 3. TypeScript standards

### 3.1 Compiler settings (from `tsconfig.base.json`)
`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `useUnknownInCatchVariables: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `moduleResolution: "bundler"`, `target: "ES2022"`. No `any` (Biome `noExplicitAny: error`); use `unknown` + Zod parsing.

### 3.2 Style
- Biome formatter: 2-space indent, line width 100, double quotes, semicolons always, trailing commas `all`, arrow parens always.
- Prefer `type` aliases for data, `interface` only for extendable contracts (Game SDK).
- Discriminated unions with exhaustive `switch` + `assertNever(x)` for every state enum (journey stage, voice state, game event type).
- No default exports except where Next.js requires them (`page.tsx`, `layout.tsx`, `route.ts`, `sw.ts`, config files).
- No barrel re-exports inside `features/*` except the single public `index.ts`.
- `async` functions return `Promise<Result>`; errors crossing a boundary are typed `AppError` (from problem+json `code`).

### 3.3 React and Next.js
- Server Components by default; `"use client"` only for interactivity, browser APIs or HeroUI components that require it.
- Heavy client modules (Phaser, MediaPipe, Rive, Lottie, voice worklets) only via `next/dynamic` with `ssr: false`.
- HeroUI v3: compound components (`<Card><Card.Header>`), semantic variants, `onPress`. No raw hex colours in components; use tokens/utilities.
- State: TanStack Query for server state, Zustand for UI state, URL for navigation state (see [FRONTEND](FRONTEND.md) §4). No server data in Zustand.
- Hooks: one concern per hook, named `useX`; effects must clean up (Phaser `destroy(true)`, `cancelVideoFrameCallback`, `AudioContext.close()`).
- Every interactive element: visible label (text, not only icon), ≥ 48 × 48 px, focus ring from tokens.
- Forms: one question per screen for the application flow; error summary + inline error; `autocomplete` attributes set; `inputmode` for numeric fields (but **never** a numeric field for Aadhaar/OTP — they do not exist).
- i18n: all user-visible text via `next-intl` keys; no string literals in JSX except punctuation (Biome GritQL rule `md/no-jsx-literal`, warn → error before H24).

### 3.4 Import boundaries (Biome `noRestrictedImports` + paths)
| From | May import | May not import |
|---|---|---|
| `apps/web/src/features/<a>` | `@/lib/*`, `@/stores/*`, `@margdarshak/*`, own files, other features' `index.ts` | other features' internals |
| `packages/game-core` | `zod` only | React, Phaser, DOM, Node APIs |
| `packages/rules` | `zod` only | anything app-specific |
| `packages/ui` | React, HeroUI, tokens | `apps/*`, `api-client` |
| `apps/console` | `@margdarshak/ui`, `api-client`, `rules` | `game-core` runtime (types only) |

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
| Booleans | `is/has/can/should` prefix | `isAdult` |

---

## 4. Python standards

### 4.1 Language level
Python **3.12** (`requires-python = ">=3.12,<3.13"`). Use `type` statement aliases, `StrEnum`, `dataclass(slots=True, frozen=True)` for domain values, PEP 695 generics where they help.

### 4.2 Ruff configuration (in `services/api/pyproject.toml`)
- `line-length = 100`, `target-version = "py312"`.
- Rule sets: `E, W, F, I (isort), N (naming), UP (pyupgrade), B (bugbear), A, C4, DTZ (no naive datetimes), T20 (no print), RET, SIM, PTH, ERA (no commented-out code), PL (pylint subset), RUF, S (bandit-style security), ASYNC, FAST (FastAPI), PT (pytest), TID (banned imports), TC (type-checking imports), ARG, PIE, PERF, LOG, G (logging format)`.
- `flake8-tidy-imports.banned-api`: `datetime.datetime.now` (use ClockPort), `random` in `margdarshak.domain` (use injected `SeedGenerator`), `print`, `pickle`, `eval`, `exec`, `yaml.load` (use `safe_load`), `requests` (use `httpx`).
- Per-file ignores: `tests/**` may use `S101` (assert), `PLR2004` (magic values).

### 4.3 mypy strict
`strict = true`, `warn_unreachable = true`, `disallow_any_explicit = true` for `margdarshak.domain` and `margdarshak.application`, `plugins = ["pydantic.mypy"]`. Third-party gaps get `types-*` stubs or a narrowly scoped `[[tool.mypy.overrides]] ignore_missing_imports` with a comment explaining why. `# type: ignore[code]` requires the code and a reason comment.

### 4.4 Style and patterns
- Async all the way in I/O layers (FastAPI, SQLAlchemy async with psycopg 3, httpx). Domain is sync and pure.
- Pydantic v2 for boundary DTOs (`extra="forbid"`, `strict=True`); frozen dataclasses for domain objects. Do not leak ORM models out of `adapters/outbound/db`.
- Dependency injection via the composition root (`bootstrap/container.py`) and FastAPI `Depends` only at the inbound edge. No module-level singletons that hold connections.
- Errors: raise typed `DomainError` subclasses with a stable `code`; never `raise Exception("...")`; never swallow exceptions (`except Exception: pass` is banned by Ruff `S110`/`BLE`). Map to problem+json in one place (see [BACKEND](BACKEND.md) §14).
- SQL: SQLAlchemy 2 Core/ORM with bound parameters only; raw SQL only in migrations or `text()` with bound params, reviewed.
- Every Alembic migration is reversible and follows expand → migrate → contract; no destructive change in the same release as the code that stops using a column.
- Workflows tasks: idempotent by input, re-read state from DB, unique keys on writes (see [BACKEND](BACKEND.md) §8).

### 4.5 Naming (Python)
| Thing | Convention | Example |
|---|---|---|
| Modules/packages | `snake_case` | `case_clock.py` |
| Classes | `PascalCase` | `FeeQuote`, `SarathiPort` |
| Ports | `<Thing>Port` (Protocol) | `NotificationPort` |
| Adapters | `<Tech><Thing>Adapter` / `<Tech><Thing>` | `SarathiDeeplinkAdapter`, `RenderWorkflowsJobRunner` |
| Application services | `<Noun>Service` with verb methods | `CaseService.record_event()` |
| Functions | `snake_case`, verb first | `compute_fee_quote` |
| Constants | `SCREAMING_SNAKE_CASE` | `RETEST_GAP_RULE_ID` |
| Error codes | `SCREAMING_SNAKE_CASE`, stable forever | `JOURNEY_INVALID_TRANSITION` |
| DB tables | plural `snake_case` | `timeline_events` |
| Rule IDs | `<KIND>-<SUBJECT>-<DETAIL>` | `TL-RETEST-GAP`, `BLK-DOB-YEAR-ONLY` |
| Env vars | `SCREAMING_SNAKE_CASE`, service prefix when not shared | `SCORE_VERIFIER_URL` |

### 4.6 import-linter contracts
```ini
[importlinter:contract:layers]
name = Hexagonal layers
type = layers
layers =
    margdarshak.bootstrap
    margdarshak.adapters
    margdarshak.application
    margdarshak.ports
    margdarshak.domain

[importlinter:contract:domain-pure]
name = Domain imports no frameworks
type = forbidden
source_modules = margdarshak.domain
forbidden_modules = fastapi, sqlalchemy, httpx, redis, google.adk, google.genai, render_sdk, structlog, opentelemetry

[importlinter:contract:adapters-independent]
name = Adapters do not import each other
type = independence
modules =
    margdarshak.adapters.outbound.db
    margdarshak.adapters.outbound.gov
    margdarshak.adapters.outbound.ai
    margdarshak.adapters.outbound.notify
    margdarshak.adapters.outbound.jobs
```
(Kept under `[tool.importlinter]` in `services/api/pyproject.toml`; `lint-imports` reads it from there.)

---

## 5. Error handling rules
- Validate at the edge, trust inside: once a DTO is parsed, the domain receives typed values.
- Distinguish **expected** outcomes (ineligible, blocker, quota) — returned as values or typed errors with codes — from **unexpected** failures (bugs, outages) — logged with `traceId`, generic message to the user.
- Every external call has a timeout (httpx default `Timeout(5.0, connect=2.0)`; Gemini calls per agent budget; score verifier 2 s) and a fallback documented next to it (template debrief, cached plan, "simulated" status).
- Retries only for idempotent operations, with jittered exponential backoff (`tenacity` 9.2.1 in Python; TanStack Query retry in TS), never for 4xx except 408/429.
- User-facing errors are calm and specific with one action (design B12); never "FAILED", never red for non-danger.

---

## 6. Logging and redaction

### 6.1 Format
- Python: `structlog` 26.1.0 JSON to stdout; fields `ts` (UTC ISO), `level`, `event`, `service`, `env`, `version`, `trace_id`, `span_id`, `request_id`, `tenant`, `principal_ref` (hashed, never raw), `route`, `status`, `duration_ms`.
- TS (score verifier, Next.js server runtime): each service has a small `log.ts` that writes one JSON object per line to stdout with the same field names and runs the same redaction patterns (§6.3). Browser logs never reach the server except through Sentry (scrubbed) and API-63 (aggregated analytics).

### 6.2 What must never be logged
| Never | Why | Control |
|---|---|---|
| Aadhaar-like numbers, OTPs, PINs | Aadhaar Act, D-07 | redaction processor + tests |
| Phone, email, name, address, DOB | DPDP data minimisation | redact; log `contact_ref` (HMAC) instead |
| Session tokens, magic-link tokens, HMAC signatures, API keys | security | header allow-list; `Authorization`, `Cookie`, `X-Signature` dropped |
| Request/response bodies of `/v1/cases/*`, `/v1/me/*`, AI endpoints | PII | body logging disabled; only sizes |
| Prompt text and model output | may echo PII; minors | stored only in the `debriefs` table with 7-day prompt retention, never in logs |
| Camera frames, audio, screenshots | D-07, privacy | never leave memory; never logged |
| Exact location | not collected | — |

### 6.3 Redaction processor (shared patterns, unit-tested in both languages)
```python
# services/api/src/margdarshak/bootstrap/logging.py (pattern list is normative)
REDACTIONS = [
    (re.compile(r"\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b"), "[aadhaar]"),
    (re.compile(r"(?i)\b(otp|ओटीपी|code|कोड)\D{0,12}\d{4,8}\b"), "[otp]"),
    (re.compile(r"\b(?:\+?91[\s-]?)?[6-9]\d{9}\b"), "[phone]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"(?i)bearer\s+[a-z0-9._-]+"), "bearer [token]"),
    (re.compile(r"[०-९]{4}[\s-]?[०-९]{4}[\s-]?[०-९]{4}"), "[aadhaar]"),   # Devanagari digits
]
```
The processor runs on every string value in the event dict (recursively, max depth 4) and on exception messages. A CI test feeds a corpus of fake identifiers (generated, never real) through every logger and asserts nothing survives.

### 6.4 Levels
`DEBUG` local only; `INFO` state changes (case transitions with IDs only, job start/finish); `WARNING` degraded paths (fallback template, adapter down, replay mismatch); `ERROR` unexpected failures with `trace_id`; `CRITICAL` security events (HMAC failures above threshold, RLS violation attempts) → n8n W12 alert. Audit events (E-30) go to the audit table, not logs.

---

## 7. Comments and documentation
- Write comments for **why** (a legal source, a trade-off, a bug workaround with its issue link), not what the code says.
- Every rule-derived constant in code cites its rule ID, not a law text: `# TL-RETEST-GAP (rulepack timelines.json)`.
- Public functions in `domain/` and `packages/game-core` have docstrings/TSDoc with: purpose, invariants, determinism guarantees, units (paise, ms, metres).
- Workarounds carry `# WORKAROUND(<issue-url>): … remove when …` and an owner.
- `TODO` requires an owner and a date: `TODO(backend-lead, 2026-10-30): …` (lint rejects bare `TODO`).
- No commented-out code (Ruff `ERA`, Biome GritQL rule).
- ADRs record decisions (`docs/03-engineering/adr/`); comments link to them (`see ADR-0004`).

---

## 8. AI-specific code rules
- Prompts live in `ai/prompts/<agent>/<version>.md` with a version header; code references them by ID. Changing a prompt requires the agent's eval suite to pass (see [TESTING](TESTING.md) §7).
- Model IDs only from env (`DEBRIEF_MODEL`, …); never hard-coded.
- LLM output is untrusted input: parse with the schema, validate (digits, IDs, placeholders, tone, script ratio), escape before render.
- Tools exposed to agents are a closed list per agent; adding a tool needs an ADR and a red-team eval case. No tool may submit, pay, book or call Sarathi (D-09).
- No rupee literal or number in prompt text (D-06); facts are injected through state.

---

## 9. Game-core rules
- Pure TypeScript, `zod` only; built as ESM; consumed by the browser and `services/score-verifier`.
- Fixed 60 Hz step; seeded `mulberry32`; quantised inputs; no floating-point accumulation across frames without rounding to the quantum defined in the manifest.
- Every scoring change bumps `scoringVersion` (semver) and adds replay fixtures; old versions stay importable so old sessions can be re-verified.
- Score = Σ components, each with an `explainKey`; findings carry `facts` used by the debrief.

---

## 10. Review checklist (copy into PR review)

**Correctness and facts**
- [ ] No fee/age/date/score computed outside the rules engine, case clock or game-core.
- [ ] No ₹ literal or banned wording (lint green).
- [ ] New/changed rules have `source`, `verified_on`, `confidence`; `verify: true` where unverified.
- [ ] Golden tests updated for any rule/fee/journey change.

**Privacy and security**
- [ ] No Aadhaar/OTP/biometric collection; no new PII field without a data-inventory entry in PRIVACY.
- [ ] Logs contain no PII (redaction test still green); no new body logging.
- [ ] AuthZ via `authorize()`; tenant scoping and RLS respected; under-18 gate applied for AI/telemetry/streaks.
- [ ] External calls have timeouts and fallbacks; secrets only from env.

**Accessibility and UX**
- [ ] axe clean; keyboard and TalkBack path works; 48 px targets; 18 px text; no colour-only status.
- [ ] Strings via i18n keys in `en` and `hi`; layout survives +40% text.
- [ ] Reduced motion honoured; no > 3 flashes/s.
- [ ] Lite/2G budget unchanged or within headroom (`size-limit` green).

**Engineering**
- [ ] Types strict; no `any` / unexplained `type: ignore`.
- [ ] Architecture boundaries (import-linter, Biome restricted imports) green.
- [ ] Tests at the right level of the pyramid; contract tests for any adapter change.
- [ ] Idempotency for new mutations; error codes from the catalogue.
- [ ] Docs/ADR updated if behaviour or a decision changed.

---

## 11. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| Lint strictness | Errors on: facts, wording, a11y, security, types. `md/no-jsx-literal` warns until H24, then errors | Everything errors; coverage gates enforced on all packages |
| Review | One reviewer (module owner per D-24) | Two reviewers for `domain/`, `rulepacks/`, auth, AI prompts; CODEOWNERS enforced |
| Security tools | `pip-audit`, `pnpm audit`, `bandit`, `detect-secrets` in CI | + SAST (Semgrep/CodeQL), DAST, SBOM (CycloneDX), signed builds, STQC/VAPT pre-audit |
