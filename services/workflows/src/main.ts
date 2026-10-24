// Entry point (infra/render.yaml startCommand: node services/workflows/dist/main.js).
// Registers every task at module load. Under Render (or `render workflows dev`, local task
// server on :8120) RENDER_SDK_SOCKET_PATH is set and the SDK starts its task server itself.
import { defineTask } from "./sdk.ts";
import { defineTasks } from "./tasks/index.ts";

export const tasks = defineTasks(defineTask);

if (!process.env["RENDER_SDK_SOCKET_PATH"]) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "tasks registered; RENDER_SDK_SOCKET_PATH is not set, so no task server was started (use `render workflows dev -- pnpm --filter @margdarshak/workflows dev`)",
      tasks: Object.values(tasks).map((t) => t.name),
    }),
  );
}
