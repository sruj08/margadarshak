"use client";

import type { SessionResult } from "@margdarshak/game-core/schema";
import {
  createIndexedDbQueueStore,
  createMemoryQueueStore,
  type IdbFactoryLike,
  type QueueStore,
  type SubmitOutcome,
  type SubmitRequest,
  type SyncReport,
  syncQueue,
} from "@margdarshak/game-core/sdk/browser";
import { completeGameSession } from "../api";
import type { CheckedSessionResult } from "../api-types";
import { getSessionRecord, type SessionRecord, updateSessionRecord } from "../results-store";

/**
 * The device event queue (MD-203): IndexedDB keyed `(sid, seq)` through game-core's store, or memory
 * when IndexedDB is missing (private windows, tests). Sync submits ended sessions oldest first with
 * Idempotency-Key = sid, so a retry never duplicates (GAME_SDK §5.3, §8).
 */
let store: QueueStore | null = null;

export function queueStore(): QueueStore {
  if (store) return store;
  const idb = (globalThis as { indexedDB?: unknown }).indexedDB;
  store = idb ? createIndexedDbQueueStore(idb as IdbFactoryLike) : createMemoryQueueStore();
  return store;
}

/** Tests: swap the store (memory) and reset between cases. */
export function setQueueStoreForTests(s: QueueStore | null): void {
  store = s;
}

/** The provisional device result for a record, or null when the device cannot score it. */
async function devicePreview(
  rec: SessionRecord,
  req: SubmitRequest,
): Promise<CheckedSessionResult | null> {
  const mock = await import("../mock-api");
  const content =
    rec.deviceContent ??
    (rec.deviceDocs
      ? mock.contentFromDocs(rec.ctx, rec.deviceDocs.docs, rec.deviceDocs.formats)
      : null) ??
    mock.deviceContentFor(rec.ctx, rec.items);
  try {
    return mock.deviceComplete({
      manifest: rec.manifest,
      ctx: rec.ctx,
      replay: req.replay,
      events: rec.events,
      content,
    });
  } catch (e) {
    console.warn("device preview failed", e);
    return null;
  }
}

/** API-35 needs a client SessionResult; a mock has no windows on the client, so it may be empty. */
function clientResult(rec: SessionRecord, preview: CheckedSessionResult | null): SessionResult {
  if (preview?.result) return { ...preview.result, replay: { seed: rec.ctx.seed, inputs: "" } };
  return {
    sid: rec.ctx.sid,
    gameId: rec.ctx.gameId,
    gameVersion: rec.manifest.version,
    scoringVersion: rec.manifest.scoringVersion,
    seed: rec.ctx.seed,
    seedOrigin: rec.ctx.seedOrigin,
    difficulty: rec.ctx.difficulty,
    mode: rec.ctx.mode,
    score: {
      raw: 0,
      max: 0,
      pct: 0,
      passed: null,
      passRule: null,
      components: [],
      capApplied: null,
    },
    findings: [],
    evidence: [],
    calibration: null,
    integrity: { flags: [], trust: 1, timingMode: "none", provisional: true },
    replay: { seed: rec.ctx.seed, inputs: "" },
  };
}

/**
 * API-35 answers an idempotent replay (same session completed again) with `xp_awarded: null`: the
 * XP was awarded the first time. Keep the XP the earlier server-checked answer reported.
 */
export function keepAwardedXp(
  next: CheckedSessionResult,
  prev: CheckedSessionResult | null | undefined,
): CheckedSessionResult {
  if (next.xp_awarded !== null && next.xp_awarded !== undefined) return next;
  if (!prev?.server_checked || typeof prev.xp_awarded !== "number") return next;
  return { ...next, xp_awarded: prev.xp_awarded };
}

/** The submit function syncQueue calls for each ended session. Updates the device record. */
export async function submitSession(req: SubmitRequest): Promise<SubmitOutcome> {
  const rec = getSessionRecord(req.sid);
  if (!rec) return { status: "rejected", reason: "local_missing" };
  if (rec.source === "device") {
    const checked = await devicePreview(rec, req);
    updateSessionRecord(req.sid, { checked, status: "provisional" });
    return { status: "accepted" };
  }
  const preview = await devicePreview(rec, req);
  const outcome = await completeGameSession(req.sid, {
    client_result: clientResult(rec, preview),
    replay: req.replay,
  });
  switch (outcome.status) {
    case "accepted":
      updateSessionRecord(req.sid, {
        checked: keepAwardedXp(outcome.data, rec.checked),
        status: outcome.data.server_checked ? "verified" : "provisional",
      });
      return { status: "accepted" };
    case "unavailable":
      updateSessionRecord(req.sid, { checked: preview, status: "provisional" });
      return { status: "accepted" };
    case "retry":
      updateSessionRecord(req.sid, { status: "queued", checked: rec.checked ?? preview });
      return outcome;
    case "rejected":
      updateSessionRecord(req.sid, { status: "provisional", checked: rec.checked ?? preview });
      return outcome;
  }
}

let running: Promise<SyncReport> | null = null;

/** Submits every ended session in the queue (one run at a time). */
export function syncPending(): Promise<SyncReport> {
  running ??= syncQueue(queueStore(), submitSession).finally(() => {
    running = null;
  });
  return running;
}
