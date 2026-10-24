// `health`: a cheap task to prove the workflow service is registered and can reach the Go API
// over the private network (GET /v1/health, API-64). It never throws, so it is safe to run from
// the dashboard or `render workflows tasks start health --local`.
import type { ApiClient } from "../lib/api.ts";
import type { Config } from "../lib/config.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";

export const TASK_HEALTH = "health";
export const SERVICE_NAME = "margdarshak-workflows";
export const SDK_VERSION = "@renderinc/sdk@1.4.0";

export interface HealthReport {
  readonly ok: boolean;
  readonly service: string;
  readonly sdk: string;
  readonly node: string;
  readonly run_id: string | null;
  readonly config: { readonly ok: boolean; readonly error: string | null };
  readonly api: { readonly reachable: boolean; readonly status: number | null; readonly error: string | null };
}

export interface HealthDeps {
  readonly api: () => ApiClient;
  readonly config: () => Config;
}

export function defineHealthTask(define: DefineTask, deps: HealthDeps): TaskDef<[], HealthReport> {
  return define({ name: TASK_HEALTH, timeoutSeconds: 30 }, async (ctx: TaskCtx): Promise<HealthReport> => {
    const base = { service: SERVICE_NAME, sdk: SDK_VERSION, node: process.version, run_id: ctx.metadata.taskRunId ?? null };
    try {
      deps.config();
    } catch (err) {
      const error = (err as Error)?.message ?? String(err);
      return { ...base, ok: false, config: { ok: false, error }, api: { reachable: false, status: null, error: "not attempted" } };
    }
    try {
      const res = await deps.api().get("/v1/health");
      const reachable = res.status >= 200 && res.status < 300;
      return {
        ...base,
        ok: reachable,
        config: { ok: true, error: null },
        api: { reachable, status: res.status, error: reachable ? null : `HTTP ${res.status}` },
      };
    } catch (err) {
      const error = (err as Error)?.message ?? String(err);
      return { ...base, ok: false, config: { ok: true, error: null }, api: { reachable: false, status: null, error } };
    }
  });
}
