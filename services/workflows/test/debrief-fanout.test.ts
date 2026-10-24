import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NonRetryableError } from "../src/lib/api.ts";
import { normaliseDebriefInput, STEP_DEBRIEF_BACKFILL, TASK_DEBRIEF_BACKFILL } from "../src/tasks/debrief-fanout.ts";
import { defineTasks } from "../src/tasks/index.ts";
import { ENV, fakeCtx, fakeFetch, fakeSdk, recordingSleep } from "./helpers.ts";

const PATH = `/internal/job-steps/${STEP_DEBRIEF_BACKFILL}`;

/** A fake Go step over `n` cardless sessions; `throttle` answers 503 to the first k calls (a 429 upstream). */
function fakeBackfillApi(n: number, throttle = 0) {
  let left = n;
  let calls = 0;
  const f = fakeFetch((call) => {
    assert.ok(call.signature.ok);
    if (call.path !== PATH) return { status: 404, body: {} };
    calls++;
    if (calls <= throttle) return { status: 503, body: { code: "ADAPTER_UNAVAILABLE" } };
    const limit = Number(call.json!.args["limit"]);
    const page = Math.min(limit, left);
    left -= page;
    return { status: 200, body: { pending: page, built: page, ai: page, transient: 0 } };
  });
  return {
    ...f,
    get left() {
      return left;
    },
    get stepCalls() {
      return calls;
    },
  };
}

function setup(api: ReturnType<typeof fakeBackfillApi>) {
  const s = recordingSleep();
  const sdk = fakeSdk();
  const tasks = defineTasks(sdk.define, { env: ENV, fetch: api.fetch, sleep: s.sleep, log: () => {} });
  return { sdk, tasks, sleeps: s.sleeps };
}

describe("debrief_backfill (RW-3, MD-311)", () => {
  it("is registered under the job name API-67 starts", () => {
    const { sdk, tasks } = setup(fakeBackfillApi(0));
    assert.equal(tasks.debriefBackfill.name, TASK_DEBRIEF_BACKFILL);
    assert.equal(sdk.registered.get(TASK_DEBRIEF_BACKFILL)?.retry?.maxRetries, 3);
  });

  it("pages until the pending list is short and builds each card once", async () => {
    const api = fakeBackfillApi(120);
    const { tasks } = setup(api);
    const out = await tasks.debriefBackfill.func(fakeCtx(), {});
    assert.deepEqual(out, { pages: 3, built: 120, ai: 120, truncated: false });
    assert.equal(api.left, 0);
    const keys = api.calls.map((c) => c.headers["idempotency-key"]);
    assert.equal(new Set(keys).size, keys.length, "a distinct key per page");
  });

  it("retries a throttled step with backoff (an upstream 429)", async () => {
    const api = fakeBackfillApi(10, 1);
    const { tasks, sleeps } = setup(api);
    const out = await tasks.debriefBackfill.func(fakeCtx(), { limit: 50 });
    assert.equal(out.built, 10);
    assert.equal(sleeps.length, 1, "one backoff before the retry");
  });

  it("rejects bad input without calling the API", () => {
    assert.throws(() => normaliseDebriefInput([{ limit: 0 }]), NonRetryableError);
    assert.throws(() => normaliseDebriefInput([{ since: "yesterday" }]), NonRetryableError);
  });
});
