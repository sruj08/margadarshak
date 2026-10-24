// clip_generate (ADR-0013) with a fake @google/genai client, a fake ffmpeg/ffprobe, a fake Go API
// and an in-memory object store. The real Gemini API is never called here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  CLIP_GENERATE_STEPS,
  GUARDRAILS,
  generatedObjectKey,
  guardrailBlock,
  SceneSpecSchema,
  TASK_LIMITS,
} from "@margdarshak/clip-pipeline";
import { NonRetryableError } from "../src/lib/api.ts";
import {
  type CreateVideoParams,
  type GenFile,
  type GenInteraction,
  isRetryableGenError,
  redactedError,
  type VideoGenClient,
  withGenRetry,
} from "../src/lib/genai.ts";
import {
  DEFAULT_SCENES_PATH,
  findScene,
  normaliseGenerateJob,
  TASK_CLIP_GENERATE,
} from "../src/tasks/clip-generate.ts";
import { stagedKey } from "../src/tasks/clip-media.ts";
import { defineTasks } from "../src/tasks/index.ts";
import { MemoryObjectStore } from "./clip-fakes.ts";
import { type Attempt, fakeClipApi, fakeMedia, retryingCtx } from "./clip-harness.ts";
import { ENV, fakeSdk, testConfig } from "./helpers.ts";

/** The generation month comes from the clock (the API client's clock too, so no fake here). */
const MONTH = new Date().toISOString().slice(0, 7);
const FAKE_KEY = "AIzaSyTESTKEY-0123456789abcdefghijklmnop";
const JOB = { sceneId: "SCN-001", version: 1, batchId: "b20261024a" };
/** SCN-001 has four shots; the model makes them 8.2, 6.4, 7.8 and 7.9 s long. */
const DURATIONS = {
  "turn-1.mp4": 8.2,
  "turn-2.mp4": 14.6,
  "turn-3.mp4": 22.4,
  "turn-4.mp4": 30.3,
  "resume.mp4": 30.3,
  "source.mp4": 30.3,
  "normalised.mp4": 30.3,
};

type Failure = { status?: number; message: string; name?: string };

/** A fake VideoGenClient: interactions finish after one poll, files become ACTIVE after one poll. */
function fakeVideo(
  opts: {
    failOnCreate?: (callIndex: number, p: CreateVideoParams) => Failure | null;
    status?: (turn: number) => string;
    inline?: boolean;
    noVideo?: boolean;
  } = {},
) {
  const creates: CreateVideoParams[] = [];
  const polls: string[] = [];
  const downloads: string[] = [];
  let seq = 0;
  const turnOf = new Map<string, number>();
  const client: VideoGenClient = {
    async createInteraction(p) {
      const i = creates.length;
      creates.push(p);
      const f = opts.failOnCreate?.(i, p);
      if (f) throw Object.assign(new Error(f.message), f.status ? { status: f.status } : {}, f.name ? { name: f.name } : {});
      const turn = p.previous_interaction_id ? (turnOf.get(p.previous_interaction_id) ?? 0) + 1 : 1;
      const id = `int-${++seq}`;
      turnOf.set(id, turn);
      return { id, status: "in_progress" };
    },
    async getInteraction(id): Promise<GenInteraction> {
      polls.push(id);
      const turn = turnOf.get(id) ?? 0;
      const status = opts.status?.(turn) ?? "completed";
      if (opts.noVideo) return { id, status };
      return {
        id,
        status,
        output_video: opts.inline
          ? { data: Buffer.from(`inline video ${id}`).toString("base64"), mime_type: "video/mp4" }
          : { uri: `https://generativelanguage.googleapis.com/v1beta/files/vid${id.replace("int-", "")}:download?alt=media`, mime_type: "video/mp4" },
      };
    },
    async getFile(name): Promise<GenFile> {
      const n = polls.filter((p) => p === `file:${name}`).length;
      polls.push(`file:${name}`);
      return { name, state: n === 0 ? "PROCESSING" : "ACTIVE", uri: `https://x/${name}` };
    },
    async downloadFile(file, path) {
      downloads.push(file.name ?? "");
      await writeFile(path, `video bytes of ${file.name}`);
    },
  };
  return { client, creates, polls, downloads };
}

function goReplies() {
  return {
    "clip.register_generated": () => ({ status: 200, body: { clip_id: "AIG-0001", version: 1 } }),
    "clip.propose_windows": () => ({ status: 200, body: { status: "stub" } }),
    "clip.open_review": () => ({ status: 200, body: { status: "proposed" } }),
  };
}

function setup(
  opts: {
    video?: ReturnType<typeof fakeVideo>;
    media?: Parameters<typeof fakeMedia>[0];
    store?: MemoryObjectStore;
    env?: Record<string, string>;
    noClient?: boolean;
  } = {},
) {
  const api = fakeClipApi(goReplies());
  const store = opts.store ?? new MemoryObjectStore();
  const media = fakeMedia({ durations: DURATIONS, ...opts.media });
  const video = opts.video ?? fakeVideo();
  const sleeps: number[] = [];
  const logs: { msg: string; attrs: Record<string, unknown> }[] = [];
  const sdk = fakeSdk();
  const tasks = defineTasks(sdk.define, {
    env: { ...ENV, GEMINI_API_KEY: FAKE_KEY, ...opts.env },
    fetch: api.fetch,
    sleep: async (ms) => void sleeps.push(ms),
    log: (msg, attrs) => void logs.push({ msg, attrs }),
    store: () => store,
    runCommand: media.run,
    ...(opts.noClient ? {} : { videoClient: () => video.client }),
  });
  return { api, store, media, video, sleeps, logs, sdk, tasks };
}

const run = (s: ReturnType<typeof setup>, attempts: Attempt[] = [], job: unknown = JOB) =>
  s.tasks.clipGenerate.func(retryingCtx(s.sdk.registered, attempts), job);

describe("clip_generate registration", () => {
  it("registers the parent with TASK_LIMITS and one subtask per CLIP_GENERATE_STEPS entry", () => {
    const { sdk } = setup();
    assert.deepEqual(sdk.registered.get(TASK_CLIP_GENERATE), {
      name: "clip_generate",
      retry: TASK_LIMITS.clip_generate.retry,
      timeoutSeconds: TASK_LIMITS.clip_generate.timeoutSeconds,
    });
    for (const s of CLIP_GENERATE_STEPS) {
      assert.deepEqual(sdk.registered.get(`clip_generate_${s.id}`), {
        name: `clip_generate_${s.id}`,
        retry: s.retry,
        timeoutSeconds: s.timeoutSeconds,
      });
    }
  });
});

describe("clip_generate (ADR-0013)", () => {
  it("generates, normalises, registers, then runs the ingest flow from transcode without blur", async () => {
    const s = setup();
    const attempts: Attempt[] = [];
    const out = await run(s, attempts);
    assert.deepEqual(
      attempts.map((a) => a.name),
      [
        "clip_generate_generate",
        "clip_generate_precheck",
        "clip_generate_register",
        "clip_ingest_transcode",
        "clip_generate_render",
        "clip_ingest_flash_check",
        "clip_ingest_propose_windows",
        "clip_ingest_open_review",
      ],
    );
    assert.ok(!attempts.some((a) => a.name === "clip_ingest_blur"), "AI clips skip blur");
    assert.deepEqual(s.api.names(), ["clip.register_generated", "clip.propose_windows", "clip.open_review"]);
    assert.deepEqual(s.api.keys(), [
      "SCN-001:1:b20261024a:register",
      "AIG-0001:propose_windows:1",
      "AIG-0001:open_review:1",
    ]);
    assert.equal(out.clip_id, "AIG-0001");
    assert.equal(out.extensions, 3);
    assert.equal(out.flash_passes, true);
    assert.equal(out.cached_generation, false);
  });

  it("calls the model once per shot, chaining extensions, 720p 16:9, guardrails in every prompt", async () => {
    const s = setup();
    await run(s);
    const c = s.video.creates;
    assert.equal(c.length, 4);
    assert.equal(c[0]?.previous_interaction_id, undefined);
    assert.deepEqual(
      c.slice(1).map((x) => x.previous_interaction_id),
      ["int-1", "int-2", "int-3"],
    );
    for (const p of c) {
      assert.equal(p.model, "gemini-omni-1.1-flash");
      assert.deepEqual(p.response_format, { type: "video", aspect_ratio: "16:9", resolution: "720p", delivery: "uri" });
      assert.ok(p.input.endsWith(guardrailBlock()), "guardrails close every prompt");
      for (const g of GUARDRAILS) assert.ok(p.input.includes(g));
    }
    assert.match(c[0]?.input ?? "", /fictional, AI-generated Indian road scene/);
    assert.match(c[1]?.input ?? "", /^Extend the previous video/);
    assert.equal(s.video.downloads.length, 4, "each turn polled to ACTIVE and downloaded");
  });

  it("uses GEMINI_MODEL_VIDEO_GEN when set", async () => {
    const s = setup({ env: { GEMINI_MODEL_VIDEO_GEN: "gemini-omni-flash-preview" } });
    await run(s);
    assert.ok(s.video.creates.every((p) => p.model === "gemini-omni-flash-preview"));
  });

  it("registers an ai_generated clip with its generation record and an approximate onset hint", async () => {
    const s = setup();
    await run(s);
    const args = s.api.args("clip.register_generated")[0] as Record<string, any>;
    assert.equal(args["raw_key"], generatedObjectKey("SCN-001", 1, "b20261024a", "normalised.mp4"));
    assert.deepEqual(args["generation"], {
      model: "gemini-omni-1.1-flash",
      sceneId: "SCN-001",
      promptVersion: "1.0.0",
      seedOrBatchId: "b20261024a",
      generatedAt: MONTH,
      durationMs: 30300,
      extensions: 3,
      synthId: true,
      disclosure: "ai_generated",
    });
    // Hazard shot 3 starts where turn 2 ended (14.6 s); its cue is 2 s in.
    assert.deepEqual(args["onset_hint"], {
      approxOnsetMs: 16600,
      toleranceMs: 3000,
      authoritative: false,
      basis: "measured",
    });
    assert.equal(args["facts"].origin, "ai_generated");
    assert.equal(args["facts"].speedSource, "scene_spec");
    assert.equal(args["facts"].speedKmhEst, 30);
    assert.equal(args["facts"].capturedMonth, MONTH);
    const body = s.api.steps[0]?.body ?? "";
    assert.ok(Buffer.byteLength(body) < 16 * 1024);
    for (const g of GUARDRAILS) assert.ok(!body.includes(g), "no prompt text goes to the API");
  });

  it("normalises with the clip-pipeline transcode and strip-metadata argv, and never writes public media", async () => {
    const s = setup();
    const out = await run(s);
    const argv = s.media.commands.map((c) => c.args.join(" "));
    assert.ok(argv.some((a) => /-map 0:v:0 .*fps=30.*-map_metadata -1/.test(a) && /normalise|mezzanine\.mp4$/.test(a)), "mezzanine argv");
    assert.ok(argv.some((a) => /mezzanine\.mp4 -map 0:v:0 -c copy .*normalised\.mp4$/.test(a)), "strip remux");
    assert.ok(!argv.some((a) => /gblur/.test(a)), "no blur pass");
    for (const n of ["360p.mp4", "480p.mp4", "poster.jpg"] as const)
      assert.ok(s.store.has("ingest", stagedKey("AIG-0001", 1, n)), n);
    assert.equal(s.store.puts.filter((p) => p.startsWith("clips:")).length, 0);
    const review = s.api.args("clip.open_review")[0] as Record<string, any>;
    assert.equal(review["origin"], "ai_generated");
    assert.equal(review["blur"].regions, 0);
    assert.deepEqual(
      review["media"].map((m: { res: string }) => m.res),
      ["360p", "480p"],
    );
    assert.equal(out.media.length, 2);
  });

  it("never logs the key or a prompt, and the key is not enumerable on the config", async () => {
    const s = setup();
    await run(s);
    const text = JSON.stringify(s.logs);
    assert.ok(!text.includes(FAKE_KEY));
    for (const g of GUARDRAILS) assert.ok(!text.includes(g));
    assert.ok(s.logs.some((l) => l.msg === "clip_generate turn"));
    const cfg = testConfig({ GEMINI_API_KEY: FAKE_KEY });
    assert.equal(cfg.geminiApiKey, FAKE_KEY);
    assert.ok(!JSON.stringify(cfg).includes(FAKE_KEY));
    assert.ok(!Object.keys(cfg).includes("geminiApiKey"));
    assert.equal(testConfig().geminiVideoModel, "gemini-omni-1.1-flash");
    assert.throws(() => testConfig({ GEMINI_MODEL_VIDEO_GEN: "Bad Model!" }), /GEMINI_MODEL_VIDEO_GEN/);
  });

  it("is idempotent per sceneId:version:batchId: a re-run pays for no second generation", async () => {
    const store = new MemoryObjectStore();
    const first = setup({ store });
    await run(first);
    const second = setup({ store });
    const out = await run(second);
    assert.equal(second.video.creates.length, 0, "no model call on a re-run");
    assert.equal(out.cached_generation, true);
    assert.deepEqual(second.api.keys()[0], first.api.keys()[0], "same register key, the API dedupes");
  });

  it("retries 429 and 5xx with backoff inside the step", async () => {
    const video = fakeVideo({
      failOnCreate: (i) => (i === 2 ? { status: 429, message: "Resource exhausted" } : i === 3 ? { status: 503, message: "Unavailable" } : null),
    });
    const s = setup({ video });
    const out = await run(s);
    assert.equal(out.extensions, 3);
    assert.equal(video.creates.length, 6);
    assert.ok(s.sleeps.includes(5000) && s.sleeps.includes(10000), `backoff ${s.sleeps}`);
  });

  it("resumes from the checkpoint when the step itself is retried (no repeat of finished turns)", async () => {
    // Turn 3 fails five times (the in-step retries run out), then works on the subtask retry.
    const video = fakeVideo({
      failOnCreate: (i) => (i >= 2 && i <= 6 ? { status: 503, message: "Unavailable" } : null),
    });
    const s = setup({ video });
    const attempts: Attempt[] = [];
    const out = await run(s, attempts);
    const gen = attempts.filter((a) => a.name === "clip_generate_generate");
    assert.deepEqual(gen.map((a) => a.ok), [false, true]);
    assert.equal(video.creates.filter((p) => p.previous_interaction_id === undefined).length, 1, "turn 1 made once");
    assert.equal(video.creates.at(-2)?.previous_interaction_id, "int-2", "turn 3 continues from turn 2");
    assert.equal(out.extensions, 3);
  });

  it("does not retry a safety block or bad request, and registers nothing", async () => {
    const video = fakeVideo({ failOnCreate: (i) => (i === 1 ? { status: 400, message: "prompt blocked" } : null) });
    const s = setup({ video });
    const attempts: Attempt[] = [];
    await assert.rejects(run(s, attempts), (e: Error) => e.name === "NonRetryableError" && /HTTP 400/.test(e.message));
    assert.equal(attempts.filter((a) => a.name === "clip_generate_generate").length, 1);
    assert.deepEqual(s.api.names(), []);
  });

  it("stops on a failed interaction or a completed one without video", async () => {
    const failed = setup({ video: fakeVideo({ status: (t) => (t === 2 ? "failed" : "completed") }) });
    await assert.rejects(run(failed), /turn 2: generation failed/);
    const empty = setup({ video: fakeVideo({ noVideo: true }) });
    await assert.rejects(run(empty), /without a video/);
    assert.deepEqual(failed.api.names(), []);
  });

  it("accepts inline base64 video too", async () => {
    const s = setup({ video: fakeVideo({ inline: true }) });
    const out = await run(s);
    assert.equal(s.video.downloads.length, 0);
    assert.equal(out.clip_id, "AIG-0001");
  });

  it("refuses an extension output that is not the whole video so far", async () => {
    const s = setup({ media: { durations: { ...DURATIONS, "turn-2.mp4": 6.4 } } });
    await assert.rejects(run(s), /not the whole video so far/);
  });

  it("does not register a clip that fails the WCAG flash check", async () => {
    const flashes = Array.from({ length: 30 }, (_, i) => i + 100);
    const s = setup({ media: { flashFrames: flashes } });
    await assert.rejects(run(s), /flash check failed/);
    assert.deepEqual(s.api.names(), []);
  });

  it("refuses bad input, an unknown scene, a stale revision and a missing key", async () => {
    assert.throws(() => normaliseGenerateJob([{ sceneId: "SCN-1", version: 1, batchId: "b" }]), /sceneId/);
    assert.throws(() => normaliseGenerateJob([{ sceneId: "SCN-001", version: 0, batchId: "b" }]), /version/);
    assert.throws(() => normaliseGenerateJob([{ sceneId: "SCN-001", version: 1, batchId: "../x" }]), /batchId/);
    assert.deepEqual(normaliseGenerateJob([{ scene_id: "SCN-001", version: 1, batch_id: "b1" }]), {
      scene_id: "SCN-001",
      version: 1,
      batch_id: "b1",
    });
    await assert.rejects(run(setup(), [], { ...JOB, sceneId: "SCN-999" }), /no scene SCN-999/);
    await assert.rejects(run(setup(), [], { ...JOB, version: 2 }), /revision 1, job asked for 2/);
    const noKey = setup({ noClient: true, env: { GEMINI_API_KEY: "" } });
    await assert.rejects(run(noKey), /GEMINI_API_KEY is not set/);
  });
});

describe("model-call retry policy", () => {
  it("classifies errors: 429/5xx/network retry, other 4xx do not", () => {
    assert.ok(isRetryableGenError(Object.assign(new Error("x"), { status: 429 })));
    assert.ok(isRetryableGenError(Object.assign(new Error("x"), { status: 500 })));
    assert.ok(isRetryableGenError(new TypeError("fetch failed")));
    assert.ok(!isRetryableGenError(Object.assign(new Error("x"), { status: 400 })));
    assert.ok(!isRetryableGenError(Object.assign(new Error("x"), { status: 403 })));
  });

  it("redacts keys from error text", () => {
    const e = Object.assign(new Error(`bad request for key=${FAKE_KEY} ${FAKE_KEY}`), { status: 400 });
    const t = redactedError(e);
    assert.ok(!t.includes(FAKE_KEY), t);
    assert.match(t, /^HTTP 400/);
  });

  it("gives up after the policy's attempts with a retryable error", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await assert.rejects(
      withGenRetry(
        "t",
        async () => {
          n++;
          throw Object.assign(new Error("busy"), { status: 503 });
        },
        { sleep: async (ms) => void sleeps.push(ms), policy: { attempts: 3, baseDelayMs: 100, factor: 2, maxDelayMs: 150 } },
      ),
      (e: Error) => !(e instanceof NonRetryableError) && /after 3 attempts/.test(e.message),
    );
    assert.equal(n, 3);
    assert.deepEqual(sleeps, [100, 150]);
  });
});

describe("content/nazar/scenes.json is usable by the generator", () => {
  it("every scene passes the generator's contract and can be found by its revision", () => {
    const doc = JSON.parse(readFileSync(DEFAULT_SCENES_PATH, "utf8")) as { scenes: { sceneId: string; revision: number }[] };
    assert.ok(doc.scenes.length >= 28);
    for (const raw of doc.scenes) {
      assert.ok(SceneSpecSchema.safeParse(raw).success, raw.sceneId);
      const s = findScene(doc.scenes, { scene_id: raw.sceneId, version: raw.revision, batch_id: "b1" });
      assert.equal(s.sceneId, raw.sceneId);
    }
  });
});
