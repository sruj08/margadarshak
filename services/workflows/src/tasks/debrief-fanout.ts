// RW-3 session-debrief fan-out (MD-311; F-25). Started through API-67
// (`POST /internal/jobs/debrief_backfill`) on a schedule, or after a model outage.
//
//   debrief_backfill(args)
//     loop: POST /internal/job-steps/debrief.backfill {since?, limit}
//             -> {pending, built, ai, transient}
//           The Go step builds and stores the debrief card of checked sessions whose holder allows
//           AI and that have no stored card yet (code computes every number, the agent only
//           words it, and a stored card is never rebuilt).
//     until a page comes back short, or MAX_DEBRIEF_PAGES pages.
//
// A provider 429 or timeout leaves those cards unstored and the step answers 503, so the API
// client retries with backoff and the task itself is retried by Render: no card is built twice.
import type { ApiClient } from "../lib/api.ts";
import { NonRetryableError } from "../lib/api.ts";
import type { Config } from "../lib/config.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";
import { boundedKey } from "./step-keys.ts";

export const TASK_DEBRIEF_BACKFILL = "debrief_backfill";
export const STEP_DEBRIEF_BACKFILL = "debrief.backfill";
export const DEBRIEF_PAGE_SIZE = 50;
export const MAX_DEBRIEF_PAGES = 20;

export interface DebriefInput {
  readonly since: string | null;
  readonly limit: number;
}

export interface DebriefSummary {
  readonly pages: number;
  readonly built: number;
  readonly ai: number;
  readonly truncated: boolean;
}

export interface DebriefDeps {
  readonly api: () => ApiClient;
  readonly config: () => Config;
  readonly log?: (msg: string, attrs: Record<string, unknown>) => void;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** API-67 passes `[args]`; args may be `{}` or `{since, limit}`. */
export function normaliseDebriefInput(args: readonly unknown[]): DebriefInput {
  const first = args[0];
  const o = first !== null && typeof first === "object" && !Array.isArray(first) ? (first as Record<string, unknown>) : {};
  const since = o["since"];
  if (since !== undefined && since !== null && (typeof since !== "string" || !ISO.test(since))) {
    throw new NonRetryableError(STEP_DEBRIEF_BACKFILL, "since must be an RFC 3339 UTC timestamp", undefined, 0);
  }
  const limit = o["limit"] ?? DEBRIEF_PAGE_SIZE;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new NonRetryableError(STEP_DEBRIEF_BACKFILL, "limit must be an integer in [1, 500]", undefined, 0);
  }
  return { since: typeof since === "string" ? since : null, limit };
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export function defineDebriefFanoutTask(define: DefineTask, deps: DebriefDeps): TaskDef<unknown[], DebriefSummary> {
  const log = deps.log ?? (() => {});
  return define(
    { name: TASK_DEBRIEF_BACKFILL, retry: { maxRetries: 3, waitDurationMs: 10_000, backoffScaling: 2 }, timeoutSeconds: 900 },
    async (ctx: TaskCtx, ...args: unknown[]): Promise<DebriefSummary> => {
      const input = normaliseDebriefInput(args);
      const api = deps.api();
      const runId = ctx.metadata.taskRunId;
      const scope = runId ?? "adhoc";
      const t = { pages: 0, built: 0, ai: 0, truncated: false };
      for (;;) {
        if (t.pages >= MAX_DEBRIEF_PAGES) {
          t.truncated = true;
          break;
        }
        const res = (await api.step(
          STEP_DEBRIEF_BACKFILL,
          { since: input.since, limit: input.limit },
          { runId, idempotencyKey: boundedKey(STEP_DEBRIEF_BACKFILL, scope, `p${t.pages}`) },
        )) as Record<string, unknown>;
        t.pages++;
        t.built += count(res["built"]);
        t.ai += count(res["ai"]);
        // Built cards leave the pending list, so a short or empty page means nothing is left.
        if (count(res["pending"]) < input.limit || count(res["built"]) === 0) break;
      }
      log("debrief_backfill summary", { run_id: runId, ...t });
      return t;
    },
  );
}
