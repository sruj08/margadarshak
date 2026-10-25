# P2 phase 2: `clip_ingest` and `clip_finalize` (RW-1)

Notes for wiring `@margdarshak/clip-pipeline` into this service. Sources: plan §2.9 and §2.11.5, clip-pipeline `README.md` ("What RW-1 must do"), `packages/clip-pipeline/src/steps.ts`, ARCHITECTURE §8.

## Status (24 Oct 2026)

- **In the repo now** (no clip-pipeline import, green without it): `src/tasks/clip-r2.ts` (SigV4 + `R2ObjectStore`), `src/tasks/clip-media.ts` (`ObjectStore`, `runCommand`, `BlurDetector` + manual-mask default, fault injection, staging keys), `MEDIA_PUBLIC_BASE_URL` in `config.ts`, and their tests.
- **Waiting for the workspace dependency:** `clip-common.ts`, `clip-ingest.ts`, `clip-finalize.ts`, the `index.ts` registration and their tests. They import `@margdarshak/clip-pipeline`, so they land together with the `package.json` / `tsconfig` change below and the install.

## Dependencies

| Need | Decision |
|---|---|
| `@margdarshak/clip-pipeline` | `"workspace:*"` in `dependencies`. Tests and `dev` run with `--conditions=margdarshak-source` (raw `.ts` from `packages/clip-pipeline/src`); `tsconfig.json` sets `customConditions` for the typecheck; `tsconfig.build.json` drops it, so `build` and production resolve clip-pipeline's `dist` (built first by turbo `^build`). |
| R2 | No `aws4fetch`. `src/lib/media/r2.ts` is a small SigV4 signer (`node:crypto`) for PUT and GET against `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/<key>`, region `auto`. |
| ffmpeg / ffprobe | `FFMPEG_PATH` (default `ffmpeg` on PATH); ffprobe is the sibling binary in the same directory. Spawned with no shell, argv from clip-pipeline's builders. `ffmpeg-static` is not added. |
| Face / plate detection | Injectable `BlurDetector`. The default reads curator-supplied manual masks from the job input (and from `clip.get`). `onnxruntime-node` + YuNet + a plate model (`BLUR_MODEL_DIR`) are a later option behind the same interface. No new dependency. |

## Steps

One `ctx.run` subtask per entry of `CLIP_INGEST_STEPS` / `CLIP_FINALIZE_STEPS`, registered as `<task>_<step id>` with that step's `retry` and `timeoutSeconds`. The parent tasks use `TASK_LIMITS`. Every Go call carries `stepIdempotencyKey(step, clipId, version[, round])` (`JMU-0012:transcode:3`, `JMU-0012:agreement:3:r2`).

| Task | Step | Runs in | Go step (`/internal/job-steps/…`) | What the task does |
|---|---|---|---|---|
| `clip_ingest` | (start) | api | `clip.get` | read raw key, version, masks |
| | `transcode` | task | | raw (ingest bucket) → ffprobe + `checkRawUpload` → `buildMezzanineArgv` → mezzanine to `artefactKey(…,"mezzanine")` |
| | `blur` | task | | detector → `buildBlurArgv` (graph file when > 24 000 chars) → `checkDeliveryRendition` on 360p/480p → poster → upload to **private staging keys** |
| | `flash_check` | task | | `buildLumaGridArgv` on the staged 480p → `parseLumaGrid` → `flashCheckFromLuma` |
| | `propose_windows` | api (stub, D8) | `clip.propose_windows` | continue on failure (no proposals) |
| | `open_review` | api | `clip.open_review` | IDs, media entries, flash result, region summary; Go posts n8n `md/clip-ready` |
| `clip_finalize` | `agreement` | api | `clip.agreement` → `clip.request_adjudication` | not accepted → run ends (`adjudication`) |
| | `blur_audit_check` | api | `clip.blur_audit_check` | fail → run ends (`reblur`) |
| | `delete_raw` | api | `clip.delete_raw` | continue on failure |
| | `publish_manifest` | task+api | `clip.publish_manifest` (`stage: prepare`, then `stage: commit`) | copy staged renditions + poster to `mediaObjectKey` in the public bucket (sha256 checked), build `buildBankManifest` (private bucket) and `buildClientManifest` (public bucket, new version + `latest.json`) |
| | `cdn_warm` | task | | ranged GET of each public URL (`MEDIA_PUBLIC_BASE_URL`); continue on failure |
| | `recompute_difficulty` | api | `clip.recompute_difficulty` | continue on failure |

**Deviation:** the README writes blurred renditions straight to the public keys. Here `blur` writes them to the private ingest bucket and `publish_manifest` copies them after `blur_audit_check` passed, because the default detector only blurs curator masks: nothing unaudited is ever public.

## Demo retry

`FAULT_INJECTION_CLIP_BLUR=once` makes the first `blur` attempt of a run throw after writing a marker object (`private/<clip>/v<n>/fault/blur-<root run id>`) to the ingest bucket. The Render retry finds the marker and proceeds, so the Runs page shows one failed and one successful attempt. A marker survives the fresh instance each retry runs on; process memory would not. `always` fails every attempt (for testing the failure path).

## Contract the Go side (F) implements

- `clip.get {clip_id, version}` → `{clip_id, version, raw_key, manual_masks?: [{box:{x,y,w,h}, from_frame, to_frame}]}`
- `clip.open_review {clip_id, version, round, mezzanine, media:[{res,bytes,sha256,key}], poster_key, flash, proposals, blur}` → any
- `clip.agreement {clip_id, version, round}` → `{accepted: boolean, …}`; `clip.request_adjudication` same args
- `clip.blur_audit_check {clip_id, version, round}` → `{passes: boolean}`
- `clip.publish_manifest {stage:"prepare"}` → `{clips: Clip[] (this one as published), mock_eligible: {clipId: bool}, manifest_version, generated_at}`; `{stage:"commit", bank, client}` records the manifest keys and digests
- `clip.delete_raw`, `clip.recompute_difficulty {clip_id, version, round}` → any

## Update (24 Oct 2026): phase 2 landed, plus `clip_generate`

- `clip_ingest` / `clip_finalize` are implemented in `src/tasks/clip-ingest.ts`, `clip-finalize.ts` (shared `clip-common.ts`, media helpers in `clip-media.ts`, R2 SigV4 in `clip-r2.ts`), with `@margdarshak/clip-pipeline` as a workspace dependency.
- **`clip_generate`** (`src/tasks/clip-generate.ts`, ADR-0013) turns a scene from `content/nazar/scenes.json` into an AI-generated clip with Gemini Omni Flash (`@google/genai`), then prechecks (normalise, strip, flash check), registers it through the Go step `clip.register_generated`, and continues the ingest flow (no blur step for AI clips; synthetic review instead). Env: `GEMINI_API_KEY`, `GEMINI_MODEL_VIDEO_GEN`, `NAZAR_SCENES_PATH`.
- Prompt, realism rules and run book: [`VIDEO_GENERATION_GUIDE.md`](../../docs/09-learning-games/VIDEO_GENERATION_GUIDE.md) (proposed PRM-CLIPGEN 1.1.0); live prompt `ai/prompts/clip_generator.md`.
