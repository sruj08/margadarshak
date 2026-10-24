// Test doubles: a fake SDK `task` (no @renderinc/sdk needed), a fake TaskContext whose
// `run` executes the subtask in-process with its own run id, and a fake Go API (`fetch` stub)
// that verifies the Margdarshak-Signature on every request exactly as the Go side does.
import type { Config } from "../src/lib/config.ts";
import { loadConfig } from "../src/lib/config.ts";
import { SIGNATURE_HEADER, verify } from "../src/lib/hmac.ts";
import type { DefineTask, TaskCtx, TaskDef, TaskOptions } from "../src/lib/task-types.ts";

export const SECRET = "test-internal-hmac-secret";
export const ENV = {
  API_INTERNAL_HOSTPORT: "margdarshak-api:10000",
  INTERNAL_HMAC_SECRET: SECRET,
  INTERNAL_BEARER_TOKEN: "test-internal-token",
  API_STEP_RETRY_BASE_MS: "1000",
};

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({ ...ENV, ...over });
}

export interface Registered {
  readonly options: TaskOptions;
}

export function fakeSdk(): { define: DefineTask; registered: Map<string, TaskOptions> } {
  const registered = new Map<string, TaskOptions>();
  const define: DefineTask = (options, fn) => {
    if (registered.has(options.name)) throw new Error(`task ${options.name} registered twice`);
    registered.set(options.name, options);
    return Object.freeze({ name: options.name, func: fn });
  };
  return { define, registered };
}

let runSeq = 0;
export interface CtxLog {
  readonly subtasks: { name: string; runId: string; args: unknown[] }[];
}

/** A TaskContext; ctx.run(def, ...args) runs def.func in-process (JSON round-trip like Render). */
export function fakeCtx(log: CtxLog = { subtasks: [] }, runId = `trn-root-${++runSeq}`): TaskCtx {
  return {
    metadata: { taskRunId: runId, rootTaskRunId: runId },
    async run<A extends unknown[], R>(def: TaskDef<A, R>, ...args: A): Promise<R> {
      const childId = `trn-child-${++runSeq}`;
      const wire = JSON.parse(JSON.stringify(args)) as A; // inputs cross the wire as JSON
      log.subtasks.push({ name: def.name, runId: childId, args: wire });
      const child: TaskCtx = { ...fakeCtx(log, childId), metadata: { taskRunId: childId, rootTaskRunId: runId, parentTaskRunId: runId } };
      return JSON.parse(JSON.stringify(await def.func(child, ...wire))) as R;
    },
  };
}

export interface Call {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly json: { run_id: string | null; args: Record<string, unknown> } | undefined;
  readonly signature: ReturnType<typeof verify>;
}

export type Handler = (call: Call) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/** fetch stub: records calls, verifies HMAC (now = the call's own clock), replies via handler. */
export function fakeFetch(handler: Handler, nowSeconds: () => number = () => Math.floor(Date.now() / 1000)) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const body = typeof init.body === "string" ? init.body : "";
    const path = new URL(url).pathname;
    const call: Call = {
      method: init.method ?? "GET",
      url,
      path,
      headers,
      body,
      json: body ? JSON.parse(body) : undefined,
      signature: verify(SECRET, headers[SIGNATURE_HEADER.toLowerCase()], body, nowSeconds()),
    };
    calls.push(call);
    const r = await handler(call);
    if (r.status === 0) throw new TypeError("fetch failed (simulated network error)");
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

export function recordingSleep() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}
