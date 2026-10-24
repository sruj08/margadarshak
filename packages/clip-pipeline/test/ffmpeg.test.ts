import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeMediaPath,
  buildMezzanineArgv,
  buildPosterArgv,
  buildProbeArgv,
  buildStripMetadataArgv,
  buildTranscodeArgv,
  encodeArgs,
  escapeFilterValue,
  posterTimeMs,
} from "../src/ffmpeg.ts";
import { specClip } from "./helpers.ts";

const PRE = ["-nostdin", "-hide_banner", "-nostats", "-v", "error", "-y"];
const STRIP = [
  "-an",
  "-sn",
  "-dn",
  "-map_metadata",
  "-1",
  "-map_chapters",
  "-1",
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
];
const enc = (crf: string, maxrate: string, bufsize: string): string[] => [
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  crf,
  "-maxrate",
  maxrate,
  "-bufsize",
  bufsize,
  "-profile:v",
  "high",
  "-level:v",
  "3.1",
  "-pix_fmt",
  "yuv420p",
  "-g",
  "30",
  "-keyint_min",
  "30",
  "-sc_threshold",
  "0",
  ...STRIP,
  "-movflags",
  "+faststart",
];

describe("transcode argv", () => {
  it("renders 360p and 480p in one decode (snapshot)", () => {
    const cmd = buildTranscodeArgv({
      input: "work/mezz.mp4",
      outputs: [
        { res: "360p", path: "out/360p.mp4" },
        { res: "480p", path: "out/480p.mp4" },
      ],
    });
    assert.equal(cmd.file, "ffmpeg");
    assert.deepEqual(cmd.args, [
      ...PRE,
      "-i",
      "work/mezz.mp4",
      "-filter_complex",
      "[0:v:0]fps=30[vin];[vin]split=2[s0][s1];[s0]scale=-2:360:flags=lanczos,setsar=1[out360p];[s1]scale=-2:480:flags=lanczos,setsar=1[out480p]",
      "-map",
      "[out360p]",
      ...enc("28", "600k", "1200k"),
      "out/360p.mp4",
      "-map",
      "[out480p]",
      ...enc("28", "900k", "1800k"),
      "out/480p.mp4",
    ]);
  });

  it("matches NAZAR §3.1's encoding line, flag for flag", () => {
    const a = encodeArgs("360p");
    for (const [flag, value] of [
      ["-c:v", "libx264"],
      ["-preset", "slow"],
      ["-crf", "28"],
      ["-profile:v", "high"],
      ["-pix_fmt", "yuv420p"],
      ["-movflags", "+faststart"],
      ["-g", "30"],
    ] as const) {
      assert.equal(a[a.indexOf(flag) + 1], value, flag);
    }
    assert.ok(a.includes("-an"), "audio stripped");
  });

  it("single output skips the split; threads and binary path pass through", () => {
    const cmd = buildTranscodeArgv({
      input: "a.mp4",
      outputs: [{ res: "480p", path: "b.mp4" }],
      threads: 2,
      binaries: { ffmpeg: "/opt/ff/ffmpeg" },
    });
    assert.equal(cmd.file, "/opt/ff/ffmpeg");
    assert.equal(
      cmd.args[cmd.args.indexOf("-filter_complex") + 1],
      "[0:v:0]fps=30[vin];[vin]scale=-2:480:flags=lanczos,setsar=1[out480p]",
    );
    assert.equal(cmd.args[cmd.args.indexOf("-threads") + 1], "2");
  });

  it("refuses duplicate or missing renditions", () => {
    assert.throws(() => buildTranscodeArgv({ input: "a.mp4", outputs: [] }), /at least one/);
    assert.throws(
      () =>
        buildTranscodeArgv({
          input: "a.mp4",
          outputs: [
            { res: "360p", path: "x.mp4" },
            { res: "360p", path: "y.mp4" },
          ],
        }),
      /duplicate/,
    );
  });
});

describe("mezzanine, strip, poster and probe argv", () => {
  it("mezzanine: CFR 30, ≤ 1080 lines, CRF 18, privacy strip (snapshot)", () => {
    assert.deepEqual(
      buildMezzanineArgv({ input: "raw/upload.mov", output: "work/mezz.mp4" }).args,
      [
        ...PRE,
        "-i",
        "raw/upload.mov",
        "-map",
        "0:v:0",
        "-vf",
        "fps=30,scale=-2:'min(ih,1080)':flags=lanczos,setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-keyint_min",
        "30",
        "-sc_threshold",
        "0",
        ...STRIP,
        "-movflags",
        "+faststart",
        "work/mezz.mp4",
      ],
    );
  });

  it("strip: stream copy of the first video stream, no metadata (snapshot)", () => {
    assert.deepEqual(buildStripMetadataArgv({ input: "in.mp4", output: "out.mp4" }).args, [
      ...PRE,
      "-i",
      "in.mp4",
      "-map",
      "0:v:0",
      "-c",
      "copy",
      ...STRIP,
      "-movflags",
      "+faststart",
      "out.mp4",
    ]);
  });

  it("poster: one frame, seek before input (snapshot)", () => {
    assert.deepEqual(buildPosterArgv({ input: "b480.mp4", output: "poster.jpg", atMs: 500 }).args, [
      ...PRE,
      "-ss",
      "0.500",
      "-i",
      "b480.mp4",
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=-2:360:flags=lanczos,setsar=1",
      "-q:v",
      "4",
      "-map_metadata",
      "-1",
      "-fflags",
      "+bitexact",
      "-flags:v",
      "+bitexact",
      "poster.jpg",
    ]);
    assert.throws(() => buildPosterArgv({ input: "a.mp4", output: "p.jpg", atMs: -1 }), /≥ 0/);
  });

  it("probe (snapshot)", () => {
    const cmd = buildProbeArgv({ input: "x.mp4" });
    assert.equal(cmd.file, "ffprobe");
    assert.deepEqual(cmd.args, [
      "-v",
      "error",
      "-hide_banner",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "x.mp4",
    ]);
  });

  it("poster time stays clear of hazards", () => {
    assert.equal(posterTimeMs(specClip()), 500);
    assert.equal(posterTimeMs({ quietSegments: [], hazards: [] }), 0);
    assert.equal(
      posterTimeMs({
        quietSegments: [{ fromMs: 11000, toMs: 12000 }],
        hazards: [{ window: { aMs: 12400, bMs: 16900 } }],
      }),
      0,
    );
  });
});

describe("path and filter safety", () => {
  it("rejects option-like, protocol and control-character paths; allows drive letters", () => {
    assert.throws(() => assertSafeMediaPath("-i"), /must not start/);
    assert.throws(() => assertSafeMediaPath("http://evil/x.mp4"), /protocol/);
    assert.throws(() => assertSafeMediaPath("concat:a.mp4|b.mp4"), /protocol/);
    assert.throws(() => assertSafeMediaPath("a\nb.mp4"), /control/);
    assert.throws(() => assertSafeMediaPath(""), /empty/);
    assert.equal(assertSafeMediaPath("C:\\work\\a.mp4"), "C:\\work\\a.mp4");
    assert.equal(assertSafeMediaPath("/tmp/a b.mp4"), "/tmp/a b.mp4");
    assert.throws(
      () => buildTranscodeArgv({ input: "pipe:0", outputs: [{ res: "360p", path: "o.mp4" }] }),
      /protocol/,
    );
  });

  it("escapes filter option values at both levels", () => {
    assert.equal(escapeFilterValue("C:\\tmp\\y.txt"), "C\\\\:\\\\\\\\tmp\\\\\\\\y.txt");
    assert.equal(escapeFilterValue("/tmp/a,b;c[d]'e"), "/tmp/a\\,b\\;c\\[d\\]\\\\\\'e");
    assert.equal(escapeFilterValue("plain/path.txt"), "plain/path.txt");
  });
});
