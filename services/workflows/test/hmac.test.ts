import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mac, SIGNATURE_HEADER, sign, verify } from "../src/lib/hmac.ts";
import { SECRET } from "./helpers.ts";

const BODY = '{"run_id":"trn-1","args":{"x":1}}';

describe("Margdarshak-Signature (same scheme as Go hmacsig)", () => {
  it("matches an independent vector: hex HMAC-SHA256(secret, t + '.' + body)", () => {
    // printf '%s' '1700000000.{"run_id":"trn-1","args":{"x":1}}' | openssl dgst -sha256 -hmac test-internal-hmac-secret
    const want = "d9a5a647dbc7c2509627a5a97a02ee2c6759a775b6f651ec677a7776be46f84f";
    assert.equal(mac(SECRET, "1700000000", BODY), want);
    assert.equal(sign(SECRET, 1700000000, BODY), `t=1700000000,v1=${want}`);
    assert.equal(SIGNATURE_HEADER, "Margdarshak-Signature");
  });

  it("verifies inside the 300 s window and rejects stale, tampered, malformed and missing", () => {
    const h = sign(SECRET, 1700000000, BODY);
    assert.deepEqual(verify(SECRET, h, BODY, 1700000000 + 299), { ok: true, ts: 1700000000 });
    assert.deepEqual(verify(SECRET, h, BODY, 1700000000 - 299), { ok: true, ts: 1700000000 });
    assert.equal(verify(SECRET, h, BODY, 1700000000 + 301).ok, false);
    assert.deepEqual(verify(SECRET, h, BODY, 1700000000 + 301), { ok: false, reason: "stale" });
    assert.deepEqual(verify(SECRET, h, `${BODY} `, 1700000000), { ok: false, reason: "mismatch" });
    assert.deepEqual(verify("other-secret", h, BODY, 1700000000), { ok: false, reason: "mismatch" });
    assert.deepEqual(verify(SECRET, "t=abc,v1=00", BODY, 1700000000), { ok: false, reason: "malformed" });
    assert.deepEqual(verify(SECRET, "garbage", BODY, 1700000000), { ok: false, reason: "malformed" });
    assert.deepEqual(verify(SECRET, undefined, BODY, 1700000000), { ok: false, reason: "missing" });
  });

  it("accepts an upper-case hex signature like the Go verifier", () => {
    const h = sign(SECRET, 1700000000, BODY).replace(/v1=([0-9a-f]+)/, (_, s: string) => `v1=${s.toUpperCase()}`);
    assert.equal(verify(SECRET, h, BODY, 1700000000).ok, true);
  });
});
