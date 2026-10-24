// clip_finalize (RW-1; ARCHITECTURE §8; clip-pipeline CLIP_FINALIZE_STEPS). Started by n8n W08
// after both raters (API-67 `POST /internal/jobs/clip_finalize`, args `{clip_id, version, round?}`).
//
//   ctx.run clip_finalize_agreement            Go clip.agreement; not accepted → clip.request_adjudication, run ends
//   ctx.run clip_finalize_blur_audit_check     Go clip.blur_audit_check; any miss → run ends (re-blur)
//   ctx.run clip_finalize_delete_raw           Go clip.delete_raw (MD-218); failure is not fatal
//   ctx.run clip_finalize_publish_manifest     Go clip.publish_manifest prepare → copy the audited renditions
//                                              to the public keys (sha256 checked) → bank manifest (private)
//                                              + client manifest (public, new version + latest.json)
//                                              → Go clip.publish_manifest commit
//   ctx.run clip_finalize_cdn_warm             ranged GET of each public URL; failure is not fatal
//   ctx.run clip_finalize_recompute_difficulty Go clip.recompute_difficulty; failure is not fatal
//
// Keys take the finalize round (`JMU-0012:agreement:3:r2`), so a run after adjudication is not
// answered with the first run's cached result. Agreement maths, the audit verdict and the status
// vocabulary are Go's; this task moves bytes and builds the manifests with clip-pipeline.
import { createHash } from "node:crypto";
import {
  artefactKey,
  buildBankManifest,
  buildClientManifest,
  CLIP_FINALIZE_STEPS,
  type Clip,
  mediaObjectKey,
  type Rendition,
  TASK_LIMITS,
} from "@margdarshak/clip-pipeline";
import { NonRetryableError } from "../lib/api.ts";
import type { DefineTask, TaskCtx, TaskDef } from "../lib/task-types.ts";
import {
  type ClipDeps,
  type ClipJob,
  defineStep,
  goStep,
  normaliseClipJob,
  type OptionalOutcome,
  type ResolvedClipDeps,
  resolveClipDeps,
  runOptional,
  stepById,
} from "./clip-common.ts";
import { stagedKey } from "./clip-media.ts";

export const TASK_CLIP_FINALIZE = "clip_finalize";

const STEP = {
  agreement: stepById(CLIP_FINALIZE_STEPS, "agreement"),
  audit: stepById(CLIP_FINALIZE_STEPS, "blur_audit_check"),
  deleteRaw: stepById(CLIP_FINALIZE_STEPS, "delete_raw"),
  publish: stepById(CLIP_FINALIZE_STEPS, "publish_manifest"),
  warm: stepById(CLIP_FINALIZE_STEPS, "cdn_warm"),
  difficulty: stepById(CLIP_FINALIZE_STEPS, "recompute_difficulty"),
} as const;

/** A finalize job always has a round (1 for the first run). */
export interface FinalizeRef extends Pick<ClipJob, "clip_id" | "version"> {
  readonly round: number;
}

export interface AgreementOutput {
  readonly accepted: boolean;
  readonly adjudication_requested: boolean;
}
export interface PublishOutput {
  readonly manifest_version: string;
  readonly bank_key: string;
  readonly client_key: string;
  readonly public_keys: readonly string[];
}
export interface WarmOutput {
  readonly skipped: boolean;
  readonly urls: number;
  readonly ok: number;
}

export type FinalizeOutcome = "published" | "adjudication" | "reblur";

export interface ClipFinalizeSummary extends FinalizeRef {
  readonly outcome: FinalizeOutcome;
  readonly publish: PublishOutput | null;
  readonly delete_raw: OptionalOutcome<unknown> | null;
  readonly cdn_warm: OptionalOutcome<WarmOutput> | null;
  readonly recompute_difficulty: OptionalOutcome<unknown> | null;
}

export interface ClipFinalizeTasks {
  readonly clipFinalize: TaskDef<unknown[], ClipFinalizeSummary>;
  readonly clipFinalizeSteps: {
    readonly agreement: TaskDef<[FinalizeRef], AgreementOutput>;
    readonly blurAuditCheck: TaskDef<[FinalizeRef], { passes: boolean }>;
    readonly deleteRaw: TaskDef<[FinalizeRef], unknown>;
    readonly publishManifest: TaskDef<[FinalizeRef], PublishOutput>;
    readonly cdnWarm: TaskDef<[FinalizeRef & { keys: readonly string[] }], WarmOutput>;
    readonly recomputeDifficulty: TaskDef<[FinalizeRef], unknown>;
  };
}

const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const json = (v: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(v)}\n`);
const MANIFEST_VERSION = /^[A-Za-z0-9_.-]{1,64}$/;

/** Copies the staged (blurred, now audited) renditions and poster to their public keys. */
async function promoteMedia(d: ResolvedClipDeps, clip: Clip): Promise<string[]> {
  const store = d.store();
  const keys: string[] = [];
  for (const m of clip.media) {
    const body = await store.get("ingest", stagedKey(clip.clipId, clip.version, `${m.res}.mp4`));
    if (!body)
      throw new NonRetryableError(
        "clip.publish_manifest",
        `staged ${m.res} for ${clip.clipId} v${clip.version} is missing`,
        undefined,
        0,
      );
    if (sha256Hex(body) !== m.sha256) {
      throw new NonRetryableError(
        "clip.publish_manifest",
        `staged ${m.res} does not match the audited sha256`,
        undefined,
        0,
      );
    }
    const key = mediaObjectKey(clip.clipId, clip.version, m.res as Rendition);
    await store.put("clips", key, body, "video/mp4");
    keys.push(key);
  }
  const poster = await store.get("ingest", stagedKey(clip.clipId, clip.version, "poster.jpg"));
  if (poster) {
    const key = artefactKey(clip.clipId, clip.version, "poster");
    await store.put("clips", key, poster, "image/jpeg");
    keys.push(key);
  }
  return keys;
}

function definePublish(define: DefineTask, d: ResolvedClipDeps) {
  return defineStep(define, STEP.publish, async (ctx, ref: FinalizeRef): Promise<PublishOutput> => {
    const prep = await goStep(
      d,
      ctx,
      "clip.publish_manifest",
      "publish_manifest",
      ref,
      { stage: "prepare" },
      ":prepare",
    );
    const clips = Array.isArray(prep["clips"]) ? (prep["clips"] as Clip[]) : null;
    if (!clips)
      throw new NonRetryableError(
        "clip.publish_manifest",
        "prepare returned no clips[]",
        undefined,
        0,
      );
    const self = clips.find((c) => c.clipId === ref.clip_id && c.version === ref.version);
    if (self?.status !== "published") {
      throw new NonRetryableError(
        "clip.publish_manifest",
        `prepare did not return ${ref.clip_id} v${ref.version} as published`,
        undefined,
        0,
      );
    }
    const generatedAt =
      typeof prep["generated_at"] === "string" ? prep["generated_at"] : new Date().toISOString();
    const mock = (prep["mock_eligible"] ?? {}) as Record<string, unknown>;
    const base = d.config().mediaPublicBaseUrl;
    const bank = buildBankManifest(clips, { generatedAt });
    const client = buildClientManifest(clips, {
      generatedAt,
      isMockEligible: (c) => mock[c.clipId] === true,
      ...(base
        ? {
            urlFor: (id: string, v: number, res: Rendition) =>
              `${base}/${mediaObjectKey(id, v, res)}`,
          }
        : {}),
    });
    const version =
      typeof prep["manifest_version"] === "string" || typeof prep["manifest_version"] === "number"
        ? String(prep["manifest_version"])
        : client.digest.slice(0, 16);
    if (!MANIFEST_VERSION.test(version))
      throw new NonRetryableError(
        "clip.publish_manifest",
        `bad manifest_version ${version}`,
        undefined,
        0,
      );

    const publicKeys = await promoteMedia(d, self);
    const store = d.store();
    const bankKey = `manifests/bank/v${version}.json`;
    const clientKey = `manifests/client/v${version}.json`;
    await store.put("ingest", bankKey, json(bank), "application/json"); // final windows stay server-side
    await store.put("clips", clientKey, json(client), "application/json");
    // The pointer moves last; rolling back = pointing latest.json at the previous version.
    await store.put(
      "clips",
      "manifests/client/latest.json",
      json({ version, key: clientKey, digest: client.digest, generatedAt }),
      "application/json",
    );
    await goStep(
      d,
      ctx,
      "clip.publish_manifest",
      "publish_manifest",
      ref,
      {
        stage: "commit",
        manifest_version: version,
        bank: { key: bankKey, digest: bank.digest, counts: bank.counts },
        client: { key: clientKey, digest: client.digest, total_bytes: client.totalBytes },
        public_keys: publicKeys,
      },
      ":commit",
    );
    return {
      manifest_version: version,
      bank_key: bankKey,
      client_key: clientKey,
      public_keys: [...publicKeys, clientKey],
    };
  });
}

function defineWarm(define: DefineTask, d: ResolvedClipDeps) {
  return defineStep(
    define,
    STEP.warm,
    async (_ctx, input: FinalizeRef & { keys: readonly string[] }): Promise<WarmOutput> => {
      const base = d.config().mediaPublicBaseUrl;
      if (!base) return { skipped: true, urls: 0, ok: 0 };
      let ok = 0;
      for (const key of input.keys) {
        const res = await d.fetch(`${base}/${key}`, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.timeout(15_000),
        });
        await res.arrayBuffer();
        if (res.status === 200 || res.status === 206) ok++;
      }
      if (ok < input.keys.length)
        throw new Error(
          `cdn_warm: ${input.keys.length - ok}/${input.keys.length} URLs did not answer 200/206`,
        );
      return { skipped: false, urls: input.keys.length, ok };
    },
  );
}

export function defineClipFinalizeTasks(define: DefineTask, deps: ClipDeps): ClipFinalizeTasks {
  const d = resolveClipDeps(deps);
  const agreement = defineStep(
    define,
    STEP.agreement,
    async (ctx, ref: FinalizeRef): Promise<AgreementOutput> => {
      const res = await goStep(d, ctx, "clip.agreement", "agreement", ref, {});
      if (res["accepted"] === true) return { accepted: true, adjudication_requested: false };
      await goStep(d, ctx, "clip.request_adjudication", "request_adjudication", ref, {});
      return { accepted: false, adjudication_requested: true };
    },
  );
  const blurAuditCheck = defineStep(define, STEP.audit, async (ctx, ref: FinalizeRef) => {
    const res = await goStep(d, ctx, "clip.blur_audit_check", "blur_audit_check", ref, {});
    return { passes: res["passes"] === true };
  });
  const deleteRaw = defineStep(
    define,
    STEP.deleteRaw,
    (ctx, ref: FinalizeRef): Promise<unknown> =>
      goStep(d, ctx, "clip.delete_raw", "delete_raw", ref, {}),
  );
  const publishManifest = definePublish(define, d);
  const cdnWarm = defineWarm(define, d);
  const recomputeDifficulty = defineStep(
    define,
    STEP.difficulty,
    (ctx, ref: FinalizeRef): Promise<unknown> =>
      goStep(d, ctx, "clip.recompute_difficulty", "recompute_difficulty", ref, {}),
  );

  const clipFinalize = define(
    {
      name: TASK_CLIP_FINALIZE,
      retry: { ...TASK_LIMITS.clip_finalize.retry },
      timeoutSeconds: TASK_LIMITS.clip_finalize.timeoutSeconds,
    },
    async (ctx: TaskCtx, ...args: unknown[]): Promise<ClipFinalizeSummary> => {
      const job = normaliseClipJob(args, "clip.agreement");
      const ref: FinalizeRef = {
        clip_id: job.clip_id,
        version: job.version,
        round: job.round ?? 1,
      };
      const stop = (outcome: FinalizeOutcome): ClipFinalizeSummary => {
        d.log("clip_finalize summary", { run_id: ctx.metadata.taskRunId, ...ref, outcome });
        return {
          ...ref,
          outcome,
          publish: null,
          delete_raw: null,
          cdn_warm: null,
          recompute_difficulty: null,
        };
      };
      const agreed = await ctx.run(agreement, ref);
      if (!agreed.accepted) return stop("adjudication");
      const audit = await ctx.run(blurAuditCheck, ref);
      if (!audit.passes) return stop("reblur");
      const delRaw = await runOptional(ctx, deleteRaw, ref);
      const publish = await ctx.run(publishManifest, ref);
      const warm = await runOptional(ctx, cdnWarm, { ...ref, keys: publish.public_keys });
      const difficulty = await runOptional(ctx, recomputeDifficulty, ref);
      d.log("clip_finalize summary", {
        run_id: ctx.metadata.taskRunId,
        ...ref,
        outcome: "published",
        manifest_version: publish.manifest_version,
      });
      return {
        ...ref,
        outcome: "published",
        publish,
        delete_raw: delRaw,
        cdn_warm: warm,
        recompute_difficulty: difficulty,
      };
    },
  );

  return {
    clipFinalize,
    clipFinalizeSteps: {
      agreement,
      blurAuditCheck,
      deleteRaw,
      publishManifest,
      cdnWarm,
      recomputeDifficulty,
    },
  };
}
