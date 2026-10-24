// replay_pending_sessions (ARCHITECTURE §8; plan §2.11.5). Started by n8n's schedule through
// API-67 (`POST /internal/jobs/replay_pending_sessions`) after a score-verifier outage.
//
//   replay_pending_sessions(args)
//     loop: POST /internal/job-steps/sessions.replay_pending {replay_id, page, after, limit}
//             -> {processed, verified, still_pending, failed, next_cursor, has_more}
//           The Go step takes one page (about 50) of sessions in `pending_verification`, replays
//           each through the score verifier and overwrites the score (the server score wins, D-11).
//     until the step reports nothing left, or MAX_REPLAY_PAGES pages (the next run continues).
//
// Nothing is decided here: which sessions are pending, the replay and the overwrite all happen in
// Go. Each page call carries its own Idempotency-Key (`sessions.replay_pending:<run>:p<page>:...`),
// so a retried call is answered from the API's idempotency cache instead of replaying twice.
// While the Go step is still the P2 stub (`{status: "stub"}`) the task ends after one call.
import type { ApiClient } from "../lib/api.ts";
import { NonRetryableError } from "../lib/api.ts";
import type { Config } from "../lib/config.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";
import { boundedKey } from "./step-keys.ts";

export const TASK_REPLAY_PENDING = "replay_pending_sessions";
export const STEP_REPLAY_PENDING = "sessions.replay_pending";
/** Sessions per page (the Go step pages by 50; plan §2.3 pending.go). */
export const REPLAY_PAGE_SIZE = 50;
export const MAX_REPLAY_PAGE_SIZE = 200;
/** Page cap per run: 200 x 50 = 10,000 sessions; anything left waits for the next run. */
export const MAX_REPLAY_PAGES = 200;

export interface ReplayInput {
  readonly replay_id: string | null;
  readonly limit: number;
  readonly max_pages: number;
}

export interface ReplayPage {
  readonly processed: number;
  readonly verified: number;
  readonly still_pending: number;
  readonly failed: number;
  readonly next_cursor: string | null;
  readonly has_more: boolean;
  readonly stub: boolean;
}

export interface ReplaySummary {
  readonly replay_id: string | null;
  readonly pages: number;
  readonly processed: number;
  readonly verified: number;
  readonly still_pending: number;
  readonly failed: number;
  /** True when the page cap stopped the loop with work left. */
  readonly truncated: boolean;
  /** True when the Go step answered as the P2 stub. */
  readonly stub: boolean;
}

export interface ReplayDeps {
  readonly api: () => ApiClient;
  readonly config: () => Config;
  readonly log?: (msg: string, attrs: Record<string, unknown>) => void;
}

const ID = /^[A-Za-z0-9_\-.:]{1,64}$/;

function boundedInt(v: unknown, def: number, min: number, max: number, field: string): number {
  if (v === undefined || v === null) return def;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new NonRetryableError(
      STEP_REPLAY_PENDING,
      `${field} must be an integer in [${min}, ${max}]`,
      undefined,
      0,
    );
  }
  return v;
}

/** API-67 passes `[args]`; args may be `{}` or `{replay_id, limit, max_pages}`. */
export function normaliseReplayInput(args: readonly unknown[]): ReplayInput {
  const first = args[0];
  const o =
    first !== null && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : {};
  const id = o["replay_id"];
  if (id !== undefined && id !== null && (typeof id !== "string" || !ID.test(id))) {
    throw new NonRetryableError(
      STEP_REPLAY_PENDING,
      `bad replay_id ${JSON.stringify(id)}`,
      undefined,
      0,
    );
  }
  return {
    replay_id: typeof id === "string" ? id : null,
    limit: boundedInt(o["limit"], REPLAY_PAGE_SIZE, 1, MAX_REPLAY_PAGE_SIZE, "limit"),
    max_pages: boundedInt(o["max_pages"], MAX_REPLAY_PAGES, 1, MAX_REPLAY_PAGES, "max_pages"),
  };
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** Reads one step answer. Missing counters are 0; a stub answer means nothing to do. */
export function readReplayPage(res: unknown): ReplayPage {
  if (!res || typeof res !== "object" || Array.isArray(res)) {
    throw new NonRetryableError(STEP_REPLAY_PENDING, "replay page is not an object", undefined, 0);
  }
  const o = res as Record<string, unknown>;
  const stub = o["status"] === "stub";
  const next = o["next_cursor"];
  if (next !== undefined && next !== null && (typeof next !== "string" || next === "")) {
    throw new NonRetryableError(STEP_REPLAY_PENDING, "bad next_cursor", undefined, 0);
  }
  return {
    processed: count(o["processed"]),
    verified: count(o["verified"]),
    still_pending: count(o["still_pending"]),
    failed: count(o["failed"]),
    next_cursor: typeof next === "string" ? next : null,
    has_more: !stub && (o["has_more"] === true || typeof next === "string"),
    stub,
  };
}

/** Idempotency-Key for page `page` of one run (cursor included, so a moved cursor gets a new key). */
export function replayPageKey(scope: string, page: number, cursor: string | null): string {
  return boundedKey(STEP_REPLAY_PENDING, scope, `p${page}`, cursor ?? "start");
}

/**
 * Whether to ask for another page after `page` (fetched with `cursor`; `pendingBefore` is the
 * previous page's still_pending, or Infinity on the first page).
 */
export function shouldContinue(
  page: ReplayPage,
  cursor: string | null,
  pendingBefore: number,
): boolean {
  if (page.stub || !page.has_more) return false;
  if (page.next_cursor !== null) {
    if (page.next_cursor === cursor) {
      throw new NonRetryableError(
        STEP_REPLAY_PENDING,
        "replay step returned the same cursor twice",
        undefined,
        0,
      );
    }
    return true;
  }
  // Without a cursor the API hands out "the next pending sessions", so a page that moved nothing
  // out of pending would hand back the same sessions forever: stop and leave them to the next run.
  return page.processed > 0 && page.still_pending < pendingBefore;
}

export function defineReplayPendingTask(
  define: DefineTask,
  deps: ReplayDeps,
): TaskDef<unknown[], ReplaySummary> {
  const log = deps.log ?? (() => {});
  return define(
    {
      name: TASK_REPLAY_PENDING,
      // ARCHITECTURE §8: 3 retries, 10 min. A retried run re-asks the API, which only returns
      // sessions still pending, so it never replays a session twice.
      retry: { maxRetries: 3, waitDurationMs: 5_000, backoffScaling: 2 },
      timeoutSeconds: 600,
    },
    async (ctx: TaskCtx, ...args: unknown[]): Promise<ReplaySummary> => {
      const input = normaliseReplayInput(args);
      const api = deps.api();
      const runId = ctx.metadata.taskRunId;
      const scope = runId ?? input.replay_id ?? "adhoc";
      const t = { pages: 0, processed: 0, verified: 0, failed: 0, truncated: false, stub: false };
      let stillPending = Number.POSITIVE_INFINITY;
      let cursor: string | null = null;
      for (;;) {
        if (t.pages >= input.max_pages) {
          t.truncated = true;
          break;
        }
        const page = readReplayPage(
          await api.step(
            STEP_REPLAY_PENDING,
            { replay_id: input.replay_id, page: t.pages, after: cursor, limit: input.limit },
            { runId, idempotencyKey: replayPageKey(scope, t.pages, cursor) },
          ),
        );
        t.pages++;
        t.processed += page.processed;
        t.verified += page.verified;
        t.failed += page.failed;
        t.stub = page.stub;
        const pendingBefore = stillPending;
        stillPending = page.still_pending; // the latest count is the one that matters
        if (!shouldContinue(page, cursor, pendingBefore)) break;
        cursor = page.next_cursor;
      }
      const summary: ReplaySummary = {
        replay_id: input.replay_id,
        ...t,
        still_pending: Number.isFinite(stillPending) ? stillPending : 0,
      };
      log("replay_pending_sessions summary", { run_id: runId, ...summary });
      return summary;
    },
  );
}
