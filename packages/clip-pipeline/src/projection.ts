// Projections of a clip for its two consumers:
//   - toScoringClip: what the game-core Nazar scorer and the score verifier need (server side, and
//     the replay endpoint after API-35). Same field names as clip.json.
//   - toClientManifestEntry: what API-37 may send to a browser. Built from an allowlist, field by
//     field, never by spreading the clip, so a new server-only field cannot leak by default.
//     API-37: "Hazard windows are never sent to clients." We also drop everything that would hint
//     at where hazards are: quiet segments (their complement is the windows), cue text, hazard
//     count and types, rater deltas; plus server-only data (blur auditor pseudonym, empirical and
//     IRT difficulty, taker counts, speed, capture month).
//   AI-generated clips (ADR-0013) carry `origin: "ai_generated"` so every client surface can label
//   them. Filmed entries leave the key out (absent = filmed), so their bytes and digests are exactly
//   what consumers with strict response schemas (the score verifier) already accept. The generation
//   record stays server-side.
import { z } from "zod";
import { type Clip, ClipSchema, clipRef, HazardTypeSchema, type Rendition } from "./schema.ts";

export const ScoringClipSchema = z.strictObject({
  clipId: z.string(),
  version: z.int().min(1),
  /** Required: game-core's NazarClip needs it for `metres = late_s × speed / 3.6`. */
  speedKmhEst: z.number().min(0).max(150),
  durationMs: z.int().positive(),
  hazards: z.array(
    z.strictObject({
      hazardId: z.string(),
      hazardType: HazardTypeSchema,
      window: z.strictObject({ aMs: z.int().nonnegative(), bMs: z.int().positive() }),
    }),
  ),
  quietSegments: z.array(
    z.strictObject({ fromMs: z.int().nonnegative(), toMs: z.int().positive() }),
  ),
});
export type ScoringClip = z.infer<typeof ScoringClipSchema>;

/** Scoring content for game-core. Published clips, and retired ones (old sessions still replay). */
export function toScoringClip(input: Clip): ScoringClip {
  const clip = ClipSchema.parse(input);
  if (clip.status !== "published" && clip.status !== "retired") {
    throw new Error(
      `scoring content only exists for published or retired clips (${clipRef(clip)} is ${clip.status})`,
    );
  }
  if (clip.speedKmhEst === null) {
    throw new Error(`${clipRef(clip)} has no speed estimate, so it cannot be scored`);
  }
  return {
    clipId: clip.clipId,
    version: clip.version,
    speedKmhEst: clip.speedKmhEst,
    durationMs: clip.durationMs,
    hazards: [...clip.hazards]
      .sort((x, y) => x.window.aMs - y.window.aMs || x.window.bMs - y.window.bMs)
      .map((h) => ({
        hazardId: h.hazardId,
        hazardType: h.hazardType,
        window: { aMs: h.window.aMs, bMs: h.window.bMs },
      })),
    quietSegments: [...clip.quietSegments]
      .sort((x, y) => x.fromMs - y.fromMs)
      .map((q) => ({ fromMs: q.fromMs, toMs: q.toMs })),
  };
}

export interface ClientMedia {
  readonly res: Rendition;
  readonly bytes: number;
  readonly sha256: string;
  readonly url: string;
}

export interface ClientManifestEntry {
  /** `clip:JMU-0012@3`, the SessionContext item ref format (GAME_SDK §3). */
  readonly ref: string;
  readonly clipId: string;
  readonly version: number;
  readonly durationMs: number;
  readonly tenantTags: readonly string[];
  readonly city: string;
  readonly roadType: string;
  readonly timeOfDay: string;
  readonly weather: string;
  readonly pov: string;
  readonly modules: readonly string[];
  readonly licence: string;
  readonly attribution: string;
  readonly media: readonly ClientMedia[];
  readonly totalBytes: number;
  readonly mockEligible: boolean;
  /** Curator level for offline practice staircases; omitted for mock-eligible clips. */
  readonly curatorDifficulty?: number;
  /** Present (and only) for AI-generated clips: the UI shows "AI-generated scene" (ADR-0013). */
  readonly origin?: "ai_generated";
}

/** Object key of a published rendition, e.g. `clips/JMU-0012/v3/360p.mp4`. */
export function mediaObjectKey(clipId: string, version: number, res: Rendition): string {
  return `clips/${clipId}/v${version}/${res}.mp4`;
}

export interface ClientEntryOptions {
  readonly mockEligible: boolean;
  /** Public or signed URL for a rendition; defaults to the relative object key. */
  readonly urlFor?: (clipId: string, version: number, res: Rendition) => string;
}

export function toClientManifestEntry(input: Clip, opts: ClientEntryOptions): ClientManifestEntry {
  const clip = ClipSchema.parse(input);
  if (clip.status !== "published")
    throw new Error(`only published clips go to clients (${clipRef(clip)} is ${clip.status})`);
  const urlFor = opts.urlFor ?? mediaObjectKey;
  const media = [...clip.media]
    .sort((x, y) => (x.res < y.res ? -1 : x.res > y.res ? 1 : 0))
    .map((m) => ({
      res: m.res,
      bytes: m.bytes,
      sha256: m.sha256,
      url: urlFor(clip.clipId, clip.version, m.res),
    }));
  const entry: ClientManifestEntry = {
    ref: `clip:${clipRef(clip)}`,
    clipId: clip.clipId,
    version: clip.version,
    durationMs: clip.durationMs,
    tenantTags: [...clip.tenantTags],
    city: clip.city,
    roadType: clip.roadType,
    timeOfDay: clip.timeOfDay,
    weather: clip.weather,
    pov: clip.pov,
    modules: [...clip.modules],
    licence: clip.licence,
    attribution: clip.attribution,
    media,
    totalBytes: media.reduce((s, m) => s + m.bytes, 0),
    mockEligible: opts.mockEligible,
    ...(clip.origin === "ai_generated" ? { origin: "ai_generated" as const } : {}),
  };
  if (!opts.mockEligible && clip.difficulty.curator !== null) {
    return { ...entry, curatorDifficulty: clip.difficulty.curator };
  }
  return entry;
}
