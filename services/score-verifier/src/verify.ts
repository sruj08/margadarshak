// POST /verify: the request contract and the replay itself.
//
// The request is the flat shape of ARCHITECTURE §6 (`{gameId, gameVersion, scoringVersion, seed,
// items, inputs}`) extended with what GAME_SDK §6.3 and API-35 need to rebuild the session: the
// session's identity and mode, the replay envelope (encoding, digest, eventCount), the tenant and
// rule-pack version (they select formats such as LLT-<state>), optional non-scoring context, the
// client's preview result for comparison and server-side integrity hints.
//
// P2 additions (both optional, so older callers are unchanged):
//   content.items  scoring documents sent inline (e.g. `clip:` documents the Go API keeps in its
//                  database); they win over the verifier's own store (CompositeContentStore).
//   analysis       per-clip Nazar analysis (`analyseNazarClips`) under the product rule
//                  ("nazar_clips") and/or the field-kit study rule ("nazar_clips_linear"). The study
//                  export needs per-clip late_s, which SessionResult does not keep.

import {
  type ComparisonResult,
  compareResults,
  withIntegrityFlags,
} from "@margdarshak/game-core/integrity";
import {
  A11yMode,
  GameId,
  GameMode,
  ReplayEncoding,
  type ReplayManifest,
  type ReplayPackage,
  ScoringVersion,
  SeedOrigin,
  SemVer,
  SessionContext,
  SessionItem,
  type SessionResult,
} from "@margdarshak/game-core/schema";
import type { ClipAnalysis } from "@margdarshak/game-core/scoring";
import {
  analyseNazarClips,
  GAME_CONFIG,
  replayAsync,
  SCORING_VERSIONS,
} from "@margdarshak/game-core/scoring";
import { canonicalDigest, decodeReplayAsync } from "@margdarshak/game-core/sdk";
import { z } from "zod";
import {
  CompositeContentStore,
  type ContentStore,
  indexInline,
  inlineKey,
} from "./content-store.ts";

export const ANALYSIS_KINDS = ["nazar_clips", "nazar_clips_linear"] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];
const RULE_OF: Record<AnalysisKind, "kerala_5band" | "field_kit_linear"> = {
  nazar_clips: "kerala_5band",
  nazar_clips_linear: "field_kit_linear",
};

/** Inline content documents: each must identify itself (see `inlineKey`) and appear once. */
export const InlineContentRequest = z
  .object({ items: z.array(z.unknown()).min(1).max(48) })
  .strict()
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.items.forEach((doc, i) => {
      const k = inlineKey(doc);
      if (k === null) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i],
          message:
            "inline document has no ref: send {ref, doc}, a rule-pack row with rule_id, or a document with clipId+version, trackId+version or qref",
        });
        return;
      }
      const key = k.kind === "doc" ? k.ref : `format:${k.id}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["items", i], message: `duplicate inline ${key}` });
      }
      seen.add(key);
    });
  });

export const VerifyRequest = z
  .object({
    sid: z.uuid(),
    gameId: GameId,
    gameVersion: SemVer,
    scoringVersion: ScoringVersion,
    mode: GameMode,
    difficulty: z.number().int().min(1).max(5),
    seed: z.number().int().nonnegative().max(4294967295),
    seedOrigin: SeedOrigin,
    items: z.array(SessionItem).max(40),
    tenant: z.string().regex(/^[A-Z][A-Z0-9_]{1,15}$/),
    rulePackVersion: z.string().min(1).max(32),
    // Replay envelope (GAME_SDK §5.3): base64 inputs, encoding, canonical events digest.
    telemetryVersion: z.literal(1).default(1),
    encoding: ReplayEncoding.default("mdr1"),
    inputs: z
      .string()
      .max(524_288)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    eventCount: z.number().int().min(0).max(5000),
    // Non-scoring context; defaults are used when the API does not send it.
    context: z
      .object({
        userBand: z.enum(["u18", "adult"]).optional(),
        locale: z.enum(["en", "hi"]).optional(),
        a11yModes: z.array(A11yMode).max(8).optional(),
        deviceClass: z.enum(["low", "mid", "high"]).optional(),
        offline: z.boolean().optional(),
        serverStartIso: z.iso.datetime().nullable().optional(),
      })
      .strict()
      .optional(),
    // The client's preview, only for comparison (the server result always wins).
    clientResult: z
      .object({
        score: z.object({ pct: z.number() }).loose(),
        findings: z.array(z.object({ findingId: z.string().max(40) }).loose()).max(64),
      })
      .loose()
      .optional(),
    // Knowledge only the API has (GAME_SDK §6.5).
    hints: z
      .object({ seenClip: z.boolean().optional(), sessionExpired: z.boolean().optional() })
      .strict()
      .optional(),
    // Scoring documents sent by the API (first in lookup order).
    content: InlineContentRequest.optional(),
    // Per-clip analysis to return next to the result (Nazar only).
    analysis: z
      .array(z.enum(ANALYSIS_KINDS))
      .min(1)
      .max(2)
      .refine((a) => new Set(a).size === a.length, { message: "duplicate analysis kind" })
      .optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.analysis !== undefined && r.gameId !== "nazar") {
      ctx.addIssue({
        code: "custom",
        path: ["analysis"],
        message: "analysis is only available for gameId nazar",
      });
    }
  });
export type VerifyRequest = z.infer<typeof VerifyRequest>;

/** One hazard of one clip, as plain JSON. */
export interface HazardAnalysis {
  hazardId: string;
  hazardType: string;
  /** 5-band: points 0–5; linear: fraction 0–1 of full marks. */
  credit: number;
  /** 5-band index 1 (earliest) … 5; null when not credited or under the linear rule. */
  band: 1 | 2 | 3 | 4 | 5 | null;
  /** Media time (ms) of the crediting tap; null when not credited. */
  tapMt: number | null;
  /** Seconds after the full-marks window (rounded to 0.1 s); null when not credited. */
  lateS: number | null;
  /** lateS × speed / 3.6 (0.1 m); null when not credited. */
  metres: number | null;
  /** Learn mode: the "what happens next?" answer paired with this hazard. */
  prediction: string | null;
}

/** One clip's analysis, as plain JSON (game-core ClipAnalysis without the clip document). */
export interface ClipAnalysisJson {
  ordinal: number;
  ref: string;
  voided: "pattern" | "INT_TAB_HIDDEN" | "INT_CLOCK_DRIFT" | null;
  taps: number;
  maxTapsInWindow: number;
  earlyTaps: number;
  falseAlarms: number;
  /** Kerala marks 0–10 (5-band) or 0–10 (linear) before scaling to the format. */
  marks: number;
  hazards: HazardAnalysis[];
}

export interface NazarAnalysis {
  rule: "kerala_5band" | "field_kit_linear";
  clips: ClipAnalysisJson[];
}

export function reduceClip(c: ClipAnalysis, ref: string): ClipAnalysisJson {
  return {
    ordinal: c.ordinal,
    ref,
    voided: c.voided,
    taps: c.tapCount,
    maxTapsInWindow: c.maxTapsInWindow,
    earlyTaps: c.earlyTaps,
    falseAlarms: c.falseAlarms,
    marks: c.marks,
    hazards: c.hazards.map((h) => ({
      hazardId: h.hazard.hazardId,
      hazardType: h.hazard.hazardType,
      credit: h.credit,
      band: h.band,
      tapMt: h.tapMt,
      lateS: h.lateS,
      metres: h.metres,
      prediction: h.prediction,
    })),
  };
}

export interface VerifyResponse {
  /** The authoritative SessionResult (server replay). */
  result: SessionResult;
  /** sha256 over the canonical JSON of `result` (the CI determinism hash). */
  digest: string;
  /** sha256 over the canonical decoded events (equals the request's digest). */
  eventsDigest: string;
  /** Client preview vs server result; null when no client result was sent. */
  comparison: ComparisonResult | null;
  serverChecked: true;
  /** Present only when the request asked for it, keyed by analysis kind. */
  analysis?: Partial<Record<AnalysisKind, NazarAnalysis>>;
}

export function toContext(r: VerifyRequest): SessionContext {
  return SessionContext.parse({
    sid: r.sid,
    gameId: r.gameId,
    mode: r.mode,
    userBand: r.context?.userBand ?? "adult",
    locale: r.context?.locale ?? "en",
    a11y: { modes: r.context?.a11yModes ?? [], textScale: 1, haptics: false },
    difficulty: r.difficulty,
    seed: r.seed,
    seedOrigin: r.seedOrigin,
    items: r.items,
    deviceClass: r.context?.deviceClass ?? "mid",
    offline: r.context?.offline ?? false,
    serverStartIso: r.context?.serverStartIso ?? null,
    tenant: r.tenant,
    rulePackVersion: r.rulePackVersion,
  });
}

export function toManifest(r: VerifyRequest): ReplayManifest {
  return {
    gameId: r.gameId,
    version: r.gameVersion,
    scoringVersion: r.scoringVersion,
    budgets: GAME_CONFIG.budgets[r.gameId],
  };
}

export function isSupported(
  r: Pick<VerifyRequest, "gameId" | "scoringVersion">,
): "ok" | "game" | "version" {
  const versions = SCORING_VERSIONS[r.gameId];
  if (versions === undefined) return "game";
  return versions.includes(r.scoringVersion) ? "ok" : "version";
}

/** Replays the session server-side; throws ReplayError for unscorable input. */
export async function verifySession(
  r: VerifyRequest,
  store: ContentStore,
): Promise<VerifyResponse> {
  const ctx = toContext(r);
  const source =
    r.content === undefined
      ? store
      : new CompositeContentStore(indexInline(r.content.items), store);
  const content = await source.load(ctx);
  const pkg: ReplayPackage = {
    telemetryVersion: r.telemetryVersion,
    encoding: r.encoding,
    seed: r.seed,
    inputs: r.inputs,
    digest: r.digest,
    eventCount: r.eventCount,
  };
  const hints = {
    ...(r.hints?.seenClip === undefined ? {} : { seenClip: r.hints.seenClip }),
    ...(r.hints?.sessionExpired === undefined ? {} : { sessionExpired: r.hints.sessionExpired }),
  };
  let result = await replayAsync(toManifest(r), ctx, pkg, content, { hints, provisional: false });
  let comparison: ComparisonResult | null = null;
  if (r.clientResult !== undefined) {
    comparison = compareResults(r.clientResult, result);
    // The server result always wins; a mismatch only costs trust (never an accusation).
    if (!comparison.match) result = withIntegrityFlags(result, ["INT_REPLAY_MISMATCH"]);
  }
  const out: VerifyResponse = {
    result,
    digest: canonicalDigest(result),
    eventsDigest: r.digest,
    comparison,
    serverChecked: true,
  };
  if (r.analysis !== undefined && content.gameId === "nazar") {
    // The replay above already validated and decoded this package; decoding again is cheap.
    const events = await decodeReplayAsync(pkg, ctx.sid);
    const analysis: Partial<Record<AnalysisKind, NazarAnalysis>> = {};
    for (const kind of r.analysis) {
      const rule = RULE_OF[kind];
      analysis[kind] = {
        rule,
        clips: analyseNazarClips(ctx, events, content, rule).map((c) =>
          reduceClip(c, ctx.items[c.item]?.ref ?? ""),
        ),
      };
    }
    out.analysis = analysis;
  }
  return out;
}
