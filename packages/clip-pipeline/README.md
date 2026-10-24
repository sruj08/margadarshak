# @margdarshak/clip-pipeline
> Project: Margdarshak · Owner: Nazar owner (clip pipeline) · Status: P2, pure parts implemented · Last updated: 2026-10-24
> Specs: [NAZAR](../../docs/09-learning-games/NAZAR.md) §3–§7, §11, §13 · [ARCHITECTURE §8, §10.6](../../docs/03-engineering/ARCHITECTURE.md) · [DATA_PIPELINE §2](../../docs/04-ai/DATA_PIPELINE.md) · [PRM-CLIPPROP](../../ai/prompts/clip_window_proposer.md) · [API_SPEC](../../docs/03-engineering/API_SPEC.md) API-37, API-55, API-67 · Backlog: MD-217 (RW-1), MD-218

The offline, pure parts of the Nazar clip pipeline: the `clip.json` schema and its status machine, ffmpeg/ffprobe argv builders and output parsers, the blur plan and filter graph, the WCAG flash check, two-rater agreement and adjudication, difficulty, the step definitions for `clip_ingest` / `clip_finalize`, and the manifests. **Nothing here spawns a process, opens a file, calls a model or reads the clock.** The RW-1 tasks in `services/workflows` import this package and do the I/O.

Runtime dependency: `zod` only (`node:crypto` for sha256 in manifests).

## Commands

| Task | Command (from `packages/clip-pipeline`) |
|---|---|
| Tests | `node --test --experimental-strip-types "test/**/*.test.ts"` |
| Typecheck | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` |
| Build | `pnpm --filter @margdarshak/clip-pipeline build` → `dist/`. Exports resolve `margdarshak-source` → `src/*.ts` (tests, dev with `--conditions=margdarshak-source`) and `dist` otherwise, like game-core, so `services/workflows` can run it from `node_modules` in production |
| Lint (repo root) | `node node_modules/@biomejs/biome/bin/biome check packages/clip-pipeline` |
| Regenerate JSON Schema | `node --experimental-strip-types scripts/gen-schema.ts`, then `biome format --write packages/clip-pipeline/schema` |

`test/smoke-ffmpeg.test.ts` runs the real ffmpeg on synthetic lavfi sources when `ffmpeg -version` succeeds and skips otherwise. The JSON Schema drift test compares parsed JSON, so biome's formatting of the file does not matter.

## Pipeline

| # | Task | Step | Runs in | Go job step | Uses (this package) | Status after | Retry / timeout | On failure |
|---|---|---|---|---|---|---|---|---|
| 1 | `clip_ingest` | `transcode` | task | | `buildProbeArgv`, `parseFfprobeJson`, `checkRawUpload`, `buildMezzanineArgv` | transcoded | 3 × 1.5×, 30 min | run fails, re-run safe |
| 2 | `clip_ingest` | `blur` | task | | `planBlurRegions`, `buildBlurArgv`, `checkDeliveryRendition`, `buildPosterArgv`, `posterTimeMs` | blurred | 3 × 1.5×, 30 min | run fails; nothing unblurred is public |
| 3 | `clip_ingest` | `flash_check` | task | | `buildLumaGridArgv`, `parseLumaGrid`, `flashCheckFromLuma` | (result stored) | 3 × 1.5×, 10 min | flagged clip excluded from mocks/default set |
| 4 | `clip_ingest` | `propose_windows` | task | | `ClipProposalSchema`, `proposalToWindows`, `mergeChunkProposals` | (proposals stored) | 3 × 1.5×, 10 min | continue without proposals |
| 5 | `clip_ingest` | `open_review` | api | `clip.open_review` | `transition` | proposed | 3 × 1.5×, 2 min | retried; API dedupes |
| | n8n W08 | blur audit + two blind raters (hours to days) | human | API-55 | `RaterSubmissionSchema`, `BlurAuditRecord` | | | reminders, reassignment |
| 6 | `clip_finalize` | `agreement` | api | `clip.agreement` | `computeAgreement`, `adjudicate`, `finalWindow` | rated | 3, 5 min | → `clip.request_adjudication` (status adjudication), run ends |
| 7 | `clip_finalize` | `blur_audit_check` | api | `clip.blur_audit_check` | `blurAuditPasses`, `clipBlurAuditPasses` | | 3, 5 min | → re-blur with manual masks, run ends |
| 8 | `clip_finalize` | `delete_raw` (MD-218) | api | `clip.delete_raw` | `rawDeletionDeadline`, `checkRawDeletion` | | 3, 5 min | alert; deadline still applies |
| 9 | `clip_finalize` | `publish_manifest` | task+api | `clip.publish_manifest` | `transition`, `checkInvariants`, `buildBankManifest`, `buildClientManifest` | published | 3, 10 min | previous manifest stays live |
| 10 | `clip_finalize` | `cdn_warm` | task | | `mediaObjectKey` | | 3, 5 min | logged only |
| 11 | `clip_finalize` | `recompute_difficulty` | api | `clip.recompute_difficulty` | `empiricalDifficulty`, `validateCuratorDifficulty` | | 3, 5 min | nightly stats recomputes |

The same data is exported as `CLIP_INGEST_STEPS` / `CLIP_FINALIZE_STEPS` (`src/steps.ts`), with inputs, outputs and the `uses` list (a test checks every name exists). Idempotency keys: `stepIdempotencyKey(step, clipId, version[, round])` → `JMU-0012:transcode:3`, and `JMU-0012:agreement:3:r2` for a finalize re-run after adjudication. Object keys: `artefactKey()` and `mediaObjectKey()` are deterministic per clip version, so a re-run overwrites in place.

Status machine (`src/status.ts`):

| From | Allowed to |
|---|---|
| raw | transcoded, retired |
| transcoded | blurred (filmed), proposed (ai_generated), retired |
| blurred | blurred (re-blur), audited, proposed, retired |
| audited | proposed, retired |
| proposed | rated, adjudication, retired |
| adjudication | rated, retired |
| rated | published, retired |
| published | retired |
| retired | (terminal) |

Per origin (`isAllowedFor`, ADR-0013): `ai_generated` clips never enter `blurred` or `audited` (raw → transcoded → proposed → rated → published); `filmed` clips never take `transcoded → proposed`. Publishing an `ai_generated` clip needs a `syntheticReview` instead of the blur audit; two agreeing raters (or an adjudication) are required for every origin.

`transition(clip, to)` checks the edge and the invariants of `to`: renditions exist from `blurred` on; no final windows before `rated`; `audited` needs a passing audit; `rated`/`published` need every hazard from two agreeing raters (Δ within tolerance) or an adjudication, ≤ 2 hazards; `published` also needs `blurAudit.framesChecked ≥ floor(durationMs × 30 / 1000)` with `misses = 0`, 20–60 s, a curator difficulty consistent with the rubric.

## API

| Module (subpath) | Exports |
|---|---|
| `schema` | `ClipSchema`, `parseClip`, `Clip`, `ClipHazard`, `HAZARD_TYPES` (§3.3, 15), `HAZARD_MODULES`, `CLIP_STATUSES`, `RENDITIONS`, `LICENCE`, `ATTRIBUTION`, `DELIVERY_FPS`, `MAX_HAZARDS_PER_CLIP`, `clipRef`, `expectedFrameCount`, `clipJsonSchema`, `CLIP_ORIGINS`, `GenerationSchema`, `SyntheticReviewSchema`, `SCENE_ID_RE`, `BATCH_ID_RE`, `GENERATED_MAX_MS` |
| `status` | `TRANSITIONS`, `isAllowedTransition`, `transition`, `checkInvariants`, `clipBlurAuditPasses`, `mockEligibility`, `PUBLISH_DURATION_MS`, `isAllowedFor`, `AI_SKIPPED_STATUSES`, `syntheticReviewPasses`, `clipReviewPasses` |
| `projection` | `toScoringClip` → `{clipId, version, speedKmhEst, durationMs, hazards[{hazardId, hazardType, window{aMs,bMs}}], quietSegments}`, `ScoringClipSchema`, `toClientManifestEntry(clip, {mockEligible, urlFor?})`, `mediaObjectKey` |
| `ffmpeg` | `Command {file, args}`, `buildMezzanineArgv`, `buildTranscodeArgv`, `buildStripMetadataArgv`, `buildPosterArgv`, `posterTimeMs`, `buildProbeArgv`, `encodeArgs`, `stripArgs`, `RENDITION_SPECS`, `ENCODER`, `assertSafeMediaPath`, `escapeFilterValue` |
| `probe` | `parseFfprobeJson` → `ProbeResult`, `findPrivacyMetadata`, `checkDeliveryRendition`, `checkRawUpload`, `sizeBudgetBytes` |
| `flash` | `buildLumaStatsArgv` + `parseSignalstatsMetadata` / `parseMetadataPrint`, `buildLumaGridArgv` + `parseLumaGrid`, `lumaToRelativeLuminance`, `findTransitions`, `countFlashes(series, fps)`, `flashCheck(regions, fps)`, `flashCheckFromLuma` |
| `blur` | `Detection`, `BLUR_POLICY`, `planBlurRegions`, `buildBlurFilterGraph`, `buildBlurArgv` → `{command, filterGraph, regions}`, `BlurAuditRecord`, `blurAuditPasses`, `blurAuditIssues`, `toClipBlurAudit`, `manualMask`, `RawDeletionRecord`, `rawDeletionDeadline`, `checkRawDeletion` |
| `agreement` | `RaterSubmissionSchema`, `computeAgreement(a, b, {durationMs?, proposals?}, opts?)` → `ClipAgreement`, `finalWindow`, `adjudicate`, `batchAgreementStats`, `fieldKitH4MedianOnsetS`, `raterDrift`, `DEFAULT_AGREEMENT`, `NAZAR_63_PER_HAZARD`, `BATCH_TARGETS` |
| `proposals` | `ClipProposalSchema`, `PROMPT_LABEL_MAP`, `proposalToWindows`, `mergeChunkProposals`, `compareProposals` |
| `difficulty` | `rubricFactsFromClip`, `validateCuratorDifficulty`, `empiricalDifficulty`, `pointsToLevel`, `CLOSE_HAZARD_GAP_MS` |
| `steps` | `CLIP_INGEST_STEPS`, `CLIP_FINALIZE_STEPS`, `CLIP_GENERATE_STEPS`, `CLIP_GENERATE_FLOW`, `TASK_LIMITS`, `stepsFor`, `stepIdempotencyKey`, `artefactKey` |
| `generation` | `SceneSpecSchema`, `ShotSpecSchema`, `buildShotPrompts`, `GUARDRAILS`, `guardrailBlock`, `PROMPT_TEMPLATES`, `CLIP_GENERATOR_PROMPT`, `DEFAULT_VIDEO_MODEL`, `GENERATION_LIMITS`, `approximateOnsetHint`, `nominalOnsetS`, `sceneShotIssues`, `sceneClipFacts`, `generationRecord`, `generationIdempotencyKey`, `generatedObjectKey` |
| `manifest` | `buildBankManifest`, `buildClientManifest`, `latestReleasedVersions` |
| `./clip.schema.json` | generated JSON Schema (draft 2020-12) |

## AI-generated clips (ADR-0013)

The hackathon bank is AI-generated from `content/nazar/scenes.json` (Gemini Omni Flash). What this package adds:

- **clip.json:** `origin` (`filmed` default, so older files still parse), `generation` (model, sceneId, promptVersion, seedOrBatchId, generatedAt month, durationMs, extensions, `synthId: true`, `disclosure: "ai_generated"`; no prompt text), `syntheticReview` (curator pseudonym, time, five literal-true checks), `speedSource: "scene_spec"`. The superRefine ties them together: an AI clip needs its generation record, has no blur audit, takes its speed from the scene and its `capturedMonth` from the generation month; a filmed clip has none of the AI fields.
- **Status:** see the table above; `clipReviewPasses` is the per-origin gate for the Go `clip.blur_audit_check` step.
- **Projections:** the client entry carries `origin: "ai_generated"` for AI clips only (filmed entries keep their exact pre-ADR shape, which the score verifier's strict response schema expects); the bank entry adds `origin`, `generation` and the review without the reviewer pseudonym, with `blurAudit: null`.
- **Generation (`src/generation.ts`):** the consumer schema of a scene, the versioned template and guardrails (mirrored in `ai/prompts/clip_generator.md`, drift test in `test/ai-generated.test.ts`), `buildShotPrompts` (every prompt ends with the guardrail block), the approximate onset hint for raters (from the measured turn lengths, ± 3 s, never authoritative), scene → clip.json facts, and keys idempotent per `sceneId:version:batchId`.
- **Steps:** `CLIP_GENERATE_STEPS` (generate, precheck, register → Go `clip.register_generated`, render) and `CLIP_GENERATE_FLOW`, which reuses the clip_ingest transcode, flash_check, propose_windows and open_review subtasks.

`services/api/internal/clips/clip.schema.json` is a byte copy of `schema/clip.schema.json` with a drift test on the Go side: refresh it after regenerating here.

## Design choices

**Schema and privacy.** Every object is strict, so a `lat`, `gps`, `location` or street field is rejected anywhere in `clip.json`. `city` is letters only (no digits, so no addresses, pin codes or coordinates); `capturedMonth` is `YYYY-MM`; person IDs (`auditor`, raters) must match a pseudonym pattern. The bank manifest drops the auditor pseudonym (NAZAR §11: CC-BY metadata "without rater pseudonyms").

**Encoding** (NAZAR §3.1). H.264 High@3.1, yuv420p, CRF 28, preset slow, 30 fps CFR, fixed 1 s GOP (`-g 30 -keyint_min 30 -sc_threshold 0`), `+faststart`, VBV cap 600k/1200k at 360p and 900k/1800k at 480p to hold the ~2 MB per 30 s budget. Level 3.1 is the lowest that fits 480p30; yuv420p and High@3.1 play on every Android hardware decoder. Fixed GOP gives replay seeks within 1 s and keeps frame N at N/30 s, which the blur timeline, the flash check and frame-snapped windows rely on.

**Two ffmpeg passes, not three.** `transcode` makes a private mezzanine (≤ 1080 lines, CRF 18, CFR 30, metadata stripped, no audio). `blur` decodes the mezzanine once, blurs at full resolution, then splits and scales to 360p and 480p in the same graph. Unblurred delivery files never exist, and blurring before downscaling destroys more detail. `buildTranscodeArgv` (direct renditions) shares the encoder settings and exists for fixtures and re-encodes.

**Audio.** Dropped everywhere (`-an`, and only `0:v:0` is mapped): NAZAR §3.1 "stripped (privacy and no-audio design)" and §4 "we do not record audio".

**Metadata strip.** Map the first video stream only (drops audio, subtitles and data tracks such as GPS/telemetry), `-map_metadata -1`, `-map_chapters -1`, `+bitexact` (no encoder tag or muxer timestamps). Rotation is applied by ffmpeg's default autorotate. `findPrivacyMetadata` is an allowlist check on ffprobe tags (anything but brand/encoder/handler/vendor/language is a finding), and `checkDeliveryRendition` fails on it.

**Blur policy** (`BLUR_POLICY`, deterministic, order-independent). Thresholds for recall: face ≥ 0.5, plate ≥ 0.35, manual masks always. Padding per side: faces 30%, plates 20%. Detections of a class link into one region when their padded boxes touch and the frame gap is ≤ 5 (NAZAR's interpolation gap; the union box covers any interpolated position); a region spans ≤ 15 frames so a moving face gets a chain of short boxes, not one box over its path. Each region is dilated ±3 frames (DATA_PIPELINE). Pixels are snapped outward to even numbers (yuv420p). Strength: Gaussian `sigma = max(8, ⌈max(w,h)/6⌉)`, so the kernel (≈ 6σ) is at least the box width, well above "kernel ≥ 1/3 of box width". Each region is a `split → crop → gblur → overlay` stage with `enable='between(t,a,b)'` padded by half a frame. Graphs longer than 24 000 chars must go through a file (`graphFile`, `-/filter_complex`, ffmpeg ≥ 7; Windows caps a command line at 32 767 chars).

**Flash check** (WCAG 2.3.1 general flash). Pairs of opposing relative-luminance changes ≥ 0.1 with the darker side < 0.8; fail when any 1 s window has more than 3 flashes. Approximations: luma, not luminance (limited-range Y′ → sRGB curve), no red-flash rule; area via a 3×3 grid of area-averaged luma, and one tile (1/9 of the frame) is the same 11.1% of the screen that WCAG's 0.006 sr threshold works out to (341×256 of 1024×768). A flash straddling tiles is diluted. Counting uses a hysteresis state machine; 7 transitions (3.5 flashes) in a second fail (conservative). The smoke test confirms 3 flashes/s passes and 3.75 fails on real encoded video.

**Agreement matching** (`src/match.ts`). Both raters' marks are put in canonical order (onset, end, type, cue), so submission order never matters. Candidates are cross pairs with temporal IoU ≥ 0.3 (DATA_PIPELINE §2.3); they are sorted by same type first, then IoU descending, |Δonset| ascending, then indices; greedy one-to-one. The type preference only decides between overlapping candidates. Cluster IDs (`c1…`) follow the timeline, so they are stable across reruns and rater order. A clip is accepted when every candidate hazard is a matched pair of the same type with Δonset ≤ 500 ms and Δend ≤ 1000 ms, there are ≤ 2 hazards, and no M-06 proposal went unmarked by both raters (§6.2.3). Otherwise `needsThirdRater`.

**Final window.** Two marks: mean; three marks: median (§6.4); snapped to the nearest 30 fps frame in integer ms (DATA_PIPELINE §2.3). `deltaOnsetMs`/`deltaEndMs` on an adjudicated hazard are the spread (max − min) of its marks.

**Adjudication.** The third person rules on every cluster: `not_hazard` drops it; `hazard` must include their own mark (median of three for a pair, mean of two for a single-rater hazard; their type wins). A proposal nobody marked plus the adjudicator is one human mark, which stays unresolved: two humans set every final window (D-09). Proposals never produce a final window anywhere in this package.

**Batch metrics.** `batchAgreementStats` uses raw two-rater pairs before adjudication: median |Δonset| (H4, ≤ 500 ms), median |Δend| (≤ 1000 ms), Cohen's κ over (clip, candidate hazard) pairs with quiet clips as (absent, absent) (≥ 0.6); κ is `null` when undefined. `fieldKitH4MedianOnsetS` is a literal port of `nazar_stats.py`'s H4 line. Medians follow Python's `statistics.median`.

**Difficulty.** Rubric errors are contradictions with clip.json facts (hazard count, occlusion, light/weather, hazards < 3 s apart) or with a declared `false`; warnings ask the curator to confirm what only they can see (subtle cues, busy scene, distractors). Empirical difficulty: earliest eligible attempt per taker (verified, trust ≥ 0.6, unseen), mean points per hazard, shown at ≥ 30 takers; for the ≥ 2-level flag, points map to the curator scale as `1 + (5 − points) × 4/5` because more points means easier.

**Manifests.** One entry per clipId (highest published-or-retired version), sorted by clipId, sha256 over canonical JSON. The bank manifest (CC-BY record, verifier source) carries final windows and `retired` stubs; the client manifest (API-37) carries no hazard information at all.

## Deviations from the spec, and why

| Spec | Here | Why |
|---|---|---|
| NAZAR §6.3 per-hazard acceptance Δonset ≤ 1.0 s, Δend ≤ 1.5 s | Default Δonset ≤ 0.5 s, Δend ≤ 1.0 s; NAZAR's bound is `NAZAR_63_PER_HAZARD` | ARCHITECTURE §8, DATA_PIPELINE §2.3 and MD-217 all say 0.5 s; DATA_PIPELINE pairs it with 1.0 s. Stricter sends more to a human, never less. |
| ARCHITECTURE §8 `clip_finalize` has no raw deletion | Added `delete_raw` after `blur_audit_check` | MD-218, NAZAR §4 (after audit, ≤ 7 days), DATA_PIPELINE §2 (≤ 24 h after audit). |
| ARCHITECTURE §8 "transcode → 360p/480p" then blur | `transcode` makes a private mezzanine; `blur` renders the 360p/480p deliverables | No unblurred delivery file ever exists; one decode for both renditions. |
| NAZAR §5 plates: "box blur" | Strong Gaussian for plates too | Same or stronger obfuscation; ffmpeg `boxblur` radius limits on small crops (chroma ≤ ¼ of the box) make it fragile. |
| NAZAR §0 / DATA_PIPELINE: audit before `propose_windows` | Status machine allows both `blurred → audited → proposed` and `blurred → proposed` | ARCHITECTURE §8 runs proposals inside `clip_ingest`, before the human audit. Publish always needs the audit. See open question 1. |
| Idempotency `clipId:step:version` | Plus `:r<round>` for finalize re-runs | Without it a post-adjudication `agreement` call would be deduped to the first (failed) answer. |
| API-37 "never sent to clients" vs DATA_PIPELINE manifest with `hazards` | Two manifests: bank (with windows) and client (without) | Satisfies both; the bank one is server-side. See open question 2. |
| `roadType`, `timeOfDay`, `weather`, `pov`, `speedSource` (one example each in §3.2) | Closed enums (`ROAD_TYPES`, `TIMES_OF_DAY`, `WEATHERS`, `POVS` = `2W`/`4W`, `SPEED_SOURCES` incl. `not_logged`) | Free text could leak a location; values are ours. `speedKmhEst` is nullable exactly when `speedSource = not_logged` (NAZAR §4 "speed not logged"). |
| §7.1 "close together" / "far apart" | `CLOSE_HAZARD_GAP_MS = 3000` (overlap or < 3 s between windows) | Not quantified in the spec. |
| Prompt labels (PRM-CLIPPROP 1.0.0) differ from §3.3 | `PROMPT_LABEL_MAP` maps them; `two_wheeler_cut_in` → `other` | No §3.3 type for a 2W cut-in. |
| Flash check | Luma approximation, 3×3 grid, no red-flash rule | Documented above; a true WCAG tool (PEAT/Harding) is out of scope offline. |

## What RW-1 must do to wire this

1. Add `"@margdarshak/clip-pipeline": "workspace:*"` to `services/workflows` (lockfile update by whoever owns installs).
2. Define `clip_ingest` and `clip_finalize` with `defineTask`, one `ctx.run` subtask per entry of `CLIP_INGEST_STEPS` / `CLIP_FINALIZE_STEPS`, using each step's `retry` and `timeoutSeconds`, and `stepIdempotencyKey` for every `api.step(...)` call (with `round` for finalize).
3. Media steps: download inputs from R2 to a temp dir, `spawn(cmd.file, cmd.args)` for each `Command` (never a shell), parse outputs with `parseFfprobeJson` / `parseLumaGrid`, check renditions with `checkDeliveryRendition`, sha256 the files, upload to the `mediaObjectKey` / `artefactKey` keys. Write `filterGraph` to `graphFile` when the inline graph is too long.
4. Run YuNet and the plate model (onnxruntime-node) on mezzanine frames and emit `Detection[]` (normalised boxes, 30 fps frame ranges). Audit misses come back as `manualMask(...)` detections for the re-blur.
5. Send only IDs, hashes, small results (flash result, region summary, proposals) to `clip.open_review`; never media (args ≤ 16 KB).
6. Go owns `clip.agreement`, `clip.blur_audit_check`, `clip.delete_raw`, `clip.publish_manifest` and `clip.recompute_difficulty`. Port `computeAgreement` / `adjudicate` / `finalWindow` to Go and run `test/fixtures/agreement-golden.json` in the Go tests, or have the Go step call a TS helper.
7. In `publish_manifest`, build `buildBankManifest` and `buildClientManifest` from the clips the API returns and upload them as a new manifest version (keep the previous one for rollback).

## Open questions

1. **Audit before Gemini?** ARCHITECTURE §8 sends blurred-but-unaudited 360p media to Gemini in `clip_ingest`; DATA_PIPELINE §2 audits first. A missed face would reach the model. Owner decision: keep ARCHITECTURE's order (demo retry visible early) or move `propose_windows` after the audit.
2. **Public CC-BY windows vs mock integrity.** NAZAR §11 licenses final windows CC-BY; §3.2 and API-37 keep mock windows from clients. Publishing the bank manifest openly lets anyone learn mock answers. Suggest releasing windows only for non-mock or retired clips.
3. **Per-hazard tolerance.** Confirm 0.5 s / 1.0 s (engineering docs) over NAZAR §6.3's 1.0 s / 1.5 s.
4. **Status vocabulary.** API-55 uses `transcoding`, `awaiting_ratings`, `needs_adjudication`; clip.json uses NAZAR's enum. The Go side needs one mapping (`awaiting_ratings` ≈ `proposed`, `needs_adjudication` ≈ `adjudication`).
5. **Enums** for `roadType`, `weather`, `pov` (`4W` vs `car`) and `speedSource` need the Nazar owner's sign-off.
6. **Plate detector** model and licence are still unverified (NAZAR §15); thresholds in `BLUR_POLICY` should be re-tuned on real footage.
7. **Per-step progress** in clip admin would need extra Go job steps (ARCHITECTURE lists only `clip.open_review` in `clip_ingest`); today `open_review` records all ingest results at once.
