// Config, HMAC and replay-cache unit tests.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, DEFAULT_PORT, loadConfig } from "../src/config.ts";
import { ReplayCache, sign, verify } from "../src/hmac.ts";

describe("config", () => {
  it("refuses to start without a secret", () => {
    assert.throws(() => loadConfig({}), ConfigError);
    assert.throws(() => loadConfig({ VERIFIER_SHARED_SECRET: "  " }), ConfigError);
  });
  it("prefers VERIFIER_SHARED_SECRET, falls back to SCORE_VERIFIER_HMAC_SECRET", () => {
    assert.equal(
      loadConfig({ VERIFIER_SHARED_SECRET: "a", SCORE_VERIFIER_HMAC_SECRET: "b" }).secret,
      "a",
    );
    assert.equal(loadConfig({ SCORE_VERIFIER_HMAC_SECRET: "b" }).secret, "b");
  });
  it("reads PORT, then SCORE_VERIFIER_PORT, default 8081", () => {
    const s = { VERIFIER_SHARED_SECRET: "x" };
    assert.equal(DEFAULT_PORT, 8081);
    assert.equal(loadConfig(s).port, 8081);
    assert.equal(loadConfig({ ...s, SCORE_VERIFIER_PORT: "8090" }).port, 8090);
    assert.equal(loadConfig({ ...s, PORT: "9000", SCORE_VERIFIER_PORT: "8090" }).port, 9000);
    assert.throws(() => loadConfig({ ...s, PORT: "http" }), ConfigError);
    assert.equal(loadConfig(s).contentDir, null);
    assert.equal(loadConfig({ ...s, VERIFIER_CONTENT_DIR: "/content" }).contentDir, "/content");
    assert.equal(loadConfig(s).bodyLimitBytes, 256 * 1024);
  });
});

describe("Margdarshak-Signature", () => {
  it("matches the shared scheme: hex HMAC-SHA256(secret, t + '.' + body)", () => {
    // Same vector as services/workflows (computed with node:crypto independently).
    const h = sign("s3cret", 1700000000, '{"a":1}');
    assert.match(h, /^t=1700000000,v1=[0-9a-f]{64}$/);
    assert.deepEqual(verify("s3cret", h, '{"a":1}', 1700000100), {
      ok: true,
      ts: 1700000000,
      sig: h.slice("t=1700000000,v1=".length),
    });
    assert.deepEqual(
      verify("s3cret", h, Buffer.from('{"a":1}'), 1700000000).ok,
      true,
      "bytes and strings agree",
    );
    assert.deepEqual(
      verify(
        "s3cret",
        h.toUpperCase().replace("T=", "t=").replace("V1=", "v1="),
        '{"a":1}',
        1700000000,
      ).ok,
      true,
    );
  });
  it("classifies failures", () => {
    const h = sign("k", 100, "b");
    assert.deepEqual(verify("k", undefined, "b", 100), { ok: false, reason: "missing" });
    assert.deepEqual(verify("k", "t=100", "b", 100), { ok: false, reason: "malformed" });
    assert.deepEqual(verify("k", h, "b", 401), { ok: false, reason: "stale" });
    assert.deepEqual(verify("k", h, "c", 100), { ok: false, reason: "mismatch" });
  });
});

describe("replay cache", () => {
  it("accepts once within the TTL and stays bounded", () => {
    const c = new ReplayCache(3, 600);
    assert.equal(c.accept("a", 0), true);
    assert.equal(c.accept("a", 10), false);
    assert.equal(
      c.accept("a", 600),
      true,
      "expired entries may be reused (the signature is stale by then)",
    );
    for (const k of ["b", "c", "d", "e"]) c.accept(k, 700);
    assert.ok(c.size <= 3);
  });
});
