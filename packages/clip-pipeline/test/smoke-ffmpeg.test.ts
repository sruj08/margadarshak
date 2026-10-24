// Optional end-to-end check of the argv builders against a real ffmpeg. Skipped when `ffmpeg
// -version` fails. Uses synthetic lavfi sources only (no footage) in a temp directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { buildBlurArgv } from "../src/blur.ts";
import {
  buildMezzanineArgv,
  buildPosterArgv,
  buildProbeArgv,
  type Command,
} from "../src/ffmpeg.ts";
import {
  buildLumaGridArgv,
  buildLumaStatsArgv,
  flashCheckFromLuma,
  parseLumaGrid,
  parseSignalstatsMetadata,
} from "../src/flash.ts";
import { checkDeliveryRendition, findPrivacyMetadata, parseFfprobeJson } from "../src/probe.ts";

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 &&
  spawnSync("ffprobe", ["-version"]).status === 0;

function run(cmd: Command): string {
  const r = spawnSync(cmd.file, cmd.args as string[], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `${cmd.file} failed: ${r.stderr}`);
  return r.stdout;
}

function lavfi(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", "-y", ...args], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
}

describe("ffmpeg smoke test", { skip: hasFfmpeg ? false : "ffmpeg/ffprobe not installed" }, () => {
  const dir = hasFfmpeg ? mkdtempSync(join(tmpdir(), "clip-pipeline-")) : "";
  const p = (name: string): string => join(dir, name);
  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("mezzanine → blur renditions → probe conforms, metadata and audio gone", () => {
    lavfi([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=25:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-metadata",
      "location=+32.7266+074.8570/",
      "-metadata",
      "creation_time=2026-10-22T05:41:09Z",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      p("raw.mp4"),
    ]);
    const raw = parseFfprobeJson(run(buildProbeArgv({ input: p("raw.mp4") })));
    assert.ok(
      findPrivacyMetadata(raw).some((f) => f.key === "location"),
      "fixture carries a location tag",
    );
    assert.equal(raw.streams.audio, 1);

    run(buildMezzanineArgv({ input: p("raw.mp4"), output: p("mezz.mp4") }));
    const mezz = parseFfprobeJson(run(buildProbeArgv({ input: p("mezz.mp4") })));
    assert.deepEqual(findPrivacyMetadata(mezz), []);
    assert.equal(mezz.streams.audio, 0);
    assert.equal(mezz.video?.fps, 30);
    assert.equal(mezz.video?.height, 720);

    const blur = buildBlurArgv({
      input: p("mezz.mp4"),
      frame: { width: mezz.video?.width ?? 0, height: mezz.video?.height ?? 0 },
      detections: [
        {
          cls: "face",
          score: 0.9,
          box: { x: 0.4, y: 0.3, w: 0.1, h: 0.15 },
          fromFrame: 5,
          toFrame: 20,
        },
        {
          cls: "plate",
          score: 0.8,
          box: { x: 0.7, y: 0.8, w: 0.12, h: 0.05 },
          fromFrame: 30,
          toFrame: 59,
        },
      ],
      totalFrames: 60,
      outputs: [
        { res: "360p", path: p("b360.mp4") },
        { res: "480p", path: p("b480.mp4") },
      ],
    });
    run(blur.command);
    for (const [res, file] of [
      ["360p", "b360.mp4"],
      ["480p", "b480.mp4"],
    ] as const) {
      const probe = parseFfprobeJson(run(buildProbeArgv({ input: p(file) })));
      assert.deepEqual(checkDeliveryRendition(probe, res), [], `${res} conforms`);
    }

    // Same kind of render with the graph passed as a file (-/filter_complex, ffmpeg ≥ 7).
    const viaFile = buildBlurArgv({
      input: p("mezz.mp4"),
      frame: { width: 1280, height: 720 },
      detections: [
        {
          cls: "face",
          score: 0.9,
          box: { x: 0.4, y: 0.3, w: 0.1, h: 0.15 },
          fromFrame: 5,
          toFrame: 20,
        },
      ],
      outputs: [{ res: "360p", path: p("g360.mp4") }],
      graphFile: p("graph.txt"),
    });
    writeFileSync(p("graph.txt"), viaFile.filterGraph, "utf8");
    run(viaFile.command);
    assert.deepEqual(
      checkDeliveryRendition(
        parseFfprobeJson(run(buildProbeArgv({ input: p("g360.mp4") }))),
        "360p",
      ),
      [],
    );

    run(buildPosterArgv({ input: p("b480.mp4"), output: p("poster.jpg"), atMs: 500 }));
    assert.ok(readFileSync(p("poster.jpg")).length > 1000);
  });

  it("flash check end to end: 3 flashes/s passes, 3.75 fails", () => {
    for (const [half, passes] of [
      [5, true],
      [4, false],
    ] as const) {
      const src = p(`flash${half}.mp4`);
      lavfi([
        "-f",
        "lavfi",
        "-i",
        `nullsrc=s=320x240:r=30:d=3,geq=lum='if(mod(floor(N/${half}),2),235,16)':cb=128:cr=128,format=yuv420p`,
        "-c:v",
        "libx264",
        "-qp",
        "0",
        "-pix_fmt",
        "yuv420p",
        src,
      ]);
      run(buildLumaGridArgv({ input: src, output: p(`flash${half}.gray`) }));
      const series = parseLumaGrid(new Uint8Array(readFileSync(p(`flash${half}.gray`))));
      assert.equal(series.length, 9);
      assert.equal(series[0]?.length, 90);
      assert.equal(flashCheckFromLuma(series).passes, passes, `half-period ${half} frames`);

      // signalstats path, with a temp-dir (on Windows, drive-letter) path escaped into the graph.
      run(buildLumaStatsArgv({ input: src, metadataOutput: p(`flash${half}.txt`) }));
      const yavg = parseSignalstatsMetadata(readFileSync(p(`flash${half}.txt`), "utf8"));
      assert.equal(yavg.length, 90);
      assert.equal(flashCheckFromLuma([yavg]).passes, passes);
    }
  });
});
