# Changelog
All notable changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The product uses [SemVer](https://semver.org/); rule packs use CalVer.

## [Unreleased]
- Build per `docs/08-project/IMPLEMENTATION_PLAN.md` (P0–P7).

### Changed
- n8n is now internal and staff operations only (ADR-0006 rev., DEC-012). Citizen messages go through the backend notifier (`NotificationPort`), so n8n's load grows with staff and offices, not citizens. Retired n8n W02–W06, W10, W11 (now backend); added W16 RTO morning brief, W17 stall/SLA alerts, W18 staff task reminders (MD-519..521). W01 is now trigger + watchdog; W09 only receives flagged reports; `W04-test-eve-whatsapp-reminder.json` removed.

## [0.1.0] - 2026-10-23
### Added
- Product bible: IDEA.md, RESEARCH.md, PROJECT_BRIEF and all docs in `docs/00`–`docs/10`.
- OpenAPI contract, design tokens, AI prompts and eval sets, CI workflows, Render Blueprint, Dockerfiles, n8n workflow exports, monorepo configs.
- Backlog import script.
