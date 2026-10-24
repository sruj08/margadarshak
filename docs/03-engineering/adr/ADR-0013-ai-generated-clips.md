# ADR-0013: AI-generated clip bank for Nazar (hackathon build)
> Project: Margdarshak · Owner: Product owner (decision), Nazar owner (implementation) · Status: Accepted · Date: 2026-10-24
> Related: [NAZAR](../../09-learning-games/NAZAR.md) §16 · [FIELD_STUDY](../../08-project/FIELD_STUDY.md) · [ARCHITECTURE §8](../ARCHITECTURE.md) · [PROJECT_BRIEF](../../00-overview/PROJECT_BRIEF.md) · [ADR-0005 Render Workflows](ADR-0005-render-workflows-durable-jobs.md) · [ADR-0010 Apache-2.0 and CC-BY](ADR-0010-apache2-and-cc-by.md) · Prompt: [PRM-CLIPGEN](../../../ai/prompts/clip_generator.md) · Scenes: [`content/nazar/scenes.json`](../../../content/nazar/scenes.json)

Format: MADR 3.x, trimmed.

## Context and problem statement
Nazar (F-23) needs a bank of hazard clips before the demo: NAZAR §3.4 sets at least 12 usable mock clips plus about 10 practice clips. The bank was going to be filmed under the NAZAR §4 protocol (a passenger or fixed mount in Jammu), then blurred (YuNet plus a plate model) and audited frame by frame (§5), then rated by two humans (§6).

There is not enough time left to film, blur, audit and rate that much footage safely (R-06 too few clips). The plate detector is still unchosen and unlicensed (NAZAR §15), and filming itself carries road risk and bystander-privacy work (R-12). The product owner chose **option C: generate the clips with a video model** instead of filming.

Since 2026-10-22 the only generator in our stack is Gemini Omni Flash (`gemini-omni-1.1-flash`), because the Veo 3.1 previews closed that day. It is called through `@google/genai` 2.28.0 (`ai.interactions.create`, response format `video`). The model generates an opening shot and then extension turns (`previous_interaction_id`) of 3–10 s each, up to 40 s in total. It renders audio by default. Every output carries an invisible SynthID watermark (Gemini Omni docs, read 2026-10-24).

## Decision drivers
- **Time.** The product owner's stated reason. A scene catalogue and a generation task are hours of work. Filming plus a 100% blur audit is days.
- **Honesty (D-19, D-11).** Nothing may suggest real footage, Kerala's clips or a government asset.
- **The scoring and verification design must not change (D-09, D-11).** Two blind human raters set every window. Code scores. The server replay wins.
- **No speed or stunt content, and no harm shown.** These are product rules and Gemini usage policy.
- **Privacy.** No real person, plate or brand in the bank.

## Considered options
1. **A. Film and blur as planned** (NAZAR §4–§5).
2. **B. Use licensed third-party dash-cam footage** (NAZAR §11 "third-party footage").
3. **C. Generate the clips with Gemini Omni Flash** from a written scene catalogue, with guardrails in every prompt.

## Decision outcome
Chosen option: **C**. It is the only option that produces a 20–30 clip bank in the time left. It removes bystander-privacy risk at the source (no real people), and the rating, scoring and verification pipeline stays unchanged.

### What is built
| Part | Where |
|---|---|
| Scene catalogue | `content/nazar/scenes.json` has 29 scenes: 25 hazard scenes covering all 15 NAZAR §3.3 types, plus 4 quiet scenes. They cover 2W and 4W, day, dusk, dawn, rain and overcast, and J&K hills and towns, Kerala towns, rural roads and highway, metro roads and small-town markets. Each scene has a calm lead-in of at least 10 s, and its hazard begins in a named extension shot. The schema and coverage checks are in `packages/content` (`NazarScenesFile`, `src/nazar.ts`). |
| Prompt and guardrails | `ai/prompts/clip_generator.md` (PRM-CLIPGEN 1.0.0) is mirrored in `packages/clip-pipeline/src/generation.ts`, with a drift test between the two. |
| `clip.json` | Adds `origin: "filmed" \| "ai_generated"` (default `filmed`) and a `generation` record: `{model, sceneId, promptVersion, seedOrBatchId?, generatedAt (month), durationMs, extensions, synthId: true, disclosure: "ai_generated"}`. `speedSource` gains `scene_spec`. |
| Review gate | AI clips skip `blurred` and `audited`. A curator `syntheticReview` replaces the blur audit: `{reviewer, checkedAt, noRealPersonLikeness, noReadablePlates, noRealBrands, noCollisionOrInjury, hazardVisible}`, all literal `true`. It is required to publish. |
| Workflow | `clip_generate` (`services/workflows/src/tasks/clip-generate.ts`) runs: generate (opening plus extensions, 720p 16:9) → precheck (ffmpeg normalise, strip metadata, 480p check, WCAG flash check) → Go `clip.register_generated` → the existing `clip_ingest` subtasks from transcode, with `render` replacing blur → `open_review`. It is idempotent per `sceneId:version:batchId`. |
| Labels | Every surface shows an "AI-generated scene" chip on AI clips: the player, between-clip card, replay, results, screen-reader page and share card. The brief says "Practice on AI-generated road scenes in Kerala's announced format." |

### Validity limits (binding on every claim)
- **Results describe performance on our AI-generated scenes.** They say nothing directly about performance on real roads or in Kerala's test. Any field-study or slide claim must say "on AI-generated road scenes".
- AI scenes may differ from real traffic in cue salience, motion physics, crowd density and visual clutter. Hazard-perception validity evidence (Horswill et al.; NAZAR §0) was gathered on filmed clips and does not carry over automatically.
- The pre-registration (`HYPOTHESES.md`, MD-241, a human task) must state that the clips are AI-generated **before any taker data**. The study's honesty footnote changes from "our clips" to "our AI-generated scenes". FIELD_STUDY.md carries the dated note.
- Difficulty (curator and empirical) is calibrated on these scenes only.

### SynthID and labelling obligations
- **SynthID.** Google embeds an invisible SynthID watermark in every generated video. We never try to remove or defeat it. Our transcode re-encodes the pixels (CRF 28 at 360p and 480p). Google describes SynthID as robust to common transformations, but we have not verified that it is still detectable after our encode [unverified: owner Nazar owner; check with Google's SynthID detector on one delivered rendition].
- **Container metadata is stripped** by our privacy rule (`buildMezzanineArgv` and `buildStripMetadataArgv`, NAZAR §3.1). Any provenance tags the generator writes into the container are therefore lost. That is why disclosure travels in our own data: `clip.json` `origin` and `generation.disclosure`, the bank manifest (origin, generation, review), the client manifest (`origin: "ai_generated"`), and the UI chip.
- **Labels.** Every learner-facing surface that shows an AI clip shows "AI-generated scene" (en and hi; Hindi pending native review). Copy never says "real Indian roads", "Kerala's clips" or "official". The copy lint enforces the last.
- **Generated audio** is described in the prompt as ambient traffic only, with no speech, so that no speech is ever generated. The delivery pipeline then strips every audio track anyway (no-audio design).

### Guardrails (in every prompt; PRM-CLIPGEN 1.0.0)
No collision, contact, fall, injury, blood or crash aftermath. No real brands, logos or liveries, and no readable signs. Plates blank or unreadable. No recognisable real people. No text overlays. A calm, legal camera speed with no speeding, stunts or risky overtaking. Ambient traffic audio only, with no speech or music. The hazard shows its cue first, develops, and then resolves safely. Scene text is also linted (`SCENE_TEXT_BANS` in `packages/content`) for harm, speed, brand, readable-text, plate, speech and "official" words. The curator's `syntheticReview` checks the output against the same list.

### Two human raters still set every window
Generation gives raters an **approximate onset hint** (`approximateOnsetHint`: the start of the hazard extension, measured from the real turn lengths, ± 3 s, `authoritative: false`). It is sent only to the Go register step for the raters' first look. It is never stored in `clip.json`, never sent to learners and never used as a window. Agreement (Δonset ≤ 0.5 s, Δend ≤ 1.0 s), adjudication, frame-snapped final windows, game-core scoring and the score verifier are unchanged. `transition()` refuses `rated` and `published` without two agreeing raters or an adjudication, for every origin.

### Consequences
- **Good:**
  - A bank in hours.
  - No bystanders, no raw-footage retention and no plate model needed for the hackathon build.
  - The filmed path stays intact for Phase 3+ (`origin: filmed`, same pipeline).
- **Bad / cost:**
  - Weaker ecological validity, and every claim must say so.
  - Generation cost, estimated below.
  - A model can render a guardrail violation, so the curator review is mandatory and some scenes will need regenerating.
  - Model availability risk: a preview model was shut down two days before this decision.
- **Follow-ups:**
  1. Go agent: the `clip.register_generated` step, the API op that starts `clip_generate`, accepting `syntheticReview` at publish, branching `clip.blur_audit_check` on origin, and refreshing `services/api/internal/clips/clip.schema.json` (byte copy with a drift test). Today.
  2. Curator UI agent: a "Generate clip" form and the synthetic review (no blur audit for AI clips). Today.
  3. Nazar owner: check that SynthID survives our transcode before generating the bank. The smoke run (2026-10-24) already confirmed that extension outputs contain the whole video so far; rerun `services/workflows/test/gemini-smoke.manual.ts` if the model changes.
  4. Field-study lead: state "AI-generated clips" in `HYPOTHESES.md` (MD-241) before any data.
  5. Nazar owner: confirm that CC-BY 4.0 can be applied to Gemini outputs under the Gemini API terms [unverified]. Before publishing the bank manifest openly.

### Cost and time of a 20-clip bank (estimate)
- **Price:** the Gemini pricing page (updated 2026-10-22) lists Gemini Omni Flash 720p video output at $17.50 per 1M output tokens. That is about **$0.10 per generated second** (5,792 tokens/s). There is no free tier, and no 360p, batch or flex price is listed.
- **Per clip:** a 30–40 s clip is 4–5 turns. If each turn bills only its new seconds, that is about $3–4 per clip. If each turn's output (the whole video so far) is billed in full, it is about $8–12 per clip.
- **20 clips:**
  - $60–80 if each turn bills only its new seconds; $160–240 if each turn bills the whole video so far.
  - With an assumed 50% regeneration rate for review failures, about **$90–360**.
- **Smoke run (2026-10-24, real API, SCN-101, two turns):**
  - Turn 1 returned an 8 s video in 59 s.
  - Turn 2 returned the **whole 16 s video** in 115 s.
  - Each extension output is therefore cumulative, so the expensive case above (each turn billed for the whole video so far) is the likely one. On that basis a 32 s, four-turn clip bills about 80 s, roughly $8.
  - The output was 1280×720 H.264 at 24 fps with an AAC audio track and an `encoder=Google` tag. Our normalise and strip steps removed both the audio and the tag.
  - The real 360p and 480p renditions passed `checkDeliveryRendition` and the flash check.
  - The 16 s 360p file was 1.26 MB. That is about 2.4 MB per 30 s, slightly over NAZAR §3.1's 2 MB target, because generated video is highly detailed.
- **Time:**
  - Rate limits are not published per model (see AI Studio). The docs say latency "varies with duration, resolution and load".
  - Measured turn latency grew with the video length: 59 s, then 115 s. A four-turn clip is therefore likely 6–10 minutes.
  - A 20-clip bank is about **2–3.5 hours** sequentially, longer with regenerations. Curator review and two raters per clip come on top.

## Pros and cons of the options
### A. Film and blur
- Good, because it gives real-road validity and was the original plan.
- Bad, because there is no time, the plate model is still open, it brings road risk and bystander privacy work, and the 100% audit is labour-heavy.
### B. Third-party footage
- Good, because it is real footage.
- Bad, because licences compatible with CC-BY and with our privacy standard are rare, it would still need blur and audit, and the timeline is unknown.
### C. AI-generated
- Good, because it is fast, has no bystanders, and the scenes can be specified for every hazard type and context.
- Bad, because of the validity limits, the cost per second, model availability, and possible guardrail slips (mitigated by the review).

## Validation
- clip-pipeline tests cover the origin rules, the per-origin status machine, the publish gate, the projections and the prompt drift test.
- packages/content tests cover the schema, coverage and text bans.
- services/workflows tests run `clip_generate` against a fake SDK. They cover chaining, guardrails, the onset hint, idempotency, retries, the checkpoint resume and the safety block.
- Web unit tests cover the chip, the brief line and the share label.
- Review date: before the field study opens. Reassess if Omni Flash changes or a filmed bank becomes feasible.

## Links
- Gemini Omni docs: https://ai.google.dev/gemini-api/docs/omni (read 2026-10-24)
- Pricing: https://ai.google.dev/gemini-api/docs/pricing (updated 2026-10-22)
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits (per-model figures in AI Studio)
