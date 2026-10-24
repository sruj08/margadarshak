# Changelog
All notable changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The product uses [SemVer](https://semver.org/); rule packs use CalVer.

## [Unreleased]
### Added
- **P0 Foundations:** pnpm/Turborepo monorepo, CI/CD workflows, design tokens and component kit, rule packs with the Go rules engine and a conformance-tested TS mirror, seven mocked government adapters with one contract suite, the Go API core (sessions, family mode and parental consent, audit log, PII redaction, JobRunner, HMAC channel).
- **P1 Journey core:** 3-tap plan and blockers, guided LL application with check answers, fee and Sarathi hand-off, stage-aware home and tracker, case clock (RW-2, n8n W1/W2), privacy centre with consent artefacts, export and delete, journey-test lab.
- **P2 Learning and games:** `@margdarshak/game-core` (Game SDK, deterministic scoring, template debrief), score verifier and compute service, `@margdarshak/gamification`, learning content and catalogues, `@margdarshak/clip-pipeline`, Render Workflows RW-1/RW-4 and `clip_generate` (AI-generated Nazar clips, ADR-0013), n8n W08/W14, every P2 API endpoint with migrations 00005–00009, and the web learn hub, LL simulator, Nazar, Stopping Distance, Blind Spot, Me tab, squads, share card, curator and study flow.
- Verification reports: `docs/08-project/P0_P1_VERIFICATION.md`, `docs/08-project/P2_VERIFICATION.md`; open items in `whats_left.md`.

### Changed
- n8n is now internal and staff operations only (ADR-0006 rev., DEC-022). Citizen messages go through the backend notifier (`NotificationPort`), so n8n's load grows with staff and offices, not citizens. Retired n8n W02–W06, W10, W11 (now backend); added W16 RTO morning brief, W17 stall/SLA alerts, W18 staff task reminders (MD-519..521). W01 is now trigger + watchdog; W09 only receives flagged reports; `W04-test-eve-whatsapp-reminder.json` removed. The docs record the decision; the P1 code still delivers through the n8n webhook channel until the notifier lands (`whats_left.md`).

## [0.1.0] - 2026-10-23
### Added
- Product bible: IDEA.md, RESEARCH.md, PROJECT_BRIEF and all docs in `docs/00`–`docs/10`.
- OpenAPI contract, design tokens, AI prompts and eval sets, CI workflows, Render Blueprint, Dockerfiles, n8n workflow exports, monorepo configs.
- Backlog import script.
