import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient, MAX_STEP_BODY_BYTES, NonRetryableError, StepError } from "../src/lib/api.ts";
import { apiBaseFrom, ConfigError, loadConfig } from "../src/lib/config.ts";
import { ENV, fakeFetch, recordingSleep, testConfig } from "./helpers.ts";

const T0 = 1_761_300_000_000; // fixed clock (ms)

describe("config", () => {
  it("builds the private-network base URL from API_INTERNAL_HOSTPORT", () => {
    assert.equal(apiBaseFrom("margdarshak-api:10000"), "http://margdarshak-api:10000");
    assert.equal(apiBaseFrom("http://localhost:8080/"), "http://localhost:8080");
    assert.equal(testConfig().apiBase, "http://margdarshak-api:10000");
  });
  it("requires API_INTERNAL_HOSTPORT and INTERNAL_HMAC_SECRET and caps concurrency at 8", () => {
    assert.throws(() => loadConfig({}), (e: unknown) => e instanceof ConfigError && /API_INTERNAL_HOSTPORT, INTERNAL_HMAC_SECRET/.test(e.message));
    assert.throws(() => loadConfig({ ...ENV, CLOCK_SWEEP_CONCURRENCY: "9" }), ConfigError);
    assert.equal(testConfig().sweepConcurrency, 8);
    assert.equal(testConfig({ CLOCK_SWEEP_CONCURRENCY: "3" }).sweepConcurrency, 3);
  });
});

describe("job-step client", () => {
  it("POSTs /internal/job-steps/{step} with a valid HMAC, Idempotency-Key and bearer token", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { ok: 1 } }), () => Math.floor(T0 / 1000));
    const api = createApiClient(testConfig(), { fetch: f.fetch, now: () => T0 });
    const out = await api.step("clock.plan_pages", { tenants: ["JK"] }, { runId: "trn-9", idempotencyKey: "k-123456789012345" });
    assert.deepEqual(out, { ok: 1 });
    assert.equal(f.calls.length, 1);
    const c = f.calls[0]!;
    assert.equal(c.method, "POST");
    assert.equal(c.url, "http://margdarshak-api:10000/internal/job-steps/clock.plan_pages");
    assert.deepEqual(c.signature, { ok: true, ts: Math.floor(T0 / 1000) });
    assert.match(c.headers["margdarshak-signature"]!, /^t=\d+,v1=[0-9a-f]{64}$/);
    assert.equal(c.headers["idempotency-key"], "k-123456789012345");
    assert.equal(c.headers["authorization"], "Bearer test-internal-token");
    assert.equal(c.headers["content-type"], "application/json");
    assert.deepEqual(c.json, { run_id: "trn-9", args: { tenants: ["JK"] } });
  });

  it("omits Authorization when no bearer token is configured", async () => {
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    const api = createApiClient(testConfig({ INTERNAL_BEARER_TOKEN: "" }), { fetch: f.fetch });
    await api.step("clock.plan_pages", {}, { idempotencyKey: "k" });
    assert.equal(f.calls[0]!.headers["authorization"], undefined);
    assert.equal(f.calls[0]!.json!.run_id, null);
  });

  it("retries 5xx with exponential backoff and re-signs each attempt with a newer timestamp", async () => {
    const statuses = [503, 500, 200];
    const f = fakeFetch(() => {
      const s = statuses.shift()!;
      return s === 200 ? { status: 200, body: { fired: 3 } } : { status: s, body: { title: "unavailable" } };
    }, () => Math.floor(T0 / 1000));
    const s = recordingSleep();
    const api = createApiClient(testConfig(), { fetch: f.fetch, sleep: s.sleep, now: () => T0 });
    const out = await api.step("clock.fire_batch", { event_keys: ["a:b:2026-10-24"] }, { idempotencyKey: "k" });
    assert.deepEqual(out, { fired: 3 });
    assert.equal(f.calls.length, 3);
    assert.deepEqual(s.sleeps, [1000, 2000]);
    // Same body, same Idempotency-Key, but three distinct signatures with strictly increasing t
    // (the Go replay cache rejects a signature it has seen).
    const ts = f.calls.map((c) => (c.signature.ok ? c.signature.ts : -1));
    assert.deepEqual(ts, [ts[0], ts[0]! + 1, ts[0]! + 2]);
    assert.equal(new Set(f.calls.map((c) => c.headers["margdarshak-signature"])).size, 3);
    assert.equal(new Set(f.calls.map((c) => c.body)).size, 1);
    assert.ok(f.calls.every((c) => c.headers["idempotency-key"] === "k" && c.signature.ok));
  });

  it("retries 429 and network errors, then gives up after the configured attempts", async () => {
    const f = fakeFetch(() => (f.calls.length === 1 ? { status: 429 } : f.calls.length === 2 ? { status: 0 } : { status: 502 }));
    const s = recordingSleep();
    const api = createApiClient(testConfig({ API_STEP_ATTEMPTS: "4" }), { fetch: f.fetch, sleep: s.sleep });
    await assert.rejects(
      api.step("clock.fire_batch", {}, { idempotencyKey: "k" }),
      (e: unknown) => e instanceof StepError && !(e instanceof NonRetryableError) && e.status === 502 && e.attempts === 4,
    );
    assert.equal(f.calls.length, 4);
    assert.deepEqual(s.sleeps, [1000, 2000, 4000]);
  });

  it("does not retry 4xx (bad input / auth)", async () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      const f = fakeFetch(() => ({ status, body: { title: "nope" } }));
      const s = recordingSleep();
      const api = createApiClient(testConfig(), { fetch: f.fetch, sleep: s.sleep });
      await assert.rejects(api.step("clock.fire_batch", {}, { idempotencyKey: "k" }), (e: unknown) => e instanceof NonRetryableError && e.status === status);
      assert.equal(f.calls.length, 1, `status ${status}`);
      assert.deepEqual(s.sleeps, []);
    }
  });

  it("refuses bodies over 16 KB and malformed step names without calling the API", async () => {
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    const api = createApiClient(testConfig(), { fetch: f.fetch });
    await assert.rejects(api.step("clock.fire_batch", { blob: "x".repeat(MAX_STEP_BODY_BYTES) }, { idempotencyKey: "k" }), NonRetryableError);
    await assert.rejects(api.step("../admin", {}, { idempotencyKey: "k" }), NonRetryableError);
    assert.equal(f.calls.length, 0);
  });
});
