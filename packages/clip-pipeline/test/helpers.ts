import type { RaterMark, RaterSubmission } from "../src/agreement.ts";
import { sha256Hex } from "../src/math.ts";
import type { Clip } from "../src/schema.ts";

export const SHA_360 = sha256Hex("JMU-0012@3/360p");
export const SHA_480 = sha256Hex("JMU-0012@3/480p");

/** The NAZAR §3.2 example, with real hashes: a valid published clip. */
export function specClip(): Clip {
  return {
    clipId: "JMU-0012",
    version: 3,
    status: "published",
    tenantTags: ["JK"],
    city: "Jammu",
    roadType: "urban_arterial",
    timeOfDay: "day",
    weather: "clear",
    pov: "2W",
    capturedMonth: "2026-10",
    speedKmhEst: 40,
    speedSource: "rider_log",
    durationMs: 38000,
    hazards: [
      {
        hazardId: "h1",
        hazardType: "bus_stop_pedestrian",
        window: { aMs: 12400, bMs: 16900 },
        raterCount: 2,
        deltaOnsetMs: 300,
        deltaEndMs: 600,
        adjudicated: false,
        occlusion: true,
        cueText: {
          en: "Feet visible at the bus's front edge",
          hi: "बस के आगे वाले किनारे पर पैर दिख रहे हैं",
        },
      },
    ],
    quietSegments: [{ fromMs: 0, toMs: 9000 }],
    difficulty: { curator: 3, empirical: null, irt: null, nTakers: 0 },
    modules: ["M18", "M5"],
    licence: "CC-BY-4.0",
    attribution: "Margdarshak clip bank, team Chanakya (Nestiq Private Limited), 2026",
    blurAudit: {
      auditor: "rater-07",
      framesChecked: 1140,
      misses: 0,
      auditedAt: "2026-10-23T09:12:00Z",
    },
    media: [
      { res: "360p", bytes: 1840000, sha256: SHA_360 },
      { res: "480p", bytes: 2900000, sha256: SHA_480 },
    ],
    origin: "filmed",
  };
}

/** A published AI-generated clip (ADR-0013): generation record and synthetic review, no blur audit. */
export function aiClip(over: Partial<Clip> = {}): Clip {
  return {
    ...specClip(),
    clipId: "AIG-0004",
    version: 1,
    city: "Kerala",
    tenantTags: ["KL"],
    capturedMonth: "2026-10",
    speedKmhEst: 30,
    speedSource: "scene_spec",
    durationMs: 32000,
    blurAudit: null,
    origin: "ai_generated",
    generation: {
      model: "gemini-omni-1.1-flash",
      sceneId: "SCN-001",
      promptVersion: "1.0.0",
      seedOrBatchId: "b20261024a",
      generatedAt: "2026-10",
      durationMs: 32000,
      extensions: 3,
      synthId: true,
      disclosure: "ai_generated",
    },
    syntheticReview: {
      reviewer: "curator-02",
      checkedAt: "2026-10-24T08:00:00Z",
      noRealPersonLikeness: true,
      noReadablePlates: true,
      noRealBrands: true,
      noCollisionOrInjury: true,
      hazardVisible: true,
    },
    ...over,
  };
}

export function clipWith(over: Partial<Clip>): Clip {
  return { ...specClip(), ...over };
}

/** A clip as it stands before any rating (status given), no final windows. */
export function pipelineClip(status: Clip["status"]): Clip {
  return clipWith({ status, hazards: [], quietSegments: [], blurAudit: null });
}

export function mark(
  hazardType: RaterMark["hazardType"],
  aMs: number,
  bMs: number,
  extra: Partial<RaterMark> = {},
): RaterMark {
  return { hazardType, aMs, bMs, ...extra };
}

export function rating(
  rater: string,
  marks: RaterMark[],
  clipId = "JMU-0012",
  version = 3,
): RaterSubmission {
  return { rater, clipId, version, marks, submittedAt: "2026-10-23T10:00:00Z" };
}

/** Every key path in a JSON value (for leak scans). */
export function allKeys(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((e, i) => allKeys(e, `${prefix}[${i}]`));
  if (v !== null && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      `${prefix}.${k}`,
      ...allKeys(x, `${prefix}.${k}`),
    ]);
  }
  return [];
}
