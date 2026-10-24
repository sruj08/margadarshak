// Shared plumbing for clip_ingest and clip_finalize (RW-1): the job input, one subtask per
// clip-pipeline StepDef (its retry, timeout and idempotency key), and the I/O seams.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StepDef, stepIdempotencyKey } from "@margdarshak/clip-pipeline";
import type { ApiClient, FetchLike } from "../lib/api.ts";
import { NonRetryableError } from "../lib/api.ts";
import type { Config } from "../lib/config.ts";
import type { DefineTask, TaskCtx, TaskDef, TaskOptions } from "../lib/task-types.ts";
import {
  type BlurDetector,
  type CommandRunner,
  manualMaskDetector,
  type ObjectStore,
  runCommand,
} from "./clip-media.ts";
import { R2ObjectStore } from "./clip-r2.ts";

export interface ClipDeps {
  readonly api: () => ApiClient;
  readonly config: () => Config;
  readonly log?: (msg: string, attrs: Record<string, unknown>) => void;
  /** Object storage (R2 from config by default). */
  readonly store?: () => ObjectStore;
  /** ffmpeg/ffprobe runner (spawn, no shell, by default). */
  readonly runCommand?: CommandRunner;
  /** Blur detections (curator manual masks by default). */
  readonly detector?: BlurDetector;
  /** fetch for cdn_warm (global fetch by default). */
  readonly fetch?: FetchLike;
}

export interface ResolvedClipDeps {
  readonly api: () => ApiClient;
  readonly config: () => Config;
  readonly log: (msg: string, attrs: Record<string, unknown>) => void;
  readonly store: () => ObjectStore;
  readonly run: CommandRunner;
  readonly detector: BlurDetector;
  readonly fetch: FetchLike;
}

export function resolveClipDeps(deps: ClipDeps): ResolvedClipDeps {
  let store: ObjectStore | undefined;
  return {
    api: deps.api,
    config: deps.config,
    log: deps.log ?? (() => {}),
    store: () => {
      if (deps.store) return deps.store();
      const r2 = deps.config().r2;
      if (!r2)
        throw new NonRetryableError(
          "clip.media",
          "R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)",
          undefined,
          0,
        );
      store ??= new R2ObjectStore(r2);
      return store;
    },
    run: deps.runCommand ?? runCommand,
    detector: deps.detector ?? manualMaskDetector,
    fetch: deps.fetch ?? ((u, i) => fetch(u, i)),
  };
}

/** What the API passes as the run input (`[job]`, IDs only). */
export interface ClipJob {
  readonly clip_id: string;
  readonly version: number;
  /** clip_finalize re-runs (after adjudication) and re-blur ingests carry a round > 1. */
  readonly round: number | null;
  readonly raw_key: string | null;
  readonly manual_masks: readonly unknown[];
}

const CLIP_ID = /^[A-Z]{2,4}-\d{4,6}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;

export function normaliseClipJob(args: readonly unknown[], step: string): ClipJob {
  const first = args[0];
  const o =
    first !== null && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : {};
  const bad = (msg: string): never => {
    throw new NonRetryableError(step, msg, undefined, 0);
  };
  const id = o["clip_id"];
  if (typeof id !== "string" || !CLIP_ID.test(id)) bad(`bad clip_id ${JSON.stringify(id)}`);
  const version = o["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    bad(`bad version ${JSON.stringify(version)}`);
  const round = o["round"];
  if (
    round !== undefined &&
    round !== null &&
    (typeof round !== "number" || !Number.isInteger(round) || round < 1)
  ) {
    bad(`bad round ${JSON.stringify(round)}`);
  }
  const raw = o["raw_key"];
  if (
    raw !== undefined &&
    raw !== null &&
    (typeof raw !== "string" || !KEY.test(raw) || raw.includes(".."))
  )
    bad("bad raw_key");
  const masks = o["manual_masks"];
  if (masks !== undefined && masks !== null && !Array.isArray(masks))
    bad("manual_masks must be an array");
  return {
    clip_id: id as string,
    version: version as number,
    round: typeof round === "number" ? round : null,
    raw_key: typeof raw === "string" ? raw : null,
    manual_masks: Array.isArray(masks) ? masks : [],
  };
}

/** `clip_ingest_transcode`, `clip_finalize_agreement`, … */
export function subtaskName(step: StepDef): string {
  return `${step.task}_${step.id}`;
}

export function stepTaskOptions(step: StepDef): TaskOptions {
  return {
    name: subtaskName(step),
    retry: {
      maxRetries: step.retry.maxRetries,
      waitDurationMs: step.retry.waitDurationMs,
      backoffScaling: step.retry.backoffScaling,
    },
    timeoutSeconds: step.timeoutSeconds,
  };
}

/** `stepIdempotencyKey(step, clipId, version[, round])`, e.g. `JMU-0012:agreement:3:r2`. */
export function clipKey(
  stepId: string,
  job: Pick<ClipJob, "clip_id" | "version" | "round">,
): string {
  return stepIdempotencyKey(stepId, job.clip_id, job.version, job.round ?? undefined);
}

/** Calls a Go clip step with the step's idempotency key. */
export function goStep<T = Record<string, unknown>>(
  deps: ResolvedClipDeps,
  ctx: TaskCtx,
  goName: string,
  stepId: string,
  job: Pick<ClipJob, "clip_id" | "version" | "round">,
  args: Record<string, unknown>,
  keySuffix = "",
): Promise<T> {
  return deps.api().step<T>(
    goName,
    { clip_id: job.clip_id, version: job.version, round: job.round, ...args },
    {
      runId: ctx.metadata.taskRunId,
      idempotencyKey: `${clipKey(stepId, job)}${keySuffix}`,
    },
  );
}

export function stepById(steps: readonly StepDef[], id: string): StepDef {
  const s = steps.find((x) => x.id === id);
  if (!s) throw new Error(`clip-pipeline has no step ${id}`);
  return s;
}

/** Defines one subtask for a StepDef with its retry and timeout. */
export function defineStep<A, R>(
  define: DefineTask,
  step: StepDef,
  fn: (ctx: TaskCtx, input: A) => Promise<R>,
): TaskDef<[A], R> {
  return define<[A], R>(stepTaskOptions(step), fn);
}

export interface OptionalOutcome<R> {
  readonly ok: boolean;
  readonly result: R | null;
  readonly error: string | null;
}

/** ctx.run for a step with continueOnFailure: a failure (after its retries) is recorded, not thrown. */
export async function runOptional<A, R>(
  ctx: TaskCtx,
  def: TaskDef<[A], R>,
  input: A,
): Promise<OptionalOutcome<R>> {
  try {
    return { ok: true, result: await ctx.run(def, input), error: null };
  } catch (err) {
    return {
      ok: false,
      result: null,
      error: ((err as Error)?.message ?? String(err)).slice(0, 300),
    };
  }
}

/** A private temp dir for one subtask attempt, always removed. */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Per-command timeout inside a step: the step's own timeout minus a margin for the uploads. */
export function commandTimeoutMs(step: StepDef): number {
  return Math.max(10_000, step.timeoutSeconds * 1000 - 60_000);
}
