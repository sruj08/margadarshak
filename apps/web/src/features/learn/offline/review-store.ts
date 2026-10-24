import type { ConfidenceLevel, ReviewRating } from "@margdarshak/gamification";
import type { AnswerSubmission } from "../api-types";

/**
 * The on-device review log (E-18 mirror) and the API-32 outbox, in IndexedDB `md-learn`
 * (FRONTEND §4.4). The log is append-only and keyed by `client_answer_id`, so writing the same answer
 * twice is a no-op; card states are always re-derived from it with the pinned FSRS scheduler
 * (./learning.ts `cardsFromLog`). Without IndexedDB (private mode, tests) an in-memory store with the
 * same contract stands in for the page view.
 */

export interface LogEntry {
  /** = client_answer_id (also the API-32 dedupe key). */
  id: string;
  cardId: string;
  itemId: string;
  optionId: string;
  rating: ReviewRating;
  reviewedAt: number;
  correct: boolean;
  overconfident: boolean;
  confidence?: ConfidenceLevel;
  latencyMs?: number;
  /** One review per card per session: entries sharing a sourceSid collapse to the worst rating. */
  sourceSid: string;
  mode: "review" | "practice" | "mock" | "lesson";
  /** Whether the card was due when answered (only due reviews earn XP). */
  wasDue: boolean;
}

export interface ReviewStore {
  append(entries: readonly LogEntry[], outbox: readonly AnswerSubmission[]): Promise<void>;
  log(): Promise<LogEntry[]>;
  outbox(): Promise<AnswerSubmission[]>;
  removeOutbox(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

const DB = "md-learn";
const VERSION = 1;

export function sortLog(entries: readonly LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : 1));
}

export function memoryReviewStore(): ReviewStore {
  const log = new Map<string, LogEntry>();
  const out = new Map<string, AnswerSubmission>();
  return {
    async append(entries, outbox) {
      for (const e of entries) if (!log.has(e.id)) log.set(e.id, e);
      for (const o of outbox) if (!out.has(o.client_answer_id)) out.set(o.client_answer_id, o);
    },
    async log() {
      return sortLog([...log.values()]);
    },
    async outbox() {
      return [...out.values()].sort((a, b) => (a.answered_at < b.answered_at ? -1 : 1));
    },
    async removeOutbox(ids) {
      for (const id of ids) out.delete(id);
    },
    async clear() {
      log.clear();
      out.clear();
    },
  };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function idbReviewStore(factory: IDBFactory): ReviewStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("log")) db.createObjectStore("log", { keyPath: "id" });
        if (!db.objectStoreNames.contains("outbox"))
          db.createObjectStore("outbox", { keyPath: "client_answer_id" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return opening;
  };
  return {
    async append(entries, outbox) {
      const db = await open();
      const tx = db.transaction(["log", "outbox"], "readwrite");
      const log = tx.objectStore("log");
      const box = tx.objectStore("outbox");
      // `add` fails on an existing key: first write wins, so a replayed answer never doubles.
      for (const e of entries) log.add(e).onerror = (ev) => ev.preventDefault();
      for (const o of outbox) box.add(o).onerror = (ev) => ev.preventDefault();
      await done(tx);
    },
    async log() {
      const db = await open();
      return sortLog(await req(db.transaction("log").objectStore("log").getAll()));
    },
    async outbox() {
      const db = await open();
      const all = await req(db.transaction("outbox").objectStore("outbox").getAll());
      return (all as AnswerSubmission[]).sort((a, b) => (a.answered_at < b.answered_at ? -1 : 1));
    },
    async removeOutbox(ids) {
      const db = await open();
      const tx = db.transaction("outbox", "readwrite");
      for (const id of ids) tx.objectStore("outbox").delete(id);
      await done(tx);
    },
    async clear() {
      const db = await open();
      const tx = db.transaction(["log", "outbox"], "readwrite");
      tx.objectStore("log").clear();
      tx.objectStore("outbox").clear();
      await done(tx);
    },
  };
}

let store: ReviewStore | null = null;

/** The device store (IndexedDB when available). */
export function reviewStore(): ReviewStore {
  if (store) return store;
  const factory = typeof indexedDB === "undefined" ? null : indexedDB;
  store = factory ? idbReviewStore(factory) : memoryReviewStore();
  return store;
}

/** Tests: swap the store. */
export function setReviewStore(s: ReviewStore | null): void {
  store = s;
}
