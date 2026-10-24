import { isOffline, submitAnswers } from "../api";
import { learnerProfile } from "../profile";
import { reviewStore } from "./review-store";

/**
 * The API-32 outbox (FRONTEND §4.4): answers are written to the device log and the outbox in one
 * IndexedDB transaction while the learner answers (online or not), then posted in batches of ≤ 200
 * when the network is back. A batch's Idempotency-Key is derived from its answer IDs and the server
 * dedupes every `client_answer_id`, so a retry or a second tab never counts an answer twice.
 * Single-flight: overlapping triggers share one run.
 */

export type SyncState = "idle" | "pending" | "syncing" | "synced" | "offline";

type Listener = (s: SyncState, pending: number) => void;
const listeners = new Set<Listener>();
let state: SyncState = "idle";
let pendingCount = 0;
let running: Promise<void> | null = null;
let backoff = 2000;

function set(s: SyncState, pending: number): void {
  state = s;
  pendingCount = pending;
  for (const l of listeners) l(s, pending);
}

export function onSyncState(l: Listener): () => void {
  listeners.add(l);
  l(state, pendingCount);
  return () => listeners.delete(l);
}

/**
 * FNV-1a over the sorted IDs: the same batch always carries the same key. The hash is padded to 8
 * hex digits so the key is never shorter than the API's 16-character Idempotency-Key minimum.
 */
export function batchKey(ids: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [...ids].sort().join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return `learn-${(h >>> 0).toString(16).padStart(8, "0")}-${ids.length}`;
}

export const BATCH_MAX = 200;

export function syncOutbox(): Promise<void> {
  running ??= (async () => {
    try {
      const store = reviewStore();
      let box = await store.outbox();
      if (box.length === 0) {
        set(state === "idle" ? "idle" : "synced", 0);
        return;
      }
      set("syncing", box.length);
      const profile = learnerProfile();
      while (box.length > 0) {
        const batch = box.slice(0, BATCH_MAX);
        const ids = batch.map((b) => b.client_answer_id);
        await submitAnswers(batch, batchKey(ids), profile);
        await store.removeOutbox(ids);
        box = await store.outbox();
      }
      backoff = 2000;
      set("synced", 0);
    } catch (e) {
      const left = (await reviewStore().outbox()).length;
      set(isOffline(e) ? "offline" : "pending", left);
      // Retry with backoff (2, 4, 8 … 60 s) unless the browser tells us it is offline.
      if (typeof window !== "undefined" && navigator.onLine !== false) {
        const wait = backoff;
        backoff = Math.min(60_000, backoff * 2);
        window.setTimeout(() => void syncOutbox(), wait);
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Marks answers waiting (shown as "Saved on this phone, will sync"). */
export async function notePending(): Promise<void> {
  const n = (await reviewStore().outbox()).length;
  if (n > 0) set(navigator.onLine === false ? "offline" : "pending", n);
}

let bound = false;
/** Syncs when the network comes back; call once from any learn screen. */
export function bindOutbox(): void {
  if (bound || typeof window === "undefined") return;
  bound = true;
  window.addEventListener("online", () => void syncOutbox());
  void syncOutbox();
}
