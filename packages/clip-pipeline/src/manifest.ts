// Manifests built by `publish_manifest` (ARCHITECTURE §8) from validated clips.
//
// Two manifests, because the specs ask for two different things:
//   - The bank manifest (NAZAR §11, DATA_PIPELINE §2 `publish`): the CC-BY 4.0 record of every
//     published clip version with media hashes and the final hazard windows, plus `retired` stubs
//     for taken-down clips (NAZAR §5). It is what the score verifier and the API read. Rater
//     pseudonyms are removed (§11: "clip.json without rater pseudonyms"), so the blur audit keeps
//     only frames, misses and time.
//   - The client manifest (API-37): published clips for browsers, with no hazard information at
//     all (projection.ts).
// Both are deterministic: one entry per clipId (its highest published-or-retired version), sorted
// by clipId, and a sha256 digest over the canonical JSON of the entries. `generatedAt` comes from
// the caller (these functions never read the clock).
import { canonicalJSON, cmpStr, sha256Hex } from "./math.ts";
import { type ClientManifestEntry, mediaObjectKey, toClientManifestEntry } from "./projection.ts";
import {
  ATTRIBUTION,
  type Clip,
  ClipSchema,
  clipRef,
  type Generation,
  LICENCE,
  RENDITIONS,
  type Rendition,
  type SyntheticReview,
} from "./schema.ts";
import { checkInvariants } from "./status.ts";

export const BANK_MANIFEST_SCHEMA = "margdarshak.nazar.bank-manifest/1";
export const CLIENT_MANIFEST_SCHEMA = "margdarshak.nazar.client-manifest/1";

export interface BankMedia {
  readonly res: Rendition;
  readonly bytes: number;
  readonly sha256: string;
  readonly key: string;
}

export interface PublishedBankEntry {
  readonly ref: string;
  readonly clipId: string;
  readonly version: number;
  readonly status: "published";
  readonly tenantTags: readonly string[];
  readonly city: string;
  readonly roadType: string;
  readonly timeOfDay: string;
  readonly weather: string;
  readonly pov: string;
  readonly capturedMonth: string;
  readonly speedKmhEst: number | null;
  readonly speedSource: string;
  readonly durationMs: number;
  readonly hazards: Clip["hazards"];
  readonly quietSegments: Clip["quietSegments"];
  readonly difficulty: Clip["difficulty"];
  readonly modules: readonly string[];
  readonly licence: string;
  readonly attribution: string;
  /** null for AI-generated clips, which have no blur audit (ADR-0013). */
  readonly blurAudit: {
    readonly framesChecked: number;
    readonly misses: number;
    readonly auditedAt: string;
  } | null;
  readonly media: readonly BankMedia[];
  /** AI-generated clips only (filmed entries keep their pre-ADR-0013 shape). */
  readonly origin?: "ai_generated";
  readonly generation?: Generation;
  /** The curator's synthetic review without the reviewer pseudonym (NAZAR §11). */
  readonly syntheticReview?: Omit<SyntheticReview, "reviewer">;
}

export interface RetiredBankEntry {
  readonly ref: string;
  readonly clipId: string;
  readonly version: number;
  readonly status: "retired";
  readonly licence: string;
  readonly attribution: string;
}

export type BankEntry = PublishedBankEntry | RetiredBankEntry;

export interface BankManifest {
  readonly schema: typeof BANK_MANIFEST_SCHEMA;
  readonly generatedAt: string;
  readonly licence: string;
  readonly attribution: string;
  readonly counts: { readonly published: number; readonly retired: number };
  readonly digest: string;
  readonly clips: readonly BankEntry[];
}

/** Highest published-or-retired version per clipId; clips still in the pipeline are ignored. */
export function latestReleasedVersions(clips: readonly Clip[]): Clip[] {
  const best = new Map<string, Clip>();
  for (const c of clips) {
    if (c.status !== "published" && c.status !== "retired") continue;
    const prev = best.get(c.clipId);
    if (prev && prev.version === c.version && prev.status !== c.status) {
      throw new Error(`${clipRef(c)} is both published and retired`);
    }
    if (!prev || c.version > prev.version) best.set(c.clipId, c);
  }
  return [...best.values()].sort((x, y) => cmpStr(x.clipId, y.clipId));
}

function validated(clips: readonly Clip[]): Clip[] {
  return clips.map((c) => {
    const clip = ClipSchema.parse(c);
    if (clip.status === "published") {
      const v = checkInvariants(clip);
      if (v.length)
        throw new Error(
          `${clipRef(clip)} is not publishable: ${v.map((x) => x.message).join("; ")}`,
        );
    }
    return clip;
  });
}

function bankEntry(c: Clip): BankEntry {
  const ref = clipRef(c);
  if (c.status === "retired") {
    return {
      ref,
      clipId: c.clipId,
      version: c.version,
      status: "retired",
      licence: c.licence,
      attribution: c.attribution,
    };
  }
  const ai = c.origin === "ai_generated";
  const audit = c.blurAudit;
  if (!ai && !audit) throw new Error(`${ref} has no blur audit`);
  const entry: PublishedBankEntry = {
    ref,
    clipId: c.clipId,
    version: c.version,
    status: "published",
    tenantTags: [...c.tenantTags],
    city: c.city,
    roadType: c.roadType,
    timeOfDay: c.timeOfDay,
    weather: c.weather,
    pov: c.pov,
    capturedMonth: c.capturedMonth,
    speedKmhEst: c.speedKmhEst,
    speedSource: c.speedSource,
    durationMs: c.durationMs,
    hazards: [...c.hazards].sort(
      (x, y) => x.window.aMs - y.window.aMs || cmpStr(x.hazardId, y.hazardId),
    ),
    quietSegments: [...c.quietSegments].sort((x, y) => x.fromMs - y.fromMs),
    difficulty: c.difficulty,
    modules: [...c.modules],
    licence: c.licence,
    attribution: c.attribution,
    blurAudit: audit
      ? { framesChecked: audit.framesChecked, misses: audit.misses, auditedAt: audit.auditedAt }
      : null,
    media: RENDITIONS.flatMap((res) => {
      const m = c.media.find((x) => x.res === res);
      return m
        ? [{ res, bytes: m.bytes, sha256: m.sha256, key: mediaObjectKey(c.clipId, c.version, res) }]
        : [];
    }),
  };
  if (!ai) return entry;
  if (!c.generation || !c.syntheticReview)
    throw new Error(`${ref} is ai_generated without its generation record or synthetic review`);
  const { reviewer: _reviewer, ...review } = c.syntheticReview;
  return { ...entry, origin: "ai_generated", generation: c.generation, syntheticReview: review };
}

export function buildBankManifest(
  clips: readonly Clip[],
  opts: { generatedAt: string },
): BankManifest {
  if (Number.isNaN(Date.parse(opts.generatedAt)))
    throw new RangeError(`bad generatedAt ${opts.generatedAt}`);
  const entries = latestReleasedVersions(validated(clips)).map(bankEntry);
  return {
    schema: BANK_MANIFEST_SCHEMA,
    generatedAt: opts.generatedAt,
    licence: LICENCE,
    attribution: `${ATTRIBUTION}, CC-BY 4.0`,
    counts: {
      published: entries.filter((e) => e.status === "published").length,
      retired: entries.filter((e) => e.status === "retired").length,
    },
    digest: sha256Hex(canonicalJSON(entries)),
    clips: entries,
  };
}

export interface ClientManifest {
  readonly schema: typeof CLIENT_MANIFEST_SCHEMA;
  readonly generatedAt: string;
  readonly licence: string;
  readonly attribution: string;
  readonly totalBytes: Readonly<Record<Rendition, number>>;
  readonly digest: string;
  readonly clips: readonly ClientManifestEntry[];
}

export interface ClientManifestOptions {
  readonly generatedAt: string;
  /** Mock eligibility per clip (status.ts mockEligibility, with the stored flash result). */
  readonly isMockEligible: (clip: Clip) => boolean;
  /** API-37 `state=` filter: keep clips tagged with this tenant. */
  readonly tenant?: string;
  /** API-37 `resolution=` filter: keep only this rendition in each entry. */
  readonly resolution?: Rendition;
  readonly urlFor?: (clipId: string, version: number, res: Rendition) => string;
}

/** API-37 manifest: published clips only, no hazard windows, `total_bytes` before any download. */
export function buildClientManifest(
  clips: readonly Clip[],
  opts: ClientManifestOptions,
): ClientManifest {
  if (Number.isNaN(Date.parse(opts.generatedAt)))
    throw new RangeError(`bad generatedAt ${opts.generatedAt}`);
  const entries = latestReleasedVersions(validated(clips))
    .filter((c) => c.status === "published")
    .filter((c) => opts.tenant === undefined || c.tenantTags.includes(opts.tenant))
    .map((c) => {
      const e = toClientManifestEntry(c, {
        mockEligible: opts.isMockEligible(c),
        ...(opts.urlFor ? { urlFor: opts.urlFor } : {}),
      });
      if (opts.resolution === undefined) return e;
      const media = e.media.filter((m) => m.res === opts.resolution);
      return { ...e, media, totalBytes: media.reduce((s, m) => s + m.bytes, 0) };
    });
  const totalBytes = { "360p": 0, "480p": 0 } as Record<Rendition, number>;
  for (const e of entries) for (const m of e.media) totalBytes[m.res] += m.bytes;
  return {
    schema: CLIENT_MANIFEST_SCHEMA,
    generatedAt: opts.generatedAt,
    licence: LICENCE,
    attribution: `${ATTRIBUTION}, CC-BY 4.0`,
    totalBytes,
    digest: sha256Hex(canonicalJSON(entries)),
    clips: entries,
  };
}
