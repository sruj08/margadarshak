// clip_ingest (RW-1) with the fake defineTask, a fake ffmpeg/ffprobe, a fake Go API and an
// in-memory object store; plus a real-ffmpeg smoke run when ffmpeg is installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { CLIP_INGEST_STEPS, TASK_LIMITS } from "@margdarshak/clip-pipeline";
import { NonRetryableError } from "../src/lib/api.ts";
import { TASK_CLIP_INGEST } from "../src/tasks/clip-ingest.ts";
import { faultMarkerKey, InjectedFault, runCommand, stagedKey } from "../src/tasks/clip-media.ts";
import { defineTasks } from "../src/tasks/index.ts";
import { MemoryObjectStore } from "./clip-fakes.ts";
import { type Attempt, fakeClipApi, fakeMedia, retryingCtx } from "./clip-harness.ts";
import { ENV, fakeCtx, fakeSdk } from "./helpers.ts";

const RAW_KEY = "raw/JMU-0012/v3/upload";
const MASK = { box: { x: 0.4, y: 0.3, w: 0.1, h: 0.08 }, from_frame: 60, to_frame: 75 };
const JOB = { clip_id: "JMU-0012", version: 3 };

function goReplies(over: Partial<Record<string, () => { status: number; body?: unknown }>> = {}) {
  return {
    "clip.get": () => ({ status: 200, body: { raw_key: RAW_KEY, manual_masks: [MASK] } }),
    "clip.propose_windows": () => ({
      status: 200,
      body: { step: "clip.propose_windows", status: "stub" },
    }),
    "clip.open_review": () => ({ status: 200, body: { status: "proposed" } }),
    ...over,
  };
}

function setup(
  opts: {
    env?: Record<string, string>;
    replies?: Parameters<typeof goReplies>[0];
    media?: Parameters<typeof fakeMedia>[0];
    noRaw?: boolean;
  } = {},
) {
  const api = fakeClipApi(goReplies(opts.replies));
  const store = new MemoryObjectStore();
  if (!opts.noRaw)
    void store.put("ingest", RAW_KEY, new TextEncoder().encode("raw bytes"), "video/mp4");
  const media = fakeMedia(opts.media);
  const sdk = fakeSdk();
  const tasks = defineTasks(sdk.define, {
    env: { ...ENV, ...opts.env },
    fetch: api.fetch,
    sleep: async () => {},
    log: () => {},
    store: () => store,
    runCommand: media.run,
  });
  return { api, store, media, sdk, tasks };
}

describe("clip_ingest registration", () => {
  it("registers the parent with TASK_LIMITS and one subtask per CLIP_INGEST_STEPS entry", () => {
    const { sdk } = setup();
    assert.deepEqual(sdk.registered.get(TASK_CLIP_INGEST), {
      name: "clip_ingest",
      retry: TASK_LIMITS.clip_ingest.retry,
      timeoutSeconds: TASK_LIMITS.clip_ingest.timeoutSeconds,
    });
    for (const s of CLIP_INGEST_STEPS) {
      assert.deepEqual(
        sdk.registered.get(`clip_ingest_${s.id}`),
        { name: `clip_ingest_${s.id}`, retry: s.retry, timeoutSeconds: s.timeoutSeconds },
        s.id,
      );
    }
  });
});

describe("clip_ingest (RW-1)", () => {
  it("runs transcode → blur → flash_check → propose_windows → open_review, one ctx.run each", async () => {
    const { api, store, media, sdk, tasks } = setup();
    const attempts: Attempt[] = [];
    const out = await tasks.clipIngest.func(retryingCtx(sdk.registered, attempts), JOB);
    assert.deepEqual(
      attempts.map((a) => a.name),
      [
        "clip_ingest_transcode",
        "clip_ingest_blur",
        "clip_ingest_flash_check",
        "clip_ingest_propose_windows",
        "clip_ingest_open_review",
      ],
    );
    assert.deepEqual(api.names(), ["clip.get", "clip.propose_windows", "clip.open_review"]);
    assert.deepEqual(api.keys(), [
      "JMU-0012:get:3",
      "JMU-0012:propose_windows:3",
      "JMU-0012:open_review:3",
    ]);
    // media: private only; nothing unaudited in the public bucket
    assert.ok(store.has("ingest", "private/JMU-0012/v3/mezzanine.mp4"));
    for (const n of ["360p.mp4", "480p.mp4", "poster.jpg"] as const)
      assert.ok(store.has("ingest", stagedKey("JMU-0012", 3, n)), n);
    assert.ok(store.has("ingest", "private/JMU-0012/v3/blur-regions.json"));
    assert.ok(store.has("ingest", "private/JMU-0012/v3/luma-3x3.gray"));
    assert.equal(store.puts.filter((p) => p.startsWith("clips:")).length, 0);
    // open_review gets IDs, hashes and small results only
    const review = api.args("clip.open_review")[0]!;
    const mediaArgs = review["media"] as {
      res: string;
      sha256: string;
      key: string;
      bytes: number;
    }[];
    assert.deepEqual(
      mediaArgs.map((m) => m.res),
      ["360p", "480p"],
    );
    for (const m of mediaArgs) {
      assert.equal(
        m.sha256,
        createHash("sha256")
          .update((await store.get("ingest", m.key))!)
          .digest("hex"),
      );
    }
    assert.equal((review["flash"] as { passes: boolean }).passes, true);
    assert.equal(review["proposals"], null);
    assert.ok(Buffer.byteLength(api.steps.at(-1)!.body) < 16 * 1024);
    assert.equal(out.flash_passes, true);
    assert.ok(out.blur_regions >= 1, "the curator mask became blur regions");
    // ffmpeg was spawned per step with clip-pipeline's argv (no shell), blur graph included the mask
    const blurCmd = media.commands.find((c) => c.args.includes("-filter_complex"))!;
    const graph = blurCmd.args[blurCmd.args.indexOf("-filter_complex") + 1]!;
    assert.match(graph, /crop=\d+:\d+:\d+:\d+,gblur=sigma=\d+/);
    assert.ok(media.commands.every((c) => c.file === "ffmpeg" || c.file === "ffprobe"));
  });

  it("FAULT_INJECTION_CLIP_BLUR=once fails the first blur attempt; the retry succeeds (demo)", async () => {
    const { store, sdk, tasks } = setup({ env: { FAULT_INJECTION_CLIP_BLUR: "once" } });
    const attempts: Attempt[] = [];
    const ctx = retryingCtx(sdk.registered, attempts, "trn-root-demo");
    await tasks.clipIngest.func(ctx, JOB);
    const blur = attempts.filter((a) => a.name === "clip_ingest_blur");
    assert.deepEqual(
      blur.map((a) => a.ok),
      [false, true],
    );
    assert.match(blur[0]!.error!, /FAULT_INJECTION_CLIP_BLUR=once/);
    assert.ok(store.has("ingest", faultMarkerKey("JMU-0012", 3, "trn-root-demo")));
    // without Render's retry the run fails with the injected fault
    const plain = setup({ env: { FAULT_INJECTION_CLIP_BLUR: "once" } });
    await assert.rejects(plain.tasks.clipIngest.func(fakeCtx(), JOB), InjectedFault);
  });

  it("continues without proposals when propose_windows fails (continueOnFailure)", async () => {
    const { api, sdk, tasks } = setup({
      replies: { "clip.propose_windows": () => ({ status: 422, body: { title: "unknown step" } }) },
    });
    const out = await tasks.clipIngest.func(retryingCtx(sdk.registered), JOB);
    assert.equal(out.proposals.ok, false);
    assert.match(out.proposals.error!, /422/);
    const review = api.args("clip.open_review")[0]!;
    assert.equal(review["proposals"], null);
    assert.match(String(review["proposals_error"]), /422/);
  });

  it("rejects a missing or unusable raw upload without retrying", async () => {
    const missing = setup({ noRaw: true });
    await assert.rejects(
      missing.tasks.clipIngest.func(retryingCtx(missing.sdk.registered), JOB),
      /not found/,
    );
    const portrait = setup({ media: { portraitRaw: true } });
    const attempts: Attempt[] = [];
    await assert.rejects(
      portrait.tasks.clipIngest.func(retryingCtx(portrait.sdk.registered, attempts), JOB),
      /raw upload rejected: portrait/,
    );
    assert.equal(
      attempts.filter((a) => a.name === "clip_ingest_transcode").length,
      1,
      "a NonRetryableError is not retried",
    );
  });

  it("retries a failed ffmpeg run within the step's retry budget", async () => {
    let failures = 1;
    const { sdk, tasks } = setup({
      media: { failOn: (c) => c.args.includes("-filter_complex") && failures-- > 0 },
    });
    const attempts: Attempt[] = [];
    await tasks.clipIngest.func(retryingCtx(sdk.registered, attempts), JOB);
    assert.deepEqual(
      attempts.filter((a) => a.name === "clip_ingest_blur").map((a) => a.ok),
      [false, true],
    );
  });

  it("flags a flashing clip but still opens the review", async () => {
    const flashes = Array.from({ length: 40 }, (_, i) => 300 + i * 2);
    const { api, sdk, tasks } = setup({ media: { flashFrames: flashes } });
    const out = await tasks.clipIngest.func(retryingCtx(sdk.registered), JOB);
    assert.equal(out.flash_passes, false);
    assert.equal((api.args("clip.open_review")[0]!["flash"] as { passes: boolean }).passes, false);
  });

  it("carries the round into every key, merges job and clip.get masks, and validates the job", async () => {
    const { api, store, sdk, tasks } = setup();
    await tasks.clipIngest.func(retryingCtx(sdk.registered), {
      ...JOB,
      round: 2,
      manual_masks: [{ ...MASK, from_frame: 300, to_frame: 310 }],
    });
    assert.ok(
      api.keys().every((k) => k?.endsWith(":r2")),
      api.keys().join(" "),
    );
    const regions = JSON.parse(store.text("ingest", "private/JMU-0012/v3/blur-regions.json")!) as {
      regions: { fromFrame: number }[];
    };
    assert.ok(
      regions.regions.some((r) => r.fromFrame >= 290) &&
        regions.regions.some((r) => r.fromFrame < 100),
      "both masks blurred",
    );
    await assert.rejects(
      tasks.clipIngest.func(fakeCtx(), { clip_id: "clip_abc", version: 3 }),
      NonRetryableError,
    );
    await assert.rejects(
      tasks.clipIngest.func(fakeCtx(), { clip_id: "JMU-0012", version: 0 }),
      NonRetryableError,
    );
    await assert.rejects(
      tasks.clipIngest.func(fakeCtx(), {
        ...JOB,
        manual_masks: [{ box: { x: 0.95, y: 0, w: 0.2, h: 0.1 }, from_frame: 0, to_frame: 1 }],
      }),
      /manual mask 0 is invalid/,
    );
  });

  it("uses FFMPEG_PATH and its sibling ffprobe", async () => {
    const ff = join("C:", "tools", "ffmpeg", "bin", "ffmpeg.exe");
    const { media, sdk, tasks } = setup({ env: { FFMPEG_PATH: ff } });
    await tasks.clipIngest.func(retryingCtx(sdk.registered), JOB);
    const files = new Set(media.commands.map((c) => c.file));
    assert.deepEqual(
      [...files].sort(),
      [ff, join("C:", "tools", "ffmpeg", "bin", "ffprobe.exe")].sort(),
    );
  });
});

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe("clip_ingest with the real ffmpeg (smoke)", {
  skip: hasFfmpeg ? false : "ffmpeg/ffprobe not installed",
}, () => {
  const dir = hasFfmpeg ? mkdtempSync(join(tmpdir(), "md-clip-smoke-")) : "";
  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("raw with audio + location tag → blurred, stripped, conforming 360p/480p in private staging", {
    timeout: 180_000,
  }, async () => {
    const raw = join(dir, "raw.mp4");
    const gen = spawnSync(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=25:duration=21",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=21",
        "-metadata",
        "location=+32.7266+074.8570/",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        raw,
      ],
      { encoding: "utf8" },
    );
    assert.equal(gen.status, 0, gen.stderr);
    const api = fakeClipApi(goReplies());
    const store = new MemoryObjectStore();
    await store.put("ingest", RAW_KEY, readFileSync(raw), "video/mp4");
    const sdk = fakeSdk();
    const tasks = defineTasks(sdk.define, {
      env: ENV,
      fetch: api.fetch,
      log: () => {},
      store: () => store,
      runCommand,
    });
    const out = await tasks.clipIngest.func(retryingCtx(sdk.registered), JOB);
    assert.equal(out.flash_passes, true);
    assert.ok(out.blur_regions >= 1);
    for (const m of out.media) {
      const p = join(dir, `check-${m.res}.mp4`);
      writeFileSync(p, (await store.get("ingest", m.key))!);
      const probe = spawnSync(
        "ffprobe",
        ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", p],
        { encoding: "utf8" },
      );
      const j = JSON.parse(probe.stdout) as {
        streams: { codec_type: string; height?: number }[];
        format: { tags?: Record<string, string> };
      };
      assert.deepEqual(
        j.streams.map((s) => s.codec_type),
        ["video"],
        "audio stripped",
      );
      assert.equal(j.streams[0]!.height, m.res === "360p" ? 360 : 480);
      assert.equal(j.format.tags?.["location"], undefined, "location tag stripped");
    }
    assert.equal(store.puts.filter((p) => p.startsWith("clips:")).length, 0);
  });
});
