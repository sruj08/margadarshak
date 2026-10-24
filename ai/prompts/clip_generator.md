---
id: PRM-CLIPGEN
version: 1.0.0
agent: ClipGenerator (video generation), offline, inside Render Workflow clip_generate.generate
model_env: GEMINI_MODEL_VIDEO_GEN        # default gemini-omni-1.1-flash (Gemini Omni Flash)
key_env: GEMINI_API_KEY                  # never logged, never sent anywhere but the Gemini API
output: one 16:9 720p video per scene (opening shot + extension turns, at most 40 s), SynthID-watermarked
state_inputs: [scene (content/nazar/scenes.json), shot n of total]
tools: none
owner: Nazar owner
reviewed_by: [Nazar owner, Pipeline lead]
eval: every output goes through the curator's syntheticReview (5 checks) and two blind human raters; no model output sets a window
code_mirror: packages/clip-pipeline/src/generation.ts (GUARDRAILS, PROMPT_TEMPLATES); test/ai-generated.test.ts fails if this file and the code drift
changelog:
  - 1.0.0 (2026-10-24): initial (ADR-0013, AI-generated clip bank for the hackathon build)
---

# Purpose

Margdarshak's Nazar practice bank is **AI-generated** for the hackathon build (ADR-0013). Each scene in `content/nazar/scenes.json` describes a calm, legal ride or drive on a fictional Indian road in which one hazard **develops** (its cue first) and then resolves without harm, or nothing happens at all (a quiet scene). This prompt turns one scene into one continuous forward-facing video: an opening shot, then extension turns (`previous_interaction_id`), each 3–10 s, at most 40 s in total.

The output is never "real footage", never Kerala's clips and never a government asset. Every clip is labelled "AI-generated scene" wherever it appears, carries Google's invisible SynthID watermark, and records `origin: "ai_generated"` with its `generation` metadata in `clip.json`. Two human raters set every scoring window; the scene's nominal onset is only a hint for their first look.

# Template

Placeholders are filled by `buildShotPrompts(scene)`:

| Placeholder | From |
|---|---|
| `{pov_camera}` | `pov`: 2W = helmet-height camera on a scooter; 4W = dashboard camera in a small hatchback |
| `{scene}` | `scene` (the setting, in plain English, no place names that identify a real spot) |
| `{time_weather}` | `timeOfDay` + `weather` (dawn/day/dusk; clear, overcast, haze, rain, fog) |
| `{speed_kmh}` | `speedKmh` (10–60, calm and legal for the setting) |
| `{n}`, `{total}`, `{duration_s}`, `{shot}` | the shot list: number, count, length, what happens in this shot |
| `{guardrails}` | the guardrail block below, one `- ` line each, in every prompt |

Opening shot (turn 1):

<!-- template:opening:start -->
```text
Photorealistic forward-facing video from a {pov_camera}, showing a fictional, AI-generated Indian road scene. {scene} {time_weather}. The camera vehicle moves steadily at about {speed_kmh} km/h in its own lane. One continuous shot, no cuts, eye-level, natural colours.
Shot {n} of {total}, about {duration_s} seconds: {shot}

Rules for every frame:
{guardrails}
```
<!-- template:opening:end -->

Extension turns (turn 2 onwards, with `previous_interaction_id` = the previous turn):

<!-- template:extension:start -->
```text
Extend the previous video as one continuous shot from its last frame: same camera, same road, same light and weather, same steady speed of about {speed_kmh} km/h.
Shot {n} of {total}, about {duration_s} seconds: {shot}

Rules for every frame:
{guardrails}
```
<!-- template:extension:end -->

# Guardrails (appended to every prompt)

<!-- guardrails:start -->
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
<!-- guardrails:end -->

The model has no negative-prompt field and no system instruction (Gemini Omni docs), so the guardrails live in the prompt text itself. The generated audio is described only so that no speech is ever generated; the delivery pipeline strips every audio track anyway (NAZAR §3.1, no-audio design).

# Writing scenes (rules for `content/nazar/scenes.json` authors)

1. **Lead-in:** at least 10 s of calm, ordinary traffic before the cue. The hazard begins in a named extension shot (`hazardBegins: true`, `cueAtS` seconds into it), never in the opening shot, and at least 4 s remain after the cue for it to develop and resolve.
2. **Cue first:** describe the early sign (feet under a bus, a door edge moving, a calf's head at the verge) before the movement.
3. **Resolution:** the camera vehicle eases off or holds back; the other road user completes the move unharmed. Never describe contact, a fall, a near miss "by inches", or anyone's reaction to danger.
4. **Speed:** state nothing faster than the scene's `speedKmh`; no overtaking by the camera vehicle; school zones and markets at 25 km/h or less.
5. **People:** generic and ordinary (a schoolchild in a uniform, an older man with an umbrella), never a named or famous person, never a minor in a risky position: a child at a school gate is held back by an adult or a crossing guide.
6. **Places:** regional character (Kerala backwaters town, Jammu hill road, metro arterial) without a real landmark, shop name or readable sign.
7. **No text:** no road-sign wording, shop names, bus route boards or plates to read.
8. **Quiet scenes:** ordinary traffic that keeps its lanes; nothing that a careful rider would treat as a developing hazard.

# Changing this prompt

Bump `version` here and `CLIP_GENERATOR_PROMPT.version` in `packages/clip-pipeline/src/generation.ts`, update `GUARDRAILS` / `PROMPT_TEMPLATES` to the same text (the drift test compares them), and set `promptVersion` in `content/nazar/scenes.json`. Clips record the `promptVersion` they were made with, so older clips stay traceable.
