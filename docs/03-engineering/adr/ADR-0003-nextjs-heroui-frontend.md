# ADR-0003: Next.js 16 + HeroUI v3 PWA frontend
> Project: Margdarshak · Owner: Frontend lead · Status: Accepted · Date: 2026-10-23
> Related: [Frontend](../FRONTEND.md) · [Tech stack §2](../TECH_STACK.md) · [Architecture §11](../ARCHITECTURE.md) · ADR-0004

## Context and problem statement
Users are mostly on ₹8–12k Android phones on 2G/3G/4G, often Hindi-first, some low-literacy, some on shared phones (P-01..P-07, EC-14, EC-19). The app must work offline for mock tests and cached clips (F-51), meet WCAG 2.1 AA / GIGW 3.0 (F-52), load < 300 KB in Lite mode, render OG share cards, and later sit inside mParivahan/UMANG as an entry card. The team's existing stack (Vakyam) is Next.js + HeroUI.

## Decision drivers
- Lite mode < 300 KB first load; offline PWA.
- Accessible components (keyboard, screen reader) out of the box.
- One TS codebase for citizen app, console and game layer.
- Team familiarity (48 h).

## Considered options
1. **Next.js 16.4.3 (App Router, RSC, Turbopack) + React 19.3.1 + HeroUI 3.2.6 + Tailwind 4.3.3 + Serwist 9.5.13 PWA.**
2. Vite SPA + React + MUI.
3. Native Android (Kotlin) or React Native.

## Decision outcome
Chosen option: **1**, because RSC streaming keeps the Lite bundle small, HeroUI v3 sits on React Aria (accessibility), Serwist gives a Turbopack-compatible service worker, and the team already ships this stack.

### Consequences
- Good: server-rendered plan card and share cards; route-level code splitting keeps Phaser/Rive/Motion out of Lite mode.
- Good: a PWA reaches budget phones without an install and avoids fake-APK confusion (verification G10).
- Bad: HeroUI and Motion are too heavy for Lite → Lite routes use plain RSC HTML + minimal CSS (FRONTEND budget table).
- Bad: TypeScript 7 not yet usable with all peers → pin 6.0.3 (FRONTEND §1.1).
- Follow-ups: UX4G skin token map (owner Frontend lead, H+6); Lighthouse CI budget gate (owner Frontend lead, H+8).

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Distribution | PWA on our domain (no "parivahan/sarathi/gov" in the domain, G10) | + entry card in mParivahan/UMANG; Play listing under the state's account |
| Skin | neutral + UX4G token aliases, no emblem | state branding allowed only in government-hosted mode |

## Pros and cons of the options
### Option 1
- Good: RSC + PWA + accessible components + team speed.
- Bad: framework weight outside Lite; Next major-version churn.
### Option 2
- Good: simple.
- Bad: no RSC/streaming for Lite; OG cards need a separate server; MUI weight.
### Option 3
- Good: best device APIs.
- Bad: install friction, app-store review, separate codebase; PWA covers the needs.

## Validation
`size-limit` + Lighthouse CI on a 3G profile (Lite < 300 KB); axe in Playwright on every PR; manual TalkBack pass on a low-end Android before demo.

## Links
- `research/ps1-deep/06-design-language.md`, `08-game-ai-n8n.md` §1
- npm registry (2026-10-23): next 16.4.3, @heroui/react 3.2.6, serwist 9.5.13
