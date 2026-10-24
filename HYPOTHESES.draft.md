<!--
DRAFT FOR TEAM REVIEW (MD-241). Not the pre-registration yet.
To use it: review every line, fill each <placeholder>, rename to HYPOTHESES.md and commit it AFTER G0 and BEFORE the
first participant session. The commit hash goes on the slide footnote. Do not change the hypotheses after any data exists.
Source: docs/08-project/FIELD_STUDY.md §6.4 template, §4, §7.2, plus the AI-generated clip decision (ADR-0013, 2026-10-24).
-->
# Margdarshak field studies: pre-registered hypotheses
Committed: <ISO timestamp, IST> · Commit: <hash> (filled after commit, in the README)
Confirmed hackathon start (G0): <ISO timestamp, IST> · Source: docs/08-project/decisions/G0-start.md
No participant data existed at the time of this commit.

## Study S2: Nazar
Instrument: Margdarshak Nazar study flow (MD-237), app version <git tag>, scoring module game-core <version>.

**Clips are AI-generated.** Every study clip is generated with Gemini video generation (model <GEMINI_MODEL_VIDEO_GEN,
e.g. gemini-omni-1.1-flash>, prompt PRM-CLIPGEN <version>) from the scene catalogue `content/nazar/scenes.json`
(ADR-0013). Clips are labelled "AI-generated scene" to participants. They are not filmed footage and not Kerala's clips.
All results describe performance **on these AI-generated road scenes**; no claim is made that they transfer to real roads
or to Kerala's test. The 10 seeded sample clips (model `sample-fixture-not-generated`) are never used in the study.

Clips: <n_usable> usable clips, each with: a passed synthetic review (no real-person likeness, no readable plates, no real
brands, no collision or injury, hazard visible), a passed flash check, and two-rater agreement on every hazard window.
Blocks B1/B2/B3 of 5, balanced on curator difficulty (list clip IDs and versions per block):
- B1: <ids>
- B2: <ids>
- B3: <ids>
Forms: A (test B1+B2, fresh B3), B (test B2+B3, fresh B1), C (test B1+B3, fresh B2), rotated in order of arrival.
LL mock: fixed 15-question set <set ID>.

Window per hazard: onset a = mean of two raters' onsets; end b = mean of two raters' ends. Human raters set every window;
the generator's approximate onset hint is never used for scoring.
Clips with |Δonset| > 1.0 s go to a third rater; if still > 1.0 s the clip is dropped before scoring.

Primary score: 5 equal bands in [a, b], first tap scores 5..1, scaled to 10 marks per clip
(one hazard x2; two hazards each /5); pattern clicks (> 3 taps in 1.0 s, or > 2*hazards + 4 taps in a clip) = 0 for that clip;
taps before a = anticipation taps, scored 0, logged. Test score = sum over 10 test clips (0-100).
Sensitivity score: 10 marks if the tap is in [a, a+2 s], linear decay to 0 at a+5 s, 0 before a.

H1: >= 30% of licence holders score < 60/100 (primary score) on these AI-generated scenes.
H2: correlation between the 15-question LL-mock score and the Nazar score is weak (|r| < 0.3).
H3: on the 5 fresh clips after feedback, the mean per-clip score is higher than the mean per-clip score on the 10 test clips
    (paired, one-sided Wilcoxon signed-rank).
H4: inter-rater agreement: median |Δonset| <= 0.5 s across rated clips.

Exclusions: declared under 18; total session < 60 s; > 3 taps per second anywhere; retakes (used only for test-retest);
integrity trust < 0.6 (a deviation from the field-kit draft, which did not have this rule; applied in the export because
the analysis script does not apply it).
Decision rules (copied verbatim from FIELD_STUDY.md §7.2):

| Hypothesis | "Supported" | "Consistent with, not confirmed" | "Not supported" |
|---|---|---|---|
| H1 (≥ 30% below 60) | Wilson 95% lower bound ≥ 30% | point estimate ≥ 30%, lower bound < 30% | point estimate < 30% |
| H2 (|r| < 0.3) | 95% CI entirely inside (−0.3, 0.3) | |r| < 0.3 but the CI crosses ±0.3 | |r| ≥ 0.3 |
| H3 (gain after feedback) | one-sided Wilcoxon p < 0.05 **and** the difficulty-matched gain > 0 | p < 0.05 but the matched gain ≤ 0, or p ≥ 0.05 with a positive gain | gain ≤ 0 |
| H4 (median |Δonset| ≤ 0.5 s) | median ≤ 0.5 s | 0.5 < median ≤ 0.75 s | median > 0.75 s |

Backup: if < 12 usable clips at the backup trigger, six-clip mode scaled to /100, H3 not tested, S1 is the headline.
If 12-14 usable clips: 10 test clips + the remaining 2-4 as fresh; H3 reported as exploratory.
Session length: target 4-6 minutes; clips are <duration range, e.g. 20-24 s> each. <Confirm: 15 clips at >= 20 s is about
5 minutes of playback before the LL mock; shorten study scenes or accept a longer session before committing.>

## Study S1: Journey test
J1: median time_s for Margdarshak is at least 40% lower than for the lab replica (paired Wilcoxon signed-rank, one-sided).
J2: full_success count Margdarshak > replica (exact McNemar, one-sided); prediction Margdarshak >= 6/8, replica <= 3/8.
J3: mean SUS Margdarshak >= 75 and replica <= 55; paired difference with 95% CI (t).
J4: "would still pay an agent" falls pre -> post (exact McNemar, one-sided); median max-INR falls.
Exclusions: participant reveals real personal data (stop, delete, exclude); system crash > 60 s (rerun once, flag).
Small n: every participant's row is reported; no claims beyond "in this sample".
Decision rules for J1-J4: FIELD_STUDY.md §7.2 (copy the J rows verbatim at commit time).

## Analysis code (frozen at this commit)
analysis/nazar_stats.mjs   sha256: 08904f7d16d4b81b02c27b85e539e5819897743b4f48e1396e26ae990d9a251a
                           (copied unchanged from field-kit/nazar_stats.mjs; re-check the hash at commit time)
analysis/journey_stats.mjs sha256: <hash>   (MD-627: to be written before journey data exists)
Changes after data collection: bug fixes only, each listed in analysis/DEVIATIONS.md with the commit.

## Reporting promise
Every hypothesis is reported, whichever way it comes out. If the replica beats Margdarshak on any measure, that goes on the
slide too. Every Nazar result is reported as "on AI-generated road scenes".
