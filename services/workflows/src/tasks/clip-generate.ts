// clip_generate (ADR-0013; clip-pipeline CLIP_GENERATE_STEPS / CLIP_GENERATE_FLOW). Started by the
// Go API (curator "Generate clip", API op in the Go agent's hands) as `<WORKFLOW_SLUG>/clip_generate`
// with `[{sceneId, version, batchId}]` (snake_case also accepted). One scene revision + batch = one
// AI-generated clip:
//
//   ctx.run clip_generate_generate     scene → opening shot + extension turns (@google/genai, 720p 16:9)
//                                      → poll → download → generated/<scene>/v<n>/<batch>/source.mp4
//   ctx.run clip_generate_precheck     ffmpeg normalise (mezzanine argv: 30 fps CFR, no audio, no
//                                      metadata) → strip-metadata remux → 480p check → WCAG flash
//                                      check → normalised.mp4 (private ingest bucket)
//   ctx.run clip_generate_register     Go clip.register_generated: a new clip, origin ai_generated,
//                                      its generation record and an APPROXIMATE onset hint for raters
//   ctx.run clip_ingest_transcode      the existing ingest flow from transcode (mezzanine)
//   ctx.run clip_generate_render       360p/480p + poster to private staging (no blur: nothing real)
//   ctx.run clip_ingest_flash_check    on the staged 480p
//   ctx.run clip_ingest_propose_windows  (optional, as in clip_ingest)
//   ctx.run clip_ingest_open_review    Go moves the clip transcoded → proposed; two raters follow
//
// Idempotent per sceneId:version:batchId: progress (turn interaction IDs and durations) is
// checkpointed in generation.json, a finished generation is never paid for twice, and the Go
// register step dedupes on `sceneId:version:batchId:register`. Model calls retry on 429/5xx
// (withGenRetry), then the subtask retry (CLIP_GENERATE_STEPS) takes over. Prompts and the key are
// never logged; logs carry the scene, turn numbers and durations only.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  approximateOnsetHint,
  BATCH_ID_RE,
  buildLumaGridArgv,
  buildMezzanineArgv,
  buildShotPrompts,
  buildStripMetadataArgv,
  buildTranscodeArgv,
  CLIP_GENERATE_STEPS,
  CLIP_GENERATOR_PROMPT,
  checkDeliveryRendition,
  checkRawUpload,
  type FlashCheckResult,
  findPrivacyMetadata,
  flashCheckFromLuma,
  GENERATION_LIMITS,
  generatedObjectKey,
  generationIdempotencyKey,
  generationRecord,
  type OnsetHint,
  parseLumaGrid,
  RENDITIONS,
  type Rendition,
  SCENE_ID_RE,
  type SceneSpec,
  SceneSpecSchema,
  sceneClipFacts,
  TASK_LIMITS,
} from "@margdarshak/clip-pipeline";
import { NonRetryableError } from "../lib/api.ts";
import {
  type GenFile,
  type GenInteraction,
  sdkVideoClient,
  type VideoGenClient,
  type VideoResponseFormat,
  withGenRetry,
} from "../lib/genai.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";
import {
  type ClipDeps,
  commandTimeoutMs,
  defineStep,
  type OptionalOutcome,
  type ResolvedClipDeps,
  resolveClipDeps,
  runOptional,
  stepById,
  withTempDir,
} from "./clip-common.ts";
import {
  type ClipIngestTasks,
  download,
  type MediaOut,
  probe,
  stagePoster,
  stageRenditions,
  type TranscodeOutput,
} from "./clip-ingest.ts";
import { binaries, mustRun } from "./clip-media.ts";

export const TASK_CLIP_GENERATE = "clip_generate";
export const STEP_REGISTER_GENERATED = "clip.register_generated";

const STEP = {
  generate: stepById(CLIP_GENERATE_STEPS, "generate"),
  precheck: stepById(CLIP_GENERATE_STEPS, "precheck"),
  register: stepById(CLIP_GENERATE_STEPS, "register"),
  render: stepById(CLIP_GENERATE_STEPS, "render"),
} as const;

/** 720p so both deliveries are downscales; `uri` because a 40 s 720p video is well over 4 MB. */
export const VIDEO_FORMAT: VideoResponseFormat = {
  type: "video",
  aspect_ratio: GENERATION_LIMITS.aspectRatio,
  resolution: GENERATION_LIMITS.resolution,
  delivery: "uri",
};

/** Polling the interaction and the Files API: every 10 s, at most 15 min per turn. */
export const POLL = { intervalMs: 10_000, maxPolls: 90 } as const;

// ---- inputs and outputs ---------------------------------------------------------------------

export interface GenerateJob {
  readonly scene_id: string;
  /** The scene's revision in content/nazar/scenes.json (a mismatch is refused). */
  readonly version: number;
  readonly batch_id: string;
}

export interface GenerateOutput extends GenerateJob {
  readonly source_key: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly model: string;
  readonly prompt_version: string;
  /** YYYY-MM, fixed at the first attempt (re-runs keep it). */
  readonly generated_at: string;
  /** Duration of the video after each turn (ms); the last one is the clip's length. */
  readonly turn_ends_ms: readonly number[];
  readonly extensions: number;
  readonly cached: boolean;
}

export interface PrecheckOutput extends GenerateJob {
  readonly normalised_key: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly duration_ms: number;
  readonly width: number;
  readonly height: number;
  readonly flash: FlashCheckResult;
}

export interface RegisterInput extends GenerateJob {
  readonly generated: GenerateOutput;
  readonly precheck: PrecheckOutput;
}

export interface RegisterOutput {
  readonly clip_id: string;
  readonly version: number;
}

export interface RenderInput {
  readonly clip_id: string;
  readonly version: number;
  readonly round: number | null;
  readonly mezzanine: TranscodeOutput;
}

export interface RenderOutput {
  readonly media: readonly MediaOut[];
  readonly poster_key: string;
}

export interface ClipGenerateSummary extends GenerateJob {
  readonly clip_id: string;
  readonly clip_version: number;
  readonly source_key: string;
  readonly normalised_key: string;
  readonly duration_ms: number;
  readonly extensions: number;
  readonly onset_hint: OnsetHint | null;
  readonly flash_passes: boolean;
  readonly media: readonly MediaOut[];
  readonly proposals: OptionalOutcome<unknown>;
  readonly review: unknown;
  readonly cached_generation: boolean;
}

export interface ClipGenerateTasks {
  readonly clipGenerate: TaskDef<unknown[], ClipGenerateSummary>;
  readonly clipGenerateSteps: {
    readonly generate: TaskDef<[GenerateJob], GenerateOutput>;
    readonly precheck: TaskDef<[GenerateOutput], PrecheckOutput>;
    readonly register: TaskDef<[RegisterInput], RegisterOutput>;
    readonly render: TaskDef<[RenderInput], RenderOutput>;
  };
}

export interface ClipGenerateDeps extends ClipDeps {
  /** The video model client (the @google/genai SDK with GEMINI_API_KEY by default). */
  readonly videoClient?: () => VideoGenClient | Promise<VideoGenClient>;
  /** Scene catalogue loader (content/nazar/scenes.json by default). */
  readonly scenes?: () => Promise<readonly unknown[]>;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Epoch ms (Date.now by default); only the generation month is taken from it. */
  readonly now?: () => number;
}

// ---- job input and scenes ---------------------------------------------------------------------

export function normaliseGenerateJob(args: readonly unknown[]): GenerateJob {
  const first = args[0];
  const o =
    first !== null && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : {};
  const bad = (msg: string): never => {
    throw new NonRetryableError("clip.generate", msg, undefined, 0);
  };
  const scene = o["sceneId"] ?? o["scene_id"];
  const version = o["version"];
  const batch = o["batchId"] ?? o["batch_id"];
  if (typeof scene !== "string" || !SCENE_ID_RE.test(scene)) bad(`bad sceneId ${JSON.stringify(scene)}`);
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    bad(`bad version ${JSON.stringify(version)}`);
  if (typeof batch !== "string" || !BATCH_ID_RE.test(batch)) bad(`bad batchId ${JSON.stringify(batch)}`);
  return { scene_id: scene as string, version: version as number, batch_id: batch as string };
}

/** The repo's content/nazar/scenes.json (src/tasks and dist/tasks sit at the same depth). */
export const DEFAULT_SCENES_PATH = fileURLToPath(
  new URL("../../../../content/nazar/scenes.json", import.meta.url),
);

async function readScenes(path: string): Promise<readonly unknown[]> {
  const doc = JSON.parse(await readFile(path, "utf8")) as { promptVersion?: unknown; scenes?: unknown };
  if (doc.promptVersion !== CLIP_GENERATOR_PROMPT.version) {
    throw new NonRetryableError(
      "clip.generate",
      `scenes.json promptVersion ${String(doc.promptVersion)} != ${CLIP_GENERATOR_PROMPT.version}`,
      undefined,
      0,
    );
  }
  if (!Array.isArray(doc.scenes)) throw new NonRetryableError("clip.generate", "scenes.json has no scenes", undefined, 0);
  return doc.scenes;
}

/** The scene for a job, validated with the generator's contract; its revision must match. */
export function findScene(scenes: readonly unknown[], job: GenerateJob): SceneSpec {
  const raw = scenes.find((s) => (s as { sceneId?: unknown } | null)?.sceneId === job.scene_id);
  if (!raw) throw new NonRetryableError("clip.generate", `no scene ${job.scene_id}`, undefined, 0);
  const parsed = SceneSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => i.message).join("; ").slice(0, 300);
    throw new NonRetryableError("clip.generate", `scene ${job.scene_id} is invalid: ${why}`, undefined, 0);
  }
  if (parsed.data.revision !== job.version) {
    throw new NonRetryableError(
      "clip.generate",
      `scene ${job.scene_id} is at revision ${parsed.data.revision}, job asked for ${job.version}`,
      undefined,
      0,
    );
  }
  return parsed.data;
}

// ---- generation progress (checkpoint) ---------------------------------------------------------

interface TurnRecord {
  readonly n: number;
  readonly interactionId: string;
  readonly durationMs: number;
}

interface GenerationDoc {
  readonly sceneId: string;
  readonly version: number;
  readonly batchId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly generatedAt: string;
  readonly turns: readonly TurnRecord[];
  readonly complete: boolean;
  readonly sourceSha256?: string;
  readonly sourceBytes?: number;
}

function parseDoc(bytes: Uint8Array | null, job: GenerateJob, model: string): GenerationDoc | null {
  if (!bytes) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(bytes)) as GenerationDoc;
    // A checkpoint from another model or prompt version is not resumed (a fresh, consistent clip).
    if (
      d.sceneId !== job.scene_id ||
      d.version !== job.version ||
      d.batchId !== job.batch_id ||
      d.model !== model ||
      d.promptVersion !== CLIP_GENERATOR_PROMPT.version ||
      !Array.isArray(d.turns)
    )
      return null;
    return d;
  } catch {
    return null;
  }
}

function month(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

const FILE_NAME = /files\/[A-Za-z0-9_-]+/;
const DONE = new Set(["completed"]);
const FAILED = new Set(["failed", "cancelled", "budget_exceeded", "requires_action", "incomplete"]);

function fileState(f: GenFile): string {
  if (typeof f.state === "string") return f.state;
  return f.state?.name ?? "STATE_UNSPECIFIED";
}

// ---- the task ---------------------------------------------------------------------------------

export function defineClipGenerateTasks(
  define: DefineTask,
  deps: ClipGenerateDeps,
  ingest: ClipIngestTasks["clipIngestSteps"],
): ClipGenerateTasks {
  const d: ResolvedClipDeps = resolveClipDeps(deps);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  let client: Promise<VideoGenClient> | undefined;
  const videoClient = (): Promise<VideoGenClient> => {
    if (deps.videoClient) return Promise.resolve(deps.videoClient());
    client ??= (async () => {
      const key = d.config().geminiApiKey;
      if (!key) throw new NonRetryableError("clip.generate", "GEMINI_API_KEY is not set", undefined, 0);
      return sdkVideoClient(key);
    })();
    return client;
  };
  const scenes = (): Promise<readonly unknown[]> =>
    deps.scenes ? deps.scenes() : readScenes(d.config().nazarScenesPath ?? DEFAULT_SCENES_PATH);
  const retry = <T>(label: string, fn: () => Promise<T>) => withGenRetry(label, fn, { sleep, log: d.log });

  /** Waits until the interaction has finished; a failed or blocked one is not retried. */
  async function settle(c: VideoGenClient, first: GenInteraction, turn: number): Promise<GenInteraction> {
    let it = first;
    for (let i = 0; !DONE.has(it.status); i++) {
      if (FAILED.has(it.status)) {
        throw new NonRetryableError(
          "clip.generate",
          `turn ${turn}: generation ${it.status}${it.error ? ` (${it.error})` : ""}; fix the scene or use a new batchId`,
          undefined,
          0,
        );
      }
      if (i >= POLL.maxPolls) throw new Error(`turn ${turn}: still ${it.status} after ${POLL.maxPolls} polls`);
      await sleep(POLL.intervalMs);
      const id = it.id;
      it = await retry("clip.generate.poll", () => c.getInteraction(id));
    }
    return it;
  }

  /** Writes the turn's video to `path`: inline base64, or a Files API object to poll and download. */
  async function fetchVideo(c: VideoGenClient, it: GenInteraction, path: string, turn: number): Promise<void> {
    const v = it.output_video;
    if (v?.data) {
      await writeFile(path, Buffer.from(v.data, "base64"));
      return;
    }
    const name = v?.uri ? FILE_NAME.exec(v.uri)?.[0] : undefined;
    if (!name) {
      throw new NonRetryableError(
        "clip.generate",
        `turn ${turn}: the interaction completed without a video (a safety filter may have blocked it)`,
        undefined,
        0,
      );
    }
    for (let i = 0; ; i++) {
      const f = await retry("clip.generate.file", () => c.getFile(name));
      const state = fileState(f);
      if (state === "ACTIVE") {
        await retry("clip.generate.download", () => c.downloadFile({ ...f, name: f.name ?? name }, path));
        return;
      }
      if (state === "FAILED") {
        throw new NonRetryableError(
          "clip.generate",
          `turn ${turn}: video file failed${f.error?.message ? ` (${f.error.message.slice(0, 120)})` : ""}`,
          undefined,
          0,
        );
      }
      if (i >= POLL.maxPolls) throw new Error(`turn ${turn}: video file still ${state} after ${POLL.maxPolls} polls`);
      await sleep(POLL.intervalMs);
    }
  }

  const generate = defineStep(define, STEP.generate, async (ctx, job: GenerateJob): Promise<GenerateOutput> => {
    const cfg = d.config();
    const model = cfg.geminiVideoModel;
    const scene = findScene(await scenes(), job);
    const key = (name: Parameters<typeof generatedObjectKey>[3]) =>
      generatedObjectKey(job.scene_id, job.version, job.batch_id, name);
    const store = d.store();
    let doc =
      parseDoc(await store.get("ingest", key("generation.json")), job, model) ??
      ({
        sceneId: job.scene_id,
        version: job.version,
        batchId: job.batch_id,
        model,
        promptVersion: CLIP_GENERATOR_PROMPT.version,
        generatedAt: month(now()),
        turns: [],
        complete: false,
      } satisfies GenerationDoc);
    const output = (cached: boolean, sha256: string, bytes: number): GenerateOutput => ({
      ...job,
      source_key: key("source.mp4"),
      bytes,
      sha256,
      model,
      prompt_version: doc.promptVersion,
      generated_at: doc.generatedAt,
      turn_ends_ms: doc.turns.map((t) => t.durationMs),
      extensions: Math.max(0, doc.turns.length - 1),
      cached,
    });
    if (doc.complete && doc.sourceSha256 && doc.sourceBytes && (await store.get("ingest", key("source.mp4")))) {
      d.log("clip_generate: generation already complete", { run_id: ctx.metadata.taskRunId, ...job });
      return output(true, doc.sourceSha256, doc.sourceBytes);
    }
    const prompts = buildShotPrompts(scene);
    const c = await videoClient();
    return withTempDir("md-clip-generate-", async (dir) => {
      const bin = binaries(cfg.ffmpegPath);
      let last: string | null = null;
      const resumeFrom = doc.turns.length;
      for (const p of prompts.slice(resumeFrom)) {
        const prev = doc.turns.at(-1)?.interactionId;
        const created = await retry("clip.generate", () =>
          c.createInteraction({
            model,
            input: p.text,
            ...(prev ? { previous_interaction_id: prev } : {}),
            response_format: VIDEO_FORMAT,
          }),
        );
        const done = await settle(c, created, p.n);
        const path = join(dir, `turn-${p.n}.mp4`);
        await fetchVideo(c, done, path, p.n);
        const pr = await probe(d, bin.ffprobe, path, dir, `generate/probe turn ${p.n}`);
        const ms = pr.durationMs ?? 0;
        const before = doc.turns.at(-1)?.durationMs ?? 0;
        if (ms <= 0) throw new Error(`turn ${p.n}: the downloaded video has no duration`);
        if (p.n > 1 && ms < before + GENERATION_LIMITS.extensionMinS * 1000 - 500) {
          throw new NonRetryableError(
            "clip.generate",
            `turn ${p.n}: the extension output (${ms} ms) is not the whole video so far (${before} ms); segment stitching is not implemented (ADR-0013 open item)`,
            undefined,
            0,
          );
        }
        doc = { ...doc, turns: [...doc.turns, { n: p.n, interactionId: done.id, durationMs: ms }] };
        await store.put(
          "ingest",
          key("generation.json"),
          new TextEncoder().encode(JSON.stringify(doc)),
          "application/json",
        );
        d.log("clip_generate turn", { run_id: ctx.metadata.taskRunId, ...job, turn: p.n, of: prompts.length, duration_ms: ms });
        last = path;
      }
      if (!last) {
        // Every turn was checkpointed but the source upload did not finish: fetch the last turn again.
        const lastTurn = doc.turns.at(-1);
        if (!lastTurn) throw new Error("no turns recorded");
        last = join(dir, "resume.mp4");
        const it = await retry("clip.generate.poll", () => c.getInteraction(lastTurn.interactionId));
        await fetchVideo(c, await settle(c, it, lastTurn.n), last, lastTurn.n);
      }
      const put = await store.put("ingest", key("source.mp4"), await readFile(last), "video/mp4");
      doc = { ...doc, complete: true, sourceSha256: put.sha256, sourceBytes: put.bytes };
      await store.put("ingest", key("generation.json"), new TextEncoder().encode(JSON.stringify(doc)), "application/json");
      return output(false, put.sha256, put.bytes);
    });
  });

  const precheck = defineStep(
    define,
    STEP.precheck,
    (_ctx, g: GenerateOutput): Promise<PrecheckOutput> =>
      withTempDir("md-clip-precheck-", async (dir) => {
        const bin = binaries(d.config().ffmpegPath);
        const job: GenerateJob = { scene_id: g.scene_id, version: g.version, batch_id: g.batch_id };
        const key = (name: Parameters<typeof generatedObjectKey>[3]) =>
          generatedObjectKey(job.scene_id, job.version, job.batch_id, name);
        const fail = (msg: string): never => {
          throw new NonRetryableError("clip.precheck", `${msg}; regenerate with a new batchId`, undefined, 0);
        };
        const src = join(dir, "source.mp4");
        const mezz = join(dir, "mezzanine.mp4");
        const norm = join(dir, "normalised.mp4");
        const check = join(dir, "480p.mp4");
        const grid = join(dir, "luma-3x3.gray");
        await download(d, "ingest", g.source_key, src, "clip.precheck");
        const raw = checkRawUpload(await probe(d, bin.ffprobe, src, dir, "precheck/probe source"));
        if (raw.length > 0) fail(`generated video rejected: ${raw.join("; ")}`);
        // Normalise to the delivery spec: the transcode (CFR 30, ≤ 1080 lines, no audio, metadata
        // stripped) and the strip-metadata remux both run, so nothing of the generator's container
        // metadata or audio track survives. SynthID is in the pixels (Google's watermark), not here.
        const t = commandTimeoutMs(STEP.precheck);
        await mustRun(d.run, buildMezzanineArgv({ input: src, output: mezz, binaries: { ffmpeg: bin.ffmpeg } }), dir, t, "precheck/normalise");
        await mustRun(d.run, buildStripMetadataArgv({ input: mezz, output: norm, binaries: { ffmpeg: bin.ffmpeg } }), dir, t, "precheck/strip");
        const p = await probe(d, bin.ffprobe, norm, dir, "precheck/probe normalised");
        if (!p.video) fail("normalised video has no video stream");
        if (p.streams.audio > 0) fail("normalised video still has audio");
        const leaks = findPrivacyMetadata(p);
        if (leaks.length > 0) fail(`metadata left after stripping: ${leaks.map((x) => `${x.scope}/${x.key}`).join(", ")}`);
        const durationMs = p.durationMs ?? 0;
        if (durationMs > (GENERATION_LIMITS.maxTotalS + 1) * 1000) fail(`duration ${durationMs} ms over the 40 s cap`);
        await mustRun(d.run, buildTranscodeArgv({ input: norm, outputs: [{ res: "480p", path: check }], binaries: { ffmpeg: bin.ffmpeg } }), dir, t, "precheck/480p");
        const issues = checkDeliveryRendition(await probe(d, bin.ffprobe, check, dir, "precheck/probe 480p"), "480p");
        if (issues.length > 0) fail(`480p check: ${issues.join("; ")}`);
        await mustRun(d.run, buildLumaGridArgv({ input: check, output: grid, binaries: { ffmpeg: bin.ffmpeg } }), dir, t, "precheck/flash");
        const lumaBytes = await readFile(grid);
        const flash = flashCheckFromLuma(parseLumaGrid(lumaBytes));
        await d.store().put("ingest", key("luma-3x3.gray"), lumaBytes, "application/octet-stream");
        if (!flash.passes)
          fail(`WCAG 2.3.1 flash check failed (${flash.maxFlashesInAnySecond} flashes in one second)`);
        const put = await d.store().put("ingest", key("normalised.mp4"), await readFile(norm), "video/mp4");
        return {
          ...job,
          normalised_key: key("normalised.mp4"),
          bytes: put.bytes,
          sha256: put.sha256,
          duration_ms: durationMs,
          width: p.video?.width ?? 0,
          height: p.video?.height ?? 0,
          flash,
        };
      }),
  );

  const register = defineStep(define, STEP.register, async (ctx, input: RegisterInput): Promise<RegisterOutput> => {
    const scene = findScene(await scenes(), input);
    const g = input.generated;
    const pc = input.precheck;
    const generation = generationRecord({
      model: g.model,
      sceneId: input.scene_id,
      batchId: input.batch_id,
      generatedAt: g.generated_at,
      durationMs: pc.duration_ms,
      extensions: g.extensions,
    });
    const res = await d.api().step<Record<string, unknown>>(
      STEP_REGISTER_GENERATED,
      {
        scene_id: input.scene_id,
        scene_revision: input.version,
        batch_id: input.batch_id,
        raw_key: pc.normalised_key,
        raw_sha256: pc.sha256,
        raw_bytes: pc.bytes,
        duration_ms: pc.duration_ms,
        facts: { ...sceneClipFacts(scene), capturedMonth: g.generated_at, durationMs: pc.duration_ms },
        generation,
        // For the raters' first look only; never a window, never sent to learners.
        onset_hint: approximateOnsetHint(scene, g.turn_ends_ms),
        cue: scene.cue,
        hazard_type: scene.hazardType,
        curator_difficulty_suggestion: scene.difficulty,
        occlusion: scene.occlusion,
        flash: pc.flash,
      },
      {
        runId: ctx.metadata.taskRunId,
        idempotencyKey: generationIdempotencyKey("register", input.scene_id, input.version, input.batch_id),
      },
    );
    const clipId = res["clip_id"];
    const version = res["version"];
    if (typeof clipId !== "string" || !/^[A-Z]{2,4}-\d{4,6}$/.test(clipId))
      throw new NonRetryableError(STEP_REGISTER_GENERATED, `bad clip_id from the API: ${JSON.stringify(clipId)}`, undefined, 0);
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
      throw new NonRetryableError(STEP_REGISTER_GENERATED, `bad version from the API: ${JSON.stringify(version)}`, undefined, 0);
    return { clip_id: clipId, version };
  });

  const render = defineStep(
    define,
    STEP.render,
    (_ctx, input: RenderInput): Promise<RenderOutput> =>
      withTempDir("md-clip-render-", async (dir) => {
        const bin = binaries(d.config().ffmpegPath);
        const mezz = join(dir, "mezzanine.mp4");
        await download(d, "ingest", input.mezzanine.mezzanine_key, mezz, "clip.render");
        const outputs = RENDITIONS.map((res: Rendition) => ({ res, path: join(dir, `${res}.mp4`) }));
        await mustRun(
          d.run,
          buildTranscodeArgv({ input: mezz, outputs, binaries: { ffmpeg: bin.ffmpeg } }),
          dir,
          commandTimeoutMs(STEP.render),
          "render",
        );
        const ref = { clip_id: input.clip_id, version: input.version, round: input.round };
        const media = await stageRenditions(d, bin.ffprobe, dir, ref, outputs, "clip.render");
        const poster = await stagePoster(d, bin.ffmpeg, dir, ref, join(dir, "360p.mp4"), "render/poster");
        return { media, poster_key: poster };
      }),
  );

  const clipGenerate = define(
    {
      name: TASK_CLIP_GENERATE,
      retry: { ...TASK_LIMITS.clip_generate.retry },
      timeoutSeconds: TASK_LIMITS.clip_generate.timeoutSeconds,
    },
    async (ctx: TaskCtx, ...args: unknown[]): Promise<ClipGenerateSummary> => {
      const job = normaliseGenerateJob(args);
      const generated = await ctx.run(generate, job);
      const checked = await ctx.run(precheck, generated);
      const reg = await ctx.run(register, { ...job, generated, precheck: checked });
      const ref = { clip_id: reg.clip_id, version: reg.version, round: null };
      // From here on, the existing clip_ingest subtasks, minus blur.
      const mezzanine = await ctx.run(ingest.transcode, { ...ref, raw_key: checked.normalised_key });
      const rendered = await ctx.run(render, { ...ref, mezzanine });
      const by = (res: Rendition) => {
        const m = rendered.media.find((x) => x.res === res);
        if (!m) throw new Error(`render produced no ${res}`);
        return m.key;
      };
      const flash = await ctx.run(ingest.flashCheck, { ...ref, key_480p: by("480p") });
      const proposals = await runOptional(ctx, ingest.proposeWindows, { ...ref, key_360p: by("360p") });
      const review = await ctx.run(ingest.openReview, {
        ...ref,
        mezzanine,
        media: rendered.media,
        poster_key: rendered.poster_key,
        flash,
        proposals: proposals.result,
        proposals_error: proposals.error,
        blur: { detector: "none (ai_generated)", regions: 0, by_class: {} },
        origin: "ai_generated",
      });
      const scene = findScene(await scenes(), job);
      const summary: ClipGenerateSummary = {
        ...job,
        clip_id: reg.clip_id,
        clip_version: reg.version,
        source_key: generated.source_key,
        normalised_key: checked.normalised_key,
        duration_ms: checked.duration_ms,
        extensions: generated.extensions,
        onset_hint: approximateOnsetHint(scene, generated.turn_ends_ms),
        flash_passes: flash.passes,
        media: rendered.media,
        proposals,
        review,
        cached_generation: generated.cached,
      };
      d.log("clip_generate summary", {
        run_id: ctx.metadata.taskRunId,
        ...job,
        clip_id: reg.clip_id,
        clip_version: reg.version,
        duration_ms: checked.duration_ms,
        extensions: generated.extensions,
        flash_passes: flash.passes,
        cached_generation: generated.cached,
      });
      return summary;
    },
  );

  return { clipGenerate, clipGenerateSteps: { generate, precheck, register, render } };
}
