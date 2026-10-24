import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildLumaGridArgv,
  buildLumaStatsArgv,
  countFlashes,
  flashCheck,
  flashCheckFromLuma,
  lumaToRelativeLuminance,
  parseLumaGrid,
  parseMetadataPrint,
  parseSignalstatsMetadata,
} from "../src/flash.ts";

/** Square wave at 30 fps: `half` frames dark, `half` frames bright, for `frames` frames. */
function square(half: number, frames: number, dark = 0.05, bright = 0.9): number[] {
  return Array.from({ length: frames }, (_, i) => (Math.floor(i / half) % 2 === 0 ? dark : bright));
}

describe("flash check argv", () => {
  it("signalstats YAVG to a metadata file (snapshot, Windows path escaped)", () => {
    const cmd = buildLumaStatsArgv({ input: "b480.mp4", metadataOutput: "C:\\work\\luma.txt" });
    assert.deepEqual(cmd.args, [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-v",
      "error",
      "-y",
      "-i",
      "b480.mp4",
      "-map",
      "0:v:0",
      "-vf",
      "fps=30,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=C\\\\:\\\\\\\\work\\\\\\\\luma.txt",
      "-an",
      "-f",
      "null",
      "-",
    ]);
  });

  it("3x3 luma grid as raw gray frames (snapshot)", () => {
    assert.deepEqual(buildLumaGridArgv({ input: "b480.mp4", output: "luma.gray" }).args, [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-v",
      "error",
      "-y",
      "-i",
      "b480.mp4",
      "-map",
      "0:v:0",
      "-vf",
      "fps=30,extractplanes=y,scale=3:3:flags=area",
      "-an",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "luma.gray",
    ]);
    assert.throws(() => buildLumaGridArgv({ input: "a.mp4", output: "b", cols: 0 }), /grid/);
  });
});

describe("luminance parsers", () => {
  it("parses metadata=print output", () => {
    const text = readFileSync(
      new URL("./fixtures/signalstats-metadata.txt", import.meta.url),
      "utf8",
    );
    assert.deepEqual(parseSignalstatsMetadata(text), [16, 235, 125.5, 126.25]);
    const frames = parseMetadataPrint(text);
    assert.equal(frames[1]?.ptsTime, 0.0333333);
    assert.equal(frames[3]?.frame, 3);
  });

  it("tolerates CRLF and rejects junk or a missing key", () => {
    assert.deepEqual(
      parseSignalstatsMetadata("frame:0 pts:0 pts_time:0\r\nlavfi.signalstats.YAVG=20\r\n"),
      [20],
    );
    assert.throws(() => parseMetadataPrint("garbage line"), /unexpected/);
    assert.throws(
      () => parseSignalstatsMetadata("frame:0 pts:0 pts_time:0\nlavfi.other=1\n"),
      /no lavfi/,
    );
  });

  it("splits raw grid frames into per-tile series", () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 10, 20, 30, 40]);
    assert.deepEqual(parseLumaGrid(bytes, 2, 2), [
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ]);
    assert.throws(() => parseLumaGrid(Uint8Array.from([1, 2, 3]), 2, 2), /whole number/);
  });

  it("maps limited-range luma to relative luminance", () => {
    assert.equal(lumaToRelativeLuminance(16), 0);
    assert.equal(lumaToRelativeLuminance(235), 1);
    assert.equal(lumaToRelativeLuminance(0), 0);
    assert.equal(lumaToRelativeLuminance(255, "pc"), 1);
    assert.ok(Math.abs(lumaToRelativeLuminance(125.5) - 0.214) < 0.001);
  });
});

describe("EC-18 (T-EC-18c): countFlashes, WCAG 2.3.1 general flash", () => {
  it("3 flashes per second passes", () => {
    const c = countFlashes(square(5, 90), 30); // 3 Hz square wave: 6 transitions per second
    assert.equal(c.maxTransitionsInAnySecond, 6);
    assert.equal(c.maxFlashesInAnySecond, 3);
    assert.ok(flashCheck([square(5, 90)], 30).passes);
  });

  it("4 flashes per second fails", () => {
    const c = countFlashes(square(4, 90), 30); // 3.75 Hz: 8 transitions inside one second
    assert.equal(c.maxFlashesInAnySecond, 4);
    const r = flashCheck([square(4, 90)], 30);
    assert.equal(r.passes, false);
    assert.equal(r.worstAtMs, 133);
  });

  it("3.5 flashes (7 transitions) fails: the conservative reading", () => {
    // Transitions at frames 4, 8, ..., 28 (7 of them); frames 28–31 are bright and it stays bright.
    const s = square(4, 32).concat(Array(60).fill(0.9));
    const c = countFlashes(s, 30);
    assert.equal(c.maxTransitionsInAnySecond, 7);
    assert.equal(flashCheck([s], 30).passes, false);
  });

  it("ignores changes under 10% and flicker that never goes below 0.8", () => {
    assert.equal(countFlashes(square(2, 90, 0.4, 0.48), 30).transitions.length, 0);
    assert.equal(countFlashes(square(2, 90, 0.82, 0.99), 30).transitions.length, 0);
    assert.ok(
      countFlashes(square(2, 90, 0.7, 0.99), 30).transitions.length > 0,
      "darker side 0.7 < 0.8 counts",
    );
  });

  it("a slow fade or a single cut is not a flash problem", () => {
    const fade = Array.from({ length: 90 }, (_, i) => i / 89);
    assert.ok(countFlashes(fade, 30).maxTransitionsInAnySecond <= 1);
    const cut = Array(45).fill(0.05).concat(Array(45).fill(0.9));
    assert.equal(countFlashes(cut, 30).transitions.length, 1);
    assert.deepEqual(countFlashes([], 30).transitions, []);
  });

  it("reports the worst region and works from 8-bit luma", () => {
    const calm = Array(90).fill(120);
    const flashing = square(3, 90, 20, 230); // 5 Hz in luma units
    const r = flashCheckFromLuma([calm, calm, flashing]);
    assert.equal(r.passes, false);
    assert.equal(r.worstRegion, 2);
    assert.equal(r.regions, 3);
    assert.equal(r.frames, 90);
    assert.ok(flashCheckFromLuma([calm]).passes);
    assert.throws(() => flashCheck([], 30), /at least one/);
  });
});
