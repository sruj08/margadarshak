# Game Design: the ten games
> Project: Margdarshak · Owner: Learning & Games lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [GAME_SDK](GAME_SDK.md) · [CURRICULUM](CURRICULUM.md) · [NAZAR](NAZAR.md) · [DEBRIEF_SPEC](DEBRIEF_SPEC.md) · [GAMIFICATION_ENGINE](GAMIFICATION_ENGINE.md) · [game-core README](../../packages/game-core/README.md) · [UI spec](../02-design/UI_SPEC.md) · [Accessibility](../02-design/ACCESSIBILITY.md)
> Features: F-22, F-23, F-24, F-25, F-26, F-52 · Entities: E-16, E-17, E-18, E-19, E-20, E-21 · APIs: API-34..API-37 · Directives: D-03, D-09, D-10, D-11, D-12, D-13 revised, D-14, D-19, D-21 · Edge cases: EC-05, EC-13, EC-14, EC-15, EC-18, EC-19, EC-20, EC-28, EC-29
> Evidence: `research/ps1-deep/08-game-ai-n8n.md` §3 (game cards), `02-accident-curriculum.md` (data), `05-psychology.md` (motivation, cheat vectors), `01-abroad.md` (UK HPT, Singapore demerits), `war-room/margdarshak-verification.md` §1.1.

**Tags.** **[D]** = our design parameter, stored in `game-config.json` with `source: "design"`, never presented as a government rule. **[K]** = known engineering fact not re-checked. **[unverified]** = needs a check, with owner and date in §13.

---

## 1. Rules that bind every game

### 1.1 What a game may never claim (verification §1.1, D-11, D-19)

Every game's start screen, result screen and debrief carry: **"Practice and familiarisation, not certification"** / "अभ्यास और परिचय के लिए, प्रमाणन नहीं". On top of that, no game, debrief, share card or Practice Record may say or imply:

| Never claim | Why | Enforced by |
|---|---|---|
| "You are a safe / unsafe driver", "you would crash", "you would have died", "lives saved" | We measure practice performance on our clips, not crash risk (D-19, D-22) | banned-phrase lint on i18n strings + DebriefAgent tone lint (DEBRIEF_SPEC §6) |
| "Certified", "verified licence", "official", "Kerala's test", "your RTO's track" | Impersonation and overclaim (D-01, D-19) | copy lint; Kerala text always "Kerala's announced format (as reported)"; tracks always "Practice layout, not your RTO's track" |
| That the Kerala pass mark is ours | It is Kerala's announced number; we only mirror it (verification §1.1, Nazar row) | Kerala mode label + source chip |
| That raw reaction speed is skill | Rewards twitch over anticipation (`05` principle 17) | scoring: no component rewards RT alone; false-alarm and pattern penalties |
| That a game trains balance, clutch control or emergency handling | It's layout familiarisation; handling bravado training raised crashes (Elvik +12%, `01` §0.1) | Track Test Twin copy + no skid/speed content |
| A copied "official 15Q/9-pass" LL format | Unverified (team report l.376) | LL format only from the rule pack with source and date |
| That a "Khud Licence" or "Pehli Baar Pass" badge is government-verified | Self-declared (`05` cheat table) | badge label "Your word" / "आपका वचन" |
| Medical advice from Golden Hour before sign-off | Safety-critical (D-14) | "Draft, not medical advice" label; `template_only` debrief |

**Content bans:** no speed, stunt, skid or racing scenarios; no gore or injury imagery (fear appeals backfire on this user, `05` insight 3); no public speed leaderboards; no stakes, entry fees, cash or redeemable prizes (Online Gaming Act 2025, verification G9).

### 1.2 Shared mechanics

- **Placeholders** in "May" examples below use `{{fact:key}}`; formatted values carry their own units and "≈" (DEBRIEF_SPEC §5.2), e.g. `{{fact:metres}}` → "≈ 16 m".

- **Score = Σ components**, each with an `explainKey`; caps are explicit (`capApplied`). Scores are computed by `@margdarshak/game-core/scoring` on the device for an instant preview and **recomputed by the server verifier, which wins** (GAME_SDK §6).
- **Seeded variants:** the server seed picks items, traffic, layouts and distractors, so screenshots of "answers" don't transfer.
- **Staircase** (GAME_SDK §7): 2 consecutive item passes → level + 1; 1 fail → level − 1. "Item pass" is defined per game in §x.7.
- **Error-friendly XP:** failing still earns XP (quality floor 0.3, GAMIFICATION_ENGINE §2), because error-management training works (`05` insight 10).
- **Privacy:** games receive only `SessionContext` (no name, DOB, phone, location, camera frames or audio). Helmet Fit frames never leave the device.
- **Family mode (D-13 revised):** a learner under 18 plays every game and mode, Nazar mock and commentary included, inside the parent's account, with server-verified scores, AI debriefs, XP and streaks. Squads, pair mode and share cards for the minor's profile need the parent's consent. A minor's data is never used for behavioural tracking, profiling or ads (DPDP s.9(3)).

### 1.3 Shared accessibility baseline (F-52, D-21, EC-13, EC-18)

| Need | Baseline in every game |
|---|---|
| Deaf / no audio | No-audio by default. Every audio cue has a visual cue and `navigator.vibrate` haptics (Android Chrome) [K] |
| Colour vision | Okabe-Ito palette; **shape + pattern + icon + word** encode every state (e.g. hatched no-zone with an eye-off icon), never red/green alone |
| Motor / one hand | Every control in the bottom 40% of the screen; targets ≥ 48 px; a **tap-only mode** with no drag, hold or tilt |
| Low vision | Text ≥ 18 px, scalable to 200%; contrast ≥ 4.5:1 (7:1 for HUD numbers on video, per `06` B11) |
| Photosensitivity | ≤ 3 flashes per second (WCAG 2.3.1); `safe_luminance` mode dims glare/flash effects; `prefers-reduced-motion` honoured |
| Screen-reader users | Canvas games have a `screen_reader_alt` DOM decision version. It is an honest substitute, labelled "not the same skill" where it differs (Nazar) — never a hard block |
| Cognitive load | One instruction per screen; a skippable 20-second "how to play" with a practice item that doesn't score |
| Low-end / 2G (EC-19) | Lite mode loads no Phaser; SVG `decision_variant` per sim; clips at 360p, size shown before download |

### 1.4 Build depth (Phase 1–2 vs Phase 3+)

| Game | Phase 1–2 (hackathon) | Phase 3+ (production) |
|---|---|---|
| G1 Nazar | **Deep:** Kerala mock, learn (occlusion + prediction), commentary on 1 clip, pair mode | 100+ clips, IRT difficulty, car POV, night/fog packs |
| G2 Stopping Distance | **Deep:** all 3 rounds, dry/wet | night, speed breakers, pillion load |
| G3 Blind Spot | **Deep:** Part A + short Part B | bus stop, platooning, night |
| G4 Junction Scan | Thin: 1 level (T-junction with a parked bus) | 5 levels |
| G5 Track Test Twin | Thin: 2W figure-8, touch + keyboard | car H-track, reverse park, gradient, tilt, per-RTO specs |
| G6 Helmet Fit | Thin: framing + checklist + quiz | on-device strap classifier (stretch, accuracy unknown) |
| G7 Golden Hour | Thin: 1 scenario, "draft" label until medical sign-off | 3 scenarios, signed protocol |
| G8 Night & Glare | Storyboard slide | full game |
| G9 Hill Road | J&K storyboard slide | full game |
| G10 LL Test Simulator | **Deep:** J&K format, practice + mock + guided first run | all tenants |

---

## 2. G1 · Nazar: hazard perception on real Indian clips (`nazar`)

Full clip-bank, rater and study specification: [NAZAR.md](NAZAR.md). This section is the game card.

### 2.1 Objective
Spot developing hazards earlier (autos cutting in, a person stepping out from behind a bus, cattle, a door opening, a wrong-side rider, a child at a school gate) and be **calibrated** about your own spotting. Trains M5, M6, M8, M18 (+ M4, M7, M9, M16 via clip tags).

### 2.2 Accident data
Pedestrians 35,221 deaths (RAI23 T4.4); hit-from-side 20,623, hit-from-back 36,804 (RAI23 T1.5); uncontrolled crossings 25,471 (RAI23 T3.7). Hazard-perception training has on-road RCT evidence (Horswill; `05` insight 9). The UK HPT is credited with an 11.3% cut in non-low-speed crashes in the year after the test (quote with caution: sources conflict, `01` row 1). **Kerala adds an HPT from 1 Dec 2026**: 10 one-minute clips × 10 marks, up to 2 hazards per clip, late clicks lose marks, pass 60/100 (as reported: [Onmanorama](https://www.onmanorama.com/news/kerala/2026/09/14/kerala-adds-hazard-perception-test-for-driving-licences-from-dec-1-first-in-india.html), [The South First](https://thesouthfirst.com/kerala/how-fast-can-you-spot-danger-keralams-new-licence-test-faces-driving-school-block/); circular text not found).

### 2.3 Mechanics
- Full-screen `<video>` (whole MP4 preloaded before the clip starts, so buffering can't break timing: EC-18). Tap anywhere; a `--nazar` amber ring marks the tap (UK-style feedback). No countdown timer (anticipation, not speed: `06` B11).
- After each clip (practice/learn), a replay shows the hazard window as a hatched amber band on the scrub bar with the user's taps as flags. In **mock**, feedback waits until the end, as in a real test.
- **Modes:** **mock** (Kerala announced format), **practice** (single clips with immediate replay), **learn** (occlusion and prediction: freeze 0.5 s before onset [D], "what happens next?" with 4 picture options from the `hazard_type` enum, then "tap where"), **commentary** (*bolke chalao*: online, record-then-score, D-12), **pair** (two friends play the same seed; results are shown privately to each, never as a winner).
- **Pre-mock calibration:** "How many of the 10 clips will you pass?" (0–10), compared after.

### 2.4 Level design
| Level | Clip pool (curator difficulty, NAZAR §7) | Hazards per clip | Extras |
|---|---|---|---|
| L1 | difficulty 1–2: single obvious developing hazard, daylight, slow speed | 1 | learn-mode occlusion available |
| L2 | 2–3: hazard partly occluded (bus, parked car) | 1 | |
| L3 | 3: busier scenes, distractor movement that is *not* a hazard | 1–2 | quiet clips in practice |
| L4 | 3–4: two hazards, the second while attention is on the first | 2 | dusk |
| L5 | 4–5: subtle cues (wheel turn, head turn, door gap), night/rain | 1–2 | |
| Mock | fixed mix from the rule pack: clips spread over difficulty 2–4 [D], unseen by the user | 1–2 | Kerala format |

### 2.5 Controls
Tap anywhere (touch), Space or click (desktop), switch access (any key). One hand. Pause button top-right (48 px). No gestures.

### 2.6 Telemetry events
`session_start`, `item_start{ref: clip:<id>@<ver>}`, `tap{x,y}` with `mt` from `requestVideoFrameCallback`, `prediction{choice}` (learn), `confidence{predictedPassClips}` (pre-mock), `commentary_marker` (commentary), `visibility_hidden`, `pause/resume`, `item_end`, `session_end`. No microphone audio in events.

### 2.7 Deterministic scoring
For clip *c* with hazards *H_c* (1 or 2) and two-rater final windows [*a_h*, *b_h*] (NAZAR §5):
1. Band width `w_h = (b_h − a_h) / 5`. The first tap τ with `a_h ≤ τ ≤ b_h` scores `p_h = 6 − k`, where `k = min(5, ⌊(τ − a_h)/w_h⌋ + 1)`. So 5, 4, 3, 2, 1 points; no tap in the window = 0 (UK structure, `01` row 1).
2. A tap credits at most one hazard; with overlapping windows it credits the earliest-onset unscored hazard.
3. **Pattern-clicking rule:** if any 1.0 s sliding window holds more than 3 taps, **or** the clip has more than `2·|H_c| + 4` taps, the clip scores **0** (modelled on the UK rule that pattern-clicking scores 0; parameters [D], `08` G1).
4. **Kerala marks per clip** = `2·p_h` for one hazard, `p_1 + p_2` for two hazards (max 10). Session = Σ over 10 clips (max 100). `passed = total ≥ 60` with `passRule: {source: "rule_pack", ref: "HPT-KL"}`, i.e. Kerala's announced pass mark. **UK-style practice view:** per-hazard 0–5 points shown directly.
5. Taps before `a_h` earn nothing (as in the UK); taps within 1.0 s before `a_h` are logged as `early_taps` for learn-mode feedback ("you saw it coming; tap again when it starts to develop").
6. **Late facts:** `band1_end = a_h + w_h`; `late_s = max(0, τ − band1_end)` (0.1 s); `metres = late_s × speed_kmh_est / 3.6`; e.g. 1.4 s at 40 km/h = 15.6 m, rendered "≈ 16 m".
7. **Quiet-clip false alarms** (practice/learn only): `fa_per_min = taps outside all windows (excluding the 1.0 s pre-onset) / minutes`.
8. **Item pass** (staircase): clip marks ≥ 6.
9. **Nazar Score** (share card, Practice Record): mean of the last 3 eligible mocks (GAME_SDK §6.4: server seed, unseen clips, trust ≥ 0.6, rVFC timing, verified).
10. **Commentary score** (separate, never mixed into the Kerala score): see NAZAR §9.

### 2.8 Difficulty staircase
Per hazard-type skill. Practice/learn adapt (2-up/1-down); mock never adapts. FSRS resurfaces missed `hazard_type` concepts (`C-M18-001` etc.).

### 2.9 Accessibility
No audio needed at all. Tap anywhere (one-handed). Hazard bands hatched + labelled. `screen_reader_alt`: a still-frame "which one is the hazard?" mode with audio description, labelled **"Alternative lesson: not the same skill as the timed test"**. Deaf users are fully served (visual-only by design). Reduced motion: replay band appears without animation.

### 2.10 Anti-cheat
Mocks draw **unseen clips** only (server tracks seen clips per user); hazard windows for mock clips are never sent to the client before completion; pattern rule; rVFC timing with `INT_CLOCK_DRIFT` on mismatch; tab hidden voids the clip; per-session visible watermark (short session code in a corner) so screenshots don't become answer keys; pair mode uses the same seed played live.

### 2.11 What the AI debrief receives
Facts per finding (DEBRIEF_SPEC §2.1): `late_s`, `speed_kmh`, `metres`, `hazard_type`, `clip_ordinal`, `missed_count`, `taps_in_1s`, `pattern_clips`, `predicted_pass`, `actual_pass`, `early_taps`, `fa_per_min`, `score_total`, `pass_mark`, `kerala_status` (announced / on hold). Never the video, frames, taps' raw coordinates, location of filming or any user identity.

### 2.12 May and may not claim
- **May:** "You tapped {{fact:late_s}} after the hazard began; at {{fact:speed_kmh}} that is {{fact:metres}}", "You missed door-openings twice; next time scan parked cars", "Your score is below Kerala's announced pass mark of {{fact:pass_mark}} on our practice clips".
- **May not:** "You'd fail Kerala's test" (our clips ≠ Kerala's), "Your reactions are slow" (RT is not the skill), any claim about real-world crash risk, any rank against strangers.

---

## 3. G2 · Stopping Distance: speed vs metres, dry vs wet (`stopping_distance`)

### 3.1 Objective
State the stopping distance at 40/60/80 km/h dry and wet; feel that double the speed is about four times the braking distance; **choose a speed for the distance you can see**. Trains M1, M2, M16.

### 3.2 Accident data
Over-speeding attributed in 1,17,682 deaths (68.1%, 2023) and 1,24,522 (70.3%, 2024) (RAI23 T3.1; CSV24-V); 66% of deaths on straight roads (RAI23 T3.5); pedestrian death risk under 20% below 50 km/h and about 60% at 80 km/h (WHO, not re-fetched).

### 3.3 Mechanics (SVG + Motion, three rounds)
1. **Predict, then reveal:** a side-view road; drag (or tap ± in tap-only mode) a marker to where you think you'd stop from a given speed and surface; the animation reveals thinking + braking distance with both numbers.
2. **Choose a speed, then react:** a residential street with parked cars. Pick a speed (20/30/40/50/60). A child steps out from between parked cars at a seeded distance; tap **BRAKE**. Your measured reaction time goes into the physics. *Anticipation is rewarded through the speed choice; the reaction time is reported, not scored* (`05` principle 17).
3. **Speed for sight:** a bend or a hidden driveway with visible clear distance *X*; pick the highest speed at which you could still stop.

### 3.4 Level design
| Level | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| L1 | 40/60 dry | street, child at 30–40 m | sight 60–80 m, dry |
| L2 | 40/60/80 dry | 20–30 m | 40–60 m |
| L3 | dry + wet | wet street | wet |
| L4 | wet + night (sight = headlight range [D]) | dusk | night |
| L5 | mixed + unmarked speed breaker | | mixed |

### 3.5 Controls
Drag slider or ± buttons (tap-only); BRAKE as a full-width bottom button (also Space/Enter). One hand.

### 3.6 Telemetry events
`estimate{speedKmh, surface, predictedM}`, `speed_choice{chosenKmh, context}`, `brake{rtMs}`, `answer` for any card item, `item_start/end`.

### 3.7 Deterministic scoring
Physics (shown to the user): `d_total(v) = v·t_r + v²/(2·μ·g)`, v in m/s, g = 9.81 m/s², **μ_dry = 0.7, μ_wet = 0.4, t_r = 1.5 s** for rounds 1 and 3 (teaching values from `02` M1, labelled "real roads vary"). Checks: 40 dry ≈ 25.7 m; 60 dry ≈ 45.2 m; 60 wet ≈ 60.4 m (of which braking ≈ 35.4 m); 80 dry ≈ 69.3 m.
Max safe speed for sight *d*: `v_max = μg·(−t_r + √(t_r² + 2d/(μg)))`; e.g. d = 40 m dry → 15.3 m/s ≈ 55 km/h; wet → 12.8 m/s ≈ 46 km/h. Options come in 5 km/h steps; `v_max_opt = 5·⌊v_max_kmh/5⌋`.

| Component | Max | Formula |
|---|---|---|
| Estimation | 30 | `30 × mean_k max(0, 1 − |pred_k − true_k| / true_k)` |
| Speed + react (no collision) | 20 | `20 × (rounds without collision / rounds)`, collision if `v·rt + v²/(2μg) > D` with the user's measured `rt` |
| Speed for sight | 50 | per item `(50/n) × max(0, 1 − 0.2 × ⌈max(0, chosen − v_max_opt)/5⌉)` (−20% of the item per 5 km/h over) |

Impact speed (round 2, on collision): `v_i = √max(0, v² − 2μg·(D − v·rt))` when `D > v·rt`, else `v`. Converted for the debrief to a **band only from the two published WHO points**: "below 50 km/h" / "between 50 and 80 km/h (no estimate)" / "80 km/h or more". No curve is invented. Item pass: ≥ 80% of the item's max.

### 3.8 Difficulty staircase
Per surface/condition skill (dry, wet, night). Promotion adds wet, then night, then the speed breaker.

### 3.9 Accessibility
Numbers always shown in text, not only animated. Big slider + ± buttons. Wet road = texture + "Wet" label. Brake round has a no-time-pressure alternative in `screen_reader_alt` (choose the speed, then read the outcome).

### 3.10 Anti-cheat
Low stakes. `rt < 100 ms` = anticipatory tap → round re-dealt (`INT_RT_ANTICIPATORY`). Seeded distances. Server recomputes every number from the inputs.

### 3.11 What the AI debrief receives
`speed_kmh`, `surface`, `predicted_m`, `true_m`, `error_pct`, `rt_s`, `chosen_kmh`, `max_safe_kmh`, `sight_m`, `over_kmh`, `impact_band` (enum), `collisions`.

### 3.12 May and may not claim
- **May:** "At {{fact:speed_kmh}} on a wet road you need {{fact:true_m}} to stop; you guessed {{fact:predicted_m}}", "For {{fact:sight_m}} of clear road, {{fact:max_safe_kmh}} was the most you could stop from".
- **May not:** encourage high-speed trials; describe injuries; claim real-road distances are exact (always "teaching values"); invent a risk percentage between the WHO points.

---

## 4. G3 · Blind Spot: trucks and buses (`blind_spot`)

### 4.1 Objective
Know the four no-zones of a truck; never overtake on the left; don't linger beside a truck; hold back when it turns left; "if you can't see the driver in his mirror, he can't see you". Trains M4, M5.

### 4.2 Accident data
Trucks and buses killed **18,556 two-wheeler riders in 2023** (truck 14,229; bus 4,327) (RAI23 T4.5).

### 4.3 Mechanics (Phaser 4 top-down over `game-core/sim`)
- **Part A, place (retrieval first, feedback second):** a stationary truck (or bus) at a seeded orientation. Place the bike in 5 positions the prompt asks for ("where you'd wait behind it at a light", "where you'd ride when it's about to turn left"…). The hatched no-zone overlay appears only *after* you commit each position.
- **Part B, ride:** a flowing highway lane. The truck drifts, indicates, turns left at a junction or brakes. Choose lane third (left, centre, right) and **mirror-check** (a tap shows the truck's mirror view: the driver's face visible or not). Throttle is automatic at a fixed modest speed [D]; the skill is position and patience, never speed.

### 4.4 Level design
| Level | Part A | Part B |
|---|---|---|
| L1 | truck, side-on | single truck, slow drift |
| L2 | truck, rotated; bus | truck indicates and turns left |
| L3 | tanker (longer) | bus pulling into a stop |
| L4 | mixed | two trucks platooning |
| L5 | mixed | night (headlight cone, glare-free) |

### 4.5 Controls
Part A: drag the bike, or tap-only grid (tap a cell). Part B: three big lane-third buttons + a mirror button, bottom of screen; keyboard ← ↓ → and M.

### 4.6 Telemetry events
`place{zoneProbe}`, `lane_pos` (10 Hz, lateral cm, longitudinal dm), `mirror_check{target}`, `indicator`, `decision{node:"left_turn", choice:"hold"|"pass"}`, `item_start/end`. Faults and time-in-zone are **derived** on replay.

### 4.7 Deterministic scoring
No-zone polygons per vehicle type are config [D] (illustrative geometry from mirror sight-lines; labelled "zones vary by vehicle and mirrors").

| Component | Max | Formula |
|---|---|---|
| Part A placement | 30 | 5 probes × 6; a probe is correct if the bike's footprint does not intersect any no-zone polygon |
| Time in a no-zone | 30 | `30 × max(0, 1 − share/0.25)`, `share = t_in_nozone / t_ride` |
| Mirror checks before moves | 15 | `15 × (lane changes preceded by a mirror_check within 3 s / lane changes)`; 15 if no lane changes |
| Hold back at a left turn | 25 | `25 × (left-indicator events where the rider stayed behind the rear axle line / events)` |

**Critical fault:** overtaking on the left while the truck indicates left → **Part B scores 0**, finding `BS_LEFT_OVERTAKE` (critical) goes first. Item pass: Part A ≥ 24/30; Part B ≥ 56/70 with no critical fault.

### 4.8 Difficulty staircase
Separate ladders for Part A (vehicle types) and Part B (traffic complexity).

### 4.9 Accessibility
Tap-only lane thirds instead of drag. No-zones hatched + eye-off icon + "Driver can't see you here". Mirror view also announced as text ("Driver visible: no"). `screen_reader_alt`: a DOM diagram with "Which position is safe?" questions.

### 4.10 Anti-cheat
Server replay of `lane_pos` over `sim`; seeded truck behaviour; impossible lateral rates flagged.

### 4.11 What the AI debrief receives
`share_pct`, `probes_wrong`, `probe_labels` (enum list), `lane_changes`, `mirror_before_pct`, `left_turn_events`, `held_back`, `left_overtake` (bool), `vehicle_type`; rule IDs `RR-HVY-001/002/003` (002 filtered out of the AI allowlist while `verified: false`).

### 4.12 May and may not claim
- **May:** "You spent {{fact:share_pct}} of the ride where the driver couldn't see you", "You passed on the left while the truck was turning left; hold back behind it", the cited number of riders killed by trucks and buses **only in the 'why this matters' card from the catalogue**, not as a scare line.
- **May not:** fear imagery or crash depictions (`05` insight 3); exact real-world zone sizes; "truck drivers are careless".

---

## 5. G4 · Junction Scan: uncontrolled crossings and T-junctions (`junction_scan`)

### 5.1 Objective
Slow → scan (right, left, right again) → creep → go; yield correctly when priority is unclear; spot vehicles hidden behind a stopped bus. Trains M6, M18.

### 5.2 Accident data
Uncontrolled crossings 25,471 deaths (14.7%); T-junctions 12,311 (7.1%), the largest junction category (RAI23 T3.6–3.7).

### 5.3 Mechanics (Phaser 4 top-down)
- A T-junction or 4-arm uncontrolled crossing under **fog-of-war**: the rider sees only what the sight-line cones show.
- Three thumb buttons, **Look R / Look L / Look ahead**, briefly reveal an arm: our gaze proxy, so scanning is deliberate and measurable.
- **Hold to creep** edges forward, widening sight-lines past a parked bus. **GO** commits.
- Seeded traffic: cars, two-wheelers, an auto, a pedestrian, a cyclist, occasionally a wrong-side rider.

### 5.4 Level design
L1 empty-ish T, good sight-lines → L2 traffic density → L3 a parked bus occluder → L4 dusk lighting → L5 a wrong-side rider and a pedestrian on the crossing.

### 5.5 Controls
Look R / Look L / Look ahead (bottom row), Creep (hold or tap-to-step in tap-only mode), GO. Keyboard: → ← ↑, C, Enter.

### 5.6 Telemetry events
`scan_look{dir, durMs}`, `creep{distDm}`, `decision{node:"go"}`, `indicator`, `item_start/end`. Gap, time-to-collision, collision and near-miss are derived on replay.

### 5.7 Deterministic scoring (100 per item, session = mean)
| Component | Max | Formula |
|---|---|---|
| Scan completeness | 30 | in the 3 s before GO: right AND left AND the last look was right → 30; both but not right-last → 20; one side → 10; none → 0 |
| Gap acceptance | 40 | accepted gap *g* = time for the nearest conflicting road user to reach the conflict point at GO: `g ≥ 4.0 s → 40`; `2.0 < g < 4.0 → 40·(g − 2)/2`; `g ≤ 2.0 → 0`; no conflicting traffic → 40 [D thresholds] |
| Creep use | 15 | if the sight-line was blocked at the stop line, crept before GO → 15, else 0; not blocked → 15 |
| Yield correctness | 15 | to a pedestrian on the crossing and to vehicles already in the junction → 15, else 0 |

**Critical faults:** a collision, or GO with no look toward the threat side in the last 3 s → item capped at **20**. Item pass: ≥ 70 with no critical fault.

### 5.8 Difficulty staircase
Levels above; one ladder per junction type (T, 4-arm).

### 5.9 Accessibility
Buttons only (tap-only native). Arrows + labels for directions; sight-lines solid vs hatched, not colour-coded. `screen_reader_alt`: step-by-step "what do you do next?" with described traffic.

### 5.10 Anti-cheat
Seeded traffic and server replay; GO before any vehicle could be visible is flagged as a guess (not punished beyond normal scoring).

### 5.11 What the AI debrief receives
`gap_s`, `last_look`, `looked_right`, `looked_left`, `crept`, `occluded`, `yield_missed` (enum: pedestrian / vehicle_in_junction), `collision`, `threat_side`.

### 5.12 May and may not claim
- **May:** "You looked left last, and the auto came from the right", "You went with a {{fact:gap_s}} gap; wait for a bigger one".
- **May not:** "go fast to beat the gap" (verification §1.1), anything implying faster crossing is better.

---

## 6. G5 · Track Test Twin: figure-8, reverse park, gradient start (`track_twin`)

### 6.1 Objective
Rehearse the **shape and the fault types** of the driving test so the test day is predictable. **Layout familiarisation only**: it does not train balance, clutch control or emergency handling. Trains DL1 (+ M1 for the gradient).

### 6.2 Accident and test data
Delhi's automated tracks fail about 50%; Gujarat's fail 94% of car applicants on 4 AI tracks (PROJECT_BRIEF §2); Kerala's pass rate fell from 95–100% to 40–45% after the 2024 reform (`02-rules-process` l.82). Criteria aren't published, which is what agents sell (`05` insight 1). The formal syllabus is unknown (`02` §2).

### 6.3 Mechanics (Phaser 4 over a kinematic bicycle model in `sim`)
- Model: wheelbase *L*, steer δ, speed *v*; `ψ̇ = v·tan δ / L`, 60 Hz fixed step, deterministic math.
- **Two-wheeler figure-8:** a minimum-speed balance meter. Below `v_min` [D: 1.0 m/s] the bike wobbles; below 0.6 m/s for > 1 s a **"foot down" fault** registers (reported as a common figure-8 fault in user posts; exact per-RTO parameters unknown). Speed is capped at 3 m/s [D] so there is no speed content.
- **Car reverse park (Phase 3+):** camera flips to a rear view in reverse; cones and lines.
- **Gradient start (Phase 3+):** hold the brake, raise throttle, release; rollback is measured.
- Faults replay on the path: "you touched the line here at 0:41".

### 6.4 Level design
L1 wide lanes, no timer → L2 standard width [D] → L3 time limit on → L4 narrower lanes → L5 (car) gradient step. Track specs are data (`tracks/{state}/{rto}.json`: dimensions, time limit, fault points, `source`); the generic spec carries **"Practice layout, not your RTO's track"** until a published or Live-Intel-confirmed spec exists.

### 6.5 Controls (switchable, all one-handed)
1. **Touch:** left-thumb virtual stick for steering + bottom-right throttle/brake, or single-thumb "hold to go, slide to steer".
2. **Keyboard:** WASD or arrows (desktop judges).
3. **Tilt (Phase 3+):** `DeviceOrientationEvent` gamma → steer; iOS needs `DeviceOrientationEvent.requestPermission()` on a user gesture [K]; neutral calibrated at start; dead-zone ±3° [D].
4. **Assist (tap-only):** auto-throttle at a safe speed, steer only.

### 6.6 Telemetry events
`input{steer, throttle, brake}` (60 Hz, delta-encoded, the replay input), `item_start{ref: track:<id>@<ver>}`, `pause/resume`. Faults (`line_touch`, `cone`, `foot_down`, `stall`, `rollback`, `timeout`, `off_track`) are **derived** on replay, never client-reported.

### 6.7 Deterministic scoring: a Singapore-style demerit sheet (`01` row 19)
| Fault | Demerits [D, from the generic track spec] | Immediate fail? |
|---|---|---|
| Line touch | 4 each | no |
| Cone hit | 8 each | no |
| Foot down (2W) | 10 each | no [D: some RTOs may treat as fail; unknown] |
| Stall (car) | 4 each | no |
| Rollback > 30 cm (car gradient) | 6 | no |
| Over the time limit | 4 per 10 s over | no |
| Over 1.5 × the time limit | — | yes |
| Leaving the track | — | yes |

`passed = demerits ≤ 20 [D] and no immediate-fail fault`; `pct = max(0, 100 − 5·demerits)`, capped at 40 if an immediate fail occurred. Item pass = `passed`. The sheet is styled like an automated-track result card and always labelled "practice layout".

### 6.8 Difficulty staircase
Track width, then the timer, then the gradient step; one ladder per class (2W, LMV).

### 6.9 Accessibility
Assist mode; haptic + icon on each fault; `screen_reader_alt` = a step-by-step explainer quiz ("At the crossing point of the 8, where do you look?").

### 6.10 Anti-cheat
Deterministic replay of inputs; impossible steering rates flagged (`INT_RATE_IMPOSSIBLE`). Low stakes: it's rehearsal.

### 6.11 What the AI debrief receives
`demerits`, `threshold`, `fault_counts` (map: fault → count), `first_fault_time_s`, `fault_location` (enum: loop_left, loop_right, crossing, entry, exit), `time_s`, `time_limit_s`, `track_label` ("practice layout"), `class`.

### 6.12 May and may not claim
- **May:** "Your line touched the cone zone at the left loop", "You put a foot down {{fact:count}}; slow, wide loops at a steady speed".
- **May not:** "You will pass at your RTO", "This trains balance/clutch control", any claim about the RTO's real parameters unless the track spec has a source.

---

## 7. G6 · Helmet Fit: camera self-check (`helmet_fit`)

### 7.1 Objective
Choose an ISI-marked (IS 4151) helmet, get a snug fit, fasten the strap (two-finger rule), remember pillion and child helmets. Trains M3, M13.

### 7.2 Accident data
54,568 riders killed not wearing a helmet in 2023 (RAI23 T3.3); only 45% had the helmet properly fastened (PMC6182975).

### 7.3 Mechanics (React + MediaPipe on device)
We are honest that **no stock model detects "strap fastened"** (`08` G8).
1. Front camera opens; **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`, on device; [guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)) checks the face is centred and the chin/jaw is visible, so the user frames the strap area.
2. Guided self-check, in protocol order: helmet sits level and snug → strap fastened → two fingers under the strap → shake "no": did it stay put? → visor clean/clear. Each step is a self-report ✓.
3. **ISI spot quiz:** genuine vs fake label photos; full-face vs open-face; pillion and child items.
4. **Phase 3+ stretch:** a tiny on-device classifier (MediaPipe Model Maker, ~500 consented team photos) for "strap visible under chin", advice only, accuracy unknown until trained.
- **No-camera path:** a mirror self-check step replaces the framing step with the same score cap, so the camera is never forced (CCPA "forced action").
- **Privacy guardrail (M-09):** no frame ever leaves the device; no face image goes to any model; telemetry carries booleans only.

### 7.4 Level design
L1 framing + 3 steps + 5 quiz items → L2 all 5 steps + 10 quiz items → L3 pillion/child items. Optional daily 10-second **strap check** feeds the Strap Streak badge (not XP inflation).

### 7.5 Controls
Big ✓ per step; quiz taps; voice prompts optional (read-out).

### 7.6 Telemetry events
`camera_check{faceCentred, chinVisible, classifierBand?}`, `step_confirm{stepId}`, `answer{qref, optionId, latencyMs}`, `item_start/end`.

### 7.7 Deterministic scoring (100)
| Component | Max | Formula |
|---|---|---|
| Framing | 20 | face centred and chin visible continuously ≥ 1.5 s → 20 (no-camera path: mirror step confirmed → 20) |
| Self-check steps | 30 | 5 steps × 6 when confirmed in protocol order; a step confirmed out of order earns 3 |
| Quiz | 50 | 10 items × 5 |

Skipping the strap step raises `HF_STRAP_STEP_SKIPPED`. Item pass: ≥ 80.

### 7.8 Difficulty staircase
Quiz variants by family (labels, types, pillion); the self-check itself doesn't get "harder".

### 7.9 Accessibility
Voice + visual prompts; no-camera path; large ✓ targets; label photos have text alternatives describing the mark.

### 7.10 Anti-cheat
Low stakes, self-report by design. The badge says "self-checked".

### 7.11 What the AI debrief receives
`framing_ok`, `steps_done`, `step_skipped` (enum), `quiz_wrong_families` (enum list), `camera_used` (bool). Never an image.

### 7.12 May and may not claim
- **May:** "You skipped the two-finger strap check; it's the step most riders miss".
- **May not:** "Your helmet fits" or "is safe" (we can't verify fit), "Your helmet is genuine" (we only teach how to check).

---

## 8. G7 · Golden Hour: first-aid decisions (`golden_hour`)

### 8.1 Objective
Get the order right (make the scene safe → call 112/108 → don't remove the helmet if a neck injury is possible → control bleeding → keep the person warm and talk → hand over), and know the legal protection so fear doesn't stop you helping. Trains M19.

### 8.2 Accident data
Hit-and-run deaths 31,209 in 2023 (RAI23 T1.5); 74% of bystanders unlikely to help, 88% of them fearing police and legal hassle (SaveLIFE); Good Samaritan protection under MV Act s.134A (not re-fetched).

### 8.3 Mechanics (React state machine, fully DOM)
- A branching, **stylised** scene (no injury imagery): a two-wheeler crash on a highway at dusk.
- Action cards are dealt; the user sequences them; each choice changes the next state.
- A "police arrive" branch dispels myths ("Do I have to give my name?", "Will I be detained?") **from rule IDs only**.
- A one-tap **112** demo button (in-game it never dials; outside the game, the F-15 golden-hour card's 112 button does dial).

### 8.4 Level design
Scenario variants (Phase 3+): night highway, pillion child, rain. Phase 1–2: one scenario.

### 8.5 Controls
Tap cards to place them in order; no drag needed; no timer (no panic pressure).

### 8.6 Telemetry events
`card_order{cardId, position}`, `decision{node, choice}`, `answer` (myths), `item_start/end`.

### 8.7 Deterministic scoring (100)
| Component | Max | Formula |
|---|---|---|
| Order | 60 | `60 × LCS(user_order, protocol_order) / len(protocol_order)` (longest common subsequence) |
| Law myths | 25 | 5 items × 5 |
| Calling 112 early | 15 | call placed at decision step ≤ 2 → 15; step 3 → 10; step 4 → 5; later → 0 (counted in steps, not seconds, so it doesn't reward panic) |

**Critical errors** (removing a helmet when a neck injury is possible; moving the victim without an immediate danger; leaving without calling) → run capped at **40**; never calling → also a critical error. Item pass: ≥ 80 with no critical error.

**Content gate (D-14):** the protocol, its order and every step's wording must be signed off by a medical reviewer (`reviewed_by`, `reviewed_on` in the rule pack). Until then the game shows **"Draft, not medical advice"**, the Golden Hour Ready badge is unavailable, and the protocol order in config is marked `status: draft`. Rah-Veer and cashless-treatment amounts are excluded until re-verified (D-12, D-25).

### 8.8 Difficulty staircase
None in Phase 1–2 (one scenario). Phase 3+: scenario variants rotate by FSRS on the concepts missed.

### 8.9 Accessibility
Fully DOM, TalkBack-friendly, no timing pressure, cards have text labels and icons.

### 8.10 Anti-cheat
Not applicable beyond variant scenes.

### 8.11 What the debrief receives (template only, no AI: `debriefMode: template_only`)
`critical` (enum list), `order_lcs`, `protocol_len`, `call_step`, `myths_wrong` (enum list). **No generative AI** narrates Golden Hour, because first-aid wording is safety-critical (D-09: deterministic code owns golden hour). Templates are medically reviewed text.

### 8.12 May and may not claim
- **May:** "Calling 112 came late in your sequence; call right after making the scene safe", "You're protected by law when you help (s.134A)" — only once `RR-GHR-001` is verified; before that, the line is withheld.
- **May not:** anything beyond the signed protocol; CPR instructions unless the reviewer adds them; reward amounts until re-verified; "you saved a life".

---

## 9. G8 · Night & Glare (`night_glare`) · Phase 3+ (storyboard in Phase 1–2)

### 9.1 Objective
Dip the beam for oncoming traffic and when following; when dazzled, look to the left edge and slow down; ride within the stopping distance of your lights; spot unlit tractors and dark-clad pedestrians. Trains M8, M16.

### 9.2 Accident data
Night (18:00–06:00) is 42.1% of accidents (2023) and 42.5% (2024); 18:00–21:00 is the single peak (RAI23 T7.3; RAI24 T7.3); Punjab 43.1% (RAI23 Annex 42).

### 9.3 Mechanics
Darkened top-down road; pre-baked headlight-cone sprite (no shaders, `08` §1.3). Beam toggle; oncoming vehicles flare a glare sprite over the screen centre; during glare, **hold the left-edge pad** to keep the left kerb visible (gaze proxy). A 3-step speed selector. Hazards: an unlit tractor, a pedestrian in dark clothes, a cow.

### 9.4 Level design
L1 clear night → L2 more oncoming traffic → L3 rain + glare on a wet road → L4 fog (low beam only) → L5 mixed hazards.

### 9.5 Controls
Beam toggle (bottom-right), left-edge pad (bottom-left, hold or tap-toggle in tap-only mode), speed −/+.

### 9.6 Telemetry events
`beam_toggle{state}`, `scan_look{dir:"left_edge", durMs}`, `speed_choice`, `tap` (hazard response), `item_start/end`.

### 9.7 Deterministic scoring (100)
| Component | Max | Formula |
|---|---|---|
| Beam dipping | 25 | `25 × (oncoming/following events with low beam before d_dip / events)`, `d_dip` = 150 sim-m [D] |
| Left-edge hold during glare | 20 | `20 × (glare time with left-edge held / glare time)` |
| Speed within headlight range | 30 | per segment: chosen ≤ `v_max(sight = beam range, μ)` → full; −20% of the segment per 5 km/h over. Beam ranges [D]: low 40 m, high 100 m → e.g. low beam dry ≈ 55 km/h max (G2 formula) |
| Hazards spotted in time | 25 | 5-band window scoring per hazard (as G1), scaled to 25 |

Critical: hitting an unlit hazard → item capped at 30. Item pass ≥ 75.

### 9.8 Staircase · 9.9 Accessibility · 9.10 Anti-cheat
Staircase per condition. Glare is a brightness gradient + outline, never colour-only; `safe_luminance` option; flashes ≤ 3/s. Server replay.

### 9.11 Debrief receives · 9.12 Claims
`high_beam_events`, `dist_m`, `glare_hold_pct`, `chosen_kmh`, `max_safe_kmh`, `beam`, `hazard_type`, `late_s`. **May:** "Your low beam shows {{fact:sight_m}}; you were going faster than you could stop in that". **May not:** claim real headlight ranges for the user's vehicle; any scare imagery.

---

## 10. G9 · Hill Road, J&K (`hill_road`) · Phase 3+ (J&K storyboard in Phase 1–2)

### 10.1 Objective
Downhill in a low gear with no coasting and no riding the brakes; downhill gives way to uphill; horn at blind bends; no overtaking on bends; don't stop under a loose slope; check the J&K Traffic Police road status before setting out. Trains M14, M15.

### 10.2 Accident data
NH44 Ramban gorge plunge, 29 Mar 2024, 10 dead (newsonair); 22,263 deaths on curves nationally (RAI23 T3.5); hill risk barely shows in MoRTH coding (J&K steep grade = 6 deaths, RAI23 Annex 22).

### 10.3 Mechanics
Winding top-down hairpin road with a cliff side; **brake heat meter** (holding the brake heats it; above 70% brakes fade); gear selector 1–4 sets engine braking; narrow-section encounters with an uphill truck (*wait at a widening* or *push on*); blind-bend horn prompt; a "shooting stones" zone where stopping is penalised; **trip-plan pre-game** with a clearly labelled **sample** advisory card ("Sample advisory, check J&K Traffic Police for today's"). Never a fake live status.

Brake model [D]: `T ← T + k₁·b·v·dt − k₂·(T − T_amb)·dt`; if `T > 0.7`, `μ_eff = μ·(1 − 0.6·(T − 0.7)/0.3)`.

### 10.4 Level design
L1 dry daytime → L2 a narrow encounter → L3 rain → L4 fog near a tunnel approach → L5 black-ice patches on shaded morning bends.

### 10.5 Controls
Gear −/+, brake (hold), horn, wait/go decision buttons; steering assisted (lane-keeping) in tap-only mode.

### 10.6 Telemetry events
`gear_choice`, `brake{heldMs}`, `input`, `decision{node:"narrow", choice}`, `horn`, `decision{node:"stop_zone"}`, `answer` (trip plan), `item_start/end`.

### 10.7 Deterministic scoring (100)
| Component | Max | Formula |
|---|---|---|
| Gear / engine-braking discipline | 25 | `25 × (downhill time with T < 0.7 and gear ≤ recommended / downhill time)` |
| Yield to uphill traffic | 25 | `25 × (narrow encounters where the rider waited at a widening / encounters)` |
| Horn at blind bends | 10 | `10 × (blind bends with horn / blind bends)` |
| No overtaking on bends | 15 | 15 − 7.5 per overtake on a bend, floored at 0 |
| No stopping in the hazard zone | 10 | 10 if none, else 0 |
| Trip plan | 15 | checked the advisory (5) + departure in the daylight window (5) + planned stop not under a slope (5) |

Critical: running off the edge zeroes the item; the message is calm ("You went off the edge"), never gore. Item pass ≥ 75.

### 10.8–10.10
Staircase per condition; buttons for gear/brake/horn with visual + haptic horn feedback; server replay.

### 10.11 Debrief receives · 10.12 Claims
`brake_heat_peak_pct`, `gear_low_pct`, `yield_missed`, `horn_missed`, `bend_overtakes`, `zone_stops`, `trip_plan_parts` (enum list). **May:** "On the narrow stretch you pushed on; downhill traffic waits at a widening" — but the AI may cite `RR-HIL-001` (uphill priority) **only once it is verified**; until then it falls back to the practice rule `RR-HIL-003`/template wording. **May not:** quote live road status, death counts for NH44 (unknown), or any J&K Traffic Police statement we haven't sourced.

---

## 11. G10 · LL Test Simulator (`ll_sim`)

### 11.1 Objective
Pass the LL test first time **with understanding**; rote learning fails here ("20/20 in app, 11/20 in the real exam", Q34). Trains LL0–LL4.

### 11.2 Data
Format varies by state and sources conflict: J&K 10 questions / 6 to pass [S]; 15/9 commonly claimed [unverified]; 60% pass mark [P-state Delhi, TN]; per-question timer about 30 s [unverified] (`02-rules-process` l.57–58; `08` G10). Tutorial video mandatory before the test (r.11, 2022 amendment) [P-state TN].

### 11.3 Mechanics
- State-config exam from the rule pack: `{questions, pass, per_q_timer_s, total_timer_s, source_url, verified_on, confidence}`. Start screen: **"Format for J&K: 10 questions, 6 to pass. Source: Kashmir Life (Dec 2025) quoting the Srinagar ARTO, checked DATE."** Or: "Format not confirmed for your state; practising with 15 questions and a 60% pass mark."
- **Variants:** each concept has 3–6 surface forms (CURRICULUM §2.1); distractors from the same sign family.
- **Confidence** (50/75/100%) asked **before** feedback in practice; in mock, asked once after the exam (stays true to the format).
- **Guided first run** explains each screen of the real flow (device check, tutorial reminder). There is no face-match step (D-07).
- Wrong answers → explanation from the reviewed bank; "Explain my mistake" (F-31 TutorAgent M-04) may only re-phrase reviewed text, never author rules.

### 11.4 Level design
Practice: FSRS-due concepts first, variant chosen to avoid the last 2 surface forms seen. Mock: unseen-variant mix following the rule-pack format. Placement quiz for users who already hold an LL (EC-22).

### 11.5 Controls
Large option buttons (≥ 48 px), confidence chips, next. Voice read-out (optional). Keyboard 1–4.

### 11.6 Telemetry events
`answer{qref, optionId, latencyMs}`, `confidence{qref, p}`, `item_end{reason:"timeout"}`, `item_start/end`.

### 11.7 Deterministic scoring
- **Mock:** `correct ≥ rule_pack.pass` → passed; `pct = correct/total × 100`; timeouts count as wrong. `passRule: {source:"rule_pack", ref:"LLT-<state>"}`.
- **Practice:** no pass; every answer → FSRS evidence (GAMIFICATION_ENGINE §4) and the Brier score.
- **Item pass** (staircase only applies to practice sets): correct and not at 50% confidence.

### 11.8 Difficulty staircase
Not used for variant difficulty in mock (format must stay true). In practice, FSRS decides what's due; the staircase raises distractor similarity (L1 distractors from other families → L5 same family, same shape).

### 11.9 Accessibility
Fully DOM; TalkBack; voice read-out (every user, "practice examiner", `04` §3.8); signs carry alt text that does **not** give away the answer (describes shape and symbol, not meaning).

### 11.10 Anti-cheat
Variants, unseen mix in mocks, timing, no answer keys anywhere (explanations instead).

### 11.11 What the AI debrief receives
`correct`, `total`, `pass_mark`, `format_source` (enum: rule_pack_verified / default_assumption), `wrong_families` (enum list), `weak_topics` (LL1–LL4), `brier`, `wrong_at_100`, `timeouts`, `slow_count`.

### 11.12 May and may not claim
- **May:** "You were fully sure and wrong {{fact:wrong_at_100}}; slow down on cautionary signs", "Practise these sign families next".
- **May not:** "You will pass the real test", quote a format not in the rule pack, invent a rule while explaining.

---

## 12. Cross-game edge cases

| EC | Behaviour |
|---|---|
| EC-05 / P-07 (16–17) | Family mode (D-13 revised): every game and mode as for any user, AI debriefs included; squads, pair mode and share cards need the parent's consent |
| EC-13 disability | §1.3 baseline; deaf users fully served; screen-reader alternatives; colour-vision safe |
| EC-14 shared phone | Games never run under a Helper's session for the applicant; "Clear this device" wipes queues and caches |
| EC-15 clock tampering | Game timing uses relative `performance.now()`/media time; server time for eligibility and FSRS due dates |
| EC-18 buffering, spam taps, screen readers, photosensitivity | full MP4 preload + rVFC; pattern rule; `screen_reader_alt`; ≤ 3 flashes/s |
| EC-19 2G / low-end | Lite mode: LL Sim + SVG decision variants; Phaser never loaded |
| EC-20 PII into AI | commentary transcripts are regex-redacted before any model sees them; the DebriefAgent never sees transcripts, only matched findings (DEBRIEF_SPEC §5) |
| EC-28 Kerala HPT stayed | Kerala mode relabels ("announced format, status: on hold as of DATE" from the rule pack); Nazar continues as training |
| EC-29 AI unavailable | Template "Auto notes" card; nothing in any game depends on live AI |

## 13. Open items

| Item | Owner | Due |
|---|---|---|
| Measure Phaser 4 chunk size and fps on the slowest team phone (fallback Phaser 3.x) | game-core owner | Phase 1 hour 2 |
| Confirm design thresholds by playtest (gap 4.0 s, no-zone polygons, demerit points, d_dip) with 5 players; keep `[D]` labels | Learning & Games lead | Phase 2 |
| Medical reviewer sign-off for G7 | Content lead | 2026-10-24 [unverified who] |
| Verify the uphill-priority rule (MVDR 2017) before the AI may cite it | Content lead | 2026-10-24 |
| Clip `speed_kmh_est` logging during filming (needed for metres) | Nazar owner | filming day |
