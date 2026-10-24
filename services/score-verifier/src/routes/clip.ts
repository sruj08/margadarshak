// Clip-pipeline maths for the Go API (D1, plan §2.8 and §2.11.4). Pure pass-throughs to
// @margdarshak/clip-pipeline so the Go `clip.*` job steps and the curator UI share one
// implementation with the reference tests (test/fixtures/agreement-golden.json).
//
//   POST /clip/agreement  {op: "agreement"}     computeAgreement over two blind ratings
//                         {op: "adjudicate"}    computeAgreement, then adjudicate (third person)
//                         {op: "final_window"}  finalWindow over 2 (mean) or 3 (median) marks
//                         {op: "scoring_clip"}  toScoringClip: the game-core NazarClip for a
//                                               published/retired clip (what /verify takes inline)
//   POST /clip/manifests  buildBankManifest (CC-BY record, with final windows) and
//                         buildClientManifest (API-37: no hazard information at all), plus the
//                         mock eligibility of every clip.
//
// Stateless; `now` (epoch ms) is Go server time and becomes the manifests' generatedAt.
import {
  AdjudicationInputSchema,
  adjudicate,
  buildBankManifest,
  buildClientManifest,
  type Clip,
  ClipSchema,
  clipRef,
  computeAgreement,
  finalWindow,
  HAZARD_TYPES,
  mediaObjectKey,
  mockEligibility,
  RaterMarkSchema,
  RaterSubmissionSchema,
  RENDITIONS,
  type Rendition,
  ScoringClipSchema,
  toScoringClip,
} from "@margdarshak/clip-pipeline";
import {
  ClipHazardSchema,
  GenerationSchema,
  SyntheticReviewSchema,
} from "@margdarshak/clip-pipeline/schema";
import { z } from "zod";
import { HttpProblem } from "../http-util.ts";
import { defined, EPOCH_MS_MAX, postRoute, type RouteMap } from "./types.ts";

const EpochMs = z.number().int().min(0).max(EPOCH_MS_MAX);
const HazardType = z.enum(HAZARD_TYPES);
const Ms = z.number().int().min(0).max(900_000);

/** An M-06 proposal (proposals.ts `ProposedWindow`). Never sets a final window. */
const ProposedWindowSchema = z
  .object({ aMs: Ms, bMs: Ms, hazardType: HazardType, why: z.string().max(200) })
  .strict();

const AgreementInput = {
  now: EpochMs,
  raterA: RaterSubmissionSchema,
  raterB: RaterSubmissionSchema,
  /** Clip duration, for the per-second κ metric. */
  durationMs: z.number().int().min(1000).max(900_000).optional(),
  /** M-06 proposals shown after both raters submitted (NAZAR §6.2.3). */
  proposals: z.array(ProposedWindowSchema).max(20).optional(),
};

export const ClipAgreementRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("agreement"), ...AgreementInput }).strict(),
  z
    .object({
      op: z.literal("adjudicate"),
      ...AgreementInput,
      adjudication: AdjudicationInputSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("final_window"),
      now: EpochMs,
      marks: z
        .array(z.object({ aMs: Ms, bMs: Ms }).strict())
        .min(2)
        .max(3),
    })
    .strict(),
  z.object({ op: z.literal("scoring_clip"), now: EpochMs, clip: ClipSchema }).strict(),
]);
export type ClipAgreementRequest = z.infer<typeof ClipAgreementRequest>;

const Window = z.object({ aMs: z.number(), bMs: z.number() }).strict();
const Reason = z.enum([
  "unmatched_hazard",
  "onset_delta",
  "end_delta",
  "type_mismatch",
  "too_many_hazards",
  "unconfirmed_proposal",
]);
const FinalHazardSchema = z
  .object({
    hazardId: z.string(),
    hazardType: HazardType,
    window: Window,
    raterCount: z.number(),
    deltaOnsetMs: z.number(),
    deltaEndMs: z.number(),
    adjudicated: z.boolean(),
    occlusion: z.boolean(),
    cues: z.array(z.string()),
  })
  .strict();

const ClipAgreementSchema = z
  .object({
    clipId: z.string(),
    version: z.number(),
    raters: z.tuple([z.string(), z.string()]),
    pairs: z.array(
      z
        .object({
          clusterId: z.string(),
          a: RaterMarkSchema,
          b: RaterMarkSchema,
          iou: z.number(),
          deltaOnsetMs: z.number(),
          deltaEndMs: z.number(),
          signedOnsetMs: z.number(),
          sameType: z.boolean(),
          accepted: z.boolean(),
          reasons: z.array(Reason),
        })
        .strict(),
    ),
    onlyA: z.array(RaterMarkSchema),
    onlyB: z.array(RaterMarkSchema),
    unconfirmedProposals: z.array(ProposedWindowSchema),
    clusters: z.array(
      z
        .object({
          clusterId: z.string(),
          kind: z.enum(["pair", "only_a", "only_b", "proposal_only"]),
          marks: z.array(z.object({ rater: z.string(), mark: RaterMarkSchema }).strict()),
          proposal: ProposedWindowSchema.optional(),
        })
        .strict(),
    ),
    metrics: z
      .object({
        matched: z.number(),
        medianDeltaOnsetMs: z.number().nullable(),
        medianDeltaEndMs: z.number().nullable(),
        meanIoU: z.number().nullable(),
        kappaPerSecond: z.number().nullable(),
      })
      .strict(),
    reasons: z.array(Reason),
    accepted: z.boolean(),
    needsThirdRater: z.boolean(),
    finalHazards: z.array(FinalHazardSchema),
    options: z
      .object({
        onsetToleranceMs: z.number(),
        endToleranceMs: z.number(),
        minIoU: z.number(),
        maxHazards: z.number(),
        fps: z.number(),
        snapToFrame: z.boolean(),
      })
      .strict(),
  })
  .strict();

const AdjudicationResultSchema = z
  .object({
    resolved: z.boolean(),
    hazards: z.array(FinalHazardSchema),
    dropped: z.array(z.string()),
    issues: z.array(z.string()),
  })
  .strict();

export const ClipAgreementResponse = z.discriminatedUnion("op", [
  z.object({ op: z.literal("agreement"), agreement: ClipAgreementSchema }).strict(),
  z
    .object({
      op: z.literal("adjudicate"),
      agreement: ClipAgreementSchema,
      adjudication: AdjudicationResultSchema,
    })
    .strict(),
  z.object({ op: z.literal("final_window"), window: Window }).strict(),
  z.object({ op: z.literal("scoring_clip"), scoringClip: ScoringClipSchema }).strict(),
]);
export type ClipAgreementResponse = z.infer<typeof ClipAgreementResponse>;

/** Library errors (two ratings for different clips, an unknown cluster, …) are the caller's 422. */
function unprocessable<T>(type: string, title: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof HttpProblem) throw e;
    throw new HttpProblem({
      type,
      title,
      status: 422,
      detail: e instanceof Error ? e.message.slice(0, 300) : "invalid input",
    });
  }
}

export function clipAgreement(req: ClipAgreementRequest) {
  switch (req.op) {
    case "agreement":
    case "adjudicate": {
      const agreement = unprocessable("invalid-ratings", "Ratings cannot be compared", () =>
        computeAgreement(
          req.raterA,
          req.raterB,
          defined({ durationMs: req.durationMs, proposals: req.proposals }),
        ),
      );
      if (req.op === "agreement") return { op: "agreement", agreement };
      const adjudication = unprocessable("invalid-adjudication", "Adjudication is invalid", () =>
        adjudicate(agreement, req.adjudication),
      );
      return { op: "adjudicate", agreement, adjudication };
    }
    case "final_window":
      return {
        op: "final_window",
        window: unprocessable("invalid-window", "No final window from these marks", () =>
          finalWindow(req.marks),
        ),
      };
    case "scoring_clip":
      return {
        op: "scoring_clip",
        scoringClip: unprocessable("not-scorable", "Clip has no scoring content", () =>
          toScoringClip(req.clip),
        ),
      };
  }
}

// ---------------------------------------------------------------------------------------------
// POST /clip/manifests

export const ClipManifestsRequest = z
  .object({
    now: EpochMs,
    /** clip.json documents (any status; only published/retired versions are released). */
    clips: z.array(ClipSchema).max(200),
    /** WCAG flash-check result per clip ref (`JMU-0012@3`); missing = not passed (not mock-eligible). */
    flashPassed: z.record(z.string().max(48), z.boolean()).default({}),
    /** API-37 `state=` filter for the client manifest. */
    tenant: z
      .string()
      .regex(/^[A-Z]{2,3}$/)
      .optional(),
    /** API-37 `resolution=` filter for the client manifest. */
    resolution: z.enum(RENDITIONS).optional(),
    /** Prefix for client media URLs; default is the bare object key (Go presigns per session). */
    mediaBaseUrl: z.url().max(300).optional(),
    include: z
      .array(z.enum(["bank", "client"]))
      .min(1)
      .max(2)
      .default(["bank", "client"]),
  })
  .strict();
export type ClipManifestsRequest = z.infer<typeof ClipManifestsRequest>;

const BankMediaSchema = z
  .object({ res: z.enum(RENDITIONS), bytes: z.number(), sha256: z.string(), key: z.string() })
  .strict();
const BankEntrySchema = z.union([
  z
    .object({
      ref: z.string(),
      clipId: z.string(),
      version: z.number(),
      status: z.literal("published"),
      tenantTags: z.array(z.string()),
      city: z.string(),
      roadType: z.string(),
      timeOfDay: z.string(),
      weather: z.string(),
      pov: z.string(),
      capturedMonth: z.string(),
      speedKmhEst: z.number().nullable(),
      speedSource: z.string(),
      durationMs: z.number(),
      hazards: z.array(ClipHazardSchema),
      quietSegments: z.array(z.object({ fromMs: z.number(), toMs: z.number() }).strict()),
      difficulty: z
        .object({
          curator: z.number().nullable(),
          empirical: z.number().nullable(),
          irt: z.number().nullable(),
          nTakers: z.number(),
        })
        .strict(),
      modules: z.array(z.string()),
      licence: z.string(),
      attribution: z.string(),
      // Filmed clips carry the blur audit; AI-generated clips (ADR-0013) carry null plus their
      // generation record and the synthetic review (reviewer pseudonym removed).
      blurAudit: z
        .object({ framesChecked: z.number(), misses: z.number(), auditedAt: z.string() })
        .strict()
        .nullable(),
      media: z.array(BankMediaSchema),
      origin: z.literal("ai_generated").optional(),
      generation: GenerationSchema.optional(),
      syntheticReview: SyntheticReviewSchema.omit({ reviewer: true }).optional(),
    })
    .strict(),
  z
    .object({
      ref: z.string(),
      clipId: z.string(),
      version: z.number(),
      status: z.literal("retired"),
      licence: z.string(),
      attribution: z.string(),
    })
    .strict(),
]);

/** API-37 entry: an allowlist, so a hazard field can never slip through (strict). */
export const ClientEntrySchema = z
  .object({
    ref: z.string(),
    clipId: z.string(),
    version: z.number(),
    durationMs: z.number(),
    tenantTags: z.array(z.string()),
    city: z.string(),
    roadType: z.string(),
    timeOfDay: z.string(),
    weather: z.string(),
    pov: z.string(),
    modules: z.array(z.string()),
    licence: z.string(),
    attribution: z.string(),
    media: z.array(
      z
        .object({ res: z.enum(RENDITIONS), bytes: z.number(), sha256: z.string(), url: z.string() })
        .strict(),
    ),
    totalBytes: z.number(),
    mockEligible: z.boolean(),
    curatorDifficulty: z.number().optional(),
    /** Present only on AI-generated clips, so every client surface can label them (ADR-0013). */
    origin: z.literal("ai_generated").optional(),
  })
  .strict();

export const ClipManifestsResponse = z
  .object({
    generatedAt: z.string(),
    bank: z
      .object({
        schema: z.string(),
        generatedAt: z.string(),
        licence: z.string(),
        attribution: z.string(),
        counts: z.object({ published: z.number(), retired: z.number() }).strict(),
        digest: z.string(),
        clips: z.array(BankEntrySchema),
      })
      .strict()
      .nullable(),
    client: z
      .object({
        schema: z.string(),
        generatedAt: z.string(),
        licence: z.string(),
        attribution: z.string(),
        totalBytes: z.record(z.enum(RENDITIONS), z.number()),
        digest: z.string(),
        clips: z.array(ClientEntrySchema),
      })
      .strict()
      .nullable(),
    /** Per clip ref (`JMU-0012@3`): Kerala-mock eligibility and why not. */
    mockEligibility: z.record(
      z.string(),
      z.object({ eligible: z.boolean(), reasons: z.array(z.string()) }).strict(),
    ),
  })
  .strict();
export type ClipManifestsResponse = z.infer<typeof ClipManifestsResponse>;

export function clipManifests(req: ClipManifestsRequest) {
  const generatedAt = new Date(req.now).toISOString();
  const clips = req.clips as Clip[];
  const eligibility = (c: Clip) =>
    mockEligibility(c, { flashPassed: req.flashPassed[clipRef(c)] === true });
  const mockEligibilityByRef: Record<string, { eligible: boolean; reasons: string[] }> = {};
  for (const c of clips) mockEligibilityByRef[clipRef(c)] = eligibility(c);
  const base = req.mediaBaseUrl?.replace(/\/+$/, "");
  const urlFor =
    base === undefined
      ? undefined
      : (clipId: string, version: number, res: Rendition) =>
          `${base}/${mediaObjectKey(clipId, version, res)}`;
  const bank = req.include.includes("bank")
    ? unprocessable("not-publishable", "A clip cannot be released", () =>
        buildBankManifest(clips, { generatedAt }),
      )
    : null;
  const client = req.include.includes("client")
    ? unprocessable("not-publishable", "A clip cannot be released", () =>
        buildClientManifest(
          clips,
          defined({
            generatedAt,
            isMockEligible: (c: Clip) => eligibility(c).eligible,
            tenant: req.tenant,
            resolution: req.resolution,
            urlFor,
          }),
        ),
      )
    : null;
  return { generatedAt, bank, client, mockEligibility: mockEligibilityByRef };
}

export const clipRoutes: RouteMap = {
  "/clip/agreement": postRoute({
    request: ClipAgreementRequest,
    response: ClipAgreementResponse,
    contract: "Request does not match the /clip/agreement contract",
    handle: (req) => clipAgreement(req),
  }),
  "/clip/manifests": postRoute({
    request: ClipManifestsRequest,
    response: ClipManifestsResponse,
    contract: "Request does not match the /clip/manifests contract",
    handle: (req) => clipManifests(req),
  }),
};
