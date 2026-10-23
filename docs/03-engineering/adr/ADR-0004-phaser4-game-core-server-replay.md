# ADR-0004: Phaser 4 + `@margdarshak/game-core` with server replay
> Project: Margdarshak · Owner: Games lead · Status: Accepted · Date: 2026-10-23
> Related: [Architecture §6, §10.4](../ARCHITECTURE.md) · [Backend §9](../BACKEND.md) · [Tech stack §3](../TECH_STACK.md) · ADR-0002 · ADR-0003

## Context and problem statement
The game layer (F-23 Nazar, F-24 simulations, F-25 debrief, F-26 gamification) must: run at 60 fps (30 fps fallback) on low-end Android; work offline; be accessible (no-audio, tap-only, screen-reader alternatives); and produce **scores that cannot be faked**, because scores feed share cards, the Practice Record, squad scores and the field study (D-22). The council requires deterministic scoring by code, with Gemini only narrating (D-09, D-11).

## Decision drivers
- Deterministic, explainable scoring ("you tapped 1.4 s late ≈ 16 m").
- Anti-cheat without accusing users.
- One scoring implementation, no client/server drift.
- Low-end GPU performance; WebGL context loss on mobile.

## Considered options
1. **Phaser 4.2.1 for top-down sims + HTML video/SVG/React for Nazar and decision games; scoring in a pure TS package `@margdarshak/game-core`; a stateless Node score verifier replays every session and overwrites the client score.**
2. Same engines, but re-implement scoring in Python on the API for verification.
3. Trust client scores; detect cheating heuristically.
4. PixiJS 8 or KAPLAY instead of Phaser; or Three.js/R3F 3D.

## Decision outcome
Chosen option: **1**, because the same TypeScript scoring runs in the browser and on the server, so replay is exact (fixed 60 Hz step, seeded mulberry32, no `Date`/`Math.random` in scoring), and Phaser 4 is a full framework whose renderer recovers from lost WebGL contexts (`08` §1.2).

### Consequences
- Good: the server score is the one that counts; mismatches become integrity flags (`trust < 0.6` → practice only), never accusations.
- Good: hazard windows and track specs live server-side only; clients never receive answers.
- Good: Nazar follows brief §15 — UK-style 5 bands per hazard, scaled to Kerala's 10 × 10 format; > 3 taps per second voids the clip.
- Bad: a second runtime (Node 22) in the backend; mitigated by a tiny stateless `node:http` service with HMAC auth and golden tests.
- Bad: Phaser 4 is new (Apr 2026) with no independent mobile benchmarks → spike on the slowest team phone in hour 1–2; fall back to the last Phaser 3.x if blocked.
- Under-18 users play locally with no server session (brief §15, D-13).

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Deep games | Nazar, LL simulator, Stopping Distance, Blind Spot | + Junction Scan, Track Twin, Helmet Fit, Golden Hour, Night & Glare, Hill Road |
| Verifier | Render private service | HPA-scaled pods |

## Pros and cons of the options
### Option 1
- Good: exact replay, single source of scoring truth, accessible DOM for video games.
- Bad: Node service to run.
### Option 2
- Good: one backend language.
- Bad: two scorers drift; every rule change is done twice; golden tests can't catch everything.
### Option 3
- Good: cheapest.
- Bad: share cards and field-study numbers become untrustworthy; Sambyal's "who computed that?" fails.
### Option 4
- PixiJS: renderer only (we'd build input/physics/scenes in 48 h). KAPLAY: next major alpha. 3D: too heavy for ₹10k phones and teaches nothing extra.

## Validation
Golden replay tests in CI (browser score == verifier score for recorded inputs); p95 verify < 150 ms target (BACKEND §9.2); integrity-flag rate monitored.

## Links
- `research/ps1-deep/08-game-ai-n8n.md` §1–§3
- `war-room/margdarshak-verification.md` §1.1, D-11
- npm: phaser 4.2.1, @mediapipe/tasks-vision 1.1.1
