# services/api: Margdarshak Go API

Go 1.27 · chi v5 · pgx v5 · goose (embedded migrations) · PostgreSQL 16 · oapi-codegen · slog with PII redaction · OpenTelemetry.
Contract: [`api/openapi.yaml`](../../api/openapi.yaml) (OpenAPI 3.1). Government-side adapter socket: [`api/adapters.openapi.yaml`](../../api/adapters.openapi.yaml) (+ [`api/adapters.asyncapi.yaml`](../../api/adapters.asyncapi.yaml)).

Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State Transport Department. Uses simulated government data.

## Commands (no Makefile; run from `services/api`)

| Task | Command |
|---|---|
| Build | `go build ./...` |
| Build the release binaries | `go build -tags timetzdata -ldflags "-X main.version=$(git rev-parse --short HEAD)" -o bin/api ./cmd/api` (same for `./cmd/seed`) |
| Vet | `go vet ./...` |
| Format check | `gofmt -l .` (must print nothing) |
| Lint | `golangci-lint run` (config `.golangci.yml`: depguard keeps `internal/domain`, `internal/rules`, `internal/journey` free of I/O; forbidigo bans `fmt.Print`/`log.*` outside `cmd/`) |
| All tests (unit + embedded-Postgres integration) | `go test ./...` |
| Unit tests only (skips embedded Postgres) | `go test -short ./...` |
| Adapter contract suites | `go test ./internal/adapters/... -run Contract -v` |
| PII fields never in port schemas or logs | `go test ./internal/adapters/ -run TestNoForbiddenFields -v` |
| Migrations up -> down -> up | `go test ./migrations/... -run TestMigrationsUpDownUp -v` |
| Prove the contract job fails on a broken adapter | `go test -tags brokenmock ./internal/adapters/ -run TestContractBroken` (expected: FAIL) |
| Regenerate code from the spec | `go generate ./internal/httpapi/gen` (then `git diff` must be empty in CI) |
| Run the API locally, no Docker | `DEV_EMBEDDED_PG=true go run ./cmd/api serve` (PostgreSQL 16 starts embedded on :5439, data in `.cache/pgdata`) |
| Run the API on a real Postgres | `DATABASE_URL=postgres://... go run ./cmd/api migrate up && go run ./cmd/api serve` |
| Migrations | `go run ./cmd/api migrate up` · `migrate down` (one step) · `migrate status` |
| Container health check | `api healthcheck` (GET `http://$API_INTERNAL_HOSTPORT/v1/health`, exit 0/1) |
| Seed the synthetic personas and the sample Nazar clips | `go run ./cmd/seed --profile demo --synthetic` (idempotent; `--kabir-day 31` for Kabir on LL day 31; `--clips=false` skips the sample clips) |

The first run of anything that starts embedded Postgres downloads the PostgreSQL 16 binaries (about 20 MB) into `.cache/embedded-postgres` (gitignored; `EMBEDDED_PG_CACHE` overrides, CI uses `~/.embedded-postgres-go`). Each integration test package starts one instance and clones a migrated template database per test.

In dev the magic-link e-mail goes to the console notifier: the sign-in link is printed in the log (`console notification (dev only)`, attribute `dev_link`); the recipient address is masked by the log redactor. `dev_link` is written verbatim only by the dev/test logger (`logging.NewDev`, `APP_ENV=dev|test`): a token digit run next to "code" would otherwise be masked as an OTP. Every other environment redacts it like any other value.

P2 integration tests (`internal/httpapi/p2_*_test.go`) answer `POST /verify` with a fake compute service. The learn, gamification and clip routes go to the real TypeScript verifier, which the tests spawn once per test binary from `services/score-verifier/src/server.ts`. Those tests need `node` and the verifier's built content (`pnpm --filter @margdarshak/score-verifier build:content`), and skip under `-short` or without node.

## Layout

```
cmd/api            serve | migrate up|down|status | healthcheck | worker (Temporal, design only) | version
cmd/seed           synthetic personas (MD-054)
migrations/        goose SQL, embedded (00001 roles+schemas, 00002 entities+RLS+audit, 00003 tenant JK, 00004 journey core: event store, mirrors, plans, fee quotes, idempotency keys, analytics, lab;
                   P2: 00005 content clips (no RLS: non-personal), 00006 game sessions/items/exposures/staircase, 00007 learning, 00008 gamification + core.family_members.parental_extras, 00009 online study)
internal/app       composition root used by cmd/ and the integration tests
internal/platform  config (env), logging (slog JSON + PII redaction), telemetry (OTel), servertime (IST), hmacsig, ratelimit (memory | Redis)
internal/privacy   PII detection/redaction (Aadhaar + Verhoeff, VID, OTP, phone, e-mail, PAN; Devanagari digits), AES-256-GCM vault + blind index, consent policy
internal/domain/age  age band (pure)
internal/store     pgx pool, tenant-scoped transactions (SET LOCAL ROLE mg_app + app.tenant_id), repositories, goose runner; pgembed
internal/ports     port interfaces + domain types; contracttest = the shared contract suites
internal/adapters  registry (per-tenant mode, ADAPTER_* overrides); mock/{sarathi,digilocker,aadhaaroffline,bhashini,payment,slot}; notify
internal/accounts  device sessions, magic link, Google stub, family members, parental consent, consents
internal/audit     append-only E-30 with a SHA-256 hash chain
internal/jobs      JobRunner: inline + Render Workflows (HTTP, untested against Render) + job/step catalogue
internal/notify    E-13 delivery state
internal/tenant    tenant resolution + cache (E-31)
internal/seed      personas
internal/journey   P1: pure 14-state journey machine, derived stage/display stage/primary action, case-clock schedule
internal/cases     P1: case service (API-10..17, 19): event store writer, projections, timeline, hand-off Mode A/B, payment intents, My Licence
internal/plans     P1: API-01..05 around the rules engine (plan snapshots, class catalogue, fees, LL format)
internal/clock     P1: case clock job steps (clock.plan_pages, clock.fire_batch), inline sweep, nudge limits, quiet hours, STOP, W02, fallback
internal/dsr       P1: export (API-61), erasure (API-62, EC-26), retention job (MD-137)
internal/analytics P1: allowlisted, pseudonymous analytics (API-63) and the k >= 5 digest (W13); SQL in queries/
internal/lab       P1: field-study trials (API-70) and public stats (API-71)
internal/rulekit   read-only helpers over the rules engine (parameters, vocab mapping); internal/wire: shared JSON rows
internal/learner   P2: learner.Subject (tenant, applicant, family member, band, minor, account), a leaf package every P2 package keys rows by;
                   resolution (accounts.ResolveLearner, wrapping RequireMemberAllowed) and the parental-extras gate (accounts.RequireExtra) live in accounts
internal/games     P2: API-34/35 + replay, sessions.replay_pending, Nazar Score; the verifier's result always wins (D-11)
internal/learn     P2: API-30..33 (modules, review queue, answers, readiness); maths in the compute service, cached snapshots
internal/gamify    P2: XP (four reasons only), ranks, silent streaks, badges, squads, share cards, Khud Licence (API-38, 39, 44, 57)
internal/clips     P2: API-55 clip admin, clip_ingest/clip_finalize Go steps, API-37 client manifest, scoring documents
internal/study     P2: online Nazar study enrolment, form items, CSV export for field-kit/nazar_stats.mjs, stats.field_study_publish
internal/adapters/compute      P2: HMAC client for services/score-verifier (/verify, /learn/*, /gamification/evaluate, /clip/*; ports.ComputePoster)
internal/adapters/objectstore  P2: mock (filesystem, served at /mock/media/) and r2 (stdlib SigV4) behind ports.ObjectStore
internal/app/p2.go P2 wiring and the cross-package glue (awards -> gamify + learn evidence, study hook -> W14, clip sources, consents, extras)
internal/httpapi   chi router generated from the spec (gen/), spec-driven auth, idempotency keys, problem+json, handlers, /mock pages
tools/specprep     3.1 -> 3.0 down-conversion for oapi-codegen + the operation/security table
```

## Contract-first HTTP (MD-055)

`go generate ./internal/httpapi/gen` runs `tools/specprep` (reads the 3.1 YAML, writes `openapi30.gen.json` and `operations.gen.go`) and oapi-codegen (`models.gen.go`, `server.gen.go` chi-server). Every one of the spec's operations is routed by the generated server; operations not built yet answer `501` problem+json. Authentication is enforced from each operation's `security` in the spec (`deviceSession`, `userBearer [scopes]`, `internalBearer + internalHmac`, or `{}`), not from hand-written route lists. `internal/httpapi` tests validate every implemented response against the spec's JSON Schema (jsonschema v6, draft 2020-12) and fail if a route is not in the spec or a spec operation is not routed.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `dev` | `staging`, `production`, `field` refuse missing secrets and enable Secure cookies |
| `PORT` / `API_ADDR` | `8000` | |
| `API_INTERNAL_HOSTPORT` | `127.0.0.1:$PORT` | used by `api healthcheck` |
| `DATABASE_URL` | | Postgres DSN; or `DEV_EMBEDDED_PG=true` (dev only) |
| `MIGRATE_ON_START` | `false` | Render runs `api migrate up` as the pre-deploy command |
| `REDIS_URL` | | rate limits + HMAC replay cache; empty = in-memory / Postgres replay cache |
| `TENANT_DEFAULT` | `JK` | |
| `PUBLIC_BASE_URL` / `WEB_BASE_URL` | `http://localhost:8000` / `http://localhost:3000` | redirects, magic links |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | comma-separated, no wildcard |
| `DEV_CLOCK_OFFSET` | | dev/test only (refused elsewhere): shifts the server clock, e.g. `9h`; the full-stack e2e (`pnpm test:e2e:real`) uses it to run the case clock outside quiet hours (21:00-08:00 IST) at night |
| `SESSION_SIGNING_KEY` | dev-only value | signs `md_sid`, derives the consent-signing Ed25519 key |
| `CONTACT_ENCRYPTION_KEY` | dev-only value | base64 of 32 bytes; per-tenant DEKs derived with HKDF |
| `BLIND_INDEX_PEPPER` | derived from the key | set explicitly in production |
| `INTERNAL_HMAC_SECRET` (alias `N8N_HMAC_SECRET`) | dev-only value | `/internal/*` signatures |
| `INTERNAL_BEARER_TOKENS` | `dev-internal-token` (dev) | comma-separated service tokens |
| `PAYMENT_CALLBACK_SECRET`, `AADHAAR_MOCK_SIGNING_KEY` | dev-only values | mock gateway / mock offline artefacts |
| `ADAPTER_SARATHI`, `ADAPTER_DIGILOCKER`, `ADAPTER_AADHAAR_OFFLINE`, `ADAPTER_BHASHINI`, `ADAPTER_PAYMENT`, `ADAPTER_NOTIFICATION`, `ADAPTER_SLOT` | tenant config | overrides of `core.tenant_adapter_config` |
| `JOB_RUNNER` | `inline` | `render_workflows` needs `RENDER_API_KEY` + `WORKFLOW_SLUG`; `RENDER_USE_LOCAL_DEV=true` targets `RENDER_LOCAL_DEV_URL` (`http://localhost:8120`); `temporal` is design-only |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | | e-mail; empty host = console notifier |
| `N8N_BASE_URL` / `N8N_MILESTONE_WEBHOOK_PATH` | / `/webhook/md/milestone` | W02 webhook; empty = envelopes are logged (dev) |
| `N8N_WEBHOOK_TOKEN` | | n8n Header Auth credential, sent as `X-MD-Webhook-Token` |
| `N8N_HMAC_SECRET` | `INTERNAL_HMAC_SECRET` | signs the W02 envelope `sig = sha256=<hex>` |
| `LAB_TOKENS` | `dev-lab-token` (dev) | `X-Lab-Token` values that unlock API-70 |
| `DEMO_MODE` | `false` | persona switcher outside dev/test (staging only; never production/field) |
| `GOOGLE_CLIENT_ID` | | Google sign-in; dev/test accept stub tokens only |
| `RULEPACK_DIR` | repo `rulepacks/` | rule packs for the tenant rule-pack version and fee totals |
| `OTEL_TRACES_EXPORTER` | `none` | `stdout` prints spans; `OTEL_SDK_DISABLED=true` forces none |
| `DEBUG_PPROF` | `false` | pprof on 127.0.0.1:6060 (not in production) |
| `GEMINI_MODEL_DEBRIEF`, `GEMINI_MODEL_VISION`, `GEMINI_MODEL_LIVE`, `GEMINI_MODEL_LIVE_FALLBACK` | | read by the AI layer (P3) |
| `GOMEMLIMIT` | | honoured by the Go runtime |
| `DEV_DEVICE_SESSION_RATE_LIMIT` | `0` (= 10/h/IP) | dev/test only (refused elsewhere): raises the anonymous device-session limit for e2e suites |
| `SCORE_VERIFIER_SHARED_SECRET` (alias `VERIFIER_SHARED_SECRET`) | `dev-only-verifier-secret` (dev/test) | P2: signs every compute call (`Margdarshak-Signature`); start the verifier with the same `VERIFIER_SHARED_SECRET`. Unset in production = a warning, and game sessions stay `pending_verification` |
| `SCORE_VERIFIER_HOSTPORT` / `SCORE_VERIFIER_URL` | / `http://$SCORE_VERIFIER_HOSTPORT` (fallback `http://127.0.0.1:8081`) | P2 compute service address |
| `SCORE_VERIFIER_TIMEOUT` | `2s` | one compute call, retry included |
| `CONTENT_DIR` | the nearest `content/` up from the working directory | P2: `curriculum/*.json` (API-30) and `generated/game-items.json` (API-34); missing content makes those endpoints 503 |
| `OBJECT_STORE` | `mock` | P2: `mock` (files under `MOCK_MEDIA_DIR`, default `$MD_CACHE_DIR/media`, served at `/mock/media/` with signed expiring URLs) or `r2` |
| `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_CLIPS`, `R2_BUCKET_INGEST` | | required with `OBJECT_STORE=r2` |
| `MEDIA_PUBLIC_BASE_URL` | | CDN origin of the public clip bucket; empty = presigned URLs |
| `MEDIA_URL_TTL` | `2h` | presigned media URL lifetime |
| `N8N_CLIP_READY_PATH` / `N8N_STUDY_WEBHOOK_PATH` | `/webhook/md/clip-ready` / `/webhook/md/session-end` | W08 clip review queue / W14 field-test capture |
| `N8N_RESUME_AUTH_TOKEN` | | sent as `X-MD-Resume-Token` when a saved rating resumes a W08 wait |

### P2 job steps and tasks

`POST /internal/job-steps/{step}`:
- `sessions.replay_pending` (re-verifies `pending_verification` sessions, 50 per page, `FOR UPDATE SKIP LOCKED`)
- `clip.get`, `clip.open_review`, `clip.propose_windows` (a stub in P2: D8), `clip.agreement`, `clip.request_adjudication`, `clip.blur_audit_check`, `clip.delete_raw`, `clip.publish_manifest`, `clip.recompute_difficulty`
- `study.export_csv` args `{tenant?, stats_id?, as_of?}` (the tenant defaults to `TENANT_DEFAULT`, which the Render Workflows `nightly_stats` task relies on: it sends `{stats_id, as_of}`) → `{tenant, files: {name: csv | null}, sha256, summary, omitted}`. `raters.csv` is `null` and listed in `omitted` while no study clip has two agreeing raters: the pre-registered `field-kit/nazar_stats.mjs` (never edited; its sha256 is in HYPOTHESES.md) throws on a header-only raters file (`median([])`), and without it the script simply prints no H4 line. `nightly-stats.ts` already runs the script without a raters argument when the file has no rows. `GET /internal/study/exports/raters.csv` still serves the header-only CSV as a download.
- `stats.field_study_publish` takes the flat shape `{tenant?, stdout, script_sha256, prereg_commit?}` or the `nightly_stats` task's `{stats_id, as_of, script: {name, sha256}, inputs_sha256, primary: {argv, stats, stdout}, sensitivity}`; it parses the primary run's stdout itself and checks its counts against a fresh export.

Inline task bodies (`JOB_RUNNER=inline`):
- `replay_pending_sessions` runs the replay step.
- `clip_finalize` runs agreement → blur audit check → delete raw → publish manifest → recompute difficulty.
- `clip_ingest` runs only the Go steps (`clip.get`, `clip.propose_windows`), because the media steps are TypeScript (Render Workflows). The curator register flow starts it through `jobs.Service.Start` directly, not through API-67, and neither n8n nor an admin screen starts it, so it is not in `jobs.InternalJobs` (the API-67 job enum in the spec does not list it either).
- `clip_generate` succeeds with `status: skipped` (video generation is Workflows-only).
- `nightly_stats` runs `study.export_csv` (default tenant) and reports `{status: "exported", published: false, summary, sha256, omitted}`. It never calls `stats.field_study_publish`: that step only stores what `nazar_stats.mjs` printed, and the script runs only in the Workflows task (the API does not spawn Node). With `JOB_RUNNER=render_workflows` the TypeScript task runs export → script → publish.

### Difficulty staircase (GAME_SDK §7)

After a verified practice or learn session (`games.Service.verify`, so also after `sessions.replay_pending`), each item outcome of the server result is applied in order to `game.staircase` (2 consecutive passes → level + 1, 1 fail → level − 1, levels 1–5). Mock and pair sessions, study sessions and provisional (unverified) sessions never adapt. Item pass per game (GAME_DESIGN §x.7, `games.ItemPasses`): Nazar, a clip of the verifier's `nazar_clips` analysis with Kerala marks ≥ 6 (quiet clips are not items, a pattern-voided clip fails, a clip voided by the device is skipped); LL sim, a question answered correctly and not at 50% confidence; Stopping Distance, the run at ≥ 80% of its max; Blind Spot, part A (placement) ≥ 80%, then part B ≥ 80% with no critical finding. The ladder is per subject and game (skill = game ID), the one API-34 reads for the next practice; per-hazard-type and per-part ladders need a skill on API-34 and are not built.

### Sample clips (dev/demo)

`cmd/seed` (and so the full-stack e2e API, `tests/e2e/scripts/real-api.mjs`) publishes the game-core fixture bank (`packages/game-core/src/fixtures/nazar.ts`) through `seed.SampleClips`, so a Nazar mock works on a fresh database instead of answering 409 `NO_UNSEEN_CLIPS`: KL-0001..KL-0010 (same windows, speeds and durations; curator difficulty 2–4, checked against the clip-pipeline curator rubric) and the quiet clip as KL-0011 (the fixture's `KL-Q001` is not a valid clip ID). Mock eligibility follows clip-pipeline `mockEligibility`, so a later manifest rebuild (`clip.publish_manifest`, run when a curator publishes) gives the same answer: the ten hazard clips are eligible, the quiet clip is published but never eligible ("quiet clip (no hazard to score)") and, since practice draws from the eligible pool, not dealt; the stored flash result is passed (the placeholder is constant zero bytes; there is no video to check). Each is `published`, `origin: ai_generated` (ADR-0013) and labelled a sample everywhere: generation record `model: sample-fixture-not-generated`, scene `SCN-000`, prompt version `0.0.0`, batch `sample-game-core-fixture`, generation key `SCN-000:0:sample-<clip>`, city `Sample fixture`; a passing synthetic review by `seed-curator`; two agreeing ratings by `seed-rater1` and `seed-rater2`; both renditions point at the object store's placeholder (96 KiB of zero bytes, the body the web's mock-mode clip route serves; the mock store lives under `$MD_CACHE_DIR/media`). `generation.durationMs` is capped at the schema's 41 s: there is no generated video behind a sample. The seed is idempotent, moves the `KL` clip counter past 11, and does not change the P1 persona counts.

`content.clip_scoring` is written by the clip store whenever a published (or retired) version is inserted or updated: the same `clips.ScoringDoc` projection that `ScoringDocs` sends to `/verify`, so the cache and the inline documents never differ.

### W08 (n8n clip review queue)

`n8n/workflows/W08-clip-review-queue.json` calls only `POST /internal/clips/{id}/review-tasks` (rater 1, then the blind rater 2), API-67 `POST /internal/jobs/clip_finalize` and `POST /internal/clips/{id}/status`, each with bearer + `Margdarshak-Signature`. The bodies are exactly the strict `ClipReviewTaskCreate` / `ClipReviewOutcome` schemas (no `version` field: the API works on the clip's current version; `exclude_rater_id` only when rater 1's pseudonym is known). The clip-ID check accepts `KL-0007`, `AIG-0004`, `JMU-0012` (and legacy `clip_…`), and the proposal count is read from the envelope's `proposals`.

### Clip-admin personas (dev/demo)

`POST /v1/demo/personas/{curator_01|rater_01|rater_02|rater_03}/session` signs in as a synthetic clip admin (session scope `admin`). Its pseudonym (`curator-01` …) is the actor API-55 records. These personas are not listed by `GET /v1/demo/personas`, and `seed.Run` does not create them.

## Data and privacy rules enforced here

- No Aadhaar number, VID, OTP or biometric is accepted, stored or logged: request bodies are scanned (422 `PROHIBITED_FIELD`), `cases.answers` has database CHECKs, the log handler redacts, audit metadata is redacted.
- AI for everyone (D-13 revised): there is no age gate. Accounts are held by adults (DB constraint); a learner under 18 is a family member inside a parent's account and needs a `parental_consent` artefact before a case is opened for them (`accounts.RequireMemberAllowed`, 403 `PARENT_CONSENT_REQUIRED`).
- Every tenant-owned table has `FORCE ROW LEVEL SECURITY`; request transactions run as `mg_app`, jobs and seeds as `mg_jobs`.
- `audit.audit_log` is append-only (trigger + grants) and hash-chained per tenant.
- P2:
  - `game.xp_ledger` refuses any reason but `session`, `review`, `lesson` and `prediction` (DB CHECK), so there is never XP for opening the app, sharing or inviting.
  - The ledger and `learn.review_log` are append-only for `mg_app`.
  - A streak never writes a notification.
  - Squads, share cards and pair mode for a minor need the parent's `parental_extras`.
  - Share-card numbers are recomputed on every read.
  - The online-study export leaves out trust < 0.6 and withdrawn participants. A declined consent writes nothing. Revoking the `field_study` consent (API-60) is the participant's "Delete my data": their enrolments are withdrawn at once and the retention sweep deletes the pseudonymous rows.
- Data principal rights over P2 (`internal/dsr`, `internal/store/dsr_p2.go`):
  - API-61 export adds the sections `game` (sessions with items and base64 replay inputs, clip exposures, staircase, XP ledger, streaks, badges, own squad memberships without other members' names, share cards), `learning` (answers, review log, card state, topic mastery, readiness snapshots), `study` (online-study participants) and `declarations` (`records.declarations`), for the account and every family member in it (`family_member_id` as `fam_…`). `format_version` is `md-export-2`.
  - API-62 erasure runs in the same transaction (switched to `mg_jobs` for these statements, because the XP ledger, the review log and the study table are append-only for `mg_app`): squad memberships are removed (a squad without an owner gets its longest-standing member as owner, an empty squad is disbanded; below three contributing members a squad no longer scores), share cards are withdrawn (410 at once, hard-deleted 30 days later), and every other P2 row of the applicant is deleted (sessions and items, exposures, staircase, XP, badges, streaks, learning tables, declarations, study participants).
  - The retention sweep (`retention.sweep`, MD-137) adds: replay inputs on `game.sessions` after 90 days (RT-90D; E-17 raw events are deferred and the replay blob stands in for them; the score stays, and a session still pending verification keeps its replay), raw `learn.answers` after 90 days (RT-90D, folded into card state), share cards 30 days after they expired or were withdrawn and squads 30 days after they were disbanded (DATA_MODEL gives only the 90-day link and 7-day invite lifetimes; 30 days is the RT-ACCOUNT hard-delete bound), and withdrawn study participants with their `field_test` sessions at the next sweep (FIELD_STUDY §6.3: within 7 days). E-19 debrief drafts (RT-7D) are not built, so nothing is swept for them. Consent proofs still referenced by a study participant or a clip are kept.
