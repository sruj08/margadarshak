# P1 hand-off: contracts agreed between finished pieces (24 Oct 2026)
These are binding inputs for the P1 journey-backend and journey-UI agents.

## From the RULES agent (done)
- Go engine `services/api/internal/rules`; TS mirror `packages/rules` (zero deps); packs in `rulepacks/`; 110 golden cases in `tests/golden/`. Go and TS outputs are byte-identical.
- **Fees** are integer paise:
  - 1 class: 70000 (+ smart card 20000).
  - 2 classes: 115000.
  - 3 classes: 160000.
- **Edge-case interpretations:**
  - Form 1A applies from the 40th birthday.
  - A year-only DOB is treated as 31 Dec for minimum ages and 1 Jan for upper limits. US-016 must align.
- **Do not change rule semantics without golden tests.** 65 rows are `verified:false` and must render a "verify at your RTO" chip.

## From the WORKFLOWS agent (done): what the Go API must implement
1. **Job-step endpoint:** `POST /internal/job-steps/{step}`, authenticated with HMAC (and a bearer token, see 5). Body `{run_id, args}`. Add it to `api/openapi.yaml`.
   - `clock.plan_pages`:
     - args `{sweep_id, tenants, as_of, after, limit}`
     - returns `{as_of, events:[{case_id,type,due_on}], next_cursor}`
   - `clock.fire_batch`:
     - args `{sweep_id, as_of, page, event_keys[]}`
     - returns `{fired, skipped_opt_out, failed, already_fired}`
     - idempotent per event key `caseId:type:dueOn`
2. **Task names:** the Render task names are `case_clock_sweep`, its subtask `clock_batch`, and `health`.
3. **HMAC header:** `Margdarshak-Signature: t=<unix>,v1=<hex>`.
   - **Replay-cache fix:** key the cache on method + path + signature, or include method and path in the signed string. Clients re-sign every retry.
   - Fix the header description in `n8n/README.md` and `docs/05-ops/N8N_WORKFLOWS.md` §1.2.
4. **Endpoints n8n uses** (add to openapi):
   - `POST /internal/notifications/seen` (batched).
   - API-66 events `delivery_receipt` (`receipts[]`) and `request_fallback`.
   - `GET /internal/analytics/digest` with a `publishable` flag (k-anonymity ≥ 5; nothing from a minor's case).
   - The API → n8n W02 milestone webhook, with envelope signature `sha256=<hex>`.
5. **Bearer token for internal calls:** either add `INTERNAL_BEARER_TOKEN` to the workflow service in `infra/render.yaml`, or exempt job-steps from the bearer check. Choose one and document it.
6. **W01 schedule:** runs daily at 08:00 IST (the docs say 06:30; 08:00 is the decision).
7. **Go runner comment:** Render SDK 1.4.0 *does* support `idempotencyKey` on start (24 h, scoped per workflow). Correct the comment in the Go runner.

## Docs clean-up
- Done 24 Oct: every `.py` script reference in docs and tokens now points to the `.mjs` ports. No Python remains in the repo.
