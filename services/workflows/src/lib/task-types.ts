// Structural copies of the @renderinc/sdk 1.4.0 task types (dist/workflows/types.d.ts).
// Task modules depend on these, never on the SDK, so unit tests run without the package and
// src/sdk.ts is the only file that imports it.

export interface TaskRunMetadata {
  readonly taskRunId?: string;
  readonly rootTaskRunId?: string;
  readonly parentTaskRunId?: string;
}

export type TaskFn<A extends unknown[], R> = (ctx: TaskCtx, ...args: A) => R | Promise<R>;

export interface TaskDef<A extends unknown[] = unknown[], R = unknown> {
  readonly name: string;
  readonly func: TaskFn<A, R>;
}

export interface TaskCtx {
  readonly metadata: TaskRunMetadata;
  run<A extends unknown[], R>(task: TaskDef<A, R>, ...args: A): Promise<R>;
}

export interface TaskRetry {
  maxRetries: number;
  waitDurationMs: number;
  backoffScaling?: number;
}

/** Mirrors the SDK's RegisterTaskOptions. */
export interface TaskOptions {
  name: string;
  retry?: TaskRetry;
  timeoutSeconds?: number;
  plan?: string;
}

export type DefineTask = <A extends unknown[], R>(options: TaskOptions, fn: TaskFn<A, R>) => TaskDef<A, R>;
