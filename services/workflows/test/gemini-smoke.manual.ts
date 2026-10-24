// Optional, manual smoke run against the REAL Gemini video API (ADR-0013). Not part of `pnpm test`
// (the file name does not match *.test.ts). Costs money: about $0.10 per generated second at 720p
// (pricing page, 2026-10-22), so the default (2 turns of a quiet scene, about 16 s) is roughly $1.60
// if the second turn bills only its new seconds, more if it bills the whole video.
//
//   GEMINI_API_KEY=... SMOKE_OUT_DIR=<your scratchpad dir> \
//     node --experimental-strip-types --conditions=margdarshak-source test/gemini-smoke.manual.ts
//
// Skips (exit 0) when GEMINI_API_KEY is unset. Refuses to run without SMOKE_OUT_DIR, and writes only
// there: each turn's MP4 and report.json (interaction IDs, statuses, durations, sizes). It checks
// the one assumption the task relies on that the docs do not state outright: an extension turn's
// output is the whole video so far (turn 2 longer than turn 1 by 3–10 s). Never prints the key or
// a prompt (prompt lengths only).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildShotPrompts, DEFAULT_VIDEO_MODEL, SceneSpecSchema } from "@margdarshak/clip-pipeline";
import { sdkVideoClient } from "../src/lib/genai.ts";
import { DEFAULT_SCENES_PATH, VIDEO_FORMAT } from "../src/tasks/clip-generate.ts";

const key = process.env["GEMINI_API_KEY"];
if (!key) {
  console.warn("gemini smoke: GEMINI_API_KEY is not set, skipping (no call made).");
  process.exit(0);
}
const outDir = process.env["SMOKE_OUT_DIR"];
if (!outDir) {
  console.error("gemini smoke: set SMOKE_OUT_DIR to a scratch directory; refusing to write anywhere else.");
  process.exit(2);
}
const dir = resolve(outDir, "gemini-smoke");
mkdirSync(dir, { recursive: true });
const model = process.env["GEMINI_MODEL_VIDEO_GEN"] || DEFAULT_VIDEO_MODEL;
const sceneId = process.env["SMOKE_SCENE"] || "SCN-101";
const turns = Math.max(1, Math.min(5, Number(process.env["SMOKE_TURNS"] || 2)));

const doc = JSON.parse(readFileSync(DEFAULT_SCENES_PATH, "utf8")) as { scenes: { sceneId: string }[] };
const scene = SceneSpecSchema.parse(doc.scenes.find((s) => s.sceneId === sceneId));
const prompts = buildShotPrompts(scene).slice(0, turns);
const client = await sdkVideoClient(key);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function durationS(path: string): number | null {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" });
  const n = Number(r.stdout?.trim());
  return r.status === 0 && Number.isFinite(n) ? n : null;
}

const report: Record<string, unknown>[] = [];
let prev: string | undefined;
for (const p of prompts) {
  const t0 = Date.now();
  let it = await client.createInteraction({
    model,
    input: p.text,
    ...(prev ? { previous_interaction_id: prev } : {}),
    response_format: VIDEO_FORMAT,
  });
  while (it.status !== "completed" && !["failed", "cancelled", "budget_exceeded"].includes(it.status)) {
    await sleep(10_000);
    it = await client.getInteraction(it.id);
  }
  const path = join(dir, `turn-${p.n}.mp4`);
  const v = it.output_video;
  if (v?.data) writeFileSync(path, Buffer.from(v.data, "base64"));
  else if (v?.uri) {
    const name = /files\/[A-Za-z0-9_-]+/.exec(v.uri)?.[0] ?? "";
    for (;;) {
      const f = await client.getFile(name);
      const state = typeof f.state === "string" ? f.state : f.state?.name;
      if (state === "ACTIVE") {
        await client.downloadFile({ ...f, name }, path);
        break;
      }
      if (state === "FAILED") throw new Error(`turn ${p.n}: file FAILED`);
      await sleep(10_000);
    }
  }
  const row = {
    turn: p.n,
    interaction_id: it.id,
    status: it.status,
    prompt_chars: p.text.length,
    seconds_to_complete: Math.round((Date.now() - t0) / 1000),
    bytes: v ? statSync(path).size : 0,
    duration_s: v ? durationS(path) : null,
  };
  report.push(row);
  console.warn(JSON.stringify(row));
  if (it.status !== "completed") break;
  prev = it.id;
}
const d1 = report[0]?.["duration_s"] as number | null | undefined;
const d2 = report[1]?.["duration_s"] as number | null | undefined;
const cumulative = typeof d1 === "number" && typeof d2 === "number" ? d2 >= d1 + 2.5 : null;
writeFileSync(join(dir, "report.json"), JSON.stringify({ model, sceneId, turns: report, extension_is_cumulative: cumulative }, null, 2));
console.warn(`gemini smoke: wrote ${dir} (extension_is_cumulative: ${cumulative})`);
