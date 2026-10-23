# ai/evals: evaluation datasets
> Project: Margdarshak · Owner: AI lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Full method, metrics and CI gates: [docs/04-ai/AI_EVALS.md](../../docs/04-ai/AI_EVALS.md). ID catalogues: [docs/04-ai/PROMPTS.md §2](../../docs/04-ai/PROMPTS.md).

All data here is **synthetic or team-produced**.
- No real person's data.
- Aadhaar-like and phone-like numbers are random, used only to test that the PII gate drops them.
- Persona names (Kabir, Tanvi, Rahul) are fictional.

## Files

| File | Cases | Agent | One record = |
|---|---|---|---|
| `debrief_150.jsonl` | 150 (90 band · 30 multi · 15 edge · 15 adversarial) | DebriefAgent (M-02) | A server-rescored `SessionResult` + user gate + context → expected route, top finding, gold rule IDs, drill candidates, banned strings |
| `voice_nav_30.jsonl` | 30 (10 hi · 8 hinglish · 6 en · 6 doi) | VoiceGuideAgent (M-01), text transcripts | Utterance + screen/stage context → expected tool trajectory, confirm turn, refusal IDs, PII expectation |
| `decoder_30.jsonl` | 30 (5 adversarial) | ScreenDecoderAgent (M-05) | Image reference + synthetic OCR text + candidate catalogue IDs → expected `doc_kind`, `catalogue_id`, stage, classes, dates, route |
| `tutor_30.jsonl` | 30 (2 adversarial) | TutorAgent (M-04) | LL item + chosen/correct option + reviewed explanations + allowed rules → expected explanation ID, rule ID, calibration note |

To come (owners and dates in AI_EVALS §2):
- `errors_40.jsonl`, `scam_50.jsonl`, `commentary_15.jsonl`;
- `coach.evalset.json` (generated);
- `signsnap_30/`, `clips_3/`, `audio/voice_60/` (media is kept out of git and stored in R2 with access control);
- `fixtures/decoder/*.png` (rendered at H0).

## Record schemas (abridged)

### debrief_150.jsonl
```jsonc
{
  "case_id": "DB-005",
  "category": "band|multi|edge|adversarial",
  "game_id": "nazar|junction_scan|stopping_distance|blind_spot|track_twin|night_glare|hill_road|helmet_fit|golden_hour|ll_sim|bundle",
  "band": "strong|medium|weak|edge|adversarial|<a>+<b>",
  "locale": "en|hi|hinglish|doi",
  "user": { "age_band": "adult|u18", "consent_ai_coach": true },
  "session_result": { /* 08 §2.2 SessionResult: sid, gameId, score{components}, findings[{findingId,severity,ruleIds,skillId,facts}], integrity */ },
  "context": { "prev_finding_ids": [], "commentary_transcript": "…optional, untrusted…" },
  "build_facts_expected": { "top_findings_sent": [], "allowed_rule_ids": [], "excluded_unverified_rule_ids": [], "drill_candidates": [], "dropped_fact_keys": [] },
  "expected": {
    "route": "llm|template|blocked_u18", "fallback_reason": null,
    "top_finding_id": "NAZ_LATE_RESPONSE",
    "rule_id_gold": { "NAZ_LATE_RESPONSE": ["RUL.CUR.PED_BUS_STOP"] },
    "drill_in": ["DRL.NAZ.BUS_STOP.L2", "…"],
    "allowed_placeholders": ["late_s", "metres", "…"],
    "must_not_contain": ["₹", "official", "…"],
    "no_digits_outside_placeholders": true
  }
}
```

- **Facts are computed, not typed.** Stopping distances use `d = v·1.5 + v²/(2·μ·9.81)` with μ = 0.7 dry and 0.4 wet. Nazar metres use `late_s × speed / 3.6` (08 G1, G3).
- **Golden Hour** cases always expect `route: "template"`: safety-critical content takes no generative AI (D-14).
- **Track Twin** rules are `verified:false` (practice layout), so their gold rule is `UNKNOWN`.

### voice_nav_30.jsonl
`expected_tool_uses` maps 1:1 to ADK's expected tool-use trajectory. Cases with two `set_field` calls are scored as a set (order-insensitive).

- `must_not_call` lists tools that must not appear.
- `pii_gate_expected: true` means the model request log must not contain the digits at all.
- **The Dogri utterances are drafts** and must be checked by the team's native Dogri speaker before the recorded set is made.

### decoder_30.jsonl
`input.image_ref` points to a fixture rendered from real Sarathi strings (`research/ps1-current-state/01-sarathi-screens.md`). `ocr_text_synthetic` lets the text path run before the images exist. A case with `route: "dropdown"` expects `UNKNOWN` (or confidence < 0.7) and **no** next-step automation.

### tutor_30.jsonl
The explanations are marked `draft_pending_two_person_review`. They must be checked against the rule source before the bank ships (04 §3.5). TU-028 has no approved explanation, so the graph must return the UNKNOWN card **without calling the model**.

## How to run

```bash
python -I scripts/evals/gen_debrief_150.py ai/evals/debrief_150.jsonl   # deterministic; CI diffs it
python -I scripts/evals/jsonl_to_evalset.py ai/evals ai/evals/adk         # → ADK *.evalset.json (to write at H0)
pytest tests/ai -m eval                                                    # ADK AgentEvaluator + custom metrics
adk eval services/api/margdarshak_ai/agents/voice ai/evals/adk/voice_nav.evalset.json --config_file_path ai/evals/adk/test_config.json
```

**Live evals use the paid-tier key** (`environment: ai-eval` in GitHub Actions), even though the data is synthetic. That keeps one rule for every environment that isn't local dev.

## Adding a case

1. Every bug, incident or human-review finding becomes a case **before** the fix merges.
2. Use the next free `case_id` and never reuse one.
3. Fill `labels.labelled_by` with two names. Disagreements go to the AI lead.
4. Debrief cases: add them to `scripts/evals/gen_debrief_150.py`, so the file stays reproducible (rename the set when it grows past 150, e.g. `debrief_v2`).
5. Run the offline job locally (`pytest tests/ai -m offline`) before pushing.
