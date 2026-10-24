// RW-2 case-clock sweep (MD-126; BACKEND.md §7.2). Started by the Go API (API-65, triggered by
// n8n W01) as `<WORKFLOW_SLUG>/case_clock_sweep`.
//
//   case_clock_sweep(input)
//     loop: POST /internal/job-steps/clock.plan_pages {tenants, as_of, after, limit}
//             -> {as_of, events: [{case_id, type, due_on}], next_cursor}
//           one page of due TimelineEvents, keyset-paginated by the API (server time, EC-15)
//     fan-out (<= CLOCK_SWEEP_CONCURRENCY, max 8): ctx.run(clock_batch, page) per page
//   clock_batch(page)
//     POST /internal/job-steps/clock.fire_batch {as_of, event_keys: ["caseId:type:dueOn", ...]}
//       -> {fired, skipped_opt_out, failed, already_fired}
//
// Exactly-once user effect: every event is addressed by its idempotency key
// `{caseId}:{milestoneId}:{dueOn}` (the TimelineEvent unique key); the API marks it fired under
// that key and derives `{key}:{channel}` for each Notification, so a retried batch, a retried
// sweep or a second sweep on the same day sends nothing twice. Nothing is decided here.
import type { ApiClient } from "../lib/api.ts";
import { NonRetryableError } from "../lib/api.ts";
import type { Config } from "../lib/config.ts";
import { mapLimit } from "../lib/pool.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";
import { createHash } from "node:crypto";

export const TASK_CASE_CLOCK_SWEEP = "case_clock_sweep";
export const TASK_CLOCK_BATCH = "clock_batch";
export const STEP_PLAN_PAGES = "clock.plan_pages";
export const STEP_FIRE_BATCH = "clock.fire_batch";
/** Hard stop against a planner that never ends (200 per page x 5000 = 1M events). */
export const MAX_PAGES = 5000;

export interface DueEvent {
  readonly case_id: string;
  readonly type: string;
  readonly due_on: string;
}

export interface PlanPage {
  readonly as_of: string;
  readonly events: readonly DueEvent[];
  readonly next_cursor: string | null;
}

export interface FireResult {
  readonly fired: number;
  readonly skipped_opt_out: number;
  readonly failed: number;
  readonly already_fired: number;
}

export interface SweepInput {
  readonly tenants: readonly string[];
  readonly as_of: string | null;
  readonly sweep_id: string | null;
  readonly dry_run: boolean;
}

export interface BatchInput {
  readonly sweep_id: string | null;
  readonly as_of: string;
  readonly page: number;
  readonly event_keys: readonly string[];
}

export interface SweepSummary extends FireResult {
  readonly sweep_id: string | null;
  readonly as_of: string | null;
  readonly dry_run: boolean;
  readonly pages: number;
  readonly due: number;
  readonly duplicates_dropped: number;
  readonly batches: number;
  readonly batches_failed: number;
}

export interface ClockDeps {
  readonly api: () => ApiClient;
  readonly config: () => Config;
  readonly log?: (msg: string, attrs: Record<string, unknown>) => void;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_PART = /^[A-Za-z0-9_\-.]+$/;
const TENANT = /^[A-Za-z]{2,3}$/;

/** `{caseId}:{milestoneId}:{dueOn}`, the TimelineEvent idempotency key (BACKEND.md §7.1). */
export function eventKey(e: DueEvent): string {
  if (!e || typeof e !== "object") throw new NonRetryableError(STEP_PLAN_PAGES, "event is not an object", undefined, 0);
  const { case_id, type, due_on } = e;
  if (typeof case_id !== "string" || !KEY_PART.test(case_id)) {
    throw new NonRetryableError(STEP_PLAN_PAGES, `bad case_id ${JSON.stringify(case_id)}`, undefined, 0);
  }
  if (typeof type !== "string" || !KEY_PART.test(type)) {
    throw new NonRetryableError(STEP_PLAN_PAGES, `bad milestone type ${JSON.stringify(type)}`, undefined, 0);
  }
  if (typeof due_on !== "string" || !DATE.test(due_on)) {
    throw new NonRetryableError(STEP_PLAN_PAGES, `bad due_on ${JSON.stringify(due_on)}`, undefined, 0);
  }
  return `${case_id}:${type}:${due_on}`;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

/** Idempotency-Key for one fire_batch call: same events on the same day -> same key. */
export function batchIdempotencyKey(asOf: string, keys: readonly string[]): string {
  return `${STEP_FIRE_BATCH}:${asOf}:${digest([...keys].sort())}`;
}

/**
 * Accepts the shapes the Go side may pass as the run input:
 *   [{sweep_id, as_of, tenants, dry_run}]   (API-65 ClockSweepRequest, inline runner)
 *   [tenant, as_of]                         (BACKEND.md §7.2 diagram)
 *   []                                      (all tenants, server today)
 */
export function normaliseSweepInput(args: readonly unknown[]): SweepInput {
  const first = args[0];
  let tenants: string[] = [];
  let asOf: string | null = null;
  let sweepId: string | null = null;
  let dryRun = false;
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    const o = first as Record<string, unknown>;
    if (Array.isArray(o["tenants"])) tenants = o["tenants"].filter((t): t is string => typeof t === "string");
    else if (typeof o["tenant"] === "string") tenants = [o["tenant"]];
    if (typeof o["as_of"] === "string") asOf = o["as_of"];
    if (typeof o["sweep_id"] === "string") sweepId = o["sweep_id"];
    dryRun = o["dry_run"] === true;
  } else if (typeof first === "string") {
    tenants = [first];
    if (typeof args[1] === "string") asOf = args[1];
  }
  tenants = tenants.filter((t) => t !== "all" && t !== "*");
  for (const t of tenants) {
    if (!TENANT.test(t)) throw new NonRetryableError(STEP_PLAN_PAGES, `bad tenant ${JSON.stringify(t)}`, undefined, 0);
  }
  return { tenants: [...new Set(tenants.map((t) => t.toUpperCase()))].sort(), as_of: asOf, sweep_id: sweepId, dry_run: dryRun };
}

function asCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function checkPlanPage(p: unknown): PlanPage {
  if (!p || typeof p !== "object") throw new NonRetryableError(STEP_PLAN_PAGES, "plan page is not an object", undefined, 0);
  const o = p as Record<string, unknown>;
  if (typeof o["as_of"] !== "string" || o["as_of"] === "") {
    throw new NonRetryableError(STEP_PLAN_PAGES, "plan page has no as_of", undefined, 0);
  }
  if (!Array.isArray(o["events"])) throw new NonRetryableError(STEP_PLAN_PAGES, "plan page has no events[]", undefined, 0);
  const next = o["next_cursor"];
  if (next !== null && next !== undefined && (typeof next !== "string" || next === "")) {
    throw new NonRetryableError(STEP_PLAN_PAGES, "bad next_cursor", undefined, 0);
  }
  return { as_of: o["as_of"], events: o["events"] as DueEvent[], next_cursor: typeof next === "string" ? next : null };
}

export interface ClockTasks {
  readonly caseClockSweep: TaskDef<unknown[], SweepSummary>;
  readonly clockBatch: TaskDef<[BatchInput], FireResult>;
}

export function defineClockTasks(define: DefineTask, deps: ClockDeps): ClockTasks {
  const log = deps.log ?? (() => {});

  const clockBatch = define(
    {
      name: TASK_CLOCK_BATCH,
      retry: { maxRetries: 3, waitDurationMs: 1_000, backoffScaling: 2 },
      timeoutSeconds: 300,
    },
    async (ctx: TaskCtx, batch: BatchInput): Promise<FireResult> => {
      if (!batch || !Array.isArray(batch.event_keys) || typeof batch.as_of !== "string") {
        throw new NonRetryableError(STEP_FIRE_BATCH, "bad batch input", undefined, 0);
      }
      if (batch.event_keys.length === 0) return { fired: 0, skipped_opt_out: 0, failed: 0, already_fired: 0 };
      const res = await deps.api().step<Record<string, unknown>>(
        STEP_FIRE_BATCH,
        { sweep_id: batch.sweep_id, as_of: batch.as_of, page: batch.page, event_keys: batch.event_keys },
        { runId: ctx.metadata.taskRunId, idempotencyKey: batchIdempotencyKey(batch.as_of, batch.event_keys) },
      );
      return {
        fired: asCount(res?.["fired"]),
        skipped_opt_out: asCount(res?.["skipped_opt_out"]),
        failed: asCount(res?.["failed"]),
        already_fired: asCount(res?.["already_fired"]),
      };
    },
  );

  const caseClockSweep = define(
    {
      name: TASK_CASE_CLOCK_SWEEP,
      retry: { maxRetries: 2, waitDurationMs: 5_000, backoffScaling: 2 },
      timeoutSeconds: 1_200,
    },
    async (ctx: TaskCtx, ...args: unknown[]): Promise<SweepSummary> => {
      const input = normaliseSweepInput(args);
      const cfg = deps.config();
      const api = deps.api();
      const runId = ctx.metadata.taskRunId;
      const seen = new Set<string>();
      const batches: BatchInput[] = [];
      let duplicates = 0;
      let asOf: string | null = input.as_of;
      let cursor: string | null = null;
      let pages = 0;
      do {
        if (pages >= MAX_PAGES) throw new NonRetryableError(STEP_PLAN_PAGES, `more than ${MAX_PAGES} pages`, undefined, 0);
        const page = checkPlanPage(
          await api.step(
            STEP_PLAN_PAGES,
            { sweep_id: input.sweep_id, tenants: input.tenants, as_of: asOf, after: cursor, limit: cfg.sweepPageSize },
            { runId, idempotencyKey: `${STEP_PLAN_PAGES}:${runId ?? input.sweep_id ?? "adhoc"}:${cursor ?? "start"}` },
          ),
        );
        if (page.events.length > cfg.sweepPageSize) {
          throw new NonRetryableError(STEP_PLAN_PAGES, `page has ${page.events.length} events > limit ${cfg.sweepPageSize}`, undefined, 0);
        }
        asOf = page.as_of; // the API's server date is authoritative (EC-15)
        const keys: string[] = [];
        for (const e of page.events) {
          const k = eventKey(e);
          if (seen.has(k)) {
            duplicates++;
            continue;
          }
          seen.add(k);
          keys.push(k);
        }
        if (keys.length > 0) batches.push({ sweep_id: input.sweep_id, as_of: page.as_of, page: pages, event_keys: keys });
        pages++;
        if (page.next_cursor !== null && page.next_cursor === cursor) {
          throw new NonRetryableError(STEP_PLAN_PAGES, "planner returned the same cursor twice", undefined, 0);
        }
        cursor = page.next_cursor;
      } while (cursor !== null);

      let fired = 0;
      let skipped = 0;
      let failed = 0;
      let already = 0;
      let batchesFailed = 0;
      const errors: string[] = [];
      if (!input.dry_run) {
        const results = await mapLimit(batches, cfg.sweepConcurrency, async (b) => {
          try {
            return await ctx.run(clockBatch, b);
          } catch (err) {
            batchesFailed++;
            errors.push(`page ${b.page}: ${(err as Error)?.message ?? String(err)}`);
            return null;
          }
        });
        for (const r of results) {
          if (!r) continue;
          fired += r.fired;
          skipped += r.skipped_opt_out;
          failed += r.failed;
          already += r.already_fired;
        }
      }
      const summary: SweepSummary = {
        sweep_id: input.sweep_id,
        as_of: asOf,
        dry_run: input.dry_run,
        pages,
        due: seen.size,
        duplicates_dropped: duplicates,
        batches: batches.length,
        batches_failed: batchesFailed,
        fired,
        skipped_opt_out: skipped,
        failed,
        already_fired: already,
      };
      log("case_clock_sweep summary", { run_id: runId, ...summary });
      if (batchesFailed > 0) {
        // Fail the run so Render retries it: re-planning skips events already fired.
        throw new Error(`case_clock_sweep: ${batchesFailed}/${batches.length} batches failed after retries; ${errors.slice(0, 3).join("; ")}`);
      }
      return summary;
    },
  );

  return { caseClockSweep, clockBatch };
}
