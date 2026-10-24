// I/O seams for the clip tasks: running binaries without a shell, ffprobe lookup, manual-mask
// detections and the FAULT_INJECTION_CLIP_BLUR marker.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NonRetryableError } from "../src/lib/api.ts";
import {
  binaries,
  faultMarkerKey,
  InjectedFault,
  manualMaskDetector,
  maybeInjectBlurFault,
  mustRun,
  parseManualMasks,
  runCommand,
} from "../src/tasks/clip-media.ts";
import { MemoryObjectStore } from "./clip-fakes.ts";

describe("runCommand / mustRun", () => {
  it("runs argv without a shell and returns stdout bytes", async () => {
    const r = await runCommand(
      {
        file: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1])", "a b; echo $HOME | x"],
      },
      { cwd: tmpdir(), timeoutMs: 10_000 },
    );
    assert.equal(r.code, 0);
    assert.equal(
      r.stdout.toString("utf8"),
      "a b; echo $HOME | x",
      "metacharacters reach the child verbatim",
    );
  });

  it("throws with the exit code and stderr tail, and on a timeout", async () => {
    await assert.rejects(
      mustRun(
        runCommand,
        { file: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"] },
        tmpdir(),
        10_000,
        "probe",
      ),
      /probe: .* exited 3: boom/,
    );
    await assert.rejects(
      mustRun(
        runCommand,
        { file: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"] },
        tmpdir(),
        200,
        "slow",
      ),
      /timed out after 200 ms/,
    );
  });

  it("finds ffprobe next to FFMPEG_PATH", () => {
    assert.deepEqual(binaries(undefined), { ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
    assert.deepEqual(binaries(join("C:", "ffmpeg", "bin", "ffmpeg.exe")), {
      ffmpeg: join("C:", "ffmpeg", "bin", "ffmpeg.exe"),
      ffprobe: join("C:", "ffmpeg", "bin", "ffprobe.exe"),
    });
    assert.deepEqual(binaries("ffmpeg"), { ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
    assert.deepEqual(binaries("/opt/x/encoder"), { ffmpeg: "/opt/x/encoder", ffprobe: "ffprobe" });
  });
});

describe("manual masks (default blur detector)", () => {
  it("turns curator masks into manual detections", async () => {
    const masks = [{ box: { x: 0.1, y: 0.2, w: 0.1, h: 0.05 }, from_frame: 30, to_frame: 90 }];
    const d = await manualMaskDetector.detect({
      clipId: "JMU-0012",
      version: 3,
      mezzaninePath: "m.mp4",
      width: 1920,
      height: 1080,
      totalFrames: 900,
      manualMasks: masks,
    });
    assert.deepEqual(d, [
      {
        cls: "manual",
        score: 1,
        box: { x: 0.1, y: 0.2, w: 0.1, h: 0.05 },
        fromFrame: 30,
        toFrame: 90,
      },
    ]);
    assert.equal(manualMaskDetector.name, "manual-masks");
  });

  it("rejects a mask it cannot honour (never blur less than asked)", () => {
    assert.throws(
      () =>
        parseManualMasks([{ box: { x: 0.9, y: 0, w: 0.2, h: 0.1 }, from_frame: 0, to_frame: 1 }]),
      NonRetryableError,
    );
    assert.throws(
      () => parseManualMasks([{ box: { x: 0, y: 0, w: 0.1, h: 0.1 }, from_frame: 5, to_frame: 2 }]),
      NonRetryableError,
    );
    assert.throws(() => parseManualMasks(["junk"]), NonRetryableError);
    assert.deepEqual(parseManualMasks([]), []);
  });
});

describe("FAULT_INJECTION_CLIP_BLUR", () => {
  it("once: fails the first attempt, leaves a marker, lets the retry through", async () => {
    const store = new MemoryObjectStore();
    await assert.rejects(
      maybeInjectBlurFault("once", store, "JMU-0012", 3, "trn-root-1"),
      InjectedFault,
    );
    assert.ok(store.has("ingest", faultMarkerKey("JMU-0012", 3, "trn-root-1")));
    await maybeInjectBlurFault("once", store, "JMU-0012", 3, "trn-root-1");
    await assert.rejects(
      maybeInjectBlurFault("once", store, "JMU-0012", 3, "trn-root-2"),
      InjectedFault,
      "a new run fails once again",
    );
  });

  it("off never fails, always always fails", async () => {
    const store = new MemoryObjectStore();
    await maybeInjectBlurFault("off", store, "JMU-0012", 3, "r");
    assert.equal(store.puts.length, 0);
    await assert.rejects(maybeInjectBlurFault("always", store, "JMU-0012", 3, "r"), InjectedFault);
    await assert.rejects(maybeInjectBlurFault("always", store, "JMU-0012", 3, "r"), InjectedFault);
    assert.equal(
      faultMarkerKey("JMU-0012", 3, "trn/../x"),
      "private/JMU-0012/v3/fault/blur-trn____x",
    );
  });
});
