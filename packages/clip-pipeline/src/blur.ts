// Blur (R-12 bystander privacy; NAZAR §5, DATA_PIPELINE §2, M-09): detections → deterministic blur
// regions → one ffmpeg filter graph that blurs the mezzanine and renders the delivery renditions.
// Also the blur-audit record (100% of frames, 0 misses to publish) and the raw-footage deletion
// record (MD-218). The detectors themselves (YuNet faces, a plate model via onnxruntime-node) run in
// the RW-1 task later and emit `Detection`s; nothing here touches a model or a pixel.
//
// Policy (BLUR_POLICY), applied in this order:
//   1. Score thresholds, set for recall (a missed face is the costly error; an extra blur is cheap):
//      face ≥ 0.5, plate ≥ 0.35, curator masks always.
//   2. Padding on each side, as a fraction of the box size: faces 30%, plates 20% (NAZAR §5;
//      we read "padded 30%" as 30% per side, the more protective reading). Clamped to the frame.
//   3. Linking: a detection joins an open region of the same class when their padded boxes touch
//      and the frame gap is ≤ 5 (NAZAR §5 "interpolated across missed frames, max gap 5"); the
//      region's box becomes the union, which covers any interpolated position. A region spans at
//      most 15 frames (0.5 s), so a moving face is covered by a chain of short boxes rather than
//      one box over its whole path.
//   4. Temporal dilation: each region is extended 3 frames before and after (DATA_PIPELINE §2:
//      "a box persists ±3 frames"), which also overlaps consecutive segments of a track.
//   5. Pixel snapping: coordinates are snapped outward to even numbers (yuv420p chroma alignment).
//   6. Strength: Gaussian blur with sigma = max(8, ⌈max(w, h) / 6⌉): the effective kernel (≈ 6σ)
//      is at least the box width, well above NAZAR §5's "kernel ≥ 1/3 of box width". Plates use
//      the same strong Gaussian rather than a box blur (see README "Deviations").
import {
  assertSafeMediaPath,
  type Binaries,
  type Command,
  ENCODER,
  encodeArgs,
  FFMPEG_PREAMBLE,
  type RenditionOutput,
  renditionGraph,
} from "./ffmpeg.ts";
import { cmpStr } from "./math.ts";
import { DELIVERY_FPS, PSEUDONYM_RE } from "./schema.ts";

export type DetectionClass = "face" | "plate" | "manual";

/** Box in normalised frame coordinates (0–1, origin top-left), as the detectors will emit. */
export interface NormBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Detection {
  readonly cls: DetectionClass;
  readonly score: number;
  readonly box: NormBox;
  /** Inclusive frame range at the mezzanine's 30 fps (a per-frame detection has from = to). */
  readonly fromFrame: number;
  readonly toFrame: number;
}

export interface BlurPolicy {
  readonly minScore: Readonly<Record<DetectionClass, number>>;
  readonly pad: Readonly<Record<DetectionClass, number>>;
  readonly maxGapFrames: number;
  readonly maxSegmentFrames: number;
  readonly dilateFrames: number;
  readonly minSigma: number;
}

export const BLUR_POLICY: BlurPolicy = {
  minScore: { face: 0.5, plate: 0.35, manual: 0 },
  pad: { face: 0.3, plate: 0.2, manual: 0 },
  maxGapFrames: 5,
  maxSegmentFrames: 15,
  dilateFrames: 3,
  minSigma: 8,
};

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export interface BlurRegion {
  readonly cls: DetectionClass;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly sigma: number;
}

interface Span {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function padded(d: Detection, pad: number): Span {
  const { x, y, w, h } = d.box;
  return {
    x0: Math.max(0, x - pad * w),
    y0: Math.max(0, y - pad * h),
    x1: Math.min(1, x + w + pad * w),
    y1: Math.min(1, y + h + pad * h),
  };
}

function touches(a: Span, b: Span): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

function validDetection(d: Detection): boolean {
  const { x, y, w, h } = d.box;
  const finite = [x, y, w, h, d.score, d.fromFrame, d.toFrame].every(Number.isFinite);
  return (
    finite &&
    w > 0 &&
    h > 0 &&
    x >= 0 &&
    y >= 0 &&
    x + w <= 1.0001 &&
    y + h <= 1.0001 &&
    Number.isInteger(d.fromFrame) &&
    Number.isInteger(d.toFrame) &&
    d.fromFrame >= 0 &&
    d.toFrame >= d.fromFrame
  );
}

/**
 * Detections → blur regions in pixels (deterministic: the same detections in any order give the
 * same regions). Invalid detections throw; low-score ones are dropped.
 */
export function planBlurRegions(
  detections: readonly Detection[],
  frame: FrameSize,
  opts: { policy?: BlurPolicy; totalFrames?: number } = {},
): BlurRegion[] {
  const policy = opts.policy ?? BLUR_POLICY;
  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width < 2 ||
    frame.height < 2
  ) {
    throw new RangeError(`bad frame size ${frame.width}x${frame.height}`);
  }
  for (const d of detections)
    if (!validDetection(d)) throw new RangeError(`invalid detection ${JSON.stringify(d)}`);
  const kept = detections
    .filter((d) => d.score >= policy.minScore[d.cls])
    .map((d) => ({ d, s: padded(d, policy.pad[d.cls]) }))
    .sort(
      (p, q) =>
        cmpStr(p.d.cls, q.d.cls) ||
        p.d.fromFrame - q.d.fromFrame ||
        p.d.toFrame - q.d.toFrame ||
        p.s.x0 - q.s.x0 ||
        p.s.y0 - q.s.y0 ||
        p.s.x1 - q.s.x1 ||
        p.s.y1 - q.s.y1,
    );
  const open: { cls: DetectionClass; from: number; to: number; s: Span }[] = [];
  for (const { d, s } of kept) {
    const r = open.find(
      (o) =>
        o.cls === d.cls &&
        d.fromFrame - o.to - 1 <= policy.maxGapFrames &&
        Math.max(o.to, d.toFrame) - o.from + 1 <= policy.maxSegmentFrames &&
        touches(o.s, s),
    );
    if (r) {
      r.to = Math.max(r.to, d.toFrame);
      r.s = {
        x0: Math.min(r.s.x0, s.x0),
        y0: Math.min(r.s.y0, s.y0),
        x1: Math.max(r.s.x1, s.x1),
        y1: Math.max(r.s.y1, s.y1),
      };
    } else {
      open.push({ cls: d.cls, from: d.fromFrame, to: d.toFrame, s });
    }
  }
  const last = opts.totalFrames !== undefined ? opts.totalFrames - 1 : Number.POSITIVE_INFINITY;
  const W = frame.width;
  const H = frame.height;
  const evenDown = (v: number): number => Math.max(0, Math.floor(v / 2) * 2);
  const evenUp = (v: number, max: number): number =>
    Math.min(max - (max % 2), Math.ceil(v / 2) * 2);
  const regions = open.map((o) => {
    const x = evenDown(o.s.x0 * W);
    const y = evenDown(o.s.y0 * H);
    const w = Math.max(2, evenUp(o.s.x1 * W, W) - x);
    const h = Math.max(2, evenUp(o.s.y1 * H, H) - y);
    return {
      cls: o.cls,
      fromFrame: Math.max(0, o.from - policy.dilateFrames),
      toFrame: Math.min(last, o.to + policy.dilateFrames),
      x,
      y,
      w,
      h,
      sigma: Math.min(1024, Math.max(policy.minSigma, Math.ceil(Math.max(w, h) / 6))),
    };
  });
  regions.sort(
    (p, q) =>
      p.fromFrame - q.fromFrame ||
      cmpStr(p.cls, q.cls) ||
      p.x - q.x ||
      p.y - q.y ||
      p.toFrame - q.toFrame,
  );
  return regions;
}

/** `between(t,a,b)` bounds for an inclusive frame range, padded half a frame so no frame is missed. */
export function frameRangeSeconds(
  fromFrame: number,
  toFrame: number,
  fps: number = DELIVERY_FPS,
): [string, string] {
  const a = Math.max(0, (fromFrame - 0.5) / fps);
  const b = (toFrame + 0.5) / fps;
  return [a.toFixed(4), b.toFixed(4)];
}

/**
 * Filter graph: [0:v] → fps → one crop/blur/overlay stage per region (each enabled only inside its
 * time range) → split and scale per rendition. Stage k:
 *   [vk]split[vkm][vkc];[vkc]crop=w:h:x:y,gblur=sigma=S:steps=3:enable='…'[rk];
 *   [vkm][rk]overlay=x:y:enable='between(t,a,b)'[vk+1]
 */
export function buildBlurFilterGraph(
  regions: readonly BlurRegion[],
  outputs: readonly RenditionOutput[],
  fps: number = DELIVERY_FPS,
): { graph: string; outLabels: string[] } {
  const st: string[] = [`[0:v:0]fps=${fps}[v0]`];
  regions.forEach((r, k) => {
    const [a, b] = frameRangeSeconds(r.fromFrame, r.toFrame, fps);
    const en = `enable='between(t,${a},${b})'`;
    st.push(`[v${k}]split[v${k}m][v${k}c]`);
    st.push(`[v${k}c]crop=${r.w}:${r.h}:${r.x}:${r.y},gblur=sigma=${r.sigma}:steps=3:${en}[r${k}]`);
    st.push(`[v${k}m][r${k}]overlay=${r.x}:${r.y}:${en}[v${k + 1}]`);
  });
  const g = renditionGraph(`v${regions.length}`, outputs);
  st.push(...g.statements);
  return { graph: st.join(";"), outLabels: g.labels };
}

export interface BlurRenderOptions {
  /** The mezzanine from the `transcode` step (constant 30 fps, metadata already stripped). */
  readonly input: string;
  readonly frame: FrameSize;
  readonly detections: readonly Detection[];
  readonly outputs: readonly RenditionOutput[];
  readonly totalFrames?: number;
  readonly policy?: BlurPolicy;
  readonly threads?: number;
  /**
   * When set, the graph is passed as a file (`-/filter_complex <file>`, ffmpeg ≥ 7) instead of
   * inline, for clips with many regions (Windows caps a command line at 32 767 chars). The caller
   * writes `filterGraph` to this path before spawning.
   */
  readonly graphFile?: string;
  readonly binaries?: Binaries;
}

export interface BlurRender {
  readonly command: Command;
  readonly filterGraph: string;
  readonly regions: readonly BlurRegion[];
}

/** Inline graphs longer than this should go through `graphFile`. */
export const MAX_INLINE_GRAPH_CHARS = 24_000;

/** Step `blur`: blurred 360p/480p delivery renditions from the mezzanine in one decode. */
export function buildBlurArgv(o: BlurRenderOptions): BlurRender {
  assertSafeMediaPath(o.input, "input");
  const regions = planBlurRegions(o.detections, o.frame, {
    ...(o.policy ? { policy: o.policy } : {}),
    ...(o.totalFrames !== undefined ? { totalFrames: o.totalFrames } : {}),
  });
  const { graph, outLabels } = buildBlurFilterGraph(regions, o.outputs, ENCODER.fps);
  if (o.graphFile === undefined && graph.length > MAX_INLINE_GRAPH_CHARS) {
    throw new RangeError(`filter graph is ${graph.length} chars; pass graphFile`);
  }
  const args: string[] = [...FFMPEG_PREAMBLE, "-i", o.input];
  if (o.graphFile !== undefined)
    args.push("-/filter_complex", assertSafeMediaPath(o.graphFile, "graphFile"));
  else args.push("-filter_complex", graph);
  o.outputs.forEach((out, k) => {
    args.push(
      "-map",
      `[${outLabels[k]}]`,
      ...encodeArgs(out.res, o.threads !== undefined ? { threads: o.threads } : {}),
      assertSafeMediaPath(out.path, "output"),
    );
  });
  return { command: { file: o.binaries?.ffmpeg ?? "ffmpeg", args }, filterGraph: graph, regions };
}

// ---------------------------------------------------------------------------------------------
// Blur audit (NAZAR §5 "Audit"; MD-218)

export interface BlurAuditMiss {
  readonly frame: number;
  readonly kind: "face" | "plate" | "other_pii";
  readonly note?: string;
}

/** The full audit record kept by the API; clip.json carries the four-field summary. */
export interface BlurAuditRecord {
  readonly clipId: string;
  readonly version: number;
  /** Pseudonym of the human auditor. */
  readonly auditor: string;
  /** sha256 of the exact rendition audited; a re-blur produces new bytes and needs a new audit. */
  readonly renditionSha256: string;
  readonly framesTotal: number;
  readonly framesChecked: number;
  readonly misses: number;
  readonly missFrames: readonly BlurAuditMiss[];
  readonly auditedAt: string;
}

export function blurAuditIssues(
  a: BlurAuditRecord,
  expect: { mediaSha256?: string } = {},
): string[] {
  const issues: string[] = [];
  if (!PSEUDONYM_RE.test(a.auditor)) issues.push("auditor must be a pseudonym");
  if (!Number.isInteger(a.framesTotal) || a.framesTotal <= 0)
    issues.push("framesTotal must be a positive integer");
  if (a.framesChecked < a.framesTotal)
    issues.push(`checked ${a.framesChecked} of ${a.framesTotal} frames (100% required)`);
  if (a.misses !== 0) issues.push(`${a.misses} misses (0 required)`);
  if (a.missFrames.length !== a.misses) issues.push("misses does not match missFrames");
  if (expect.mediaSha256 !== undefined && expect.mediaSha256 !== a.renditionSha256) {
    issues.push("audit was for different bytes than the rendition being published");
  }
  if (Number.isNaN(Date.parse(a.auditedAt))) issues.push("auditedAt is not a timestamp");
  return issues;
}

/** True only for a 100%-of-frames audit with zero misses (on the expected bytes, if given). */
export function blurAuditPasses(
  a: BlurAuditRecord,
  expect: { mediaSha256?: string } = {},
): boolean {
  return blurAuditIssues(a, expect).length === 0;
}

/** clip.json `blurAudit` summary from the full record. */
export function toClipBlurAudit(a: BlurAuditRecord): {
  auditor: string;
  framesChecked: number;
  misses: number;
  auditedAt: string;
} {
  return {
    auditor: a.auditor,
    framesChecked: a.framesChecked,
    misses: a.misses,
    auditedAt: a.auditedAt,
  };
}

/** Turns audit misses into manual masks for the re-blur ("back to blur with manual masks"). */
export function manualMask(box: NormBox, fromFrame: number, toFrame: number): Detection {
  return { cls: "manual", score: 1, box, fromFrame, toFrame };
}

// ---------------------------------------------------------------------------------------------
// Raw-footage deletion (MD-218; NAZAR §4: after the audit passes and always within 7 days;
// DATA_PIPELINE §2: within 24 h of audit_pass)

export const RAW_RETENTION_MS = 7 * 24 * 3600 * 1000;
export const RAW_AFTER_AUDIT_MS = 24 * 3600 * 1000;

export interface RawDeletionRecord {
  readonly clipId: string;
  readonly version: number;
  /** Object keys removed: the raw upload, the mezzanine and any unblurred intermediates. */
  readonly objectKeys: readonly string[];
  readonly reason: "audit_passed" | "retention_limit" | "takedown";
  readonly uploadedAt: string;
  readonly auditPassedAt: string | null;
  readonly deletedAt: string;
  /** `clip_finalize` (the workflow) or a pseudonym. */
  readonly deletedBy: string;
}

/** Latest allowed deletion time: min(upload + 7 days, audit pass + 24 h). */
export function rawDeletionDeadline(uploadedAt: string, auditPassedAt: string | null): string {
  const up = Date.parse(uploadedAt);
  if (Number.isNaN(up)) throw new RangeError(`bad uploadedAt ${uploadedAt}`);
  let deadline = up + RAW_RETENTION_MS;
  if (auditPassedAt !== null) {
    const ap = Date.parse(auditPassedAt);
    if (Number.isNaN(ap)) throw new RangeError(`bad auditPassedAt ${auditPassedAt}`);
    deadline = Math.min(deadline, ap + RAW_AFTER_AUDIT_MS);
  }
  return new Date(deadline).toISOString();
}

export function checkRawDeletion(r: RawDeletionRecord): {
  onTime: boolean;
  deadline: string;
  issues: string[];
} {
  const issues: string[] = [];
  const deadline = rawDeletionDeadline(r.uploadedAt, r.auditPassedAt);
  const del = Date.parse(r.deletedAt);
  if (Number.isNaN(del)) issues.push("deletedAt is not a timestamp");
  if (r.objectKeys.length === 0) issues.push("no object keys recorded");
  if (r.objectKeys.some((k) => /^[a-z]+:\/\//i.test(k) || k.includes("?"))) {
    issues.push("record object keys, not URLs (no signed URLs in logs)");
  }
  if (r.reason === "audit_passed") {
    if (r.auditPassedAt === null) issues.push("reason audit_passed without an audit pass");
    else if (del < Date.parse(r.auditPassedAt)) issues.push("deleted before the audit passed");
  }
  if (r.deletedBy !== "clip_finalize" && !PSEUDONYM_RE.test(r.deletedBy))
    issues.push("deletedBy must be the workflow or a pseudonym");
  const onTime = !Number.isNaN(del) && del <= Date.parse(deadline);
  if (!onTime) issues.push(`deleted after the deadline ${deadline}`);
  return { onTime, deadline, issues };
}
