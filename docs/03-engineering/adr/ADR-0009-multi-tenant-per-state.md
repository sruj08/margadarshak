# ADR-0009: Multi-tenant per state
> Project: Margdarshak · Owner: Backend lead · Status: Accepted · Date: 2026-10-23
> Related: [Architecture §4.3](../ARCHITECTURE.md) · [Backend §12.3](../BACKEND.md) · [Data model §4.0, §4.1](../DATA_MODEL.md) · ADR-0001 · ADR-0007

## Context and problem statement
Licensing is administered by each State/UT Transport Department: rules, fees overlays, LL test formats, offices, languages, payment gateways, and eventually which government adapters are live all differ by state (`07` §B3). The product must white-label per state (F-58) without forks, and a state may require stronger isolation or its own infrastructure.

## Decision drivers
- F-58 multi-tenancy + white-label (UX4G skin).
- Per-state adapter modes (Sarathi `deeplink` vs `real`).
- Per-state rule packs with their own makers/checkers.
- Data isolation that survives application bugs.

## Considered options
1. **Tenant = State/UT code; pooled database with `tenant_id` on every C2+ table and Postgres row-level security; per-tenant config (theme, languages, adapters, flags, rule pack) and per-tenant data keys; optional schema-per-tenant or dedicated deployment for states that demand it.**
2. One deployment per state from day 1.
3. Single-tenant app with a "state" column and app-level filtering only.

## Decision outcome
Chosen option: **1**, because RLS gives a database-enforced wall at low cost, config-driven tenants let one codebase serve many states, and the isolation tiers keep the door open for states that want their own cloud.

### Consequences
- The UnitOfWork sets `SET LOCAL app.tenant_id` per transaction; policies use `current_setting('app.tenant_id', true)`; a CI test asserts RLS on every table with `tenant_id`.
- Requests carry `X-Tenant`; it must match the session's tenant and the host's allowed tenants.
- Cross-tenant jobs use the `mg_jobs` role with `BYPASSRLS`, audit-logged.
- Independent mode shows **no state emblem**; state branding only in government-hosted mode (D-01).
- Bad: RLS with pgx v5 pooling needs care (use transaction-scoped `SET LOCAL app.tenant_id` so no setting leaks between pooled connections; ADR-0011) → verify at H0 (owner Backend lead, 2026-10-24).

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Tenants | JK (deep), DL and KL (sample packs) | each adopting state |
| Isolation | pooled + RLS | tier 1 pooled RLS · tier 2 schema-per-state · tier 3 dedicated deployment |
| Keys | per-tenant data keys under one env KEK | per-tenant KEK in an India KMS/HSM |

## Pros and cons of the options
### Option 1
- Good: one codebase, DB-enforced isolation, flexible tiers.
- Bad: RLS discipline needed in every migration.
### Option 2
- Good: strongest isolation.
- Bad: N deployments to run and patch in 48 h; no shared improvements.
### Option 3
- Good: simplest.
- Bad: a single missing `WHERE` leaks another state's data.

## Validation
Tenant-isolation tests (a JK session can never read DL rows, even with crafted IDs); RLS presence check in CI; console aggregates keep k-anonymity per tenant.

## Links
- `research/ps1-deep/07-govt-plug-and-play.md` §B3–B4
