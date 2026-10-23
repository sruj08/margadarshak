# ADR-0007: Rule packs as signed data with maker-checker approval
> Project: Margdarshak · Owner: Backend lead (rules owner) · Status: Accepted · Date: 2026-10-23
> Related: [Architecture §4.2](../ARCHITECTURE.md) · [Backend §4, §6](../BACKEND.md) · [Data model §4.2](../DATA_MODEL.md) · [API spec API-01..05, API-54](../API_SPEC.md)

## Context and problem statement
Licence rules differ by class and by state: minimum ages (16 for ≤ 50 cc with guardian consent, 18, 20 for transport), Form 1A over 40, LL validity (6 months), the 30-day minimum wait, retest gaps, LL test formats (J&K 10 questions with 6 to pass per one source; others 15/9 or 20), online test availability (Kerala scrapped it in 2022), fees (CMVR r.32), documents, service timelines. Several facts are secondary or unverified (transport LMV prerequisite, `02-rules-process.md`). Showing a wrong rule or fee is risk R-09; a rupee literal in a prompt or UI string is banned (D-06).

## Decision drivers
- D-05: every row carries `source`, `verified_on`, `confidence`; low-confidence rows show "verify at your RTO".
- D-06: fees computed from `fees.json`; no literals.
- F-42: versioned state packs with maker-checker.
- D-10: AI may cite only verified rule IDs.
- EC-27: rules change mid-case.

## Considered options
1. **Rule packs as versioned JSON data (base `IN-base` from MV Act + CMVR, state overlays `JK`, `DL`, `KL`), JSON Schema 2020-12, a closed JSON expression language, golden tests, maker-checker approval, signed manifest, pinned per case.**
2. Rules hard-coded in Python.
3. A general rules engine/DSL (e.g. Drools-style) or an LLM answering rule questions.

## Decision outcome
Chosen option: **1**, because states can own and audit their rules as data, every value is traceable to a source, the engine stays a pure deterministic function, and AI can only point at rule IDs.

### Consequences
- Fees in **integer paise** (`FEE-LL-ISSUE` 15000, `FEE-LL-TEST` 5000, `FEE-DL-TEST` 30000, `FEE-DL-ISSUE` 20000, `FEE-SMART-CARD` 20000) with golden totals 70000 / 90000 / +45000 per extra class.
- Rows flagged `verify: true` never enter the AI allowlist; the API shows `provenance.verified = false`.
- Maker submits → JSON Schema + static expression check + golden suite → checker (≠ maker, enforced in code and DB) approves → manifest signed (Ed25519, SHA-256) → published; public changelog entry.
- Cases pin `rule_pack_version`; on publish `rulepack_reevaluate` diffs decisions and notifies changed cases (EC-27); Kerala HPT status is a pack flag (EC-28).
- Bad: content work (sources, translations) is the bottleneck — accepted; that is the moat (PROJECT_BRIEF §3).
- Follow-ups: re-verify the transport LMV-prerequisite rule and others in D-25 before stage (owner Rules owner).

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Packs | IN-base + JK (+ DL, KL seeded) | each state signs its own overlay |
| Studio | console (API-54) with team makers/checkers | STD officers as makers/checkers; W15 source-freshness checks |

## Pros and cons of the options
### Option 1
- Good: auditable, testable, signable, translatable; CC-BY publishable (ADR-0010).
- Bad: needs a small interpreter and schema tooling.
### Option 2
- Good: quick.
- Bad: every state change is a deploy; no provenance; no maker-checker.
### Option 3
- Good: flexible.
- Bad: DSL engines are heavy; an LLM would invent rules (the exact failure D-09 forbids).

## Validation
Golden suite per tenant in CI (EC-01..EC-30 cases, fee totals); a lint fails on any rupee literal in UI strings or prompts; the provenance guard replaces any number in AI text not present in tool results.

## Links
- `research/ps1-current-state/02-rules-process.md` §2–§7
- `research/ps1-deep/07-govt-plug-and-play.md` §B3
- `war-room/margdarshak-verification.md` §1 rows 2, 5; D-05, D-06
