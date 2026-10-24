// SDK: canonical digest, replay codec, event recorder and lifecycle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ReplayError } from "../src/errors.ts";
import { goldenVectors } from "../src/fixtures/index.ts";
import type { GameEvent } from "../src/schema/index.ts";
import {
  arraySink,
  base64Decode,
  base64Encode,
  canonicalJSON,
  createEventRecorder,
  decodeReplay,
  decodeReplayAsync,
  encodeReplay,
  encodeReplayGzip,
  eventsDigest,
  SessionLifecycle,
  sha256Hex,
  sha256HexBytes,
} from "../src/sdk/index.ts";

const vec = (name: string) => {
  const v = goldenVectors().find((x) => x.name === name);
  if (v === undefined) throw new Error(name);
  return v;
};
const SID = "00000000-0000-4000-8000-0000000000aa";

describe("canonical JSON and SHA-256", () => {
  it("pure SHA-256 matches node:crypto", () => {
    const inputs = [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "हेलो नज़र 🚦",
      "x".repeat(100000),
    ];
    for (const s of inputs)
      assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"));
    const bytes = new Uint8Array(1000).map((_, i) => (i * 31) & 255);
    assert.equal(sha256HexBytes(bytes), createHash("sha256").update(bytes).digest("hex"));
  });
  it("canonical JSON sorts keys, drops undefined, normalises -0 and rejects NaN", () => {
    assert.equal(
      canonicalJSON({ b: 1, a: [true, null, "x"], c: undefined, d: -0, e: 0.37 }),
      '{"a":[true,null,"x"],"b":1,"d":0,"e":0.37}',
    );
    assert.throws(() => canonicalJSON({ x: Number.NaN }));
  });
  it("digests of golden streams are pinned", () => {
    const pinned: Record<string, string> = {
      "nazar-strong": "e329042ed18ba53b0915f491096dd619d9a85b3dd63e88e043d45ff600eeadd3",
      "sd-strong": "56aa982659c2ce72748707e9ac51d64395bfd9033ed4574e7c2fcab0e0adb53e",
      "bs-strong": "cbe187749784f4e1998521928e1430a51a56d3be8db4a4ed206887fda2665537",
      "js-strong": "8858fb0c8448b60408dc550a25b7bfba764c3b11cf52332a4d24422fc40cfcb4",
      "tt-strong": "13b6f16efa1def00c7f2a5877e05426652628f4dbcc065381d27f1ec982cfaaa",
      "ll-mock-strong": "2714e643fd2f8f4278e0c4e28ac869ef4c992a3c3eb1f863adf057d01848907e",
    };
    for (const [name, hex] of Object.entries(pinned)) {
      const v = vec(name);
      assert.equal(v.replayPackage.digest, `sha256:${hex}`, name);
      const events = decodeReplay(v.replayPackage, v.ctx.sid);
      assert.equal(eventsDigest(events), `sha256:${hex}`);
      assert.equal(
        createHash("sha256").update(canonicalJSON(events)).digest("hex"),
        hex,
        `${name} vs node:crypto`,
      );
    }
  });
});

describe("replay codec", () => {
  it("base64 round-trips every length", () => {
    for (let n = 0; n < 70; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 97 + n) & 255);
      const s = base64Encode(b);
      assert.equal(s, Buffer.from(b).toString("base64"));
      assert.deepEqual(base64Decode(s), b);
    }
  });
  it("encode → decode is lossless and run-length encodes repeated rows", () => {
    for (const v of goldenVectors()) {
      const events = decodeReplay(v.replayPackage, v.ctx.sid);
      const again = encodeReplay(events, v.ctx.seed);
      assert.deepEqual(again, v.replayPackage, v.name);
    }
    const evs: GameEvent[] = Array.from({ length: 50 }, (_, i) => ({
      sid: SID,
      seq: i,
      t: i * 100,
      type: "lane_pos",
      item: 0,
      p: { lateralCm: 500, progressDm: 0 },
    }));
    const pkg = encodeReplay(evs, 1);
    const text = Buffer.from(pkg.inputs, "base64").toString("utf8");
    assert.match(text, /\[48\]\]/, "the second row (Δt = 100) repeats 48 more times");
    assert.deepEqual(decodeReplay(pkg), evs);
  });
  it("gzip encoding decodes to the same events and digest", async () => {
    const v = vec("bs-strong");
    const events = decodeReplay(v.replayPackage);
    const gz = await encodeReplayGzip(events, v.ctx.seed);
    assert.equal(gz.encoding, "mdr1+gzip");
    assert.equal(gz.digest, v.replayPackage.digest);
    assert.ok(gz.inputs.length < v.replayPackage.inputs.length);
    assert.deepEqual(await decodeReplayAsync(gz), events);
    assert.throws(() => decodeReplay(gz), ReplayError);
  });
  it("rejects tampering: digest, counts, order, schema, container", () => {
    const v = vec("nazar-medium");
    const events = decodeReplay(v.replayPackage);
    const code = (f: () => unknown): string => {
      try {
        f();
      } catch (e) {
        return e instanceof ReplayError ? e.code : "OTHER";
      }
      return "NONE";
    };
    // A tap moved earlier: the stream is valid but the digest no longer matches.
    const moved = events.map((e) =>
      e.type === "tap" && e.mt !== undefined ? { ...e, mt: e.mt - 900 } : e,
    );
    const forged = { ...encodeReplay(moved, v.ctx.seed), digest: v.replayPackage.digest };
    assert.equal(
      code(() => decodeReplay(forged)),
      "DIGEST_MISMATCH",
    );
    assert.equal(
      code(() => decodeReplay({ ...v.replayPackage, eventCount: 3 })),
      "BAD_REPLAY",
    );
    assert.equal(
      code(() => decodeReplay(v.replayPackage, SID)),
      "BAD_EVENTS",
      "events from another session",
    );
    const swapped = [...events];
    [swapped[3], swapped[4]] = [swapped[4] as GameEvent, swapped[3] as GameEvent];
    assert.equal(
      code(() => encodeReplay(swapped, 1)),
      "BAD_EVENTS",
    );
    const junk = Buffer.from('{"v":2,"sid":"x","r":[]}').toString("base64");
    assert.equal(
      code(() => decodeReplay({ ...v.replayPackage, inputs: junk })),
      "BAD_REPLAY",
    );
    assert.equal(
      code(() => decodeReplay({ ...v.replayPackage, inputs: "!!!" })),
      "BAD_REPLAY",
    );
    const extraKey = Buffer.from(
      JSON.stringify({ v: 1, sid: SID, r: [[1, 0, null, null, "horn", { loud: true }]] }),
    ).toString("base64");
    assert.equal(
      code(() => decodeReplay({ ...v.replayPackage, inputs: extraKey, eventCount: 1 })),
      "BAD_EVENTS",
    );
  });
});

describe("event recorder", () => {
  it("assigns seq and relative integer t, validates payloads", () => {
    let now = 1000.4;
    const sink = arraySink();
    const r = createEventRecorder({ sid: SID }, sink, { now: () => now });
    now = 1250.7;
    const e = r.emit("tap", { x: 0.31, y: 0.5 }, { mt: 120.6, item: 0 });
    assert.deepEqual(e, {
      sid: SID,
      seq: 0,
      t: 250,
      mt: 121,
      item: 0,
      type: "tap",
      p: { x: 0.31, y: 0.5 },
    });
    assert.equal(r.emit("tap", { x: 0.314, y: 0.5 }), null, "unquantised payload rejected");
    now = 1300;
    assert.equal(r.emit("horn", {})?.seq, 1);
    assert.equal(r.stats().rejected, 1);
  });
  it("caps taps at 20 per second and counts the dropped ones", () => {
    let now = 0;
    const sink = arraySink();
    const r = createEventRecorder({ sid: SID }, sink, { now: () => now });
    for (let i = 0; i < 30; i++) {
      now = i * 10;
      r.emit("tap", { x: 0.5, y: 0.5 });
    }
    assert.equal(sink.events.length, 20);
    assert.equal(r.stats().droppedTaps, 10);
    now = 1200;
    assert.notEqual(r.emit("tap", { x: 0.5, y: 0.5 }), null, "window slid");
  });
  it("samples lane_pos at 10 Hz and input once per 60 Hz step, only on change", () => {
    let now = 0;
    const sink = arraySink();
    const r = createEventRecorder({ sid: SID }, sink, { now: () => now });
    for (let ms = 0; ms < 1000; ms += 20) {
      now = ms;
      r.sample("lane_pos", { lateralCm: 400, progressDm: ms });
    }
    assert.equal(sink.events.filter((e) => e.type === "lane_pos").length, 10);
    now = 1000;
    r.sample("input", { steer: 0, throttle: 10, brake: 0 });
    now = 1005;
    assert.equal(r.sample("input", { steer: 5, throttle: 10, brake: 0 }), null, "same 60 Hz step");
    now = 1020;
    assert.equal(r.sample("input", { steer: 0, throttle: 10, brake: 0 }), null, "unchanged");
    now = 1040;
    assert.notEqual(r.sample("input", { steer: 3, throttle: 10, brake: 0 }), null);
  });
  it("drops sampled streams first, then ends the session at the event cap", () => {
    let now = 0;
    const sink = arraySink();
    const r = createEventRecorder({ sid: SID }, sink, {
      now: () => now,
      maxEvents: 40,
      reserve: 5,
    });
    for (let i = 0; i < 100; i++) {
      now = i * 100;
      r.sample("lane_pos", { lateralCm: 1, progressDm: i });
    }
    assert.equal(sink.events.length, 35);
    for (let i = 0; i < 10; i++) r.emit("horn", {});
    assert.equal(sink.events.length, 40);
    const last = sink.events[39] as GameEvent;
    assert.equal(last.type, "session_end");
    assert.deepEqual(last.p, { reason: "event_cap" });
    assert.equal(r.stats().capped, true);
    assert.equal(r.emit("horn", {}), null);
    // The recorded stream is a valid replay.
    assert.equal(encodeReplay(sink.events, 1).eventCount, 40);
  });
});

describe("session lifecycle", () => {
  it("walks the happy path and the offline path", () => {
    const l = new SessionLifecycle();
    for (const e of [
      { type: "assets_verified" },
      { type: "start" },
      { type: "pause", cause: "user" },
      { type: "resume" },
      { type: "end", reason: "completed" },
      { type: "submit", online: true },
      { type: "network_error" },
      { type: "online" },
      { type: "verified" },
    ] as const) {
      l.send(e);
    }
    assert.equal(l.state, "Verified");
    assert.equal(l.endReason, "completed");
    const off = new SessionLifecycle();
    off.send({ type: "assets_verified" });
    off.send({ type: "start" });
    off.send({ type: "end", reason: "quit" });
    assert.equal(off.send({ type: "submit", online: false }), "LocalOnly");
  });
  it("voids a timed item when hidden, pauses otherwise; rejects invalid transitions", () => {
    const l = new SessionLifecycle();
    assert.throws(() => l.send({ type: "start" }));
    l.send({ type: "assets_verified" });
    l.send({ type: "start" });
    assert.equal(l.send({ type: "hidden", timedItem: true }), "ItemVoided");
    assert.equal(l.voidedItems, 1);
    assert.equal(l.send({ type: "next_item" }), "Running");
    assert.equal(l.send({ type: "hidden", timedItem: false }), "Paused");
    assert.equal(l.send({ type: "abandon" }), "Ended");
    assert.equal(l.endReason, "abandoned");
    const f = new SessionLifecycle();
    assert.equal(f.send({ type: "asset_failed" }), "Failed");
    assert.equal(f.can({ type: "start" }), false);
  });
});
