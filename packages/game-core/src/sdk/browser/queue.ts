// Recorder → queue → server (MD-203). The recorder writes synchronously; the sink batches those
// writes into the async queue. Sync submits each ended session once, as a replay package, through a
// host function: game-core never touches the network (GAME_SDK §4.2). The server dedupes on the
// Idempotency-Key and the replay digest, the queue on `(sid, seq)`, so retries never duplicate.
import type { GameEvent } from "../../schema/events.ts";
import type { SessionContext } from "../../schema/manifest.ts";
import type { ReplayPackage } from "../../schema/result.ts";
import type { EventSink } from "../recorder.ts";
import { encodeReplay } from "../replay-codec.ts";
import type { PutResult, QueueStore } from "./store.ts";

export interface QueueSink extends EventSink {
  /** Resolves once every event written so far is stored. */
  drain(): Promise<PutResult>;
}

/** An EventSink that stores events in the queue in batches of up to `batchSize`. */
export function createQueueSink(store: QueueStore, opts: { batchSize?: number } = {}): QueueSink {
  const batchSize = opts.batchSize ?? 50;
  let pending: GameEvent[] = [];
  const total: PutResult = { added: 0, duplicates: 0, conflicts: 0 };
  let chain: Promise<void> = Promise.resolve();
  const push = (): void => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    chain = chain.then(async () => {
      const r = await store.putEvents(batch);
      total.added += r.added;
      total.duplicates += r.duplicates;
      total.conflicts += r.conflicts;
    });
  };
  return {
    write(event) {
      pending.push(event);
      if (pending.length >= batchSize) push();
    },
    flush: push,
    async drain() {
      push();
      await chain;
      return { ...total };
    },
  };
}

/** Puts a session in the queue (status `open`) when the host gets its context from API-34. */
export async function queueSession(
  store: QueueStore,
  ctx: SessionContext,
  queuedAt: number,
): Promise<void> {
  if ((await store.session(ctx.sid)) !== null) return;
  await store.putSession({ sid: ctx.sid, ctx, status: "open", queuedAt, attempts: 0 });
}

/** Marks a session ready to submit (after session_end, or when the host closes an abandoned one). */
export async function endQueuedSession(store: QueueStore, sid: string): Promise<void> {
  const s = await store.session(sid);
  if (s === null || s.status === "ended") return;
  await store.putSession({ ...s, status: "ended" });
}

export interface SubmitRequest {
  sid: string;
  /** API-35 Idempotency-Key: the session id, so every retry of a session is the same request. */
  idempotencyKey: string;
  ctx: SessionContext;
  replay: ReplayPackage;
}

/**
 * What the host's API-35 call returned. `retry`: offline, timeout, 429 or 5xx. `rejected`: the
 * server will never take this replay (409 different digest, 403 consent, 410 expired, 422 invalid).
 */
export type SubmitOutcome =
  | { status: "accepted" }
  | { status: "retry"; reason: string }
  | { status: "rejected"; reason: string };

export interface SyncReport {
  accepted: string[];
  rejected: { sid: string; reason: string }[];
  /** Sessions left in the queue for the next sync. */
  waiting: string[];
}

/**
 * Submits ended sessions, oldest first. Accepted and rejected sessions leave the queue; the first
 * `retry` stops the run (the network is down, so later sessions would fail too). A session whose
 * stored events fail replay validation (schema, order) is dropped locally as `local_invalid`. A `seq`
 * gap is submitted as is: the server replay decides what the remaining events are worth.
 */
export async function syncQueue(
  store: QueueStore,
  submit: (req: SubmitRequest) => Promise<SubmitOutcome>,
  opts: { maxSessions?: number } = {},
): Promise<SyncReport> {
  const report: SyncReport = { accepted: [], rejected: [], waiting: [] };
  const ended = (await store.sessions()).filter((s) => s.status === "ended");
  const run = ended.slice(0, opts.maxSessions ?? ended.length);
  for (const [i, s] of run.entries()) {
    let replay: ReplayPackage;
    try {
      replay = encodeReplay(await store.events(s.sid), s.ctx.seed);
    } catch (e) {
      await store.removeSession(s.sid);
      report.rejected.push({ sid: s.sid, reason: `local_invalid: ${(e as Error).message}` });
      continue;
    }
    const outcome = await submit({ sid: s.sid, idempotencyKey: s.sid, ctx: s.ctx, replay });
    if (outcome.status === "retry") {
      await store.putSession({ ...s, attempts: s.attempts + 1 });
      report.waiting.push(...run.slice(i).map((x) => x.sid));
      break;
    }
    await store.removeSession(s.sid);
    if (outcome.status === "accepted") report.accepted.push(s.sid);
    else report.rejected.push({ sid: s.sid, reason: outcome.reason });
  }
  const done = new Set([...report.accepted, ...report.rejected.map((r) => r.sid)]);
  for (const s of ended.slice(run.length)) if (!done.has(s.sid)) report.waiting.push(s.sid);
  return report;
}
