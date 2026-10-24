// The clip_ingest and clip_finalize steps as data (ARCHITECTURE §8 and §10.6), for RW-1 to wire
// into services/workflows. Each step says where it runs:
//   - "task": media work inside the Render Workflows task (ffmpeg, onnxruntime-node, Gemini, R2, CDN);
//   - "api": a Go job step, HMAC-signed POST /internal/job-steps/{apiStep} (every decision and DB
//     write stays in Go; the workflows service has no DATABASE_URL);
//   - "task+api": the task does the I/O and the Go step records or decides.
// The human waits (blur audit, two raters, adjudication) live in n8n W08 between the two runs,
// because Workflows has no sleep API and a 24 h run cap.
import type { ClipStatus } from "./schema.ts";

export type TaskName = "clip_ingest" | "clip_finalize" | "clip_generate";
export type RunsIn = "task" | "api" | "task+api";

export interface RetryPolicy {
  /** Mirrors @renderinc/sdk RegisterTaskOptions.retry. */
  readonly maxRetries: number;
  readonly waitDurationMs: number;
  readonly backoffScaling: number;
}

export interface StepDef {
  readonly id: string;
  readonly task: TaskName;
  readonly runsIn: RunsIn;
  /** Go job step name for /internal/job-steps/{step}, when the step calls the API. */
  readonly apiStep: string | null;
  /** Builders and checks from this package the step uses. */
  readonly uses: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly retry: RetryPolicy;
  readonly timeoutSeconds: number;
  /** Status the clip reaches once the step's result is recorded (by the API). */
  readonly statusAfter: ClipStatus | null;
  /** What happens when the step fails after its retries, or its result is negative. */
  readonly onFailure: string;
  /** `true` when a failure must not stop the run (the step's output is optional). */
  readonly continueOnFailure: boolean;
}

/** ARCHITECTURE §8: 3 retries with 1.5× backoff for clip_ingest steps. */
const INGEST_RETRY: RetryPolicy = { maxRetries: 3, waitDurationMs: 2_000, backoffScaling: 1.5 };
/** ARCHITECTURE §8: 3 retries for clip_finalize steps. */
const FINALIZE_RETRY: RetryPolicy = { maxRetries: 3, waitDurationMs: 1_000, backoffScaling: 2 };

export const CLIP_INGEST_STEPS: readonly StepDef[] = [
  {
    id: "transcode",
    task: "clip_ingest",
    runsIn: "task",
    apiStep: null,
    uses: ["buildProbeArgv", "parseFfprobeJson", "checkRawUpload", "buildMezzanineArgv"],
    inputs: ["raw object key (private bucket)"],
    outputs: ["mezzanine object key", "mezzanine probe (width, height, frames)"],
    retry: INGEST_RETRY,
    timeoutSeconds: 1_800,
    statusAfter: "transcoded",
    onFailure: "run fails; clip admin shows failed_transcode; re-run is safe (same keys, -y)",
    continueOnFailure: false,
  },
  {
    id: "blur",
    task: "clip_ingest",
    runsIn: "task",
    apiStep: null,
    uses: [
      "planBlurRegions",
      "buildBlurArgv",
      "buildProbeArgv",
      "checkDeliveryRendition",
      "buildPosterArgv",
      "posterTimeMs",
    ],
    inputs: [
      "mezzanine object key",
      "detections (YuNet + plate model via onnxruntime-node)",
      "manual masks from earlier audits",
    ],
    outputs: [
      "blurred 360p and 480p keys with bytes and sha256",
      "poster key",
      "blur region summary",
    ],
    retry: INGEST_RETRY,
    timeoutSeconds: 1_800,
    statusAfter: "blurred",
    onFailure: "run fails; nothing unblurred is ever written to the public bucket",
    continueOnFailure: false,
  },
  {
    id: "flash_check",
    task: "clip_ingest",
    runsIn: "task",
    apiStep: null,
    uses: ["buildLumaGridArgv", "parseLumaGrid", "flashCheckFromLuma"],
    inputs: ["blurred 480p key"],
    outputs: ["FlashCheckResult (passes, maxFlashesInAnySecond, worstAtMs)"],
    retry: INGEST_RETRY,
    timeoutSeconds: 600,
    statusAfter: null,
    onFailure:
      "a failing clip is still reviewed but is excluded from mocks and the default set (NAZAR §12)",
    continueOnFailure: false,
  },
  {
    id: "propose_windows",
    task: "clip_ingest",
    runsIn: "task",
    apiStep: null,
    uses: ["ClipProposalSchema", "proposalToWindows", "mergeChunkProposals"],
    inputs: ["blurred 360p key (only blurred media reaches Gemini)"],
    outputs: ["ProposedWindow[] (±1 s, never final)"],
    retry: INGEST_RETRY,
    timeoutSeconds: 600,
    statusAfter: null,
    onFailure: "raters start without proposals; the pipeline continues (DATA_PIPELINE §2)",
    continueOnFailure: true,
  },
  {
    id: "open_review",
    task: "clip_ingest",
    runsIn: "api",
    apiStep: "clip.open_review",
    uses: ["transition"],
    inputs: [
      "clip id + version",
      "media entries",
      "flash result",
      "proposals",
      "blur region summary",
    ],
    outputs: ["status awaiting ratings; n8n W08 clip-review webhook"],
    retry: INGEST_RETRY,
    timeoutSeconds: 120,
    statusAfter: "proposed",
    onFailure: "run fails and is retried; the API dedupes by idempotency key",
    continueOnFailure: false,
  },
];

export const CLIP_FINALIZE_STEPS: readonly StepDef[] = [
  {
    id: "agreement",
    task: "clip_finalize",
    runsIn: "api",
    apiStep: "clip.agreement",
    uses: ["computeAgreement", "adjudicate", "finalWindow"],
    inputs: ["two RaterSubmissions (E-21)", "proposals", "adjudication if any"],
    outputs: ["ClipAgreement or AdjudicationResult; final windows when accepted"],
    retry: FINALIZE_RETRY,
    timeoutSeconds: 300,
    statusAfter: "rated",
    onFailure:
      "not accepted → API step clip.request_adjudication (status adjudication); run ends; W08 restarts clip_finalize later",
    continueOnFailure: false,
  },
  {
    id: "blur_audit_check",
    task: "clip_finalize",
    runsIn: "api",
    apiStep: "clip.blur_audit_check",
    uses: ["blurAuditPasses", "clipBlurAuditPasses", "clipReviewPasses", "syntheticReviewPasses"],
    inputs: [
      "BlurAuditRecord (filmed) or syntheticReview (ai_generated)",
      "published rendition sha256",
    ],
    outputs: ["pass / fail"],
    retry: FINALIZE_RETRY,
    timeoutSeconds: 300,
    statusAfter: null,
    onFailure:
      "filmed: any miss → back to blur with manual masks (new clip_ingest run); ai_generated: no syntheticReview → wait for the curator, or retire and regenerate; run ends",
    continueOnFailure: false,
  },
  {
    id: "delete_raw",
    task: "clip_finalize",
    runsIn: "api",
    apiStep: "clip.delete_raw",
    uses: ["rawDeletionDeadline", "checkRawDeletion"],
    inputs: ["raw, mezzanine and intermediate object keys", "audit pass time"],
    outputs: ["RawDeletionRecord (AuditLog)"],
    retry: FINALIZE_RETRY,
    timeoutSeconds: 300,
    statusAfter: null,
    onFailure: "alert; deletion must still happen by min(upload + 7 d, audit + 24 h)",
    continueOnFailure: true,
  },
  {
    id: "publish_manifest",
    task: "clip_finalize",
    runsIn: "task+api",
    apiStep: "clip.publish_manifest",
    uses: ["transition", "checkInvariants", "buildBankManifest", "buildClientManifest"],
    inputs: ["validated published clips (from the API step)"],
    outputs: [
      "bank manifest and client manifest objects in R2 (new version; previous kept for rollback)",
    ],
    retry: FINALIZE_RETRY,
    timeoutSeconds: 600,
    statusAfter: "published",
    onFailure: "run fails; previous manifest version stays live",
    continueOnFailure: false,
  },
  {
    id: "cdn_warm",
    task: "clip_finalize",
    runsIn: "task",
    apiStep: null,
    uses: ["mediaObjectKey"],
    inputs: ["published rendition URLs", "manifest URLs"],
    outputs: ["warm report"],
    retry: FINALIZE_RETRY,
    timeoutSeconds: 300,
    statusAfter: null,
    onFailure: "logged only; first users fetch from origin",
    continueOnFailure: true,
  },
  {
    id: "recompute_difficulty",
    task: "clip_finalize",
    runsIn: "api",
    apiStep: "clip.recompute_difficulty",
    uses: ["empiricalDifficulty", "validateCuratorDifficulty"],
    inputs: ["clip id + version"],
    outputs: ["difficulty {curator, empirical, nTakers}"],
    retry: FINALIZE_RETRY,
    timeoutSeconds: 300,
    statusAfter: null,
    onFailure: "logged; the nightly stats Workflow recomputes anyway",
    continueOnFailure: true,
  },
];

/** clip_generate: generation is slow and rate-limited (429), so retries wait longer. */
const GENERATE_RETRY: RetryPolicy = { maxRetries: 3, waitDurationMs: 30_000, backoffScaling: 2 };

/**
 * clip_generate (ADR-0013): an AI-generated clip from one scene of content/nazar/scenes.json.
 * Its own steps are below; after `register` it hands over to the clip_ingest subtasks
 * (`CLIP_GENERATE_FLOW`): transcode, then `render` here instead of blur (nothing real to blur),
 * then flash_check, propose_windows and open_review, which moves the clip transcoded → proposed.
 * Idempotency keys are `sceneId:version:batchId:step` before registration (generation.ts) and the
 * usual `clipId:step:version` after it.
 */
export const CLIP_GENERATE_STEPS: readonly StepDef[] = [
  {
    id: "generate",
    task: "clip_generate",
    runsIn: "task",
    apiStep: null,
    uses: ["SceneSpecSchema", "buildShotPrompts", "generationIdempotencyKey", "generatedObjectKey"],
    inputs: [
      "sceneId, version (scene revision), batchId",
      "the scene from content/nazar/scenes.json",
    ],
    outputs: [
      "generated source MP4 key (private ingest bucket)",
      "turn durations (for the onset hint)",
      "model id, extensions",
    ],
    retry: GENERATE_RETRY,
    timeoutSeconds: 2_700,
    statusAfter: null,
    onFailure:
      "429/5xx retried with backoff; a safety block or bad request fails the run (fix the scene, new batchId)",
    continueOnFailure: false,
  },
  {
    id: "precheck",
    task: "clip_generate",
    runsIn: "task",
    apiStep: null,
    uses: [
      "buildProbeArgv",
      "parseFfprobeJson",
      "buildMezzanineArgv",
      "buildStripMetadataArgv",
      "findPrivacyMetadata",
      "checkRawUpload",
      "buildTranscodeArgv",
      "buildLumaGridArgv",
      "parseLumaGrid",
      "flashCheckFromLuma",
    ],
    inputs: ["generated source MP4 key"],
    outputs: ["normalised MP4 key (30 fps CFR, no audio, no metadata)", "duration", "flash result"],
    retry: INGEST_RETRY,
    timeoutSeconds: 900,
    statusAfter: null,
    onFailure:
      "a clip that fails the delivery or WCAG flash check is not registered; regenerate with a new batchId",
    continueOnFailure: false,
  },
  {
    id: "register",
    task: "clip_generate",
    runsIn: "api",
    apiStep: "clip.register_generated",
    uses: ["sceneClipFacts", "generationRecord", "approximateOnsetHint"],
    inputs: [
      "normalised MP4 key and sha256",
      "scene facts",
      "generation record",
      "approximate onset hint (raters only, never authoritative)",
    ],
    outputs: ["clip_id, version (origin ai_generated, status raw)"],
    retry: INGEST_RETRY,
    timeoutSeconds: 120,
    statusAfter: "raw",
    onFailure: "run fails and is retried; the API dedupes by sceneId:version:batchId",
    continueOnFailure: false,
  },
  {
    id: "render",
    task: "clip_generate",
    runsIn: "task",
    apiStep: null,
    uses: [
      "buildTranscodeArgv",
      "buildProbeArgv",
      "checkDeliveryRendition",
      "buildPosterArgv",
      "posterTimeMs",
    ],
    inputs: ["mezzanine object key (from clip_ingest transcode)"],
    outputs: ["360p and 480p staging keys with bytes and sha256", "poster key"],
    retry: INGEST_RETRY,
    timeoutSeconds: 1_800,
    statusAfter: null,
    onFailure: "run fails; nothing reaches the public bucket before clip_finalize",
    continueOnFailure: false,
  },
];

/** The whole clip_generate run in order: its own steps and the clip_ingest subtasks it reuses. */
export const CLIP_GENERATE_FLOW: readonly string[] = [
  "clip_generate.generate",
  "clip_generate.precheck",
  "clip_generate.register",
  "clip_ingest.transcode",
  "clip_generate.render",
  "clip_ingest.flash_check",
  "clip_ingest.propose_windows",
  "clip_ingest.open_review",
];

/** Whole-run limits: ingest is bounded by its slowest media steps; finalize is short. */
export const TASK_LIMITS: Readonly<
  Record<TaskName, { timeoutSeconds: number; retry: RetryPolicy }>
> = {
  clip_ingest: {
    timeoutSeconds: 5_400,
    retry: { maxRetries: 1, waitDurationMs: 10_000, backoffScaling: 1.5 },
  },
  clip_finalize: {
    timeoutSeconds: 1_800,
    retry: { maxRetries: 1, waitDurationMs: 10_000, backoffScaling: 1.5 },
  },
  clip_generate: {
    timeoutSeconds: 14_400,
    retry: { maxRetries: 1, waitDurationMs: 60_000, backoffScaling: 1.5 },
  },
};

export function stepsFor(task: TaskName): readonly StepDef[] {
  if (task === "clip_generate") return CLIP_GENERATE_STEPS;
  return task === "clip_ingest" ? CLIP_INGEST_STEPS : CLIP_FINALIZE_STEPS;
}

const STEP_ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Idempotency key `clipId:step:version` (e.g. `JMU-0012:transcode:3`). clip_finalize can run more
 * than once for one version (before and after adjudication), so its keys take a round suffix
 * (`JMU-0012:agreement:3:r2`); the API dedupes by key, and a new round must not get the old answer.
 */
export function stepIdempotencyKey(
  step: string,
  clipId: string,
  version: number,
  round?: number,
): string {
  if (!STEP_ID_RE.test(step)) throw new RangeError(`bad step id ${step}`);
  if (!/^[A-Z]{2,4}-\d{4,6}$/.test(clipId)) throw new RangeError(`bad clipId ${clipId}`);
  if (!Number.isInteger(version) || version < 1) throw new RangeError(`bad version ${version}`);
  const base = `${clipId}:${step}:${version}`;
  if (round === undefined) return base;
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`bad round ${round}`);
  return `${base}:r${round}`;
}

/** Object keys for a clip version's artefacts (deterministic, so a re-run overwrites in place). */
export function artefactKey(
  clipId: string,
  version: number,
  kind: "raw" | "mezzanine" | "poster" | "luma_grid" | "blur_regions" | "proposals",
): string {
  const v = `v${version}`;
  switch (kind) {
    case "raw":
      return `raw/${clipId}/${v}/upload`;
    case "mezzanine":
      return `private/${clipId}/${v}/mezzanine.mp4`;
    case "poster":
      return `clips/${clipId}/${v}/poster.jpg`;
    case "luma_grid":
      return `private/${clipId}/${v}/luma-3x3.gray`;
    case "blur_regions":
      return `private/${clipId}/${v}/blur-regions.json`;
    case "proposals":
      return `private/${clipId}/${v}/proposals.json`;
  }
}
