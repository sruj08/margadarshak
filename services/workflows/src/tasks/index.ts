// Builds every task against a `define` function: the real SDK's `task` in src/main.ts, a fake in
// tests. Config and the API client are created lazily on first use, so registering the tasks
// never fails on missing env (the `health` task reports it instead).
import { type ApiClient, type ApiDeps, createApiClient } from "../lib/api.ts";
import { type Config, loadConfig } from "../lib/config.ts";
import type { VideoGenClient } from "../lib/genai.ts";
import type { DefineTask, TaskDef } from "../lib/task-types.ts";
import type { ClipDeps } from "./clip-common.ts";
import { type ClipFinalizeTasks, defineClipFinalizeTasks } from "./clip-finalize.ts";
import { type ClipGenerateTasks, defineClipGenerateTasks } from "./clip-generate.ts";
import { type ClipIngestTasks, defineClipIngestTasks } from "./clip-ingest.ts";
import type { BlurDetector, CommandRunner, ObjectStore } from "./clip-media.ts";
import { type ClockTasks, defineClockTasks } from "./clock-sweep.ts";
import { defineHealthTask, type HealthReport } from "./health.ts";
import { defineNightlyStatsTask, type NightlyStatsSummary } from "./nightly-stats.ts";
import { defineReplayPendingTask, type ReplaySummary } from "./replay-pending.ts";

export interface TaskDeps extends ApiDeps {
  readonly env?: Record<string, string | undefined>;
  /** Clip tasks: object storage (R2 from config by default). */
  readonly store?: () => ObjectStore;
  /** Clip tasks: ffmpeg/ffprobe runner (spawn, no shell, by default). */
  readonly runCommand?: CommandRunner;
  /** Clip tasks: blur detections (curator manual masks by default). */
  readonly detector?: BlurDetector;
  /** clip_generate: the video model client (@google/genai with GEMINI_API_KEY by default). */
  readonly videoClient?: () => VideoGenClient | Promise<VideoGenClient>;
  /** clip_generate: the scene catalogue (content/nazar/scenes.json by default). */
  readonly scenes?: () => Promise<readonly unknown[]>;
}

export interface Tasks extends ClockTasks, ClipIngestTasks, ClipFinalizeTasks, ClipGenerateTasks {
  readonly health: TaskDef<[], HealthReport>;
  /** P2: verifier-outage recovery (ARCHITECTURE §8), started through API-67. */
  readonly replayPendingSessions: TaskDef<unknown[], ReplaySummary>;
  /** P2 RW-4: field-study statistics from the pre-registered nazar_stats.mjs, started through API-67. */
  readonly nightlyStats: TaskDef<unknown[], NightlyStatsSummary>;
}

export function jsonLog(msg: string, attrs: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", msg, service: "margdarshak-workflows", ...attrs }));
}

export function defineTasks(define: DefineTask, deps: TaskDeps = {}): Tasks {
  let config: Config | undefined;
  let api: ApiClient | undefined;
  const log = deps.log ?? jsonLog;
  const getConfig = (): Config => {
    config ??= loadConfig(deps.env ?? process.env);
    return config;
  };
  const getApi = (): ApiClient => {
    api ??= createApiClient(getConfig(), { ...deps, log });
    return api;
  };
  const clock = defineClockTasks(define, { api: getApi, config: getConfig, log });
  const health = defineHealthTask(define, { api: getApi, config: getConfig });
  const replayPendingSessions = defineReplayPendingTask(define, {
    api: getApi,
    config: getConfig,
    log,
  });
  const nightlyStats = defineNightlyStatsTask(define, { api: getApi, config: getConfig, log });
  const clipDeps: ClipDeps = {
    api: getApi,
    config: getConfig,
    log,
    ...(deps.store ? { store: deps.store } : {}),
    ...(deps.runCommand ? { runCommand: deps.runCommand } : {}),
    ...(deps.detector ? { detector: deps.detector } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
  const ingest = defineClipIngestTasks(define, clipDeps);
  const finalize = defineClipFinalizeTasks(define, clipDeps);
  // ADR-0013: AI-generated clips; after registration it reuses the clip_ingest subtasks above.
  const generate = defineClipGenerateTasks(
    define,
    {
      ...clipDeps,
      ...(deps.videoClient ? { videoClient: deps.videoClient } : {}),
      ...(deps.scenes ? { scenes: deps.scenes } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    },
    ingest.clipIngestSteps,
  );
  return { ...clock, health, replayPendingSessions, nightlyStats, ...ingest, ...finalize, ...generate };
}
