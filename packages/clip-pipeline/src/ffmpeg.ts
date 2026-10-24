// ffmpeg / ffprobe command builders. Pure: every builder returns an argv array for
// `child_process.spawn(cmd.file, cmd.args)` (never a shell string, so no quoting bugs or shell
// injection) and never runs anything. Input and output paths come from the caller.
//
// Encoding choices (NAZAR §3.1 is the source; each flag documented where it is set):
//   - H.264 High profile, level 3.1, yuv420p: every Android hardware decoder since ~2012 plays it;
//     yuv420p is the only chroma format they all support. Level 3.1 is the lowest that fits
//     854×480 at 30 fps (level 3.0 tops out at 40 500 macroblocks/s; 480p30 needs 48 600).
//   - CRF 28, preset slow: NAZAR §3.1's line. `slow` buys ~10% smaller files than `medium` at the
//     same quality; encode time is not on any user's path. A VBV cap (maxrate/bufsize) keeps busy
//     scenes inside the size budget (≤ 2 MB per 30 s at 360p) without lowering quality elsewhere.
//   - 30 fps constant frame rate and a fixed 1 s GOP (-g 30, keyint_min 30, scene-cut keyframes off):
//     seeks in replay land on a keyframe within 1 s (NAZAR §3.1), and frame N is always at N/30 s,
//     which the blur timeline, the flash check and frame-snapped windows rely on.
//   - +faststart: the moov atom goes first so playback and Range requests start before the whole
//     file arrives (the PWA still preloads the full MP4 before scoring, EC-18).
//   - No audio (-an): NAZAR §3.1 "stripped (privacy and no-audio design)"; §4 "we do not record audio".
//   - Privacy: only the first video stream is mapped (drops audio, subtitles and data tracks such
//     as GPS/telemetry tracks), global and per-stream metadata and chapters are dropped
//     (creation_time, location/ISO 6709, make/model), and +bitexact stops the muxer writing an
//     encoder tag or timestamps. Rotation is applied by ffmpeg's default autorotate while decoding.
import { DELIVERY_FPS, type Rendition } from "./schema.ts";

export interface Command {
  readonly file: string;
  readonly args: readonly string[];
}

export interface Binaries {
  readonly ffmpeg?: string;
  readonly ffprobe?: string;
}

export interface RenditionSpec {
  readonly height: number;
  readonly crf: number;
  readonly maxrateKbps: number;
  readonly bufsizeKbps: number;
}

export const RENDITION_SPECS: Readonly<Record<Rendition, RenditionSpec>> = {
  "360p": { height: 360, crf: 28, maxrateKbps: 600, bufsizeKbps: 1200 },
  "480p": { height: 480, crf: 28, maxrateKbps: 900, bufsizeKbps: 1800 },
};

export const ENCODER = {
  codec: "libx264",
  preset: "slow",
  profile: "high",
  level: "3.1",
  pixFmt: "yuv420p",
  fps: DELIVERY_FPS,
  gop: DELIVERY_FPS,
} as const;

/** Mezzanine: the normalised, metadata-free master that the detectors and the blur pass read. */
export const MEZZANINE = { maxHeight: 1080, crf: 18, preset: "medium" } as const;

/** Leading options for every ffmpeg run: non-interactive, quiet, overwrite (re-runs are idempotent). */
export const FFMPEG_PREAMBLE = [
  "-nostdin",
  "-hide_banner",
  "-nostats",
  "-v",
  "error",
  "-y",
] as const;

const PROTOCOL_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const DRIVE_RE = /^[A-Za-z]:[\\/]/;

/**
 * Rejects paths ffmpeg would treat as something other than a local file: an empty string, a
 * leading `-` (parsed as an option), control characters, or a protocol prefix such as `http:`,
 * `concat:`, `pipe:` (a Windows drive letter like `C:\` is allowed).
 */
export function assertSafeMediaPath(path: string, label = "path"): string {
  if (typeof path !== "string" || path.length === 0) throw new TypeError(`${label} is empty`);
  if (path.startsWith("-")) throw new TypeError(`${label} must not start with "-": ${path}`);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f]/.test(path)) throw new TypeError(`${label} contains control characters`);
  if (PROTOCOL_RE.test(path) && !DRIVE_RE.test(path))
    throw new TypeError(`${label} looks like a protocol URL: ${path}`);
  return path;
}

/**
 * Escapes a value for use inside a filtergraph option (e.g. a file path). ffmpeg parses two levels:
 * the option value (`\`, `'`, `:` are special) and then the graph (`\`, `'`, `[`, `]`, `,`, `;`).
 * See ffmpeg-filters(1) "Notes on filtergraph escaping".
 */
export function escapeFilterValue(value: string): string {
  const level1 = value.replace(/[\\':]/g, (c) => `\\${c}`);
  return level1.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

export function encodeArgs(res: Rendition, opts: { threads?: number } = {}): string[] {
  const s = RENDITION_SPECS[res];
  return [
    "-c:v",
    ENCODER.codec,
    "-preset",
    ENCODER.preset,
    "-crf",
    String(s.crf),
    "-maxrate",
    `${s.maxrateKbps}k`,
    "-bufsize",
    `${s.bufsizeKbps}k`,
    "-profile:v",
    ENCODER.profile,
    "-level:v",
    ENCODER.level,
    "-pix_fmt",
    ENCODER.pixFmt,
    "-g",
    String(ENCODER.gop),
    "-keyint_min",
    String(ENCODER.gop),
    "-sc_threshold",
    "0",
    ...(opts.threads !== undefined ? ["-threads", String(opts.threads)] : []),
    ...stripArgs(),
    "-movflags",
    "+faststart",
  ];
}

/** Output options that remove every non-video stream and all container metadata. */
export function stripArgs(): string[] {
  return [
    "-an",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
  ];
}

export function scaleFilter(height: number): string {
  return `scale=-2:${height}:flags=lanczos,setsar=1`;
}

export interface RenditionOutput {
  readonly res: Rendition;
  readonly path: string;
}

/**
 * Builds `-filter_complex` statements that take the stream labelled `inLabel`, split it once per
 * output and scale each copy; returns the statements and the output labels in `outputs` order.
 */
export function renditionGraph(
  inLabel: string,
  outputs: readonly RenditionOutput[],
): { statements: string[]; labels: string[] } {
  if (outputs.length === 0) throw new RangeError("at least one rendition output is required");
  const seen = new Set<string>();
  for (const o of outputs) {
    if (seen.has(o.res)) throw new RangeError(`duplicate rendition ${o.res}`);
    seen.add(o.res);
  }
  const labels = outputs.map((o) => `out${o.res}`);
  if (outputs.length === 1) {
    const only = outputs[0] as RenditionOutput;
    return {
      statements: [`[${inLabel}]${scaleFilter(RENDITION_SPECS[only.res].height)}[${labels[0]}]`],
      labels,
    };
  }
  const splits = outputs.map((_, k) => `[s${k}]`).join("");
  const statements = [`[${inLabel}]split=${outputs.length}${splits}`];
  outputs.forEach((o, k) => {
    statements.push(`[s${k}]${scaleFilter(RENDITION_SPECS[o.res].height)}[${labels[k]}]`);
  });
  return { statements, labels };
}

export interface TranscodeOptions {
  readonly input: string;
  readonly outputs: readonly RenditionOutput[];
  readonly threads?: number;
  readonly binaries?: Binaries;
}

/**
 * Delivery renditions straight from an input (360p and/or 480p, one decode). Used directly for
 * fixtures and re-encodes; the production path renders renditions from the blur pass (blur.ts),
 * which shares these encoder settings, so unblurred delivery files never exist.
 */
export function buildTranscodeArgv(o: TranscodeOptions): Command {
  assertSafeMediaPath(o.input, "input");
  const g = renditionGraph("vin", o.outputs);
  const graph = [`[0:v:0]fps=${ENCODER.fps}[vin]`, ...g.statements].join(";");
  const args: string[] = [...FFMPEG_PREAMBLE, "-i", o.input, "-filter_complex", graph];
  o.outputs.forEach((out, k) => {
    args.push(
      "-map",
      `[${g.labels[k]}]`,
      ...encodeArgs(out.res, o.threads !== undefined ? { threads: o.threads } : {}),
      assertSafeMediaPath(out.path, "output"),
    );
  });
  return { file: o.binaries?.ffmpeg ?? "ffmpeg", args };
}

export interface MezzanineOptions {
  readonly input: string;
  readonly output: string;
  readonly threads?: number;
  readonly binaries?: Binaries;
}

/**
 * Step `transcode`: raw upload → mezzanine. Constant 30 fps, at most 1080 lines (detectors run at
 * 1080p, NAZAR §5), CRF 18 (visually lossless, so detectors and the blur pass see full detail),
 * same GOP and privacy stripping as delivery files. The mezzanine is private and deleted with the raw.
 */
export function buildMezzanineArgv(o: MezzanineOptions): Command {
  return {
    file: o.binaries?.ffmpeg ?? "ffmpeg",
    args: [
      ...FFMPEG_PREAMBLE,
      "-i",
      assertSafeMediaPath(o.input, "input"),
      "-map",
      "0:v:0",
      "-vf",
      `fps=${ENCODER.fps},scale=-2:'min(ih,${MEZZANINE.maxHeight})':flags=lanczos,setsar=1`,
      "-c:v",
      ENCODER.codec,
      "-preset",
      MEZZANINE.preset,
      "-crf",
      String(MEZZANINE.crf),
      "-profile:v",
      ENCODER.profile,
      "-pix_fmt",
      ENCODER.pixFmt,
      "-g",
      String(ENCODER.gop),
      "-keyint_min",
      String(ENCODER.gop),
      "-sc_threshold",
      "0",
      ...(o.threads !== undefined ? ["-threads", String(o.threads)] : []),
      ...stripArgs(),
      "-movflags",
      "+faststart",
      assertSafeMediaPath(o.output, "output"),
    ],
  };
}

export interface StripOptions {
  readonly input: string;
  readonly output: string;
  readonly binaries?: Binaries;
}

/** Remux without re-encoding, dropping every non-video stream and all metadata (a privacy re-check). */
export function buildStripMetadataArgv(o: StripOptions): Command {
  return {
    file: o.binaries?.ffmpeg ?? "ffmpeg",
    args: [
      ...FFMPEG_PREAMBLE,
      "-i",
      assertSafeMediaPath(o.input, "input"),
      "-map",
      "0:v:0",
      "-c",
      "copy",
      ...stripArgs(),
      "-movflags",
      "+faststart",
      assertSafeMediaPath(o.output, "output"),
    ],
  };
}

export interface PosterOptions {
  /** A blurred delivery rendition: posters are never taken from unblurred media. */
  readonly input: string;
  readonly output: string;
  readonly atMs: number;
  readonly height?: number;
  readonly binaries?: Binaries;
}

/** One JPEG frame (no EXIF is written by ffmpeg's mjpeg encoder; metadata dropped anyway). */
export function buildPosterArgv(o: PosterOptions): Command {
  if (!Number.isFinite(o.atMs) || o.atMs < 0)
    throw new RangeError(`poster time must be ≥ 0 ms, got ${o.atMs}`);
  return {
    file: o.binaries?.ffmpeg ?? "ffmpeg",
    args: [
      ...FFMPEG_PREAMBLE,
      "-ss",
      (o.atMs / 1000).toFixed(3),
      "-i",
      assertSafeMediaPath(o.input, "input"),
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      scaleFilter(o.height ?? 360),
      "-q:v",
      "4",
      "-map_metadata",
      "-1",
      "-fflags",
      "+bitexact",
      "-flags:v",
      "+bitexact",
      assertSafeMediaPath(o.output, "output"),
    ],
  };
}

/**
 * Poster time that cannot give a hazard away: 500 ms into the first quiet segment, else 0, and
 * never inside a hazard window (or the 1 s before its onset).
 */
export function posterTimeMs(clip: {
  readonly quietSegments: readonly { readonly fromMs: number; readonly toMs: number }[];
  readonly hazards: readonly { readonly window: { readonly aMs: number; readonly bMs: number } }[];
}): number {
  const q = [...clip.quietSegments].sort((x, y) => x.fromMs - y.fromMs)[0];
  const t = q ? Math.min(q.fromMs + 500, Math.floor((q.fromMs + q.toMs) / 2)) : 0;
  const unsafe = clip.hazards.some((h) => t >= h.window.aMs - 1000 && t <= h.window.bMs);
  return unsafe ? 0 : t;
}

export interface ProbeOptions {
  readonly input: string;
  readonly binaries?: Binaries;
}

/** `ffprobe -print_format json -show_format -show_streams`, parsed by probe.ts. */
export function buildProbeArgv(o: ProbeOptions): Command {
  return {
    file: o.binaries?.ffprobe ?? "ffprobe",
    args: [
      "-v",
      "error",
      "-hide_banner",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      assertSafeMediaPath(o.input, "input"),
    ],
  };
}
