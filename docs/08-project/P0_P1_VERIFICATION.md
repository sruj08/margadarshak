# P0 + P1 verification (24 Oct 2026)
> What was run, what passed, and what still needs people or credentials. Scope: the definitions of done in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) §5.1 (P0) and §5.2 (P1), read with the adjustments in [BUILD_CONVENTIONS.md](BUILD_CONVENTIONS.md) §5:
> - "Python" reads as "Go".
> - The u18 gating test is a family-mode / parental-consent test (AI for everyone, D-13 revised).
> - Render deploy and the WhatsApp test number are prepared and documented; running them live needs team credentials.

All commands ran on the team machine (Windows 11, Go 1.27.0, Node 22.19, pnpm 11.9.0), from the repository root unless a directory is given. Nothing was committed or pushed.

**Status key**

| Status | Meaning |
|---|---|
| Done | Built and verified by the command shown. |
| Done-with-note | Verified, with a limit stated in the note. |
| Needs team credentials | Prepared; running it live needs an account, secret or test number the team holds. |
| Not done | Not built yet. |

## 1. Gates run for this report

| Gate | Command | Result |
|---|---|---|
| Install | `pnpm install` (once, after the coordinator's "install ok"), then `pnpm install --frozen-lockfile` | Lockfile written; frozen install "Already up to date" |
| Go format | `cd services/api && gofmt -l .` | prints nothing |
| Go vet | `cd services/api && go vet ./...` | clean |
| Go lint | `cd services/api && .cache/bin/golangci-lint run` (v2.15.0) | `0 issues.` |
| Go tests (unit + embedded PostgreSQL 16) | `cd services/api && go test -count=1 ./...` | 13 packages `ok`, 0 failures (httpapi 132 s, migrations 91 s, seed 49 s, store 29 s) |
| Codegen drift | `cd services/api && go generate ./internal/httpapi/gen`, then compare | no generated file changed |
| Broken adapter fails the contract job | `go test -tags brokenmock ./internal/adapters/ -run TestContractBroken` | `FAIL` (expected) |
| TS typecheck | `pnpm -r --if-present typecheck` | 11 workspaces `Done` (web, ui, api-client, rules, workflows, e2e, and the P2 packages) |
| TS tests | `pnpm -r --if-present test` | all pass: web 118, ui 19, api-client 4, rules 119, workflows 40 (plus P2: game-core 323, gamification 144, clip-pipeline 134, content 93, score-verifier 37) |
| Rules conformance (TS mirror vs golden) | `node --test --experimental-strip-types "packages/rules/test/*.test.ts"` | 119 pass, 0 fail |
| Workflows tasks | `cd services/workflows && node --test --experimental-strip-types "test/**/*.test.ts"` | 40 pass, 0 fail |
| Lint | `pnpm lint` (Biome + `lint:facts` + `lint:patterns` + `lint:i18n`, each with self-tests) | 0 errors (27 Biome warnings, all cognitive-complexity or SVG-title warnings that were already there); wording 169 files clean; fee literals clean; patterns 162 files clean; i18n 1411 keys in en + hi |
| Web build | `pnpm --filter @margdarshak/web build` | ok |
| Bundle budgets | `pnpm size` (size-limit + `apps/web/scripts/first-load.mjs`) | all 130 prerendered routes within the 450 KB first-load budget (largest `/hi/apply/check` 420 KB); all-chunks ceiling 531 KB / 580 KB; CSS 43 KB / 45 KB |
| Playwright, mock mode | `pnpm --filter @margdarshak/web build && LAB_TOKEN=labtest pnpm test:e2e` | 222 passed, 34 skipped (journey specs run at 360 px only), 0 failed |
| Playwright, full stack | `pnpm test:e2e:real` | 10 passed, 0 failed (§4; 14 after the gap-closing pass below) |
| Workflow lint | `go run github.com/rhysd/actionlint/cmd/actionlint@latest` (v1.7.12) | clean, exit 0 (shellcheck is not installed here, so `run:` scripts were not shellchecked) |

**P1 gap-closing pass (API-13, API-19, API-63, API-71, sign-in for family mode; §5).** Frontend only. These gates were re-run on a fresh build after the other session's install:

| Gate | Command | Result |
|---|---|---|
| Web typecheck | `pnpm --filter @margdarshak/web typecheck` | clean |
| Web unit tests | `pnpm --filter @margdarshak/web test` | 10 files, 150 tests pass (incl. the new `p1-gaps.test.ts`, 18 tests) |
| Wording + fee literals | `pnpm lint:facts` | clean (202 files), self-tests pass |
| Dark patterns | `pnpm lint:patterns` | clean (195 files), self-test passes |
| i18n | `pnpm lint:i18n` | 1482 keys in en + hi |
| Biome on the changed files | `npx biome check <28 changed web files + 3 specs>` | 0 errors; 6 cognitive-complexity warnings in long existing components (check answers, question page, replica, plan card) |
| Web build | `pnpm --filter @margdarshak/web build` | ok (includes `/[locale]/signin`) |
| Playwright, mock journey specs | `E2E_PORT=3171 LAB_TOKEN=labtest npx playwright test journey- --project=mobile-360` (in `tests/e2e`) | 34 passed, 0 failed (axe now covers `/signin` in en/hi, light/dark) |
| Playwright, full stack | `pnpm test:e2e:real` | 14 passed, 0 failed (§4) |

## 2. P0 definition of done (§5.1)

| # | Item | Status | Evidence |
|---|---|---|---|
| P0-1 | `pnpm dev:all` brings up web, API, verifier stub, workflows worker, Postgres, Key Value and MinIO with seeded personas on a fresh Windows 11 clone | Done-with-note | `pnpm api:seed` and `pnpm api:dev` now start embedded PostgreSQL 16 by themselves (they set `DEV_EMBEDDED_PG=true` unless `DATABASE_URL` is set). Verified: seed printed the 9 personas; `GET http://localhost:8000/v1/health` answered with every adapter `ok`; `GET /v1/demo/personas` listed the personas. **Note:** `dev:all` runs only web + API. The score verifier (`pnpm --filter @margdarshak/score-verifier dev`) and the workflows worker (`pnpm --filter @margdarshak/workflows dev`) start separately. Key Value and MinIO are optional (in-memory fallbacks; Docker compose for teammates who have Docker). `next dev` uses the mock API unless `NEXT_PUBLIC_API_URL=http://localhost:8000` is set. |
| P0-2 | `main` deploys to Render (Singapore) through the Blueprint; a PR gets a preview URL; rollback tested once | Needs team credentials | `infra/render.yaml` and `.github/workflows/deploy.yml` are prepared. The deploy smoke now checks the real API-64 fields and the real API-01 paise fields (§5). It needs `RENDER_API_KEY`, the service IDs and the URL variables. |
| P0-3 | CI required checks: lint, types, unit (TS + Go), adapter contracts, Playwright smoke, axe, size-limit, Lighthouse, wording/fee-literal lint, gitleaks, CodeQL, SBOM | Done-with-note | Every `ci.yml` job runs a command that exists and passed locally (§1). gitleaks, CodeQL, Trivy SBOM, govulncheck and pnpm audit are in `security.yml`. actionlint is clean. **Note:** not yet run on GitHub (no push from this session). There is no Lighthouse job yet. Coverage is reported, not gated (the old gates had never been measured). |
| P0-4 | Rule-pack schema v1 frozen; CMVR base + J&K pack signed by PD and BE; ≥ 80 golden cases pass in Go and TS with identical output | Done-with-note | 110 golden cases in `tests/golden/`. Go `TestGoldenCases`, `TestGoldenECCoverage`, `TestRulepackProvenance` and `TestRulepackSchemaRejectsMissingSourceOrDate` pass. The TS mirror reproduces the same snapshots (119 tests). The full-stack e2e also shows the server plan equals the device plan (§4). **Note:** the PD + BE sign-off is a human step. 65 rows are `verified:false` and show "verify at your RTO". |
| P0-5 | All seven adapters pass the contract suite; `api/adapters.openapi.yaml` lints clean | Done | `go test ./internal/adapters/... -run Contract -v` passes for Sarathi mock + deeplink, DigiLocker, AadhaarOffline, Bhashini, Payment (mock + sarathi_redirect), Notification router and Slot. `TestContractAdapterSpecLints`, `TestContractMocksValidateAgainstAdapterSpec` and `TestNoForbiddenFields` pass. The broken mock fails the suite, as it should. |
| P0-6 | Family mode with parental consent, audit log, PII redaction and the JobRunner (Render + local) each have tests | Done | Family mode: `TestFamilyModeMinorNeedsParentalConsent`, `TestFamilyModeParentalConsentAndNoAIGate`, `TestFamilyModeAIIsForEveryone`, `TestFamilyModeAccountHolderIsAdult`, `TestEC05MinorFamilyMode`. Audit: `TestAuditLogAppendOnly`. Redaction: `TestRedact*`, `TestRedactLogs*`, `TestEC20*`. JobRunner: `TestInlineRetryAndIdempotency`, `TestSameTaskCodeUnderInlineAndRenderWorkflows`. All pass in `go test ./...`. |
| P0-7 | Every route shows the non-affiliation footer; the trust line renders from `fees.json` with a source chip | Done | `tests/e2e/specs/shell.spec.ts` crawls every route in en and hi. `trust-line.test.ts` (Vitest) checks the line. Both pass. |
| P0 demo | Phone: preview URL → language picker → home with 4 tabs, footer, trust line → source chip "CMVR r.32, checked {date}"; laptop: CI run all green with one broken adapter failing the contract job | Done-with-note | Locally: the shell and a11y specs cover the phone path at 360 px, and the broken-mock run fails as expected. The preview URL and a GitHub CI run need P0-2 / P0-3 credentials. |

## 3. P1 definition of done (§5.2)

| # | Item | Status | Evidence |
|---|---|---|---|
| P1-1a | Kabir: plan in 3 taps, application in ≤ 6 decision screens, check answers, hand-off (Playwright, 360 px) | Done | Mock: `journey-plan.spec.ts` and `journey-apply.spec.ts`. Real API: `real-journey.spec.ts` "P1 demo checkpoint": API-01 201 → API-10 201 → autosave seen on the server (API-12) → ≤ 6 question screens → check answers → fee 950 → hand-off with the Simulated chip from API-16 provenance. |
| P1-1b | Tanvi: both blockers caught before hand-off | Done | Mock spec, plus the real spec: JK-B02 is on the API-01 plan. For her seeded case the task list and check answers now call API-13 (`GET /v1/cases/{id}/blockers`, 200) and show JK-B02 and JK-B03 labelled "Checked by the Margdarshak server" (`issues-source` = `server`). A case kept on the phone, mock mode or offline shows the same engine's result labelled "Checked on this phone". Go: `TestEC02EC03TanviBlockers`. |
| P1-1c | Mohan-ji: Form 1A shown | Done | Mock spec, plus the real spec: JK-B04 on the server plan, Form 1A in the documents; his persona's home is RENEWAL_DUE. Go: `TestEC04TurningFortyMidJourney`, `TestEC04Form1AMilestone`. |
| P1-1d | Rahul: plan inside a parent's account (family mode); every feature including AI reachable; share and squads ask for the parent's consent (adjusted: family-mode / parental-consent test, no age gate) | Done-with-note | Real spec: the 16-17 plan is served (201) with `family_mode_required: true`, and nothing is refused. The parent persona shows "Family mode · Rahul" and the AI coach consent switch is enabled. A new minor member's case is refused with 403 `PARENT_CONSENT_REQUIRED` until the parent records consent, then created (201). Go: `TestFamilyMode*`, `TestEC05MinorFamilyMode`, `TestConsentPurposesIncludeParentalConsent`. Real spec "Family mode": an anonymous device plans for a 16-17-year-old and starts the application; "add a family member" asks the adult to sign in first (new `/signin`, API-07 202 → code from the dev API log → API-08 200, scope `user`); the device case is then served to the account (merged); the parental-consent page adds the member (API-59 201, `is_minor`), records the consent (API-60 201) and opens the application as the member's case (API-10 201 with `family_member_id`; the stand-in case is deleted). Family mode shows, the AI coach switch is enabled, and no analytics leave the phone. **Note:** squads and share cards are P2 surfaces, so there is no squad UI to gate yet. |
| P1-2 | Offline plan card equals online for golden personas | Done | `MD-108 offline plan equals the server plan` (real, 4 personas: Kabir bike, Kabir bike + car, Tanvi, Mohan-ji) compares the plan-card facts from API-01 with those from the TS mirror offline. They are identical. The same check passes in mock mode. |
| P1-3a | RW-2 sweep idempotent; W1 triggers it | Done-with-note | Real spec: a signed API-65 call (bearer + `Margdarshak-Signature` HMAC, as n8n W1 sends it) fires TEST_EVE as one W02 envelope. A second sweep sends nothing more, and an unsigned call gets 401. Go: `TestClockStepsIdempotentPerEventKey`, `TestClockSweepThroughAPI65`, `TestInternalHMACChannel`, `TestReplayCacheKeysOnMethodAndPath`. Workflows: 40 tests. **Note:** n8n itself was not run; the e2e makes W1's call directly. |
| P1-3b | A WhatsApp test-number message and an email arrive | Needs team credentials | With `N8N_BASE_URL` unset, the API logs each signed W02 envelope. The e2e asserts the `plan_card` envelope (API-04) and the `clock_batch` envelope (TEST_EVE). E-mail goes to the console notifier. Live delivery needs the n8n instance, the WhatsApp Cloud API test number and SMTP. |
| P1-3c | ≤ 1 nudge a day; STOP honoured | Done | `TestNudgeLimitsAndQuietHours`, `TestEC30StopHonouredBeforeTheNextMessage`, `TestInternalN8nReceiptsAndOptOut`, `TestW02SeenAndFallbackToEmail`. Quiet hours (21:00-08:00 IST) are enforced; see the note in §6. |
| P1-4 | Consent artefacts for every purpose; export and delete work; delete cancels timeline events | Done | Real spec: the export downloads the server bundle (API-61, `exp_…`, sections contain the case, no identity numbers). Delete reports exactly the reminders the server had scheduled, the case is no longer served, and the sweep has nothing left for it. Go: `TestConsentRevocationStopsDependentProcessing`, `TestExportContainsOnlyMyRows`, `TestEC26DeleteCaseCancelsTimeline`, `TestEC26AccountDeletedMidCase`, `TestDeleteMeRevokesSessions`, `TestRetentionTimeTravel`. |
| P1-5 | Lab replica matches the observed Sarathi sequence (signed sheet), token-gated and `noindex` | Done-with-note | `journey-lab.spec.ts`: 404 without or with a wrong token, `noindex` meta and header, logged trial, 42-column CSV. Real spec: API-70 answers 404 without `X-Lab-Token` and 201 with it (field_study consent recorded first); API-71 answers 200. **Note:** the signed comparison sheet is a PD task. |
| P1-6 | EC tests for the P1-owned cases pass (EC-01..06, 09..11, 15, 21, 22, 26, 30) | Done | Go tests named for each EC: `TestEC01YearOnlyDOB`, `TestEC02EC03TanviBlockers`, `TestEC04*`, `TestEC05MinorFamilyMode`, `TestEC06TransportUnderTwenty`, `TestEC09PaymentPendingAndIntent`, `TestEC10KeralaLLTestAtRTO`, `TestEC11SarathiOutageAndModeB`, `TestEC15ServerTimeIsTheOnlyClock`, `TestEC21TwoClassesDifferentAges`, `TestEC22ExistingLLOnboarding`, `TestEC26*`, `TestEC30*`. The UI specs cover EC-01, 05, 06, 09, 11, 20, 21 and 26. |
| P1 demo | Kabir home → plan (3 taps) → "Start my application" → 6 screens → check answers → fee → hand-off with "Simulated: runs on Sarathi" → back with an application number → home "LL day 0" → persona "LL day 31" → "Book your driving test" → trigger W1 → WhatsApp arrives; then Tanvi's two blockers | Done-with-note | `real-journey.spec.ts` runs the whole sequence on the real API: … → application number → "Your LL test is next." → LL issued today → BRIDGE "Driving test unlocks in 30 days." (LL day 0) → persona `kabir_day31` (API session) → "You can book your driving test now." → "Book your driving test" → API-04 opt-in → signed sweep → W02 envelope for TEST_EVE. **Note:** the last step stops at the logged envelope (P1-3b). |

## 4. Full-stack e2e (`pnpm test:e2e:real`)

What it does:
- `tests/e2e/scripts/run-real.mjs` builds `apps/web` into `.next-real` with `NEXT_PUBLIC_API_URL=http://localhost:8010` (skip the build with `E2E_SKIP_BUILD=1`).
- Playwright then starts two web servers:
  - `tests/e2e/scripts/real-api.mjs`:
    - builds `cmd/api` and `cmd/seed`;
    - recreates `services/api/.cache/e2e/pgdata`;
    - runs `seed --profile demo --synthetic`;
    - serves on `:8010` with embedded PostgreSQL on `:5459`, the mock adapters (as on Render), `LAB_TOKENS`, internal bearer and HMAC test values, and `N8N_BASE_URL` unset;
    - writes the log to `services/api/.cache/e2e/api.log`.
  - `next start` on `:3100` from `.next-real`.
- A global teardown stops the embedded PostgreSQL.

| Spec (`tests/e2e/specs/real-journey.spec.ts`) | Result |
|---|---|
| P1 demo checkpoint: Kabir plan → application → hand-off → LL day 0 → LL day 31 → sweep sends W02 | ok |
| Tanvi: both blockers on the plan and on the server case (EC-02, EC-03) | ok |
| Mohan-ji (52): Form 1A on the server plan; renewal case RENEWAL_DUE | ok |
| Rahul (17) via a parent: family mode with parental consent, no age gate | ok |
| Privacy: export is the server bundle; delete cancels the scheduled reminders | ok |
| MD-108 offline plan equals the server plan × 4 golden personas | ok |
| Lab trials reach API-70 only with the lab token | ok |
| API-19: payment intent → simulated gateway → signed callback (API-24) → paid (LL_TEST); EC-09: "debited but pending" → PAYMENT_PENDING, a second intent is 409 `PAYMENT_PENDING`, no pay button | ok |
| API-63: no batch without the analytics consent; with it a 202 batch of allowlisted fields only (no e-mail, phone, DOB, identity numbers); nothing after revoking | ok |
| Family mode: sign in (API-07/08) → device case merged → add member → parental consent → the minor's case; AI reachable; no analytics for the minor's case | ok |
| API-71: "Field study so far" card on All services and the lab page counters match `/v1/stats/public`; every count under 5 shows "fewer than 5" | ok |

Every step checks that the server answered: the API-01 / API-10 / persona-session status codes, `plan-saved` (never "computed on your phone"), and that the active case is never a device `cas_demo_*` stand-in.

## 5. What was fixed

**apps/web (UI ↔ Go API wiring)**
- **Device session never worked.**
  - Before: the UI sent `device_public_key: "web-anon"` (8 chars; API-06 needs 16-200), so every real call silently fell back to the device mock.
  - Now: it sends a random per-device key, keeps an existing `md_sid` session (checks `GET /v1/me` first instead of overwriting a persona session), and resets after a persona switch or account deletion.
- **CSRF header.** `@margdarshak/api-client` now sends `X-Requested-With: margdarshak` on every write, as the deviceSession scheme requires (403 `CSRF_REJECTED` before). There is a unit test for it.
- **API-01.** The server plan is used as is (no more merge). `toApiRequest` sends the rule-pack picture IDs the contract accepts (it used to map `taxi` to `auto_rickshaw`) and every fact (mobile linked, home test device, test vehicle), so the server and device plans are identical.
- **API-10.**
  - Case facts (`PlanFacts`) are sent.
  - `for_family_member` is no longer sent without a `family_member_id` (that was a 422).
  - "Start my application" now posts `ll_application_started`. Without it the server case stayed in PLAN, and "paid, got an application number" was an illegal transition, so the home never moved on.
- **Persona switcher (MD-122).** With a real API it uses `GET /v1/demo/personas` and `POST /v1/demo/personas/{id}/session`, then `GET /v1/me/licences` → `GET /v1/cases/{id}`, the plan from API-01, and the family member from `GET /v1/me/family-members`. Mock mode is unchanged.
- **API-70.**
  - The lab page passes its validated `?token=` to the replica, which sends it as `X-Lab-Token`.
  - A real `field_study` consent artefact is recorded first (the API needs a `cns_…` ID).
  - The trial-log counters are sent.
- **API-61 / API-62.**
  - Export follows the 202 `job_id` to `GET /v1/me/exports/{id}`.
  - Delete reports the reminders the server cancels (read from API-14 before API-17).
- **Hand-off chip (MD-045).** The Simulated chip follows API-16's `adapter` / `simulated` provenance instead of a hard-coded `deeplink`. The device stand-in stays "simulated".
- **Workspace link.**
  - `@margdarshak/rules` is now a `workspace:*` dependency of apps/web and in `transpilePackages`.
  - The tsconfig path and Vitest alias hack are removed. `allowImportingTsExtensions` stays, because the rules source imports `.ts` files.
- `NEXT_DIST_DIR` lets the real-mode build live in `.next-real` (gitignored, ignored by Biome) next to the mock build.
- `messages/en.json` and `hi.json` had CRLF line endings, which Biome rejected; they are now LF.

**apps/web: P1 gap closing (24 Oct, frontend only; no backend change)**
- **API-13 blockers** (`lib/journey/api.ts` `serverBlockers`, `lib/journey/blockers.ts`, `lib/case/use-case-issues.ts`). The task list and check answers read the server's blockers for a server case and re-read them after each autosave. The rows map back to the engine's `Issue`, so the same `IssueCard` (source chip, "verify at your RTO") renders them. A note under the list says which source answered; `cant_tell_yet` adds "some answers are still missing". The device engine remains the fallback (mock mode, a case kept on the phone, offline).
- **API-19 payment intents** (`components/apply/pay-online.tsx`, `lib/journey/payment.ts`). On the fee screen, a server case with a stored quote can pay the LL-stage amount on the state's gateway. In the demo this is the API's simulated gateway page. `POST /v1/cases/{id}/payment-intents` (`stage: ll`, `return_path: /{locale}/apply/fee`) is followed by a redirect to the gateway. The gateway's signed callback (API-24) moves the case, and the page returns to the fee screen. Paid or pending is read from the re-fetched case, never from the `?payment=` hint. Paid links to the application number. Pending links to the EC-09 guidance and offers no pay button. A 409 `PAYMENT_PENDING` gets a kind "a payment is still pending, we won't start a second one" message; `QUOTE_STALE` asks for a reload. Mock mode and device-only cases keep the Mode A path (pay on Sarathi).
- **API-63 analytics** (`lib/journey/analytics.ts`, `lib/journey/track.ts`).
  - An allowlist of 8 events from the API's taxonomy, with enum, small-integer or token values only. Anything else is dropped on the phone, and so is any value the PII finder flags.
  - Events are sent only when the `analytics` consent is active. API-60 reads and writes keep a flag; if the consent is unknown, the consents are read once.
  - Nothing is queued while the active case is a minor family member's. A 16-17 plan card and application start are not tracked either. The batch also carries `case_id`, so the API drops it too.
  - Batches go out after a 2 s debounce (at most 20 per request), and also on pagehide. A failed batch is dropped, never retried or stored.
  - Revoking the consent clears the queue.
- **API-71 public stats** (`components/lab/public-stats.tsx`, `lib/journey/stats.ts`). A "Field study so far" card shows at the end of All services, and the full counters show on the lab page (in the lab's fixed light styling). Every count under 5 shows "fewer than 5", and a median shows only with at least 5 participants (on top of the API's own suppression). With no API, the card says the counters are live only when the server is connected.
- **Sign-in and family mode** (`app/[locale]/(citizen)/signin`, `components/privacy/sign-in.tsx`, `lib/case/family.ts`, `components/apply/question-page.tsx`).
  - New `/signin` with an e-mail link only (API-07 `requestSignInLink`, API-08 `signInWithCode`, API-09 `signOut`). It keeps a same-app `?return=` and redeems `?code=` once.
  - In mock mode there is no e-mail server, so the link is shown in a banner labelled "Simulated e-mail".
  - The parental-consent question asks an anonymous device to sign in first ("Sign in to add a family member"). A signed-in or persona account goes straight to the consent.
  - After the consent, the application moves to the member's server case (API-10 with `family_member_id`). The answers, plan facts, on-device vault and document checks move with it, and the stand-in case is deleted (API-17).
  - The privacy centre shows the account state, with a sign-in link or sign-out (placed below the consents, so loading it never shifts the switches).
  - Everything else stays anonymous.
- `ApiError` now carries the problem `code` for every non-fallback status (409 `PAYMENT_PENDING` / `QUOTE_STALE`).
- Vitest `src/lib/journey/p1-gaps.test.ts` (18 tests) covers:
  - blocker mapping;
  - payment state and return hint;
  - stats suppression;
  - the analytics allowlist, consent gating, the minor rule, batching and drop-on-failure;
  - against a fake API in real mode: API-13, API-19 (201, 409 `PAYMENT_PENDING`, 409 `QUOTE_STALE`, headers), API-63 body, the API-60 consent flag, API-71 without a session, and API-07/08 request shapes (401 `UNAUTHENTICATED`);
  - mock sign-in (single-use code).
- Specs:
  - `journey-apply.spec.ts` (mock): Rahul now signs in through the simulated e-mail link before the parental consent.
  - `journey-a11y.spec.ts` adds `/signin`.
  - `real-journey.spec.ts` adds 4 full-stack tests (§4) and extends Tanvi with API-13. It carries a still-valid anonymous device session from test to test, because API-06 allows 10 per hour per IP (§6).

**services/api (minimal, additive)**
- **CORS.** The preflight now allows `X-Request-Id` (which every client request carries) and `X-Lab-Token`. Before, a browser on another origin could not make any API call.
- **`DEV_CLOCK_OFFSET`** (dev/test only; staging, production and field refuse it, `TestDevClockOffsetIsDevOnly`). It shifts the server clock so the full-stack e2e can run the case clock outside quiet hours at night. Documented in `services/api/README.md`.

**Tooling and CI**
- `pnpm api:dev` / `pnpm api:seed` work out of the box (embedded PostgreSQL, `--profile demo --synthetic`).
- Root `test:e2e:real`, `@margdarshak/e2e` `e2e:real`.
- The Playwright config has a `real` mode (`E2E_MODE=real`, `real-*.spec.ts`) and a teardown that stops the e2e PostgreSQL.
- `size-limit` all-chunks ceiling: 360 → 580 KB. It is a sum over every route and was set in P0, before the ~25 P1 routes existed. The per-route first-load budget is unchanged and passes.
- **`ci.yml`:**
  - Removed references to scripts and targets that do not exist (`scripts/ci/*.mjs`, ESLint, `test:golden`, `test:determinism`, compose-stack e2e, `mobile-chrome-lowend`).
  - Now uses `pnpm lint:*`, the real Go test names, `node --test` for the rules mirror, the brokenmock negative check, mock e2e with both projects, and a new `e2e-real` job.
  - Codegen drift is checked on `internal/httpapi/gen`.
  - The size gate is `pnpm size`.
- **`deploy.yml`:**
  - The smoke check uses the API-64 fields (`status`, `ok`, `checks.postgres`, `commit`).
  - It uses API-01 paise: `fees.subtotal_govt_fee_paise == 70000`, `smart_card_paise == 20000`, `total_paise == 90000`, with `vehicles: ["bike_gear"]`; the old request sent the class code `MCWG` as a vehicle and read non-existent rupee fields.
  - The footer check uses `/en/help`.
  - A signed API-65 dry-run sweep replaces the non-existent `/internal/ops/smoke-task`.
  - The warm-up hits only routes that exist.
  - The Helm job checks that the chart exists (P6).
- **`evals.yml`:** the P3 AI layer is not built, so the offline job now:
  - validates the eval sets (≥ 30 cases, unique `case_id`);
  - runs the redaction and family-mode/consent tests;
  - runs the wording and fee lint.
  The model jobs are skipped until `internal/adapters/ai/evals` exists.
- **`security.yml`:** removed the missing `.zap/rules.tsv`.
- `docs/03-engineering/ENVIRONMENT_SETUP.md` command table: the commands that did not exist are replaced with the real ones.

## 6. Known gaps

1. **Live credentials:**
   - Render deploy, preview and rollback;
   - the WhatsApp test number, n8n and SMTP;
   - a GitHub Actions run (also needs a push).
   All the commands are prepared. The deploy smoke's signed sweep needs the `INTERNAL_BEARER_TOKEN` and `INTERNAL_HMAC_SECRET` secrets.
2. **Family mode sign-in: closed in the UI, with backend follow-ups.** Family mode now requires a signed-in adult (`/signin`, §5). These are open:
   - **Magic-link path.** The API e-mails `WEB_BASE_URL/auth/magic?code=…`, but the web route is `/{locale}/signin?code=…`, and `/auth/magic` is not a web route (the frontend session could not add one: shared routing). Either the API sends `/signin?code=…` (or `/{lang}/signin`), or the web shell redirects `/auth/magic` → `/signin`. Until then, a real e-mail link lands on the not-found page. The e2e opens `/en/signin?code=` with the code from the dev log.
   - **Log redaction of the link.** The dev log redactor treats a 4-8 digit run near the word "code" as an OTP, so a magic-link code can be masked in the console line. The e2e asks again in that rare case.
   - **Moving a case to a member.** There is no API to link an existing case to a family member, so the UI opens a new member case and deletes the stand-in. A `PATCH /v1/cases/{id}` with `family_member_id` (or creating the member before the case) would avoid that.
3. **API-13 / API-19 / API-63 / API-71: wired** (§5). Notes:
   - Payment intents show only for a case on the server with a stored quote (`fees.quote_id`). Mode A (pay on Sarathi) stays the path in mock mode.
   - `POST /v1/cases` answers 409 `CASE_EXISTS` when an open case of the same applicant already covers a class. "Start my application" then shows the generic error, not "you already have an application for this class".
   - API-06 allows 10 anonymous device sessions per hour per IP. The full-stack suite now has 14 tests, so it carries one anonymous session across tests. A dev/test override for that limit (a backend change) would let each test start fresh.
4. **Human steps:**
   - PD + BE sign-off on the CMVR base + J&K packs;
   - the signed lab comparison sheet;
   - a phase demo run by someone who did not build it, on a low-end Android phone.
5. **CI coverage and Lighthouse.** Coverage thresholds are reported, not enforced. `internal/clock` has no package-local tests (it is covered through `internal/httpapi`). There is no Lighthouse job.
6. **Quiet hours and the e2e.** Between 21:00 and 08:00 IST the full-stack launcher shifts the API clock to 12:00 IST the same day (`DEV_CLOCK_OFFSET`), and the specs put the browser on the API's clock. In daytime there is no shift.
7. **Windows.** Playwright hard-kills web servers, so the launcher retries an API start that dies while PostgreSQL's binaries are still locked, and the teardown stops the embedded PostgreSQL.
8. **P2-owned files.** On the first full Biome run, `services/score-verifier/src/cli/replay.ts` (P2 session) was not formatted; it was clean on the final run.

## 7. Final fixes (coordinator, 24 Oct 2026 ~04:45 IST)
| Fix | Where | Evidence |
|---|---|---|
| E-mailed sign-in links `/auth/magic?code=…` (API-07) now redirect to `/{locale}/signin?code=…`. Before this they landed on not-found. | `apps/web/src/lib/journey/magic-link.ts`, called from `src/proxy.ts` | `vitest run src/lib/journey/magic-link.test.ts`: 3/3 |
| 409 `CASE_EXISTS` on "Start my application" opens the existing open case, or shows a calm "go to My Licence" banner. | `apps/web/src/components/apply/apply-start.tsx` (+ EN/HI keys) | web Vitest 153/153; lint:facts/patterns/i18n clean; biome clean; the changed files typecheck |

**State of the tree after these fixes:** `pnpm --filter @margdarshak/web build` fails type-checking, but only in the P2 session's in-progress files (`src/features/games/registry.ts`, `src/features/learn/ui/states.tsx`). The P0/P1 journey code compiles. The P2 session will re-run the journey e2e (mock 34/34 and real 14/14 at the last green run) in its final P0–P2 pass once its features compile.

**Backend follow-ups, now owned by the P2 session (services/api):**
- The dev-log redactor sometimes masks the magic-link code.
- A `PATCH /v1/cases/{id}` that accepts `family_member_id` would remove the stand-in case swap.
- The anonymous device-session limit (10/h/IP) needs a dev/test override for e2e.

### 7.1 Browser evidence for the two fixes (~05:40 IST, `next dev`; the build is blocked by the P2 type errors)
- **New full-stack specs** in `tests/e2e/specs/real-journey.spec.ts`:
  - "API-10 409 CASE_EXISTS: the phone forgot its case…". It receives a 409 from the Go API, lands on `/en/apply`, and the same case is active again. **Passed.**
  - "API-07 link: /auth/magic?code= opens sign-in in the reader's language". It goes to `/en/signin?code=…`, and to `/hi/signin?code=…` with `NEXT_LOCALE=hi`. **Passed.**
- **Family-mode spec** now follows the e-mailed link exactly as written: `WEB_BASE_URL/auth/magic?code=…` → sign-in → API-08 200 → parental consent. **Passed.**
- **Real suite on `next dev`:** 10/16 passed in one run.
  - **MD-108 offline ×4 failed.** Dev mode serves on-demand chunks, so a page can't load once offline. This is expected on a dev server.
  - **2 persona tests failed.** "Demo personas" was clicked before hydration on a cold dev route. Tanvi passed on a re-run. The persona switcher is unchanged since the last green build run (14/14).
- **Not done:** the mock journey run on the dev server was stopped by the host for low memory before it reported.
- **Still owed:** once the P2 files compile, re-run both suites on the production build:
  - `pnpm --filter @margdarshak/web build && cd tests/e2e && E2E_PORT=3171 LAB_TOKEN=labtest npx playwright test journey- --project=mobile-360`
  - `pnpm test:e2e:real`

### 7.2 Final verification on the production build (~05:55 IST; P2's files now compile)
This section replaces the dev-server results in §7.1. Every result below is from the current tree.

| Gate | Result |
|---|---|
| `tsc --noEmit` (apps/web) | 0 errors |
| `pnpm --filter @margdarshak/web build` | passes |
| Mock journey e2e, `journey-` on mobile-360 (production build) | **34/34** |
| Full-stack e2e, `E2E_MODE=real` (production build + Go API + embedded PostgreSQL) | **16/16**, including the 2 new specs and the changed family-mode spec |
| Go: `gofmt -l` / `go vet ./...` / `go test ./...` | clean / clean / all pass |
| `pnpm -r typecheck` / `pnpm -r test` | pass. web 229, game-core 323, gamification 144, clip-pipeline 134, rules 119, content 93, workflows 93, score-verifier 70, ui 19, api-client 4 |
| `pnpm lint` (biome, wording, fee literals, patterns, i18n) | clean. i18n: 2113 keys in en + hi |

**Notes:**
- **Separate build folders:** the P2 session rebuilt `.next` while one of my runs was in progress (8 false failures). So the final runs built into their own dist folders: `NEXT_DIST_DIR=.next-coord` and `.next-real-coord`. Both folders were deleted afterwards because Biome scans them; neither is in `.gitignore`.
- **Demo-checkpoint timeout:** this spec takes about 28 s cold (it is the first test on a fresh API and database) against the 30 s limit. It is now marked `test.slow()`.

### 7.3 After the shared-shell changes (~08:50 IST)
- **What changed:**
  - P2 (agreed with me): `SerwistProvider reloadOnOnline={false}`, and Biome/.gitignore now ignore `apps/web/.next-*`.
  - Coordinator: `ensureSession()` (`lib/journey/api.ts`) no longer keeps a failed attempt (offline or 429), so it retries after reconnecting without a reload. Unit test "API-06: a failed device session is retried…" passes.
  - Coordinator: "Clear this device" (`lib/prefs/device.ts`) also deletes `md-journey`, `md-learn` and `margdarshak-game-queue` by name, for browsers without `indexedDB.databases()`.
- **Mock journey e2e** on a fresh isolated production build: **34/34**, including MD-108 offline.
- **Full-stack e2e re-run:** pending. The web build is blocked by P2's in-progress `features/curator/mock-store.ts` and `features/stopping-distance/rounds/PredictReveal.tsx`. The last full-stack run (§7.2, 16/16) predates the `ensureSession` change.
- **Update ~09:10 IST:** the full-stack e2e (`E2E_MODE=real`) passed **16/16**. It used an isolated production build of the tree as of 09:00 (web tsc 0 errors) and the Go API as of 09:05 (`go build` clean). This run includes the `ensureSession` retry and `reloadOnOnline={false}`. With this, every P0/P1 browser gate is green on the current journey code.
