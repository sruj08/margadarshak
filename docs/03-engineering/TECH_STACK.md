# Tech Stack
> Project: Margdarshak · Owner: Tech lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [Architecture](ARCHITECTURE.md) · [Backend](BACKEND.md) · [Frontend](FRONTEND.md) · [Data model](DATA_MODEL.md) · [API spec](API_SPEC.md) · [Integrations](INTEGRATIONS.md) · [Environment setup](ENVIRONMENT_SETUP.md) · [PROJECT_BRIEF §8](../00-overview/PROJECT_BRIEF.md)

**How versions were checked.** Every npm version below was read from `https://registry.npmjs.org/<pkg>/latest` (or the exact version URL) and every Python version from `https://pypi.org/pypi/<pkg>/json` on **2026-10-23**; runtimes from `nodejs.org/dist/index.json`, `python.org` and Docker Hub tags. Pins are **exact** (`==` in `uv.lock`, no `^` in `package.json`). Re-pin at H0 if a security release lands; Renovate proposes updates weekly afterwards. Anything not checked this way is marked **[unverified]** with an owner.

**The Karpathy test for every row:** does this choice make the 48-hour build *simpler* and the adoption path *possible*? If a layer adds a moving part without paying for itself in the three deep slices (plan → guided LL application; Nazar + debrief + field study; stage-aware home + clock sweep), it is cut.

---

## 1. Runtimes and tooling
| Layer | Choice | Version (checked) | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Python | CPython | **3.12.15** (`python:3.12.15-slim-bookworm`, Docker Hub 2026-10-21) | PROJECT_BRIEF §8; ADK needs ≥ 3.11, SQLAlchemy 2.1 needs ≥ 3.11, numpy 2.5 needs ≥ 3.12 | 3.13 (some wheels lag; the brief fixes 3.12) | PSF |
| Node.js | Node LTS line 22 | **22.23.4** (`node:22.23.4-bookworm-slim`) | the team's ENVIRONMENT_SETUP pin; Next 16 needs ≥ 20.9; score verifier runs the same line | Node 24.22.1 "Krypton" LTS is newer — move after the event (owner Platform lead, 2026-11-15) | MIT |
| Python packaging | uv | **0.13.5** | one lockfile for `services/api` + `services/workflows`; fast CI | Poetry, pip-tools | MIT/Apache-2.0 |
| JS packaging | pnpm (Corepack) | **12.15.0** | workspaces for `apps/*`, `packages/*`, `services/score-verifier` | npm, yarn | MIT |
| Monorepo tasks | Turborepo | **2.11.10** | cached `build/test/lint` across TS workspaces | Nx (heavier) | MIT |
| Containers | Docker / OCI images | base images above, pinned by digest in CI | Render deploys Docker; same images go to Kubernetes (D-17) | buildpacks only | — |

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
| Shared scoring | `@margdarshak/game-core` (our package; Zod schemas, `sim-core` fixed 60 Hz + mulberry32, pure scoring) | workspace | the *same* TS runs in browser and in the server verifier, so replay cannot drift | Python re-implementation (drift risk) | Apache-2.0 |
| Spaced repetition | ts-fsrs | **5.4.2** (5.x pinned per brief) | FSRS v6, runs offline in the browser | Leitner (weaker), 6.0 beta | MIT |
| Server FSRS mirror | `fsrs` (py-fsrs) | **6.3.2** | multi-device review queue (API-31) with golden tests against ts-fsrs | — | MIT |

## 4. Backend (`services/api`, `services/workflows`)
| Layer | Choice | Version | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Web framework | FastAPI | **0.161.1** | async, Pydantic-native, OpenAPI out of the box, WebSocket for voice | Django (heavier), Flask | MIT |
| ASGI server | Uvicorn | **0.54.0** | standard for FastAPI; `--workers` per container | Hypercorn | BSD-3-Clause |
| Validation | Pydantic / pydantic-settings | **2.14.1** / **2.16.1** | `extra="forbid"` at every boundary; settings from env | marshmallow | MIT |
| ORM | SQLAlchemy | **2.1.6** | typed declarative, async; repositories keep it out of the domain | raw SQL only | MIT |
| Migrations | Alembic | **1.20.1** | expand → migrate → contract, RLS in migrations | — | MIT |
| Postgres drivers | asyncpg / psycopg | **0.32.0** / **3.3.6** | asyncpg for the API hot path, psycopg 3 for Alembic and sync tasks | — | Apache-2.0 / LGPL-3.0 |
| Cache / rate limits | redis-py on Render Key Value; `limits` | **8.1.0**; **5.8.0** | sliding-window rate limits, sessions, idempotency hot cache | in-process only | MIT |
| HTTP client | httpx | **0.28.1** | async adapters with timeouts; `respx` **0.23.1** for recorded adapter tests | requests | BSD-3-Clause |
| Resilience | tenacity / pybreaker | **9.2.1** / **1.4.1** | retries with jitter; circuit breakers per adapter | hand-rolled | Apache-2.0 / BSD |
| Crypto | cryptography | **50.0.2** | AES-256-GCM envelope encryption for C3/C4 columns; Ed25519 signing of rule packs, consents, Practice Records | PyNaCl | Apache-2.0/BSD |
| XML signatures (mock Aadhaar offline, DigiLocker XML) | signxml / lxml | **5.2.0** / **6.1.3** | verify signed XML in the mock and in DigiLocker pulls; hardened parser (no entities) | — | Apache-2.0 / BSD |
| IDs | uuid6 (UUIDv7) | **2025.0.1** | time-sortable keys | ULID libs | MIT |
| Logging | structlog | **26.1.0** | JSON logs with a redaction processor | std logging only | MIT/Apache-2.0 |
| Web push | pywebpush | **2.5.0** | VAPID push without a vendor | FCM SDK | MPL-2.0 |
| Object storage | boto3 (S3 API to R2 / MinIO) | **1.43.118** | one client for R2 now and Indian S3-compatible storage later | vendor SDKs | Apache-2.0 |
| JSON | orjson | **3.13.0** | fast serialisation for large manifests | — | MIT/Apache-2.0 |
| Clip processing | OpenCV (headless) + ffmpeg | **5.0.0.93**; ffmpeg from the Debian bookworm base image **[unverified version]** (owner Platform lead, H+4) | YuNet face detector and plate blur; H.264 360p/480p transcode | cloud video APIs (privacy) | Apache-2.0; LGPL/GPL (ffmpeg, separate process) |

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
| Agent framework | Google ADK (Python) | **google-adk 2.12.0** (PyPI 2026-10-13) | live (voice) mode exists only in Python/Java; graph workflows let deterministic nodes wrap one LLM node; `adk eval` + `adk web` for the judges | LangGraph (no ADK live), Mastra (TS; no live voice) | Apache-2.0 (ADK; PyPI metadata does not state it — confirm in repo, owner AI lead) |
| Model SDK | google-genai | **2.33.0** (PyPI 2026-10-23) | used by ADK; structured output | — | Apache-2.0 |
| Narration / tutor / coach | Gemini Flash-Lite | `gemini-3.1-flash-lite` ($0.25 / $1.50 per 1M tokens, `04` §1.7) | cheapest current non-legacy model; ≈ ₹0.10 per debrief | Flash (2× price, doubling 1 Jan 2027) | Gemini API terms (18+, paid tier for real users) |
| Vision / video | Gemini Flash | `gemini-3.8-flash` / `gemini-3.6-flash` | screenshot decoder (M-05), sign snap (M-07), clip window proposals (M-06, offline) | OCR-only pipelines | same |
| Voice | Gemini Live via ADK `run_live` | `gemini-3.8-live`, fallback `gemini-2.5-flash-native-audio-preview-12-2025` | Hindi/English barge-in voice; ADK support for 3.8 Live is unknown, so env fallback (`04` §0.4) | Twilio/IVR stacks | same |
| Dogri speech-in | Sarvam Saaras v3 (`sarvamai` SDK **0.1.37**) | `saaras:v3` (`doi-IN`) | Gemini Live does not list Dogri; Saaras does (`04` §0.3) | IndicConformer (Dogri coverage unclear) | Sarvam terms (disclosed processor) |
| Hindi TTS (read-outs) | Sarvam Bulbul v3 | `bulbul:v3` (`hi-IN`), ₹30 per 10k characters | verbatim card read-outs; no Dogri TTS exists there | — | Sarvam terms |
| Dogri screen text | AI4Bharat IndicTrans2 (self-host, offline authoring) | model card version at H0 **[unverified]** (owner AI lead, H+6) | 22 scheduled languages; reviewed by a native speaker | MT at runtime | MIT (per AI4Bharat) [unverified] |
| Production inference | Vertex AI `asia-south1` (Mumbai) | — | India region and enterprise terms (brief §11) | — | Google Cloud terms |
| Government language stack | Bhashini (ULCA / Dhruva) via BhashiniPort | — | government-preferred speech/MT path for adoption | — | Bhashini terms [unverified] |

## 7. Durable jobs and automation
| Layer | Choice | Version | Why | Rejected | Licence |
|---|---|---|---|---|---|
| Durable jobs (hackathon) | Render Workflows, Python SDK | **render-sdk 1.4.0** (PyPI 2026-10-22; shim over the renamed `render` 1.4.0 distribution, "early access") | sponsor track; per-run instances, chaining, `asyncio.gather` fan-out, retries with backoff, 30 s–24 h timeouts (B-sponsors §1) | Render cron jobs (no fan-out/retries), Celery on Render (more moving parts) | MIT |
| Durable jobs (production) | Temporal (`temporalio` Python SDK) behind `JobRunnerPort` | **temporalio 1.34.0**; Temporal server **1.32.x** image tag seen on Docker Hub, pin at adoption | self-hostable on MeghRaj/NIC; native durable timers (human waits inside one workflow) | Celery (no durable timers), cloud-specific queues | MIT |
| Dev/CI jobs | `InlineJobRunner` | — | same task functions in-process | — | — |
| Internal ops automation | n8n Cloud Pro (team perk); self-host image for adoption | n8n **2.44.6** (npm `latest`, Node ≥ 24) | schedules, staff send-and-wait approvals, staff notifications; non-devs edit staff routing and timing. No citizen messages (ADR-0006) | Zapier (no self-host), code-only (slower to change copy) | Sustainable Use License — fine for internal use; **check suitability for government self-hosting** (owner Platform lead, before any MoU) |
| Workflows CLI | Render CLI | ≥ 2.12.0 (local task server :8120) | `render workflows dev` | — | — |

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
| Tracing/metrics (Python) | OpenTelemetry SDK + FastAPI instrumentation | **opentelemetry-sdk 1.45.1**, **opentelemetry-instrumentation-fastapi 0.66b1** | vendor-neutral; same exporters on Render and in India | Apache-2.0 |
| Tracing (Node) | `@opentelemetry/api` / `@opentelemetry/sdk-node` | **1.10.0** / **0.300.0** | verifier + Next server | Apache-2.0 |
| Errors | Sentry (`sentry-sdk` **2.73.0**, `@sentry/nextjs` **11.9.0**) | — | `send_default_pii=False` + scrubbers | MIT / BSL server (SaaS used) |
| Logs | structlog JSON → Render logs (hackathon); collector → India log store, ≥ 1 year (DPDP Rules Rule 8) with 180 days in India (CERT-In) | — | — | — |
| Web vitals | `web-vitals` 6.2.3 → API-63 | — | field RUM on low-end phones | Apache-2.0 |

## 10. CI/CD, quality and testing
| Layer | Choice | Version | Why | Licence |
|---|---|---|---|---|
| CI | GitHub Actions | — | public repo requirement; matrix for Python + Node | — |
| Python lint/format/type | Ruff / mypy (strict) / import-linter | **0.17.2** / **2.4.0** / **2.15** | one fast linter; hexagonal dependency rules enforced | MIT / MIT / BSD |
| JS lint/format | Biome | **2.6.2** | lint + format in one binary (CODING_STANDARDS) | MIT/Apache-2.0 |
| Python tests | pytest / pytest-asyncio / hypothesis / polyfactory / testcontainers | **9.1.1** / **1.4.0** / **6.170.8** / **3.5.0** / **4.15.0** | property tests for the journey reducer; synthetic data only; real Postgres in CI | MIT / Apache-2.0 / MPL-2.0 / MIT / Apache-2.0 |
| API conformance | schemathesis | **4.32.4** | property-based tests from `api/openapi.yaml` | MIT |
| Spec lint | `@redocly/cli` / `@stoplight/spectral-cli` / `openapi-spec-validator` | **2.70.0** / **6.17.0** / **0.9.0** | `x-api-id`, examples and problem responses on every operation | MIT / Apache-2.0 / Apache-2.0 |
| JS unit | Vitest | **5.0.5** | game-core golden tests, UI units | MIT |
| E2E + a11y | Playwright / `@axe-core/playwright` | **1.64.1** / **4.14.0** | real browsers, WCAG checks in CI | Apache-2.0 / MPL-2.0 |
| Performance | Lighthouse CI `@lhci/cli` / `size-limit` / k6 | **0.15.1** / **14.3.0** / k6 [unverified version, owner Platform lead] | Lite < 300 KB budget; p95 targets | Apache-2.0 / MIT / AGPL (k6, tool only) |
| Agent evals | `adk eval` (ADK 2.12) | — | ≥ 30 cases per agent in CI (D-10) | Apache-2.0 |
| Security | pip-audit / bandit / `pnpm audit` / ZAP baseline / detect-secrets | **2.10.1** / **1.9.4** / — | dependency and SAST gates; DAST nightly | Apache-2.0 / Apache-2.0 |
| Mocks | msw | **3.0.3** | API mocks for offline demo and frontend tests | MIT |

## 11. Auth, payments and India rails
| Need | Hackathon | Production | Notes |
|---|---|---|---|
| Citizen auth | anonymous device session (`md_sid` cookie) → email magic link / Google (OIDC; `pyjwt` **2.15.1** for ID-token checks) | + DigiLocker OAuth 2.0 (PKCE) / Jan Parichay via adapters | **never Aadhaar-OTP login** (brief §15) |
| Identity documents | hand-off to Sarathi's own eKYC; AadhaarOffline **mock only** | state's OVSE service; DigiLocker `DRVLC` pull | ADR-0008 |
| Government fees | redirect to Sarathi / state gateway; mock gateway | PayGov / state treasury reconciliation by receipt number | we never collect government fees |
| Messaging | backend notifier: WhatsApp Cloud API (test number), email (SMTP), web push | + state WhatsApp business number, mGov / NIC SMS after TRAI DLT registration | ≤ 1 nudge/day; STOP honoured |
| Languages | Gemini Live (hi/en), Sarvam (doi in, hi out), IndicTrans2 (offline authoring) | + Bhashini | claim only en + hi full, Dogri voice-in |
| Password hashing (admin break-glass only) | argon2-cffi **25.1.0** | same | citizens have no passwords |

## 12. Sponsor tech used (HackCache '26)
| Sponsor | How we use it | Load-bearing? |
|---|---|---|
| **Render** | hosting for all services; **Render Workflows** for `clip_ingest` (headline, visible retry), `clip_finalize`, `case_clock_sweep` + `clock_batch` fan-out, `session_debrief`, `nightly_stats`, `rulepack_reevaluate`, `user_export`/`user_delete`, `replay_pending_sessions` | yes — bonus track; judged on effective use of Workflows |
| **n8n** (Pro perk) | internal and staff workflows (case-clock trigger W01, lead routing W07, two-rater wait W08, moderation W09, alerts, digests, field-test export, RTO/staff W16–W18) | yes — but holds no business logic and sends nothing to citizens (ADR-0006) |
| Mastra | not used: our agents are ADK (Python live voice is a requirement). Noted for a possible TS agent later | no |
| GeeksforGeeks, CodeCrafters, OSEN | no product integration | no |

## 13. Rejected at the stack level (and why)
| Option | Why not |
|---|---|
| A second backend language for business logic | D-17 "one Python backend"; only the stateless score verifier is Node, because scoring must be the browser's TS |
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
| `render-sdk` plan names (`flex` vs `starter/standard` in the README) | Backend lead | 2026-10-24 |
| ADK 2.12 support for `gemini-3.8-live` in `run_live` | AI lead | 2026-10-24 |
| ADK licence (PyPI metadata empty) | AI lead | H+6 |
| IndicTrans2 model/licence version | AI lead | H+6 |
| n8n Sustainable Use License for government self-hosting | Platform lead | before any MoU |
| k6 version | Platform lead | H+8 |
| Temporal server version for adoption | Platform lead | Phase 3 |
