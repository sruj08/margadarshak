import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  checkDeliveryRendition,
  checkRawUpload,
  findPrivacyMetadata,
  parseFfprobeJson,
  parseRate,
  sizeBudgetBytes,
} from "../src/probe.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("ffprobe JSON parser", () => {
  it("parses a phone upload: rotation, streams, location tags", () => {
    const p = parseFfprobeJson(fixture("ffprobe-raw-phone.json"));
    assert.equal(p.formatName, "mov,mp4,m4a,3gp,3g2,mj2");
    assert.equal(p.durationMs, 62464);
    assert.equal(p.sizeBytes, 98234567);
    assert.deepEqual(p.streams, { video: 1, audio: 1, subtitle: 0, data: 1 });
    assert.equal(p.video?.codec, "hevc");
    assert.equal(p.video?.rotation, -90);
    assert.ok(Math.abs((p.video?.fps ?? 0) - 29.97) < 0.01);
    assert.equal(p.video?.nbFrames, 1872);
  });

  it("finds every non-allowlisted tag (GPS, creation time, device)", () => {
    const found = findPrivacyMetadata(parseFfprobeJson(fixture("ffprobe-raw-phone.json")));
    const keys = found.map((f) => `${f.scope}/${f.key}`);
    for (const k of [
      "format/location",
      "format/location-eng",
      "format/creation_time",
      "format/com.android.model",
      "format/com.android.manufacturer",
      "stream:0/creation_time",
      "stream:1/creation_time",
    ]) {
      assert.ok(keys.includes(k), `missing ${k}`);
    }
    assert.ok(!keys.includes("format/major_brand"));
  });

  it("flags a raw upload filmed in portrait", () => {
    // 1920x1080 with a -90° display matrix is portrait on screen.
    assert.deepEqual(checkRawUpload(parseFfprobeJson(fixture("ffprobe-raw-phone.json"))), [
      "portrait footage; filming protocol is landscape (NAZAR §3.1)",
    ]);
  });

  it("passes a conforming 360p rendition and lists what a raw file lacks", () => {
    assert.deepEqual(
      checkDeliveryRendition(parseFfprobeJson(fixture("ffprobe-delivery-360p.json")), "360p"),
      [],
    );
    const issues = checkDeliveryRendition(
      parseFfprobeJson(fixture("ffprobe-raw-phone.json")),
      "480p",
    );
    for (const want of [
      /codec hevc/,
      /profile Main/,
      /height 1080/,
      /fps 29\.97/,
      /rotation -90/,
      /audio stream/,
      /data streams/,
      /metadata format\/location/,
    ]) {
      assert.ok(
        issues.some((i) => want.test(i)),
        `expected ${want}`,
      );
    }
  });

  it("parses rates and rejects malformed JSON", () => {
    assert.equal(parseRate("30/1"), 30);
    assert.equal(parseRate("0/0"), null);
    assert.equal(parseRate(undefined), null);
    assert.throws(() => parseFfprobeJson("not json"));
    assert.throws(() => parseFfprobeJson(JSON.stringify({ streams: [{ codec_type: "video" }] })));
  });

  it("size budget follows NAZAR §3.1 targets", () => {
    assert.equal(sizeBudgetBytes("360p", 30_000), 2_000_000);
    assert.equal(sizeBudgetBytes("360p", 60_000), 4_000_000);
    assert.equal(sizeBudgetBytes("480p", 60_000), 5_000_000);
  });
});
