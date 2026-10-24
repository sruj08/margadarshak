# Margdarshak (मार्गदर्शक)
> *Learner se licence tak, bina agent ke.* From learner's licence to licence, without an agent.

A reimagined, government-adoptable mParivahan. It turns India's driving-licence process into **one guided road**: you see your exact plan before you apply, you're carried through every step, and short simulations with an AI coach train the skills India's test never checks.

Built by **Team Chanakya** (@Nestiq Private Limited) for **HackCache '26** (CachedInfo × GCET Jammu), PS1: *Making mParivahan & Driving Licence Services Accessible to Everyone*.

> **Not affiliated with MoRTH, NIC, Sarathi/Parivahan or any State Transport Department.** This build runs on simulated government adapters. Margdarshak never asks for Aadhaar numbers, OTPs, biometrics or government fees; those steps hand off to the government's own systems.

<!-- Demo GIF: record during the showcase build and save as docs/assets/demo.gif -->

## Why
- **The forms went online, but the journey didn't.**
  - parivahan.gov.in shows about 120 links, and roughly 1 in 10 is relevant to a first licence.
  - A learner's licence (LL) takes about 16 screens, 6 captchas and 4+ OTPs, and nothing is saved.
- **Nobody owns the timeline.** LL expiry, the 30-day wait, slot scarcity, retests and approval limbo pile up, so agents charge ₹2k–20k against a government fee of ₹700 + ₹200 card for one class.
- **India tests knowledge and vehicle control, but never hazard anticipation.** A licensed driver was at the wheel in 70.9% of India's 2023 road accidents.

Full evidence: [RESEARCH.md](RESEARCH.md). The whole idea in one read: [IDEA.md](IDEA.md).

## What it does
| Stage | Highlights |
|---|---|
| S0 Home | Language first, 4 verb tiles, voice, a calm trust line |
| S1 Licence plan | 3 taps → classes, steps, fee breakdown, documents, earliest date, blockers, smart class planner |
| S2 Apply | One question per screen, photo/signature fixer, check your answers, hand-off to Sarathi |
| S3 LL test | Learn hub (FSRS), Test Readiness Score, real-format LL simulator, AI tutor |
| S4 30-day bridge | **Nazar** hazard perception on real Indian clips; 8 simulations; **AI debrief** after every session; Practice Record |
| S5–S6 | Slot finder, RTO Live Intel, track explainer, test-day co-pilot |
| S6F | Private debrief, drill, retest, remedial training, test-record request |
| S7–S9 | Approval tracker, new-rider year, scam shield, renew/fix, family mode |

**Platform:**
- Voice guide (Google ADK + Gemini Live)
- n8n automations
- Render Workflows for durable jobs
- Driving-school portal
- State console
- Rule-pack studio
- A plug-and-play government adapter layer

## Architecture (short)
Hexagonal core.
- **Web:** Next.js 16 PWA with HeroUI v3, Tailwind 4 and Phaser 4 games.
- **API:** Go 1.27 (chi v5, contract-first from `api/openapi.yaml` with oapi-codegen, pgx v5 + sqlc, goose migrations), with PostgreSQL 16.
- **Score verifier:** Node, replays every game session on the server.
- **AI:** ADK for Go agents on Gemini (`google.golang.org/adk`, `RunLive` for the voice guide; `google.golang.org/genai` Live API). Every AI feature is available to every user; a learner aged 16–17 uses it in a parent's account (family mode) with parental consent.
- **Jobs and automation:** Render Workflows (TypeScript tasks, `@renderinc/sdk`) and n8n.
- **Government adapters (mock + real):** Sarathi, DigiLocker, Aadhaar-offline (mock only), Bhashini, payment redirect, slots and notifications.
- **Multi-state:** one tenant per state, with a UX4G skin.

Details: [docs/03-engineering/ARCHITECTURE.md](docs/03-engineering/ARCHITECTURE.md).

## Quick start (development)
```bash
git clone <repo-url> margdarshak && cd margdarshak
cp .env.example .env              # fill in values; see docs/03-engineering/ENVIRONMENT_SETUP.md
pnpm install && (cd services/api && go mod download)   # Node 22 + pnpm, Go 1.27
# Optional: docker compose -f infra/docker/compose.yaml up -d   (Postgres, Redis, MinIO; Docker is not required)
pnpm dev                          # web + api (go run ./cmd/api) + score-verifier
(cd services/api && go vet ./... && go test ./...)   # Go unit, golden rules, adapter contracts (embedded Postgres 16)
pnpm test                         # TS unit, rules mirror, game determinism
```

## Build status
P0 (foundations), P1 (journey core) and P2 (learning and games) are built and verified: Go tests, all TypeScript suites, the production build, bundle budgets, mock e2e and full-stack e2e pass. Evidence: [P0_P1_VERIFICATION](docs/08-project/P0_P1_VERIFICATION.md), [P2_VERIFICATION](docs/08-project/P2_VERIFICATION.md). Open items (human tasks, credentials): [whats_left.md](whats_left.md). Nazar clip generation: [video_generation_guide.md](video_generation_guide.md).

## Repository map
Start at [MAP.md](MAP.md).
- **Product:** `docs/01-product`
- **Design:** `docs/02-design`
- **Engineering:** `docs/03-engineering`
- **AI:** `docs/04-ai`
- **Ops:** `docs/05-ops`
- **Security and legal:** `docs/06-security-compliance`
- **Business:** `docs/07-business`
- **Implementation plan:** `docs/08-project`
- **Learning and games:** `docs/09-learning-games`
- **Government adoption:** `docs/10-government`

## Licence
- **Code:** Apache-2.0 (see [LICENSE](LICENSE)).
- **Nazar clip bank and rule packs:** CC-BY 4.0.
- **Brand:** "Margdarshak" is a team trademark candidate; a trademark search is pending.
