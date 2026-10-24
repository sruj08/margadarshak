// The only module that imports @renderinc/sdk (1.4.0, "early access, subject to breaking
// changes"). If the SDK API moves, this is the one file to change.
//
// SDK facts this relies on (read from the 1.4.0 tarball's README and dist/workflows/*.d.ts):
//   - `import { task } from "@renderinc/sdk/workflows"`;
//   - `task({ name, retry?: { maxRetries, waitDurationMs, backoffScaling? }, timeoutSeconds?, plan? }, fn)`
//     registers the task and returns `{ name, func }`;
//   - every task function receives a TaskContext first: `ctx.run(def, ...args)` runs a subtask on
//     its own compute; `ctx.metadata.taskRunId` is this run's id;
//   - tasks must be registered synchronously at module load; the task server auto-starts when
//     RENDER_SDK_SOCKET_PATH is set (RENDER_SDK_AUTO_START=false disables it).
import { task } from "@renderinc/sdk/workflows";
import type { DefineTask } from "./lib/task-types.ts";

export const defineTask: DefineTask = (options, fn) => task(options, fn);
