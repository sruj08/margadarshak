> **SUPERSEDED:** the current field-study protocol is `margdarshak/docs/08-project/FIELD_STUDY.md` (rewritten recruitment text, consent, 3-form design, HYPOTHESES template, DEC-017: 5-band primary score + linear rule as a pre-registered sensitivity analysis). Keep this file only for history.

# Nazar — Field Validation Kit (ready to run)
Goal: by Sat 24 Oct 18:00 IST, have **one number produced by real people using the live build**, collected ethically and pre-registered, the way Vakyam was validated with a real ALS patient.
Headline slide: **"X% of N licence holders would fail Kerala's new hazard test (60/100); their licence-quiz scores didn't predict it (r = Y)."**

---

## 0. Tonight (Thu 22 Oct), before anything else, 30 minutes
1. **Recruit.** Send the teaser (§1) to 3–5 college WhatsApp groups and to 10 friends who each forward it. Ask people to reply "IN".
2. **Line up raters.** Two teammates or friends will independently mark hazard windows on Friday.
3. **Line up filming.** Two passengers (never the rider) and two routes in Jammu: a junction near a bus stop, a market road, a school gate, a wrong-side two-wheeler hotspot. Charge phones; find a dashboard mount or a clip-on holder.
4. **Pre-register.** Commit `HYPOTHESES.md` (§3) to the public repo *after the hackathon starts* (00:00 Fri), before any taker data exists. The commit hash goes on the slide footnote.
5. **Confirm the deadline** in the HackCache WhatsApp group (the guide says Sat 23:59 IST; the API says Sun 21:30).

## 1. Recruitment messages (copy-paste)
**English:**
> 🚦 3-minute challenge for anyone with a driving licence or learner's licence (18+). Kerala is bringing in a *hazard perception test* for licences from December: you watch road clips and tap when you see danger. We built a practice version with real Jammu road clips for a hackathon. Can you beat 60/100? No name, no number, fully anonymous. Link drops Friday 7 pm, reply IN 👇

**Hindi:**
> 🚦 Driving licence ya learner licence hai (18+)? Sirf 3 minute ka challenge. Kerala December se licence ke liye *hazard perception test* la raha hai: road ki video dekho aur khatra dikhte hi tap karo. Humne hackathon ke liye Jammu ki asli sadkon par iska practice version banaya hai. Kya aap 60/100 cross kar paoge? Naam ya number nahi chahiye, poora anonymous. Link Friday shaam 7 baje, reply karo IN 👇

**Score-card share (auto-generated, n8n → WhatsApp):**
> I saw the bus 1.2 s late (≈ 13 m at 40 km/h) on Nazar. Practice score 58/100 in Kerala's announced format. Can you beat me? <link>

## 2. Consent screen (in the app, before anything else)
> **Nazar is a practice tool and a student research project for HackCache '26.**
> - You must be 18 or older.
> - We store only: an anonymous ID, age band, licence type, years driving/riding, your quiz and clip scores, and your tap times.
> - We do **not** collect your name, phone number, licence number, face or location.
> - The clips show public roads; faces and number plates are blurred.
> - Results are for practice only. They say nothing about whether you are a safe driver, and this is **not** affiliated with any Motor Vehicles Department.
> - You can delete your data at any time with your anonymous ID.
> [ I am 18+ and agree ] [ No thanks ]

## 3. HYPOTHESES.md (pre-registration, commit before any data)
```
# Nazar — pre-registered hypotheses (committed <timestamp>, before any participant data)
Scoring rule: each clip has one hazard window [onset, onset+W] set independently by two raters; final onset = mean of the two raters' onsets;
UK-style 5-band scoring (as in Margdarshak F-23 / docs/09-learning-games/NAZAR.md): the scoring window from onset to window end is split into 5 equal bands scoring 5,4,3,2,1 (scaled to 10 marks per clip in Kerala-format mode); taps before onset or after the window score 0; pattern/rhythmic clicking voids the clip (score 0). Anticipation taps are logged separately.
Clips: 10 scored test clips + 5 fresh post-feedback clips, fixed order per form A/B (counterbalanced).
H1: ≥ 30% of licence holders score < 60/100.
H2: correlation between the 15-question LL-mock score and the Nazar score is weak (|r| < 0.3).
H3: on 5 fresh clips after feedback, the mean per-clip score improves (paired, one-sided).
H4: inter-rater agreement: median |Δonset| ≤ 0.5 s.
Exclusions: sessions < 60 s total, or > 3 taps per second (spam); declared under 18.
Analysis: analysis/nazar_stats.mjs, unchanged after data collection except bug fixes noted in the commit log.
```

## 4. Filming checklist (Fri 06:00–10:00)
- [ ] Rider never touches the phone; a passenger films, or the phone is mounted. Obey all traffic rules, helmets on.
- [ ] Landscape, 30 fps, 1080p; lens at windscreen/handlebar height; no zoom.
- [ ] Capture 60 raw minutes → cut to about 20 clips of 20–60 s, each with one *developing* hazard (a bus pulling out, a door opening, a pedestrian stepping off a median, a wrong-side 2W, a child near a school gate).
- [ ] Include 2–3 "no-hazard / ambiguous" clips to measure over-tapping.
- [ ] Log the route, time and approximate speed per clip (speed lets you convert seconds late into metres).
- [ ] Blur faces and plates (Render Workflow) before *anything* is published; delete raw footage after the blur check.

## 5. Session protocol (online taker flow, ~4 min)
1. Consent → 2. Age band / licence type (LL, 2W, 4W, both) / years driving → 3. **15-question LL mock** (a real-format question set) → 4. **10 hazard clips** (Kerala format, scored /100) → 5. **Feedback replay** on 2 clips: "hazard began 0:04.2, you tapped 0:05.6 → 1.4 s late ≈ 16 m at 40 km/h" → 6. **5 fresh clips** (learning effect) → 7. Score card + share → 8. Optional one-line answer to "Has a near-miss ever happened to you? What happened?" (no names).
**In person (Sat, 3–5 people on campus):** sit beside them, ask them to think aloud, and record **audio-only or faceless** 10-second reactions with consent, for the video.

## 6. Mom-Test interviews (3 people, 10 minutes each, Fri/Sat)
Talk about their life, not our idea:
- "Tell me about the last time you got your licence. What did the test actually check?"
- "Tell me about the last time something on the road surprised you. What happened, and when did you notice it?"
- "Has anyone ever taught you *where to look*? Who, and how?"
- For learners, after the test: "What would you do differently tomorrow?"
Write down exact words. Use 2 quotes on the slide.

## 7. Data freeze and analysis (Sat 18:00)
Run `node analysis/nazar_stats.mjs sessions.csv raters.csv` (script in `field-kit/nazar_stats.mjs`). It prints:
- N (after exclusions), % < 60/100 with a 95% CI (Wilson)
- r(LL mock, Nazar) with a 95% CI (Fisher z)
- median seconds late, converted to metres at the logged speed
- paired pre/post gain on matched clip difficulty, with a one-sided Wilcoxon p
- inter-rater median |Δonset|; test-retest r if ≥ 8 retakes

**Honesty footnote (on the slide):** "Convenience sample of N, 18+, Jammu/Punjab colleges; our clips and windows, pre-registered at <hash>; not Kerala's official clips; no crash outcomes measured. HPT–crash link: Horswill et al. 2015, doi:10.1016/j.aap.2015.05.019."

## 8. Ethics and legal guardrails
- 18+ only; anonymous IDs; no PII; delete on request. DPDP: there is no identifiable personal data in the taker DB, and bystanders are blurred before publication.
- Filming public roads from a vehicle is normal dashcam practice. Never film while riding; never publish unblurred faces or plates.
- No "unsafe driver" wording. "Practice score", not "verdict".
- Say "Kerala's announced format", never "official Kerala test". Not affiliated with any MVD.

## 9. Backup trigger
If fewer than 12 usable blurred clips exist by **Fri 12:00**, Nazar shrinks to 6 clips (score scaled to /100) and the **journey test (§11) carries the evidence**. The product stays Margdarshak (PS1). §10 (Ruko + Kasauti) is kept only as an archived alternative from the earlier council round.

## 10. Backup kit — Ruko + Kasauti (PS3)
- **Who:** 6–8 grandparent + adult-child pairs (team families; the GCET staff network). The elder is 60+.
- **Protocol:** (a) baseline: the elder sends ₹1 to a test payee on their *own* bank app while being timed, counting errors; (b) on Ruko (simulated money), a staged "digital arrest" script asks the elder to transfer ₹60,000; the hold triggers, and the child gets an n8n WhatsApp "Approve / Stop"; (c) measure the child's real response time, whether the elder's scam-refusal changed, and a 5-question SUS.
- **Slide:** "N/N transfers were stopped; the median family response was M minutes; SUS 78 vs 52 on their own bank app."
- **Ethics:** simulated money only; never ask for real PINs/OTPs; debrief every elder that the scam was staged; consent from both.

---

## 11. Journey test (Margdarshak, the product Nazar lives inside), in person, Fri pilot + Sat sessions
Goal: the **second number** on the evidence slide. 5–8 first-time or prospective applicants do the Learner's Licence (LL) application on **Sarathi's real step sequence** (lab replica built from `research/ps1-current-state/01-sarathi-screens.md`, §A.1–A.2) and on **Margdarshak**. Same people, counterbalanced. Spec: `war-room/ps1-product-lock.md` §14.
Headline: **"k₁/N → k₂/N got the LL application fully right; median X → Y min; 'would still pay an agent' p/N → q/N."**

### 11.1 Setup (build by Fri 18:00, pilot Fri 19:00–21:00)
- **Laptop A:** `/lab/sarathi-sequence`, a replica of the observed Aadhaar path. It reproduces these screens: A1–A2 instructions; A3 category / "holds none" / country of birth / RTO-camp / captcha; A4–A5 authentication with a simulated OTP card shown after 10 s; A6 form body (incl. class of vehicle with Sarathi's codes MCWG/MCWOG/LMV-NT, no plain names); A8 application number; A9–A10 upload with re-entry of app no. + DOB + captcha (lengths 10/16 as observed); A12 fee shown only after "Click Here to Calculate Fee"; A13 verify pay.
  - It must be **unbranded**: no emblem, no NIC/Parivahan logo.
  - Red banner: "Research replica of public Sarathi screens. Not a government site." `noindex`.
  - The official FAQ PDFs (`raw/pdf/FAQ_0–3.pdf`) are open in a tab, and Google is allowed (as in real life).
- **Phone B:** Margdarshak: case → pre-flight → reimagined 6-screen application.
- **Both log automatically:** start/end time, screen count, back-navigations, validation errors and selections. The observer also notes help requests on paper.
- **Two role cards (synthetic identities only, printed):**
  - **Case X, "Tanvi":** 19, rides the family Activa (no gears); Aadhaar address Kathua, lives in Jammu; Aadhaar shows "C/o" but no "D/o" line; Aadhaar number `0000 0000 0001` (fake, replica accepts it).
    Correct outcome: class **MCWOG**; flags the address mismatch and chooses an office knowingly; flags the relation-name risk before submitting.
  - **Case Y, "Rajinder":** 42, wants a car licence, also owns a geared bike he won't test on; Aadhaar address current.
    Correct outcome: class **LMV-NT** only; **Form 1A** (age over 40) identified before submitting.
- **Counterbalancing (4 cells, rotate):** A-first + X/Y · A-first + Y/X · B-first + X/Y · B-first + Y/X.

### 11.2 Recruitment text (copy-paste)
**English:**
> 🪪 Never applied for a driving licence? Need 35 minutes of your time (Sat, GCET campus) for a student research project for HackCache '26. You'll try applying for a *practice* learner's licence two ways, using a made-up identity (no real Aadhaar, phone or personal details). Tea + ₹100 recharge as thanks. 18+ only. Reply "LICENCE" with a time slot: 10:00 / 11:00 / 12:00 / 14:00.

**Hindi:**
> 🪪 Kabhi driving licence ke liye apply nahi kiya? Shanivaar ko GCET campus mein 35 minute chahiye, HackCache '26 ke student research project ke liye. Aap ek *practice* learner's licence do tareekon se apply karke dekhenge, nakli pehchaan ke saath (asli Aadhaar, phone ya personal details nahi). Shukriya mein chai + ₹100 recharge. Sirf 18+. "LICENCE" likh kar time batayein: 10 / 11 / 12 / 2 baje.

Aim for 2 people who live away from their Aadhaar district, and 1–2 non-students with lower digital comfort (with consent). Over-recruit to 10 for no-shows.

### 11.3 Consent (read aloud, then sign)
> This is a student research project for HackCache '26, not a government service. You will try two practice versions of a learner's-licence application using a **made-up identity** we give you. Please do **not** type any real Aadhaar, phone number, OTP or password. We record your time, clicks and answers to a short questionnaire under a participant code (P01…). We do not record your face. With your permission we may record **audio only** of one sentence of feedback for our video; you can say no and still take part. You can stop at any time without giving a reason, and ask us to delete your data. We are testing the software, not you. There are no wrong answers.
> ☐ I am 18 or older and agree to take part. ☐ (optional) I agree to an audio-only quote being used in the video.
> Signature / initials ______ Date ______ Participant code ______

### 11.4 Task script (≈35 min per person)
1. **Pre-questions (2 min):** age band; ever applied? (none / via agent / self); "If you needed a licence next month, would you pay an agent? Max ₹?"; confidence 1–5 "I know every step until I hold the licence".
2. **Task 0, real site (≤5 min, timed):** "On parivahan.gov.in, find the page where someone in J&K would start a new learner's licence application." Stop at the "New LL Stage Details" page (OBS A2); no data entry. Record time and the number of wrong clicks. Cap at 5 min.
3. **Condition 1 (≤12 min cap):** "Using this role card, apply for the learner's licence this person needs. Tell me if anything would stop the application." Think aloud. The observer never helps unless asked; each request is logged as **H** and answered only with "what would you do at home?" (second request: show the FAQ tab).
4. **Post-condition 1 (3 min):**
   - SUS (10 items, 5-point, EN/HI printed).
   - "What's the earliest date this person can take the driving test, and when does the LL expire?" (correct = day 31 after LL issue and about 6 months).
   - "Would this person need any extra document or fix before applying?"
5. **Condition 2:** the same with the other role card on the other system.
6. **Post-condition 2:** the same as step 4.
7. **Exit (3 min):** "Now, would you pay an agent? Max ₹?"; "Which one would you use, and why?" (exact words); optional audio-only quote.
8. Debrief: explain the replica and that Margdarshak is a prototype; thank; recharge.

### 11.5 Data sheet (one row per participant × condition; `journey_sessions.csv`)
`pid, cell, order(1|2), system(sarathi_lab|khud), case(X|Y), t0_real_site_s, t0_wrong_clicks, start_ts, end_ts, time_s, completed(0/1), class_correct(0/1), path_correct(0/1), blockers_found(0–2), blockers_planted(2), full_success(0/1), errors_validation, backtracks, screens_visited, help_requests, sus_1..sus_10, sus_score, date_q_correct(0/1), extra_doc_q_correct(0/1), pre_agent_yn, pre_agent_max_inr, post_agent_yn, post_agent_max_inr, preferred(A|B), quote_text, audio_consent(0/1), observer, notes`

**full_success** = completed AND class_correct AND path_correct AND all planted blockers identified **before** submit.

### 11.6 Pre-registered hypotheses (add to HYPOTHESES.md in the same commit as H1–H4)
```
J1: median time_s for B is at least 40% lower than for A (paired, Wilcoxon signed-rank, one-sided).
J2: full_success count B > A (exact McNemar, one-sided); prediction B >= 6/8, A <= 3/8.
J3: mean SUS B >= 75 and A <= 55 (benchmark 68); paired difference reported with 95% CI (t).
J4: number answering "would still pay an agent" falls from pre to post (McNemar), and median max-INR falls.
Exclusions: participant reveals real personal data (stop, delete, exclude); system crash > 60 s (rerun once, flag).
Small n: report every participant's row, medians, CIs; no claims beyond "in this sample".
```

### 11.7 Metrics and analysis (Sat 18:00 freeze)
- Per system: median time and IQR; full_success k/N (Wilson 95% CI); mean blockers found out of 2; errors and backtracks; help requests; SUS mean with 95% CI (SUS score = ((sum of odd items − 5) + (25 − sum of even items)) × 2.5); date-question accuracy.
- Paired: time difference (Wilcoxon), success (exact McNemar), SUS difference (paired t with CI), agent intent pre→post (McNemar) and median max-₹.
- Order effect check: compare A-first vs B-first gains. With n ≤ 8, just show it.
- Task 0: median real-site time to find the J&K LL start page. It is a real-site number; say so.
- **Slide line:** "k₁/N → k₂/N got it fully right · median X → Y min · SUS a → b (68 = average, MeasuringU) · would still pay an agent p/N → q/N."
- **Footnote:** "N first-time applicants, Jammu, convenience sample; lab replica of Sarathi screens observed 22 Oct 2026 (unbranded); synthetic identities; pre-registered at <hash>."

### 11.8 Ethics and guardrails
- 18+ only. Synthetic identities only; stop the session if anyone starts typing real data.
- No faces; audio quotes only with separate consent; data under participant codes and deletable on request.
- The replica is never deployed at a public, indexable URL and never presented as the official site. In the video, label it "lab replica".
- Thank-you recharge is the same for everyone and not tied to performance.
- Report the result whichever way it comes out. If A beats B on anything, it goes on the slide too.
- **Friday field question while recruiting (ARTO Jammu counter, 10 min):** track type for 2W/4W at Jammu; whether an Aadhaar address in another district blocks applying at Jammu; the PSGA day-limit for DL issue, if notified. These answers go into `rules/JK.json` with source "asked at counter, <date>".
