import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLIP_FINALIZE_STEPS, CLIP_GENERATE_STEPS, CLIP_INGEST_STEPS } from "@margdarshak/clip-pipeline";
import { NonRetryableError } from "../src/lib/api.ts";
import {
  batchIdempotencyKey,
  eventKey,
  MAX_PAGES,
  normaliseSweepInput,
  TASK_CASE_CLOCK_SWEEP,
  TASK_CLOCK_BATCH,
} from "../src/tasks/clock-sweep.ts";
import { TASK_HEALTH } from "../src/tasks/health.ts";
import { defineTasks } from "../src/tasks/index.ts";
import { type Call, ENV, type CtxLog, fakeCtx, fakeFetch, fakeSdk, recordingSleep } from "./helpers.ts";

interface Ev {
  case_id: string;
  type: string;
  due_on: string;
}

/**
 * A fake Go API for the clock steps: due events live in a table; plan_pages pages through the
 * ones not yet fired (keyset by index, `after` = opaque cursor); fire_batch marks keys fired,
 * counts a key it has already fired as already_fired (ON CONFLICT DO NOTHING). Counts "sends".
 */
function fakeClockApi(events: Ev[], opts: { pageSize?: number; failFire?: (call: Call, n: number) => number | undefined; delayMs?: number } = {}) {
  const fired = new Set<string>();
  const sends: string[] = [];
  let fireCalls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const f = fakeFetch(async (call) => {
    assert.ok(call.signature.ok, `bad signature on ${call.path}: ${JSON.stringify(call.signature)}`);
    const args = call.json!.args;
    if (call.path === "/internal/job-steps/clock.plan_pages") {
      const limit = Math.min(Number(args["limit"]), opts.pageSize ?? Number.POSITIVE_INFINITY);
      const due = events.filter((e) => !fired.has(`${e.case_id}:${e.type}:${e.due_on}`));
      const start = args["after"] === null ? 0 : Number(String(args["after"]).slice(2));
      const page = due.slice(start, start + limit);
      const end = start + page.length;
      return { status: 200, body: { as_of: "2026-10-24", events: page, next_cursor: end < due.length ? `c:${end}` : null } };
    }
    if (call.path === "/internal/job-steps/clock.fire_batch") {
      const n = ++fireCalls;
      const fail = opts.failFire?.(call, n);
      if (fail) return { status: fail, body: { title: "injected" } };
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 1));
      inFlight--;
      let newly = 0;
      let already = 0;
      for (const k of args["event_keys"] as string[]) {
        if (fired.has(k)) already++;
        else {
          fired.add(k);
          sends.push(k);
          newly++;
        }
      }
      return { status: 200, body: { fired: newly, skipped_opt_out: 0, failed: 0, already_fired: already } };
    }
    return { status: 404, body: { title: "unknown step" } };
  });
  return {
    ...f,
    fired,
    sends,
    get maxInFlight() {
      return maxInFlight;
    },
    get fireCalls() {
      return fireCalls;
    },
  };
}

function makeEvents(n: number): Ev[] {
  const types = ["LL_DAY_25_PREP", "LL_DAY_30_UNLOCK", "LL_EXPIRY_M30", "LL_EXPIRY_M7"];
  return Array.from({ length: n }, (_, i) => ({
    case_id: `cas_01JB8Z${String(i).padStart(4, "0")}`,
    type: types[i % types.length]!,
    due_on: "2026-10-24",
  }));
}

function setup(events: Ev[], env: Record<string, string> = {}, apiOpts: Parameters<typeof fakeClockApi>[1] = {}) {
  const api = fakeClockApi(events, apiOpts);
  const s = recordingSleep();
  const sdk = fakeSdk();
  const tasks = defineTasks(sdk.define, { env: { ...ENV, ...env }, fetch: api.fetch, sleep: s.sleep, log: () => {} });
  return { api, sleeps: s.sleeps, sdk, tasks };
}

describe("task registration", () => {
  it("registers case_clock_sweep, clock_batch and health with retries and timeouts", () => {
    const { sdk, tasks } = setup([]);
    assert.deepEqual([...sdk.registered.keys()].sort(), [
        TASK_CASE_CLOCK_SWEEP,
        TASK_CLOCK_BATCH,
        TASK_HEALTH,
        "nightly_stats",
        "replay_pending_sessions",
        "debrief_backfill",
        "clip_ingest",
        "clip_finalize",
        "clip_generate",
        ...CLIP_INGEST_STEPS.map((s) => `clip_ingest_${s.id}`),
        ...CLIP_FINALIZE_STEPS.map((s) => `clip_finalize_${s.id}`),
        ...CLIP_GENERATE_STEPS.map((s) => `clip_generate_${s.id}`),
      ].sort());
    assert.equal(tasks.caseClockSweep.name, "case_clock_sweep"); // the name the Go API starts (API-65)
    assert.deepEqual(sdk.registered.get("clock_batch")!.retry, { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 2 });
    assert.equal(sdk.registered.get("case_clock_sweep")!.timeoutSeconds, 1200);
    assert.equal(sdk.registered.get("clock_batch")!.timeoutSeconds, 300);
  });
});

describe("case_clock_sweep (RW-2, MD-126)", () => {
  it("pages through plan_pages until next_cursor is null and fires one batch per page", async () => {
    const events = makeEvents(450);
    const { api, tasks } = setup(events, { CLOCK_SWEEP_PAGE_SIZE: "200" });
    const log: CtxLog = { subtasks: [] };
    const out = await tasks.caseClockSweep.func(fakeCtx(log), { sweep_id: "sweep-2026-10-24-0800", tenants: ["jk"] });
    const plans = api.calls.filter((c) => c.path.endsWith("clock.plan_pages"));
    assert.deepEqual(plans.map((c) => c.json!.args["after"]), [null, "c:200", "c:400"]);
    assert.ok(plans.every((c) => c.json!.args["limit"] === 200 && (c.json!.args["tenants"] as string[])[0] === "JK"));
    assert.equal(log.subtasks.length, 3);
    assert.ok(log.subtasks.every((s) => s.name === "clock_batch"));
    assert.deepEqual(log.subtasks.map((s) => (s.args[0] as { event_keys: string[] }).event_keys.length), [200, 200, 50]);
    assert.equal(api.sends.length, 450);
    assert.deepEqual(
      { pages: out.pages, due: out.due, batches: out.batches, fired: out.fired, already: out.already_fired, as_of: out.as_of },
      { pages: 3, due: 450, batches: 3, fired: 450, already: 0, as_of: "2026-10-24" },
    );
  });

  it("addresses every event by its idempotency key caseId:type:dueOn", async () => {
    const events = makeEvents(3);
    const { api, tasks } = setup(events);
    await tasks.caseClockSweep.func(fakeCtx(), {});
    const fire = api.calls.find((c) => c.path.endsWith("clock.fire_batch"))!;
    const keys = fire.json!.args["event_keys"] as string[];
    assert.deepEqual(keys, [
      "cas_01JB8Z0000:LL_DAY_25_PREP:2026-10-24",
      "cas_01JB8Z0001:LL_DAY_30_UNLOCK:2026-10-24",
      "cas_01JB8Z0002:LL_EXPIRY_M30:2026-10-24",
    ]);
    assert.equal(fire.headers["idempotency-key"], batchIdempotencyKey("2026-10-24", keys));
    assert.equal(batchIdempotencyKey("2026-10-24", [...keys].reverse()), batchIdempotencyKey("2026-10-24", keys));
    assert.notEqual(batchIdempotencyKey("2026-10-25", keys), batchIdempotencyKey("2026-10-24", keys));
    assert.equal(eventKey({ case_id: "cas_X", type: "TEST_EVE", due_on: "2026-11-02" }), "cas_X:TEST_EVE:2026-11-02");
    assert.throws(() => eventKey({ case_id: "cas:X", type: "T", due_on: "2026-11-02" }), NonRetryableError);
    assert.throws(() => eventKey({ case_id: "cas_X", type: "T", due_on: "02/11/2026" }), NonRetryableError);
  });

  it("running the sweep twice sends nothing twice", async () => {
    const events = makeEvents(120);
    const { api, tasks } = setup(events, { CLOCK_SWEEP_PAGE_SIZE: "50" });
    const first = await tasks.caseClockSweep.func(fakeCtx(), { sweep_id: "s1" });
    const second = await tasks.caseClockSweep.func(fakeCtx(), { sweep_id: "s1" });
    assert.equal(first.fired, 120);
    assert.equal(second.fired, 0);
    assert.equal(second.due, 0);
    assert.equal(api.sends.length, 120);
    assert.equal(new Set(api.sends).size, 120);
  });

  it("drops an event the planner repeats across pages (key seen once per run)", async () => {
    const events = makeEvents(4);
    const dup = { ...events[1]! };
    const { api, tasks } = setup([...events.slice(0, 2), dup, ...events.slice(2)], { CLOCK_SWEEP_PAGE_SIZE: "2" });
    const out = await tasks.caseClockSweep.func(fakeCtx(), {});
    assert.equal(out.due, 4);
    assert.equal(out.duplicates_dropped, 1);
    assert.equal(api.sends.length, 4);
  });

  it("keeps at most CLOCK_SWEEP_CONCURRENCY batches in flight (default 8)", async () => {
    const events = makeEvents(400);
    for (const [env, limit] of [[{}, 8], [{ CLOCK_SWEEP_CONCURRENCY: "3" }, 3]] as const) {
      const { api, tasks } = setup(events, { CLOCK_SWEEP_PAGE_SIZE: "10", ...env }, { delayMs: 5 });
      const out = await tasks.caseClockSweep.func(fakeCtx(), {});
      assert.equal(out.batches, 40);
      assert.equal(api.maxInFlight, limit, `limit ${limit}`);
    }
  });

  it("retries a 5xx from fire_batch with backoff and still fires each event once", async () => {
    const events = makeEvents(30);
    const { api, sleeps, tasks } = setup(events, { CLOCK_SWEEP_PAGE_SIZE: "10", CLOCK_SWEEP_CONCURRENCY: "1" }, {
      failFire: (_c, n) => (n === 2 || n === 3 ? 503 : undefined),
    });
    const out = await tasks.caseClockSweep.func(fakeCtx(), {});
    assert.equal(out.fired, 30);
    assert.equal(out.batches_failed, 0);
    assert.equal(api.fireCalls, 5);
    assert.deepEqual(sleeps, [1000, 2000]);
    assert.equal(new Set(api.sends).size, 30);
  });

  it("fails the run (so Render retries it) when a batch keeps failing; a re-run fires only the rest", async () => {
    const events = makeEvents(20);
    let broken = true;
    const { api, tasks } = setup(events, { CLOCK_SWEEP_PAGE_SIZE: "10", CLOCK_SWEEP_CONCURRENCY: "1", API_STEP_ATTEMPTS: "2" }, {
      failFire: (c) => (broken && (c.json!.args["page"] as number) === 1 ? 500 : undefined),
    });
    await assert.rejects(tasks.caseClockSweep.func(fakeCtx(), {}), /1\/2 batches failed/);
    assert.equal(api.sends.length, 10);
    broken = false;
    const retry = await tasks.caseClockSweep.func(fakeCtx(), {});
    assert.equal(retry.due, 10);
    assert.equal(retry.fired, 10);
    assert.equal(new Set(api.sends).size, 20);
  });

  it("dry_run plans but fires nothing", async () => {
    const { api, tasks } = setup(makeEvents(15));
    const out = await tasks.caseClockSweep.func(fakeCtx(), { dry_run: true });
    assert.equal(out.due, 15);
    assert.equal(out.fired, 0);
    assert.equal(api.calls.filter((c) => c.path.endsWith("fire_batch")).length, 0);
  });

  it("fails fast on a planner that loops or returns junk", async () => {
    const loop = fakeFetch(() => ({ status: 200, body: { as_of: "2026-10-24", events: [], next_cursor: "same" } }));
    const t1 = defineTasks(fakeSdk().define, { env: ENV, fetch: loop.fetch, log: () => {} });
    await assert.rejects(t1.caseClockSweep.func(fakeCtx(), {}), /same cursor twice/);
    const junk = fakeFetch(() => ({ status: 200, body: { events: "nope" } }));
    const t2 = defineTasks(fakeSdk().define, { env: ENV, fetch: junk.fetch, log: () => {} });
    await assert.rejects(t2.caseClockSweep.func(fakeCtx(), {}), NonRetryableError);
    assert.ok(MAX_PAGES >= 1000);
  });

  it("accepts the input shapes the Go side may send", () => {
    assert.deepEqual(normaliseSweepInput([{ sweep_id: "s", as_of: "2026-10-24T02:30:00Z", tenants: ["jk", "KL", "JK"], dry_run: true }]), {
      tenants: ["JK", "KL"],
      as_of: "2026-10-24T02:30:00Z",
      sweep_id: "s",
      dry_run: true,
    });
    assert.deepEqual(normaliseSweepInput(["JK", "2026-10-24"]), { tenants: ["JK"], as_of: "2026-10-24", sweep_id: null, dry_run: false });
    assert.deepEqual(normaliseSweepInput([{ tenant: "all" }]), { tenants: [], as_of: null, sweep_id: null, dry_run: false });
    assert.deepEqual(normaliseSweepInput([]), { tenants: [], as_of: null, sweep_id: null, dry_run: false });
    assert.throws(() => normaliseSweepInput([{ tenants: ["JK; DROP"] }]), NonRetryableError);
  });
});
