// R2 access for the clip tasks: the SigV4 signer against AWS's published S3 example, and the
// R2ObjectStore request shape against a fake fetch.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { loadConfig } from "../src/lib/config.ts";
import {
  amzDate,
  EMPTY_SHA256,
  encodeKeyPath,
  R2ObjectStore,
  signV4,
} from "../src/tasks/clip-r2.ts";
import { ENV } from "./helpers.ts";

// AWS docs, "Signature Calculations for the Authorization Header: Transferring Payload in a Single
// Chunk", example "GET Object" (examplebucket, us-east-1, 20130524T000000Z).
const AWS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  date: new Date("2013-05-24T00:00:00Z"),
};

describe("SigV4 signer", () => {
  it("reproduces AWS's GET Object example signature", () => {
    const s = signV4({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { Range: "bytes=0-9" },
      payloadSha256: EMPTY_SHA256,
      region: "us-east-1",
      service: "s3",
      ...AWS,
    });
    assert.equal(
      s.canonicalRequest,
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY_SHA256,
      ].join("\n"),
    );
    assert.equal(s.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    assert.equal(
      s.headers["authorization"],
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    assert.equal(s.headers["host"], undefined, "fetch sets Host");
  });

  it("encodes keys the S3 way and formats x-amz-date", () => {
    assert.equal(encodeKeyPath("clips/JMU-0012/v3/360p.mp4"), "clips/JMU-0012/v3/360p.mp4");
    assert.equal(encodeKeyPath("test$file.text"), "test%24file.text");
    assert.equal(encodeKeyPath("a b/(c)*!'"), "a%20b/%28c%29%2A%21%27");
    assert.equal(amzDate(new Date("2026-10-24T09:05:07.123Z")), "20261024T090507Z");
  });
});

describe("R2ObjectStore", () => {
  const cfg = loadConfig({
    ...ENV,
    R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    R2_ACCESS_KEY_ID: "kid",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_CLIPS: "md-clips",
    R2_BUCKET_INGEST: "md-ingest",
  }).r2!;

  it("PUTs path-style to <account>.r2.cloudflarestorage.com with a signed payload hash", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const store = new R2ObjectStore(cfg, {
      now: () => new Date("2026-10-24T09:00:00Z"),
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response("", { status: 200 });
      },
    });
    const body = new TextEncoder().encode("hello");
    const out = await store.put("clips", "clips/JMU-0012/v3/360p.mp4", body, "video/mp4");
    const sha = createHash("sha256").update(body).digest("hex");
    assert.deepEqual(out, { bytes: 5, sha256: sha });
    assert.equal(
      calls[0]!.url,
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/md-clips/clips/JMU-0012/v3/360p.mp4",
    );
    const h = calls[0]!.init.headers as Record<string, string>;
    assert.equal(calls[0]!.init.method, "PUT");
    assert.equal(h["x-amz-content-sha256"], sha);
    assert.equal(h["x-amz-date"], "20261024T090000Z");
    assert.equal(h["content-type"], "video/mp4");
    assert.match(
      h["authorization"]!,
      /^AWS4-HMAC-SHA256 Credential=kid\/20261024\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("GETs from the ingest bucket, maps 404 to null and fails on other errors", async () => {
    const store = new R2ObjectStore(cfg, {
      fetch: async (url) => {
        if (url.endsWith("/missing")) return new Response("", { status: 404 });
        if (url.endsWith("/broken")) return new Response("nope", { status: 500 });
        assert.ok(url.includes("/md-ingest/"));
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
    });
    assert.deepEqual([...(await store.get("ingest", "private/JMU-0012/v3/x"))!], [1, 2, 3]);
    assert.equal(await store.get("ingest", "missing"), null);
    await assert.rejects(store.get("ingest", "broken"), /HTTP 500/);
  });

  it("refuses a bucket that is not configured", async () => {
    const store = new R2ObjectStore({ ...cfg, bucketClips: undefined });
    await assert.rejects(store.put("clips", "k", new Uint8Array(1), "x/y"), /R2_BUCKET_CLIPS/);
  });
});
