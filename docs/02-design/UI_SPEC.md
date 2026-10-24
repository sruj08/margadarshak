# UI Spec: index
> Project: Margdarshak · Owner: Design lead · Status: v1.0 · Last updated: 2026-10-23
> Related: [DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [ACCESSIBILITY](ACCESSIBILITY.md) · [LOCALIZATION](LOCALIZATION.md) · [CONTENT_STYLE](CONTENT_STYLE.md)

The UI specification is split into two parts. Both use the same conventions: screen IDs, 360 px ASCII wireframes, EN + HI copy keys, states, motion, accessibility, analytics, and F-xx/EC-xx traceability.

| Part | Covers |
|---|---|
| [UI_SPEC_JOURNEY.md](UI_SPEC_JOURNEY.md) | Stages S0–S9 and S6F: language picker, home and its 16 stage-aware variants, the 3-tap Licence Plan, blocker states (EC-01..EC-30), guided LL application, photo/signature fixer, Sarathi hand-off, tracker, slot finder, RTO Live Intel, driving-test readiness, fail and recover, approval tracker, new-rider year, renew/fix, family and Helper mode, privacy centre, notifications, settings, Lite/offline, error/empty/loading states, footer |
| [UI_SPEC_LEARN_GAMES.md](UI_SPEC_LEARN_GAMES.md) | Learn hub, lesson player, review queue, question card with confidence rating, Readiness dial, LL Test Simulator, the shared game frame, all 9 mini-games, AI Debrief cards, replay, gamification (XP, ranks, badges, streaks, squads, share cards, Practice Record), Road Sign Snap, voice orb (8 states), driving-school portal, state/RTO console, rule-pack studio, clip admin |

**Design foundations:**
- Tokens: `packages/ui/tokens.css` and `packages/ui/tokens.json`.
- Contrast check: `scripts/check_contrast.mjs`.
