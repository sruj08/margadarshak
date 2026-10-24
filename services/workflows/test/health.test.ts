import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineTasks } from "../src/tasks/index.ts";
import { ENV, fakeCtx, fakeFetch, fakeSdk } from "./helpers.ts";

describe("health task", () => {
  it("reports ok when the API's /v1/health answers 200", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { status: "ok" } }));
    const t = defineTasks(fakeSdk().define, { env: ENV, fetch: f.fetch, log: () => {} });
    const r = await t.health.func(fakeCtx());
    assert.equal(r.ok, true);
    assert.equal(r.service, "margdarshak-workflows");
    assert.deepEqual(r.api, { reachable: true, status: 200, error: null });
    assert.equal(f.calls[0]!.url, "http://margdarshak-api:10000/v1/health");
  });

  it("never throws: reports missing env and an unreachable API", async () => {
    const t1 = defineTasks(fakeSdk().define, { env: {}, log: () => {} });
    const r1 = await t1.health.func(fakeCtx());
    assert.equal(r1.ok, false);
    assert.match(r1.config.error!, /API_INTERNAL_HOSTPORT/);

    const f = fakeFetch(() => ({ status: 0 }));
    const t2 = defineTasks(fakeSdk().define, { env: ENV, fetch: f.fetch, log: () => {} });
    const r2 = await t2.health.func(fakeCtx());
    assert.equal(r2.ok, false);
    assert.equal(r2.api.reachable, false);
  });
});
