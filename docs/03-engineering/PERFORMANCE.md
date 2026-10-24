# Performance
> Project: Margdarshak · Owner: Tech lead (Frontend lead for client budgets, Backend lead for SLOs) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [Project Brief](../00-overview/PROJECT_BRIEF.md) · [Frontend](FRONTEND.md) · [Backend](BACKEND.md) · [Testing](TESTING.md) · [Architecture](ARCHITECTURE.md) · [Infrastructure](../05-ops/INFRASTRUCTURE.md) · [Observability](../05-ops/OBSERVABILITY.md) · [Cost](../05-ops/COST.md)

Performance here is an inclusion requirement, not polish: Kabir (P-01) is on an Android phone with patchy 4G, Mohan-ji (P-03) may be on an old handset, and Lite mode must work on 2G (F-51, EC-19). It is also an evidence item: "KB on 3G" is one of the three before/after metrics in the evidence plan (PROJECT_BRIEF §12).

Every number below is a **target we will measure**, not a measured result, unless marked "measured". Measurements go into this file with date and device.

---

## 1. Reference devices and networks

| Profile | Device | Spec | Use |
|---|---|---|---|
| **Low-end Android (primary)** | ₹8–12k Android phone (e.g. the slowest phone in the team; Lighthouse "Moto G Power" emulation in CI) | 2–3 GB RAM, Mali/PowerVR-class GPU, Chrome (current), Android 12+ | all budgets |
| Very low end | 1–2 GB RAM, Android Go-class | Lite mode only; games in SVG decision versions |
| Mid Android | 4–6 GB RAM | games at 60 fps |
| iPhone (Safari) | iPhone 11+ | parity checks (no Vibration API; rVFC supported in Safari 15.4+ per MDN [K]) |
| Desktop (console) | 1366 × 768, Chrome | console budgets |

| Network profile | Down / up / RTT | Source of profile |
|---|---|---|
| Regular 2G | 250 kbps / 50 kbps / 300 ms | Chrome DevTools-style preset |
| Slow 3G | 400 kbps / 400 kbps / 400 ms (DevTools "Slow 3G") | DevTools |
| Fast 3G / poor 4G | 1.6 Mbps / 750 kbps / 150 ms | Lighthouse mobile default throttling |
| 4G | 9 Mbps / 9 Mbps / 60 ms | — |

Server location in the hackathon build is **Render Singapore**, so India → Singapore RTT is part of every request (typically tens of ms on good networks; measure from Jammu on day 1, owner Backend lead, 2026-10-24). Production moves to an Indian region (D-17).

---

## 2. Service level objectives (SLOs) and indicators (SLIs)

### 2.1 Availability

| Service | SLI | Hackathon window (judging days) | Production (Phase 3+) | Error budget (30 days) |
|---|---|---|---|---|
| Citizen web (`apps/web`) | successful page responses / all (synthetic + RUM) | 99.5% | 99.9% | 43 min |
| API read paths (plan, rules, case GET, learn) | non-5xx / all | 99.5% | 99.9% | 43 min |
| API write paths (autosave, events, sessions) | non-5xx / all | 99.0% | 99.5% | 3.6 h |
| Voice (API-40) | sessions established / attempted | best effort (not on the critical demo path) | 99.0% | 7.2 h |
| Case clock | milestones fired by `due_on + 1 day` / due | 99% | 99.9% | — |
| Clip pipeline | runs succeeding after retries / runs | 95% | 99% | — |

Error-budget policy (Phase 3+): if a service burns > 50% of its 30-day budget in 7 days, feature work on it stops until the burn rate is back below 1×.

### 2.2 Latency (server-side, measured at the API, excluding client network)

| Endpoint group | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| API-01 `POST /v1/plans` (rules evaluation) | 40 ms | 150 ms | 300 ms | compiled pack in memory |
| API-02/03 rules classes/fees | 10 ms | 40 ms | 80 ms | ETag; mostly CDN/browser cached |
| API-11 case GET | 30 ms | 120 ms | 250 ms | includes `displayStage`, `primaryAction` |
| API-12 autosave PATCH | 40 ms | 150 ms | 300 ms | optimistic concurrency |
| API-13/14 blockers, timeline | 40 ms | 150 ms | 300 ms | — |
| API-31/32 learn queue/answers | 30 ms | 120 ms | 250 ms | — |
| API-34 create game session | 40 ms | 150 ms | 300 ms | unseen-clip selection |
| API-35 complete (incl. score verifier) | 120 ms | 400 ms | 800 ms | verifier p95 150 ms |
| API-36 debrief (AI path) | 2.0 s | 4.0 s (p90 target from `08` §5.8) | 6.0 s (hard budget → template) | UI shows template instantly |
| API-41/42/43 AI endpoints | 1.5 s | 4.0 s | 8.0 s | template/"unknown" fallbacks |
| API-40 voice first audio byte after end of user speech | 800 ms | 1.5 s | 2.5 s | [unverified: Gemini publishes no latency figures; measure at H0] |
| API-64 health | 5 ms | 20 ms | 50 ms | — |

Client-perceived targets (p75, real devices, India): TTFB ≤ 800 ms; autosave round trip p95 ≤ 600 ms on 4G; "Saved on this phone" shown < 100 ms (local).

### 2.3 Web vitals (p75 field, reference low-end Android)

| Metric | Full mode | Lite mode |
|---|---|---|
| LCP, Slow 3G | ≤ 4.0 s | ≤ 3.0 s |
| LCP, Regular 2G | — (Lite suggested) | ≤ 5.0 s; full first load ≤ 12 s |
| LCP, 4G | ≤ 2.5 s | ≤ 1.5 s |
| INP | ≤ 200 ms | ≤ 200 ms |
| CLS | ≤ 0.05 | ≤ 0.05 |
| TBT (lab, Moto G Power) | ≤ 300 ms | ≤ 100 ms |

---

## 3. Transfer-size budgets (brotli, cold cache)

| Route | Full mode | Lite mode |
|---|---|---|
| `/hi` home first load (HTML + CSS + JS + fonts + icons) | ≤ 450 KB | **< 300 KB (hard gate)** |
| `/hi/plan` incremental | ≤ 80 KB | ≤ 30 KB |
| `/hi/apply/*` step incremental | ≤ 60 KB | ≤ 25 KB |
| `/hi/learn/ll-test` incremental (incl. question bank for one tenant) | ≤ 150 KB | ≤ 120 KB |
| Game chunk per game (engine excluded) | ≤ 350 KB gzip | n/a |
| Phaser shared chunk | measure at H0 (owner Game lead, 2026-10-24) | none |
| MediaPipe WASM + model | measure; loaded only on "Start camera check" | none |
| Rive canvas-lite runtime | ≈ 222 KB brotli (per `08` §1.2), lazy, never on first load | none |
| Lottie file | < 60 KB each, lazy | none |
| Nazar clip | ≤ 5 MB (480p) full; 1–2 MB target (360p) for Lite packs | 360p only, explicit download |
| Practice pack (10 clips) | size shown before download; no silent download | same |

Lite detail (see [FRONTEND](FRONTEND.md) §9): HTML ≤ 30 KB, CSS ≤ 15 KB, JS ≤ 90 KB, fonts ≤ 25 KB, icons ≤ 20 KB, SW + manifest ≤ 25 KB, headroom ≥ 95 KB.

---

## 4. Enforcement

| Gate | Tool | Where | Fails when |
|---|---|---|---|
| Chunk sizes | `size-limit` 14.3.0 + `@size-limit/preset-app` | PR | any budget in §3 exceeded |
| Lite total | Lighthouse CI 0.15.1, `resource-summary` budgets on `/hi/lite` | PR | ≥ 300 KB total |
| Web vitals lab | Lighthouse CI, mobile, Slow 3G custom throttling, 3 runs median | nightly | LCP/TBT/CLS over budget |
| Bundle composition | `@next/bundle-analyzer` 16.4.3 report attached to PR | PR (on demand) | — |
| Field RUM | `web-vitals` 6.2.3 → API-63 (aggregated, no PII; never for a family-mode learner under 18) | always | p75 regression > 10% week over week → n8n W12 alert |
| API latency | OpenTelemetry histograms per route | always | p95 over SLO for 15 min → alert |
| Load | k6 (see [TESTING](TESTING.md) §11) | weekly + pre-demo | pass criteria missed |

---

## 5. Game performance targets (F-23, F-24)

| Target | Value | How |
|---|---|---|
| Render frame rate | **60 fps** on mid Android; **≥ 30 fps floor** on low-end with logic unchanged | fixed 60 Hz `sim-core` step with an accumulator; rendering decoupled |
| Frame time budget | 16.7 ms (60 fps): ≤ 4 ms sim, ≤ 8 ms render, ≥ 4 ms headroom | Phaser profiler + Chrome performance panel on the reference phone |
| Long tasks during play | 0 tasks > 50 ms after the first second | Long Tasks API logged to the session's integrity data (count only) |
| Input-to-visual latency (tap ring) | ≤ 50 ms | pointer handler draws immediately; scoring is not on the critical path |
| Tap timing error (Nazar) | ≈ 1 frame (±33 ms at 30 fps) via `requestVideoFrameCallback` | [FRONTEND](FRONTEND.md) §10.3 |
| Memory | ≤ 150 MB JS heap + GPU textures per game on low-end | one atlas per game, pooled objects, DPR capped at 2 |
| Load time to playable | ≤ 3 s on 4G after the shared Phaser chunk is cached; Nazar clip fully preloaded before start | preload + progress bar with size |
| Battery / heat | no full-screen filters; pause on `visibilitychange`; 30 fps cap option in settings | — |
| WebGL context loss | recover without losing session state | Phaser 4 recovery + sim pause |
| Score verifier | p95 ≤ 150 ms per 10-clip Nazar session; ≤ 300 ms per 2-minute Phaser sim replay | Node, stateless, horizontally scaled |

Spike (H0): run Junction Scan with 30 sprites on the slowest team phone; record fps, heap, chunk size here. If < 30 fps, reduce sprite count/atlas size before considering Phaser 3 fallback.

---

## 6. Load model for a state with N applicants per day

### 6.1 Assumptions (all are modelling assumptions, not measured facts)
[unverified: no per-state daily LL application volume was found in the research files; owner Backend lead to source state Sarathi/Parivahan dashboard figures or an RTI answer, due 2026-11-15.]

| Symbol | Meaning | Assumed value | Basis |
|---|---|---|---|
| N | new journeys started per day in the state (via Margdarshak) | parameter | — |
| D | average journey length, plan → card received | 100 days | research: typical 2.5–4 months to a licence (PROJECT_BRIEF §2) |
| A | open cases ≈ N × D | — | Little's law |
| f_dau | fraction of open cases active on a given day | 0.20 | assumption (learning during the 30-day bridge is the most active period) |
| r | API requests per active user per day | 60 | assumption: home + case + ~20 autosaves on application days, ~25 learn requests, 2 game sessions |
| p_h | share of daily traffic in the peak hour (evening) | 0.12 | assumption |
| b | burst factor within the peak hour | 3× | assumption (exam-season, news spikes) |
| g | game sessions per active user per day | 1.5 | assumption |
| m | case-clock milestones per case over the journey | 9 | §7 milestone table in [BACKEND](BACKEND.md) |
| a | AI debriefs per game session (every user, AI for everyone, D-13 revised) | 1 | F-25 |

### 6.2 Formulas
- Open cases `A = N × D`
- Daily active users `DAU = A × f_dau`
- Requests/day `R = DAU × r`
- Peak-hour average RPS `RPS_peak = R × p_h / 3600`; design RPS `= RPS_peak × b`
- Game completions/day `G = DAU × g`; verifier peak RPS `= G × p_h / 3600 × b`
- Debriefs/day `≈ G × a = G`; AI cost/day ≈ debriefs × ₹0.10 (`08` §5.8 Flash-Lite estimate)
- Milestones due/day `≈ A × m / D = N × m` (steady state)

### 6.3 Worked scenarios

| N (journeys/day) | Open cases A | DAU | Requests/day | Peak-hour avg RPS | Design RPS (×3) | Game completions/day | Verifier design RPS | Debriefs/day | AI ₹/day (debrief only) | Milestones/day |
|---|---|---|---|---|---|---|---|---|---|---|
| 1,000 (small state / pilot) | 100,000 | 20,000 | 1.2 M | 40 | 120 | 30,000 | 3 | 30,000 | ₹3,000 | 9,000 |
| 5,000 (mid-size state) | 500,000 | 100,000 | 6.0 M | 200 | 600 | 150,000 | 15 | 150,000 | ₹15,000 | 45,000 |
| 20,000 (large state) | 2,000,000 | 400,000 | 24 M | 800 | 2,400 | 600,000 | 60 | 600,000 | ₹60,000 | 180,000 |
| 100,000 (national aggregate, illustrative) | 10,000,000 | 2,000,000 | 120 M | 4,000 | 12,000 | 3,000,000 | 300 | 3,000,000 | ₹3 lakh | 900,000 |

(Arithmetic check for N = 5,000: A = 5,000 × 100 = 500,000; DAU = 100,000; R = 6,000,000; peak hour = 720,000 requests → 200 RPS; ×3 = 600 RPS.)

### 6.4 Capacity plan derived from the model (Phase 3+, per state tenant)

| Component | Sizing rule | N = 5,000 example |
|---|---|---|
| API instances | design RPS ÷ 150 RPS per instance (2 vCPU, one Go process per instance, `GOMAXPROCS` = CPU limit) at p95 < 150 ms, + 1 spare | 600 / 150 = 4 → **5 instances** [target per-instance throughput to be measured with k6] |
| Score verifier | verifier RPS × ~50 ms CPU ÷ 0.7 utilisation | 15 × 0.05 / 0.7 ≈ 1.1 vCPU → **2 instances** |
| Postgres | write TPS ≈ 40% of design RPS (autosave, answers, events); connections = instances × pool 10 | ~240 TPS; 50 connections → 4 vCPU / 16 GB, read replica for console analytics |
| Key Value (Redis) | sessions + rate limits ≈ DAU × 2 KB | ~200 MB |
| Object storage / CDN | clips: DAU × 0.3 pack downloads/day early, cached afterwards | CDN egress dominates; cache clips on device after first download |
| Case-clock sweep | milestones/day ÷ batch 500 → batches; ≤ 8 concurrent Workflows runs | 45,000 / 500 = 90 batches; at ~10 s/batch and 8 parallel ≈ 2 min |
| n8n executions | staff workflows only; citizen messages go through the backend notifier (ADR-0006 rev.) | ≈ 3,500–4,000/month at any number of citizens (N8N_WORKFLOWS §4); Pro ≈ 10k executions/month; grows only with staff, offices and review tasks. Until the notifier lands, the P1 build posts 1 execution per batch (never per user) |
| AI (Gemini) | debriefs/day × tokens (≈ 2.4k in / 350 out) | ≈ 360 M input + 53 M output tokens/day; check paid-tier rate limits before a state pilot [unverified quota; owner AI lead] |

### 6.5 Hackathon load (Phase 1–2)
Judging traffic: 6 judges + audience scanning the closing QR ("take the 3-minute test"): assume ≤ 300 concurrent Nazar sessions within 5 minutes. Target: API-34/35 p95 < 800 ms, zero 5xx. Render instance plan chosen so that this passes k6 `spike-share.js` the day before; instances kept warm (free-tier spin-down causes ~1-minute cold starts, `B-sponsors.md` §1, risk R-11).

---

## 7. Caching and cost-performance trade-offs

| Lever | Effect | Trade-off |
|---|---|---|
| Compiled rule packs in memory + ETag on rules endpoints | plan p95 down; near-zero DB reads for rules | memory per pack (small); invalidation by version only |
| Template-first debrief | perceived latency ≈ 0 for AI | AI cost is still incurred for every session; the client aborts the debrief request if the user leaves the screen before the coach card arrives, which saves the call |
| Flash-Lite for narration | ≈ ₹0.10 per debrief | less fluent than Flash; validator compensates |
| Clips on device (explicit pack) | repeat plays cost no data or CDN | first download is large; size shown; 360p for Lite |
| Lite mode without client framework | < 300 KB first load | two UIs to maintain for the Lite-covered routes |
| Server replay of every session | anti-cheat, trustworthy Nazar Score | verifier compute; offline sessions practice-only |
| Batch-per-run in n8n | fits n8n execution quotas | coarser retry granularity (handled by idempotency keys) |
| Render Singapore (hackathon) | free/credit-friendly, one platform | extra RTT from India; production moves to an Indian region (D-17) |
| Postgres RLS | strong tenant isolation | small per-query overhead; measured in k6 |

---

## 8. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| Area | Phase 1–2 | Phase 3+ |
|---|---|---|
| Measured on | team phones + DevTools throttling; field-study devices (RUM, consented field-study participants, who are adults) | RUM across tenants; synthetic monitors from Indian cities |
| SLO enforcement | dashboards + alerts during judging | error-budget policy, on-call |
| Load | ≤ 300 concurrent sessions spike | per-state model (§6), soak tests, national scenario |
| Regions | Render Singapore | Indian region (MeitY-empanelled / NIC), CDN PoPs in India |

## 9. Measurement log (fill as measured)
| Date | Item | Device / network | Result | By |
|---|---|---|---|---|
| — | Lite `/hi/lite` first load | — | — | Frontend lead |
| — | Phaser chunk size, Junction Scan fps | slowest team phone | — | Game lead |
| — | India → Render Singapore RTT (Jammu) | 4G | — | Backend lead |
| — | Debrief p50/p90 | Render Singapore → Gemini | — | AI lead |
