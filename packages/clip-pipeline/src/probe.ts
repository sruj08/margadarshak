// Parser for `ffprobe -print_format json -show_format -show_streams` (see buildProbeArgv) and the
// checks the pipeline runs on its results: raw-upload sanity (DATA_PIPELINE §2 ingest checks),
// delivery-rendition conformance (NAZAR §3.1) and leftover privacy metadata (NAZAR §4, §13).
import { z } from "zod";
import { DELIVERY_FPS, type Rendition } from "./schema.ts";

const Tags = z.record(z.string(), z.union([z.string(), z.number()])).optional();

const RawStream = z.looseObject({
  index: z.number(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  profile: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  pix_fmt: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  nb_frames: z.string().optional(),
  duration: z.string().optional(),
  tags: Tags,
  side_data_list: z
    .array(
      z.looseObject({ side_data_type: z.string().optional(), rotation: z.number().optional() }),
    )
    .optional(),
});

const RawProbe = z.looseObject({
  streams: z.array(RawStream).default([]),
  format: z
    .looseObject({
      format_name: z.string().optional(),
      duration: z.string().optional(),
      size: z.string().optional(),
      bit_rate: z.string().optional(),
      tags: Tags,
    })
    .optional(),
});

export interface ProbeVideo {
  readonly index: number;
  readonly codec: string | null;
  readonly profile: string | null;
  readonly width: number;
  readonly height: number;
  readonly pixFmt: string | null;
  readonly fps: number | null;
  readonly nbFrames: number | null;
  /** Display rotation in degrees from the display matrix or the legacy `rotate` tag (0 if none). */
  readonly rotation: number;
}

export interface ProbeResult {
  readonly formatName: string | null;
  readonly durationMs: number | null;
  readonly sizeBytes: number | null;
  readonly bitRate: number | null;
  readonly video: ProbeVideo | null;
  readonly streams: {
    readonly video: number;
    readonly audio: number;
    readonly subtitle: number;
    readonly data: number;
  };
  /** Tags as `scope → key → value`; scope is `format` or `stream:<index>`. */
  readonly tags: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

function num(s: string | undefined): number | null {
  if (s === undefined || s === "" || s === "N/A") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "30000/1001" → 29.97…; "0/0" → null. */
export function parseRate(s: string | undefined): number | null {
  if (!s) return null;
  const [n, d] = s.split("/");
  const nn = Number(n);
  const dd = d === undefined ? 1 : Number(d);
  return Number.isFinite(nn) && Number.isFinite(dd) && dd !== 0 && nn !== 0 ? nn / dd : null;
}

function stringTags(t: Record<string, string | number> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t ?? {})) out[k] = String(v);
  return out;
}

function toVideo(s: z.infer<typeof RawStream>): ProbeVideo | null {
  if (!s.width || !s.height) return null;
  const dm = s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation;
  const legacy = num(s.tags ? String(s.tags["rotate"] ?? "") : undefined);
  return {
    index: s.index,
    codec: s.codec_name ?? null,
    profile: s.profile ?? null,
    width: s.width,
    height: s.height,
    pixFmt: s.pix_fmt ?? null,
    fps: parseRate(s.avg_frame_rate) ?? parseRate(s.r_frame_rate),
    nbFrames: num(s.nb_frames),
    rotation: dm ?? legacy ?? 0,
  };
}

export function parseFfprobeJson(text: string): ProbeResult {
  const raw = RawProbe.parse(JSON.parse(text));
  const tags: Record<string, Record<string, string>> = {};
  if (raw.format?.tags) tags["format"] = stringTags(raw.format.tags);
  const counts = { video: 0, audio: 0, subtitle: 0, data: 0 };
  let video: ProbeVideo | null = null;
  for (const s of raw.streams) {
    if (s.tags && Object.keys(s.tags).length) tags[`stream:${s.index}`] = stringTags(s.tags);
    const t = s.codec_type;
    if (t === "video" || t === "audio" || t === "subtitle" || t === "data") counts[t]++;
    else counts.data++;
    if (t === "video") video ??= toVideo(s);
  }
  const dur =
    num(raw.format?.duration) ?? num(raw.streams.find((s) => s.codec_type === "video")?.duration);
  return {
    formatName: raw.format?.format_name ?? null,
    durationMs: dur === null ? null : Math.round(dur * 1000),
    sizeBytes: num(raw.format?.size),
    bitRate: num(raw.format?.bit_rate),
    video,
    streams: counts,
    tags,
  };
}

/**
 * Container tags that carry no personal data. Anything else (creation_time, location,
 * com.apple.quicktime.*, com.android.*, make, model, title, comment, ...) is a finding.
 */
export const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "major_brand",
  "minor_version",
  "compatible_brands",
  "encoder",
  "handler_name",
  "vendor_id",
  "language",
]);

export function findPrivacyMetadata(p: ProbeResult): { scope: string; key: string }[] {
  const out: { scope: string; key: string }[] = [];
  for (const [scope, kv] of Object.entries(p.tags)) {
    for (const key of Object.keys(kv)) if (!ALLOWED_TAGS.has(key)) out.push({ scope, key });
  }
  return out.sort((x, y) => (x.scope + x.key < y.scope + y.key ? -1 : 1));
}

const HEIGHTS: Readonly<Record<Rendition, number>> = { "360p": 360, "480p": 480 };

/** Issues with a delivery file against NAZAR §3.1 (empty = conforms). */
export function checkDeliveryRendition(p: ProbeResult, res: Rendition): string[] {
  const issues: string[] = [];
  const v = p.video;
  if (!v) return ["no video stream"];
  if (v.codec !== "h264") issues.push(`codec ${v.codec}, want h264`);
  if (v.profile !== "High") issues.push(`profile ${v.profile}, want High`);
  if (v.pixFmt !== "yuv420p") issues.push(`pix_fmt ${v.pixFmt}, want yuv420p`);
  if (v.height !== HEIGHTS[res]) issues.push(`height ${v.height}, want ${HEIGHTS[res]}`);
  if (v.width % 2 !== 0) issues.push(`odd width ${v.width}`);
  if (v.width < v.height) issues.push("portrait; delivery is landscape");
  if (v.fps === null || Math.abs(v.fps - DELIVERY_FPS) > 0.01)
    issues.push(`fps ${v.fps}, want ${DELIVERY_FPS}`);
  if (v.rotation !== 0) issues.push(`rotation ${v.rotation} left in the container`);
  if (p.streams.video !== 1) issues.push(`${p.streams.video} video streams, want 1`);
  if (p.streams.audio > 0) issues.push("has an audio stream");
  if (p.streams.subtitle + p.streams.data > 0) issues.push("has subtitle or data streams");
  if (p.durationMs === null) issues.push("no duration");
  for (const f of findPrivacyMetadata(p)) issues.push(`metadata ${f.scope}/${f.key}`);
  return issues;
}

/** Raw upload sanity (DATA_PIPELINE §2 `ingest`: duration 20 s – 15 min, a landscape video stream). */
export function checkRawUpload(p: ProbeResult): string[] {
  const issues: string[] = [];
  const v = p.video;
  if (!v) return ["no video stream"];
  if (p.durationMs === null || p.durationMs < 20_000 || p.durationMs > 900_000) {
    issues.push(`duration ${p.durationMs} ms outside 20 s – 15 min`);
  }
  const quarter = Math.abs(v.rotation) % 180 === 90;
  const w = quarter ? v.height : v.width;
  const h = quarter ? v.width : v.height;
  if (w < h) issues.push("portrait footage; filming protocol is landscape (NAZAR §3.1)");
  if (v.fps !== null && v.fps < 24) issues.push(`fps ${v.fps.toFixed(2)} below 24`);
  return issues;
}

/** Soft size budget (NAZAR §3.1 "measure" targets): 360p ≈ 2 MB per 30 s, 480p ≈ 5 MB per 60 s. */
export function sizeBudgetBytes(res: Rendition, durationMs: number): number {
  const [bytes, perMs] = res === "360p" ? [2_000_000, 30_000] : [5_000_000, 60_000];
  return Math.ceil((bytes * Math.max(durationMs, 1000)) / perMs);
}
