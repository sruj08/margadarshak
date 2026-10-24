// Harness for the clip task tests: a TaskContext that retries subtasks the way Render does (with
// the registered maxRetries), a fake ffmpeg/ffprobe, and a fake Go API for the clip.* steps.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { TaskCtx, TaskDef, TaskOptions } from "../src/lib/task-types.ts";
import type { Command, CommandResult, CommandRunner } from "../src/tasks/clip-media.ts";
import { type Call, fakeFetch } from "./helpers.ts";

let seq = 0;

export interface Attempt {
  readonly name: string;
  readonly attempt: number;
  readonly ok: boolean;
  readonly error: string | null;
}

/** ctx.run retries a failing subtask up to its registered retry.maxRetries (JSON over the wire). */
export function retryingCtx(
  registered: Map<string, TaskOptions>,
  attempts: Attempt[] = [],
  rootId = `trn-root-${++seq}`,
): TaskCtx {
  const make = (runId: string): TaskCtx => ({
    metadata: {
      taskRunId: runId,
      rootTaskRunId: rootId,
      ...(runId === rootId ? {} : { parentTaskRunId: rootId }),
    },
    async run<A extends unknown[], R>(def: TaskDef<A, R>, ...args: A): Promise<R> {
      const max = registered.get(def.name)?.retry?.maxRetries ?? 0;
      const wire = JSON.parse(JSON.stringify(args)) as A;
      for (let attempt = 1; ; attempt++) {
        try {
          const out = await def.func(make(`trn-${def.name}-${++seq}`), ...wire);
          attempts.push({ name: def.name, attempt, ok: true, error: null });
          return JSON.parse(JSON.stringify(out ?? null)) as R;
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          attempts.push({ name: def.name, attempt, ok: false, error: msg });
          const nonRetryable =
            (err as Error)?.name === "NonRetryableError" ||
            (err as Error)?.name === "StatsOutputError";
          if (nonRetryable || attempt > max) throw err;
        }
      }
    },
  });
  return make(rootId);
}

// ---- fake ffmpeg / ffprobe ----------------------------------------------------------------

const BRAND_TAGS = {
  major_brand: "isom",
  minor_version: "512",
  compatible_brands: "isomiso2avc1mp41",
};

function probeJson(
  path: string,
  opts: { portrait?: boolean; durations?: Record<string, number> } = {},
): string {
  const name = basename(path);
  // Per-file durations (s) for clip_generate turns; 30 s otherwise.
  const dur = (opts.durations?.[name] ?? 30).toFixed(3);
  const delivery = /^(360p|480p)\.mp4$/.exec(name);
  if (delivery) {
    const h = delivery[1] === "360p" ? 360 : 480;
    const w = h === 360 ? 640 : 854;
    return JSON.stringify({
      streams: [
        {
          index: 0,
          codec_name: "h264",
          profile: "High",
          codec_type: "video",
          width: w,
          height: h,
          pix_fmt: "yuv420p",
          r_frame_rate: "30/1",
          avg_frame_rate: "30/1",
          duration: dur,
          nb_frames: "900",
          tags: { language: "und", handler_name: "VideoHandler", vendor_id: "[0][0][0][0]" },
        },
      ],
      format: {
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        duration: dur,
        size: "1000000",
        bit_rate: "266000",
        tags: BRAND_TAGS,
      },
    });
  }
  // The normalised (clip_generate) file is a stripped mezzanine: clean tags, no audio, 30 fps.
  const mezz = name === "mezzanine.mp4" || name === "normalised.mp4";
  const [w, h] = opts.portrait && !mezz ? [720, 1280] : [1280, 720];
  return JSON.stringify({
    streams: [
      {
        index: 0,
        codec_name: "h264",
        profile: "High",
        codec_type: "video",
        width: w,
        height: h,
        pix_fmt: "yuv420p",
        avg_frame_rate: mezz ? "30/1" : "25/1",
        r_frame_rate: mezz ? "30/1" : "25/1",
        nb_frames: mezz ? "900" : "750",
        duration: dur,
      },
      ...(mezz ? [] : [{ index: 1, codec_type: "audio", codec_name: "aac" }]),
    ],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: dur,
      size: "9000000",
      tags: mezz ? BRAND_TAGS : { ...BRAND_TAGS, location: "+32.7+074.8/" },
    },
  });
}

/** Writes every output file an ffmpeg argv names (paths ending .mp4/.jpg/.gray not after -i). */
async function writeOutputs(cmd: Command, flashFrames: number[] | null): Promise<string[]> {
  const outs: string[] = [];
  cmd.args.forEach((a, i) => {
    if (/\.(mp4|jpg|gray)$/.test(a) && cmd.args[i - 1] !== "-i") outs.push(a);
  });
  for (const o of outs) {
    if (o.endsWith(".gray")) {
      // 900 frames of a 3×3 grid; constant mid-grey unless flashes were asked for.
      const frames = 900;
      const bytes = new Uint8Array(frames * 9).fill(128);
      for (const f of flashFrames ?? []) bytes.fill(f % 2 === 0 ? 235 : 16, f * 9, f * 9 + 9);
      await writeFile(o, bytes);
    } else {
      await writeFile(o, `fake ${basename(o)} from ${cmd.args.join(" ").length} argv chars`);
    }
  }
  return outs;
}

export interface FakeMedia {
  readonly run: CommandRunner;
  readonly commands: Command[];
}

export function fakeMedia(
  opts: {
    portraitRaw?: boolean;
    flashFrames?: number[];
    failOn?: (cmd: Command) => boolean;
    durations?: Record<string, number>;
  } = {},
): FakeMedia {
  const commands: Command[] = [];
  const ok = (stdout: Buffer | string): CommandResult => ({
    code: 0,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: "",
    timedOut: false,
  });
  const run: CommandRunner = async (cmd) => {
    commands.push(cmd);
    if (opts.failOn?.(cmd))
      return {
        code: 1,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: "simulated ffmpeg failure",
        timedOut: false,
      };
    if (/ffprobe/.test(basename(cmd.file))) {
      return ok(
        probeJson(cmd.args.at(-1) as string, {
          ...(opts.portraitRaw ? { portrait: true } : {}),
          ...(opts.durations ? { durations: opts.durations } : {}),
        }),
      );
    }
    await writeOutputs(cmd, opts.flashFrames ?? null);
    return ok("");
  };
  return { run, commands };
}

// ---- fake Go API for clip.* steps -----------------------------------------------------------

export type StepReply = { status: number; body?: unknown };

export function fakeClipApi(replies: Record<string, (call: Call) => StepReply>) {
  const steps: Call[] = [];
  const f = fakeFetch((call) => {
    if (!call.path.startsWith("/internal/job-steps/"))
      return { status: 404, body: { title: "not a step" } };
    assert.ok(call.signature.ok, `bad signature on ${call.path}`);
    steps.push(call);
    const name = call.path.slice("/internal/job-steps/".length);
    const reply = replies[name];
    return reply ? reply(call) : { status: 422, body: { title: `unknown step ${name}` } };
  });
  return {
    ...f,
    steps,
    names: () => steps.map((c) => c.path.slice("/internal/job-steps/".length)),
    keys: () => steps.map((c) => c.headers["idempotency-key"]),
    args: (name: string) =>
      steps.filter((c) => c.path.endsWith(`/${name}`)).map((c) => c.json?.args ?? {}),
  };
}
