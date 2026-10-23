# Contributing to Margdarshak

## Before you start
- Read `docs/00-overview/PROJECT_BRIEF.md`, then pick a ticket from `docs/08-project/BACKLOG.md` (MD-xxx).
- Set up your machine with `docs/03-engineering/ENVIRONMENT_SETUP.md`.
- **Hackathon rule:** no commits before the confirmed start time (R-14). See `GIT_WORKFLOW.md`.

## Branches and commits
- Trunk-based. Branch names: `feat/MD-123-short-name`, `fix/…`, `docs/…`, `rules/…` (rule packs), `ai/…` (prompts and evals).
- Conventional Commits, for example `feat(F-02): show smart class planner saving (MD-123)`.

## Pull requests
Template:
```
### What and why (MD-xxx, F-xx, EC-xx)
### How tested (unit / golden / contract / game determinism / e2e / axe / evals)
### Screenshots at 360 px (light + dark) and Hindi
### Checklist
- [ ] No Aadhaar/OTP/biometric data anywhere (D-07)
- [ ] Numbers come from code or rule packs; no ₹ literals in copy (D-06, D-09)
- [ ] Under-18 path checked (D-13)
- [ ] Copy lint passes (D-19, CCPA)
- [ ] Rule changes carry source + date + confidence + approver
- [ ] Docs updated (PROJECT_BRIEF IDs unchanged, or the brief updated)
```

## Review
- Every PR needs one human review.
- PRs written by AI agents need review by the module owner (`docs/08-project/TEAM.md`).
- Required checks are listed in `docs/05-ops/CICD.md`.

## Definition of done
- Merged with CI green.
- Deployed to staging.
- Checked on a low-end Android phone at 360 px.
- Accessible (axe clean).
- Hindi strings present.
- Docs updated.
