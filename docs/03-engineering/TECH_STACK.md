# Tech Stack
> Project: Margdarshak · Owner: Tech lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [Architecture](ARCHITECTURE.md) · [Backend](BACKEND.md) · [Frontend](FRONTEND.md) · [Data model](DATA_MODEL.md) · [API spec](API_SPEC.md) · [Integrations](INTEGRATIONS.md) · [Environment setup](ENVIRONMENT_SETUP.md) · [PROJECT_BRIEF §8](../00-overview/PROJECT_BRIEF.md)

**How versions were checked.** Every npm version below was read from `https://registry.npmjs.org/<pkg>/latest` (or the exact version URL) and every Go module version from `https://proxy.golang.org/<module>/@latest` on **2026-10-23**; runtimes from `go.dev/dl/?mode=json`, `nodejs.org/dist/index.json` and Docker Hub tags. Pins are **exact** (`go.mod` + `go.sum` for Go, no `^` in `package.json`). Re-pin at H0 if a security release lands; Renovate proposes updates weekly afterwards. Anything not checked this way is marked **[unverified]** with an owner.

**Language split (D-17 revised, ADR-0011, 23 Oct 2026).** The backend API is **Go**; the web app, console, `packages/*`, the score verifier and the Render Workflows tasks are **TypeScript**. **There is no Python anywhere in the repository**, scripts and CI included. (The backend was specified in Python until 23 Oct 2026; ADR-0011 supersedes ADR-0002.)

**The Karpathy test for every row:** does this choice make the 48-hour build *simpler* and the adoption path *possible*? If a layer adds a moving part without paying for itself in the three deep slices (plan → guided LL application; Nazar + debrief + field study; stage-aware home + clock sweep), it is cut.

---

## 1. Runtimes and tooling
| Layer | Choice | Version (checked) | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Go | Go toolchain | **1.27** (`go 1.27.0` in `services/api/go.mod`; go1.27.3 is the current stable on go.dev, 2026-10-23; build image `golang:1.27-bookworm`) | PROJECT_BRIEF §8, ADR-0011; one static binary, fast cold start, small memory on Render's 0.5–1 CPU plans; ADK for Go has `RunLive` for voice | Python 3.12 (the earlier choice, superseded), Java (heavy) | BSD-3-Clause |
| Go module | `github.com/sruj08/margadarshak/services/api` | — | one module for the API; `cmd/api`, `cmd/seed`, `internal/...` | multi-module repo | — |
| Node.js | Node LTS line 22 | **22.23.4** (`node:22.23.4-bookworm-slim`) | the team's ENVIRONMENT_SETUP pin; Next 16 needs ≥ 20.9; score verifier and Workflows tasks run the same line | Node 24.22.1 "Krypton" LTS is newer — move after the event (owner Platform lead, 2026-11-15) | MIT |
| JS packaging | pnpm (Corepack) | **12.15.0** | workspaces for `apps/*`, `packages/*`, `services/score-verifier`, `services/workflows` | npm, yarn | MIT |
| Monorepo tasks | Turborepo | **2.11.10** | cached `build/test/lint` across TS workspaces | Nx (heavier) | MIT |
| Containers | Docker / OCI images | base images above, pinned by digest in CI; API runtime image `gcr.io/distroless/static-debian12:nonroot` (static Go binary, `CGO_ENABLED=0`) | Render deploys Docker; same images go to Kubernetes (D-17) | buildpacks only | — |

## 2. Frontend (citizen PWA `apps/web`, console `apps/console`)
Full table with usage notes: [FRONTEND §1.1](FRONTEND.md). Summary of the load-bearing pins:

| Layer | Choice | Version | Why (Karpathy) | Rejected | Licence |
|---|---|---|---|---|---|
| Framework | Next.js (App Router, RSC, Turbopack) | **16.4.3** | RSC keeps Lite mode < 300 KB; OG image routes for share cards; one TS codebase for web + console | Remix, Vite SPA (no RSC streaming for Lite) | MIT |
| UI runtime | React / React DOM | **19.3.1** | required by Next 16 | — | MIT |
| Language | TypeScript | **6.0.3** | 7.0.2 (native) is `latest` but tooling peer ranges still declare 5/6 (FRONTEND §1.1) | TS 7 now | Apache-2.0 |
| Components | HeroUI v3 (`@heroui/react`, `@heroui/styles`) | **3.2.6** | team's Vakyam stack; React Aria underneath gives keyboard + screen-reader behaviour (WCAG 2.1 AA, F-52) | MUI (heavy), shadcn (more assembly) | MIT |
| Styling | Tailwind CSS (+ `tailwind-variants` 3.3.1) | **4.3.3** | CSS-first tokens; UX4G skin as a token alias layer (F-58) | CSS-in-JS | MIT |
| i18n | next-intl | **4.14.9** | ICU messages, en/hi full, doi strings reviewed (F-50) | i18next | MIT |
| PWA / offline | Serwist (`serwist`, `@serwist/turbopack`) | **9.5.13** | Workbox-based SW that works with Turbopack; Range requests for cached clips (`workbox-range-requests` **7.4.1**) | next-pwa (unmaintained) | MIT |
| Server state | TanStack Query | **5.104.5** | caching + offline persistence; excluded from Lite bundle | SWR | MIT |
| Client state | Zustand | **5.0.16** | tiny, no boilerplate | Redux | MIT |
| Validation | Zod | **4.6.7** | one schema language for Game SDK, forms and API edges | Yup | MIT |
| Motion | Motion | **14.6.0** | reduced-motion aware transitions | GSAP (licence) | MIT |
| Vector animation | Rive `@rive-app/react-canvas-lite` | **4.37.1** | voice orb + track explainer; canvas-lite ≈ 222 KB brotli, so lazy only | Lottie for interactive (no state machines) | MIT |
| Celebrations | `@lottiefiles/dotlottie-react` | **0.20.0** | small celebratory animations only | — | MIT |
| Local storage | `idb` | **8.0.4** | drafts, outbox, telemetry queue, on-device vault | Dexie | ISC |
| API client | `openapi-typescript` / `openapi-fetch` | **7.13.0** / **0.17.0** | typed client generated from `api/openapi.yaml` (`packages/api-client`) | hand-written fetchers | MIT |
| Maps (slot finder) | MapLibre GL | **6.15.0** | open, self-hostable tiles; list view is the Lite default | Google Maps (cost, key) | BSD-3-Clause |
| Error tracking | `@sentry/nextjs` | **11.9.0** | with `beforeSend` PII scrubbing | — | MIT |
| Design system for govt skin | UX4G (npm, Figma, Storybook per `07` §A7) | **[unverified]** package name/version — owner Frontend lead, H+6 | GIGW-aligned components free for government | — | govt |

## 3. Game layer (`packages/game-core`, games in `apps/web`)
| Layer | Choice | Version | Why | Rejected | Licence |
|---|---|---|---|---|---|
| 2D engine (top-down sims) | Phaser | **4.2.1** | full framework (scenes, input, Arcade physics, fixed step); WebGL context-loss recovery on mobile (`08` §1.2) | PixiJS 8 (renderer only), KAPLAY (next major alpha), Three/R3F (3D on ₹10k phones) | MIT |
| Video / decision games | HTML `<video>` + SVG + React + Motion | — | DOM is accessible (TalkBack), smallest, ideal for Nazar overlays | canvas for everything | — |
| On-device vision | MediaPipe Tasks Vision | **1.1.1** | Helmet Fit framing on device; no frame leaves the phone (M-09) | cloud vision | Apache-2.0 |
| Shared scoring | `@margdarshak/game-core` (our package; Zod schemas, `sim-core` fixed 60 Hz + mulberry32, pure scoring) | workspace | the *same* TS runs in browser and in the server verifier, so replay cannot drift | a Go re-implementation of scoring (drift risk) | Apache-2.0 |
| Spaced repetition | ts-fsrs | **5.4.2** (5.x pinned per brief) | FSRS v6, runs offline in the browser | Leitner (weaker), 6.0 beta | MIT |
| Server FSRS mirror | `github.com/open-spaced-repetition/go-fsrs/v4` | **v4.0.0** | multi-device review queue (API-31) with golden tests against ts-fsrs (shared fixtures in `tests/golden/fsrs/`) [FSRS-version parity with ts-fsrs 5.x to confirm at H0, owner Backend lead] | — | MIT |

## 4. Backend (`services/api` in Go, `services/workflows` in TypeScript)
Package layout and conventions: [BACKEND §2](BACKEND.md). Decision record: [ADR-0011](adr/ADR-0011-go-backend.md).

### 4.1 Go API (`services/api`)
| Layer | Choice | Version | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Router | `github.com/go-chi/chi/v5` | **v5.5.0** | `net/http`-compatible, small, middleware-friendly; the oapi-codegen `chi-server` target | gin, echo (own context types) | MIT |
| Contract-first codegen | `github.com/oapi-codegen/oapi-codegen/v2` (CLI) + `github.com/oapi-codegen/runtime` | **v2.8.0** / **v1.8.0** | generates models, the chi server interface and the **strict server** from `api/openapi.yaml` into `services/api/api/` (package `api`); handlers cannot drift from the spec | hand-written handlers only; ogen | Apache-2.0 |
| Request decoding | generated types + `encoding/json` strict decoding (`DisallowUnknownFields`) + explicit length caps | stdlib | unknown fields rejected at every boundary — the first wall against Aadhaar/OTP fields (D-07) | reflection validators | BSD-3-Clause |
| Postgres driver | `github.com/jackc/pgx/v5` (`pgxpool`) | **v5.11.0** | fastest native driver; `SET LOCAL app.tenant_id` per transaction for RLS | `database/sql` + lib/pq | MIT |
| Queries | `github.com/sqlc-dev/sqlc` (CLI, `sql_package: pgx/v5`) | **v1.31.1** | typed Go from plain SQL (`internal/store/queries/*.sql` → `internal/store/sqlcgen`); no ORM, the domain stays plain structs | GORM, ent | MIT |
| Migrations | `github.com/pressly/goose/v3` | **v3.29.0** | plain SQL `-- +goose Up/Down` files embedded in the binary (`migrations/`), run by `api migrate up`; expand → migrate → contract, RLS policies in migrations | golang-migrate, Atlas | MIT |
| Config | `github.com/caarlos0/env/v11` | **v11.4.1** | typed config from env vars; fails fast on missing secrets | viper (heavy) | MIT |
| Cache / rate limits | `github.com/redis/go-redis/v9` on Render Key Value (+ `github.com/go-redis/redis_rate/v10` **v10.0.1** GCRA limiter) | **v9.23.0** (to be added to `go.mod` by BE-platform) | rate limits, sessions, idempotency hot cache, HMAC nonce cache; in-memory fallback in dev | in-process only | BSD-2-Clause |
| HTTP client | `net/http` with per-adapter timeouts + `otelhttp` transport | stdlib | adapters with deadlines from `context`; `httptest` servers + recorded fixtures for adapter tests | resty | BSD-3-Clause |
| Resilience | `github.com/sethvargo/go-retry` / `github.com/sony/gobreaker/v2` | **v0.5.0** / **v2.4.0** | retries with jitter; one circuit breaker per adapter | hand-rolled | Apache-2.0 / MIT |
| Crypto | Go stdlib `crypto/aes` + `crypto/cipher` (AES-256-GCM), `crypto/ed25519`, `crypto/hmac`; `golang.org/x/crypto` (argon2id) | stdlib / **v0.58.0** | envelope encryption for C3/C4 columns; Ed25519 signing of rule packs, consents, Practice Records; HMAC for n8n / verifier / Workflows | third-party crypto | BSD-3-Clause |
| XML signatures (mock Aadhaar offline, DigiLocker XML) | `github.com/russellhaering/goxmldsig` + `github.com/beevik/etree` | **v1.6.1** / **v1.8.1** | verify signed XML in the mock and in DigiLocker pulls; Go's `encoding/xml` does not expand external entities | — | Apache-2.0 / BSD-2-Clause |
| IDs | `github.com/google/uuid` (`uuid.NewV7`) / `github.com/oklog/ulid/v2` | **v1.6.0** / **v2.1.2** | time-sortable keys; ULIDs for trace and request IDs | — | BSD-3-Clause / Apache-2.0 |
| Rule-pack schema | `github.com/santhosh-tekuri/jsonschema/v6` | **v6.0.3** | validates `rulepacks/` against JSON Schema 2020-12 at load time and in CI | — | Apache-2.0 |
| Logging | `log/slog` (JSON handler) + our redaction handler (`internal/privacy`) | stdlib | structured logs; Aadhaar-like (Verhoeff), OTP-in-context, phone, email and tokens masked before any sink | zap, zerolog | BSD-3-Clause |
| WebSocket (API-40 voice) | `github.com/gorilla/websocket` | **v1.5.3** (already in `go.mod`) | bidi audio frames between the browser and ADK `RunLive` | — | BSD-2-Clause |
| Web push | `github.com/SherClockHolmes/webpush-go` | **v1.4.0** | VAPID push without a vendor | FCM SDK | MIT |
| Object storage | `github.com/aws/aws-sdk-go-v2/service/s3` (S3 API to R2 / MinIO) | **v1.114.5** | one client for R2 now and Indian S3-compatible storage later | vendor SDKs | Apache-2.0 |
| Test helpers | `github.com/stretchr/testify` / `github.com/fergusstrange/embedded-postgres` / `pgregory.net/rapid` | **v1.12.1** / **v1.34.0** / **v1.3.0** | assertions; a real Postgres 16 in `go test` with **no Docker**; property tests for the journey machine | testcontainers (needs Docker) | MIT / MIT / MPL-2.0 |

### 4.2 Render Workflows tasks (`services/workflows`, TypeScript)
| Layer | Choice | Version | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Task SDK | `@renderinc/sdk` | **1.4.0** (npm) | `task({ name, retry, timeoutSeconds, plan }, fn)`, `ctx.run(subtask, ...args)`, `Promise.all` fan-out | — | MIT |
| Clip processing | ffmpeg (separate process) + `onnxruntime-node` (YuNet face model, plate detector) | ffmpeg from the Debian bookworm base image **[unverified version]** (owner Platform lead, H+4); `onnxruntime-node` **1.30.0** | blur and H.264 360p/480p transcode inside the task; no frames to cloud vision APIs | cloud video APIs (privacy) | LGPL/GPL (ffmpeg, separate process); MIT |
| Gemini (M-06 clip windows, offline) | `@google/genai` | **2.31.0** | video window proposals; humans set final windows | — | Apache-2.0 |
| Business steps | HMAC `POST /internal/job-steps/{step}` on the Go API (private network) | — | every decision and DB write stays in Go; the workflows service has **no `DATABASE_URL`** | tasks writing to Postgres | — |

## 5. Data
| Layer | Choice | Version | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Database | PostgreSQL | **16** (Docker `postgres:16.15`; Render Postgres 16) | the brief's pin; RLS for tenancy, JSONB for rule packs and answers, partitioning | MongoDB (no RLS/ACID across aggregates) | PostgreSQL |
| Vector search | none in MVP (`pgvector` **0.5.1** reserved) | — | rules and error catalogue are exact lookups; no RAG needed (`04` §1.4) | Pinecone | — |
| Object storage | Cloudflare R2 | managed | free egress; S3 API; $0.015/GB-month storage, 10 GB-month free ([R2 pricing](https://developers.cloudflare.com/r2/pricing/), fetched 2026-10-23) | S3 (egress cost), Render object storage (SDK "experimental") | — |
| Production object store | MinIO or the CSP's S3-compatible service in India | pin at adoption | data residency | — | AGPL (MinIO) — check procurement; CSP-native preferred |

## 6. AI
| Layer | Choice | Version / model ID (env-pinned) | Why | Rejected | Licence / terms |
|---|---|---|---|---|---|
| Agent framework | Google ADK for Go (`google.golang.org/adk`) | **v1.9.0** (proxy.golang.org, 2026-10-15) | `llmagent.New` with `OutputSchema`, `runner.New` → `Runner.Run` for one-shot agents and **`Runner.RunLive`** for bidi voice; `functiontool.New` for typed tools; `plugin.New` for the PII and provenance plugins; sequential agents let deterministic code wrap one LLM call; runs in-process in the Go API | LangGraph (no ADK live), Mastra (TS; no live voice), ADK Python (superseded with ADR-0011) | Apache-2.0 (LICENSE in the module) |
| Model SDK | Go Gemini SDK (`google.golang.org/genai`) | **v1.76.0** (proxy.golang.org, 2026-10-22) | used by ADK (`gemini.NewModel`); `genai.NewClient`, structured output, `client.Live.Connect` for the Live API | — | Apache-2.0 |
| Narration / tutor / coach | Gemini Flash-Lite | `gemini-3.1-flash-lite` ($0.25 / $1.50 per 1M tokens, `04` §1.7) | cheapest current non-legacy model; ≈ ₹0.10 per debrief | Flash (2× price, doubling 1 Jan 2027) | Gemini API terms (paid tier for real users; the account holder is an adult, minors learn inside a parent's account in family mode, D-13 revised) |
| Vision / video | Gemini Flash | `gemini-3.8-flash` / `gemini-3.6-flash` | screenshot decoder (M-05), sign snap (M-07), clip window proposals (M-06, offline) | OCR-only pipelines | same |
| Voice | Gemini Live via ADK for Go `Runner.RunLive` | `gemini-3.8-live`, fallback `gemini-2.5-flash-native-audio-preview-12-2025` | Hindi/English barge-in voice; ADK support for 3.8 Live is unknown, so env fallback (`04` §0.4) | Twilio/IVR stacks | same |
| Dogri speech-in | Sarvam Saaras v3 (REST over `net/http` from the Go API; Sarvam publishes no official Go SDK) | `saaras:v3` (`doi-IN`) | Gemini Live does not list Dogri; Saaras does (`04` §0.3) | IndicConformer (Dogri coverage unclear) | Sarvam terms (disclosed processor) |
| Hindi TTS (read-outs) | Sarvam Bulbul v3 | `bulbul:v3` (`hi-IN`), ₹30 per 10k characters | verbatim card read-outs; no Dogri TTS exists there | — | Sarvam terms |
| Dogri screen text | AI4Bharat IndicTrans2 (self-host, offline authoring) | model card version at H0 **[unverified]** (owner AI lead, H+6) | 22 scheduled languages; reviewed by a native speaker | MT at runtime | MIT (per AI4Bharat) [unverified] |
| Production inference | Vertex AI `asia-south1` (Mumbai) | — | India region and enterprise terms (brief §11) | — | Google Cloud terms |
| Government language stack | Bhashini (ULCA / Dhruva) via BhashiniPort | — | government-preferred speech/MT path for adoption | — | Bhashini terms [unverified] |

## 7. Durable jobs and automation
| Layer | Choice | Version | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Durable jobs (hackathon) | Render Workflows, **TypeScript** SDK (`services/workflows`) | **`@renderinc/sdk` 1.4.0** (npm) | sponsor track; per-run instances, `ctx.run()` chaining, `Promise.all` fan-out, retries with backoff, 30 s–24 h timeouts (B-sponsors §1). The Go API starts runs through the `JobRunner` port with Render's REST API (`POST https://api.render.com/v1/task-runs` `{task: "<WORKFLOW_SLUG>/<task>", input: [...], idempotencyKey}` → `202` TaskRun; status polled with `GET /v1/task-runs/{id}` into `job_runs`) (ADR-0005) | Render cron jobs (no fan-out/retries), a queue + workers on Render (more moving parts) | MIT |
| Durable jobs (production) | Temporal (Go SDK `go.temporal.io/sdk`) behind the `JobRunner` port | **v1.50.0** (to be added to `go.mod` when built); Temporal server **1.32.x** image tag seen on Docker Hub, pin at adoption | self-hostable on MeghRaj/NIC; native durable timers (human waits inside one workflow); workflows and activities in the same Go codebase | cloud-specific queues | MIT |
| Dev/CI jobs | inline runner (`JOB_RUNNER=inline`) | — | the same Go step handlers run in a goroutine in-process; media steps are skipped with fixture clips | — | — |
| Automation edge | n8n Cloud Pro (team perk); self-host image for adoption | n8n **2.44.6** (npm `latest`, Node ≥ 24) | schedules, WhatsApp/email, send-and-wait approvals; non-devs edit copy and timing | Zapier (no self-host), code-only (slower to change copy) | Sustainable Use License — fine for internal use; **check suitability for government self-hosting** (owner Platform lead, before any MoU) |
| Workflows CLI | Render CLI | ≥ 2.12.0 (local task server `http://localhost:8120`; the API uses it with `RENDER_USE_LOCAL_DEV=true`) | `render workflows dev -- pnpm --filter @margdarshak/workflows start` | — | — |

## 8. Infrastructure and hosting
| Layer | Hackathon (Phase 1–2) | Production (Phase 3+) |
|---|---|---|
| Compute | Render, **Singapore** region (Render has no India region: Oregon, Ohio, Virginia, Frankfurt, Singapore — [Render regions](https://render.com/docs/regions)) | NIC cloud or a MeitY-empanelled CSP in India, Kubernetes (Helm chart), Terraform modules |
| Services | `mg-web` (Node web service), `mg-api` (Docker web service), `mg-verifier` (private service), `mg-workflows` (Workflow service), `mg-db` Postgres 16 (paid; free DB expires after 30 days), `mg-kv` Key Value | Deployments with HPA, CloudNativePG or managed Postgres (HA + PITR), Valkey/Redis, S3-compatible store, Temporal |
| Edge / TLS | Render-managed TLS | CSP/NIC WAF + ingress-nginx + cert-manager (pin at adoption) |
| Secrets | Render env groups; n8n credential vault | CSP KMS/HSM in India, per-tenant KEK; External Secrets |
| Time sync | host NTP | NIC/NPL NTP (CERT-In Directions) |

## 9. Observability
| Layer | Choice | Version | Why | Licence |
|---|---|---|---|---|
| Tracing/metrics (Go) | OpenTelemetry Go (`go.opentelemetry.io/otel`, `otel/sdk`) + `otelhttp` + `github.com/exaring/otelpgx` | **v1.47.0** / **v0.72.0** / **v0.13.0** | vendor-neutral; spans for HTTP, pgx queries, adapter calls and ADK model calls; same exporters on Render and in India | Apache-2.0 |
| Tracing (Node) | `@opentelemetry/api` / `@opentelemetry/sdk-node` | **1.10.0** / **0.300.0** | verifier, Workflows tasks + Next server | Apache-2.0 |
| Errors | Sentry (`github.com/getsentry/sentry-go` **v0.50.0**, to be added by BE-platform; `@sentry/nextjs` **11.9.0**) | — | no PII sent (`SendDefaultPII: false`) + `BeforeSend` scrubbers | MIT / BSL server (SaaS used) |
| Logs | `log/slog` JSON (redaction handler) → Render logs (hackathon); collector → India log store, ≥ 1 year (DPDP Rules Rule 8) with 180 days in India (CERT-In) | — | — | — |
| Web vitals | `web-vitals` 6.2.3 → API-63 | — | field RUM on low-end phones | Apache-2.0 |

## 10. CI/CD, quality and testing
| Layer | Choice | Version | Why | Licence |
|---|---|---|---|---|
| CI | GitHub Actions | — | public repo requirement; jobs for Go + Node | — |
| Go lint/format/vet | `gofmt` / `go vet` / golangci-lint (incl. `depguard` for the hexagonal import rules, `gosec`, `errcheck`, `staticcheck`) | Go 1.27 / **golangci-lint v2.15.0** | one fast linter run; the pure packages (`domain`, `rules`, the journey machine) may not import `pgx`, `chi`, `net/http`, `adk` or `genai` | MIT (golangci-lint) |
| JS lint/format | Biome | **2.6.2** | lint + format in one binary (CODING_STANDARDS) | MIT/Apache-2.0 |
| Go tests | `go test` / testify / embedded-postgres / rapid / native fuzzing (`go test -fuzz`) | **v1.12.1** / **v1.34.0** / **v1.3.0** | property tests for the journey machine; fuzzing for the PII redactor and the rule expression parser; synthetic data only; a real Postgres 16 without Docker | MIT / MIT / MPL-2.0 |
| Golden rules (shared) | JSON fixtures in `tests/golden/` run by the Go engine (`go test`) and the TS mirror (`node --test --experimental-strip-types`) | — | the two engines cannot drift | — |
| API conformance | `github.com/getkin/kin-openapi` (`openapi3filter`) in Go integration tests | **v0.152.0** | every recorded request/response in the integration suite is validated against `api/openapi.yaml`; `go generate` + `git diff --exit-code` proves the generated server matches the spec | MIT |
| Spec lint | `@redocly/cli` / `@stoplight/spectral-cli` | **2.71.0** / **6.17.0** | `x-api-id`, examples and problem responses on every operation | MIT / Apache-2.0 |
| JS unit | Vitest | **5.0.5** | game-core golden tests, UI units | MIT |
| E2E + a11y | Playwright / `@axe-core/playwright` | **1.64.1** / **4.14.0** | real browsers, WCAG checks in CI | Apache-2.0 / MPL-2.0 |
| Performance | Lighthouse CI `@lhci/cli` / `size-limit` / k6 | **0.15.1** / **14.3.0** / k6 [unverified version, owner Platform lead] | Lite < 300 KB budget; p95 targets | Apache-2.0 / MIT / AGPL (k6, tool only) |
| Agent evals | Go eval harness over `ai/evals/*.jsonl` (`go test -tags evals`, ADK for Go runners; ADK for Go ships no `adk eval` CLI) | — | ≥ 30 cases per agent in CI (D-10); see [AI_EVALS](../04-ai/AI_EVALS.md) | Apache-2.0 |
| Security | govulncheck (`golang.org/x/vuln` **v1.9.0**) / gosec (via golangci-lint; **v2.30.0** standalone) / `pnpm audit` / ZAP baseline / gitleaks | — | dependency and SAST gates; DAST nightly | BSD-3-Clause / Apache-2.0 / MIT |
| Mocks | msw | **3.0.3** | API mocks for offline demo and frontend tests | MIT |

## 11. Auth, payments and India rails
| Need | Hackathon | Production | Notes |
|---|---|---|---|
| Citizen auth | anonymous device session (`md_sid` cookie) → email magic link / Google (OIDC; `github.com/coreos/go-oidc/v3` **v3.21.0** for ID-token checks) | + DigiLocker OAuth 2.0 (PKCE) / Jan Parichay via adapters | **never Aadhaar-OTP login** (brief §15) |
| Identity documents | hand-off to Sarathi's own eKYC; AadhaarOffline **mock only** | state's OVSE service; DigiLocker `DRVLC` pull | ADR-0008 |
| Government fees | redirect to Sarathi / state gateway; mock gateway | PayGov / state treasury reconciliation by receipt number | we never collect government fees |
| Messaging | WhatsApp Cloud API via n8n (test number), email | + mGov / NIC SMS after TRAI DLT registration | ≤ 1 nudge/day; STOP honoured |
| Languages | Gemini Live (hi/en), Sarvam (doi in, hi out), IndicTrans2 (offline authoring) | + Bhashini | claim only en + hi full, Dogri voice-in |
| Password hashing (admin break-glass only) | argon2id from `golang.org/x/crypto/argon2` (**v0.58.0**) | same | citizens have no passwords |

## 12. Sponsor tech used (HackCache '26)
| Sponsor | How we use it | Load-bearing? |
|---|---|---|
| **Render** | hosting for all services; **Render Workflows** (TypeScript tasks, started by the Go API over the REST API) for `clip_ingest` (headline, visible retry), `clip_finalize`, `case_clock_sweep` + `clock_batch` fan-out, `session_debrief`, `nightly_stats`, `rulepack_reevaluate`, `user_export`/`user_delete`, `replay_pending_sessions` | yes — bonus track; judged on effective use of Workflows |
| **n8n** (Pro perk) | the 15 edge workflows (schedules, WhatsApp/email, two-rater wait W08, moderation W9, lead routing W7, letter approval W11, digests, field-test export) | yes — but holds no business logic (ADR-0006) |
| Mastra | not used: our agents are ADK for Go (live voice through `RunLive` is a requirement). Noted for a possible TS agent later | no |
| GeeksforGeeks, CodeCrafters, OSEN | no product integration | no |

## 13. Rejected at the stack level (and why)
| Option | Why not |
|---|---|
| A second backend language for business logic | D-17 revised: one Go backend owns every decision (ADR-0011); the stateless score verifier is Node because scoring must be the browser's TS, and the Workflows tasks are TS orchestrators that call back into Go for every business step |
| Python anywhere (API, workflows, scripts) | removed on 23 Oct 2026 (ADR-0011): one fewer runtime to install, lock, scan and explain; Go and TS cover every need |
| Vercel for the frontend | the brief and the sponsor track require Render (council change ledger row 4) |
| Claude API for the AI layer | the brief standardises on Gemini/ADK (council change ledger row 4) |
| Google Search grounding for rules | would import the misinformation users complain about; rules come from signed packs (`04` §0.5) |
| Native Android app in the hackathon | PWA reaches budget phones without an install; a Play Store listing comes with adoption (impersonation policy applies) |
| GraphQL | small, cacheable surface; easier for NIC to audit and re-implement as REST |
| Microservices per domain | one deployable API is cheaper to run, explain (D-24) and secure in 48 h |

## 14. Unverified items
| Item | Owner | Due |
|---|---|---|
| UX4G npm package name/version and licence for non-government use | Frontend lead | H+6 |
| ffmpeg version in the base image | Platform lead | H+4 |
| `@renderinc/sdk` plan names (README/types list `starter/standard/pro`; Render's changelog renamed compute plans) | Backend lead | 2026-10-24 |
| ADK for Go v1.9 `RunLive` with `gemini-3.8-live` | AI lead | 2026-10-24 |
| Render Workflows tasks reaching the API's private hostport for `/internal/job-steps/*` | Platform lead | 2026-10-24 |
| go-fsrs v4 parity with ts-fsrs 5.x on the shared fixtures | Backend lead | H+8 |
| IndicTrans2 model/licence version | AI lead | H+6 |
| n8n Sustainable Use License for government self-hosting | Platform lead | before any MoU |
| k6 version | Platform lead | H+8 |
| Temporal server version for adoption | Platform lead | Phase 3 |
