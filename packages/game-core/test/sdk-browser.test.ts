// sdk/browser (MD-203): the (sid, seq) queue, idempotent sync, visibility pause and the media clock.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goldenVectors } from "../src/fixtures/index.ts";
import { replay } from "../src/scoring/index.ts";
import {
  bindVisibility,
  createMediaClock,
  createMemoryQueueStore,
  createQueueSink,
  endQueuedSession,
  type QueueStore,
  queueSession,
  queueStoreContract,
  type SubmitOutcome,
  type SubmitRequest,
  syncQueue,
} from "../src/sdk/browser/index.ts";
import {
  arraySink,
  createEventRecorder,
  decodeReplay,
  SessionLifecycle,
} from "../src/sdk/index.ts";

const vector = (name: string) => {
  const v = goldenVectors().find((x) => x.name === name);
  if (v === undefined) throw new Error(`no vector ${name}`);
  return v;
};

describe("QueueStore contract (memory store)", () => {
  for (const c of queueStoreContract(createMemoryQueueStore, vector("nazar-strong").ctx)) {
    it(c.name, () => c.run());
  }
});

/** A server that accepts each Idempotency-Key once and refuses a different digest (API-35 409). */
function fakeServer() {
  const seen = new Map<string, string>();
  const accepted: SubmitRequest[] = [];
  let online = false;
  return {
    accepted,
    setOnline(v: boolean) {
      online = v;
    },
    async submit(req: SubmitRequest): Promise<SubmitOutcome> {
      if (!online) return { status: "retry", reason: "offline" };
      const prev = seen.get(req.idempotencyKey);
      if (prev !== undefined && prev !== req.replay.digest) {
        return { status: "rejected", reason: "409 different digest" };
      }
      if (prev === undefined) accepted.push(req);
      seen.set(req.idempotencyKey, req.replay.digest);
      return { status: "accepted" };
    },
  };
}

async function queueVector(store: QueueStore, name: string, queuedAt: number) {
  const v = vector(name);
  const events = decodeReplay(v.replayPackage, v.ctx.sid);
  await queueSession(store, v.ctx, queuedAt);
  const sink = createQueueSink(store, { batchSize: 7 });
  for (const e of events) sink.write(e);
  // A reload mid-write replays part of the stream into the queue again.
  for (const e of events.slice(0, 5)) sink.write(e);
  const r = await sink.drain();
  await endQueuedSession(store, v.ctx.sid);
  return { v, events, r };
}

describe("offline session sync (MD-203 acceptance)", () => {
  it("an offline session syncs once online, exactly once and with no duplicates", async () => {
    const store = createMemoryQueueStore();
    const server = fakeServer();
    const { v, events, r } = await queueVector(store, "nazar-medium", 1);
    assert.deepEqual(r, { added: events.length, duplicates: 5, conflicts: 0 });

    const offline = await syncQueue(store, server.submit);
    assert.deepEqual(offline, { accepted: [], rejected: [], waiting: [v.ctx.sid] });
    assert.equal((await store.session(v.ctx.sid))?.attempts, 1);

    server.setOnline(true);
    const online = await syncQueue(store, server.submit);
    assert.deepEqual(online.accepted, [v.ctx.sid]);
    assert.equal(server.accepted.length, 1);
    const sent = server.accepted[0] as SubmitRequest;
    assert.equal(sent.idempotencyKey, v.ctx.sid);
    assert.equal(sent.replay.digest, v.replayPackage.digest, "same stream as recorded");
    assert.deepEqual(decodeReplay(sent.replay, v.ctx.sid), events);
    // The server replay of what was synced is the golden result.
    assert.deepEqual(replay(v.manifest, v.ctx, sent.replay, v.content), v.expectedResult);

    assert.deepEqual(await store.sessions(), []);
    assert.deepEqual(await syncQueue(store, server.submit), {
      accepted: [],
      rejected: [],
      waiting: [],
    });
  });

  it("syncs oldest first, stops at the first retry and keeps open sessions", async () => {
    const store = createMemoryQueueStore();
    const a = await queueVector(store, "nazar-strong", 1);
    const b = await queueVector(store, "sd-strong", 2);
    const open = vector("ll-mock-strong");
    await queueSession(store, open.ctx, 0);
    const calls: string[] = [];
    const report = await syncQueue(store, async (req) => {
      calls.push(req.sid);
      return { status: "retry", reason: "503" };
    });
    assert.deepEqual(calls, [a.v.ctx.sid]);
    assert.deepEqual(report.waiting, [a.v.ctx.sid, b.v.ctx.sid]);
    assert.equal((await store.session(open.ctx.sid))?.status, "open");
  });

  it("a refused session leaves the queue; maxSessions bounds a run", async () => {
    const store = createMemoryQueueStore();
    const a = await queueVector(store, "nazar-strong", 1);
    const b = await queueVector(store, "sd-strong", 2);
    const report = await syncQueue(
      store,
      async () => ({ status: "rejected", reason: "403 consent" }),
      { maxSessions: 1 },
    );
    assert.deepEqual(report.rejected, [{ sid: a.v.ctx.sid, reason: "403 consent" }]);
    assert.deepEqual(report.waiting, [b.v.ctx.sid]);
    assert.deepEqual(
      (await store.sessions()).map((s) => s.sid),
      [b.v.ctx.sid],
    );
  });

  it("events that fail replay validation are dropped locally, never sent", async () => {
    const store = createMemoryQueueStore();
    const v = vector("nazar-strong");
    await queueSession(store, v.ctx, 1);
    const events = decodeReplay(v.replayPackage, v.ctx.sid);
    await store.putEvents(events.map((e, i) => (i === 3 ? { ...e, t: -5 } : e)));
    await endQueuedSession(store, v.ctx.sid);
    let sent = 0;
    const report = await syncQueue(store, async () => {
      sent++;
      return { status: "accepted" };
    });
    assert.equal(sent, 0);
    assert.match(report.rejected[0]?.reason ?? "", /^local_invalid/);
    assert.deepEqual(await store.sessions(), []);
  });
});

describe("recorder → queue sink", () => {
  it("stores exactly what the recorder emitted, in seq order", async () => {
    const v = vector("nazar-strong");
    const store = createMemoryQueueStore();
    const sink = createQueueSink(store, { batchSize: 3 });
    const mirror = arraySink();
    let now = 1000;
    const tee = {
      write(e: Parameters<typeof sink.write>[0]) {
        sink.write(e);
        mirror.write(e);
      },
      flush: () => sink.flush?.(),
    };
    const rec = createEventRecorder(v.ctx, tee, { now: () => now });
    rec.emit("session_start", {
      deviceClass: "mid",
      timingMode: "rvfc",
      a11yModes: [],
      orientation: "portrait",
    });
    for (let i = 0; i < 7; i++) {
      now += 400;
      rec.emit("tap", { x: 0.5, y: 0.5 }, { mt: now, item: 0 });
    }
    rec.flush();
    await sink.drain();
    assert.deepEqual(await store.events(v.ctx.sid), mirror.events);
  });
});

/** A document stand-in with a settable visibilityState. */
function fakeDocument() {
  let state = "visible";
  const listeners = new Set<() => void>();
  return {
    get visibilityState() {
      return state;
    },
    addEventListener: (_: "visibilitychange", l: () => void) => listeners.add(l),
    removeEventListener: (_: "visibilitychange", l: () => void) => listeners.delete(l),
    set(v: string) {
      state = v;
      for (const l of listeners) l();
    },
    get listeners() {
      return listeners.size;
    },
  };
}

function running() {
  const lc = new SessionLifecycle();
  lc.send({ type: "assets_verified" });
  lc.send({ type: "start" });
  return lc;
}

describe("bindVisibility (GAME_SDK §4.1, EC-18)", () => {
  const ctx = vector("nazar-strong").ctx;

  it("hiding a timed item records the events, voids the item and pauses the game", () => {
    const doc = fakeDocument();
    const lifecycle = running();
    const sink = arraySink();
    const recorder = createEventRecorder(ctx, sink, { now: () => 0 });
    let paused = 0;
    const unbind = bindVisibility(doc, {
      lifecycle,
      recorder,
      pauseGame: () => paused++,
      currentItem: () => 2,
      itemIsTimed: () => true,
    });
    doc.set("hidden");
    assert.equal(lifecycle.state, "ItemVoided");
    assert.equal(lifecycle.voidedItems, 1);
    assert.equal(paused, 1);
    assert.deepEqual(
      sink.events.map((e) => [e.type, e.item]),
      [
        ["visibility_hidden", 2],
        ["pause", 2],
      ],
    );
    doc.set("hidden"); // not Running any more: nothing more happens
    assert.equal(sink.events.length, 2);
    unbind();
    assert.equal(doc.listeners, 0);
  });

  it("between items it pauses; back after 10 minutes hidden, the session is abandoned", () => {
    const doc = fakeDocument();
    const lifecycle = running();
    let now = 0;
    bindVisibility(doc, {
      lifecycle,
      recorder: createEventRecorder(ctx, arraySink(), { now: () => now }),
      pauseGame: () => undefined,
      currentItem: () => null,
      itemIsTimed: () => true,
      now: () => now,
    });
    doc.set("hidden");
    assert.equal(lifecycle.state, "Paused");
    now += 10 * 60 * 1000;
    doc.set("visible");
    assert.equal(lifecycle.state, "Ended");
    assert.equal(lifecycle.endReason, "abandoned");
  });
});

describe("createMediaClock", () => {
  const scheduler = () => {
    const queue: (() => void)[] = [];
    return {
      queue,
      request: (cb: () => void) => queue.push(cb),
      cancel: () => undefined,
    };
  };

  it("uses requestVideoFrameCallback media time when the browser has it", () => {
    const frames: ((now: number, m: { mediaTime: number }) => void)[] = [];
    const video = {
      currentTime: 9.999,
      requestVideoFrameCallback(cb: (now: number, m: { mediaTime: number }) => void) {
        frames.push(cb);
        return frames.length;
      },
      cancelVideoFrameCallback: () => undefined,
    };
    const clock = createMediaClock(video, scheduler());
    assert.equal(clock.timingMode, "rvfc");
    const seen: number[] = [];
    const stop = clock.onFrame((t) => seen.push(t));
    frames[0]?.(0, { mediaTime: 12.4004 });
    frames[1]?.(16, { mediaTime: 12.4337 });
    assert.deepEqual(seen, [12400, 12434]);
    assert.equal(clock.currentMs(), 12434, "the frame on screen, not currentTime");
    stop();
    frames[2]?.(33, { mediaTime: 12.467 });
    assert.equal(seen.length, 2);
  });

  it("falls back to currentTime on animation frames and says so", () => {
    const video = { currentTime: 1.25 };
    const s = scheduler();
    const clock = createMediaClock(video, s);
    assert.equal(clock.timingMode, "fallback");
    const seen: number[] = [];
    clock.onFrame((t) => seen.push(t));
    s.queue[0]?.();
    video.currentTime = 1.3;
    s.queue[1]?.();
    assert.deepEqual(seen, [1250, 1300]);
    assert.equal(clock.currentMs(), 1300);
  });
});
