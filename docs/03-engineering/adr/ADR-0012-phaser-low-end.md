# ADR-0012: Keep Phaser 4 for the canvas sims, lazy and fixed-step, with a DOM decision version on low-end phones
> Project: Margdarshak · Owner: Learning & Games (workstream E) · Status: Accepted for Phase 1–2, pending the slowest-phone check · Date: 2026-10-24
> Related: [ADR-0004](ADR-0004-phaser4-game-core-server-replay.md) · [FRONTEND §10, §14, §18](../FRONTEND.md) · [GAME_DESIGN §1.3, §4, §13](../../09-learning-games/GAME_DESIGN.md) · [UI_SPEC_LEARN_GAMES §5.3](../../02-design/UI_SPEC_LEARN_GAMES.md) · MD-229

Format: MADR 3.x, trimmed.

## Context and problem statement
ADR-0004 chose Phaser 4 (released Apr 2026) for the top-down sims and listed one risk: no independent mobile benchmarks. Its fallback was to pin the last Phaser 3.x if Phaser 4 blocked us in the hour-1 spike (GAME_DESIGN §13: "Measure Phaser 4 chunk size and fps on the slowest team phone"). Blind Spot (G3) is the first Phaser game in the web app, so the question has to be answered now:
- Is Phaser 4.2.1 light enough to load and to run a Blind-Spot-sized scene at a usable frame rate on a low-end Android phone?
- How do we keep it out of every first load (FRONTEND §14), and what does a phone that can't run it get (EC-19)?

## Decision drivers
- First-load budget: ≤ 450 KB per route (Lite < 300 KB); the engine must never be part of it.
- Scores must not depend on the frame rate (GAME_SDK §6.2, D-11: the server replay wins).
- Low-end and 2G phones, screen readers and Lite mode must still be able to practise (GAME_DESIGN §1.3, EC-13, EC-19).
- One engine for all five canvas sims (FRONTEND §10.2), so the chunk is downloaded once.

## Considered options
1. Phaser 4.2.1, lazily imported, logic in game-core at a fixed 60 Hz, with an SVG decision version.
2. Pin the last Phaser 3.x.
3. No engine: draw Blind Spot with SVG/Canvas 2D only.

## What was measured (MD-229, 2026-10-24)
Spike route: `/[locale]/dev/phaser-spike` (`src/features/phaser/spike`). It mounts the real `PhaserMount` (lazy `import("phaser")`, game-core `createFixedStepLoop` at 60 Hz) with the Blind Spot Part B drawing load (road, scrolling lane dashes, the truck with four hatched no-zones, a 2 Hz indicator, the rider) plus `?cars=N` extra vehicles, and records rAF frame times, Phaser's `actualFps`, long tasks (PerformanceObserver), the engine's load time and the bytes fetched after the engine was requested. Query: `?cars=N&seconds=S&auto=1`.

**Where:** production build (`next build`, Turbopack) served by `next start`; headless Chromium (Playwright) with the Pixel 7 profile at 360 × 800, DPR 2.625, WebGL through SwiftShader (software rendering, no GPU); a 22-core desktop with **CDP CPU throttling at 1×, 4× and 6×** and a "slow 4G"-like link (150 ms RTT, 1.6 Mbit/s down) for the load numbers. Each row is one 10 s measurement after a 2 s warm-up. Other builds were running on the same machine, so the throttled rows are noisy; two runs are shown.

**Engine chunk:** one lazy chunk, 1,338 KB raw, **347 KB gzip**; scripts fetched after the engine was requested: 461 KB on the wire, 1,681 KB decoded (engine plus the spike's own code). Not in any route's first load (see Validation).

| Scene | CPU | fps (rAF) | p95 frame | frames > 33 ms | long tasks in 10 s | engine load on slow 4G | boot to first frame |
|---|---|---|---|---|---|---|---|
| Blind Spot load (truck + rider) | 1× | 60.1 / 60.1 | 16.7 ms | 0% | 0 / 0 | 3.0 s / 3.1 s | 3.1 s / 3.2 s |
| Blind Spot load | 4× | 52.1 / 55.0 | 33.4 / 33.3 ms | 4.0% / 2.4% | 7 (427 ms) / 0 | 3.9 s / 5.4 s | 4.4 s / 6.1 s |
| Blind Spot load | 6× | 52.4 / 48.3 | 33.3 / 33.2 ms | 2.7% / 2.1% | 0 / 1 (1.5 s, GC or host noise) | 4.9 s / 6.3 s | 5.5 s / 7.5 s |
| + 24 cars | 1× | 60.1 / 60.1 | 16.7 ms | 0% | 0 / 0 | 3.0 s / 3.0 s | 3.1 s / 3.0 s |
| + 24 cars | 4× | 55.6 / 60.1 | 33.3 / 16.8 ms | 2.5% / 0% | 3 (159 ms) / 0 | 3.9 s / 3.6 s | 4.5 s / 3.9 s |
| + 24 cars | 6× | 40.2 / 56.1 | 50 / 33.3 ms | 15.9% / 1.8% | 14 (919 ms) / 0 | 5.6 s / 4.3 s | 6.6 s / 5.0 s |
| + 60 cars | 6× | 42.1 / 44.9 | 33.4 ms | 10.7% / 7.8% | 0 / 2 (114 ms) | 5.2 s / 5.0 s | 6.1 s / 5.7 s |

Logic steps per 10 s stayed at 576–602 of 600 (60 Hz) whatever the frame rate; the one exception (499) is the run with a 1.5 s long task, where the loop's spiral-of-death guard (≤ 15 steps per frame, frames clamped at 250 ms) dropped time instead of bursting. Blind Spot's scripted truck is placed from the recorder's clock, not from the step count, so a dropped step never moves the truck against the replay.

**Reading:** with the real Blind Spot load the engine holds 50–60 fps at 4×–6× CPU throttling on software WebGL, and stays above the 30 fps floor of ADR-0004 even at 6× with 60 extra vehicles. The cost that matters on a slow phone is the **download and boot** (3–7 s on slow 4G before the first frame), not the frame rate.

**What this does not show:** a real low-end phone (GPU driver, thermal throttling, 2–3 GB RAM). CPU throttling on a desktop is an approximation. **Human follow-up:** open `/en/dev/phaser-spike?cars=0&auto=1` and `?cars=24&auto=1` on the team's slowest phone (Chrome, USB remote-debugging optional), copy the JSON shown under "Measure 10 s" into this ADR's table, owner: Learning & Games lead, before the demo.

## Decision outcome
Chosen option: **"Phaser 4.2.1, lazy, fixed-step logic, plus an SVG decision version"**. The spike shows no reason to pin Phaser 3.x, and the decision version covers the phones where even a lazy 347 KB engine is the wrong trade.

How it is built (MD-217, MD-229):
- `src/features/phaser/load.ts` is the only `import("phaser")`, and only `PhaserMount` calls it, inside its mount effect. The engine is its own lazy chunk, requested only when a canvas game is on screen (the `@smoke` test in `tests/e2e/specs/p2-sims.spec.ts` checks `window.__mdPhaser` on the brief, on Stopping Distance and in the decision version).
- **Logic is in game-core and in a pure controller** (`blind-spot/ride.ts`), stepped at 60 Hz through game-core's `createFixedStepLoop` on Phaser's STEP event. Phaser only draws snapshots. A 30 fps phone runs two logic steps per frame, so the events (and the score the server replays) are the same.
- **Pause** sleeps the Phaser loop (`game.pause()`), and resuming resets the accumulator so there is no catch-up burst.
- **Context loss** (FRONTEND §10.2): Phaser 4 stops rendering for good on `webglcontextlost`. The mount prevents the default, freezes the logic, shows "Tap to continue" and builds a fresh canvas on the tap. The game state lives outside Phaser, so nothing is lost.
- **Reduced motion:** the indicator stops blinking (it is a steady arrow plus the word). The scene keeps following the rider because positions are the information. Learners who want no motion at all use the decision version.
- **Decision version** (`blind-spot/decision-variant`, DOM + SVG, no Phaser): Part A on a still diagram with the same eight numbered spots, and Part B as three picture choices played out by the same ride controller. It is used when `?variant=decision` is set (the brief's screen-reader link), when the learner chose the screen-reader alternative, when Lite mode (`md_lite`) is on, when the browser has no WebGL, or after a canvas failure. It is labelled as a different format. Its events are real `place`, `lane_pos` and `mirror_check` from a real ride, so `scoreBlindSpot` replays it unchanged.

### Consequences
- Good: no route's first load changes. A low-end phone that can run WebGL gets the real sim at a usable frame rate, and one that can't, or shouldn't spend the data, gets an honest substitute.
- Bad / cost: the first canvas game costs a 347 KB gzip download (about 3–7 s on slow 4G in the spike). The brief does not yet show the size before Start.
- Bad / cost: the first-load script finds the engine with the regex `/Phaser v\d|window\.Phaser|"phaser"/`. The minified 4.2.1 chunk matches none of it (its banner is `"Phaser v"+version`), so the engine is reported as the largest *game* chunk: 347.2 KB of the 350 KB per-game limit. It passes, but only just. Follow-up for the script owner: also match `Phaser v` or `"4.2.1"`.
- Follow-ups: the slowest-phone numbers (above). A "Download the game (≈ 350 KB)" line on the Blind Spot brief, if the phone numbers confirm that the download is the cost.

### Hackathon (Phase 1–2) vs production (Phase 3+)
| Aspect | Hackathon | Production |
|---|---|---|
| Engine | Phaser 4.2.1 full build, one lazy chunk | Custom Phaser build without unused systems (physics, tilemaps, sound): smaller chunk |
| Evidence | Throttled desktop + software WebGL | Field numbers from real phones (RUM: frame-time buckets in game telemetry) |
| Low-end path | Decision version on demand, Lite or no WebGL | Also chosen automatically on `saveData` / `deviceMemory` ≤ 1 GB |

## Pros and cons of the options
### Phaser 4.2.1 (chosen)
- Good, because it holds 50–60 fps on the Blind Spot load under 4–6× CPU throttling, and one engine serves all five sims.
- Bad, because it is a 347 KB gzip download and still new.

### Pin Phaser 3.x
- Good, because it is mature.
- Bad, because the spike found nothing to fix, and it would cost a second migration later. ADR-0004's trigger (Phaser 4 blocks us) did not happen.

### No engine (SVG / Canvas 2D only)
- Good, because there is no download.
- Bad, because five sims would each re-implement scene graphs, input and scaling, and SVG reflow costs more than WebGL as vehicle counts grow. We keep SVG for the decision version only.

## Validation
- `tests/e2e/specs/p2-sims.spec.ts`:
  - `@smoke`: no Phaser before the canvas game opens, and none on Stopping Distance or in the decision version.
  - the canvas game and the decision version both reach results;
  - axe finds no serious violations on both briefs and the Stopping Distance play screen.
- `apps/web/scripts/first-load.mjs` on the build:
  - every route ≤ 450 KB; the sims routes are 375–390 KB;
  - the engine is never in a route's first load.
- Vitest:
  - `blind-spot.test.tsx` replays the controller's and the decision version's events through `scoreBlindSpot`;
  - `phaser.test.ts` covers context loss and fixed-step independence.
- Review this ADR once the slowest-phone numbers are in.

## Links
- Spike: `apps/web/src/features/phaser/spike/*`, route `/[locale]/dev/phaser-spike`.
- Mount: `apps/web/src/features/phaser/PhaserMount.tsx`, `context-loss.ts`, `load.ts`.
- [Phaser 4](https://phaser.io) (v4.2.1, from the pnpm catalog).
