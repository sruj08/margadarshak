# AI Models (M-01..M-09)
> Project: Margdarshak · Owner: AI lead (team Chanakya) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) §10 · [AGENTS](AGENTS.md) · [VOICE](VOICE.md) · [PROMPTS](PROMPTS.md) · [AI_EVALS](AI_EVALS.md) · [RESPONSIBLE_AI](RESPONSIBLE_AI.md) · [DATA_PIPELINE](DATA_PIPELINE.md) · [ARCHITECTURE](../03-engineering/ARCHITECTURE.md) · [COST](../05-ops/COST.md)
> Sources: `research/ps1-deep/04-ai-adk-gemini.md` (cited "04"), `research/ps1-deep/08-game-ai-n8n.md` (cited "08"), `war-room/margdarshak-verification.md` (cited "D-xx"). Facts from 04 are **not re-researched here**; this file must not contradict them.

---

## 0. Summary

**Rule zero (D-09, D-10).**
- Code computes every number, eligibility result, fee, date and score.
- A model may *choose an ID* from a closed list that we pass in for that request. It may never *write* a rule, a fee, a date or a score.
- "Unknown" is always a valid model answer.

**Where the models sit.**
- Five models are runtime Gemini calls behind Google ADK 2.12 (Python): M-01..M-05 and M-07.
- One is an offline authoring model: M-06.
- One is a third-party Indian speech model: M-08.
- One group runs on the device and never sends data out: M-09.

| ID | Agent | Model (env var → default) | Where it runs | Phase-1/2 status | Under-18? |
|---|---|---|---|---|---|
| M-01 | VoiceGuideAgent | `MD_MODEL_VOICE_LIVE` → `gemini-3.8-live`; fallback `MD_MODEL_VOICE_LIVE_FALLBACK` → `gemini-2.5-flash-native-audio-preview-12-2025` | Cloud (Gemini Live via ADK `run_live`) | **Build (thin, bounded):** Hindi + English, 8 destinations, 10 fields (04 §3.1) | **No** |
| M-02 | DebriefAgent | `MD_MODEL_DEBRIEF` → `gemini-3.1-flash-lite` | Cloud (one LLM node in the ADK graph) | **Build:** deep slice B | **No** (template card instead) |
| M-03 | CoachAgent | `MD_MODEL_COACH` → `gemini-3.1-flash-lite` | Cloud, weekly coach-plan TimelineEvent inside the `case_clock_sweep` Workflows run | Build (thin) | **No** (template plan) |
| M-04 | TutorAgent | `MD_MODEL_TUTOR` → `gemini-3.1-flash-lite` | Cloud | Build (thin; explanations reviewed offline, see §M-04) | **No** (static reviewed explanation) |
| M-05 | ScreenDecoderAgent | `MD_MODEL_VISION` → `gemini-3.6-flash` | Cloud (vision) | Build: status-screenshot path. Paper slip is **thin/stretch** (04 §3.6) | **No** (manual stage dropdown) |
| M-06 | ClipWindowProposer | `MD_MODEL_VIDEO` → `gemini-3.8-flash` | Cloud, **offline**, inside the Render Workflows clip pipeline | **Build first** (04 §4 order 2; D-15 headline Workflow) | n/a (never user-facing) |
| M-07 | SignSnap | `MD_MODEL_VISION` → `gemini-3.6-flash` | Cloud (vision) | Could (F-27) | **No** (sign catalogue browse) |
| M-08 | Sarvam Saaras v3 (STT) + Bulbul v3 `hi-IN` (TTS) | `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL` (exact strings **[unverified]**, owner AI lead, check at H0) | Cloud (Sarvam API) | Stretch: Dogri cascade (+4 h, 04 §3.1) | **No** |
| M-09 | On-device: MediaPipe Face Landmarker (Helmet Fit); YuNet face detector + plate detector (clip blur) | n/a (bundled model files, hash-pinned) | Device (browser) for Helmet Fit; pipeline worker for blur | Build: Helmet Fit framing; blur in clip pipeline | Helmet Fit yes (no data leaves the device, no telemetry for u18); blur n/a |

**Why env vars and not hard-coded IDs.**
- Gemini model naming is moving fast. On 2026-10-22 the models page already marks `gemini-3.1-flash-live-preview` as legacy and recommends `gemini-3.8-live`.
- ADK's own Live model page lists only `gemini-2.5-flash-native-audio-preview-12-2025` and `gemini-3.1-flash-live-preview` (04 §0.4).
- So every model ID is read from the environment at start-up. It is logged (as an ID, never with prompt text) on every trace span, and pinned at H0 after a smoke test.

---

## 1. Shared configuration

### 1.1 Environment variables (all go into `.env.example`)

| Variable | Default (H0 pin) | Used by | Note |
|---|---|---|---|
| `MD_MODEL_VOICE_LIVE` | `gemini-3.8-live` | M-01 | ADK 2.12 support is **unknown** (04 §6 Q1). The H0 smoke test decides; on failure, flip to the fallback |
| `MD_MODEL_VOICE_LIVE_FALLBACK` | `gemini-2.5-flash-native-audio-preview-12-2025` | M-01 | The ADK-documented default (04 §0.4) |
| `MD_MODEL_TEXT_LITE` | `gemini-3.1-flash-lite` | M-02/03/04, router, scam explainer, commentary classifier | The cheapest current non-legacy model (04 §1.7) |
| `MD_MODEL_DEBRIEF` / `MD_MODEL_COACH` / `MD_MODEL_TUTOR` | `${MD_MODEL_TEXT_LITE}` | per agent | Per-agent override for A/B tests via ADK agent routing (experimental, 04 §1.2) |
| `MD_MODEL_VISION` | `gemini-3.6-flash` | M-05, M-07 | Multimodal |
| `MD_MODEL_VIDEO` | `gemini-3.8-flash` | M-06 | Offline authoring |
| `MD_GEMINI_TIER` | `paid` | all | The start-up check **refuses to boot** with `APP_ENV in {staging, prod, field}` unless the value is `paid` (D-13, 04 §0.2) |
| `MD_GEMINI_SAFETY_THRESHOLD` | `BLOCK_MEDIUM_AND_ABOVE` | all | Set explicitly, because the default is OFF on Gemini 2.5+ (04 §1.8) |
| `MD_VOICE_MONTHLY_CAP_MIN` | `10` | M-01 | Free-plan cap per user (04 §5) |
| `MD_DEBRIEF_TIMEOUT_MS` | `6000` | M-02 | After this the template card stays (08 §5.6) |
| `MD_AI_CIRCUIT_FALLBACK_RATE` | `0.20` | M-02/03/04 | Opens the breaker over a 5-min window → n8n W12 alert (08 §5.6) |
| `SARVAM_API_KEY`, `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL` | (secret), `[unverified]`, `[unverified]` | M-08 | Disclosed processor (D §3.3) |
| `GOOGLE_API_KEY` / `GOOGLE_GENAI_USE_VERTEXAI` | (secret) / `false` (hackathon), `true` (production) | all | Production → Vertex AI, India region (`HUNCH:` asia-south1, **[unverified]**, owner AI lead, re-check before adoption, D §3.1 G4) |

### 1.2 Generation settings (code defaults; overridable per prompt version in [PROMPTS](PROMPTS.md))

| Setting | M-02/03/04 | M-05/07 | M-06 | M-01 |
|---|---|---|---|---|
| Structured output | Yes (`response_schema` from Pydantic) | Yes | Yes | No (Live outputs audio only; tools carry the structure, 04 §1.5) |
| Temperature | 0.3 (glue text only) | 0.0 | 0.2 | provider default |
| Safety | `BLOCK_MEDIUM_AND_ABOVE` on harassment, hate_speech, sexually_explicit, dangerous_content, jailbreak (04 §1.8) | same | same | same |
| Tools | **None** for M-02/M-03 (facts are injected through state; this avoids the reported `output_schema` + tools conflict, 08 §5.2). M-04: none | None | None | `navigate`, `set_field`, `read_back`, `confirm`, `get_rule`, `read_debrief`, `open_drill`, `lookup_screen` |
| Grounding with Google Search | **Off, everywhere.** It would bring back the same YouTube and blog misinformation users complain about (04 §0.5) | Off | Off | Off |

**Structured output caveats (04 §1.3).**
- Gemini honours `enum`, `required`, `minimum`/`maximum`, `anyOf` and `$ref`.
- It **silently ignores `minLength`, `maxLength` and `uniqueItems`**, so our validator checks them in code.
- Combining structured output with function calling is preview and Gemini 3 only. We never combine them.

### 1.3 Prices used in this bible

All prices are Standard tier, per 1M tokens, from the [pricing page, updated 2026-10-22](https://ai.google.dev/gemini-api/docs/pricing), via 04 §1.7. INR uses an **assumed** ₹88/$ (04).

| Model | Input | Output | Other | Change ahead |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | audio in $0.50 | None stated in 04. **Re-check Flash-Lite pricing on 2027-01-01** (08 §5.8). Owner: AI lead |
| `gemini-3.6-flash` / `gemini-3.8-flash` | $0.75 | $3.75 | n/a | **Doubles to $1.50 / $7.50 on 1 Jan 2027** (04 §1.7). This lands mid-pilot, so every Flash cost below has a "from 1 Jan 2027" column |
| `gemini-3.8-live` | audio $0.005/min | audio $0.018/min | n/a | ≈ $0.023/min ≈ ₹2/min |
| Sarvam Saaras v3 | ~₹30/hr | n/a | n/a | Aggregator figure, **[unverified]** (04 §5). Owner: AI lead, check the Sarvam pricing page at H0 |
| Sarvam Bulbul v3 | n/a | ₹30 per 10k characters | free trial | 04 §1.9 |
| Search grounding | n/a | n/a | 5,000 free/month, then $14/1k | **Not used** |

### 1.4 Data handling (applies to every cloud model)

1. **Paid tier for every real person.**
   - On the free tier, "human reviewers may read, annotate, and process your API input and output". Paid Services don't use prompts for product improvement ([Gemini API terms](https://ai.google.dev/gemini-api/terms), 04 §0.2).
   - The free tier is used only in `APP_ENV=dev`, and only with synthetic data.
   - Billing is switched on before the journey test (n = 5–8) and the Nazar study (n = 40–80).
2. **18+ only.** The terms say "You must be 18 years of age or older to use the APIs", and they bar clients "likely to be accessed by" under-18s (04 §0.1).
   - Every model call passes the server-side `AgeGate` (see [AGENTS §7](AGENTS.md#7-under-18-gating)).
   - The open legal question ("is the whole app *likely accessed* by minors?") is logged as R-13. Owner: Product lead + counsel, before public launch.
3. **No PII to any model, by construction.**
   - **Never sent, on any path:** Aadhaar number, OTP, captcha, passwords, face images (for any purpose), phone, email, LL/DL/application numbers, location.
   - **Never sent on the M-02/03/04/05/07 paths:** name, DOB, address, RTO code. Inputs there are typed Pydantic models with `extra="forbid"`, so a PII field cannot be added by accident (08 §5.10).
   - **The one exception is voice field-fill (M-01/M-08).** When an adult *chooses* to dictate their own name or address into Margdarshak's form, that speech reaches Gemini Live (or Saaras) on the paid tier, for that request only. Conditions:
     - a separate "voice fill" consent;
     - the value is never written to logs or traces (redacted at the span exporter);
     - the user confirms it on screen.
   - Every voice and decoder input passes through `pii_gate` and the ADK PII Redaction plugin (EC-20).
4. **Images.**
   - Downscaled on the client to ≤ 1024 px, about 1k tokens each (04 §1.8).
   - The name region on status screenshots is blurred on the device before upload (04 §3.6).
   - Aadhaar never goes to any model (04 §3.3).
5. **Retention.**
   - We keep the audio and images we send to Gemini only for the request; we store nothing (04 §2).
   - Voice transcripts live only in the ADK session and can be switched off by the user.
   - Debrief prompts are not kept beyond 7 days [D] (08 §5.3).
   - See [DATA_PIPELINE §6](DATA_PIPELINE.md#6-retention).
6. **Processors disclosed in the privacy notice:**
   - Google (Gemini API; Vertex AI in production);
   - Sarvam AI (Dogri speech in, Hindi speech out).

   Model providers are listed in the privacy centre (F-54) by purpose.
7. **Hosting.**
   - Hackathon: Render Singapore. There is no India region, and the README says so (D §3.1 G4).
   - Production: Vertex AI in an Indian region plus a MeitY-empanelled cloud or NIC, with Bhashini as the government-preferred speech path (D-17).

### 1.5 Indian-language coverage at a glance

| Language | Speech in | Speech out | Screen text | Notes |
|---|---|---|---|---|
| Hindi (`hi`) | Gemini Live native audio | Gemini Live native audio; Bulbul `hi-IN` for verbatim reads | Full (F-50) | Listed in the Live guide's 99 languages ([Live guide, 2026-09-18](https://ai.google.dev/gemini-api/docs/live-guide)) |
| English (`en`) | Gemini Live | Gemini Live | Full | — |
| Hinglish (code-mixed) | Gemini Live (auto language switching); Saaras supports code-mixing | Gemini Live | `hinglish` locale for the debrief | Native audio models switch language automatically and take no language code, so we restrict languages through the system instruction (04 §1.5) |
| Dogri (`doi`) | **Sarvam Saaras v3 `doi-IN`** | **No Dogri TTS anywhere** (Bulbul has 11 languages, none Dogri) → Hindi voice out | IndicTrans2 draft, **reviewed by a native speaker** | Gemini Live does **not** list Dogri (04 §0.3) |
| Kashmiri (`ks`) | Saaras v3 `ks-IN` (not shipped; roadmap) | none | roadmap | We don't claim it (D-21) |
| Urdu, Punjabi | Gemini Live lists them | Gemini Live | not shipped | 04 §1.9 says Live handles them end to end, but we **claim only English, Hindi and Dogri voice-in** (D-21) |

---

## 2. Model cards

Each card covers task, model, why chosen, alternatives, inputs/outputs, latency and cost, context, fallback, device vs cloud, Indic performance, intended use and limitations.

### M-01 VoiceGuideAgent (F-30, API-40)

| Field | Value |
|---|---|
| Task | Turn a spoken request (Hindi, English or Hinglish; Dogri via M-08) into one of a **closed set of actions** inside Margdarshak: open a screen, fill a non-sensitive field after confirmation, read a rule card, read a debrief. Never submits, pays or books on Sarathi |
| Model | `gemini-3.8-live` (stable on the Gemini models page, 2026-10-22). Fallback: `gemini-2.5-flash-native-audio-preview-12-2025` (the ADK default; also GA on Vertex as `gemini-live-2.5-flash-native-audio`). `gemini-3.8-live-extended-thinking` is **not** used: latency matters more than reasoning for navigation |
| Why | Mapping messy Hinglish speech to one of ~25 destinations and extracting slot values is real speech understanding. A synonym search covers maybe 60% of literate users; voice covers people who can't or won't type (04 §3.1) |
| Alternatives considered | (a) Saaras STT → Flash-Lite text agent → Bulbul TTS for **all** languages: higher latency and no native barge-in, but cheaper; it is our Dogri path and the emergency fallback. (b) Gemini Nano on device: flagship phones only and Indian-language support not stated, so it can be an optional speed-up, never a dependency (04 §1.8). (c) Plain search box with synonyms: **kept** as the text fallback |
| Inputs | 16-bit PCM, 16 kHz mono audio from the browser over our WebSocket (API-40). Optional text. Session state: `user:case_view` (stage, classes, field completion flags; never values of PII fields) |
| Outputs | 24 kHz audio. Input and output transcriptions (text), used for the on-screen captions and the eval. Tool calls (see [AGENTS §3.1](AGENTS.md#31-voiceguideagent-m-01)) |
| Latency target | Voice round-trip (end of user speech → first audio byte) **p50 < 1.5 s** (04 §3.1 target). p90 is measured, target < 2.5 s [D]. Gemini publishes **no latency figures**, so we measure on Jio and Airtel 4G at H0+6 (04 §6 Q2) |
| Cost | ≈ $0.023/min ≈ **₹2/min**. Capped at 10 min/user/month on the free plan, so ≤ ₹20/user/month (04 §5) |
| Context and session limits | 128k tokens for native audio models. Sessions: **15 min audio-only**, 2 min audio+video, ~10 min connection lifetime. Context-window compression and session resumption extend them (04 §1.5) |
| Fallback chain | `gemini-3.8-live` → `gemini-2.5-flash-native-audio-preview-12-2025` → text mode (the same tools over `gemini-3.1-flash-lite`) → plain search box (EC-29) |
| Device vs cloud | Cloud. The browser connects to **our** FastAPI WebSocket, never to Google directly, so no API key or ephemeral token reaches the client. If a client-direct mode is ever added, it must use ephemeral tokens (04 §1.5) |
| Indic performance | Hindi/English: no vendor benchmark. We measure **intent accuracy** on `voice_nav_30` (+ the 60-utterance recorded set) and **Hindi fluency ≥ 4/5** with a native rater ([AI_EVALS](AI_EVALS.md)). Dogri: not supported by Live; via M-08 |
| Intended use | Adults (18+) navigating Margdarshak's own screens, filling non-sensitive fields, hearing rule cards with their source |
| Out of scope / limitations | Not a chatbot for legal advice. It can't book, pay or submit anywhere. It won't fill Aadhaar, OTP, mobile-OTP, captcha or password fields (they are absent from the enum). Live 3.1 has no proactivity or affective dialogue, and its function calling is synchronous (04 §1.5). Barge-in discards pending function calls, so tools are idempotent |

### M-02 DebriefAgent (F-25, API-36)

| Field | Value |
|---|---|
| Task | After a scored game session, write the four-part Debrief Card (how you did · where you lacked · what you could have done · next drill) from **deterministic** findings. It orders findings, picks `rule_id` and `drill_id` from per-request allowlists, and writes short glue text with **no digits** (08 §5) |
| Model | `gemini-3.1-flash-lite` |
| Why | Templates can state findings, but they read robotic when 2–3 findings combine across games and languages. The model adds prioritised, connected, warm Hinglish. It adds **no facts**. This is a deliberately THIN AI feature (08 §5.1) |
| Alternatives | (a) Templates only: this is the fallback and the under-18 path ("Auto notes"). (b) `gemini-3.6-flash`: 3× the price for no measurable gain on 2.4k-token glue text; re-evaluate only if Hindi fluency is < 4/5 on Flash-Lite |
| Inputs | `DebriefFacts` (Pydantic, `extra="forbid"`): the top-3 findings with `facts`, `allowed_rule_ids`, `drill_candidates`, `locale`, and `prev_finding_ids` (last 3). **Never** raw video, camera frames, audio, name, DOB, phone, RTO or case-file data (08 §5.1) |
| Outputs | `DebriefDraft` JSON ([PROMPTS §3.1](PROMPTS.md#31-debriefdraft-m-02)). Rendered by code: `{{fact:key}}` placeholders are filled per locale ("≈ 16 m" / "लगभग 16 मीटर"), and the rule text plus source link come from `rules.json` |
| Tokens and cost | ≈ 2.4k in + 350 out ≈ $0.0011; with 5% retries ≈ **$0.0012 ≈ ₹0.10 per debrief**. About 30 sessions/user/month ≈ **₹3/user/month** (08 §5.8). Unaffected by the Flash price change as far as 04 says |
| Latency target | Server-side **p50 < 2.0 s, p90 < 4.0 s** [D] (08 §5.8). Hard timeout 6 s → the template stays. The UI shows the template card instantly and swaps in the coach card, so the user never waits |
| Fallback | One retry with the validator error list → template card. The circuit breaker opens at a fallback rate > 20% over 5 min (EC-29) |
| Indic performance | Locales `en`, `hi`, `hinglish`. Gates: Hindi fluency ≥ 4.0/5 (native rater), Devanagari ≥ 70% of letters for `hi` [D] |
| Intended use | Narrating code-computed results to adults who consented to "AI coach" |
| Limitations | Can't compute, can't cite `verified:false` rules, can't mention numbers except through placeholders. The Golden Hour game (G9) is **template-only** (safety-critical first-aid content, D-14 row 12): DebriefAgent is never called for `golden_hour` sessions |

### M-03 CoachAgent (F-26, weekly TimelineEvent)

| Field | Value |
|---|---|
| Task | Wording for the weekly plan. The plan itself (FSRS-due cards, staircase levels, session goal) is computed in code. The agent writes one motivating line and an implementation-intention prompt ("On __ at __ I will…") (08 §5.2) |
| Model | `gemini-3.1-flash-lite` |
| Inputs | `CoachPlan` JSON: `week_goal_sessions`, `due_topics[]` (IDs), `fading_nodes[]`, `streak_state` (enum), `locale`, `allowed_drill_ids` |
| Outputs | `CoachDraft` ([PROMPTS §3.2](PROMPTS.md#32-coachdraft-m-03)): `headline`, `plan_items[]` (drill IDs in order), `intention_prompt`, all digit-free |
| Cost | ≈ 2k in + 300 out ≈ $0.001/run. 4 runs/month ≈ **₹0.5/user/month** (08 §5.8) |
| Latency | Batch (weekly, inside the `case_clock_sweep` Workflows run); p90 < 6 s per user is fine [D]. Batched per sweep page, never one n8n execution per user |
| Fallback | Template plan ("This week: 4 short sessions. Start with {{topic}}") |
| Limitations | No guilt, no streak shaming, no "your friend beat you" (08 §4.10). Quiet hours 22:00–07:00 IST [D]. Max 1 nudge/day |

### M-04 TutorAgent (F-31, API-41)

**Reconciling 04 and the brief.**
- 04 §3.5 **rejects** a runtime tutor that "explains rules", because that is exactly where a made-up rule slips in.
- PROJECT_BRIEF M-04 and D-09(c) allow "explain *your* wrong answers from reviewed text".
- **Resolution:**
  - Explanations are drafted offline (by `gemini-3.8-flash`), then human-reviewed against the source rule, then shipped as static JSON. This is the 04 rule.
  - At runtime, M-04 only **selects** the reviewed explanation ID(s) for this question and writes a one- or two-line *bridge*. The bridge contrasts the option the user picked with the correct one, using only the reviewed text and the option texts.
  - It cannot add a fact. When the reviewed bank has no explanation, the answer is `UNKNOWN` and the card shows "We'll add an explanation for this one" plus the rule card.

| Field | Value |
|---|---|
| Task | "Why was my answer wrong?" for LL simulator (G10) and Learn hub (F-20) questions |
| Model | `gemini-3.1-flash-lite` (runtime bridge); `gemini-3.8-flash` (offline drafting, reviewed) |
| Inputs | `TutorRequest`: `question_id`, `variant_id`, question text and options (from the bank), `chosen_option_id`, `correct_option_id`, `reviewed_explanations[]` (IDs and text), `allowed_rule_ids`, `locale`, `confidence` (50/75/100) |
| Outputs | `TutorDraft` ([PROMPTS §3.3](PROMPTS.md#33-tutordraft-m-04)): `explanation_id` (enum), `bridge_text` (≤ 200 chars, no digits), `rule_id` (enum or UNKNOWN), `calibration_note` (enum: `none`, `sure_and_wrong`, `unsure_and_right`) |
| Cost | ≈ 1.5k in + 150 out ≈ $0.0006 ≈ **₹0.05/call** |
| Latency | p50 < 1.5 s, p90 < 3.0 s [D]. The static explanation renders immediately and the bridge appears when ready |
| Fallback | Static reviewed explanation only |
| Grounding check | Content-overlap check: every noun phrase in `bridge_text` must appear in the question, the options or the reviewed explanation (a lemma match, Hindi and English) [D]. Otherwise it is dropped |
| Limitations | Never invents a question. Never generalises "in your state…" (state formats come from config). Never says "the RTO will ask this" (04 §3.8 format honesty) |

### M-05 ScreenDecoderAgent (F-32, API-42)

| Field | Value |
|---|---|
| Task | Sarathi **status screenshot** (and later a paper result slip) → `doc_kind`, `stage`, per-class results, dates and a verbatim `remark_raw`. Then code maps them to the **verified error/stage catalogue** and works out the next step (`timeline()` + `next_steps(stage, days)`) (04 §3.6) |
| Model | `gemini-3.6-flash` (vision) |
| Why | Screenshots arrive in any form (cropped, Hindi UI, WhatsApp-compressed); the stage names and result codes are a closed set worth decoding. A plain dropdown remains the fallback |
| Inputs | One image ≤ 1024 px (about 1k tokens: 258 tokens per 768² tile), name region blurred on the device; `catalogue_candidates` (IDs + canonical strings, prefiltered by keyword); `locale` |
| Outputs | `DecoderDraft` ([PROMPTS §3.4](PROMPTS.md#34-decoderdraft-m-05)) with `catalogue_id ∈ enum ∪ {UNKNOWN}` and `confidence` 0–1 |
| Cost | ≈ 3.5k in + 200 out ≈ $0.0034 ≈ **₹0.30/call**; **≈ ₹0.60 from 1 Jan 2027** |
| Latency | p50 < 4 s, p90 < 8 s [D] (upload included, on 4G) |
| Thresholds | Confidence < 0.7 or `UNKNOWN` → "Not in our list" + "type the stage name instead" (dropdown) + grievance link (04 §3.2). Extracted values are **always shown for the user to confirm** before any timeline change |
| Limitations | OCR quality on Indian government slips and Devanagari names is **unknown until tested** (04 §1.8, §6 Q3: run 10 samples at H0). Paper slips: **zero samples**, so they stay THIN. The model never explains *why* someone failed; it shows `remark_raw` verbatim |

### M-06 ClipWindowProposer (F-23 pipeline; Render Workflow `clip_ingest`)

| Field | Value |
|---|---|
| Task | Offline. Watch a blurred dashcam clip and propose candidate hazard windows `[start, end, hazard_type, why]` for **two human raters**. Never user-facing; **never auto-publishes** (04 §3.4) |
| Model | `gemini-3.8-flash` (video), File API upload |
| Settings | `fps: 2` (4 on short clips), `media_resolution: low`, `start_offset`/`end_offset` chunks of 5 min, `MM:SS` timestamps (04 §3.4; [video understanding, 2026-10-13](https://ai.google.dev/gemini-api/docs/video-understanding)) |
| Cost | About 100 tokens/s at low resolution, so a 10-min clip ≈ 60k tokens ≈ **$0.05 ≈ ₹4.4** (04 §3.4). At `fps: 2` the token count is likely to rise **[unverified]**, so we budget **₹9 per 10 min** now and **₹18 from 1 Jan 2027** |
| Precision | 1 fps sampling gives ±1 s; at 2–4 fps, ±0.25–1 s. Sub-second precision is **unknown**, so proposals are proposals only. Humans set exact frames |
| Eval | On 3 hand-labelled clips: recall of human-marked hazards **≥ 80%**, plus median onset error in seconds (04 §3.4). See [DATA_PIPELINE §2](DATA_PIPELINE.md#2-clip-pipeline-headline-render-workflow) |
| Limitations | Hallucinated hazards are rejected by raters. It only sees blurred media, because faces and plates are blurred **before** upload |

### M-07 SignSnap (F-27)

| Field | Value |
|---|---|
| Task | The user points the camera at a road sign. Return `sign_id ∈ sign_catalogue ∪ {UNKNOWN}` and a confidence; code shows the catalogue meaning and adds the card to the FSRS deck |
| Model | `gemini-3.6-flash` (vision) |
| Inputs | One image ≤ 1024 px. The client crops to the tapped region. No faces or plates are expected; the PII blur runs anyway |
| Outputs | `SignDraft` ([PROMPTS §3.6](PROMPTS.md#36-signdraft-m-07)): `sign_id`, `confidence`, `bbox` (`[ymin,xmin,ymax,xmax]` normalised 0–1000, 04 §1.8), `visibility_issue` (enum) |
| Cost | ≈ 2k in + 100 out ≈ $0.0019 ≈ **₹0.17/call; ≈ ₹0.34 from 1 Jan 2027** |
| Latency | p50 < 3 s [D] |
| Confirm against catalogue | The meaning text is **never** model text. Confidence < 0.75 → show the top-3 catalogue candidates as pictures: "Which one is it?" |
| Safety | **Riding lock:** if the device is moving faster than about 10 km/h, the camera does not open ("Pull over to use Margdarshak", MV Act s.184, D-14 row 11) |
| Limitations | Faded, partly hidden or non-standard local signs → UNKNOWN. This is a learning feature, not a navigation aid |

### M-08 Sarvam Saaras v3 (STT) + Bulbul v3 (TTS)

| Field | Value |
|---|---|
| Task | Dogri speech → text (and Kashmiri on the roadmap) for the voice cascade, and the commentary record-then-score path for Dogri speakers. Bulbul `hi-IN` speaks the Hindi reply |
| Coverage | Saaras v3: 22 languages incl. `doi-IN`, `ks-IN`; code-mixing; streaming WebSocket; median latency "< 250 ms" (vendor claim). v4 has also been on the Realtime API since Sep 2026 ([STT](https://www.sarvam.ai/apis/speech-to-text.md), [changelog](https://docs.sarvam.ai/changelog.md)). Bulbul v3: 11 languages, **no Dogri or Kashmiri** ([TTS](https://www.sarvam.ai/apis/text-to-speech.md)) |
| Guardrail | "Output reviewed text only": the Saaras transcript is shown on screen, editable, before it drives any `set_field`. It passes `pii_gate` like any text |
| Alternatives | AI4Bharat IndicConformer (claims "all 22", but one CIIL list omits Dogri: **verify on the model card**); Bhashini (Dogri and Kashmiri speech coverage **unknown**; production preference for government hosting, D-17) |
| Cost | Saaras ~₹30/hr **[unverified]**; Bulbul ₹30 per 10k characters (a 400-character reply ≈ ₹1.2) |
| Eval | 10 team recordings at H0 (04 §6 Q4); 10 Dogri utterances in the 60-utterance voice set; a native Dogri speaker on the team reviews all Dogri UI text |
| Limitations | "Nobody's automated Dogri is trustworthy for legal text" (04 §1.9). Dogri screen text is IndicTrans2-drafted and native-reviewed; rule text in Dogri is shown only after review, otherwise Hindi |

### M-09 On-device vision (Helmet Fit, clip blur)

| Component | Task | Where | Privacy | Eval |
|---|---|---|---|---|
| **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`, version pinned at H0) | Helmet Fit (G8): check that the face is centred and the chin and jaw are visible, so the user frames the strap area. Strap fastening is a **guided self-check**; no stock model detects "strap fastened" (08 G8) | Browser, on device | **No frame ever leaves the device**; no face image ever goes to Gemini. Telemetry carries booleans only; under-18 users get no telemetry | 30 consented team captures × lighting conditions: framing-detection agreement with a human ≥ 90% [D] |
| Optional helmet classifier (MediaPipe Model Maker, ~500 consented team photos) | "Helmet on / strap visible" | Device | Same | Accuracy **unknown** until trained, so advisory only (stretch) |
| **YuNet** face detector + a licence-plate detector (model and licence chosen at H0; **[unverified]** which plate model, owner: pipeline lead) | Blur faces and plates in Nazar clips before any upload to M-06 or publication | Render Workflows worker (`blur` step) | Raw clips are deleted after the blur audit (see DATA_PIPELINE) | **100% human blur audit before publish** (PROJECT_BRIEF M-09); miss rate on the audited frames reported per clip |

---

## 3. Cost roll-up per active adult user per month

Paid tier, today's prices, ₹88/$ assumed. Detail is in [COST](../05-ops/COST.md).

| Item | Basis | Now | From 1 Jan 2027 |
|---|---|---|---|
| Debriefs (M-02) | 30 × ₹0.10 | ₹3.0 | ₹3.0 (Flash-Lite; re-check) |
| Coach (M-03) | 4 runs | ₹0.5 | ₹0.5 |
| Tutor (M-04) | 20 × ₹0.05 | ₹1.0 | ₹1.0 |
| Decoder (M-05) | 2 × ₹0.30 | ₹0.6 | ₹1.2 |
| Sign Snap (M-07) | 5 × ₹0.17 | ₹0.9 | ₹1.7 |
| Voice (M-01) | 10-min cap × ₹2 | ≤ ₹20 | ≤ ₹20 |
| **Total (heavy voice user)** | | **≈ ₹26** | **≈ ₹27** |
| Total (no voice) | | ≈ ₹6 | ≈ ₹7.4 |
| Clip bank (M-06), one-off | 120 clips × 1 min ≈ 12 × 10-min-equivalents × ₹9 | ≈ ₹110 for the whole bank | ≈ ₹220 |

**Voice dominates.** Hence the 10-min cap, the text-first default and voice kept off the critical demo path (D §4 risk 5).

---

## 4. Hackathon build (Phase 1–2) vs production (Phase 3+)

| Topic | Hackathon (Phase 1–2) | Production (Phase 3+) |
|---|---|---|
| Provider | Gemini Developer API, **paid tier** before any real user | Vertex AI, Indian region (`HUNCH:` asia-south1 **[unverified]**), enterprise terms after legal review (D §3.1 G8) |
| Voice | Hindi + English on Live; Dogri cascade is a stretch | Bhashini as the government-preferred speech path where coverage is proven; Saaras as a processor under contract |
| Model pinning | Env vars, H0 smoke test | The model change process: shadow traffic → eval gate → canary 5% → full ([AI_EVALS §6](AI_EVALS.md#6-ci-gating-and-regression)) |
| Hosting of the ADK runtime | In-process in the FastAPI service on Render Singapore | Container on a MeitY-empanelled cloud / NIC; Cloud Run asia-south1 as the GCP option |
| Monitoring | Sentry + OTel spans with model ID, latency, token counts, validator verdict | Plus a quarterly fairness audit, drift dashboards and an AI incident log feeding the CERT-In runbook |

## 5. Open items (owner, due)

| # | Item | Owner | Due |
|---|---|---|---|
| 1 | Does ADK 2.12 `run_live` accept `gemini-3.8-live`? | AI lead | H0 + 2 h |
| 2 | Live round-trip p50/p90 on Jio/Airtel 4G, mid-range Android Chrome | AI lead + QA | H0 + 6 h |
| 3 | Gemini OCR on 10 Sarathi screenshots, incl. Devanagari | AI lead | H0 + 6 h |
| 4 | Saaras `doi-IN` on 10 team Dogri recordings; exact model strings; price | AI lead + Dogri reviewer | H0 + 6 h |
| 5 | Legal reading of "likely to be accessed by" under-18s | Product lead + counsel | Before public launch |
| 6 | Flash-Lite pricing on 2027-01-01 | AI lead | 2027-01-02 |
| 7 | Plate-detector model choice and licence | Pipeline lead | H0 + 4 h |
| 8 | Token count of video at `fps: 2` (measure on one clip) | Pipeline lead | H0 + 4 h |
