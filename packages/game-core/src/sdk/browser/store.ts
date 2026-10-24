// The device event queue (GAME_SDK §5.3, §8; MD-203). Events are kept per `(sid, seq)` until their
// session is accepted by the server, so an offline session survives reloads and syncs exactly once.
// The queue is a small port: IndexedDB in the browser (idb-store.ts), memory in tests.
import type { GameEvent } from "../../schema/events.ts";
import type { SessionContext } from "../../schema/manifest.ts";

export type QueuedSessionStatus = "open" | "ended";

/** One session in the queue. The context is what the host got from API-34 (no personal data). */
export interface QueuedSession {
  sid: string;
  ctx: SessionContext;
  status: QueuedSessionStatus;
  /** Host clock (ms) when the session was queued; orders the sync. */
  queuedAt: number;
  /** Failed submit attempts so far (network errors, 5xx). */
  attempts: number;
}

export interface PutResult {
  /** Events newly stored. */
  added: number;
  /** Same `(sid, seq)` already stored with the same content: ignored. */
  duplicates: number;
  /** Same `(sid, seq)` already stored with different content: the first write wins. */
  conflicts: number;
}

export interface QueueStore {
  /** Idempotent on `(sid, seq)`: re-writing an event is a no-op, and the first write wins. */
  putEvents(events: readonly GameEvent[]): Promise<PutResult>;
  /** A session's events in `seq` order. */
  events(sid: string): Promise<GameEvent[]>;
  putSession(session: QueuedSession): Promise<void>;
  session(sid: string): Promise<QueuedSession | null>;
  /** Every queued session, oldest first (`queuedAt`, then `sid`). */
  sessions(): Promise<QueuedSession[]>;
  /** Deletes a session and all its events (after the server accepted or refused it). */
  removeSession(sid: string): Promise<void>;
  /** "Clear this device" (EC-14): every session and event. */
  clear(): Promise<void>;
}

export const eventKey = (e: Pick<GameEvent, "sid" | "seq">): string => `${e.sid}#${e.seq}`;

export const bySessionOrder = (a: QueuedSession, b: QueuedSession): number =>
  a.queuedAt - b.queuedAt || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0);

/** Same event, compared on its canonical JSON (key order cannot differ for parsed events). */
export const sameEvent = (a: GameEvent, b: GameEvent): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** In-memory queue for tests, previews and browsers without IndexedDB (private windows). */
export function createMemoryQueueStore(): QueueStore {
  const events = new Map<string, GameEvent>();
  const sessions = new Map<string, QueuedSession>();
  return {
    async putEvents(batch) {
      const r: PutResult = { added: 0, duplicates: 0, conflicts: 0 };
      for (const e of batch) {
        const prev = events.get(eventKey(e));
        if (prev === undefined) {
          events.set(eventKey(e), structuredClone(e));
          r.added++;
        } else if (sameEvent(prev, e)) r.duplicates++;
        else r.conflicts++;
      }
      return r;
    },
    async events(sid) {
      return [...events.values()]
        .filter((e) => e.sid === sid)
        .sort((a, b) => a.seq - b.seq)
        .map((e) => structuredClone(e));
    },
    async putSession(s) {
      sessions.set(s.sid, structuredClone(s));
    },
    async session(sid) {
      const s = sessions.get(sid);
      return s === undefined ? null : structuredClone(s);
    },
    async sessions() {
      return [...sessions.values()].sort(bySessionOrder).map((s) => structuredClone(s));
    },
    async removeSession(sid) {
      sessions.delete(sid);
      for (const [k, e] of events) if (e.sid === sid) events.delete(k);
    },
    async clear() {
      sessions.clear();
      events.clear();
    },
  };
}
