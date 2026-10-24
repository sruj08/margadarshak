# Nazar video generation guide (Gemini) — prompts, rules and implementation

How to generate Nazar's hazard-perception clips with Gemini so they look like real helmet-cam / dashcam footage from Indian roads: real camera behaviour, believable motion and physics, no "AI look". **This guide does not generate anything**; it gives the ready prompt and everything needed to run the existing pipeline. Decision record: [ADR-0013](docs/03-engineering/adr/ADR-0013-ai-generated-clips.md). Scene data: [content/nazar/scenes.json](content/nazar/scenes.json) (29 scenes). Live prompt today: [ai/prompts/clip_generator.md](ai/prompts/clip_generator.md) (PRM-CLIPGEN 1.0.0).

> **Realistic look, honest label.** We make the *pixels* as real as we can. We never hide where they came from: every clip keeps its `origin: "ai_generated"` and `generation` record in `clip.json`, Google's SynthID watermark, and the "AI-generated scene" chip in the app. Pitch and study copy say "AI-generated road scenes", never "real Indian roads" or "real footage" (ADR-0013, CLAUDE.md wording rules). The prompt itself no longer needs to say "AI-generated": that phrase tends to make the model stylise the output, and the disclosure lives in metadata and UI, not in the frames.

---

## 1. What the API gives us (verified 24 Oct 2026)

| Fact | Value | Source |
|---|---|---|
| Model | `gemini-omni-1.1-flash` (Gemini Omni Flash). Veo 3.1 previews were shut down 22 Oct 2026 | ai.google.dev/gemini-api/docs/video |
| Call | `ai.interactions.create({ model, input, previous_interaction_id?, response_format: { type: "video", aspect_ratio, resolution, delivery? } })` in `@google/genai` 2.28.0 | docs/omni + SDK typings |
| Length | opening turn (smoke test: 8 s) + extension turns of 3–10 s each, **max 40 s total** | docs/omni |
| Format | 16:9 or 9:16; 360p / 720p (1080p, 4k are upscaled) | docs/omni |
| Conditioning | image-to-video, first/last-frame, subject reference images, up to 3 reference video clips ≤ 3 s | docs/omni |
| Not available | negative-prompt field, system instruction | docs/omni |
| Watermark | SynthID on every output | docs/omni |
| Observed (our 16 s smoke test) | 1280×720, **24 fps**, AAC audio, `encoder=Google` tag; turn 1 took 59 s, turn 2 (16 s) 115 s; **each extension returns the whole video so far** | `scratchpad/gemini-smoke/report.json` |
| Price | about **$0.10 per second** at 720p (pricing page, 22 Oct 2026); no free tier | pricing page |

**Unverified (do not rely on):** a seed parameter, frame-rate control, camera-control fields, whether extensions bill only new seconds or the whole cumulative video.

---

## 2. The ready prompt — proposed PRM-CLIPGEN 1.1.0

Three blocks go into every turn: the **shot text** (from the scene), the **realism block** (camera and physics), and the **guardrails** (unchanged from 1.0.0, word for word). Extension turns add a **continuity lock**.

### 2.1 Opening turn (turn 1)

```text
Raw, unedited {pov_camera_long} footage recorded at a generic, unidentifiable location on an ordinary Indian road (no real landmark or recognisable place). {scene} {time_weather_long}.
The camera vehicle rides steadily at about {speed_kmh} km/h in its own lane. One continuous take, no cuts, no zoom, no camera tricks.
Shot {n} of {total}, about {duration_s} seconds: {shot}

Camera and image:
{realism}

Rules for every frame:
{guardrails}
```

### 2.2 Extension turns (turn 2 onwards, `previous_interaction_id` = previous turn)

```text
Continue the same raw {pov_short} recording seamlessly from its last frame, as one unbroken take.
Continuity: same camera mount and lens, same framing height, same road, same lane, same vehicles in the same places and colours, same people and clothing, same light, same weather, same steady speed of about {speed_kmh} km/h. Nothing appears, disappears or changes shape between frames.
Shot {n} of {total}, about {duration_s} seconds: {shot}

Camera and image:
{realism}

Rules for every frame:
{guardrails}
```

### 2.3 `{pov_camera_long}` / `{pov_short}` (per POV)

| POV | `{pov_camera_long}` | `{pov_short}` |
|---|---|---|
| 2W | a helmet-mounted action camera on a scooter rider, wide-angle lens at eye height, the scooter's handlebar and mirror stems just visible at the bottom edge | helmet-cam |
| 4W | a dashboard camera behind the windscreen of a small hatchback, wide-angle lens, the bonnet edge just visible at the bottom, faint dust and a thin reflection on the glass | dashcam |

### 2.4 `{time_weather_long}`

| Field | Text |
|---|---|
| dawn | Early morning, soft low sun, long shadows, slightly cool colour |
| day | Daytime, harsh overhead sun, hard shadows, bright sky that is slightly overexposed |
| dusk | Dusk, low warm sun, headlights and tail-lights on, rising sensor noise in the shadows |
| clear / overcast / haze | clear weather · flat overcast light, soft shadows · light dusty haze softening the distance |
| rain | steady light rain, wet road with reflections, water droplets on the lens or windscreen (for 4W, an occasional wiper sweep) |
| fog | light fog, distant objects fade, the road ahead still clearly visible |

### 2.5 `{realism}` block (camera behaviour + physics; same in every turn)

```text
- Looks like consumer action-cam / dashcam video: wide-angle lens with mild barrel distortion at the edges, slight purple fringing on bright edges, auto-exposure that adjusts a little when passing from sun into shade, auto white balance, light compression softness, natural motion blur on moving objects, slight rolling-shutter lean on fast-passing poles.
- Natural mount motion: small continuous vibration from the road surface, gentle bumps over uneven patches, a slight sway on turns; the horizon stays roughly level; no smooth gimbal or drone movement.
- Real physics: the camera vehicle keeps a constant, believable speed; near objects pass faster than far ones (correct parallax); wheels rotate in step with movement; vehicles accelerate, brake and turn gradually with weight; pedestrians walk with natural gait and timing; shadows stay consistent with one sun position.
- Object permanence: every vehicle, person and animal keeps the same shape, size, colour and count from frame to frame; nothing morphs, melts, duplicates or vanishes.
- Ordinary Indian road texture: faded and patchy lane paint, dust at the edges, small potholes and patched asphalt, uneven footpaths, mixed traffic of scooters, motorcycles, auto-rickshaws, small cars and buses moving at modest, varied speeds.
- Plain, unbranded surroundings: generic shop fronts and walls, sign boards without readable writing, vehicles in common colours (white, silver, grey, red, blue) without logos.
- People are ordinary and mostly small in frame: seen from a distance, side-on or from behind, faces not in close-up and not sharply detailed.
- Natural, slightly muted colour like a real camera; no cinematic grading, no glow, no HDR look, no slow motion, no lens flare effects added for style.
```

### 2.6 `{guardrails}` (unchanged from 1.0.0 — keep word for word)

```text
- No collision, no contact between road users, no fall, no injury, no blood and no crash aftermath at any moment.
- No real brands, logos, trademarks or company liveries on vehicles, shops, buses or signs; signboards and shop fronts carry no readable words.
- Every number plate is blank or blurred beyond reading at every moment.
- No recognisable real people or celebrities: everyone is an ordinary, generic person.
- No text overlays, captions, subtitles, logos, watermarks, timestamps or on-screen graphics.
- The camera vehicle keeps a calm, legal speed and stays in its lane: no speeding, racing, stunts, wheelies or risky overtaking.
- Audio: ambient traffic sound only (engines, distant horns, rain if it is raining). No speech, no dialogue, no voice-over, no music.
- Any developing hazard shows its early cue first, develops gradually, and then resolves safely: the camera vehicle eases off or holds back and everyone carries on unharmed.
```

"Realistic physics" never means contact, a near miss "by inches", a fall or speed. The hazard *develops* and *resolves*; the learner is scored on noticing the cue early.

### 2.7 Worked example — SCN-001 (bus-stop pedestrian, 2W, day, 30 km/h), turn 3 (the hazard turn)

```text
Continue the same raw helmet-cam recording seamlessly from its last frame, as one unbroken take.
Continuity: same camera mount and lens, same framing height, same road, same lane, same vehicles in the same places and colours, same people and clothing, same light, same weather, same steady speed of about 30 km/h. Nothing appears, disappears or changes shape between frames.
Shot 3 of 4, about 8 seconds: As the scooter draws level with the rear of the stopped bus, a pair of feet becomes visible under the front of the bus. A young man in a grey shirt then steps out from in front of the bus towards the road, looking the other way.

Camera and image:
<realism block 2.5>

Rules for every frame:
<guardrails 2.6>
```

### 2.8 Writing shot text that looks real (for `scenes.json` authors)

These **supplement** the eight scene-writing rules in `ai/prompts/clip_generator.md` ("Writing scenes"), which stay in force. Key ones restated: a child near a school gate is always held back by an adult or a crossing guide (never a minor in a risky position); no real landmark, shop name or readable sign; the camera vehicle never overtakes; school zones and markets at 25 km/h or less.

1. Describe **what the camera sees**, in plain visual terms (position, distance, motion), not feelings or danger words.
2. Keep each shot to **one action** plus the background; 1–2 sentences.
3. **Cue before movement** (feet under the bus, a door edge moving, a calf's head at the verge), then a gradual development, then the safe resolution in the next shot.
4. Keep people **small or turned away** in frame unless the cue needs them; never a face close-up.
5. Prefer **common, unbranded** objects: "a plain white city bus without markings", "a red hatchback".
6. Lead-in ≥ 10 s of ordinary traffic before the cue; ≥ 4 s after the cue for it to resolve (already enforced by `SceneSpecSchema`).

---

## 3. Faces and number plates hidden — two layers

1. **Prompt layer (always):** guardrails require blank/unreadable plates and generic people; the realism block keeps people small, distant or turned away and forbids face close-ups.
2. **Blur layer (recommended addition):** run the existing blur builders on AI clips too, so the footage looks like anonymised real dashcam video and nothing slips through:
   - Detections come from the curator's **manual masks** (`manualMask(box, fromFrame, toFrame)`) or a future detector; `planBlurRegions` + `buildBlurFilterGraph` / `buildBlurArgv` (packages/clip-pipeline `blur.ts`) render them.
   - Do it **inside `clip_generate_precheck`** (before `normalised.mp4` is written). That avoids a status change: today the clip status machine forbids AI clips from being `blurred` or `audited`, and blurring inside precheck keeps that rule intact.
   - The curator's synthetic review still checks "no readable plates" and "no real-person likeness" on the final render; a miss means **regenerate or add a mask**, never publish.

This blur layer is a **proposed change**; it is not wired yet (see §7).

---

## 4. Running the generation (implementation details)

### 4.1 Pipeline (already built)

```
Curator UI "Generate clip"  →  POST /v1/admin/clips/generate {sceneId, version, batchId}  (202)
  → Render Workflow clip_generate  (services/workflows/src/tasks/clip-generate.ts)
     1 clip_generate_generate   scene → opening + extension turns (@google/genai, 720p 16:9)
                                checkpointed per turn in generation.json; refuses to continue if an
                                extension does not return the full video so far
     2 clip_generate_precheck   ffmpeg: normalise (30 fps CFR, no audio, no metadata), strip, 480p check,
                                WCAG flash check  → normalised.mp4 (private ingest bucket)
     3 clip_generate_register   Go step clip.register_generated → clip (origin ai_generated, generation
                                record, approximate onset hint for raters only)
     4 clip_ingest_transcode, clip_generate_render (360p/480p + poster, private staging),
       clip_ingest_flash_check, clip_ingest_open_review → status "proposed"
  → two blind raters mark hazard windows → agreement (or adjudication)
  → curator: cue texts + difficulty, synthetic review (5 checks) → publish
```

Idempotent per `sceneId:version:batchId`: a finished generation is never paid for twice; model calls retry on 429/5xx. Prompts and the key are never logged.

### 4.2 Environment (Workflows service)

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | required; never logged |
| `GEMINI_MODEL_VIDEO_GEN` | optional, default `gemini-omni-1.1-flash` |
| `NAZAR_SCENES_PATH` | optional, default `content/nazar/scenes.json` |
| `FFMPEG_PATH` | ffmpeg binary (ffprobe from the same folder) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_INGEST`, `R2_BUCKET_CLIPS` | object storage |
| `FAULT_INJECTION_CLIP_BLUR` | `off` in production (`once` only for the demo retry) |

### 4.3 Where it runs, and how

**Where:** generation only happens under **Render Workflows**, either deployed or locally via `render workflows dev -- pnpm --filter @margdarshak/workflows start` (with the Go API's `JOB_RUNNER` pointing at Render Workflows). With `JOB_RUNNER=inline` (default local dev and the full-stack e2e) the `clip_generate` job returns "skipped" and no clip appears. The task writes to the R2 ingest bucket, and there is **no local object-store fallback** in the workflows service, so the `R2_*` credentials (§4.2) are required.

**How:**

1. Sign in to `/[locale]/admin` as the curator persona; open **Clips → Generate clip**; pick a scene and a batch ID (e.g. `b20261025a`).
2. Or call the API directly: `POST /v1/admin/clips/generate {"sceneId":"SCN-001","version":1,"batchId":"b20261025a"}`.
3. Watch the run on the Render Workflows Runs page; the clip appears on the curator board as `proposed`.
4. Manual smoke (one clip, costs money): `services/workflows/test/gemini-smoke.manual.ts` (writes only to the scratchpad; runs only when `GEMINI_API_KEY` is set).

### 4.4 Quality control — reject list (curator, before synthetic review; action = regenerate)

- Any vehicle, person or animal morphs, duplicates, flickers, or changes colour/shape between frames.
- Lane, road, light or weather jumps at an extension boundary (seam).
- Wrong physics: wheels not turning, sliding cars, floating people, inconsistent shadows, impossible speed changes.
- Readable text anywhere (plates, signs, shop names) or any logo.
- A face in close-up or a recognisable person.
- Any contact, near-miss "by inches", fall or speed impression.
- The hazard cue is not visible, or appears in the opening shot, or does not resolve safely.
- Cinematic look: colour grading, slow motion, lens-flare effects, gimbal-smooth motion.
- Flash check failure (handled automatically; regenerate).

### 4.5 Cost and time (budget for regenerations)

- 20 clips × ~30 s at ~$0.10/s. If each extension bills the whole video so far, a 32 s clip bills ~80 s ≈ $8 → **~$160–240**, or **~$240–360 if half need regenerating**; if only new seconds are billed, ~$60–80.
- Time: ~6–10 min per clip run sequentially → **2–3.5 h** for 20, plus raters.
- Start with **12 clips** covering the main hazard types (the DoD minimum), review quality, then generate the rest.

---

## 5. Open decision: 24 → 30 fps

Gemini output is 24 fps; the mezzanine forces **30 fps CFR**. 24 → 30 duplicates one frame in every four, which can read as judder ("looks synthetic"). Changing `ENCODER.fps` / `DELIVERY_FPS` also affects the flash check and the 30 fps frame-snapping of hazard windows, so it touches scoring. Options to decide before the full bank: (a) keep 30 fps (simplest, slight judder); (b) motion-interpolate to 30 (`minterpolate`, may add artefacts); (c) deliver AI clips at 24 fps with a reviewed change to the frame-snap and flash-check maths. Not decided here.

---

## 6. Honesty and licence

- Keep SynthID, `origin`, `generation` and the "AI-generated scene" chip. Never remove or crop them away; never describe the clips as filmed.
- Study results are reported "on AI-generated road scenes" (HYPOTHESES.draft.md).
- Unverified: whether SynthID survives our transcode (container metadata is stripped; disclosure travels in `clip.json`, manifests and the UI anyway), and whether CC-BY can be applied to Gemini outputs under the API terms (ADR-0013 open item).

---

## 7. Adopting PRM-CLIPGEN 1.1.0 (checklist — not applied yet)

The live prompt is version-locked in two places and a drift test compares them.

1. `ai/prompts/clip_generator.md`: replace the two templates with §2.1 / §2.2, **keeping the `<!-- template:opening:start/end -->`, `<!-- template:extension:start/end -->` and `<!-- guardrails:start/end -->` markers** the drift test reads; add the realism block (§2.5) inside a new `<!-- realism:start -->` / `<!-- realism:end -->` pair; bump `version` to `1.1.0`, add a changelog line.
2. `packages/clip-pipeline/src/generation.ts`: update `PROMPT_TEMPLATES`, add a `REALISM` constant, extend the POV/time/weather text maps (§2.3–2.4), bump `CLIP_GENERATOR_PROMPT.version`. `GUARDRAILS` stays unchanged. In `test/ai-generated.test.ts`, add `assert.equal(block("realism"), REALISM...)` to the drift test so the realism text cannot drift silently.
3. `content/nazar/scenes.json`: set `promptVersion` to `1.1.0`; optionally rewrite shot text per §2.8.
4. Re-run `pnpm --filter @margdarshak/clip-pipeline test` (includes the prompt drift test), `pnpm --filter @margdarshak/content test`, `pnpm --filter @margdarshak/workflows test`.
5. Optional: wire the blur layer into `clip_generate_precheck` (§3) with tests.
6. Generate 1 clip, review against §4.4, then 12, then the rest.
