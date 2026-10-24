import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NonRetryableError } from "../src/lib/api.ts";
import { defineTasks } from "../src/tasks/index.ts";
import {
  MAX_REPLAY_PAGES,
  normaliseReplayInput,
  REPLAY_PAGE_SIZE,
  readReplayPage,
  replayPageKey,
  STEP_REPLAY_PENDING,
  TASK_REPLAY_PENDING,
} from "../src/tasks/replay-pending.ts";
import { type Call, ENV, fakeCtx, fakeFetch, fakeSdk, recordingSleep } from "./helpers.ts";

const PATH = `/internal/job-steps/${STEP_REPLAY_PENDING}`;

/**
 * A fake Go step: `pending` session ids in pending_verification; each call replays up to `limit`
 * of them (keyset by cursor), marks them verified (or leaves `stuck` ones pending) and answers
 * from an idempotency cache when a key repeats, like the API does.
 */
function fakeReplayApi(
  n: number,
  opts: {
    stuck?: Set<number>;
    fail?: (call: Call, i: number) => number | undefined;
    cursorless?: boolean;
  } = {},
) {
  const pending = new Set(Array.from({ length: n }, (_, i) => i));
  const replays: number[] = [];
  const cache = new Map<string, unknown>();
  let stepCalls = 0;
  const f = fakeFetch((call) => {
    assert.ok(call.signature.ok, `bad signature: ${JSON.stringify(call.signature)}`);
    assert.equal(call.headers["authorization"], "Bearer test-internal-token");
    if (call.path !== PATH) return { status: 404, body: { title: "unknown step" } };
    const i = ++stepCalls;
    const fail = opts.fail?.(call, i);
    if (fail) return { status: fail, body: { title: "injected" } };
    const key = call.headers["idempotency-key"]!;
    if (cache.has(key)) return { status: 200, body: cache.get(key) };
    const args = call.json!.args;
    const limit = Number(args["limit"]);
    const after = args["after"] === null ? -1 : Number(String(args["after"]).slice(2));
    const ids = [...pending]
      .filter((id) => opts.cursorless || id > after)
      .sort((a, b) => a - b)
      .slice(0, limit);
    let verified = 0;
    for (const id of ids) {
      replays.push(id);
      if (opts.stuck?.has(id)) continue;
      pending.delete(id);
      verified++;
    }
    const last = ids.at(-1);
    const more = [...pending].some((id) => opts.cursorless || id > (last ?? after));
    const body = opts.cursorless
      ? {
          processed: ids.length,
          verified,
          still_pending: pending.size,
          failed: ids.length - verified,
          has_more: more,
        }
      : {
          processed: ids.length,
          verified,
          still_pending: pending.size,
          failed: ids.length - verified,
          next_cursor: more && last !== undefined ? `c:${last}` : null,
        };
    cache.set(key, body);
    return { status: 200, body };
  });
  return {
    ...f,
    pending,
    replays,
    get stepCalls() {
      return stepCalls;
    },
  };
}

function setup(
  api: ReturnType<typeof fakeReplayApi> | ReturnType<typeof fakeFetch>,
  env: Record<string, string> = {},
) {
  const s = recordingSleep();
  const sdk = fakeSdk();
  const tasks = defineTasks(sdk.define, {
    env: { ...ENV, ...env },
    fetch: api.fetch,
    sleep: s.sleep,
    log: () => {},
  });
  return { sdk, tasks, sleeps: s.sleeps };
}

describe("replay_pending_sessions (ARCHITECTURE §8)", () => {
  it("is registered under the name API-67 starts, with 3 retries and a 10 min timeout", () => {
    const { sdk, tasks } = setup(fakeReplayApi(0));
    assert.equal(tasks.replayPendingSessions.name, TASK_REPLAY_PENDING);
    assert.deepEqual(sdk.registered.get(TASK_REPLAY_PENDING), {
      name: "replay_pending_sessions",
      retry: { maxRetries: 3, waitDurationMs: 5000, backoffScaling: 2 },
      timeoutSeconds: 600,
    });
  });

  it("pages through sessions.replay_pending until nothing is left, 50 per page", async () => {
    const api = fakeReplayApi(120);
    const { tasks } = setup(api);
    const out = await tasks.replayPendingSessions.func(fakeCtx(), {});
    assert.equal(api.stepCalls, 3);
    assert.deepEqual(
      api.calls.map((c) => c.json!.args["limit"]),
      [50, 50, 50],
    );
    assert.deepEqual(
      api.calls.map((c) => c.json!.args["after"]),
      [null, "c:49", "c:99"],
    );
    assert.deepEqual(
      {
        pages: out.pages,
        processed: out.processed,
        verified: out.verified,
        still_pending: out.still_pending,
        truncated: out.truncated,
        stub: out.stub,
      },
      { pages: 3, processed: 120, verified: 120, still_pending: 0, truncated: false, stub: false },
    );
    assert.equal(api.pending.size, 0);
    assert.equal(new Set(api.replays).size, 120, "every session replayed exactly once");
  });

  it("sends a distinct, bounded Idempotency-Key per page and the page/cursor in args", async () => {
    const api = fakeReplayApi(75);
    const { tasks } = setup(api);
    const ctx = fakeCtx();
    await tasks.replayPendingSessions.func(ctx, { replay_id: "replay-2026-10-24T10" });
    const keys = api.calls.map((c) => c.headers["idempotency-key"]!);
    assert.equal(keys.length, 2);
    assert.equal(new Set(keys).size, 2);
    assert.ok(
      keys.every((k) => k.length >= 16 && k.length <= 64),
      keys.join(" "),
    );
    assert.equal(keys[0], replayPageKey(ctx.metadata.taskRunId!, 0, null));
    assert.deepEqual(
      api.calls.map((c) => c.json!.args["page"]),
      [0, 1],
    );
    assert.ok(
      api.calls.every(
        (c) =>
          c.json!.args["replay_id"] === "replay-2026-10-24T10" &&
          c.json!.run_id === ctx.metadata.taskRunId,
      ),
    );
    // long run ids still give a bounded, stable key
    const long = "trn-".padEnd(80, "x");
    assert.ok(replayPageKey(long, 3, "c:99").length <= 64);
    assert.equal(replayPageKey(long, 3, "c:99"), replayPageKey(long, 3, "c:99"));
    assert.notEqual(replayPageKey(long, 3, "c:99"), replayPageKey(long, 4, "c:99"));
  });

  it("stops at the page cap and reports truncated (the next run continues)", async () => {
    const api = fakeReplayApi(500);
    const { tasks } = setup(api);
    const out = await tasks.replayPendingSessions.func(fakeCtx(), { limit: 10, max_pages: 3 });
    assert.equal(out.pages, 3);
    assert.equal(out.processed, 30);
    assert.equal(out.truncated, true);
    assert.equal(out.still_pending, 470);
  });

  it("does not loop on sessions the verifier keeps failing (cursor-less API)", async () => {
    const api = fakeReplayApi(5, { stuck: new Set([0, 1, 2, 3, 4]), cursorless: true });
    const { tasks } = setup(api);
    const out = await tasks.replayPendingSessions.func(fakeCtx(), {});
    // Page 0 tries the 5 (all still pending, has_more true); page 1 gets the same 5 back with no
    // progress, so the run stops instead of spinning to the page cap.
    assert.equal(out.pages, 2);
    assert.equal(api.replays.length, 10, "each stuck session retried at most twice per run");
    assert.ok(MAX_REPLAY_PAGES >= 100);
    assert.equal(out.verified, 0);
    assert.equal(out.still_pending, 5);
  });

  it("retries a 503 with backoff and replays nothing twice", async () => {
    const api = fakeReplayApi(60, { fail: (_c, i) => (i === 2 ? 503 : undefined) });
    const { tasks, sleeps } = setup(api);
    const out = await tasks.replayPendingSessions.func(fakeCtx(), {});
    assert.equal(out.processed, 60);
    assert.deepEqual(sleeps, [1000]);
    assert.equal(new Set(api.replays).size, api.replays.length);
  });

  it("a re-run of the same run id is answered from the idempotency cache", async () => {
    const api = fakeReplayApi(60);
    const { tasks } = setup(api);
    const ctx = fakeCtx();
    const first = await tasks.replayPendingSessions.func(ctx, {});
    const again = await tasks.replayPendingSessions.func(ctx, {});
    assert.equal(first.processed, 60);
    assert.equal(again.processed, 60, "cached answers, not new replays");
    assert.equal(api.replays.length, 60);
  });

  it("ends after one call while the Go step is the P2 stub", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      body: {
        step: STEP_REPLAY_PENDING,
        status: "stub",
        result: { step: STEP_REPLAY_PENDING, status: "stub" },
      },
    }));
    const { tasks } = setup(f);
    const out = await tasks.replayPendingSessions.func(fakeCtx(), {});
    assert.equal(f.calls.length, 1);
    assert.deepEqual(
      { pages: out.pages, stub: out.stub, processed: out.processed },
      { pages: 1, stub: true, processed: 0 },
    );
  });

  it("fails fast on a step that repeats its cursor or answers junk", async () => {
    const loop = fakeFetch(() => ({ status: 200, body: { processed: 1, next_cursor: "same" } }));
    await assert.rejects(
      setup(loop).tasks.replayPendingSessions.func(fakeCtx(), {}),
      /same cursor twice/,
    );
    const junk = fakeFetch(() => ({ status: 200, body: { processed: 1, next_cursor: 42 } }));
    await assert.rejects(
      setup(junk).tasks.replayPendingSessions.func(fakeCtx(), {}),
      NonRetryableError,
    );
    const bad = fakeFetch(() => ({ status: 422, body: { title: "unknown step" } }));
    await assert.rejects(
      setup(bad).tasks.replayPendingSessions.func(fakeCtx(), {}),
      NonRetryableError,
    );
    assert.equal(bad.calls.length, 1, "a 4xx is not retried");
  });

  it("normalises the API-67 input and validates it", () => {
    assert.deepEqual(normaliseReplayInput([]), {
      replay_id: null,
      limit: REPLAY_PAGE_SIZE,
      max_pages: MAX_REPLAY_PAGES,
    });
    assert.deepEqual(normaliseReplayInput([{ replay_id: "r-1", limit: 20, max_pages: 5 }]), {
      replay_id: "r-1",
      limit: 20,
      max_pages: 5,
    });
    assert.throws(() => normaliseReplayInput([{ limit: 0 }]), NonRetryableError);
    assert.throws(() => normaliseReplayInput([{ limit: 2.5 }]), NonRetryableError);
    assert.throws(() => normaliseReplayInput([{ replay_id: "a b; drop" }]), NonRetryableError);
    assert.deepEqual(readReplayPage({}), {
      processed: 0,
      verified: 0,
      still_pending: 0,
      failed: 0,
      next_cursor: null,
      has_more: false,
      stub: false,
    });
  });
});
