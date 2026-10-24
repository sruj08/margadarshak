// Contract checks every QueueStore must pass. Plain async functions with no test-runner imports, so
// node:test runs them on the memory store and the web app's Playwright suite on real IndexedDB.
import type { GameEvent } from "../../schema/events.ts";
import type { SessionContext } from "../../schema/manifest.ts";
import type { QueueStore } from "./store.ts";

export interface ContractCheck {
  name: string;
  run(): Promise<void>;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`QueueStore contract: ${message}`);
}

const ev = (sid: string, seq: number, t: number): GameEvent =>
  ({ sid, seq, t, type: "tap", p: { x: 0.5, y: 0.5 }, mt: t, item: 0 }) as GameEvent;

/** `ctx` is any valid SessionContext; the checks only change its sid. */
export function queueStoreContract(
  make: () => QueueStore | Promise<QueueStore>,
  ctx: SessionContext,
): ContractCheck[] {
  const sidA = "00000000-0000-4000-8000-00000000000a";
  const sidB = "00000000-0000-4000-8000-00000000000b";
  const session = (sid: string, queuedAt: number) => ({
    sid,
    ctx: { ...ctx, sid },
    status: "open" as const,
    queuedAt,
    attempts: 0,
  });
  return [
    {
      name: "writes are idempotent on (sid, seq) and the first write wins",
      async run() {
        const s = await make();
        const first = await s.putEvents([ev(sidA, 0, 0), ev(sidA, 1, 100)]);
        check(first.added === 2, `added ${first.added}, want 2`);
        const again = await s.putEvents([ev(sidA, 1, 100), ev(sidA, 1, 999), ev(sidA, 2, 200)]);
        check(again.added === 1, `re-put added ${again.added}, want 1`);
        check(again.duplicates === 1 && again.conflicts === 1, "duplicate and conflict counts");
        const got = await s.events(sidA);
        check(got.map((e) => e.seq).join() === "0,1,2", `seqs ${got.map((e) => e.seq).join()}`);
        check(got[1]?.t === 100, "the first write of seq 1 is kept");
      },
    },
    {
      name: "events are read per session in seq order",
      async run() {
        const s = await make();
        await s.putEvents([ev(sidB, 1, 10), ev(sidA, 1, 10), ev(sidB, 0, 0), ev(sidA, 0, 0)]);
        const b = await s.events(sidB);
        check(b.length === 2 && b.every((e) => e.sid === sidB), "only sid B");
        check(b[0]?.seq === 0 && b[1]?.seq === 1, "seq order");
      },
    },
    {
      name: "sessions list oldest first; removeSession deletes its events only",
      async run() {
        const s = await make();
        await s.putSession(session(sidB, 20));
        await s.putSession(session(sidA, 10));
        await s.putEvents([ev(sidA, 0, 0), ev(sidB, 0, 0)]);
        const list = await s.sessions();
        check(list.map((x) => x.sid).join() === `${sidA},${sidB}`, "queuedAt order");
        await s.removeSession(sidA);
        check((await s.session(sidA)) === null, "session A gone");
        check((await s.events(sidA)).length === 0, "events of A gone");
        check((await s.events(sidB)).length === 1, "events of B kept");
      },
    },
    {
      name: "clear() empties the device (EC-14)",
      async run() {
        const s = await make();
        await s.putSession(session(sidA, 1));
        await s.putEvents([ev(sidA, 0, 0)]);
        await s.clear();
        check((await s.sessions()).length === 0, "no sessions");
        check((await s.events(sidA)).length === 0, "no events");
      },
    },
  ];
}
