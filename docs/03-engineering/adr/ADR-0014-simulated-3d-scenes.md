# ADR-0014: Simulated 3D scenes replace generated video for Nazar
> Project: Margdarshak · Owner: Product owner (decision), Nazar owner (implementation) · Status: Accepted · Date: 2026-10-24
> Related: [NAZAR](../../09-learning-games/NAZAR.md) §17 · supersedes [ADR-0013](ADR-0013-ai-generated-clips.md) for the hackathon build

Format: MADR 3.x, trimmed.

## Context and problem statement
ADR-0013 filled Nazar's clip bank with AI-generated video. The product owner dropped video generation: it is slow (about a minute per 8 s), costly, cannot be made to put a hazard at an exact moment, and every clip needed human review for likeness, plates and brands. Nazar still has to match Kerala's announced format (10 clips × 10 marks, pass 60, from 1 Dec 2026, as reported) and the UK's idea of scoring a response by how early it is.

## Decision
Nazar's hackathon scenes are **simulated 3D scenes drawn in the browser** (three.js, procedural low-poly models, no downloaded assets), one per entry of `content/nazar/scenes.json` (25 hazard scenes, all 15 hazard types, and 4 quiet scenes).

- The scene is a pure function of media time (`scene3d/choreo.ts`): the same time always gives the same frame, so pause, replay and tests are exact.
- Scoring, recording, windows, the two-rater process, the anti-spam rule and the server replay are **unchanged** (D-09, D-11). The renderer never scores.
- **Windows.** A scripted scene knows its onset exactly. The catalogue derives a nominal window from the shot list (onset = start of the `hazardBegins` shot + `cueAtS`; end = onset + 4.5 s). Two people still play each scene and confirm or move the window before it enters a mock pool (the "play and confirm" step replaces "scrub and mark"). Windows stay on the server for mocks (API-37 omits them); a clip with a known window (device session, learn or practice reveal) is staged to that window.
- **Label.** Every scene shows "Simulated 3D practice scene". It never says "real", "official" or "Kerala's clips".
- **Fallback.** No WebGL, a lost context, or `?scene3d=0` falls back to the existing labelled placeholder timeline. Nothing else changes.

## Consequences
- Good: instant, free, deterministic, offline-capable, no likeness or plate risk, difficulty tunable in code.
- Bad: stylised, not photoreal; hazards are scripted, so a learner could learn the scripts (the bank rotates scenes, and the mock still draws unseen clips per learner).
- Validity: results describe performance on simulated scenes, and any study or slide claim must say so (same rule as ADR-0013).
- Superseded here: `clip_generate`, SynthID disclosure, the synthetic-review gate and Gemini video generation are not used for the hackathon build. They stay documented for Phase 3+.

## Alternatives considered
- Keep generated video: rejected (cost, timing, review load).
- React Three Fiber, GLTF models, GSAP: rejected (extra dependencies and download size; the choreography must be deterministic, so a tween library adds nothing).
- Film real clips: rejected for the hackathon timeline (ADR-0013 reasons).
