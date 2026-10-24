# What's done and what's left (P0, P1, P2) — 24 Oct 2026

Evidence lives in [docs/08-project/P0_P1_VERIFICATION.md](docs/08-project/P0_P1_VERIFICATION.md) and
[docs/08-project/P2_VERIFICATION.md](docs/08-project/P2_VERIFICATION.md). This page is the short version.

## 1. Status at a glance

| Phase | Status |
|---|---|
| **P0 Foundations** | Done and verified. Left: Render deploy/preview and a GitHub Actions run (need team credentials); no Lighthouse CI job; PD + BE sign-off of rule packs (human). |
| **P1 Journey core** | Done and verified (mock journey e2e 34/34, full stack 16/16). Left: live WhatsApp / SMTP / n8n delivery (credentials); lab comparison sheet sign-off (human). |
| **P2 Learning and games** | Done in code and verified. Left: the human tasks in §3 (clip bank, raters, HYPOTHESES.md, device checks). |

## 2. What's done

**Final gates on the finished tree (24 Oct, 12:11–12:32 IST):**
- Go: gofmt, vet, golangci-lint (0 issues), no codegen drift, `go test` **308 passed, 0 failed** (22 packages, embedded PostgreSQL 16).
- TypeScript: typecheck (11 workspaces), lint (Biome, wording, fees, dark patterns, i18n), production build, bundle budgets (every route ≤ 450 KB; union JS 683.5/700 KB; union CSS 48.5/50 KB).
- Tests: web 316 · game-core 323 · gamification 144 · content 107 · clip-pipeline 157 · rules 119 · workflows 132 · score-verifier 71 · ui 19 · api-client 4.
- Mock e2e (every spec): **287 passed, 0 failed** (47 desktop skips for 360 px-only flows).
- Full-stack e2e (Go API + Postgres + score verifier): **21 passed, 0 failed**.

**P2 built:**
- `packages/game-core`: Game SDK (Zod schemas), seeded PRNG + deterministic math, scorers (Nazar 5-band + anti-spam, Stopping Distance, Blind Spot, Junction Scan, Track Twin, LL sim), staircase, integrity/trust, replay codec + digest, template debrief and validator, browser event queue.
- `services/score-verifier`: HMAC replay service; also the TS compute service for learning, gamification and clip agreement.
- `packages/gamification`: XP (×0.5 after 45 min, ×0.2 after 90), ranks Gali → Ghat, FSRS (ts-fsrs, fuzz off), readiness (78 = 84 − 6) with Brier, streaks, squads, badges, dark-pattern spec.
- `content/` + `packages/content`: LL bank (75 concepts, 239 variants), curriculum LL0–LL4, M1–M22, DL1, rule/finding/drill/skill catalogues, AI allowlists, Nazar scene catalogue (29 scenes).
- `packages/clip-pipeline`: clip schema + status machine, ffmpeg/blur/flash builders, two-rater agreement, AI-clip support.
- `services/workflows`: RW-1 `clip_ingest` / `clip_finalize`, `clip_generate` (Gemini), RW-4 `nightly_stats`, `replay_pending_sessions`; n8n W08, W14.
- Go API: every P2 endpoint (API-30..39, 44, 55, 57, 70, 71, replay; API-36 now serves the template card and, with consent and a key, an ADK-worded card), migrations 00005–00009, stores, DSR export/delete for P2 data, seeded sample clips.
- Web: game host, Nazar (mock/practice/learn/screen-reader), debrief + replay, share card, learn hub, review, readiness, LL simulator, Me tab, squads, Lite mode, Stopping Distance, Blind Spot (Phaser), clip curator/rater UI, Nazar study flow.

## 3. What's left

### People (cannot be done in code)
1. **Generate the Nazar clip bank** (~20 clips) — see [video_generation_guide.md](video_generation_guide.md). Cost ≈ $160–360, 2–3.5 h. Then **two human raters per clip** + a curator synthetic review before publishing.
2. **HYPOTHESES.md (MD-241)** — review [HYPOTHESES.draft.md](HYPOTHESES.draft.md), fill the placeholders (clip IDs per block, G0 time, versions), rename, and commit **before any study data**.
3. **Device checks** — TalkBack pass (MD-225), on-device Nazar frame timing (MD-222), Phaser numbers on the slowest team phone (open `/en/dev/phaser-spike?cars=24&auto=1`, paste JSON into ADR-0012).
4. **Content reviews** — native Hindi review (all `hi` strings marked pending), medical sign-off of Golden Hour content, two-person review of practice rules (until then the AI allowlists cite no rule).
5. **Git** — tag `game-sdk@1` (the P0–P2 work is committed).
6. **Study length decision** — 15 study clips × ≥ 20 s is ~5 min before the LL mock; shorten study scenes or accept a longer session (decide before committing HYPOTHESES.md).

### Credentials
- `GEMINI_API_KEY` (and optionally `GEMINI_MODEL_VIDEO_GEN`, `NAZAR_SCENES_PATH`) on the Workflows service.
- Render deploy and preview (`RENDER_API_KEY`, service IDs), GitHub Actions run.
- Live WhatsApp Cloud API test number, SMTP, n8n instance.

### Google ADK agents (Go, `services/api/internal/adapters/ai/`, demo build 24 Oct)
Built and tested (fake-model tests through the real ADK runner, plus live Gemini 3.8 Flash tests when `GEMINI_API_KEY` is set): shared `ai.Structured` helper (llmagent + runner + in-memory session + schema output + PII and audit plugins), scam explainer (API-43), debrief (API-36), tutor glue (API-41), screenshot decoder (API-42). Server-side `ai_coach` consent gate before every agent except the scam checker; any validator failure falls back to template or reviewed text (EC-29).
Not built: voice guide (API-40, `RunLive`), coach agent, sign snap, clip window proposer in Go, provenance and cost-guard plugins, consent gate on the scam checker, the 30-case eval sets (`ai/evals`), `/v1/scam/check` web screen, fee-mismatch flag, a real error catalogue for the decoder (a 7-stage demo table is built in), Hindi enum labels in the debrief.

### Not built (deferred or out of P2 scope)
- pair mode, share-card percentile, XP for lessons/predictions, production admin login (persona sessions only), offline late registration of sessions, per-hazard-type staircases, Lighthouse CI job.

### Docs refreshed (24 Oct)
- `docs/05-ops/N8N_WORKFLOWS.md` now lists W08's `/internal/clips/...` endpoints; `services/workflows/P2-PHASE2.md` covers `clip_generate`; TEAM.md records the MD-229 decision (DEC-018, ADR-0012); CHANGELOG and README carry the P0–P2 status.

### From the 24 Oct merge (teammate's n8n scope change, ADR-0006 rev., TEAM DEC-022)
The docs now record the decision that citizen messages go through a backend notifier and n8n handles staff operations only. The code has not moved yet:
- **Backend notifier:** build `WhatsAppCloudNotifier` / `EmailNotifier` and the outbox worker in `services/api`; until then the P1 build delivers through the n8n W02 webhook (`internal/adapters/notify/n8n.go`).
- **W01 watchdog:** the teammate's W01 polls `GET /internal/clock/sweep/{id}/status`, which the Go API does not have; the merged W01 keeps the version tested against the real API. Add the endpoint, then adopt the watchdog.
- **OpenAPI:** our `api/openapi.yaml` was kept (the teammate's edits were description-only plus dropping the `letter_approval` / `request_fallback` webhook events, which the W02 path still uses). Re-apply them with the notifier, then run `go generate` and `pnpm gen:api`.
- **CI wording scope:** the teammate's CI step called a missing `scripts/ci/check-wording.mjs` to scan `services/api`; `pnpm lint:facts` covers the TS and n8n copy. Extend it to notifier templates once they exist.

### Open decisions (for the clip bank)
- 24 → 30 fps conversion of generated clips (judder vs scoring maths) — video_generation_guide.md §5.
- Blur layer on AI clips in precheck (faces/plates second safety net) — video_generation_guide.md §3.
- Adopt the proposed realism prompt PRM-CLIPGEN 1.1.0 — video_generation_guide.md §7.

### Unverified
- Whether SynthID survives our transcode (disclosure is carried in `clip.json`, manifests and the UI label regardless).
- Whether CC-BY can be applied to Gemini outputs under the API terms (ADR-0013).

## 4. Decisions to review
- **Bundle ceiling:** the all-chunks JS ceiling was replaced by a first-load union gate that excludes lazily loaded game chunks (reasoning in P2_VERIFICATION §5).
- **Nazar clips are AI-generated** (ADR-0013): labelled "AI-generated scene"; results are reported "on AI-generated road scenes"; two human raters still set every scoring window.
