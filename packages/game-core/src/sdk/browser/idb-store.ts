// IndexedDB implementation of the event queue (GAME_SDK §5.3: "keyed (sid, seq)"). The structural
// types below are the slice of the IndexedDB API this file uses, so game-core compiles without the
// DOM lib; pass `globalThis.indexedDB` in the browser. A queue holds a few sessions of at most 5,000
// events each, so whole-store reads are cheap and no key ranges are needed.
import type { GameEvent } from "../../schema/events.ts";
import {
  bySessionOrder,
  eventKey,
  type PutResult,
  type QueuedSession,
  type QueueStore,
  sameEvent,
} from "./store.ts";

interface IdbRequestLike<T> {
  result: T;
  error: unknown;
  onsuccess: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

interface IdbOpenRequestLike extends IdbRequestLike<IdbDatabaseLike> {
  onupgradeneeded: ((ev: unknown) => void) | null;
  onblocked: ((ev: unknown) => void) | null;
}

interface IdbObjectStoreLike {
  put(value: unknown): IdbRequestLike<unknown>;
  get(key: unknown): IdbRequestLike<unknown>;
  getAll(): IdbRequestLike<unknown[]>;
  delete(key: unknown): IdbRequestLike<unknown>;
  clear(): IdbRequestLike<unknown>;
}

interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike;
  oncomplete: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onabort: ((ev: unknown) => void) | null;
  error: unknown;
}

interface IdbDatabaseLike {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, opts: { keyPath: string | string[] }): unknown;
  transaction(stores: string[], mode: "readonly" | "readwrite"): IdbTransactionLike;
  close(): void;
}

export interface IdbFactoryLike {
  open(name: string, version: number): IdbOpenRequestLike;
}

export const QUEUE_DB_NAME = "margdarshak-game-queue";
const DB_VERSION = 1;
const EVENTS = "events";
const SESSIONS = "sessions";

function requestResult<T>(req: IdbRequestLike<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IdbTransactionLike): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDb(factory: IdbFactoryLike, name: string): Promise<IdbDatabaseLike> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(SESSIONS))
        db.createObjectStore(SESSIONS, { keyPath: "sid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`IndexedDB ${name} is blocked by another tab`));
  });
}

/** Rows of the events store: the event plus its `sid#seq` key. */
interface EventRow {
  key: string;
  event: GameEvent;
}

/**
 * The queue on IndexedDB. Survives reloads; `clear()` is the "Clear this device" action (EC-14).
 * Opening is lazy, so creating the store never throws in a browser without IndexedDB access.
 */
export function createIndexedDbQueueStore(
  factory: IdbFactoryLike,
  opts: { dbName?: string } = {},
): QueueStore {
  let db: Promise<IdbDatabaseLike> | null = null;
  const conn = (): Promise<IdbDatabaseLike> => {
    db ??= openDb(factory, opts.dbName ?? QUEUE_DB_NAME);
    return db;
  };
  const readAll = async <T>(store: string): Promise<T[]> => {
    const tx = (await conn()).transaction([store], "readonly");
    return (await requestResult(tx.objectStore(store).getAll())) as T[];
  };

  return {
    async putEvents(batch) {
      const tx = (await conn()).transaction([EVENTS], "readwrite");
      const store = tx.objectStore(EVENTS);
      const done = txDone(tx);
      const r: PutResult = { added: 0, duplicates: 0, conflicts: 0 };
      // Every get is queued before any put runs, so repeats inside the batch are settled here.
      const first = new Map<string, GameEvent>();
      for (const event of batch) {
        const prev = first.get(eventKey(event));
        if (prev === undefined) first.set(eventKey(event), event);
        else if (sameEvent(prev, event)) r.duplicates++;
        else r.conflicts++;
      }
      // All requests are issued in one transaction; each get decides its own put.
      for (const [key, event] of first) {
        const get = store.get(key);
        get.onsuccess = () => {
          const prev = get.result as EventRow | undefined;
          if (prev === undefined) {
            store.put({ key, event } satisfies EventRow);
            r.added++;
          } else if (sameEvent(prev.event, event)) r.duplicates++;
          else r.conflicts++;
        };
      }
      await done;
      return r;
    },
    async events(sid) {
      const rows = await readAll<EventRow>(EVENTS);
      return rows
        .map((row) => row.event)
        .filter((e) => e.sid === sid)
        .sort((a, b) => a.seq - b.seq);
    },
    async putSession(session) {
      const tx = (await conn()).transaction([SESSIONS], "readwrite");
      tx.objectStore(SESSIONS).put(session);
      await txDone(tx);
    },
    async session(sid) {
      const tx = (await conn()).transaction([SESSIONS], "readonly");
      const s = await requestResult(tx.objectStore(SESSIONS).get(sid));
      return (s as QueuedSession | undefined) ?? null;
    },
    async sessions() {
      return (await readAll<QueuedSession>(SESSIONS)).sort(bySessionOrder);
    },
    async removeSession(sid) {
      const rows = await readAll<EventRow>(EVENTS);
      const tx = (await conn()).transaction([EVENTS, SESSIONS], "readwrite");
      const events = tx.objectStore(EVENTS);
      for (const row of rows) if (row.event.sid === sid) events.delete(row.key);
      tx.objectStore(SESSIONS).delete(sid);
      await txDone(tx);
    },
    async clear() {
      const tx = (await conn()).transaction([EVENTS, SESSIONS], "readwrite");
      tx.objectStore(EVENTS).clear();
      tx.objectStore(SESSIONS).clear();
      await txDone(tx);
    },
  };
}
