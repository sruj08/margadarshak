// clip_ingest (RW-1; ARCHITECTURE §8; clip-pipeline CLIP_INGEST_STEPS). Started by the Go API when
// a curator registers a clip (API-55, jobs.Start) as `<WORKFLOW_SLUG>/clip_ingest` with
// `[{clip_id, version, round?, raw_key?, manual_masks?}]`.
//
//   clip.get (Go)                          raw key and curator masks
//   ctx.run clip_ingest_transcode          raw → ffprobe + checkRawUpload → mezzanine (private)
//   ctx.run clip_ingest_blur               detector → buildBlurArgv → 360p/480p + poster (private staging)
//   ctx.run clip_ingest_flash_check        3×3 luma grid of the staged 480p → WCAG 2.3.1 check
//   ctx.run clip_ingest_propose_windows    Go clip.propose_windows (stub in P2, D8); failure is not fatal
//   ctx.run clip_ingest_open_review        Go clip.open_review (status proposed; n8n W08 md/clip-ready)
//
// Every subtask has its StepDef's retry and timeout; every Go call its stepIdempotencyKey. Media
// never crosses a step boundary: subtasks hand each other object keys, hashes and small results.
// Nothing unaudited reaches the public bucket (see P2-PHASE2.md); FAULT_INJECTION_CLIP_BLUR=once
// fails the first blur attempt so the Runs page shows a retry.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  artefactKey,
  buildBlurArgv,
  buildLumaGridArgv,
  buildMezzanineArgv,
  buildPosterArgv,
  buildProbeArgv,
  CLIP_INGEST_STEPS,
  checkDeliveryRendition,
  checkRawUpload,
  type FlashCheckResult,
  flashCheckFromLuma,
  parseFfprobeJson,
  parseLumaGrid,
  posterTimeMs,
  RENDITIONS,
  type Rendition,
  TASK_LIMITS,
} from "@margdarshak/clip-pipeline";
import { NonRetryableError } from "../lib/api.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";
import {
  type ClipDeps,
  type ClipJob,
  commandTimeoutMs,
  defineStep,
  goStep,
  normaliseClipJob,
  type OptionalOutcome,
  type ResolvedClipDeps,
  resolveClipDeps,
  runOptional,
  stepById,
  withTempDir,
} from "./clip-common.ts";
import { binaries, maybeInjectBlurFault, mustRun, stagedKey } from "./clip-media.ts";

export const TASK_CLIP_INGEST = "clip_ingest";
export const STEP_CLIP_GET = "clip.get";

const STEP = {
  transcode: stepById(CLIP_INGEST_STEPS, "transcode"),
  blur: stepById(CLIP_INGEST_STEPS, "blur"),
  flash: stepById(CLIP_INGEST_STEPS, "flash_check"),
  propose: stepById(CLIP_INGEST_STEPS, "propose_windows"),
  review: stepById(CLIP_INGEST_STEPS, "open_review"),
} as const;

type JobRef = Pick<ClipJob, "clip_id" | "version" | "round">;

export interface TranscodeInput extends JobRef {
  readonly raw_key: string;
}
export interface TranscodeOutput {
  readonly mezzanine_key: string;
  readonly width: number;
  readonly height: number;
  readonly frames: number | null;
  readonly duration_ms: number | null;
  readonly bytes: number;
  readonly sha256: string;
}
export interface MediaOut {
  readonly res: Rendition;
  readonly bytes: number;
  readonly sha256: string;
  readonly key: string;
}
export interface BlurInput extends JobRef {
  readonly mezzanine: TranscodeOutput;
  readonly manual_masks: readonly unknown[];
}
export interface BlurOutput {
  readonly media: readonly MediaOut[];
  readonly poster_key: string;
  readonly blur: {
    readonly detector: string;
    readonly regions: number;
    readonly by_class: Record<string, number>;
  };
}
export interface FlashInput extends JobRef {
  readonly key_480p: string;
}
export interface ProposeInput extends JobRef {
  readonly key_360p: string;
}
export interface ReviewInput extends JobRef {
  readonly mezzanine: TranscodeOutput;
  readonly media: readonly MediaOut[];
  readonly poster_key: string;
  readonly flash: FlashCheckResult;
  readonly proposals: unknown;
  readonly proposals_error: string | null;
  readonly blur: BlurOutput["blur"];
  /** clip_generate (ADR-0013): an AI-generated clip, so Go moves it transcoded → proposed. */
  readonly origin?: "ai_generated";
}

export interface ClipIngestSummary {
  readonly clip_id: string;
  readonly version: number;
  readonly round: number | null;
  readonly mezzanine_key: string;
  readonly media: readonly MediaOut[];
  readonly flash_passes: boolean;
  readonly proposals: OptionalOutcome<unknown>;
  readonly blur_regions: number;
  readonly review: unknown;
}

export interface ClipIngestTasks {
  readonly clipIngest: TaskDef<unknown[], ClipIngestSummary>;
  readonly clipIngestSteps: {
    readonly transcode: TaskDef<[TranscodeInput], TranscodeOutput>;
    readonly blur: TaskDef<[BlurInput], BlurOutput>;
    readonly flashCheck: TaskDef<[FlashInput], FlashCheckResult>;
    readonly proposeWindows: TaskDef<[ProposeInput], unknown>;
    readonly openReview: TaskDef<[ReviewInput], unknown>;
  };
}

export async function download(
  d: ResolvedClipDeps,
  bucket: "ingest" | "clips",
  key: string,
  path: string,
  step: string,
): Promise<void> {
  const body = await d.store().get(bucket, key);
  if (!body) throw new NonRetryableError(step, `object ${bucket}/${key} not found`, undefined, 0);
  await writeFile(path, body);
}

export async function probe(
  d: ResolvedClipDeps,
  ffprobe: string,
  input: string,
  dir: string,
  label: string,
) {
  const out = await mustRun(
    d.run,
    buildProbeArgv({ input, binaries: { ffprobe } }),
    dir,
    120_000,
    label,
  );
  return parseFfprobeJson(out.toString("utf8"));
}

function rootRunId(ctx: TaskCtx): string {
  return (
    ctx.metadata.rootTaskRunId ?? ctx.metadata.parentTaskRunId ?? ctx.metadata.taskRunId ?? "adhoc"
  );
}

function defineTranscode(define: DefineTask, d: ResolvedClipDeps) {
  return defineStep(
    define,
    STEP.transcode,
    (_ctx, input: TranscodeInput): Promise<TranscodeOutput> =>
      withTempDir("md-clip-transcode-", async (dir) => {
        const bin = binaries(d.config().ffmpegPath);
        const raw = join(dir, "raw.upload");
        const mezz = join(dir, "mezzanine.mp4");
        await download(d, "ingest", input.raw_key, raw, "clip.transcode");
        const rawIssues = checkRawUpload(
          await probe(d, bin.ffprobe, raw, dir, "transcode/probe raw"),
        );
        if (rawIssues.length > 0)
          throw new NonRetryableError(
            "clip.transcode",
            `raw upload rejected: ${rawIssues.join("; ")}`,
            undefined,
            0,
          );
        await mustRun(
          d.run,
          buildMezzanineArgv({ input: raw, output: mezz, binaries: { ffmpeg: bin.ffmpeg } }),
          dir,
          commandTimeoutMs(STEP.transcode),
          "transcode",
        );
        const p = await probe(d, bin.ffprobe, mezz, dir, "transcode/probe mezzanine");
        if (!p.video) throw new Error("transcode: mezzanine has no video stream");
        const key = artefactKey(input.clip_id, input.version, "mezzanine");
        const put = await d.store().put("ingest", key, await readFile(mezz), "video/mp4");
        return {
          mezzanine_key: key,
          width: p.video.width,
          height: p.video.height,
          frames: p.video.nbFrames,
          duration_ms: p.durationMs,
          bytes: put.bytes,
          sha256: put.sha256,
        };
      }),
  );
}

type BlurBase = Parameters<typeof buildBlurArgv>[0];

/** buildBlurArgv inline, or through a graph file when the graph is too long for a command line. */
async function blurCommand(base: BlurBase, dir: string): Promise<ReturnType<typeof buildBlurArgv>> {
  try {
    return buildBlurArgv(base);
  } catch (err) {
    if (!(err instanceof RangeError) || !/graphFile/.test(err.message)) throw err;
    const graphFile = join(dir, "blur.graph");
    const render = buildBlurArgv({ ...base, graphFile });
    await writeFile(graphFile, render.filterGraph, "utf8");
    return render;
  }
}

/** Checks each rendition against NAZAR §3.1 and uploads it to its private staging key. */
export async function stageRenditions(
  d: ResolvedClipDeps,
  ffprobe: string,
  dir: string,
  input: JobRef,
  outputs: readonly { res: Rendition; path: string }[],
  step = "clip.blur",
): Promise<MediaOut[]> {
  const media: MediaOut[] = [];
  for (const o of outputs) {
    const issues = checkDeliveryRendition(
      await probe(d, ffprobe, o.path, dir, `${step}/probe ${o.res}`),
      o.res,
    );
    if (issues.length > 0) {
      throw new NonRetryableError(
        step,
        `${o.res} does not conform: ${issues.join("; ")}`,
        undefined,
        0,
      );
    }
    const key = stagedKey(input.clip_id, input.version, `${o.res}.mp4`);
    const put = await d.store().put("ingest", key, await readFile(o.path), "video/mp4");
    media.push({ res: o.res, bytes: put.bytes, sha256: put.sha256, key });
  }
  return media;
}

/** Poster from the blurred 360p at a time that cannot give a hazard away (no windows exist yet). */
export async function stagePoster(
  d: ResolvedClipDeps,
  ffmpeg: string,
  dir: string,
  input: JobRef,
  src: string,
  label = "blur/poster",
): Promise<string> {
  const poster = join(dir, "poster.jpg");
  const atMs = posterTimeMs({ quietSegments: [], hazards: [] });
  await mustRun(
    d.run,
    buildPosterArgv({ input: src, output: poster, atMs, binaries: { ffmpeg } }),
    dir,
    120_000,
    label,
  );
  const key = stagedKey(input.clip_id, input.version, "poster.jpg");
  await d.store().put("ingest", key, await readFile(poster), "image/jpeg");
  return key;
}

function defineBlur(define: DefineTask, d: ResolvedClipDeps) {
  return defineStep(define, STEP.blur, async (ctx, input: BlurInput): Promise<BlurOutput> => {
    const cfg = d.config();
    await maybeInjectBlurFault(
      cfg.faultInjectionClipBlur,
      d.store(),
      input.clip_id,
      input.version,
      rootRunId(ctx),
    );
    return withTempDir("md-clip-blur-", async (dir) => {
      const bin = binaries(cfg.ffmpegPath);
      const mezz = join(dir, "mezzanine.mp4");
      const m = input.mezzanine;
      await download(d, "ingest", m.mezzanine_key, mezz, "clip.blur");
      const detections = await d.detector.detect({
        clipId: input.clip_id,
        version: input.version,
        mezzaninePath: mezz,
        width: m.width,
        height: m.height,
        totalFrames: m.frames,
        manualMasks: input.manual_masks,
      });
      const outputs = RENDITIONS.map((res) => ({ res, path: join(dir, `${res}.mp4`) }));
      const render = await blurCommand(
        {
          input: mezz,
          frame: { width: m.width, height: m.height },
          detections,
          outputs,
          binaries: { ffmpeg: bin.ffmpeg },
          ...(m.frames !== null ? { totalFrames: m.frames } : {}),
        },
        dir,
      );
      await mustRun(d.run, render.command, dir, commandTimeoutMs(STEP.blur), "blur");
      const media = await stageRenditions(d, bin.ffprobe, dir, input, outputs);
      const posterKey = await stagePoster(d, bin.ffmpeg, dir, input, join(dir, "360p.mp4"));
      const byClass: Record<string, number> = {};
      for (const r of render.regions) byClass[r.cls] = (byClass[r.cls] ?? 0) + 1;
      const regionsDoc = JSON.stringify({ detector: d.detector.name, regions: render.regions });
      await d
        .store()
        .put(
          "ingest",
          artefactKey(input.clip_id, input.version, "blur_regions"),
          new TextEncoder().encode(regionsDoc),
          "application/json",
        );
      return {
        media,
        poster_key: posterKey,
        blur: { detector: d.detector.name, regions: render.regions.length, by_class: byClass },
      };
    });
  });
}

function defineFlash(define: DefineTask, d: ResolvedClipDeps) {
  return defineStep(
    define,
    STEP.flash,
    (_ctx, input: FlashInput): Promise<FlashCheckResult> =>
      withTempDir("md-clip-flash-", async (dir) => {
        const bin = binaries(d.config().ffmpegPath);
        const src = join(dir, "480p.mp4");
        const grid = join(dir, "luma-3x3.gray");
        await download(d, "ingest", input.key_480p, src, "clip.flash_check");
        await mustRun(
          d.run,
          buildLumaGridArgv({ input: src, output: grid, binaries: { ffmpeg: bin.ffmpeg } }),
          dir,
          commandTimeoutMs(STEP.flash),
          "flash_check",
        );
        const bytes = await readFile(grid);
        await d
          .store()
          .put(
            "ingest",
            artefactKey(input.clip_id, input.version, "luma_grid"),
            bytes,
            "application/octet-stream",
          );
        return flashCheckFromLuma(parseLumaGrid(bytes));
      }),
  );
}

export function defineClipIngestTasks(define: DefineTask, deps: ClipDeps): ClipIngestTasks {
  const d = resolveClipDeps(deps);
  const transcode = defineTranscode(define, d);
  const blur = defineBlur(define, d);
  const flashCheck = defineFlash(define, d);
  const proposeWindows = defineStep(
    define,
    STEP.propose,
    async (ctx, input: ProposeInput): Promise<unknown> => {
      // D8: a Go stub in P2 (no unaudited media goes to a model); the AI layer is P3.
      const res = await goStep(d, ctx, "clip.propose_windows", "propose_windows", input, {
        key_360p: input.key_360p,
      });
      return res["proposals"] ?? null;
    },
  );
  const openReview = defineStep(
    define,
    STEP.review,
    (ctx, input: ReviewInput): Promise<unknown> =>
      goStep(d, ctx, "clip.open_review", "open_review", input, { ...input }),
  );

  const clipIngest = define(
    {
      name: TASK_CLIP_INGEST,
      retry: { ...TASK_LIMITS.clip_ingest.retry },
      timeoutSeconds: TASK_LIMITS.clip_ingest.timeoutSeconds,
    },
    async (ctx: TaskCtx, ...args: unknown[]): Promise<ClipIngestSummary> => {
      const job = normaliseClipJob(args, STEP_CLIP_GET);
      const ref: JobRef = { clip_id: job.clip_id, version: job.version, round: job.round };
      const got = await goStep(d, ctx, STEP_CLIP_GET, "get", ref, {});
      const rawKey =
        job.raw_key ??
        (typeof got["raw_key"] === "string"
          ? got["raw_key"]
          : artefactKey(job.clip_id, job.version, "raw"));
      const masks = [
        ...job.manual_masks,
        ...(Array.isArray(got["manual_masks"]) ? got["manual_masks"] : []),
      ];
      const mezzanine = await ctx.run(transcode, { ...ref, raw_key: rawKey });
      const blurred = await ctx.run(blur, { ...ref, mezzanine, manual_masks: masks });
      const by = (res: Rendition) => {
        const m = blurred.media.find((x) => x.res === res);
        if (!m) throw new Error(`blur produced no ${res}`);
        return m.key;
      };
      const flash = await ctx.run(flashCheck, { ...ref, key_480p: by("480p") });
      const proposals = await runOptional(ctx, proposeWindows, { ...ref, key_360p: by("360p") });
      const review = await ctx.run(openReview, {
        ...ref,
        mezzanine,
        media: blurred.media,
        poster_key: blurred.poster_key,
        flash,
        proposals: proposals.result,
        proposals_error: proposals.error,
        blur: blurred.blur,
      });
      const summary: ClipIngestSummary = {
        ...ref,
        mezzanine_key: mezzanine.mezzanine_key,
        media: blurred.media,
        flash_passes: flash.passes,
        proposals,
        blur_regions: blurred.blur.regions,
        review,
      };
      d.log("clip_ingest summary", {
        run_id: ctx.metadata.taskRunId,
        ...ref,
        flash_passes: flash.passes,
        regions: blurred.blur.regions,
      });
      return summary;
    },
  );

  return {
    clipIngest,
    clipIngestSteps: { transcode, blur, flashCheck, proposeWindows, openReview },
  };
}
