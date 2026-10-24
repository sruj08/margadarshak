# Weekly human review: AI debriefs (MD-327)

Copy to `ai/evals/reviews/<yyyy-mm-dd>.md`. Sample: `GET /v1/admin/ai/reviews?n=30` (AI-worded cards
of the tenant you have not rated; no PII by construction). Score in the console or with
`POST /v1/admin/ai/reviews`; agreement: `GET /v1/admin/ai/reviews/agreement`.

- Week of:
- Raters (pseudonyms, two per card; one native Hindi rater for hi/hinglish cards):
- Cards sampled:
- Quadratic-weighted kappa (grounding / tone / usefulness):

## Rubric (0 = no, 1 = partly, 2 = yes)

| Axis | 2 means |
|---|---|
| Grounding | Every statement follows from the session's facts and the cited rules; nothing invented |
| Tone | Calm and respectful; no fear, gore, shaming or speed praise |
| Usefulness | "What you could have done" is a concrete action for next time |

Hindi fluency (hi and hinglish cards, native rater, 1-5) is recorded in the notes column.

## Cards

| item_id | locale | rater A (g/t/u) | rater B (g/t/u) | fluency | note |
|---|---|---|---|---|---|
| | | | | | |

## Disagreements → new eval cases

Every item the agreement endpoint lists (a 2-point gap on any axis) becomes a case in
`ai/evals/debrief_150.jsonl` before the fix merges (AI_EVALS §6, regression policy).

| item_id | what went wrong | new case_id |
|---|---|---|
| | | |
