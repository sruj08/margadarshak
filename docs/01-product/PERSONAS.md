# Personas
> Project: Margdarshak · Owner: Product lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [PRD](PRD.md) · [USER_JOURNEYS](USER_JOURNEYS.md) · [USER_STORIES](USER_STORIES.md) · [FEATURES](FEATURES.md) · [METRICS](METRICS.md)
> Evidence: [03-user-pain](../../../research/ps1-current-state/03-user-pain.md) (111 linked quotes, cited here as **Q#**) · [05-psychology](../../../research/ps1-deep/05-psychology.md) (insights cited as **Ψ1–Ψ10**, principles as **Π1–Π20**) · [00-JOURNEY-MAP](../../../research/ps1-current-state/00-JOURNEY-MAP.md) · [03-lifecycle](../../../research/ps1-deep/03-lifecycle.md) · [02-rules-process](../../../research/ps1-current-state/02-rules-process.md) · [council directives D-01..D-25](../../../war-room/margdarshak-verification.md)

---

## 0. How to read this file

- The persona IDs **P-01..P-07** are fixed by [PROJECT_BRIEF §4](../00-overview/PROJECT_BRIEF.md). Every user story, feature and metric in this folder points back to one of them.
- Each persona is a **composite**. Names and biographies are illustrative. Every pain, quote and behaviour comes from a cited source. Quotes are verbatim from public posts (Reddit, Play Store, consumer forums), copied from `03-user-pain.md` with their original links. None of the people quoted is the persona.
- Where a claim rests only on corpus signals or council inference, it is tagged **[corpus]** or **[inference]** and listed in §9 as something the field study must test (D-22).
- Amounts are in ₹. Government fees come only from the CMVR r.32 table in [`02-rules-process.md` §7](../../../research/ps1-current-state/02-rules-process.md): **₹700 for one class** (LL ₹150 + LL test ₹50 + driving test ₹300 + DL ₹200) **plus ₹200 for the smart card**. A second class adds about ₹450. In the product these numbers are always computed from `fees.json` and never hard-coded (D-06).
- Under-18 users (P-07) get rules-only features: no AI, no telemetry, no streaks, no squads (D-13).

### 0.1 Persona map

| ID | Persona | Role in the product | Primary stages | Primary features | Device / network | Language |
|---|---|---|---|---|---|---|
| P-01 | **Kabir** (primary) | Applicant, 2W now, car later | S0–S8 | F-02, F-03, F-05, F-20–F-26, F-23 (Nazar), F-13 | Android, ₹10–15k phone, 4G with patchy indoor signal | Hinglish; reads English, prefers Hindi voice |
| P-02 | **Tanvi** | Applicant, migrant case | S1–S7 | F-04 (EC-02, EC-03), F-05, F-07, F-12 (vehicle), F-11 | Android, shared laptop at hostel | Hindi, English; Dogri at home |
| P-03 | **Mohan-ji** | Renewer and re-tester, family member | S9, S1, S6 | F-16, F-17, F-04 (EC-04, EC-16), F-30, F-12 | Entry Android, large font, WhatsApp-heavy | Hindi, Dogri speech |
| P-04 | **Helper** | Fills forms for others | S1–S7 for someone else | F-17, F-05, F-06, F-07, F-54 | Cyber-café desktop or sibling's phone | Hindi, English |
| P-05 | **Driving-school owner** | B2B buyer, trainer | S4–S6F of their students | F-40, F-23, F-28, F-13 | Android + a desktop at the office | Malayalam/Hindi/English (tenant) |
| P-06 | **RTO officer / Transport Commissioner** | Government buyer and operator | Whole funnel, in aggregate | F-41, F-42, F-56, F-58 | Office desktop on NIC/State network | English, Hindi, state language |
| P-07 | **Rahul** (edge) | Minor applicant, ≤50 cc only | S0–S2 (rules-only) | F-02, F-04 (EC-05, EC-17), F-20 static lessons | Parent's phone or own phone | Hindi, English |

### 0.2 What the personas share (the core insight)

> "When I turn 18 and need a licence, help me get it myself, first try, without paying an agent or being humiliated, and come out actually able to read Indian roads, so my family and friends see I'm a grown man who does things right." ([05 §6](../../../research/ps1-deep/05-psychology.md))

- Agents sell **certainty, dignity and time**, not a bribe as such (Ψ1). Agent prices observed in 2024–26: ₹2,000 to ₹20,000 against the government ₹700 + ₹200 card for one class ([03-user-pain, agent price table](../../../research/ps1-current-state/03-user-pain.md)).
- The applicant is **overconfident about the road and terrified of the process** (Ψ2, Ψ6). The product must reverse this: calm about the process, humble about the road (05 §4, "emotional design rule").
- **Points 1, 3, 4, 5, 8 and 9 of what agents do are legitimate needs a product can serve**: right category and form, scrutiny follow-up, slot, test vehicle, fewer RTO visits, migrant mismatches. Points 2, 6 and 7 (proxy LL tests, live track coaching, buying the pass) are the corrupt core, which we refuse ([03-user-pain, "What agents actually do"](../../../research/ps1-current-state/03-user-pain.md)).

---

## P-01 Kabir (primary)

### Snapshot
| Field | Value |
|---|---|
| Age, life stage | 19, B.Tech first year, GCET-type college in Jammu |
| Wants | A motorcycle licence (MCWG) now, a car (LMV-NT) "later, maybe next summer" |
| Household | Father Mohan-ji (P-03) owns a 10-year-old geared bike and a hatchback; mother does not drive |
| Device | Android, ~₹12k, 4 GB RAM, Chrome, 4G that drops to 3G in the hostel; WhatsApp and Instagram all day |
| Language | Hinglish. Reads English menus but thinks in Hindi; types in Roman Hindi |
| Money | Pocket money ~₹3,000/month. An agent outside the RTO quoted him **₹4,000** "with setting" |
| Digital literacy | High for social apps, low for government portals; has never filled a Sarathi form |
| Riding status | Already rides his father's bike to the market without a licence [inference from Ψ-moment 1 "already riding illegally"] |

### Day in the life
- 07:30 wakes, checks the college WhatsApp groups. A senior forwards a YouTube link "Driving licence online in 5 minutes".
- 09:00–16:00 classes. Between lectures he searches "MCWG ya MCWOG" and gets three different answers (Q2, Q5).
- 17:00 rides pillion with a friend to the canteen; two friends compare who passed the RTO test "first time".
- 21:00 opens parivahan.gov.in on his phone, meets the 36-state dropdown and a desktop-only Sarathi page (Sarathi asks for 1366×768, [team report teardown](../../../research/ps1-deep/team-saarthi-report.md)). Gives up and messages the agent's number.

### Goals (ranked)
1. Hold a valid 2W licence before the next semester trip with friends.
2. Pass the driving test **in one attempt, in front of nobody** (Ψ6).
3. Spend as little as possible and avoid a lecture from his father about "agent ke paise".
4. Later, add a car class without repeating the entire mess (03-lifecycle §B: "they go through the LL→DL journey twice").

### Jobs to be done
| Type | Job statement |
|---|---|
| Functional | "When I decide I want a bike licence, tell me exactly which class, which papers, how much and how long, so I don't apply for the wrong thing." |
| Functional | "When I'm waiting 30 days after my learner's licence, give me something useful to do so I'm ready on test day." |
| Emotional | "When I go to the RTO, help me feel I know what's coming, so I'm not scared of being failed or shouted at." |
| Social | "When I pass, let me show my friends I did it myself (Khud), without looking like a goody-goody." |
| Social (avoid) | "If I fail, don't let anyone find out before I have a plan." |

### Pains (with evidence)
| # | Pain | Evidence |
|---|---|---|
| 1 | Doesn't know which class matches his vehicle; peers push the "manly" geared class | "the reason my driving school applied for 2 wheeler with gear was because "i am a guy, and every guy applies for with gear option"" (Q4, [r/pune, Aug 2026](https://www.reddit.com/r/pune/comments/1vpt3r9/driving_test_in_pcmc_next_week/)) |
| 2 | Contradictory online advice | "Different people on Quora and Reddit give different information." (Q5, [r/india, 2022](https://www.reddit.com/r/india/comments/s8q2pr/this_made_my_day_not_a_latest_news_or_big_thing/)) |
| 3 | Quiz apps that don't match the real test | "This app got me failed in the real exam. I was getting 20/20 everytime in this app. But in actual exam i got 11/20." (Q34, [RTO Exam app, 1★](https://play.google.com/store/apps/details?id=com.pavansgroup.rtoexam&reviewId=5b31d01a-e2bc-4e5e-b1ee-56836c46d598)) |
| 4 | Fear of opaque track failure | "they failed me and said "apka time out hogya"" (Q61, [r/delhi, Jul 2026](https://www.reddit.com/r/delhi/comments/1v8ftox/driving_test_failed_now_what_to_do/)) |
| 5 | Repeated failure is common among his peers | "I have given the driving test at Badshahpur RTO three times now and failed all three attempts. […] Every teenager I meet there seems to have a similar story." (Q76, [r/gurgaon, Jun 2026](https://www.reddit.com/r/gurgaon/comments/1ue58bx/bro_it_is_so_difficult_for_a_new_learner_to_pass/)) |
| 6 | The agent ambush at the gate, built on shame | "Rto circle se bahar nikla toh 2 agents bhaag k aaye […] bolte h hass k nahi hua kya? Phir bolta h setting se krvalo […] he said 7000 m krva dunga" (Q102, [r/ahmedabad, Jun 2024](https://www.reddit.com/r/ahmedabad/comments/1d74sv7/ahmedabad_rto_is_worst/)) |
| 7 | Slot scarcity vs LL expiry | "No slot available for 30 days". What do I do? My learner's permit expires in April. Koi jugaad hai?" (Q54, [r/pune, Mar 2026](https://www.reddit.com/r/pune/comments/1rsdnqa/driving_license_test_slot/)) |
| 8 | Wants it all in a short window | "I'm 18 so I wanted to get both my learners licence and the actual driving test within 1 month. Is it possible?" (Q48, [r/Kerala, Oct 2026](https://www.reddit.com/r/Kerala/comments/1x2au12/how_to_get_driving_license_within_1_month/)) |
| 9 | The market price of certainty | ""Bass 2000₹ dedo setting se licence nikal dunga," said the agent outside Pune RTO." (Q93, [r/IndianBikes, Sep 2025](https://www.reddit.com/r/indianbikes/comments/1nqwzh4/the_driving_licence_test_is_a_joke_ft_pune_rto/)) |
| 10 | Riding on an LL without a companion, paying a cop | "Today a traffic police took bribe from me because I was riding scooter on learner's licence without supervision […] we agreed on 500 in cash." (Q47, [r/indiasocial, Nov 2023](https://www.reddit.com/r/indiasocial/comments/17s25lt/help_pls_answer_my_question/)) |

### Psychology (from 05)
- **Ψ2 Overconfidence at peak risk.** Crash/near-crash rates are ~8× higher in the first 3 months of solo driving than on the learner permit ([PMC3088306](https://pmc.ncbi.nlm.nih.gov/articles/PMC3088306)); calibration did not improve over two years after the test ([SWOV](https://swov.nl/nl/publicatie/investigating-calibration-ability-young-novice-drivers-relative-experienced-drivers)). → Calibration is Margdarshak's main safety job (F-21 calibration penalty, Nazar pre-mock prediction).
- **Ψ3 Fear appeals don't work and backfire with him.** Threat appeals raised fear (r = .64) but had no effect on behaviour (r = .03), and young men with high driving self-esteem shown death imagery reported *greater* risk intention ([PMC3656854](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3656854/)). → No gore, no "1.72 lakh died" splash (F-24 "no fear imagery").
- **Ψ4 Friends raise his risk and are his distribution.** → Squads are co-op (F-26), the share card rewards anticipation, never speed.
- **Ψ6 Failing is humiliation.** → Private fail debrief (F-13), no outcome words in notification previews (n8n W10).
- **Ψ9 Hazard-perception training is the evidence-backed bet.** Horswill's online course reduced heavy braking and speeding in an on-road RCT ([SWOV](https://swov.nl/en/publicatie/online-hazard-perception-training-course-reduces-heavy-braking-speeding-and-over-revving)); commentary training lifted novices to experienced-driver detection (Isler 2009). → Nazar (F-23) and record-then-score commentary (F-25, D-12).
- **Ψ10 Gamification: g = .49 cognitive, .25 behavioural** ([Sailer & Homner 2020](https://link.springer.com/article/10.1007/s10648-019-09498-w)). → XP only for learning acts, diminishing after 45 min (F-26).

### Current workarounds
- YouTube and senior advice; the agent at ₹2k–7k; "cyber cafe uncle" who picks a class for him (Q11); RTO exam quiz apps with rote banks (Q34–36).

### What Margdarshak gives him (feature hooks)
| Moment | Feature | Copy example (Hinglish, illustrative) |
|---|---|---|
| Wants to start | F-02 plan in 3 taps; picture "bike with gears" | "Aapka plan: MCWG. Sarkari fees ₹700 + ₹200 card. Sabse jaldi licence: 31 din baad test." (numbers computed) |
| Thinking of car later | F-03 smart class planner | "Bike + car ek hi LL par: agar baad mein alag se karte toh 30 din aur lagte." (claim only per D-09 row 9) |
| 30-day wait | F-23 Nazar, F-24 games, F-26 squads | "Bus 1.4 s late dekhi ≈ 16 m at 40 km/h" (from code) |
| Test day | F-12 co-pilot, track explainer | "Figure-8: foot down = fail. Practice 3 laps." |
| Fails | F-13 private debrief + retest plan | Notification preview: "Aapka agla plan taiyaar hai" (no outcome words) |
| Passes | F-26 Khud Licence badge (self-declared), share card | "Khud Licence: your word, not a government check." |

### What would make him stop using it
1. One wrong fact (fee, step, format) that he discovers at the RTO (05 §3 quit trigger 1).
2. A preachy tone or gore (quit trigger 4).
3. A low score shown to friends without his choice (quit trigger 3).
4. Streak guilt and notification spam (quit trigger 7) → ≤1 nudge/day, quiet hours 22:00–07:00 IST (F-53).
5. Anything that smells like a scam: asking for Aadhaar or OTP, APK links (quit trigger 8) → never (D-07).

### Cheat vectors we design for
Memorising answers (→ variants, F-20), friend plays his sessions (→ share card shows "verified sessions: n", trust score), spam taps (→ pattern-click zero, F-23), false Khud badge (→ honour-framed, "your word"). Source: 05 §3 cheat table.

### Emotional journey (summary; full curve in [USER_JOURNEYS](USER_JOURNEYS.md#p-01-kabir))
Excited (turns 18) → confused (research) → tentative hope (decides Khud) → tech anxiety then relief (LL) → bored and overconfident (30 days) → competence rising (Nazar) → dread (test day) → pride or shame → freedom with friends on the pillion (first 6 months, highest risk).

---

## P-02 Tanvi (migrant case)

### Snapshot
| Field | Value |
|---|---|
| Age, life stage | 19, B.Sc. student in Jammu, hostel |
| Home | Kathua; her Aadhaar address is in Kathua (EC-02) |
| Aadhaar | Shows "C/o" but no "D/o" line (EC-03), matching the journey-test role card "Case X" ([NAZAR-FIELD-KIT §11.1](../../../field-kit/NAZAR-FIELD-KIT.md)) |
| Wants | A scooter licence (MCWOG > 50 cc) to commute to tuition |
| Vehicle | None in Jammu. The family Activa is in Kathua |
| Device | Android phone; a shared hostel laptop for anything "desktop only" |
| Language | Hindi and English; Dogri at home |
| Safety concern | Male examiners and crowded RTO counters [corpus: Herald Goa, Kerala Kaumudi] |

### Day in the life
- Classes until 15:00, tuition at 17:30, auto fare ₹60 each way. A scooter would pay for itself in a few months [inference].
- Weekends home to Kathua twice a month, so an RTO visit has to fit a narrow window.
- She has read that an Aadhaar with a different address sends you to the RTO and stalls scrutiny (Q17), and that the father's-name field can come back blank and uneditable (Q7–Q9).

### Goals
1. Know **before she starts** whether her Aadhaar address will block her and what the fix is.
2. Minimise RTO visits and avoid a long wait in a crowded room.
3. Find a legal vehicle for the test without paying an agent-linked rental.
4. Feel safe and respected on test day.

### Jobs to be done
| Type | Job statement |
|---|---|
| Functional | "When my Aadhaar address isn't where I live, tell me my options and their trade-offs before I waste a fee." |
| Functional | "When I don't own a vehicle, tell me exactly what papers a borrowed scooter needs and who nearby offers one for the test." |
| Emotional | "When I go to the RTO, let me know which counter, what to carry and how long, so I can go in and out." |
| Social | "When I get the licence, let me tell my parents it cost the government fee and nothing else." |

### Pains (with evidence)
| # | Pain | Evidence |
|---|---|---|
| 1 | Address mismatch stalls scrutiny | "My application got stuck during document scrutiny because my Aadhaar had my West Bengal address. I updated my Aadhaar to my Bangalore address, and the application was approved." (Q17, [r/bangalore, Jul 2026](https://www.reddit.com/r/bangalore/comments/1uncsqd/my_driving_licence_journey_in_bangalore_without_a/)) |
| 2 | Missing D/o line forces a visit | "Since my Aadhaar doesn't have the "Daughter/son of…" line explicitly mentioned, he told me ki I'd have to visit the RTO in person." (Q8, [r/mumbai, Jan 2025](https://www.reddit.com/r/mumbai/comments/1hwewu9/applying_for_driving_license/)) |
| 3 | Systemic blank-field glitch | Father's-name field comes back blank and can't be typed in, leaving "thousands of applicants stuck and frustrated" (Q9, [India Herald, 19 Feb 2026](https://www.indiaherald.com/Politics/Read/994879460/-Aadhaar-Update-Stalled-Technical-Glitch-on-the-Sarathi-Portal-Stalls-Thousands-of-Driving-Licence-Applications)) |
| 4 | Migrants are quoted the highest agent prices | "everyone is quoting between 8K to 10K, and some even quoted 12K or 20K" (Aadhaar from another state; Q99, [r/gurgaon, May 2025](https://www.reddit.com/r/gurgaon/comments/1kjapjl/need_help_with_getting_a_driving_license_in/)) |
| 5 | No vehicle for the test | "I am a 21-year-old girl […] they don't provide a scooty there at the RTO. You have to take your own. And renting is very expensive which I cannot afford." (Q67, [r/kolkata, Sep 2026](https://www.reddit.com/r/kolkata/comments/1wevmwl/permanent_driving_licence_test_in_rto/)) |
| 6 | Can't rent without a licence | "Every rental company wants a valid motorcycle license, so I can't rent one to practice." (Q43, [r/IndianBikes, Jul 2025](https://www.reddit.com/r/indianbikes/comments/1lts0zw/how_does_someone_with_no_friends_learn_to_ride_a/)) |
| 7 | Class confusion for scooters | "if I wanted a licence just to drive a scooter or Activa what licence should I get???" (Q2, [r/IndianBikes, May 2025](https://www.reddit.com/r/indianbikes/comments/1kn63lh/can_you_please_clear_this_confusion/)) |
| 8 | Humiliation on test day | "Suddenly the officer starts shouting at me like I committed a crime. […] ended up crying from the sheer embarrassment." (Q71, [r/Kerala, Jul 2025](https://www.reddit.com/r/Kerala/comments/1m23dud/why_are_rto_officers_so_unnecessarily_rude/)) |
| 9 | Women and examiners | NGO complaint: "Male RTO inspectors 'arrogant' towards women applicants" ([Herald Goa](https://www.heraldgoa.in/goa/male-rto-inspectors-arrogant-towards-women-applicants/83330)); an MVI arrested after a woman's complaint ([Kerala Kaumudi](https://keralakaumudi.com/web-news/en/2022/11/NMAN0376446/1.html)) |
| 10 | "Contactless" that isn't | "Application Submitted for Contactless Service. No need to visit RTO office." […] stuck at "SCRUTINY" for 30 days (Q88, [r/pune, Aug 2026](https://www.reddit.com/r/pune/comments/1vn8c2q/driving_license_address_change_in_pune_rto_is_not/)) |

### Psychology
- **Ψ8 Distrust is general; information chaos is the enemy.** Every rule she sees must show `source` + `verified_on` (Π20), and "we don't know for your RTO yet" must be an allowed answer (D-09 §3.3 trust).
- **Ψ1 The system punishes honesty unevenly.** Certainty beats moralising: a blocker list with fixes before payment (F-04) out-competes the ₹8–20k migrant quote.
- **Ψ6 Dignity.** Rights card and calm-down (F-12), grievance routes shown as facts (F-14).

### Current workarounds
- Updating Aadhaar first (weeks), applying in the home district on a weekend, or an agent quote of ₹8–20k (Q99). Borrowing a cousin's scooter without checking RC/insurance/PUC.

### What Margdarshak gives her
| Moment | Feature | Behaviour |
|---|---|---|
| Plan | F-04 EC-02 rule row | "Your Aadhaar district (Kathua) ≠ where you live (Jammu). Options: (a) apply with another address proof → non-Aadhaar path, 1 RTO visit; (b) update Aadhaar first. Source + confidence shown; J&K behaviour 'ask at the counter' until verified." |
| Plan | F-04 EC-03 rule row | "Your Aadhaar has no D/o line. Sarathi may leave the relation field blank. Fix before you pay." |
| Apply | F-05 + F-07 copy-pack | One question per screen; the hand-off copy-pack lists each Sarathi screen with what to pick |
| Bridge | F-12 vehicle checklist + listing | Borrowed vehicle: valid RC, insurance, PUC, L-plate, helmet, owner consent note; seeded school listings labelled "sample" |
| Test | F-11 Live Intel (k ≥ 5) | "Documents asked at ARTO Jammu (n = 7 reports, last 30 days)", no names |

### What would make her stop
- A blocker discovered at the counter that the app didn't flag; any request for her Aadhaar number; a "safe" verdict that turned out wrong; seeing other users' free-text accusations (we don't host them, D-14).

---

## P-03 Mohan-ji (renewal, re-test, family mode)

### Snapshot
| Field | Value |
|---|---|
| Age | 52; Kabir's father (P-01) |
| Licences | Car and 2W DL issued in his 30s; car DL validity lapsed **more than 1 year ago** because he believed in a 30-day grace period (EC-16) |
| Legal reality | No grace period since the 2019 amendment; renewing more than 1 year after expiry means the competence test "shall" be retaken ([03-lifecycle §0](../../../research/ps1-deep/03-lifecycle.md)) |
| Needs | Form 1A medical (age ≥ 40, EC-04); a car re-test; then wants to help Kabir |
| Device | Entry Android, font size large, WhatsApp-first; OTPs arrive late (Q16) |
| Language | Hindi; Dogri speech; reads Devanagari slowly |
| Digital literacy | Low. Uses WhatsApp voice notes; asks his son or the CSC to "do the online" |
| Attitude | "Agent ko de do, jhanjhat khatam" (05 Ψ7, the veto holder) |

### Day in the life
- Shop opens at 09:30, closes at 20:30. An RTO visit costs him a day's sales [inference].
- He hears from a cousin that "the licence can be renewed late with a fine" (the grace-period myth that commercial guides still repeat, 03-lifecycle §0.1).
- He forwards every "challan due" message to Kabir, including a fake one with an APK last year [inference from the Kerala APK cluster, Q-step 16].

### Goals
1. Drive legally again with the fewest visits.
2. Pass the car re-test without the indignity of failing at 52.
3. Not be cheated: no fake challan, no fake app.
4. Make sure his son does it properly and cheaply.

### Jobs to be done
| Type | Job statement |
|---|---|
| Functional | "When my licence has lapsed, tell me in one screen whether I can still renew or must test again, what medical form, and what it costs." |
| Functional | "When a message says I owe a challan, tell me if it's real before I click anything." |
| Emotional | "When I have to take a test at my age, help me practise so I don't fail in front of young people." |
| Social | "When my son applies, let me see the plan and the cost so I can decide whether an agent is worth it." |

### Pains (with evidence)
| # | Pain | Evidence |
|---|---|---|
| 1 | Experienced drivers fail automated tracks | "My father is struggling with drivers licence test even though he has been driving since past 25 years. […] I passed in 2 attempts. My father has given 5." (Q64, [r/delhi, Apr 2025](https://www.reddit.com/r/delhi/comments/1jvaxj7/father_struggling_with_driving_licence_test/)) |
| 2 | Medical form re-upload without reasons | "Eye test certificate & Form 1A was certified by eye specialist himself. But today got information to re upload the documents. Reason not stated." (Q20, [r/Kerala, May 2026](https://www.reddit.com/r/Kerala/comments/1tqx4z5/kerala_driving_licence_renewal_documents_upload/)) |
| 3 | Renewal pushes people to agents | "Simple things like renewing a driver's license or getting a duplicate driver's license is not happening. […] We have to use agents" (Q103, [mParivahan, 2★](https://play.google.com/store/apps/details?id=com.nic.mparivahan&reviewId=0d44363b-c3f7-4d51-bd26-42a3c1111678)) |
| 4 | OTP delays | "the OTP comes very late like That is, for one or two hours" (Q16, [consumercomplaints.in, Jun 2024](https://www.consumercomplaints.in/sarathi-parivahan-otp-late-comming-from-sarathi-e-vahan-portal-c3511110)) |
| 5 | Mobile-number update loops | "it always said Unable to process your request, try after some times. now after several months, result is same." (Q92, [mParivahan, 1★](https://play.google.com/store/apps/details?id=com.nic.mparivahan&reviewId=814dcb6e-46a3-4d52-9c6e-46d1eb105c4a)) |
| 6 | Older users and logins | [mParivahan elderly review](https://play.google.com/store/apps/details?id=com.nic.mparivahan&reviewId=cbf269cd-9bd0-410f-a229-f42407a84e49) (03-user-pain, cross-cutting table) |
| 7 | The ₹5,000 fine for driving without a valid licence | s.181 penalty ₹5,000 ([03-lifecycle §0.6](../../../research/ps1-deep/03-lifecycle.md)); a learner fined ₹5,000 while stuck at "Approval of DL" (Q80) |
| 8 | Fake e-challan APKs | ~570 Kerala cases, up to ₹1.5 lakh lost; genuine challans have 19 digits, the fakes 14 ([Onmanorama](https://onmanorama.com/news/kerala/2025/07/20/kochi-cyber-police-arrests-parivahan-app-scam-varanasi-16-year-old-uttar-pradesh.html), [Boom Live](https://www.boomlive.in/decode/scamcheck/fake-rto-e-challan-message-on-whatsapp-a-growing-apk-scam-29919)) |

### Psychology
- **Ψ7 Family is the financier and reputational audience; the agent is a family decision.** The "Show papa" card (Π6) turns him from veto into sponsor: government fee vs agent quote, the date plan, and the vehicle papers he must hand over (RC, insurance, PUC).
- **Ψ8 Distrust of WhatsApp forwards.** The scam checker (F-33) decides by rules (domain/sender allowlist, APK = never) and never says "safe" (D-19).
- **Π4 Implementation intentions** (d ≈ 0.65): "On ___ at ___ I will go to the doctor for Form 1A."

### Current workarounds
- The CSC operator (P-04) or an agent (₹2,500 renewal "including the bribery", [Play review](https://play.google.com/store/apps/details?id=com.nic.mparivahan&reviewId=4504a05f-97d5-4b54-b113-50a07bdc1468)); Kabir's help on weekends.

### What Margdarshak gives him
| Moment | Feature | Behaviour |
|---|---|---|
| Lapsed DL | F-16 + EC-16 rule row | "Expired 14 months ago → renewal needs the test again (MV Act s.15 as amended 2019). Form 1A needed (age ≥ 40)." Source chip, `verified_on` |
| Voice | F-30 (18+) | "Mere papa 52 saal ke hain, unko car ka licence chahiye" → navigates to the renewal/re-test plan; never submits or pays |
| Practice | F-24 Track Test Twin (layout familiarisation) + F-12 explainer | Labelled "layout familiarisation, not certification" (D-11) |
| Family | F-17 family mode | Kabir manages his father's case; reminders for RC/insurance/PUC dates |
| Scam | F-33 | "Not from an allowlisted sender. Never install APKs. Check on the e-challan site yourself." |

### What would make him stop
- Small text, English-only, OTP-dependent flows; being told something is "official" and then finding it is not; a voice that sounds like it can do things it can't. He leaves after one confusing screen [inference].

---

## P-04 Helper (sibling or cyber-café / CSC operator)

### Snapshot
| Field | Value |
|---|---|
| Illustrative person | **Arjun**, 27, runs a cyber café and CSC counter near an ARTO; or **Priya**, Kabir's 24-year-old cousin who "does the online" for the family |
| Volume | Café: 5–15 transport applications a week [inference]; sibling: 1–3 a year |
| Device | Café desktop shared by many customers (EC-14); sibling's own phone |
| Customers | Elderly, low-literacy, non-English applicants; truck drivers (cf. Jugalbandi's "driving-licence help for truck drivers" user in [G-inspiration-library](../../../research/G-inspiration-library.md)) |
| Legal position | Must not hold customers' Aadhaar numbers, OTPs or passwords; Margdarshak never asks for them (D-07) |

### Goals
1. Finish each customer's application correctly the first time (wrong class = new LL + fees + 30 days).
2. Avoid liability: show customers what was done, get their consent, leave no data behind on the shared PC.
3. Serve more customers per hour.

### Jobs to be done
| Type | Job statement |
|---|---|
| Functional | "When a customer sits down, give me their plan and a copy-pack for the Sarathi screens so I don't pick the wrong class." |
| Functional | "When I'm done, let me wipe everything from this computer in one tap." |
| Emotional | "When a customer asks why it costs what it costs, let me show the government breakdown so they trust me." |
| Social | "Let me be the honest helper in the neighbourhood, not the 'cyber cafe uncle' people warn about." |

### Pains (with evidence)
| # | Pain | Evidence |
|---|---|---|
| 1 | Helpers pick the wrong class and customers find out later | "the middlemen (cyber cafe uncle) applied only for lmv and I noticed it later when I got my learner licence. And when I told him that it is only for car he told me it is used for both car and scooty." (Q11, [r/indiasocial, May 2025](https://www.reddit.com/r/indiasocial/comments/1kg0n3i/help_regarding_driver_license/)) |
| 2 | Frozen fields force people to agents | "a relation name field wasn't getting filled and wasn't editable. No choice, had to take help from agent." (Q7, [r/pune, Aug 2025](https://www.reddit.com/r/pune/comments/1mvgp2c/getting_dl_challenge/)) |
| 3 | Helpers hoarding documents is how fraud happens | "The guy had my PAN, Aadhar, xerox copies, and my signature." (Q107, [r/kolkata, May 2025](https://www.reddit.com/r/kolkata/comments/1ksxv2p/my_experience_at_pvd_for_a_learners_licence/)) |
| 4 | Upload confirmation is unreliable | "after meny time effort I think document uploaded but no confirmation from App side" (Q24, [mParivahan, 1★](https://play.google.com/store/apps/details?id=com.nic.mparivahan&reviewId=56fd9f1b-c2d0-4734-982b-2ccdd9260d09)) |
| 5 | Plugin/"separate system" lock-in | "he says it doesn't work in normal laptops and they use a separate system for it and for which i need to pay." (Q30, [r/bangalore, Jun 2026](https://www.reddit.com/r/bangalore/comments/1tzyerr/learners_licence_on_parivahan_portal_facing_issues/)) |
| 6 | Payment debited but failed | "Amount of rs 400 has been deducted from my account but application is showing status as FAILED" (Q25, [consumercomplaints.in](https://www.consumercomplaints.in/sarathi-parivahan-amount-of-rs-400-has-been-deducted-from-my-account-but-application-is-showing-status-as-failed-c2809667)); 15 of 33 complaints are payment-related |

### What Margdarshak gives the helper
- **Helper link (E-29)** with recorded consent: purpose, scope (which case), duration, revocable; the applicant sees every action in the case history (F-17, US-206).
- **"Clear this device"** and auto-logout on shared computers (EC-14).
- **Copy-pack (F-07 Mode A)** and printable plan card; fee breakdown from `fees.json` to show customers.
- **Revocation** (EC-25): when the applicant revokes consent, the helper's access ends immediately and the helper sees "access ended by applicant".

### What would make the helper stop
- Losing the speed advantage (too many confirmation screens); a tool that tries to do the Sarathi step itself (risk to their CSC standing); data left on the PC.

---

## P-05 Driving-school owner

### Snapshot
| Field | Value |
|---|---|
| Illustrative person | **Sreeja**, 41, owns a two-car, three-scooter school near an RTO in Ernakulam district; a J&K variant is **Gurmeet**, 45, near ARTO Jammu |
| Business | 30–60 students a month [inference]; car courses ~₹4,000–8,000 locally; MSDS benchmark ₹5,500–9,000 + GST ([03-lifecycle §C](../../../research/ps1-deep/03-lifecycle.md)) |
| Regulatory pressure | Kerala's HPT circular of 12 Sep 2026: schools must give **3 months of hazard-perception training using open-source computer-based tools**, and RTO inspections of schools since 1 Oct 2026 ([03-lifecycle §0.5, §C](../../../research/ps1-deep/03-lifecycle.md)) |
| History | Kerala 2024 reform: dashcams, vehicle-age limits, test caps; unions struck 1–15 May 2024; HC refused a stay on 3 May |
| Device | Android + an office desktop; WhatsApp for every student |
| Language | Malayalam/English (Kerala tenant); Hindi/Punjabi/Dogri (J&K tenant) |

### Goals
1. Comply with the HPT mandate cheaply and prove it at inspection.
2. Raise first-attempt pass rates (Kerala fell to 40–45% after the reform, Q-step 11 [r/Kerala link post](https://www.reddit.com/r/Kerala/comments/1fkz1gh/high_driving_test_failure_rate_postreforms_kerala/)), because students blame the school.
3. Fill seats; get leads from people who are already mid-journey.
4. Shed the "agent" reputation.

### Jobs to be done
| Type | Job statement |
|---|---|
| Functional | "When the inspector comes, show hazard-training hours and scores per student, exportable." |
| Functional | "When a student's LL reaches day 30, tell me who is ready to book and who needs more practice." |
| Functional | "When a learner fails, route the remedial-training referral to me (required by the 2019 s.9(5) proviso)." |
| Emotional | "Let me stop chasing students and parents on WhatsApp all day." |
| Social | "Let my ratings reflect real student outcomes, not fake reviews." |

### Pains (with evidence)
| # | Pain | Evidence |
|---|---|---|
| 1 | Schools are seen as agents | "every driving school I've visited says I need to pay the full amount for a "package" (DL lessons + DL fees) with or without training" (Q101, [r/mumbai, Feb 2026](https://www.reddit.com/r/mumbai/comments/1qz4yci/nri_trying_to_get_indian_dl_legally_no_bribes_no/)) |
| 2 | Trust deficit from bad actors | "Wasted 9 months, 10k rupees, got mentally harrassed" (Q106, [r/pune, Jul 2026](https://www.reddit.com/r/pune/comments/1ut06cv/fraud_alert_for_anyone_in_the_viman_nagar_area/)); "plan I took was of 8.5K […] waited but sadly no response" (Q111, [r/bangalore, Sep 2023](https://www.reddit.com/r/bangalore/comments/16n3dv3/driving_school_not_giving_dl_help/)) |
| 3 | Retest extras look like extortion | "I have paid retest fees(300rs) online. But Ashan is asking for extra 1000." (Q75, [r/Kerala, Mar 2025](https://www.reddit.com/r/Kerala/comments/1j5htsx/driving_school_asking_for_1000_for_license_retest/)) |
| 4 | Discrimination narrative | "Other candidates […] (who are from Driving school) were asked to put on belt initially. Felt like discrimination" (Q70, [r/pune, Jan 2024](https://www.reddit.com/r/pune/comments/1973cih/rto_experience/)) |
| 5 | A new mandate without tools | Kerala HPT: 3 months of training with open-source tools; owners' Samithi plans a legal challenge ([03-lifecycle §C](../../../research/ps1-deep/03-lifecycle.md)) |
| 6 | Slot control is contested | Kerala schools reportedly control date allocation (Q56, Q57) |

### What Margdarshak gives the school (F-40)
- Free listing (labelled "Sponsored" if paid, CCPA disguised-ads rule).
- **Pro tier** (price hypothesis ₹499–999/month per school, [unverified], 03-lifecycle §C): learner progress with each learner's consent, **HPT training logs** (Nazar sessions, hours, scores) exportable for RTO inspections, practice sign-off into the learner's Practice Record (attributed field, never "verified"), parent updates, test-vehicle hire listing, remedial-training referrals, lead routing (n8n W7).
- Kerala HPT stay/postponement (EC-28): the school dashboard switches to "practice mode" copy, no compliance claims, and the logs remain exportable.

### What would make the owner stop
- Price above perceived compliance value; any feature that exposes their pass rates publicly without context; leads that turn out to be fake.

---

## P-06 RTO officer / Transport Commissioner

### Snapshot
| Field | Value |
|---|---|
| Illustrative people | **Mr Sharma**, ARTO Jammu (counter, scrutiny, test scheduling); **the Transport Commissioner**, J&K (policy, capacity, PSGA timelines); a **Kerala MVD** joint commissioner (HPT roll-out) |
| Systems | Sarathi (NIC) as system of record; WhatsApp groups and paper registers for the rest [inference, 07 §C2] |
| Pressures | Counter queries; scrutiny backlog; outages (Telangana ~4,000 applications stalled in Jun 2026; AP set up a 24×7 control room in Oct 2026, [team report](../../../research/ps1-deep/team-saarthi-report.md)); public anger over touts; enforcement (Punjab 16 FIRs, Mumbai 76k licences on fake tests) |
| Policy context | J&K CM and Transport Commissioner pushed PSGA timeline enforcement for DL issuance in 2025 ([Kashmir Reader](https://kashmirreader.com/2025/08/01/transport-commissioner-for-strict-enforcement-of-rules-regulations/)); the DL day-limit under J&K PSGA is **unknown** ([ps1-product-lock Part C](../../../war-room/ps1-product-lock.md)). MoRTH stopped Vahan/Sarathi data sharing with private entities from 1 Oct 2026 per NIC's RTI reply ([IFF](https://internetfreedom.in/who-reads-your-vehicle-record-nic-gave-us-numbers-morth-gave-us-a-generic-webpage/)) |

### Goals
1. Fewer counter queries and repeat visits; fewer re-tests clogging slots.
2. See **where applications stall** and **why people fail** per RTO, in aggregate, to add capacity or change a rule.
3. Adopt something that is auditable, hostable on NIC/MeitY cloud, and never asks for data MoRTH has just stopped sharing (R.S. Sharma seat, verification §3.1).
4. Reduce the tout economy visibly.

### Jobs to be done
| Type | Job statement |
|---|---|
| Functional | "Which cases are stuck and why, today?" (07 §C4) |
| Functional | "Where should I add capacity or change a rule?" (07 §C4) |
| Functional | "When the state changes a fee or format, publish it once with maker-checker and have every citizen screen update." (F-42) |
| Emotional | "Let me adopt this without risking an audit failure or a privacy scandal." |
| Social | "Let my office be the one that made licences agent-free." |

### Pains (with evidence)
| # | Pain | Evidence |
|---|---|---|
| 1 | Scrutiny backlogs generate escalations | "the application got stuck at the scrutiny stage for more than 3 weeks. […] I filed a complaint on the Karnataka IPGRS portal […] resolved within 24 hours." (Q89, [r/bangalore, Jun 2026](https://www.reddit.com/r/bangalore/comments/1u8zni3/ipgrs_karnataka_got_my_dl_address_change_unstuck/)) |
| 2 | Staff absence becomes the story | "status is showing as "pending from the RTO side" […] the officer is not available" (Q83, [r/mumbai, 21 Oct 2026](https://www.reddit.com/r/mumbai/comments/1xbdu3m/advice_on_driving_license/)) |
| 3 | Proctoring is gamed anyway | ~560 online LL exams from 10 fixed-IP PCs, 12–3 am ([Navbharat Live](https://navbharatlive.com/maharashtra/mumbai/massive-fraud-in-online-learning-license-system-1404320.html)) |
| 4 | Outages | Sarathi glitch stalled ~4,000 applications in Telangana ([Deccan Chronicle](https://www.deccanchronicle.com/amp/southern-states/telangana/sarathi-portal-glitch-stalls-rto-services-in-telangana-1963794)) |
| 5 | Capacity caps | Kerala: rolling 40-day windows, cap of 40 tests per MVI (Q55–Q57; 03-lifecycle §C) |
| 6 | Data integrity incidents | Odisha STA: name, father's name and address altered after the online test ([OdishaBytes](https://odishabytes.com/odisha-sta-files-cybercrime-complaints-over-fake-e-challans-data-tampering/amp/)) |

### What Margdarshak gives government (F-41, F-42, F-56, F-58)
- **State / RTO console** (aggregated, anonymised; k ≥ 5 suppression): stall points by stage, fail reasons per RTO (from user-entered fail codes and Live Intel), demand forecast from active cases at S3–S5, slot utilisation (once SlotAdapter is real), query deflection.
- **Rule-pack studio**: versioned rule packs with source, date, confidence, approver; maker-checker; public changelog.
- **Adapter spec**: OpenAPI for SarathiAdapter, DigiLockerAdapter, AadhaarOfflineAdapter, BhashiniAdapter, PaymentAdapter, NotificationAdapter, SlotAdapter, with mock and real implementations passing the same contract tests (F-56).
- **Deployment**: containerised, Apache-2.0, deployable on NIC or a MeitY-empanelled Indian cloud; audit-ready pack (never "STQC-certified", D-19).

### What would make them stop
- Any claim of integration they didn't authorise; naming individual examiners; data leaving India in production; a vendor-locked SaaS canvas holding business logic (hence n8n stays at the messaging edge, D-16).

---

## P-07 Rahul (edge: minor)

### Snapshot
| Field | Value |
|---|---|
| Age | 17, Class 12, Jammu |
| Wants | To ride the family scooter (an Activa, > 50 cc) to coaching |
| Legal reality | At 16–17 only **MCWOG ≤ 50 cc with guardian consent** ([02-rules-process l.30](../../../research/ps1-current-state/02-rules-process.md)); most scooters exceed 50 cc (EC-05). If a minor commits an MV Act offence, the guardian or owner is deemed guilty (up to 3 years and ₹25,000), registration is cancelled for 12 months, and the juvenile cannot get an LL/DL until 25 (s.199A, [03-lifecycle §0.4](../../../research/ps1-deep/03-lifecycle.md)) |
| Product rules | Rules-only, account-less features: plan card, checklist, static lessons. **No AI, no telemetry, no streaks, no squads, no WhatsApp marketing** (D-13, G7) |
| Device | Own phone or parent's |

### Pains (with evidence)
| # | Pain | Evidence |
|---|---|---|
| 1 | Age rule changes discovered at the counter | "I'm 17 and I put all this effort into scanning all the documents […] for the guy to tell me "No we changed the age to 18". It isn't written ANYWHERE that they had changed the rule." (Q1, [r/india, 2018](https://www.reddit.com/r/india/comments/8owbam/you_do_not_get_a_gearless_two_wheeler_licence_at/)) |
| 2 | The ≤50 cc confusion | "the motor without gear is for vehicles which are under 50cc that is just electrical vehicle and not available for mopeds such as Activa or Jupiter" (Q2) |
| 3 | Scale of under-18 harm | 9,489 under-18 deaths in 2023 (10,117 in 2024); 33,827 accidents with no licence ([02-accident-curriculum M20](../../../research/ps1-deep/02-accident-curriculum.md)) |

### Jobs to be done
- "When I want to ride, tell me honestly what I'm allowed to ride at 17 and what happens to my parents if I ride anything else." (functional + social)
- "Let me prepare for my 18th birthday so I can apply on day one." (functional)

### What Margdarshak gives him
- A plan card stating the ≤50 cc limit in plain words ("most scooters, including yours, are above 50 cc"), the guardian-consent requirement, and a "your 18th-birthday plan" date computed from DOB.
- Static road-safety lessons (no FSRS history stored server-side, no telemetry).
- A **parent card** with the s.199A facts, framed without shaming (EC-17, D-20 #17).
- Debriefs, if any, are the offline template only (US-103); voice guide hidden.

### What would make him stop
- Being lectured; being asked for a parent's documents he can't get; a "you can't use this" wall. The product shows what he *can* do.

---

## 8. Anti-personas (who we do not design for)
| Anti-persona | Why not |
|---|---|
| Someone seeking a licence without a test, or a proxy for the online LL test | The corrupt core (agent points 2, 6, 7). We never help; we still offer the hazard plan "because the road doesn't check your licence" (05 cheat table) |
| Bulk agents running many applications | Helper mode caps active helper links per helper account [design default, unverified threshold: 10 active links; owner: Product lead; decide by 2026-10-24] and every action is visible to the applicant |
| Anyone wanting slot-booking bots or Sarathi scraping | Forbidden (IT Act s.43; D-08) |
| Under-18 users wanting AI features | Gemini terms require 18+; D-13 |

---

## 9. Assumptions to validate in the field (D-22)

| # | Assumption | Persona | How we test it | Owner | Due |
|---|---|---|---|---|---|
| A1 | Seeing the plan card lowers "would still pay an agent" | P-01, P-02 | Journey test J4 (pre/post McNemar) | Field lead (C) | Sat 24 Oct 2026, 18:00 data freeze |
| A2 | The licence as a rite of passage drives shame after failure | P-01 | 3 Mom-Test interviews ([field kit §6](../../../field-kit/NAZAR-FIELD-KIT.md)) | Field lead (C) | 2026-10-24 |
| A3 | Parents are the veto holder on agent use | P-03 | Ask in journey-test exit: "Who would decide on the agent?" | Field lead (C) | 2026-10-24 |
| A4 | ≥ 30% of licence holders score < 60/100 on Kerala-format clips | P-01 | Nazar study H1 (n ≥ 40) | Nazar lead (B) | 2026-10-24 |
| A5 | LL-quiz scores don't predict hazard scores (|r| < 0.3) | P-01 | Nazar study H2 | Nazar lead (B) | 2026-10-24 |
| A6 | Schools in Kerala will pay ₹499–999/month for HPT logs | P-05 | 5 phone interviews with Kerala schools after the event | Product lead | 2026-11-15 |
| A7 | RTO staff value stall-point views over a public leaderboard | P-06 | One forward-deployed week at ARTO Jammu (07 §C2) | Product lead | Phase 3 (Dec 2026) |

---

## 10. Sources
All quotes: [`research/ps1-current-state/03-user-pain.md`](../../../research/ps1-current-state/03-user-pain.md) (pulled 2026-10-22; links inline). Psychology: [`research/ps1-deep/05-psychology.md`](../../../research/ps1-deep/05-psychology.md) (sources inline, [V]/[K] tags there). Rules and fees: [`02-rules-process.md`](../../../research/ps1-current-state/02-rules-process.md) §2, §7. Lifecycle, schools, s.199A, renewal: [`03-lifecycle.md`](../../../research/ps1-deep/03-lifecycle.md). Government context: [`07-govt-plug-and-play.md`](../../../research/ps1-deep/07-govt-plug-and-play.md), [`margdarshak-verification.md`](../../../war-room/margdarshak-verification.md).
