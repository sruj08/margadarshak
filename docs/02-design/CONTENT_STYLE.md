# Content Style
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Content lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [Design system](DESIGN_SYSTEM.md) · [Accessibility](ACCESSIBILITY.md) · [Localization](LOCALIZATION.md) (glossary §10) · [UI spec](UI_SPEC.md) · [Prompts](../04-ai/PROMPTS.md) · [Privacy](../06-security-compliance/PRIVACY.md) · [Compliance](../06-security-compliance/COMPLIANCE.md)
> Inputs: `research/ps1-deep/05-psychology.md` (the evidence for every tone rule here), `06-design-language.md` §B12, `war-room/margdarshak-verification.md` D-01, D-05, D-06, D-09, D-10, D-13, D-14, D-19.
> **Hindi strings in this file are drafts.** Every one needs native review (LOCALIZATION §11) before it ships [reviewer: Hindi native speaker on the team; due 2026-10-24].

---

## 0. The job of our words
The young applicant is **overconfident about the road and terrified of the process** (`05` §0). Agents sell him **certainty, dignity and time**. Our words have two jobs:
1. **Move the fear away from the process.** Be specific, predictable and calm, so doing it yourself ("Khud") feels doable.
2. **Make him humble about the road without preaching.** Use honest feedback and calibration, never lectures or scare tactics.

**The emotional design rule:** lower fear of the *process*; raise humility about the *road*. Today the system does the reverse (`05` §4).

| | Hackathon build (Phase 1–2) | Production (Phase 3+) |
|---|---|---|
| Copy | EN + HI for the three deep slices, all states in this library, the footer, consent and AI texts | Every screen; per-state rule-pack copy; quarterly review with real user quotes |
| Review | Content lead + Hindi native reviewer; copy lint in CI | + legal review of consent and notices; state reviewers for tenant copy |

---

## 1. Voice: who Margdarshak is

**Margdarshak is a calm guide.** Think of an elder cousin who has been through the RTO, knows the rules cold, and wants you to manage without paying anyone. It is not a government officer, a coach shouting drills, a traffic cop or a nervous parent.

| Margdarshak is | Margdarshak is not | Sounds like | Never sounds like |
|---|---|---|---|
| **Calm** | Alarmed | "Your LL expires in 9 days. Book your test today to keep your application." | "URGENT!!! Your licence will be CANCELLED" |
| **Certain where it can be** | Vague | "You'll visit the RTO at most twice." | "You may need to visit the RTO a few times." |
| **Honest where it can't be** | Falsely confident | "We don't know yet how {rto_name} runs its track. Here's what other RTOs check." | "Here's exactly what they'll ask." |
| **Brief** | Wordy | One idea per sentence; one action per screen | Three paragraphs before a button |
| **Respectful (आप)** | Babying or bossy | "You can do this yourself." | "Safety first, beta!" / "Do it now." |
| **On his side** | Moralising | "Agents quote ₹2,000–20,000 for this. The government fee for your case is {fee_total}." | "Paying agents is corruption." |
| **Warm, low-key** | Hype | "Nice. You spotted that bus early." | "AMAZING!!! You're a LEGEND 🔥🔥" |
| **Face-saving** | Shaming | "Not this time. Here's your plan." | "You FAILED." |

**Identity framing** (`05` principle 14): we address him as someone who *sees the road early*. Use "Nazar wala" (the one with the eye) and "Khud" (did it myself). Status comes from anticipation and restraint, never speed.

---

## 2. Tone map (moment × feeling × tone)
| Stage | What he feels (`05` §4) | Tone | Do | Avoid |
|---|---|---|---|---|
| S0 Home | Excited, impatient; distrustful ("is this legit?") | Clear, grounded | Say what we are and are not, show the fee and one next step | Big promises, "official", hype |
| S1 Plan | Confused, then relieved | Precise, reassuring | Exact steps, dates, ₹ (computed), documents, max visits | Hedging without a reason |
| S2 Apply | Tech anxiety | Patient, step by step | "Why we ask", autosave reassurance, Check answers | Jargon, ALL CAPS warnings |
| S3 LL test | Rote confidence | Encouraging + honest | "You were sure and wrong 2 times": calibration, not scolding | "Easy!", "You'll definitely pass" |
| S4 30-day bridge | Bored; tempted to ride solo | Light, curious, game-like | Short sessions, novelty, squads | Guilt, nagging, streak threats |
| S5 Book test | Impatient, worried about slots | Practical | Honest scope: "We can't book for you; we'll remind you" | Fake scarcity |
| S6 Test day | Dread, fear of shame | Steady, quiet | Checklist, calm-down, "show at counter" | Jokes, pressure, "Good luck!!!" overload |
| S6F Fail | Shame, anger, agent temptation | Private, kind, practical | A plan before he leaves the ground; normalise without fake stats | Red, "FAILED", pity, blame |
| S7 Issued | Pride, relief | Warm, brief celebration | "Khud kiya": he did it himself | Over-the-top confetti text |
| S8 New-rider year | Freedom, peak overconfidence | Respectful peer | Opt-in refreshers, pillion pledge, phone-free riding | Death statistics, gore, "you would crash" |
| S9 Renew/fix | Routine, sometimes panic (expired) | Matter-of-fact | Dates, consequences, the path | Blame |
| Golden hour | Shock | Direct, imperative, minimal | Short numbered steps, the 112 button | Long text, hedging, AI |

---

## 3. Writing rules

### 3.1 English
1. **Plain language.** Aim for an 8th-grade reading level (Flesch-Kincaid ≤ 8 on running text; checked with a readability linter in CI for `en.json` paragraphs ≥ 20 words).
2. **Sentences ≤ 20 words; ≤ 12 on buttons, banners and toasts.** One idea per sentence.
3. **Front-load the point.** "Book your test by 10 Feb" before the reason.
4. **Use "you" and "we".** We never refer to the user in the third person.
5. **Use active verbs on buttons, 1–3 words:** "Start my plan", "Continue", "Book test", "Fill it". Never "Submit", "Proceed" or "Click here".
6. **Numbers are digits, money is ₹,** and dates follow LOCALIZATION §7. **Every number is a placeholder** filled by code (`{fee_total}`), never typed into copy (D-06, D-10).
7. **Spelling:** Indian English, "licence" (noun), "practise" (verb), "practice" (noun), "programme". Product names: Margdarshak, Nazar, Readiness Score, Practice Record, Khud Licence.
8. **Abbreviations** are spelled out on first use per screen: "learner's licence (LL)", "Regional Transport Office (RTO)".
9. **No exclamation marks** except in celebrations (at most one).
10. **Emoji:** none in the product UI. WhatsApp templates may use ✅ and 📅 (at most one per message).
11. **Errors** say what happened and how to fix it, never blame ("Enter your date of birth", not "Invalid input").
12. **Links** say where they go.

### 3.2 Hindi
1. **आप**, always; warm but not formal. Prefer verb forms like "करें" or "कर सकते हैं".
2. **Everyday Hindi with real loanwords** (लाइसेंस, टेस्ट, स्लॉट, फ़ीस). No Sanskritised coinages unless Sarathi uses them, and then with the common word beside them (LOCALIZATION §9.1).
3. Nukta where standard (फ़ीस, फ़ॉर्म, ज़रूरी).
4. **Gender-neutral constructions** where possible. If grammar forces gender and the user has chosen a form in Settings, use it; otherwise use the plural-respect form ("आप तैयार हैं").
5. Same placeholder variables as English. Word order may change; variables never get split.
6. Don't translate legal codes (MCWG, LMV-NT, CMVR r.32, s.134A).
7. Romanised Hinglish appears only in voice prompt chips, labelled as examples of what to say.

### 3.3 Structure of a screen's copy
`h1` (the question or the stage) → one-line hint → the control(s) → "Why we ask" (optional) → one primary action → (optional) one secondary action. At most **one** banner per screen, unless an error summary is also needed.

---

## 4. Psychology rules (evidence from `05`; each one is lint-checked or review-checked)
| # | Rule | Why | Enforcement |
|---|---|---|---|
| R1 | **No fear appeals.** No death counts on learner screens, no gore, no crash imagery, no "you could die" | Threat appeals raised fear (r = .64) with no effect on driving (r = .03); death imagery increased risk intentions in young men with high driving self-esteem (`05` §1.3) | Copy lint word list (§8.3); illustration checklist (DESIGN_SYSTEM §7.7) |
| R2 | **Statistics only as evidence, never as a scare.** MoRTH numbers (e.g. 1,72,890 deaths in 2023) may appear on the "Why Nazar" evidence page, the pitch and the government console, with a source. They never appear in a nudge, a fail screen or a game | Same | Lint: stat keys allowed only in the `evidence` namespace |
| R3 | **Urgency only when it is real.** Only real deadlines (LL expiry, retest gap, renewal) may use time pressure, and they always state the date and consequence | CCPA Dark Patterns Guidelines 2023 ban false urgency (`05` principle 3) | Components: only `CaseClock` may say "days left" |
| R4 | **Social proof only when measured.** "X people at your RTO did it khud" only from real self-reports with n ≥ 5 in 30 days (D-14 k-threshold); before that, real stories with consent | Faked norms backfire (`05` §1.5); Goldstein et al. 2008 | Placeholder `{khud_count}` requires `{k_ok}=true` |
| R5 | **Face-saving by default.** Results, fails and scores are private; sharing is opt-in | Failing feels like humiliation, and agents exploit that at the gate (`05` §1.6, Q102) | No share prompt on fail screens |
| R6 | **Autonomy, not obedience.** Show the agent option with its real cost; never confirm-shame ("No thanks, I like paying agents" is banned) | SDT; CCPA confirm-shaming ban (`05` principles 15, 20) | Lint |
| R7 | **Calibration over praise.** Feedback names the gap between confidence and accuracy, privately and without lecturing | Overconfidence is the core risk (`05` §1.2) | Debrief templates |
| R8 | **Rewards are for learning acts**, never for opening the app; no cash or redeemable prizes | Deci, Koestner & Ryan 1999; Online Gaming Act 2025 (D-11) | Gamification spec |
| R9 | **Streaks are weekly, repairable and silent on break**, phrased as a refill | Silverman & Barasch 2023 (`05` principle 16) | Streak copy (§5.15) |
| R10 | **At most 1 nudge a day, tied to a real deadline or a chosen plan** | `05` §3 quit trigger 7 | n8n rate limit (D-16) |
| R11 | **Honest scope** in every AI and hand-off moment: "We can't book, pay or submit" | Quit trigger 2: he blames us for system failures (`05` §3) | AIDisclosure component |
| R12 | **Never moralise about his own risk; talk about other people's safety** (pillion, pedestrians) when a "why" is needed | Mill's harm principle framing (`05` §5.1); reactance (quit trigger 4) | Review |
| R13 | **Don't shame the agent user.** "If you used help, here's the 30-day hazard plan anyway, because the road doesn't check your licence." | `05` §3 cheat vectors | Review |

---

## 5. Microcopy library
Each string has an ID (MC-xxx), and its key in `messages/{locale}.json` mirrors the namespace. `{…}` are ICU variables filled by code.

### 5.1 Identity, trust, non-affiliation (D-01, D-05, D-06)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-001 | Footer (every page) | Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State Transport Department. Uses simulated government data. | टीम चाणक्य का स्वतंत्र प्रोटोटाइप। MoRTH, NIC या किसी भी राज्य परिवहन विभाग से संबद्ध नहीं। इसमें सरकारी डेटा सिमुलेशन (नकली) है। |
| MC-002 | First-launch disclaimer (sheet, one button) | **Before you start.** Margdarshak is an independent guide, not a government app. We help you plan and practise. Payments, Aadhaar checks and submissions happen only on Sarathi, the government portal. We will never ask for your Aadhaar number or OTP. | **शुरू करने से पहले।** मार्गदर्शक एक स्वतंत्र गाइड है, सरकारी ऐप नहीं। हम योजना बनाने और अभ्यास में मदद करते हैं। पेमेंट, आधार जाँच और आवेदन जमा करना सिर्फ़ सरकारी पोर्टल सारथी पर होता है। हम कभी आपका आधार नंबर या OTP नहीं माँगेंगे। |
| MC-003 | Disclaimer button | Got it | समझ गया / समझ गई (gendered: use the neutral "ठीक है" if gender unknown) |
| MC-004 | Simulated chip | Simulated | सिमुलेशन |
| MC-005 | Simulated tooltip | Simulated: in production this step runs on Sarathi. | सिमुलेशन: असली सेवा में यह कदम सारथी पर होता है। |
| MC-006 | Sample data chip (Live Intel, D-14) | Sample data | नमूना डेटा |
| MC-007 | Source chip | Source: {source} · checked {date, date, short} | स्रोत: {source} · जाँचा {date, date, short} |
| MC-008 | Unknown rule | We don't have a checked rule for {state} yet. Please confirm at your RTO. | {state} के लिए हमारे पास अभी जाँचा हुआ नियम नहीं है। कृपया अपने आरटीओ से पक्का करें। |
| MC-009 | Domain trust line (share cards, WhatsApp) | Shared from {domain}. We never send apps (APK files) or ask for OTPs. | {domain} से साझा किया गया। हम कभी ऐप (APK फ़ाइल) नहीं भेजते और OTP नहीं माँगते। |
| MC-010 | Home trust line (D-05) | Govt fee for one vehicle class: {fee_one_class, number, inr} + {fee_card, number, inr} card (your state may add a service charge). Never pay agents. | एक वाहन श्रेणी की सरकारी फ़ीस: {fee_one_class, number, inr} + {fee_card, number, inr} कार्ड (आपका राज्य सेवा शुल्क जोड़ सकता है)। एजेंट को पैसे न दें। |

> MC-010 values come from `fees.json` (CMVR r.32): currently ₹700 + ₹200. They are **never typed** into the message file (D-06).

### 5.2 Home (S0, F-01)
| ID | Element | EN | HI (draft) |
|---|---|---|---|
| MC-020 | Language screen title | Choose your language | अपनी भाषा चुनें |
| MC-021 | Language screen hint | You can change this any time in Settings. | इसे आप कभी भी सेटिंग्स में बदल सकते हैं। |
| MC-022 | Headline (new user) | Your licence, step by step. Without an agent. | आपका लाइसेंस, कदम-दर-कदम। बिना एजेंट के। |
| MC-023 | Tile 1 | Get my first licence | मेरा पहला लाइसेंस बनवाएँ |
| MC-024 | Tile 2 | Practise for the test | टेस्ट की तैयारी करें |
| MC-025 | Tile 3 | Renew or fix my licence | लाइसेंस रिन्यू या ठीक करें |
| MC-026 | Tile 4 | Check my application | मेरा आवेदन देखें |
| MC-027 | Mic hint | Or just tell us | या बस बोलकर बताइए |
| MC-028 | All services | All services, by who you are | सभी सेवाएँ, आप कौन हैं उसके हिसाब से |
| MC-029 | Stage headline (LL day {n}) | Day {day} of your learner's licence. Driving test opens on {unlock_date, date, long}. | आपके लर्नर लाइसेंस का दिन {day}। ड्राइविंग टेस्ट {unlock_date, date, long} से बुक कर सकते हैं। |

> "Get my first licence" uses "first" to mean the user's own first licence, which is allowed. D-19 bans "first" only as a first-ever/novelty claim.

### 5.3 Licence plan card (S1, F-02, F-03)
| ID | Element | EN | HI (draft) |
|---|---|---|---|
| MC-040 | Q1 | How old are you? | आपकी उम्र कितनी है? |
| MC-041 | Q1 why | Your age decides which licences you can get. We don't store it unless you save your plan. | आपकी उम्र तय करती है कि आप कौन-से लाइसेंस ले सकते हैं। जब तक आप योजना सेव न करें, हम इसे नहीं रखते। |
| MC-042 | Q2 | What will you drive? | आप क्या चलाएँगे? |
| MC-043 | Q2 hint | Pick all that apply. You can apply for more than one together. | जो भी लागू हों, सब चुनें। आप एक साथ एक से ज़्यादा के लिए आवेदन कर सकते हैं। |
| MC-044 | Q3 | Which state do you live in? | आप किस राज्य में रहते हैं? |
| MC-045 | Card title | Your licence plan | आपकी लाइसेंस योजना |
| MC-046 | Classes row | You can apply for: {class_list} | आप इनके लिए आवेदन कर सकते हैं: {class_list} |
| MC-047 | Steps row | {steps, plural, one {# step} other {# steps}} · at most {max_visits, plural, one {# RTO visit} other {# RTO visits}} | {steps} कदम · ज़्यादा से ज़्यादा {max_visits} बार आरटीओ जाना |
| MC-048 | Earliest date | Earliest licence date if all goes to plan: {earliest_date, date, long} | सब ठीक रहा तो सबसे जल्दी लाइसेंस: {earliest_date, date, long} |
| MC-049 | Fee total | Government fees for your plan: {fee_total, number, inr} | आपकी योजना की सरकारी फ़ीस: {fee_total, number, inr} |
| MC-050 | Fee caveat | Your state may add a service charge. Pay only on Sarathi or your state's payment page. | आपका राज्य सेवा शुल्क जोड़ सकता है। पेमेंट सिर्फ़ सारथी या आपके राज्य के पेमेंट पेज पर करें। |
| MC-051 | Agent comparison (R6) | Agents near you may quote {agent_low, number, inr}–{agent_high, number, inr}. Your call: the steps above are everything they do. | आपके आसपास एजेंट {agent_low, number, inr}–{agent_high, number, inr} माँग सकते हैं। फ़ैसला आपका: ऊपर के कदम वही हैं जो वे करते हैं। |
| MC-052 | Class planner saving (D-09 row 9) | Applying for {class_a} and {class_b} together saves a second learner's licence and another 30-day wait, compared with doing them one after the other. Fees are still per class. | {class_a} और {class_b} के लिए एक साथ आवेदन करने से, एक-एक करके करने की तुलना में, दूसरा लर्नर लाइसेंस और 30 दिन का एक और इंतज़ार बचता है। फ़ीस हर श्रेणी की अलग लगती है। |
| MC-053 | Send to WhatsApp | Send plan to WhatsApp | योजना WhatsApp पर भेजें |
| MC-054 | Show papa card title | For your family: the plan in 3 lines | परिवार के लिए: योजना 3 लाइनों में |
| MC-055 | Show papa body | Govt fee {fee_total, number, inr}, not an agent's price. · Test by {test_date, date, long}. · On test day bring the vehicle's RC, insurance and PUC. | सरकारी फ़ीस {fee_total, number, inr}, एजेंट की क़ीमत नहीं। · टेस्ट {test_date, date, long} तक। · टेस्ट वाले दिन गाड़ी की RC, बीमा और PUC साथ लाएँ। |
| MC-056 | Content state for other classes (D-05) | Plan, fees and documents are ready for {class}. Learning content for this class is coming. Please confirm details at your RTO. | {class} के लिए योजना, फ़ीस और दस्तावेज़ तैयार हैं। इस श्रेणी की पढ़ाई की सामग्री जल्द आएगी। कृपया अपने आरटीओ से पक्का करें। |

### 5.4 Blockers (F-04; EC rows)
Pattern: **Title** (what) · **Fix** (what to do) · source chip · confidence.

| ID | EC | EN | HI (draft) |
|---|---|---|---|
| MC-060 | EC-01 | **Your Aadhaar shows only the year you were born.** Sarathi may read your birthday as 1 January. Keep another proof of age ready, such as your Class 10 certificate or passport. | **आपके आधार पर सिर्फ़ जन्म का साल है।** सारथी आपकी जन्म तिथि 1 जनवरी मान सकता है। उम्र का दूसरा प्रमाण तैयार रखें, जैसे 10वीं का सर्टिफ़िकेट या पासपोर्ट। |
| MC-061 | EC-02 | **You live somewhere other than your Aadhaar address.** You can apply with another proof of address from where you live now. This path may need one RTO visit. | **आप आधार वाले पते से अलग जगह रहते हैं।** आप अभी जहाँ रहते हैं, वहाँ के दूसरे पते के प्रमाण से आवेदन कर सकते हैं। इसमें एक बार आरटीओ जाना पड़ सकता है। |
| MC-062 | EC-03 | **The "son/daughter of" line on your Aadhaar is blank.** Sarathi may not let you add it. Here's what RTOs usually accept. | **आपके आधार पर "पुत्र/पुत्री" वाली लाइन खाली है।** सारथी शायद इसे जोड़ने न दे। आरटीओ आमतौर पर यह मानते हैं। |
| MC-063 | EC-04 | **You turn 40 on {date, date, long}.** From then you'll need a medical certificate (Form 1A). Applying before that date avoids it. | **आप {date, date, long} को 40 साल के होंगे।** उसके बाद मेडिकल सर्टिफ़िकेट (फ़ॉर्म 1A) लगेगा। उस तारीख़ से पहले आवेदन करने पर यह नहीं लगेगा। |
| MC-064 | EC-05 | **At {age} you can get a licence only for a moped up to 50 cc, with your guardian's consent.** Most scooters are bigger than 50 cc. | **{age} साल की उम्र में आप सिर्फ़ 50 cc तक के मोपेड का लाइसेंस ले सकते हैं, अभिभावक की सहमति के साथ।** ज़्यादातर स्कूटर 50 cc से बड़े होते हैं। |
| MC-065 | EC-06 | **Transport (commercial) licences start at age 20.** You can plan for a private licence now. | **परिवहन (कमर्शियल) लाइसेंस 20 साल की उम्र से मिलता है।** अभी आप निजी लाइसेंस की योजना बना सकते हैं। |
| MC-066 | EC-10 | **{state} doesn't offer the LL test online right now.** You'll take it at the RTO. We've added that visit to your plan. | **{state} में अभी LL टेस्ट ऑनलाइन नहीं होता।** आप इसे आरटीओ में देंगे। हमने यह विज़िट आपकी योजना में जोड़ दी है। |
| MC-067 | EC-12 | **Moving to another state?** Your plan follows the rules of the state where you'll apply. Change state | **दूसरे राज्य जा रहे हैं?** आपकी योजना उस राज्य के नियमों से बनेगी जहाँ आप आवेदन करेंगे। राज्य बदलें |
| MC-068 | EC-13 | **Have a disability or need an adapted vehicle?** You can get a licence. See what to bring and what the RTO must provide. | **कोई विकलांगता है या बदली हुई (एडैप्टेड) गाड़ी चाहिए?** आप लाइसेंस ले सकते हैं। देखें क्या लाना है और आरटीओ को क्या देना चाहिए। |
| MC-069 | Confidence | High confidence · Medium confidence · Verify at your RTO | पक्की जानकारी · मध्यम भरोसा · आरटीओ से पक्का करें |

### 5.5 Guided LL application (S2, F-05, F-06)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-080 | Why we ask (toggle) | Why we ask | हम यह क्यों पूछते हैं |
| MC-081 | Autosave | Saved. You can stop and continue on any device. | सेव हो गया। आप रुककर किसी भी डिवाइस पर आगे बढ़ सकते हैं। |
| MC-082 | Resume | Welcome back. You were on: {step_name}. | फिर से स्वागत है। आप यहाँ थे: {step_name}। |
| MC-083 | DOB reuse (3.3.7) | We'll use the date of birth you gave earlier: {dob, date, long}. Change | हम पहले दी गई जन्म तिथि इस्तेमाल करेंगे: {dob, date, long}। बदलें |
| MC-084 | Photo tip (dark) | Your face is too dark. Stand facing a window. | आपका चेहरा बहुत अंधेरे में है। खिड़की की तरफ़ मुँह करके खड़े हों। |
| MC-085 | Photo tip (size) | Done. Your photo is now the size Sarathi accepts ({kb} KB). | हो गया। आपकी फ़ोटो अब सारथी के लायक साइज़ ({kb} KB) में है। |
| MC-086 | Photo privacy | Your photo is fixed on your phone. It isn't uploaded to us. | आपकी फ़ोटो आपके फ़ोन पर ही ठीक होती है। यह हमारे पास अपलोड नहीं होती। |
| MC-087 | Check answers title | Check your answers | अपने जवाब जाँच लें |
| MC-088 | Check answers banner | Change anything you need now. After you pay on Sarathi, you can't edit your application. | जो बदलना है, अभी बदल लें। सारथी पर पेमेंट के बाद आप आवेदन नहीं बदल सकते। |
| MC-089 | Change link (SR context) | Change <hidden>{field_name}</hidden> | बदलें <hidden>{field_name}</hidden> |
| MC-090 | Primary | Continue to Sarathi | सारथी पर आगे बढ़ें |

### 5.6 Sarathi hand-off (F-07, D-07)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-100 | Hand-off title | Next: finish on Sarathi | अगला कदम: सारथी पर पूरा करें |
| MC-101 | What happens there | On Sarathi you'll verify Aadhaar, get OTPs and pay. Margdarshak never sees your Aadhaar number or OTP. | सारथी पर आप आधार जाँच करेंगे, OTP पाएँगे और पेमेंट करेंगे। मार्गदर्शक कभी आपका आधार नंबर या OTP नहीं देखता। |
| MC-102 | Copy-pack | Your answers, ready to copy. Tap a line to copy it. | आपके जवाब, कॉपी करने के लिए तैयार। कॉपी करने के लिए लाइन पर टैप करें। |
| MC-103 | Copied toast | Copied: {field_name} | कॉपी हुआ: {field_name} |
| MC-104 | Captcha warning | Sarathi will show captchas and may time out. If it does, come back here: your answers are saved. | सारथी पर कैप्चा आएँगे और सेशन ख़त्म हो सकता है। ऐसा हो तो यहाँ लौट आएँ: आपके जवाब सेव हैं। |
| MC-105 | After hand-off | Done on Sarathi? Tell us what happened so we can plan your next step. | सारथी पर हो गया? बताइए क्या हुआ, ताकि हम अगला कदम तय करें। |

### 5.7 Payment pending (EC-09)
| ID | EN | HI (draft) |
|---|---|---|
| MC-110 | **Payment received by your bank, waiting for Sarathi.** Don't pay again: paying twice won't speed it up. Don't cancel either: cancelling can forfeit the fee. | **आपके बैंक से पेमेंट हो गया है, सारथी की पुष्टि बाकी है।** दोबारा पेमेंट न करें: इससे जल्दी नहीं होगा। रद्द भी न करें: रद्द करने पर फ़ीस डूब सकती है। |
| MC-111 | We'll check again at {next_check, time}. If it's still pending after {pending_limit_hours} hours, here's who to contact and what to say. | हम {next_check, time} पर फिर जाँचेंगे। {pending_limit_hours} घंटे बाद भी पेंडिंग रहे, तो किससे और क्या कहना है, यह यहाँ है। |
| MC-112 | Keep this: your transaction reference {txn_ref}. | इसे संभालकर रखें: आपका ट्रांज़ैक्शन रेफ़रेंस {txn_ref}। |

> **Change from 06:** 06 §B12 said "usually under 2 hours". That figure is unsourced, so `{pending_limit_hours}` comes from the state rule pack with a source, or the sentence is omitted.

### 5.8 Outages, offline, errors (EC-11, EC-19)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-120 | Sarathi down | Sarathi isn't responding right now. Your answers are saved here. We'll tell you when it's back. | सारथी अभी जवाब नहीं दे रहा। आपके जवाब यहाँ सेव हैं। ठीक होते ही हम बताएँगे। |
| MC-121 | Offline | You're offline. Mock tests and saved lessons still work. | आप ऑफ़लाइन हैं। मॉक टेस्ट और सेव किए पाठ अब भी चलेंगे। |
| MC-122 | Back online | You're back online. Syncing your progress. | आप फिर ऑनलाइन हैं। आपकी प्रगति सिंक हो रही है। |
| MC-123 | Error summary title | There's a problem | एक दिक्कत है |
| MC-124 | DOB error | Enter a date of birth in the past, like 14 08 2007. | पिछली कोई जन्म तिथि लिखें, जैसे 14 08 2007। |
| MC-125 | Generic error | Something went wrong on our side. Your answers are saved. Try again. | हमारी तरफ़ से कुछ गड़बड़ हुई। आपके जवाब सेव हैं। फिर कोशिश करें। |
| MC-126 | 404 | We can't find that page. Go to your home screen. | यह पेज नहीं मिला। अपनी होम स्क्रीन पर जाएँ। |
| MC-127 | Device clock (EC-15) | Times here come from our server, so they stay correct even if your phone's clock is off. | यहाँ का समय हमारे सर्वर से आता है, इसलिए फ़ोन की घड़ी ग़लत हो तब भी सही रहता है। |
| MC-128 | Rule changed (EC-27) | A rule for {state} changed on {date, date, long}. We've updated your plan: {change_summary}. | {state} का एक नियम {date, date, long} को बदला। हमने आपकी योजना अपडेट कर दी है: {change_summary}। |
| MC-129 | Kerala HPT status (EC-28) | Kerala's hazard test: {hpt_status}. Checked {date, date, short}. Nazar practice helps either way. | केरल का ख़तरा पहचान टेस्ट: {hpt_status}। जाँचा {date, date, short}। नज़र अभ्यास हर हाल में काम आता है। |

### 5.9 Case clock and slots (F-09, F-10, EC-07, EC-23)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-140 | Day-30 unlock | Your driving test can be booked from today. | आज से आप ड्राइविंग टेस्ट बुक कर सकते हैं। |
| MC-141 | LL expiry, caution (8–30 days) | Your learner's licence expires on {expiry, date, long}. Book your test by {book_by, date, long} to keep your application. | आपका लर्नर लाइसेंस {expiry, date, long} को समाप्त होगा। आवेदन बनाए रखने के लिए {book_by, date, long} तक टेस्ट बुक करें। |
| MC-142 | LL expiry, critical (≤ 7 days; red allowed) | {days, plural, one {# day} other {# days}} left on your learner's licence. If it expires, you'll need a new application and {renew_cost, number, inr}. Book your test now. | आपके लर्नर लाइसेंस के {days} दिन बाकी हैं। समाप्त होने पर नया आवेदन और {renew_cost, number, inr} लगेगा। अभी टेस्ट बुक करें। |
| MC-143 | Slot honesty | We can't book for you. We'll tell you when an earlier slot shows up. | हम आपके लिए बुक नहीं कर सकते। पहले का स्लॉट दिखते ही हम बताएँगे। |
| MC-144 | Notify me | Notify me about earlier slots | पहले के स्लॉट के बारे में बताएँ |
| MC-145 | Passed, no SMS (EC-23) | Passed but no message after {days} days? That happens. Here's how to check your status and who to ask. | पास हो गए पर {days} दिन बाद भी मैसेज नहीं आया? ऐसा होता है। स्टेटस कैसे देखें और किससे पूछें, यह यहाँ है। |

### 5.10 Learn, LL simulator, readiness (F-20..F-22)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-150 | Nothing due | All caught up. Your next review opens tomorrow. | सब हो गया। अगला रिवीज़न कल खुलेगा। |
| MC-151 | Confidence prompt | How sure are you? | आप कितने पक्के हैं? |
| MC-152 | Calibration line | When you were 100% sure, you were right {pct}% of the time. | जब आप 100% पक्के थे, तब {pct}% बार सही थे। |
| MC-153 | Readiness formula | {score} = knowledge {knowledge} − calibration {penalty} | {score} = ज्ञान {knowledge} − कैलिब्रेशन {penalty} |
| MC-154 | Readiness 85 (advisory) | You look ready. Book your test when it suits you. | आप तैयार लगते हैं। जब ठीक लगे, टेस्ट बुक करें। |
| MC-155 | Book anyway (always visible) | Book anyway | फिर भी बुक करें |
| MC-156 | Simulator mode choice | Practice (no timer) · Real format ({count} questions, {minutes} min, pass {pass_mark}) | अभ्यास (बिना टाइमर) · असली फ़ॉर्मैट ({count} सवाल, {minutes} मिनट, पास {pass_mark}) |
| MC-157 | Wrong answer | Not quite. {explanation} | पूरी तरह सही नहीं। {explanation} |
| MC-158 | Simulator debrief | You missed {n} sign questions. Practise these 3. | आपसे {n} संकेत वाले सवाल छूटे। ये 3 अभ्यास करें। |

### 5.11 Nazar and games (F-23..F-25)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-170 | Nazar intro | Watch real Indian roads. Tap the moment you see a hazard starting. Early and right beats fast. | असली भारतीय सड़कें देखें। जैसे ही कोई ख़तरा शुरू होता दिखे, टैप करें। तेज़ होने से ज़्यादा ज़रूरी है जल्दी और सही पहचानना। |
| MC-171 | Label (D-11) | Practice and familiarisation, not certification. | अभ्यास और परिचय के लिए, प्रमाणपत्र नहीं। |
| MC-172 | Photosensitivity note | Short road videos. No flashing lights. Tell us if anything bothers you. | छोटे सड़क वीडियो। कोई चमकती रोशनी नहीं। कुछ परेशान करे तो बताएँ। |
| MC-173 | Spam-tap void | Too many taps in a row, so this clip doesn't count. Tap once when you see the hazard. | लगातार बहुत ज़्यादा टैप, इसलिए यह क्लिप नहीं गिनी गई। ख़तरा दिखे तो एक बार टैप करें। |
| MC-174 | Early hit | Spotted {early_s, number, seconds1} s early. | {early_s, number, seconds1} सेकंड पहले पहचाना। |
| MC-175 | Late hit | You spotted it {late_s, number, seconds1} s late. At {speed} km/h that's about {metres} m. | आपने इसे {late_s, number, seconds1} सेकंड देर से पहचाना। {speed} km/h पर यह लगभग {metres} मीटर है। |
| MC-176 | Missed | This one slipped past. Watch again: look at {cue}. | यह छूट गया। फिर देखें: {cue} पर ध्यान दें। |
| MC-177 | Set summary | Nazar Score {score}/100. You were sure and wrong {n, plural, one {# time} other {# times}}. | नज़र स्कोर {score}/100। आप {n} बार पक्के थे पर ग़लत थे। |
| MC-178 | Share card line | Rewards anticipation, not speed. | रफ़्तार नहीं, पहले से पहचानने का इनाम। |
| MC-179 | SR alternative label | This is a different skill from the timed clip test. Your score here isn't a Nazar Score. | यह टाइम वाले क्लिप टेस्ट से अलग कौशल है। यहाँ का स्कोर नज़र स्कोर नहीं है। |
| MC-180 | Debrief headings | How you did · Where it slipped · What you could do · Your next drill | आपने कैसा किया · कहाँ चूके · क्या कर सकते थे · आपका अगला अभ्यास |

> MC-175's numbers (`late_s`, `speed`, `metres`) come from the scoring engine. The AI only places the finding ID (D-09; `08` l.652 template). The AI's glue text has no digits.

### 5.12 Fail and recover, face-saving (S6F, F-13, EC-08)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-190 | Title (private, no red) | Not this time. | इस बार नहीं। |
| MC-191 | Normalise (no invented stats) | Many people need more than one try. What matters is the next one, and you already know more than last time. | कई लोगों को एक से ज़्यादा बार कोशिश करनी पड़ती है। ज़रूरी अगली कोशिश है, और आप पिछली बार से ज़्यादा जानते हैं। |
| MC-192 | Local fact (only when k ≥ 5) | At {rto_name}, {share}% of reported attempts this month didn't pass on the day. | {rto_name} में इस महीने बताए गए {share}% प्रयास उस दिन पास नहीं हुए। |
| MC-193 | Plan ready | Your retest plan is ready. Earliest retest: {retest_date, date, long}. | आपकी दोबारा टेस्ट की योजना तैयार है। सबसे जल्दी दोबारा टेस्ट: {retest_date, date, long}। |
| MC-194 | What to tell us | What did the examiner mark? Pick any that fit. It stays private. | परीक्षक ने क्या नोट किया? जो सही लगे, चुनें। यह निजी रहेगा। |
| MC-195 | Remedial (EC-08) | After {fails} attempts, your state asks for remedial training before the next test. Here are training centres near you. | {fails} प्रयासों के बाद आपका राज्य अगले टेस्ट से पहले सुधार प्रशिक्षण माँगता है। आपके पास के प्रशिक्षण केंद्र ये हैं। |
| MC-196 | LL expiry check | Your learner's licence is valid until {expiry, date, long}, so there's time for {retests} more {retests, plural, one {try} other {tries}}. | आपका लर्नर लाइसेंस {expiry, date, long} तक मान्य है, इसलिए {retests} और कोशिशों का समय है। |
| MC-197 | Agent at the gate (`05` Q102) | If someone at the gate offers a "setting", you don't need it. Your plan is here, and your fee is still {fee_retest, number, inr}. | अगर गेट पर कोई "सेटिंग" का ऑफ़र दे, तो आपको उसकी ज़रूरत नहीं। आपकी योजना यहाँ है, और आपकी फ़ीस अब भी {fee_retest, number, inr} है। |
| MC-198 | Test record (RTI template, D-14) | Want to know exactly what was marked? Here's an RTI application you can send to your RTO. It costs {rti_fee, number, inr}, and they must reply within 30 days. | जानना है कि ठीक-ठीक क्या नोट हुआ? यहाँ एक RTI आवेदन है जो आप अपने आरटीओ को भेज सकते हैं। इसकी फ़ीस {rti_fee, number, inr} है, और 30 दिन में जवाब देना होता है। |
| MC-199 | Buttons | See my plan · Practise the weak part | मेरी योजना देखें · कमज़ोर हिस्से का अभ्यास करें |

> **Change from 06:** 06 §B12 said "Most people pass on the 2nd try". That is unsourced, so it is banned unless measured (R4). MC-191 replaces it.

### 5.13 Licence issued (S7, F-14)
| ID | EN | HI (draft) |
|---|---|---|
| MC-210 | Your licence is approved. Khud kiya: you did it yourself. | आपका लाइसेंस मंज़ूर हो गया। ख़ुद किया: आपने यह ख़ुद किया। |
| MC-211 | Your card is on its way. You can also see your licence in DigiLocker. | आपका कार्ड रास्ते में है। आप अपना लाइसेंस DigiLocker में भी देख सकते हैं। |
| MC-212 | Did it without an agent? Add the Khud Licence badge. It's your word, so it shows as self-declared. | बिना एजेंट के किया? ख़ुद लाइसेंस बैज जोड़ें। यह आपकी अपनी घोषणा है, इसलिए "स्व-घोषित" दिखेगा। |
| MC-213 | Approval stalled (F-14) | Still "Approval pending" after {days} days? Here's a letter you can send. It lists only the facts. You review it and send it yourself. | {days} दिन बाद भी "मंज़ूरी बाकी" है? यह पत्र आप भेज सकते हैं। इसमें सिर्फ़ तथ्य हैं। आप इसे देखकर ख़ुद भेजें। |

### 5.14 New-rider year (S8, F-15)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-220 | Pledge | The Nazar Pledge: helmet on, phone away, and I'll let my pillion say "slow down". | नज़र प्रण: हेलमेट पहनूँगा/पहनूँगी, फ़ोन दूर रखूँगा/रखूँगी, और पीछे बैठे दोस्त को "धीरे चलो" कहने दूँगा/दूँगी। |
| MC-221 | Refresher nudge (opt-in, weekly max) | 2 minutes, 3 new clips: night roads this week. | 2 मिनट, 3 नई क्लिप: इस हफ़्ते रात की सड़कें। |
| MC-222 | Riding lock | Pull over to use Margdarshak. | मार्गदर्शक इस्तेमाल करने के लिए गाड़ी किनारे रोकें। |
| MC-223 | Riding lock button | I'm a passenger | मैं सवारी (पैसेंजर) हूँ |
| MC-224 | Minor riding, parent card (EC-17) | If someone under 18 rides your scooter and is stopped, the vehicle owner can be held responsible under s.199A. Here's what the law says. | अगर 18 साल से कम उम्र का कोई आपका स्कूटर चलाते हुए पकड़ा जाए, तो धारा 199A के तहत गाड़ी के मालिक को ज़िम्मेदार ठहराया जा सकता है। क़ानून क्या कहता है, यह यहाँ है। |
| MC-225 | Expired DL (EC-16) | Your licence expired on {date, date, long}. There's no grace period. Renew within a year of expiry to avoid a retest. | आपका लाइसेंस {date, date, long} को समाप्त हो गया। कोई छूट अवधि नहीं है। दोबारा टेस्ट से बचने के लिए समाप्ति के एक साल के अंदर रिन्यू करें। |

### 5.15 Streaks, badges, squads (F-26)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-230 | Week status | {n} of 7 days this week | इस हफ़्ते 7 में से {n} दिन |
| MC-231 | Missed day (streak repair) | A pothole on {weekday}. Fill it with one 3-minute review. | {weekday} को एक गड्ढा। एक 3 मिनट के रिवीज़न से इसे भरें। |
| MC-232 | Repair button | Fill it | भर दें |
| MC-233 | Repaired | Road's smooth again. | सड़क फिर से समतल हो गई। |
| MC-234 | Freeze applied (silent; shown later) | We used a rest day for {weekday}. You have {freezes} left this month. | {weekday} के लिए हमने आराम का दिन इस्तेमाल किया। इस महीने आपके पास {freezes} बचे हैं। |
| MC-235 | Streak end (test day) | Your practice streak ends here, and that's the point. Good luck on the road. | आपकी अभ्यास स्ट्रीक यहीं पूरी होती है, और यही मक़सद था। सड़क पर ध्यान से चलें। |
| MC-236 | Squad | Your squad spots hazards together. No rankings, just a shared score. | आपकी टीम मिलकर ख़तरे पहचानती है। कोई रैंकिंग नहीं, बस साझा स्कोर। |
| MC-237 | Under 18 | Streaks and squads are for 18+. Your lessons and mock tests are all here. | स्ट्रीक और टीम 18+ के लिए हैं। आपके पाठ और मॉक टेस्ट सब यहाँ हैं। |

> **Banned streak copy:** "You lost your streak", "Don't break your streak!", sad faces, or any countdown to streak loss (R9, CCPA).

### 5.16 AI surfaces (D-09, D-10, D-13; EC-20, EC-29)
| ID | Surface | EN | HI (draft) |
|---|---|---|---|
| MC-250 | AI chip | AI | AI |
| MC-251 | Voice guide intro | I'm an AI guide. I can open screens and fill fields here. I can't book, pay or submit on Sarathi. | मैं एक AI गाइड हूँ। मैं यहाँ स्क्रीन खोल सकता हूँ और जानकारी भर सकता हूँ। मैं सारथी पर बुक, पेमेंट या जमा नहीं कर सकता। |
| MC-252 | Every AI answer footer | AI can't book, pay or submit. Facts come from checked rules. | AI बुक, पेमेंट या जमा नहीं कर सकता। जानकारी जाँचे हुए नियमों से आती है। |
| MC-253 | Debrief footer | The words are written by AI. Your scores are calculated by Margdarshak's own code. | शब्द AI ने लिखे हैं। आपके स्कोर मार्गदर्शक के अपने कोड ने निकाले हैं। |
| MC-254 | Tutor footer | Explained from our reviewed lessons. | हमारे जाँचे हुए पाठों से समझाया गया। |
| MC-255 | Screen decoder | This looks like: {meaning}. Next step: {next_step}. | यह ऐसा लगता है: {meaning}। अगला कदम: {next_step}। |
| MC-256 | Decoder unknown | We don't recognise this screen yet. Here's how to ask your RTO or the Parivahan helpdesk. | हम यह स्क्रीन अभी नहीं पहचानते। अपने आरटीओ या परिवहन हेल्पडेस्क से कैसे पूछें, यह यहाँ है। |
| MC-257 | "I don't know" (allowed answer) | I don't know that for {state} yet. Please confirm at your RTO. | {state} के लिए यह मुझे अभी नहीं पता। कृपया अपने आरटीओ से पक्का करें। |
| MC-258 | PII typed (EC-20) | We removed a number that looked like an Aadhaar number or OTP. Never share these, here or anywhere. | हमने एक नंबर हटा दिया जो आधार नंबर या OTP जैसा लग रहा था। इन्हें कहीं भी, किसी से साझा न करें। |
| MC-259 | AI unavailable (EC-29) | Our AI is resting right now. You're seeing a standard summary instead. Your scores are the same. | हमारा AI अभी आराम कर रहा है। आपको सामान्य सारांश दिख रहा है। आपके स्कोर वही हैं। |
| MC-260 | Under 18 (D-13) | AI features are for 18+, under our AI provider's terms. Everything else works for you. | हमारे AI प्रदाता की शर्तों के अनुसार AI सुविधाएँ 18+ के लिए हैं। बाकी सब आपके लिए चलता है। |
| MC-261 | Mic privacy chip | Mic on · not stored | माइक चालू · सेव नहीं होता |
| MC-262 | Fill confirmation | Filled your {field_name}. OK? | आपका {field_name} भर दिया। ठीक है? |
| MC-263 | Didn't catch | Say it again, or type it. | फिर से बोलिए, या लिख दीजिए। |

### 5.17 Scam checker (F-33): never "safe"
| ID | Verdict (rules decide) | EN | HI (draft) |
|---|---|---|---|
| MC-270 | Known scam pattern | This matches a known scam pattern: {pattern}. Don't open the link or install anything. | यह एक जाने-माने धोखे के तरीके से मेल खाता है: {pattern}। लिंक न खोलें और कुछ इंस्टॉल न करें। |
| MC-271 | On the government list | This domain, {domain}, is on our list of government transport sites. Still, never share an OTP with anyone who calls you. | यह डोमेन, {domain}, सरकारी परिवहन साइटों की हमारी सूची में है। फिर भी, फ़ोन करने वाले किसी को भी OTP न बताएँ। |
| MC-272 | Not on our list | {domain} isn't on our list of government transport sites. Real challans are only on echallan.parivahan.gov.in. Don't install apps from links. | {domain} सरकारी परिवहन साइटों की हमारी सूची में नहीं है। असली चालान सिर्फ़ echallan.parivahan.gov.in पर होते हैं। लिंक से ऐप इंस्टॉल न करें। |
| MC-273 | APK | Apps sent as APK files in messages are never how challans or licences work. Delete it. | मैसेज में APK फ़ाइल के रूप में भेजे गए ऐप से चालान या लाइसेंस का काम कभी नहीं होता। इसे डिलीट कर दें। |
| MC-274 | AI explanation label | Why we think so (AI explanation) | हमें ऐसा क्यों लगता है (AI से समझाया गया) |

### 5.18 Golden hour (F-15, D-12): static, no AI
| ID | EN | HI (draft) |
|---|---|---|
| MC-280 | Call 112 | 112 पर कॉल करें |
| MC-281 | You are protected by law when you help (Motor Vehicles Act s.134A). You don't have to give your name. | मदद करने पर क़ानून आपकी रक्षा करता है (मोटर वाहन अधिनियम धारा 134A)। आपको अपना नाम बताना ज़रूरी नहीं। |
| MC-282 | Steps 1–4: {step_1} … {step_4} (from {medical_source}, shown on screen) | कदम 1–4: {step_1} … {step_4} ({medical_source} से) |
| MC-283 | Don't move the person's neck. | घायल व्यक्ति की गर्दन न हिलाएँ। |
| MC-284 | This is not medical training. | यह चिकित्सा प्रशिक्षण नहीं है। |

> MC-281's "don't have to give your name" must be re-verified against the s.134A text and the Good Samaritan rules before shipping [owner: Content lead, 2026-10-25]. Steps come only from a cited medical source (D-12); none are written by us or by AI.

### 5.19 Helper mode, privacy centre and consent (F-17, F-54; EC-14, EC-25, EC-26)
| ID | Moment | EN | HI (draft) |
|---|---|---|---|
| MC-300 | Helper start | You're helping {name}. They need to agree first. | आप {name} की मदद कर रहे हैं। पहले उनकी सहमति चाहिए। |
| MC-301 | Helper consent (read aloud to the applicant) | I, {name}, let {helper_name} fill my licence application in Margdarshak on {date, date, long}. They can't pay or submit for me. I can stop this any time. | मैं, {name}, {helper_name} को {date, date, long} को मार्गदर्शक में मेरा लाइसेंस आवेदन भरने देता/देती हूँ। वे मेरे लिए पेमेंट या जमा नहीं कर सकते। मैं इसे कभी भी रोक सकता/सकती हूँ। |
| MC-302 | Helper banner | Helping {name} · consent recorded {time, time} · End help | {name} की मदद · सहमति दर्ज {time, time} · मदद ख़त्म करें |
| MC-303 | Clear device | Clear this device? This signs everyone out and removes saved answers from this phone. Saved cases stay in each person's account. | यह डिवाइस साफ़ करें? इससे सभी साइन-आउट हो जाएँगे और इस फ़ोन से सेव जवाब हट जाएँगे। सेव मामले हर व्यक्ति के अकाउंट में रहेंगे। |
| MC-304 | Cleared | This device is clear. | यह डिवाइस साफ़ हो गया। |
| MC-305 | Consent revoked (EC-25) | {name} stopped your access on {date, date, long}. You can no longer see or edit their application. | {name} ने {date, date, long} को आपकी पहुँच बंद कर दी। अब आप उनका आवेदन देख या बदल नहीं सकते। |
| MC-306 | Delete account (EC-26) | Delete your account and all your cases? Your reminders will stop. This can't be undone. Applications already on Sarathi aren't affected. | अपना अकाउंट और सभी मामले डिलीट करें? आपके रिमाइंडर बंद हो जाएँगे। यह वापस नहीं होगा। सारथी पर जमा आवेदनों पर असर नहीं पड़ेगा। |
| MC-307 | Delete buttons (equal weight) | Keep my account · Delete everything | अकाउंट रखें · सब डिलीट करें |
| MC-308 | Export | Download a copy of your data | अपने डेटा की कॉपी डाउनलोड करें |
| MC-309 | WhatsApp STOP (EC-30) | You won't get WhatsApp messages from us any more. Reply START to turn them back on. | अब आपको हमसे WhatsApp मैसेज नहीं मिलेंगे। फिर से चालू करने के लिए START लिखें। |
| MC-310 | Grievance | Questions or complaints about your data? Contact our grievance officer: {grievance_contact}. | अपने डेटा के बारे में सवाल या शिकायत? हमारे शिकायत अधिकारी से संपर्क करें: {grievance_contact}। |

#### Consent texts (summary; full notice and legal basis in PRIVACY.md)
**Rules:**
- Every purpose is separate and **off by default**.
- "Not now" carries the same visual weight as "Agree".
- Each text says: what we use, why, how long ({retention} from PRIVACY.md), who else processes it, and how to withdraw.
- The wording is "built to the DPDP Rules", never "DPDP-compliant" (D-19).

| ID | Purpose (E-15 ConsentArtefact) | EN summary | HI summary (draft) |
|---|---|---|---|
| MC-320 | Save my case | Save your plan and answers so you can continue on any device. We keep them for {retention}. Delete any time. | अपनी योजना और जवाब सेव करें ताकि किसी भी डिवाइस पर आगे बढ़ सकें। हम इन्हें {retention} तक रखते हैं। कभी भी डिलीट करें। |
| MC-321 | WhatsApp reminders | Send reminders about your dates to {phone_masked}, at most 1 a day. Reply STOP any time. | आपकी तारीख़ों के रिमाइंडर {phone_masked} पर भेजें, दिन में ज़्यादा से ज़्यादा 1। कभी भी STOP लिखें। |
| MC-322 | Voice guide | Process your voice to understand what you ask. Audio goes to {voice_processors} and isn't stored by us. 18+ only. | आप क्या पूछ रहे हैं, यह समझने के लिए आपकी आवाज़ प्रोसेस करें। ऑडियो {voice_processors} को जाता है और हम इसे सेव नहीं करते। सिर्फ़ 18+। |
| MC-323 | AI debrief and tutor | Let AI write your practice feedback from your scores. Your name, phone and documents are never sent. 18+ only. | AI को आपके स्कोर से अभ्यास की प्रतिक्रिया लिखने दें। आपका नाम, फ़ोन और दस्तावेज़ कभी नहीं भेजे जाते। सिर्फ़ 18+। |
| MC-324 | Practice data | Keep your practice history (scores, topics) to plan your reviews. 18+ only. | आपके रिवीज़न की योजना के लिए अभ्यास का इतिहास (स्कोर, विषय) रखें। सिर्फ़ 18+। |
| MC-325 | Field study (F-57) | Take part in our study of hazard spotting. We use an anonymous ID. You can leave and delete your data any time. 18+ only. | ख़तरा पहचान पर हमारे अध्ययन में हिस्सा लें। हम एक गुमनाम ID इस्तेमाल करते हैं। आप कभी भी छोड़ सकते हैं और अपना डेटा डिलीट कर सकते हैं। सिर्फ़ 18+। |
| MC-326 | Helper link | Let {helper_name} help with your application (MC-301). | {helper_name} को आपके आवेदन में मदद करने दें (MC-301)। |
| MC-327 | Guardian (16–17, EC-05) | Your guardian's consent is needed for a moped licence. Margdarshak shows you the plan only; it doesn't keep a history for under-18s. | मोपेड लाइसेंस के लिए अभिभावक की सहमति ज़रूरी है। मार्गदर्शक आपको सिर्फ़ योजना दिखाता है; 18 से कम उम्र के लिए इतिहास नहीं रखता। |
| MC-328 | Analytics notice (no consent toggle: no PII, aggregated, F-55) | We count how screens are used, without names or numbers, to make Margdarshak easier. | मार्गदर्शक को आसान बनाने के लिए हम बिना नाम या नंबर के गिनते हैं कि स्क्रीन कैसे इस्तेमाल होती हैं। |
| MC-329 | Withdraw | Turn this off any time in Privacy. | इसे कभी भी प्राइवेसी में बंद करें। |

### 5.20 RTO Live Intel (F-11, D-14, EC-24)
| ID | EN | HI (draft) |
|---|---|---|
| MC-340 | Report title: What happened at {rto_name}? Pick from the options. No names, please. | {rto_name} पर क्या हुआ? विकल्पों में से चुनें। कृपया किसी का नाम न लिखें। |
| MC-341 | Thanks. Your report shows once {k} people report the same thing. | धन्यवाद। जब {k} लोग एक जैसी बात बताएँगे, तब आपकी रिपोर्ट दिखेगी। |
| MC-342 | Bribe/"setting" (EC-24) | Asked for money or offered a "setting"? We don't host these reports. Report it to {acb_name} or CPGRAMS. | पैसे माँगे गए या "सेटिंग" का ऑफ़र मिला? हम ऐसी रिपोर्ट नहीं रखते। इसकी शिकायत {acb_name} या CPGRAMS पर करें। |
| MC-343 | Not enough reports | Not enough reports yet for {rto_name}. | {rto_name} के लिए अभी पर्याप्त रिपोर्ट नहीं हैं। |

### 5.21 Empty states (one line + one action)
| ID | Screen | EN | Action |
|---|---|---|---|
| MC-360 | No application yet | Your road starts here. Find your licence plan in 3 taps. | Start my plan |
| MC-361 | Learn, nothing due | All caught up. Your next review opens tomorrow. | Try a Nazar clip |
| MC-362 | No slots in the adapter | No slots showing for {rto_name} right now. We'll tell you when one appears. | Notify me |
| MC-363 | No squad | Practise with friends. Squads share one score, with no rankings. | Start a squad |
| MC-364 | Practice Record empty | Your practice shows up here after your first session. | Start practising |

### 5.22 Notifications (WhatsApp templates, F-53; ≤ 1/day, real deadlines or chosen plans)
| ID | Trigger (F-09) | EN template | HI template (draft) |
|---|---|---|---|
| MC-380 | Day 25 of LL | Your driving test opens on {{1}}. Plan your slot: {{2}} | आपका ड्राइविंग टेस्ट {{1}} से बुक कर सकते हैं। स्लॉट की योजना बनाएँ: {{2}} |
| MC-381 | Test eve | Tomorrow's test: bring {{1}}. Your checklist: {{2}} | कल का टेस्ट: {{1}} साथ लाएँ। आपकी चेकलिस्ट: {{2}} |
| MC-382 | LL expiry T-30 | Your learner's licence expires on {{1}}. Book your test by {{2}}: {{3}} | आपका लर्नर लाइसेंस {{1}} को समाप्त होगा। {{2}} तक टेस्ट बुक करें: {{3}} |
| MC-383 | LL expiry T-7 | {{1}} days left on your learner's licence. Book now to keep your application: {{2}} | आपके लर्नर लाइसेंस के {{1}} दिन बाकी हैं। आवेदन बनाए रखने के लिए अभी बुक करें: {{2}} |
| MC-384 | Weekly refresher (opt-in) | 2 minutes, 3 new clips this week: {{1}} | इस हफ़्ते 2 मिनट, 3 नई क्लिप: {{1}} |
| Footer (all) | Reply STOP to opt out. We never ask for OTPs. | बंद करने के लिए STOP लिखें। हम कभी OTP नहीं माँगते। |

Variables are formatted server-side. **No personal data beyond the date** appears in a notification.

---

## 6. AI-generated content rules (with PROMPTS.md)
1. The AI **chooses IDs** (finding, rule, drill) from per-request allowlists. Its glue text has **no digits** (D-09). Numbers come from templates.
2. **Tone instruction** given to every agent: "calm guide, आप in Hindi, ≤ 2 sentences, never fear, never shame, never mention death or crashes, never say 'safe', 'official', 'verified' or 'guaranteed'."
3. The validator rejects outputs that contain banned words (§8) or digits. Rejected outputs fall back to the template version (EC-29).
4. Every AI surface shows `AIChip` + MC-252 or MC-253.
5. Under 18: no AI text anywhere; templates only (D-13).

---

## 7. Formatting conventions
| Thing | Convention |
|---|---|
| Product and feature names | Margdarshak, Nazar, Nazar Score, Readiness Score, Practice Record, Khud Licence, Helper mode, Lite mode, Sunlight mode |
| Government names | MoRTH, NIC, Sarathi, Vahan, DigiLocker, mParivahan, UMANG, Parivahan: always as names, never with "official" |
| Legal references | "CMVR r.32", "MV Act s.134A", "s.199A": in source chips and parentheses, not in headlines |
| Capitalisation | Sentence case for headings and buttons ("Start my plan"), never Title Case or ALL CAPS |
| Lists | ≤ 5 items; numbered when order matters |
| Dates and money | LOCALIZATION §7 |

---

## 8. Wording bans (D-19 and friends)

### 8.1 Hard bans (CI fails; UI strings, prompts, templates, docs meant for users and judges)
| Banned | Why | Use instead |
|---|---|---|
| "first" as in first-ever / novelty ("India's first …") | D-19 (Munger: unprovable) | "We found none on {date}" |
| "doesn't exist" (as a market claim) | D-19 | "We found none on {date}" |
| "official", "आधिकारिक" (about us or our content) | Impersonation risk; fake apps are an active scam (D-01, G10) | "government", "Sarathi", "the government portal" |
| "MoRTH service", "Government of India" (as our identity) | D-01 | Non-affiliation footer |
| "integrated with Sarathi", "integrated with Aadhaar" | No private integration exists (D-02, G3) | "hands off to Sarathi", "adapter a state can run" |
| "DPDP-compliant" | D-19 | "built to the DPDP Rules" |
| "STQC-certified", "certified", "certification" (about the product) | D-19, G5 | "audit-ready" |
| "verified licence", "verified" (about the Practice Record) | D-10 row 10 | "Practice Record", "recorded in Margdarshak" |
| "safe" (as a scam verdict), "सुरक्षित है" | D-19 | MC-271/272 patterns |
| "lives saved", "जान बचाई" | D-19 | "better test readiness and anticipation" |
| "you would crash", "unsafe driver", "dangerous rider" | D-19; fear and shame | Finding templates (MC-175) |
| "Saarthi" (as our name) | D-01 | Margdarshak |
| "guaranteed pass", "100% pass" | Overclaim | — |
| "10+ languages" | Cut (D-21) | "English and Hindi, plus Dogri voice" |
| Rupee literals (`₹` followed by digits) in message files and prompts | D-06 | ICU `{x, number, inr}` |

### 8.2 Dark-pattern bans (CCPA Guidelines 2023; `05` principle 20)
- No **false urgency** ("Only 2 slots left!" unless an adapter returns that number with a source).
- No **confirm-shaming** ("No thanks, I like paying agents").
- No **nagging** (more than 1 nudge a day).
- No **forced action** (camera never required).
- No **interface interference** (equal-weight choices on consent and delete).
- No **basket sneaking, subscription traps, drip pricing or disguised ads**: we show the full fee up front, and there are no ads.

### 8.3 Soft bans (review flag)
| Word / pattern | Context | Prefer |
|---|---|---|
| "death", "die", "killed", "crash" | Learner, game and nudge copy (allowed in the evidence pages with a source; allowed in golden hour only as needed) | "hazard", "close call", "what could go wrong" |
| "FAILED", "fail" as a label on the user | Fail screens | "Not this time", "didn't pass on the day" |
| "Hurry", "Last chance", "Don't miss" | Anywhere except a real CaseClock | Date + consequence |
| "Simply", "just", "easy" | Instructions | Specific steps |
| "Please note", "Kindly" | Everywhere | Say the thing |
| "beta", "bachcha", "safety first" | Everywhere | Respect |
| "Click" | Mobile | "Tap" (or a device-neutral verb: "Choose") |
| "Submit", "Proceed" | Buttons | Outcome verbs |

### 8.4 Lint implementation
- `scripts/copy-lint` (Phase 2): runs on `messages/*.json`, `content/**`, `ai/prompts/**`, `n8n/templates/**`.
- It uses a regex list for EN and HI hard bans (word-boundary aware; "first" is flagged only in patterns like `\b(India'?s|the|world'?s) first\b` and `\bfirst[- ]ever\b`), and it detects rupee and number literals.
- Soft bans produce warnings that need a reviewer's `// copy-ok: reason` comment in `CONTEXT.md`.

---

## 9. Review checklist (every new string)
- [ ] Plain words; meets the sentence-length rules.
- [ ] One idea and one action.
- [ ] Numbers are placeholders from code.
- [ ] No banned word (EN or HI).
- [ ] No fear, no shame, no false urgency.
- [ ] Honest scope (what we can't do) where relevant.
- [ ] Source chip where a rule is stated.
- [ ] Works read aloud.
- [ ] Hindi reviewed natively (LOCALIZATION §11).
- [ ] Under-18 variant considered.
- [ ] Fits at 200% text and in the +40% pseudo-locale.

---

## 10. Open items and unverified
| Item | Owner | Due |
|---|---|---|
| Native review of all Hindi strings in §5 | Hindi reviewer | 2026-10-24 |
| s.134A and Good Samaritan wording (MC-281) | Content lead | 2026-10-25 |
| Payment-pending escalation threshold (`pending_limit_hours`) per state, with a source | Content lead | 2026-10-25 |
| RTI fee and reply period (MC-198), per state RTI rules; the central Act s.6/s.7 figures to confirm | Content lead | 2026-10-25 |
| Parivahan helpdesk contact for MC-256 | Content lead | 2026-10-25 |
| Retention values for consent texts (`{retention}`) | Privacy owner (PRIVACY.md) | 2026-10-24 |
| State ACB/vigilance names per tenant (MC-342) | Content lead | Phase 3 |

## Sources
- `research/ps1-deep/05-psychology.md` §0–§5: threat appeals meta-analysis (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3656854/), streaks (https://udspace.udel.edu/handle/19716/34160), CCPA dark patterns (https://www.jsalaw.com/newsletters-and-updates/ccpa-issues-guidelines-for-prevention-and-regulation-of-dark-patterns-2023/), corpus quotes Q34, Q71, Q77, Q94–Q105
- `research/ps1-deep/06-design-language.md` §B10–B12
- `research/ps1-deep/08-game-ai-n8n.md` l.28, l.652 (template pattern)
- `war-room/margdarshak-verification.md` §1 rows 3, 5, 6, 10, 12, 13; §3.2; §5 D-01..D-25
- GOV.UK content design: https://www.gov.uk/guidance/content-design/writing-for-gov-uk
