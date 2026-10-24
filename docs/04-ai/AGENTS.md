# AI Agents (ADK for Go)
> Project: Margdarshak · Owner: AI lead (team Chanakya) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [MODELS](MODELS.md) · [VOICE](VOICE.md) · [PROMPTS](PROMPTS.md) · [AI_EVALS](AI_EVALS.md) · [RESPONSIBLE_AI](RESPONSIBLE_AI.md) · [DATA_PIPELINE](DATA_PIPELINE.md) · [ARCHITECTURE](../03-engineering/ARCHITECTURE.md) · [API_SPEC](../03-engineering/API_SPEC.md) · [SECURITY](../06-security-compliance/SECURITY_ARCHITECTURE.md)
> Sources: 04 = `research/ps1-deep/04-ai-adk-gemini.md`; 08 = `research/ps1-deep/08-game-ai-n8n.md`; D-xx = council directives.

**API shapes (ADK for Go, `google.golang.org/adk` v1.9.0, checked in the module source on 2026-10-23; ADR-0011).**
- Agents: `llmagent.New(llmagent.Config{Name, Model, Instruction, Tools, OutputSchema, OutputKey, GenerateContentConfig, BeforeModelCallbacks, AfterModelCallbacks, BeforeToolCallbacks, AfterToolCallbacks})`; models from `gemini.NewModel(ctx, modelName, &genai.ClientConfig{...})`; workflow agents `sequentialagent`, `parallelagent`, `loopagent`.
- Tools: `functiontool.New[TArgs, TResults](functiontool.Config{Name, Description}, func(agent.ToolContext, TArgs) (TResults, error))`; state through `ToolContext.State()`.
- Running: `runner.New(runner.Config{AppName, Agent, SessionService, PluginConfig})`; `(*runner.Runner).Run(ctx, userID, sessionID, msg, agent.RunConfig{})` returns `iter.Seq2[*session.Event, error]`; `(*runner.Runner).RunLive(ctx, userID, sessionID, agent.LiveRunConfig{...})` returns an `agent.LiveSession` (`Send(agent.LiveRequest)`, `Close()`) plus the event stream.
- Plugins: `plugin.New(plugin.Config{Name, OnUserMessageCallback, BeforeRunCallback, AfterRunCallback, BeforeModelCallback, AfterModelCallback, BeforeToolCallback, AfterToolCallback, OnModelErrorCallback})`.
- Sessions: `session.InMemoryService()`; the state prefixes (`user:`, `app:`, `temp:`) behave as in the other ADK SDKs.
- **There is no graph-workflow API and no `adk eval` CLI in ADK for Go.** Each "graph" below is plain Go code: deterministic steps around one `Runner.Run` call of an `llmagent` (or a `sequentialagent`). Evals are Go tests ([AI_EVALS §4](AI_EVALS.md)). Agent code lives in `services/api/internal/adapters/ai/{voiceguide,debrief,coach,tutor,decoder,clipproposer,signsnap,scam,commentary}`, plugins in `internal/adapters/ai/plugins/{pii,provenance}`.

---

## 1. Design stance

1. **ADK is used for its deterministic nodes, not for autonomy.**
   - "Deterministic graph nodes are the main reason to use ADK here" (04 §1.2). In Go these are ordinary functions, so the determinism is plain code.
   - In every pipeline, the rules engine, fee calculator, scorers and validators are plain Go steps, and the LLM is one `Runner.Run` call.
2. **One backend, small agents.** Every agent runs in-process inside `services/api` (Go 1.27, `google.golang.org/adk` v1.9.0, `google.golang.org/genai` v1.76.0) (04 §2; D-17, ADR-0011).
3. **Closed outputs.** Every agent that "states a fact" returns an ID from an enum built **for that request**. User-facing fact text comes from `rules.json`, `error_catalogue.json`, `sign_catalogue.json` or the reviewed question bank, never from model prose (04 §2 guardrail 1).
4. **Number provenance.**
   - Any ₹ amount, day count, age, distance, time or percentage in model text must appear in that turn's tool results or injected facts. Otherwise the message is replaced by the rule card or template (04 §2 guardrail 2).
   - Debrief, coach and tutor go further: **no digits at all** outside `{{fact:key}}` placeholders (08 §5.5).
5. **Unknown is a first-class answer.** Every enum includes `UNKNOWN`, and the UI then says who decides (04 §2 guardrail 3).
6. **No ADK memory service.**
   - The case file is structured state in our Postgres database, exposed read-only to agents as `user:` state.
   - No free-text memory means the model cannot "remember" a wrong fee (04 §1.4).
7. **AI for everyone (D-13 revised).** A consent gate runs before any runner is invoked (§7). It checks the feature consent of the adult account holder (the parent's, for a family member's case). There is no age gate on AI.

---

## 2. Runtime layout

```mermaid
flowchart TB
  subgraph Client["PWA (Next.js 16)"]
    MIC[Mic + VAD meter] -->|PCM 16 kHz over WS| WS
    UI[Screens] -->|REST| REST
  end
  subgraph API["services/api: Go 1.27 + ADK for Go v1.9 (one container)"]
    WS["API-40 /v1/voice (WebSocket)"]
    REST["API-36 debrief · API-41 tutor · API-42 decode · API-43 scam"]
    AG[ConsentGate · adult account holder / family mode]
    WS --> AG
    REST --> AG
    AG --> RUN[ADK Runner + Plugins]
    RUN --> VG[VoiceGuideAgent M-01]
    RUN --> DG[Debrief pipeline M-02]
    RUN --> CG[Coach pipeline M-03]
    RUN --> TG[Tutor pipeline M-04]
    RUN --> SD[ScreenDecoder pipeline M-05]
    RUN --> SS[SignSnap pipeline M-07]
    RUN --> SC[Scam pipeline: rules verdict + Flash-Lite explainer]
    RE[(RulesEngine: rules.json, fees.json, timeline, class_for, blockers)]
    CAT[(Catalogues: error, stage, sign, question bank, screens, fields, drills)]
    VG & DG & CG & TG & SD & SS & SC -.read.-> RE
    VG & DG & CG & TG & SD & SS & SC -.read.-> CAT
    SESS[(session.InMemoryService · case state from Postgres 16)]
    RUN --- SESS
  end
  subgraph Jobs["Render Workflows (TypeScript tasks, @renderinc/sdk)"]
    CLIP[clip_ingest: transcode → blur → M-06 propose → two raters → agreement → publish]
    FAN[debrief_fanout]
  end
  N8N[n8n Pro: schedules + messaging edge only] -->|HMAC POST| REST
  N8N -->|run-task API| Jobs
  RUN -->|Gemini API, paid tier| GEM[(Gemini)]
  VG -->|Dogri cascade| SAR[(Sarvam Saaras / Bulbul)]
  CLIP --> GEM
```

### 2.1 Runner-level plugins

Order matters: they wrap every agent.

| # | Plugin | Kind | Hook(s) | What it does | Fires on |
|---|---|---|---|---|---|
| P1 | `ConsentPlugin` | ours | before run | Re-checks the feature consent (`ai_coach`, `voice`, `voice_fill`, `decoder`, `sign_snap`) for the case: the holder's own, or the parent's artefact (`acting_for` = parent) for a family member's case. Belt and braces behind the HTTP consent gate. It does not block on age (D-13 revised) | all |
| P2 | **ADK PII Redaction plugin** | ADK (04 §1.8, adk.dev/safety) | before model | Redacts PII patterns in text parts | all text paths |
| P3 | `PiiGatePlugin` | ours | before model; on Live input transcription | Regex + **Verhoeff** check for 12-digit Aadhaar (spaced or not); 4–8-digit OTP-like tokens when an OTP context word is near (`OTP`, `ओटीपी`, `code`, `password`); 10-digit Indian mobile; PAN `[A-Z]{5}[0-9]{4}[A-Z]`; DL-number pattern `[A-Z]{2}[ -]?\d{2}[ /-]?\d{4,11}`; application numbers of 10/15/16/20 digits (01-sarathi §G lengths). Hit → **drop the span**, set `temp:pii_hit = <kind>` and inject the canned reply `PII_REFUSAL` (EC-20) | M-01, M-05 (OCR text), scam paste |
| P4 | `JailbreakJudgePlugin` | ours (04: "Gemini as judge" Flash-Lite screen) | before model, **only on untrusted user free text** (scam paste, commentary transcript, voice transcript) | One Flash-Lite classification `{injection: bool, category: enum}`; true → strip and answer from the template | M-01, scam, commentary |
| P5 | `ProvenancePlugin` | ours | after model (`AfterModelCallback`) | Extracts numbers (Latin and Devanagari digits, number words in en/hi such as "पचास" and "fifty", ₹, "days", "दिन", "km/h", "%", "साल"). Each must be ∈ `temp:tool_numbers` (filled by `after_tool_callback` and the injected facts). Fail → replace with the rule card / template and log `provenance_block` | M-01, M-05, scam |
| P6 | `SchemaValidatorPlugin` | ours | after model, for structured agents | Strict JSON decode into the Go draft struct (`json.Decoder.DisallowUnknownFields`), enum membership, lengths (Gemini ignores `maxLength`, 04 §1.3), no-digit rule, placeholder existence, tone lint, script ratio; one retry with the error list, then template | M-02/03/04/05/07 |
| P7 | `AuditPlugin` | ours | after run | Writes an `AuditLog` (E-30) row with agent, prompt version, model ID, latency, token counts, validator verdict, fallback reason and IDs chosen. **Never prompt or response text** | all |
| P8 | `CostGuardPlugin` | ours | before model | Per-user monthly caps (voice minutes, vision calls); over cap → text fallback / dropdown | M-01, M-05, M-07 |

**Gemini safety settings.**
- Set explicitly on every model config: `BLOCK_MEDIUM_AND_ABOVE` on harassment, hate_speech, sexually_explicit, dangerous_content and jailbreak.
- The default is OFF for 2.5+ (04 §1.8).
- A blocked call returns HTTP 400 with code `safety` or `jailbreak`. We map it to `fallback_reason = "provider_safety"` and use the template.

### 2.2 Agent-level callbacks used across agents

| Callback | Used by | Purpose |
|---|---|---|
| `BeforeToolCallbacks` | M-01 | Deterministic validators: PIN code (6 digits, valid for the state), DOB band, RTO code ∈ `rto.json`, class ∈ `class_for(vehicle)`, `screen_id`/`field_id` ∈ allowlists. Reject → an error message back to the model (04 §3.1) |
| `AfterToolCallbacks` | M-01 | Appends every number in a tool result to `temp:tool_numbers` for P5 |
| `BeforeModelCallbacks` | all | Injects `{locale}`, trims history to the last 6 turns in text mode, adds `prompt_version` to the span |
| `AfterModelCallbacks` | all | P5/P6 (implemented as plugins so they apply uniformly) |

---

## 3. Agents

Common fields for every agent: purpose · instruction summary (full text in `ai/prompts/`) · tools with signatures · state · callbacks · pipeline · failure modes · eval.

### 3.1 VoiceGuideAgent (M-01)

**Purpose.**
- Voice navigation and field-fill inside Margdarshak for every user, including a learner under 18 in family mode (F-30).
- Read rule cards and the rendered debrief aloud.
- It never submits, pays or books on Sarathi: there is no integration, and saying so is part of the honesty pitch (04 §3.1).

**Instruction summary** (`ai/prompts/voice_guide_agent.md`, `PRM-VOICE` v1.0.0):
- calm, short sentences in the user's language (Hindi, English, Hinglish; others are refused politely);
- confirm before any big jump ("I'm opening *Slot booking guide*, right?");
- fill only fields in the enum, read back in both scripts, wait for a tap or "haan";
- answer rule questions only via `get_rule` and say the source;
- if asked to pay, submit, book, or give Aadhaar/OTP, decline with the canned line and offer the hand-off screen.

**Type.** An `llmagent` run under `Runner.RunLive()`; the API-40 WebSocket handler forwards client audio with `LiveSession.Send(agent.LiveRequest{RealtimeInput: &genai.Blob{...}})` (bidi, so interruption works, 04 §1.5). Text mode uses the same agent under `Runner.Run` with `GEMINI_MODEL_TEXT_LITE`.

**Tools (function tools; all idempotent because barge-in discards pending calls):**

```go
// internal/adapters/ai/voiceguide/tools.go (signatures; bodies omitted)
package voiceguide

import (
	"google.golang.org/adk/agent"
	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/functiontool"
)

// ScreenID: 30 destinations; catalogue in VOICE.md §4.1. Generated as a JSON-schema enum.
type ScreenID string // SCR_HOME, SCR_PLAN, SCR_PLAN_RESULT, SCR_CLASS_PLANNER, SCR_BLOCKERS,
// SCR_LL_APPLY, SCR_PHOTO_FIXER, SCR_CHECK_ANSWERS, SCR_HANDOFF_SARATHI, SCR_TRACKER,
// SCR_CASE_CLOCK, SCR_LEARN_HUB, SCR_LL_SIMULATOR, SCR_READINESS, SCR_NAZAR,
// SCR_GAMES, SCR_SLOT_FINDER, SCR_RTO_INTEL, SCR_TRACK_EXPLAINER, SCR_TEST_DAY,
// SCR_FAIL_RECOVER, SCR_APPROVAL_TRACKER, SCR_NEW_RIDER, SCR_RENEW_FIX, SCR_FAMILY_HELPER,
// SCR_PRIVACY, SCR_SCAM_CHECK, SCR_DECODER, SCR_PRACTICE_RECORD, SCR_LANGUAGE

// FieldID: 18 non-sensitive fields; NO Aadhaar, OTP, mobile, captcha, password, application/LL/DL numbers.
type FieldID string // FLD_FULL_NAME_LATIN, FLD_FULL_NAME_DEVANAGARI, FLD_RELATION_TYPE, FLD_RELATION_NAME,
// FLD_DOB, FLD_GENDER, FLD_ADDR_LINE, FLD_ADDR_DISTRICT, FLD_ADDR_PIN, FLD_STATE,
// FLD_RTO_CODE, FLD_VEHICLE_KIND, FLD_CLASSES, FLD_HAS_LL, FLD_LL_ISSUE_DATE,
// FLD_AADHAAR_ADDR_MATCHES, FLD_TEST_DATE, FLD_LANGUAGE

type NavigateArgs struct {
	ScreenID ScreenID `json:"screen_id"`
}
type NavigateResult struct {
	OK           bool     `json:"ok"`
	ScreenID     ScreenID `json:"screen_id"`
	TitleEN      string   `json:"title_en"`
	TitleHI      string   `json:"title_hi"`
	NeedsConfirm bool     `json:"needs_confirm"` // large jumps need confirm()
}

type SetFieldArgs struct {
	FieldID FieldID `json:"field_id"`
	Value   string  `json:"value"`
}
type SetFieldResult struct { // value staged in temp:pending_fields (NOT saved); validators run in BeforeToolCallbacks
	OK                bool    `json:"ok"`
	FieldID           FieldID `json:"field_id"`
	DisplayLatin      string  `json:"display_latin"`
	DisplayDevanagari string  `json:"display_devanagari"`
	ErrorCode         string  `json:"error_code,omitempty"`
}

type ConfirmArgs struct {
	FieldIDs []FieldID `json:"field_ids"`
}
type ConfirmResult struct {
	OK    bool      `json:"ok"`
	Saved []FieldID `json:"saved"`
}

type GetRuleArgs struct {
	RuleID string `json:"rule_id"` // must be in temp:allowed_rule_ids (built from the current screen + case)
}
type GetRuleResult struct { // verified:false rules return Error = "NOT_CITABLE"
	RuleID     string `json:"rule_id"`
	TextEN     string `json:"text_en"`
	TextHI     string `json:"text_hi"`
	Value      *int64 `json:"value,omitempty"`
	SourceURL  string `json:"source_url"`
	VerifiedOn string `json:"verified_on"`
	Verified   bool   `json:"verified"`
	Error      string `json:"error,omitempty"`
}

type LookupScreenArgs struct{ Query string `json:"query"` }
type LookupScreenResult struct {
	Top []struct {
		ScreenID ScreenID `json:"screen_id"`
		Score    float64  `json:"score"`
	} `json:"top"` // top-3; deterministic keyword/synonym search (hi/en/hinglish/doi)
}

type ReadDebriefArgs struct{ SessionID string `json:"session_id"` }
type OpenDrillArgs struct{ DrillID string `json:"drill_id"` } // must be in the last debrief's drill_candidates

// Handlers all have the functiontool shape func(agent.ToolContext, Args) (Result, error).
func navigate(tc agent.ToolContext, a NavigateArgs) (NavigateResult, error)        // open one screen
func setField(tc agent.ToolContext, a SetFieldArgs) (SetFieldResult, error)        // stage a value
func readBack(tc agent.ToolContext, _ struct{}) (PendingFields, error)              // all pending fields, both scripts
func confirm(tc agent.ToolContext, a ConfirmArgs) (ConfirmResult, error)           // needs a UI tap or an affirmative within 10 s of read_back; saves via the CaseService (same path as API-12)
func getRule(tc agent.ToolContext, a GetRuleArgs) (GetRuleResult, error)
func lookupScreen(tc agent.ToolContext, a LookupScreenArgs) (LookupScreenResult, error)
func readDebrief(tc agent.ToolContext, a ReadDebriefArgs) (RenderedDebrief, error) // the RENDERED card text (08 §5.2), read verbatim
func openDrill(tc agent.ToolContext, a OpenDrillArgs) (NavigateResult, error)

// Tools registers them, e.g. functiontool.New(functiontool.Config{Name: "navigate", Description: "..."}, navigate).
func Tools() ([]tool.Tool, error)
```

**State.**

| Key | Scope | Content |
|---|---|---|
| `user:case_view` | user | `{stage: S0..S9, state_code, classes[], field_status{field_id: empty/filled}, age_band}`. **No field values** for name/DOB/address; the agent never needs them |
| `temp:pending_fields` | invocation | Staged values awaiting confirmation |
| `temp:allowed_rule_ids` | invocation | Built by code from the current screen and case |
| `temp:tool_numbers` | invocation | For P5 |
| `temp:pii_hit` | invocation | Set by P3 |
| `current_screen`, `last_debrief_id`, `turns_misunderstood` | session | UI sync and fallback logic |

**Callbacks.** `BeforeToolCallbacks` = validators (§2.2); `AfterToolCallbacks` = number capture; Plugins P1–P8.

**Pipeline** (text and Dogri mode, plain Go steps in `voiceguide.TextTurn`; Live mode runs the same `llmagent` with the same tools under `Runner.RunLive`):

```
// Go steps (no graph API in ADK for Go)
voiceTextTurn:
  [code] pii_gate            → if hit: emit PII_REFUSAL, end
  [code] synonym_router      → lookup_screen(query); if top score ≥ 0.85 and no slot values → navigate (no LLM)
  [LLM]  voice_guide_agent   → tools above
  [code] provenance_check    → P5
  [code] render_caption      → bilingual caption; Dogri screen text via IndicTrans2 (reviewed strings only)
```

**Live mode specifics.** Detail in [VOICE.md](VOICE.md).
- Barge-in: generation is cancelled, **pending function calls are discarded** and the server sends `interrupted`. On `interrupted`, re-read `temp:pending_fields` and `current_screen` before continuing.
- Session limits: 15 min audio-only; connection lifetime ~10 min. We enable context-window compression and **session resumption** and rotate the connection at 9 min [D] with a resumption handle (04 §1.5).
- VAD: automatic; `silenceDurationMs` 700 by default [D] (recommended 500–800 ms), raised to 800 in noisy mode; `prefixPaddingMs` 300 [D].
- Languages restricted through the system instruction, because native audio models take no language code (04 §1.5).

**Failure modes → guardrails.**

| Failure | Guardrail |
|---|---|
| Wrong destination | `needs_confirm` for any jump that leaves the current stage; spoken and visual confirm |
| Bad transliteration poisons the printout | Both scripts are shown and a tap is required (04 §3.1) |
| User speaks Aadhaar/OTP | P3 drops it: "Don't tell me this; type it only on parivahan.gov.in" (EC-20) |
| "Book my slot" / "pay for me" / "submit it" | Canned `CANNOT_ACT_ON_SARATHI` line + `navigate("SCR_HANDOFF_SARATHI")` or `SCR_SLOT_FINDER` |
| Invented fee or date in speech | P5 on the output transcription; mismatch → the on-screen rule card is authoritative, the event is logged, and the UI highlights the card |
| Live down / cap reached | Text mode → search box (EC-29) |

**Eval:** `ai/evals/voice_nav_30.jsonl` plus the 60-utterance recorded set (04 §3.1): `tool_trajectory_avg_score = 1.0` on `navigate`; slot exact-match ≥ 90% after confirmation; 100% refusal on banned intents.

---

### 3.2 DebriefAgent (M-02)

**Purpose.** Narrate the deterministic `SessionResult` as a four-part card (F-25).

**Instruction summary** (`ai/prompts/debrief_agent.md`, `PRM-DEBRIEF` v1.0.0):
- choose `finding_id`s from `{facts}`; the top-severity finding must appear;
- choose `rule_id`s only from `{allowed_rule_ids}` or `UNKNOWN`, and the drill from `{drill_candidates}`;
- **no digits**; use `{{fact:key}}` placeholders;
- warm, private, never shaming, no gore or death counts, no speed praise;
- the locale is `{locale}`.

**Tools: none.** All facts are injected through state, which avoids the reported `OutputSchema` + tools conflict (08 §5.2; re-check on ADK for Go v1.9).

**Pipeline** (plain Go in `internal/adapters/ai/debrief`: deterministic steps around one `Runner.Run` call, 08 §5.3):

```mermaid
flowchart LR
  A["[code] load_and_gate<br/>server-rescored SessionResult · consent ai_coach (parent's for a minor)? · game != golden_hour"] -->|no| T["[code] template_card"]
  A -->|yes| B["[code] build_facts<br/>top-3 findings · allowed_rule_ids = ∪ruleIds ∩ verified · drill_candidates top-3 · prev_finding_ids"]
  B --> C["[LLM] debrief_agent<br/>OutputSchema=DebriefDraft · OutputKey=temp:draft"]
  C --> V{"[code] validate<br/>(PROMPTS §5)"}
  V -->|ok| R["[code] render<br/>fill placeholders per locale · rule text + source · escape HTML"]
  V -->|fail once| C
  V -->|fail twice| T
  R --> P["[code] persist + emit debrief_ready"]
  T --> P
```

**State.**
- `facts`, `allowed_rule_ids`, `drill_candidates`, `locale`, `prev_finding_ids` (session).
- `temp:draft` (model output).
- `user:skill_summary` (node states from our DB, never free text).

**Commentary mode** (record, then score: D-12, F-25).
- An optional pre-node, `commentary_score`. The user records speech over a clip (online, consent `commentary`; the parent's consent for a family member's case).
- The audio is transcribed by `gemini-3.1-flash-lite` (audio in $0.50/1M), or by Saaras for Dogri.
- The transcript goes through P3 and P4 (untrusted).
- Then `[LLM] classify_mentions`, with structured output `[{hazard_type: enum, t_ms_approx}]`.
- Then `[code]` matching against the curator's hazard list → findings (`NAZ_COMMENTARY_MISSED`, `NAZ_COMMENTARY_LATE`, `NAZ_COMMENTARY_EARLY_GOOD`).
- The transcript is discarded after scoring; only the matched enum list is kept.

**Failure modes.**
- Digits or invented facts → validator → retry → template.
- A missing top finding → fail.
- Injection inside facts (e.g. a facts key named like an instruction) → keys are validated against the `FactKey` registry before the prompt is built; unknown keys are dropped and logged.

**Fan-out.** `debrief_fanout` (Render Workflows TypeScript task) calls the Go API's debrief step once per scenario in parallel (`Promise.all` over `ctx.run`) for multi-game sessions, retries on Gemini 429 with exponential backoff, assembles, and pushes the card via n8n (D §2.1, "build, don't headline").

**Eval.** `ai/evals/debrief_150.jsonl` (150 cases, 15 adversarial). Gates in [AI_EVALS §3](AI_EVALS.md).

---

### 3.3 CoachAgent (M-03)

**Purpose.** Weekly plan wording (F-26; n8n W6 Monday 07:00 → `POST /jobs/coach`).

**Pipeline:** `[code] plan_week` (FSRS due cards + staircase + goal) → `[code] gate` (consent, the parent's for a family member's case; opted into the channel; quiet hours) → `[LLM] coach_agent` (`CoachDraft`) → `[code] validate` (no digits, drill IDs ∈ allowed, banned nagging phrases) → `[code] render` → `[code] enqueue` (n8n sends).

**Tools:** none. **State:** `plan` (session), `temp:draft`.

**Instruction summary.**
- One headline.
- Plan items in the given order: the agent may reorder only within the same priority tier.
- One implementation-intention prompt.
- No guilt, no streak loss language, no comparison with friends.

**Eval:** 30 cases (`ai/evals/coach_30.jsonl`, built from the debrief generator's skill summaries). Gates: schema 100%, banned-phrase 0, Hindi fluency ≥ 4/5.

---

### 3.4 TutorAgent (M-04)

**Purpose.** Explain *your* wrong answer from reviewed text (F-31, API-41). See [MODELS §M-04](MODELS.md#m-04-tutoragent-f-31-api-41) for the 04-vs-brief reconciliation.

**Pipeline** (Go steps).

```
// Go steps
[code] load_item        → question, variant, options, correct, chosen, reviewed_explanations (status=approved only)
[code] gate             → consent; if no approved explanation → return UNKNOWN card (no LLM)
[LLM]  tutor_agent      → TutorDraft (explanation_id enum, bridge_text, rule_id enum, calibration_note enum)
[code] validate         → enums, no digits, ≤200 chars, grounding-overlap check, banned phrases
[code] render           → reviewed explanation text (static) + bridge + rule card with source
```

**Tools:** none. **State:** `item` (session), `temp:draft`.

**Instruction summary.** Use only the provided explanation and option texts. Contrast the chosen option with the correct one in one or two sentences. If the user was 100% sure and wrong, add the `sure_and_wrong` note (calibration, 08 §4.5). Never add a new rule or number.

**Eval:** `ai/evals/tutor_30.jsonl`.

---

### 3.5 ScreenDecoderAgent (M-05)

**Purpose.** Sarathi status screenshot → stage and next step (F-32, API-42).

**Pipeline.**

```mermaid
flowchart LR
  U[client: downscale ≤1024 px, blur name region, user confirms crop] --> G["[code] gate + PII OCR pre-scan<br/>(ML Kit text recognition on device; Aadhaar-pattern boxes blurred)"]
  G --> K["[code] catalogue_prefilter<br/>keyword match on on-device OCR → ≤12 candidates + UNKNOWN"]
  K --> L["[LLM] screen_decoder_agent<br/>DecoderDraft (doc_kind, catalogue_id, stage, classes[], dates[], remark_raw, confidence)"]
  L --> V{"[code] validate<br/>enums · dates parse · remark_raw is a substring of OCR text (fuzzy ≥0.9)"}
  V -->|conf ≥ 0.7| N["[code] next_steps(stage, days_elapsed)<br/>timeline() · retest gap · LL-expiry collision · escalation letter offer"]
  V -->|conf < 0.7 or UNKNOWN| D[dropdown: 'type the stage name instead' + grievance link]
  N --> C[UI: 'Did your screen say THIS?' side by side → user confirms → API-15 event]
```

**Tools:** none (the candidates are injected). **State:** `candidates`, `temp:draft`. Next steps are **code**: e.g. the 7-day retest gap and 6-month LL validity come from `rules.json` with source and `verified_on`.

**Privacy.**
- The app number may be extracted (it is the user's own data), but it stays in `user:case` and is **not logged** (04 §3.6).
- P3 redacts it from the span.

**Eval:** `ai/evals/decoder_30.jsonl` (+ the 40-string error set in 04 §3.2).

---

### 3.6 ClipWindowProposer (M-06): offline

**Purpose.** Propose hazard windows for the human raters (F-23). It is **not** an interactive agent.
- It is an `llmagent` invoked once per 5-min chunk by the Go API step `POST /internal/job-steps/clip.propose_windows` (proposed), which the TypeScript `clip_ingest` Render Workflows task calls over the private network with HMAC. Keeping the agent in Go keeps one AI codebase and the PII/provenance plugins in one place.
- A `loopagent` over chunks is optional (04 §3.4).

**Inputs:** File-API handle of the **blurred** clip; `start_offset`/`end_offset`; `fps: 2`; `media_resolution: low`.
**Output:** `ClipProposal` ([PROMPTS §3.5](PROMPTS.md#35-clipproposal-m-06)).
**Tools:** none.

**Post-node.** `[code] sanity`:
- windows inside the clip;
- `end > start`;
- length 1–10 s [D];
- `hazard_type ∈ enum`;
- de-duplicate overlaps with IoU > 0.6.

Then the clip goes to the rater queue (n8n W8). Detail in [DATA_PIPELINE §2](DATA_PIPELINE.md).

---

### 3.7 SignSnap (M-07)

**Pipeline:** `[code] gate + riding lock` → `[code] crop/downscale` → `[LLM] sign_snap` (`SignDraft`) → `[code] validate` (`sign_id ∈ catalogue ∪ UNKNOWN`) → confidence ≥ 0.75 → catalogue card + "add to deck" (FSRS); otherwise a top-3 picture chooser.

**Tools:** none. **Eval:** 30 photos across lighting, angle, occlusion and region (in `ai/evals/README.md` as `signsnap_30`, collected at H0; not yet in the repo).

---

### 3.8 Scam explainer (F-33; no M-ID in PROJECT_BRIEF, see Inconsistencies)

**Pipeline:** `[code] extract` (URLs, phones, UPI IDs, APK mentions, ₹ amounts) → `[code] verdict` (domain allowlist: `parivahan.gov.in` + subdomains, `*.gov.in`, `*.nic.in`, `digilocker.gov.in`; any `.apk` = never install; UPI-request rule; quoted fee vs `fees.json`) → `[LLM] scam_explainer` (`gemini-3.1-flash-lite`; may only **add** `red_flags: enum[]`) → `[code] render` (from flag templates).

- The verdict labels are **"On a government domain list"** / **"Not on our list: do not trust"** / **"Can't verify"**.
- The model can never produce a verdict, and the word "safe" is never shown (D-19).
- P4 always runs, because pasted messages may contain injection (04 §3.7).
- Eval: 50 messages (25 scam, 25 genuine Sarathi SMS); zero "on list" verdicts on scams (04 §3.7).

---

## 4. Pipelines: the code + LLM pattern in one table

| Pipeline | Code steps (deterministic Go) | LLM calls | Human steps |
|---|---|---|---|
| Voice (text/Dogri) | pii_gate, synonym_router, validators, provenance, caption | voice_guide_agent | User confirm tap |
| Debrief | load_and_gate, build_facts, validate, render, persist | debrief_agent (+ classify_mentions in commentary mode) | none at runtime; weekly human sample review (AI_EVALS §7) |
| Coach | plan_week, gate, validate, render, enqueue | coach_agent | none |
| Tutor | load_item, gate, validate (grounding), render | tutor_agent | Offline: explanation review (two-person) |
| Decoder | gate, prefilter, validate, next_steps | screen_decoder_agent | User confirms extracted values |
| Sign Snap | gate, riding lock, crop, validate | sign_snap | User picks from top-3 when unsure |
| Scam | extract, verdict, render | scam_explainer (flags only) | none |
| Clip ingest (Render Workflows, TypeScript task) | transcode, blur, flash check (TS); sanity, agreement, publish (Go API steps) | clip_window_proposer | **Blur audit, rater 1, rater 2, adjudicator** |

Human-in-the-loop waits: long waits (hours to days) are held by **Render Workflows + n8n W8**, not by an open ADK invocation (ADK for Go has `toolconfirmation` for short in-run confirmations only).

---

## 5. Session and memory policy

| Item | Policy |
|---|---|
| Session service | `session.InMemoryService()` per process (ADK for Go also ships `session/database`, GORM-based, and `session/vertexai`; we do not add GORM next to pgx). Sessions are short-lived, so nothing durable lives in ADK sessions: the case file is in our Postgres tables, and voice resumption uses the Live API resumption handle |
| Session lifetime | Voice: the session ends on socket close or 15 min idle; the row is deleted after 24 h [D]. Debrief/tutor/decoder: one invocation per session; deleted after 24 h [D] |
| Transcripts | Kept only inside the session for captions and resumption. The user can switch the transcript off (the UI shows captions live but they are not persisted). Never exported to logs or analytics |
| `user:` state | A **read-only projection** of the case (`case_view`) and `skill_summary`, rebuilt from Postgres on each invocation. Agents never write `user:` state directly; writes go through API-12 after `confirm()` |
| `app:` state | Catalogue versions and prompt registry hashes (read-only) |
| `temp:` state | Pending fields, allowlists, tool numbers, drafts; gone after the invocation |
| Memory services | **None.** No `load_memory`/`preload_memory`, no Memory Bank, no RAG memory (04 §1.4 decision) |
| Deletion | `DELETE /v1/me` (API-62) and `DELETE /v1/cases/{id}` (API-17) close any open ADK sessions and cascade to stored debriefs (EC-26) |
| Debrief storage | `Debrief` (E-19) stores finding IDs, chosen rule/drill IDs, rendered text, validator verdict and prompt version. The prompt input is kept ≤ 7 days for debugging [D], then dropped |

---

## 6. Deployment

### 6.1 Hackathon (Phase 1–2)

- The ADK `runner.Runner` is created once per process at start-up in `cmd/api` (composition root), one per agent.
- It runs **in-process in `services/api`** on Render (Singapore region, synthetic data only; Render has no India region, D §3.1 G4).
- One Go process (goroutines per request; no worker processes). The WebSocket for API-40 is served by the same chi router (gorilla/websocket). The instance is kept warm before judging (D §4 risk 5).
- The ADK for Go web launcher (`google.golang.org/adk/cmd/launcher`, dev UI) runs **only locally**, to show judges the trace ("not meant for use in production", 04 §1.6). The demo shows a recorded trace of the provenance guard firing.
- The ClipWindowProposer runs in the Go API behind the job-step endpoint that the TypeScript Render Workflows task `clip_ingest` calls (`propose_windows` step).

### 6.2 Cloud Run alternative

- 04 §1.6 picks **Cloud Run, one API container** (REST + WebSocket; here the Go API image); Agent Runtime is needed only for Memory Bank, which we don't use.
- The same Docker image deploys to Cloud Run (asia-south1) with `--timeout=3600` for WebSockets and min-instances 1 [D].
- Use it when Render WebSocket behaviour or latency to Gemini is worse in the H0 measurement.
- Free-tier limits for Cloud Run and Agent Runtime: **not checked** (04 §6 Q6). Owner: infra lead.

### 6.3 Production (Phase 3+)

- A container on a MeitY-empanelled cloud or NIC.
- `genai.ClientConfig{Backend: genai.BackendVertexAI, Project, Location}` (env `GOOGLE_GENAI_USE_VERTEXAI=true`), with Vertex AI in an Indian region (**[unverified]** region; owner AI lead).
- Bhashini adapter (F-56 `BhashiniAdapter`) as the speech option where coverage is proven.
- The `ports.JobRunner` interface replaces Render Workflows with the Temporal Go SDK runner (D-17).

---

## 7. Family mode and consent gate (D-13 revised)

```mermaid
flowchart TD
  R[Any AI request: API-36/40/41/42/43, Sign Snap] --> A{whose case?}
  A -->|adult account holder's own case| C{feature consent given?}
  A -->|family member under 18, in the parent's account| P{"parent's feature consent? (acting_for = parent)"}
  C -->|no| T[Template / static path + consent screen]
  P -->|no| T
  C -->|yes| OK[Run agent]
  P -->|yes| OKM[Run agent · minor profile never used for profiling or ads]
```

- **Server-side only.** The client flag is ignored. Consent comes from the stored artefacts (E-15), never from the device.
- **No age gate on AI.** Every AI feature is available to every user (D-13 revised, 23 Oct 2026). Age (case DOB and server time, EC-15; a year-only Aadhaar uses the latest possible birthday, EC-01) drives licence eligibility and family mode only.
- **Under 18 (P-07 Rahul, EC-05):** the learner uses Margdarshak on a parent's phone, inside the parent's (adult) account. The parent gives each feature consent (DPDP verifiable parental consent, s.9(1), Rule 10). AI routes, LLM debriefs, streaks and stored game sessions work as for everyone; squads and share cards need the parent's consent. A minor profile's data is never used for behavioural tracking, profiling or targeted ads (s.9(3)). Provider terms on minors: R-13 (RISK_REGISTER).
- **Turning 18 mid-journey:** the learner can move the case to their own account; consents are asked again in their own name.
- **Helper mode (P-04, EC-14):** consent comes from the **applicant** (or the parent, for a family member's case), never from the helper.
- **Logging:** a missing-consent refusal increments a counter only; no DOB is logged.

---

## 8. Hackathon build (Phase 1–2) vs production (Phase 3+)

| Area | Hackathon | Production |
|---|---|---|
| Agents shipped | Debrief (deep), Voice (Hindi/English, 8 destinations, 10 fields), Decoder (status screenshot), Scam explainer, Clip proposer, Tutor (thin), Coach (thin), Sign Snap (could) | All, plus Dogri cascade GA, paper-slip decoder after real samples, Kashmiri voice-in |
| Eval gate | ≥ 30 cases per agent in CI (D-10) | Plus the quarterly fairness audit and shadow eval on 1% of traffic |
| Sessions | Postgres, 24 h | Same, in an Indian region |
| Providers | Gemini Developer API (paid) + Sarvam | Vertex AI India + Bhashini/Sarvam under DPA |

## 9. Inconsistencies noted (reported, not fixed in PROJECT_BRIEF)

1. **TutorAgent (M-04):** 04 §3.5 rejects runtime tutor AI, while PROJECT_BRIEF lists M-04 as a runtime agent. Resolved here as selection plus a bridge over reviewed text only.
2. **Hosting:** 04 §1.6 picks Cloud Run; PROJECT_BRIEF §8 and D-17 say Render. Resolved as Render primary, Cloud Run alternative, same image. 08 §5.8 latency targets name "Cloud Run asia-south1" and are re-stated here as "server-side".
3. **Scam explainer (F-33)** and the **commentary transcription/classifier** (F-25 commentary mode) use Gemini but have **no M-ID** in PROJECT_BRIEF §10. Suggest adding M-10 (scam explainer, Flash-Lite) and M-11 (commentary classifier, Flash-Lite) to the brief.
4. **Golden Hour (G9) debrief:** 08 §5.9 includes all 10 games in the debrief eval set, but D-14 / council row 12 say golden-hour content takes no generative AI. Here G9 is template-only, and the eval cases for G9 expect `route = template`.
