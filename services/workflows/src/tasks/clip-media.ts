// I/O seams for the clip tasks (RW-1): object storage, running ffmpeg/ffprobe, blur detections and
// the demo fault injection. Nothing here depends on @margdarshak/clip-pipeline: the types below are
// structural copies (Detection, Command), so the tasks can pass these values straight to its
// builders, and tests can swap every seam for a fake.
import { spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { NonRetryableError } from "../lib/api.ts";
import type { FaultInjection } from "../lib/config.ts";

// ---- object storage -----------------------------------------------------------------------

/** "clips" = public, audited renditions and the client manifest; "ingest" = private everything else. */
export type Bucket = "clips" | "ingest";

export interface PutResult {
  readonly bytes: number;
  readonly sha256: string;
}

export interface ObjectStore {
  put(bucket: Bucket, key: string, body: Uint8Array, contentType: string): Promise<PutResult>;
  /** null when the object does not exist. */
  get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
}

/**
 * Private staging key for a blurred-but-unaudited artefact (`360p.mp4`, `480p.mp4`, `poster.jpg`).
 * clip_ingest writes here; clip_finalize copies to the public keys only after the blur audit passed.
 */
export function stagedKey(
  clipId: string,
  version: number,
  name: "360p.mp4" | "480p.mp4" | "poster.jpg",
): string {
  return `private/${clipId}/v${version}/staged/${name}`;
}

// ---- running binaries ---------------------------------------------------------------------

/** Same shape as clip-pipeline's `Command` (`spawn(cmd.file, cmd.args)`). */
export interface Command {
  readonly file: string;
  readonly args: readonly string[];
}

export interface CommandResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type CommandRunner = (
  cmd: Command,
  opts: { cwd: string; timeoutMs: number },
) => Promise<CommandResult>;

const MAX_STDOUT = 64 * 1024 * 1024;
const MAX_STDERR = 16 * 1024;

/** spawn(cmd.file, cmd.args) with no shell; stdout kept as bytes (ffprobe JSON), stderr capped. */
export const runCommand: CommandRunner = (cmd, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.file, [...cmd.args], {
      cwd: opts.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      if (outBytes < MAX_STDOUT) {
        out.push(d);
        outBytes += d.length;
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      if (stderr.length < MAX_STDERR) stderr += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(out), stderr, timedOut });
    });
  });

/** Runs `cmd` and throws (retryable) on a non-zero exit or a timeout. */
export async function mustRun(
  run: CommandRunner,
  cmd: Command,
  cwd: string,
  timeoutMs: number,
  label: string,
): Promise<Buffer> {
  const r = await run(cmd, { cwd, timeoutMs });
  if (r.timedOut)
    throw new Error(`${label}: ${basename(cmd.file)} timed out after ${timeoutMs} ms`);
  if (r.code !== 0)
    throw new Error(
      `${label}: ${basename(cmd.file)} exited ${r.code ?? r.signal}: ${r.stderr.trim().slice(-500)}`,
    );
  return r.stdout;
}

/** ffmpeg and ffprobe from FFMPEG_PATH (ffprobe is its sibling), or both from PATH. */
export function binaries(ffmpegPath: string | undefined): { ffmpeg: string; ffprobe: string } {
  if (!ffmpegPath) return { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
  const base = basename(ffmpegPath);
  if (!/ffmpeg/i.test(base)) return { ffmpeg: ffmpegPath, ffprobe: "ffprobe" };
  const probe = base.replace(/ffmpeg/i, "ffprobe");
  const dir = dirname(ffmpegPath);
  return { ffmpeg: ffmpegPath, ffprobe: dir === "." ? probe : join(dir, probe) };
}

// ---- blur detections ----------------------------------------------------------------------

/** Same shape as clip-pipeline's `Detection` (normalised box, inclusive 30 fps frame range). */
export interface MaskDetection {
  readonly cls: "face" | "plate" | "manual";
  readonly score: number;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly fromFrame: number;
  readonly toFrame: number;
}

export interface DetectInput {
  readonly clipId: string;
  readonly version: number;
  /** Local path of the mezzanine (constant 30 fps). */
  readonly mezzaninePath: string;
  readonly width: number;
  readonly height: number;
  readonly totalFrames: number | null;
  /** Curator-supplied manual masks from the job input and clip.get (wire shape). */
  readonly manualMasks: readonly unknown[];
}

/** Produces blur detections for one mezzanine. Model detectors (YuNet, plates) plug in here later. */
export interface BlurDetector {
  readonly name: string;
  detect(input: DetectInput): Promise<MaskDetection[]>;
}

/**
 * Wire shape of a manual mask: `{box: {x, y, w, h}, from_frame, to_frame}` (normalised box,
 * inclusive frames at 30 fps). Invalid masks are a NonRetryableError: blurring less than the
 * curator asked for is never acceptable.
 */
export function parseManualMasks(raw: readonly unknown[], step = "clip.blur"): MaskDetection[] {
  return raw.map((m, i) => {
    const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const b = (o["box"] && typeof o["box"] === "object" ? o["box"] : {}) as Record<string, unknown>;
    const [x, y, w, h] = [b["x"], b["y"], b["w"], b["h"]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const from = Number(o["from_frame"]);
    const to = Number(o["to_frame"]);
    const ok =
      [x, y, w, h].every(Number.isFinite) &&
      w > 0 &&
      h > 0 &&
      x >= 0 &&
      y >= 0 &&
      x + w <= 1.0001 &&
      y + h <= 1.0001 &&
      Number.isInteger(from) &&
      Number.isInteger(to) &&
      from >= 0 &&
      to >= from;
    if (!ok)
      throw new NonRetryableError(
        step,
        `manual mask ${i} is invalid: ${JSON.stringify(m).slice(0, 200)}`,
        undefined,
        0,
      );
    return { cls: "manual" as const, score: 1, box: { x, y, w, h }, fromFrame: from, toFrame: to };
  });
}

/** Default detector: the curator's manual masks only (no model). */
export const manualMaskDetector: BlurDetector = {
  name: "manual-masks",
  detect: async (input) => parseManualMasks(input.manualMasks),
};

// ---- demo fault injection -----------------------------------------------------------------

export class InjectedFault extends Error {
  override readonly name = "InjectedFault";
}

/** Marker object for FAULT_INJECTION_CLIP_BLUR=once (one per clip version and root run). */
export function faultMarkerKey(clipId: string, version: number, rootRunId: string): string {
  return `private/${clipId}/v${version}/fault/blur-${rootRunId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)}`;
}

/**
 * FAULT_INJECTION_CLIP_BLUR: `once` throws on the first blur attempt of a run and lets the Render
 * retry through. The "already failed" marker lives in the ingest bucket, because each retry runs
 * on a fresh instance (process memory would fail every attempt). `always` throws every time.
 */
export async function maybeInjectBlurFault(
  mode: FaultInjection,
  store: ObjectStore,
  clipId: string,
  version: number,
  rootRunId: string,
): Promise<void> {
  if (mode === "off") return;
  if (mode === "always")
    throw new InjectedFault("FAULT_INJECTION_CLIP_BLUR=always: blur attempt failed on purpose");
  const key = faultMarkerKey(clipId, version, rootRunId);
  if ((await store.get("ingest", key)) !== null) return;
  await store.put("ingest", key, new TextEncoder().encode(new Date().toISOString()), "text/plain");
  throw new InjectedFault(
    "FAULT_INJECTION_CLIP_BLUR=once: first blur attempt failed on purpose (demo retry)",
  );
}
