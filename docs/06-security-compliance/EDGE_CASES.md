# Edge Cases EC-01..EC-30
> Project: Margdarshak · Owner: Product lead (PL) with Backend lead (BE) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF §9](../00-overview/PROJECT_BRIEF.md) · [THREAT_MODEL](THREAT_MODEL.md) · [PRIVACY](PRIVACY.md) · [SECURITY_ARCHITECTURE](SECURITY_ARCHITECTURE.md) · [RISK_REGISTER](RISK_REGISTER.md) · PRD `../01-product/PRD.md` · Rules engine `../03-engineering/RULES_ENGINE.md` · Council `../../../war-room/margdarshak-verification.md` §3.2

**Contract (D-20).** Every edge case has (1) a **rule row** in the rule pack or a **screen state** in the journey state machine (F-08), and (2) at least one automated **test**. A case without both is a release blocker.

**Conventions**
- Rule rows: `rule.<domain>.<name>` in `rulepacks/<state>/*.yaml`, each with `source`, `verified_on`, `confidence ∈ {high, medium, low}`. Low confidence always shows the "Verify at your RTO" banner.
- Screen states: `<stage>.<screen>#<state>` (e.g. `S1.plan#yob-only`).
- Tests: `T-EC-xx<letter>`; type U = unit (rules engine, pytest), C = contract (adapter), E = Playwright e2e, A = accessibility (axe/manual), P = performance, S = security.
- Facts tagged **[P]** primary / **[S]** secondary / **[MK]** model knowledge / **[unverified]** come from `research/ps1-current-state/02-rules-process.md`, `00-JOURNEY-MAP.md` and `research/ps1-deep/03-lifecycle.md`.
- "Phase 1–2" = hackathon build on mocks; "Phase 3+" = production.

**Index**

| Group | Cases |
|---|---|
| Identity and eligibility | EC-01 · EC-02 · EC-03 · EC-04 · EC-05 · EC-06 · EC-21 |
| Timeline and payment | EC-07 · EC-08 · EC-09 · EC-10 · EC-11 · EC-22 · EC-23 · EC-27 · EC-28 |
| Special situations | EC-12 · EC-13 · EC-14 · EC-15 · EC-16 · EC-17 |
| Technical, privacy, trust | EC-18 · EC-19 · EC-20 · EC-24 · EC-25 · EC-26 · EC-29 · EC-30 |

---

## Identity and eligibility

### EC-01 Aadhaar shows only the year of birth
| Field | Detail |
|---|---|
| **Trigger** | Applicant's Aadhaar carries only a year of birth (UIDAI then records 1 Jan of that year), so the Sarathi Aadhaar route may compute the wrong age, off by up to a year |
| **Detection** | F-02/F-05 question "Does your Aadhaar show your full date of birth?" (Yes / Only the year / Not sure), with a picture of where to look. No Aadhaar image or number is read |
| **User-facing behaviour** | Plan card warning: "Your Aadhaar shows only the year. Sarathi may treat your birthday as 1 January. Bring another date-of-birth document (e.g. class 10 certificate, birth certificate, passport). If you are close to the minimum age, wait until you are old enough by both dates." Earliest-licence date computed with the **later** of the two plausible dates |
| **Rule row / screen state** | `rule.id.dob_year_only` (confidence medium, source: journey map row 2); `S1.plan#yob-only`; documents list adds "DOB proof" |
| **Data handling** | Store `dob_precision = year` on E-02; age band computed conservatively (31 Dec of that year) so AI and account gates err towards "younger" ([SECURITY §3.3](SECURITY_ARCHITECTURE.md)) |
| **Tests** | T-EC-01a (U): 17 y 11 m by real DOB, year-only → plan shows "eligible from <date>", not "eligible now". T-EC-01b (U): age band uses 31 Dec. T-EC-01c (E): warning visible in EN/HI with screen reader label |

### EC-02 Aadhaar address differs from residence (migrant, P-02 Tanvi)
| Field | Detail |
|---|---|
| **Trigger** | Aadhaar address (Kathua) ≠ where the applicant lives and wants to apply (Jammu) |
| **Detection** | Question "Is your Aadhaar address the place you'll apply from?" |
| **User-facing behaviour** | Two paths with honest trade-offs: (a) apply at the RTO of the Aadhaar address (Aadhaar route, contactless where available); (b) apply where you live with **another address proof** (rent agreement, utility bill, etc. per the state's list) through the non-Aadhaar path, which means an RTO visit for document scrutiny. Shows max RTO visits for each path |
| **Rule row / screen state** | `rule.docs.address_proof_list` per state (confidence per row); `rule.path.non_aadhaar_requires_visit`; `S1.plan#address-mismatch` |
| **Data handling** | Only `aadhaar_addr_matches: bool` stored (`04-ai-adk-gemini.md` §2 state model). No addresses stored |
| **Tests** | T-EC-02a (U): mismatch → two paths with visit counts. T-EC-02b (E): Tanvi persona flow end to end on mocks |

### EC-03 The "son/daughter of" line on Aadhaar is blank
| Field | Detail |
|---|---|
| **Trigger** | Father's/guardian's name is blank on Aadhaar, and Sarathi's Aadhaar-filled field can't be edited (journey map row 2) |
| **Detection** | Question in F-05 "Does your Aadhaar show a father's/guardian's name?" |
| **User-facing behaviour** | "Sarathi may fill this from Aadhaar and not let you change it. Option 1: update Aadhaar first (takes days). Option 2: use the non-Aadhaar path with a document that shows the name. Ask your RTO which they accept." Copy-pack leaves the field for the user |
| **Rule row / screen state** | `rule.id.so_line_blank` (confidence low → verify banner); `S2.apply#so-blank` |
| **Data handling** | Boolean only |
| **Tests** | T-EC-03a (U), T-EC-03b (E) verify banner present |

### EC-04 Turning 40 mid-journey
| Field | Detail |
|---|---|
| **Trigger** | Applicant turns 40 between LL and DL, or is ≥ 40 at renewal (P-03 Mohan-ji) |
| **Detection** | Server computes age at each future milestone from DOB (server clock, EC-15) |
| **User-facing behaviour** | Timeline adds "Form 1A medical certificate needed from <date>" at the right step; renewal flow (F-16) lists Form 1A for 40+. Transport classes: medical at any age (flagged verify) |
| **Rule row / screen state** | `rule.medical.form1a_age_40` (source CMVR / journey map; confidence medium); `rule.medical.transport_any_age` (low); `S4.bridge#form1a-upcoming`, `S9.renew#form1a` |
| **Data handling** | DOB encrypted in case; never sent to AI (only rule IDs) |
| **Tests** | T-EC-04a (U): DOB such that the 40th birthday falls between LL issue and DL test → Form 1A appears before S5. T-EC-04b (U): renewal at 52 → Form 1A |

### EC-05 Aged 16–17: ≤ 50 cc gearless only (P-07 Rahul)
| Field | Detail |
|---|---|
| **Trigger** | DOB gives 16 or 17 years |
| **Detection** | Age band `16_17` from F-02 |
| **User-facing behaviour** | Simple mode ([PRIVACY §5.6](PRIVACY.md)): only MC50CC (≤ 50 cc gearless) with guardian consent; plain warning "Most scooters are bigger than 50 cc, so they need a licence you can only get at 18." No account, no AI, no telemetry, no streaks, no squads; local-only practice |
| **Rule row / screen state** | `rule.age.mc50cc_min_16_guardian` (source MV Act s.4 [P via 02]; confidence high); `S0.home#minor-mode`; AI routes return 403 `age_gate` |
| **Data handling** | Nothing stored server-side beyond the anonymous device session; no analytics events (s.9(3)) |
| **Tests** | T-EC-05a (U) eligibility; T-EC-05b (S): AI endpoints refuse a 16_17 session; T-EC-05c (E): no analytics beacon fired in minor mode; T-EC-05d (S): DOB change 16→18 requires declaration and is rate-limited |

### EC-06 Transport classes under 20
| Field | Detail |
|---|---|
| **Trigger** | User under 20 picks LMV-TR / HGMV / HPMV / e-rickshaw transport |
| **Detection** | Class + age |
| **User-facing behaviour** | "Not yet: transport licences start at 20." Shows the LMV-prerequisite rule with a **verify** flag (s.7 text requires a year on an LMV licence as quoted in *Rambha Devi*; whether 2019 changed it is unverified), the ADTC certificate path, and the SC 6 Nov 2024 note that LMV holders may drive transport vehicles ≤ 7,500 kg, with "verify for commercial use" |
| **Rule row / screen state** | `rule.age.transport_min_20` (high); `rule.transport.lmv_prereq_1yr` (**low**, verify); `rule.transport.lmv_7500kg_sc2024` (medium); `S1.plan#transport-underage` |
| **Data handling** | — |
| **Tests** | T-EC-06a (U), T-EC-06b (U) verify banner shown for low confidence |

### EC-21 Two classes with different eligibility ages
| Field | Detail |
|---|---|
| **Trigger** | 17-year-old wants MCWG + LMV; or 19-year-old wants LMV + LMV-TR |
| **Detection** | Planner (F-03) evaluates each class separately |
| **User-facing behaviour** | Splits the plan: "MC50CC now; MCWG + LMV together from <18th birthday>"; saving shown only "if you'd otherwise do them one after the other" (verification row 9); fees per class from `fees.json` |
| **Rule row / screen state** | `rule.planner.split_by_age`; `S1.plan#split-classes` |
| **Data handling** | — |
| **Tests** | T-EC-21a (U): combined fee = ₹700 + ₹450 for the second class + ₹200 card (computed, no literal); T-EC-21b (U) split dates |

---

## Timeline and payment

### EC-07 LL expires while waiting for a slot; renewal breaks the slot
| Field | Detail |
|---|---|
| **Trigger** | LL validity (6 months) runs out before a DL slot; renewing creates a new application number that breaks the existing slot (journey map row 7) |
| **Detection** | Case clock (F-09): T-60, T-30, T-7 checks against `ll_expiry` and booked slot date |
| **User-facing behaviour** | At day 25 after LL: "Book your test now for a date after day 30." At T-60 with no slot: escalate to "earliest slots at nearby RTOs/ADTCs". If expiry precedes the slot: honest options (move slot earlier, or re-apply and re-book; "a new LL means a new application number, so your slot won't carry over") |
| **Rule row / screen state** | `rule.ll.validity_6m` (high); `rule.ll.renew_new_appno` (medium); `S4.bridge#ll-expiring`, `S5.book#slot-after-expiry` |
| **Data handling** | E-12 TimelineEvents with idempotency keys `case:{id}:ll_expiry:{t}` |
| **Tests** | T-EC-07a (U) timeline; T-EC-07b (C): sweep idempotent on retry (Render Workflow re-run sends one message); T-EC-07c (E) screen state |

### EC-08 Three or more fails, the 7-day gap, remedial training
| Field | Detail |
|---|---|
| **Trigger** | User records a failed DL test (API-15 `test_failed`), repeatedly |
| **Detection** | E-11 attempts count |
| **User-facing behaviour** | Private, face-saving debrief (F-13) → drill → retest booking from the same screen with earliest date = fail date + 7 days ([MK/S-low], confidence low → verify); remedial-training referral (2019 amendment s.9 proviso requires a remedial course before reappearing **[P: Bill]**); LL-expiry check; after 3+ fails a calmer plan (school referral, track explainer, Practice Record) and no shaming copy |
| **Rule row / screen state** | `rule.dl.retest_gap_7d` (low); `rule.dl.remedial_after_fail` (medium); `S6F.recover#attempt-n` |
| **Data handling** | Fail reasons as codes; result visible only to the user (helpers see "attempt recorded") |
| **Tests** | T-EC-08a (U), T-EC-08b (E): helper view hides result |

### EC-09 Payment debited but status pending
| Field | Detail |
|---|---|
| **Trigger** | User reports money debited, Sarathi shows pending (15 of 33 complaints in research) |
| **Detection** | User taps "I paid but it shows pending" (Phase 1–2: no payment data reaches us; we never handle fees) |
| **User-facing behaviour** | Checklist: don't pay again; don't cancel (cancelling forfeits the fee); wait the stated window; check "payment verification" on Sarathi; keep bank reference; escalation letter template to the grievance cell after N days; CPGRAMS link |
| **Rule row / screen state** | `rule.pay.pending_checklist`; `rule.pay.cancel_forfeits` (medium); `S2.apply#payment-pending` |
| **Data handling** | Bank reference entered stays on device (copy-pack); not uploaded |
| **Tests** | T-EC-09a (E); T-EC-09b (S): no payment fields accepted by API-12 schema |

### EC-10 No online LL test in the state
| Field | Detail |
|---|---|
| **Trigger** | State doesn't offer the online/at-home LL test (Kerala scrapped it in 2022) |
| **Detection** | Rule pack `ll_test.mode = rto_only` |
| **User-facing behaviour** | Plan card switches to "Test at the RTO", adds one RTO visit, slot step, and what to bring |
| **Rule row / screen state** | `rule.ll.test_mode` per state; `S3.lltest#rto-only` |
| **Data handling** | — |
| **Tests** | T-EC-10a (U) Kerala pack; T-EC-10b (U) visit count |

### EC-11 Sarathi outage
| Field | Detail |
|---|---|
| **Trigger** | Sarathi or the state gateway is down (Telangana Jun 2026) |
| **Detection** | Phase 1–2: manual status flag set by OPS + user "Sarathi isn't loading" button aggregate; Phase 3+: adapter health checks |
| **User-facing behaviour** | Status banner "Sarathi seems down. Your draft is saved here; we'll remind you." Hand-off button disabled with explanation; nothing lost |
| **Rule row / screen state** | `S2.apply#upstream-down`; tenant flag `sarathi_status` |
| **Data handling** | Drafts persisted (server for 18+ accounts; IndexedDB otherwise) |
| **Tests** | T-EC-11a (C) adapter returns 503 → banner; T-EC-11b (E) draft survives reload offline |

### EC-22 LL already held before using Margdarshak (mid-journey onboarding)
| Field | Detail |
|---|---|
| **Trigger** | User arrives with an LL (or a failed test) |
| **Detection** | Home verb "I already have my LL" / Check my application |
| **User-facing behaviour** | Asks LL issue date and classes (from the LL PDF, typed by the user; LL number stays on device) → jumps to S4/S5 with the clock set correctly |
| **Rule row / screen state** | `S0.home#onboard-mid`; transitions S0→S4/S5/S6F allowed for `source=user` |
| **Data handling** | E-04 dates only |
| **Tests** | T-EC-22a (U) state machine; T-EC-22b (E) |

### EC-23 Passed the test but no SMS within 3 days
| Field | Detail |
|---|---|
| **Trigger** | `test_passed` recorded; no `approved` event after 3 days (J&K: 3 SMS within 24 h typical; elsewhere weeks) |
| **Detection** | Clock sweep rule |
| **User-facing behaviour** | Approval tracker (F-14): "What usually happens", where to check status, then a facts-only escalation letter the user approves and sends; DigiLocker pointer once issued |
| **Rule row / screen state** | `rule.approval.chase_after_days` (per state; default 3, confidence low); `S7.issued#approval-stalled` |
| **Data handling** | E-28 letter draft, user-sent |
| **Tests** | T-EC-23a (U) sweep; T-EC-23b (E) letter has no accusation fields |

### EC-27 Rule pack changes mid-case
| Field | Detail |
|---|---|
| **Trigger** | A checker publishes a new rule-pack version (fee, format, timeline) while cases are open |
| **Detection** | Publish event → Workflow re-evaluates open cases of that tenant |
| **User-facing behaviour** | In-app notice "A rule changed on <date>: <plain change>. Your plan is updated." with the source; never silently changes a booked date; old vs new shown |
| **Rule row / screen state** | Case stores `rulepack_version`; `S*#rule-changed` banner; public CHANGELOG entry |
| **Data handling** | Re-evaluation diff stored on E-12 |
| **Tests** | T-EC-27a (U) diff; T-EC-27b (C) clock sweep uses new version, idempotent |

### EC-28 Kerala HPT stayed or postponed
| Field | Detail |
|---|---|
| **Trigger** | Court stay or government postponement of Kerala's hazard-perception test (from 1 Dec 2026; no stay found as of 23 Oct, verification G13) |
| **Detection** | CL checks on demo morning and weekly; rule-pack flag |
| **User-facing behaviour** | Nazar copy switches from "Kerala's announced format" to "practice in the format Kerala announced on 12 Sep 2026 (status: postponed)". Nazar remains as anticipation training; no claim the test is live |
| **Rule row / screen state** | `rule.kl.hpt_status ∈ {announced, live, stayed, postponed}` (source + date); `S4.nazar#format-status` |
| **Data handling** | — |
| **Tests** | T-EC-28a (U) copy switch per status |

---

## Special situations

### EC-12 Moving state, foreign licence, NRI, IDP
| Field | Detail |
|---|---|
| **Trigger** | User moves state mid-journey; holds a foreign licence; is NRI; wants an IDP |
| **Detection** | Home → "All services"; F-16 only for DL holders |
| **User-facing behaviour** | Move state: honest guidance (LL is state-issued; transfer of application or re-apply per state, verify banner). Foreign licence conversion and NRI: information cards + RTO visit. IDP: shown only to DL holders |
| **Rule row / screen state** | `rule.move.ll_transfer` (low); `rule.foreign.conversion` (low); `rule.idp.dl_required` (high); `S9.fix#...` |
| **Data handling** | — |
| **Tests** | T-EC-12a (U) IDP hidden for non-DL; T-EC-12b (U) verify banners |

### EC-13 Disability, adapted vehicles, deaf applicants, colour vision
| Field | Detail |
|---|---|
| **Trigger** | User chooses to tell us about a disability (optional, separate consent PUR-DISABILITY) |
| **Detection** | Optional question with consent |
| **User-facing behaviour** | Rights card: adapted vehicle / invalid carriage class; deaf applicants may hold licences per MoRTH advisory (verification row 17, cite); colour-vision questions explained; accessible formats; no hazard-clip hard block for blind users (alternative audio-described lessons) |
| **Rule row / screen state** | `rule.pwd.adapted_class`; `rule.pwd.deaf_advisory` (medium); `S1.plan#rights-card` |
| **Data handling** | Health-adjacent, opt-in, deletable, never shared with schools without separate consent, never sent to AI |
| **Tests** | T-EC-13a (A) screen reader path; T-EC-13b (S) field excluded from AI context |

### EC-14 Shared phone or cyber café
| Field | Detail |
|---|---|
| **Trigger** | Helper (P-04) or public computer |
| **Detection** | "Is this your own device?" at sign-in; helper sessions default to public mode |
| **User-facing behaviour** | Public mode: 15-min idle logout, no "remember me", visible **Clear this device** button (wipes IndexedDB, caches, cookies, service-worker caches), reminder before leaving |
| **Rule row / screen state** | `S*#public-device` |
| **Data handling** | No PII in localStorage; drafts encrypted in IndexedDB with an in-memory key |
| **Tests** | T-EC-14a (E): after clear, back button shows nothing; T-EC-14b (S): session cookie gone |

### EC-15 Device clock tampering
| Field | Detail |
|---|---|
| **Trigger** | User changes phone date to unlock day-30 or extend countdowns; or clock is just wrong |
| **Detection** | Server time in every API response (`Date` header + `server_now`); client compares; drift > 5 min logged |
| **User-facing behaviour** | All countdowns use server time; offline mode shows "as of last sync <time>" |
| **Rule row / screen state** | `S*#clock-drift` notice (only if drift > 1 h) |
| **Data handling** | Drift metric only |
| **Tests** | T-EC-15a (E) with mocked device clock +40 days → day-30 unlock not shown early; T-EC-15b (S) verifier V4 rejects sessions with skewed timings |

### EC-16 Expired DL, no grace period
| Field | Detail |
|---|---|
| **Trigger** | DL holder's licence expired |
| **Detection** | E-05 validity |
| **User-facing behaviour** | "Your licence expired on <date>. Since 2019 there's no grace period: you can't legally drive from the next day. Renew within 1 year of expiry; after that a retest is required." Reminders from T-12 months |
| **Rule row / screen state** | `rule.dl.no_grace_2019` (P, `03-lifecycle.md` §0.1); `rule.dl.retest_after_1y_late` (P); `S9.renew#expired` |
| **Data handling** | — |
| **Tests** | T-EC-16a (U) 13 months late → retest; T-EC-16b (U) copy never says "30-day grace" |

### EC-17 A minor riding the family scooter
| Field | Detail |
|---|---|
| **Trigger** | Parent in family mode mentions a child under 18 rides the family scooter (> 50 cc) |
| **Detection** | Family mode question (asked of the parent, not the minor) |
| **User-facing behaviour** | Calm s.199A card for the parent: guardian/owner deemed guilty, up to 3 years and ₹25,000 (from rule row), registration cancelled 12 months, juvenile barred from LL/DL until 25; the legal path (≤ 50 cc at 16 with consent; full licence at 18). Never shaming, no fear imagery |
| **Rule row / screen state** | `rule.mva.s199a` (P); `S9.family#minor-riding` |
| **Data handling** | Nothing stored about the child |
| **Tests** | T-EC-17a (U) amounts come from the rule row (no literal); T-EC-17b copy lint (no shaming words list) |

---

## Technical, privacy and trust

### EC-18 Game edge cases: buffering, spam taps, screen readers, photosensitivity
| Field | Detail |
|---|---|
| **Trigger** | Video stalls mid-clip; user taps constantly; blind user; photosensitive user |
| **Detection** | `waiting`/`stalled` events; tap-rate; `prefers-reduced-motion`; screen-reader detection is not possible reliably, so the alternative is always offered |
| **User-facing behaviour** | Preload the whole MP4 before start and score on `video.currentTime` (verification §3.2 #18); spam-tapping → pattern-clicking rule scores the clip 0 with an explanation; screen-reader users get audio-described hazard lessons, never a hard block; ≤ 3 flashes/s (WCAG 2.3.1), reduced-motion mode, photosensitivity notice before clips |
| **Rule row / screen state** | `S4.nazar#preloading`, `#pattern-click`, `#alt-lesson`, `#reduced-motion` |
| **Data handling** | Events bounded, no PII (E-17) |
| **Tests** | T-EC-18a (U) verifier pattern-click; T-EC-18b (E) throttled network → no scoring until preload completes; T-EC-18c (A) flash analysis of each published clip (PEAT-style check in the clip pipeline); T-EC-18d (A) keyboard-only play |

### EC-19 Low-end phone on 2G
| Field | Detail |
|---|---|
| **Trigger** | Slow network / low RAM |
| **Detection** | Network Information API where available; first-load timing |
| **User-facing behaviour** | Lite mode < 300 KB first load; offline mock tests; 360p clips 1–2 MB; Phaser games lazy-loaded only when chosen |
| **Rule row / screen state** | `S0.home#lite` |
| **Data handling** | — |
| **Tests** | T-EC-19a (P) Lighthouse on emulated slow 3G, Moto G-class CPU: first load ≤ 300 KB; T-EC-19b (E) offline LL mock |

### EC-20 User types an Aadhaar number or OTP into the AI
| Field | Detail |
|---|---|
| **Trigger** | Aadhaar/VID/OTP/PAN pattern in chat, screenshot OCR or voice transcript |
| **Detection** | Client regex + Verhoeff, server guard, ADK plugin ([SECURITY §10](SECURITY_ARCHITECTURE.md)); voice: real-time transcript scan |
| **User-facing behaviour** | Message blocked before sending: "Never share your Aadhaar number or OTP here. Margdarshak never needs it." Voice: session ends with the same line spoken and shown |
| **Rule row / screen state** | `S*#pii-blocked` |
| **Data handling** | Nothing stored; log records `pii_trip:<type>` only |
| **Tests** | T-EC-20a (U) 200 shared vectors TS = Python; T-EC-20b (E) chat blocks; T-EC-20c (S) ADK eval `pii_echo` 0 leaks; T-EC-20d (S) voice transcript trip ends session |

### EC-24 Fake slot or "setting" offer reported in Live Intel
| Field | Detail |
|---|---|
| **Trigger** | User wants to report a tout offering a slot "setting", or a fake slot post appears |
| **Detection** | Report form option "Someone offered a paid shortcut"; anomaly detection on slot-release reports vs adapter data |
| **User-facing behaviour** | We don't publish it. Static screen: how to report to the state ACB/vigilance and CPGRAMS, "never pay anyone for a slot; slots are only on Sarathi". Contradictory reports suppress the cell with "reports disagree" |
| **Rule row / screen state** | `S5.intel#setting-report`, `S5.intel#cell-suppressed` |
| **Data handling** | The allegation is not stored; a counter per office (no text) for console trends at k ≥ 10 |
| **Tests** | T-EC-24a (U) k ≥ 5; T-EC-24b (S) no free-text field exists in API-28 schema; T-EC-24c (U) contradiction suppression |

### EC-25 Helper misuse (consent revoked)
| Field | Detail |
|---|---|
| **Trigger** | Applicant revokes a helper, or helper behaves like an agent (many links) |
| **Detection** | Revoke action; helper with > 20 active links in 30 days flagged |
| **User-facing behaviour** | Revoke kills helper sessions instantly; activity feed shows what the helper did; flagged helpers see a notice and need re-verification |
| **Rule row / screen state** | `S*#helper-revoked`, Privacy centre → Helpers |
| **Data handling** | E-29 status `revoked`, E-15 withdrawn, E-30 entry |
| **Tests** | T-EC-25a (S) revoked helper's next request → 401; T-EC-25b (S) helper can't export/delete/change contact |

### EC-26 Account deleted mid-case
| Field | Detail |
|---|---|
| **Trigger** | API-62 while a case has timers and pending messages |
| **Detection** | Delete flow |
| **User-facing behaviour** | Confirm screen lists what goes (case, reminders, practice history) and what stays for 1 year (consent proofs, security logs without content); suggests exporting first; confirmation shown |
| **Rule row / screen state** | `S9.privacy#delete-confirm` |
| **Data handling** | Delete E-01..E-29, crypto-shred E-14, cancel E-12/E-13, revoke helpers ([PRIVACY §3](PRIVACY.md)) |
| **Tests** | T-EC-26a (S) no reminder fires after delete (clock sweep skips); T-EC-26b (S) row counts zero for that applicant across tables |

### EC-29 AI unavailable (template fallback)
| Field | Detail |
|---|---|
| **Trigger** | Gemini 429/5xx, safety block, budget circuit breaker, provenance guard rejects twice |
| **Detection** | Error codes; breaker state |
| **User-facing behaviour** | Debrief shows the deterministic template ("how you did / where you lacked / what to do / next drill" built from finding IDs); voice hides with "Voice is resting; tap to use the screen"; no dead buttons |
| **Rule row / screen state** | `S*#ai-fallback` |
| **Data handling** | — |
| **Tests** | T-EC-29a (C) mock Gemini 429 → template; T-EC-29b (E) demo path works with AI disabled |

### EC-30 WhatsApp opt-out ("STOP")
| Field | Detail |
|---|---|
| **Trigger** | User replies STOP (or रोकें / बंद) to a WhatsApp message, or turns reminders off |
| **Detection** | Meta WhatsApp channel webhook → API-66 (signature verified); n8n is not on this path |
| **User-facing behaviour** | One confirmation message ("You won't get WhatsApp reminders. Your plan is still in the app."); in-app toggle off |
| **Rule row / screen state** | Consent PUR-REMIND-WA withdrawn; `S*#reminders-off` |
| **Data handling** | Phone kept only if another purpose needs it; else crypto-shredded |
| **Tests** | T-EC-30a (C) STOP keywords EN/HI; T-EC-30b (S) no business-initiated message after STOP |

---

## Coverage matrix

| EC | Rule row | Screen state | Unit | Contract | E2E | A11y/Perf/Sec |
|---|---|---|---|---|---|---|
| 01 | ✓ | ✓ | ✓ | | ✓ | |
| 02 | ✓ | ✓ | ✓ | | ✓ | |
| 03 | ✓ | ✓ | ✓ | | ✓ | |
| 04 | ✓ | ✓ | ✓ | | | |
| 05 | ✓ | ✓ | ✓ | | ✓ | S |
| 06 | ✓ | ✓ | ✓ | | | |
| 07 | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 08 | ✓ | ✓ | ✓ | | ✓ | |
| 09 | ✓ | ✓ | | | ✓ | S |
| 10 | ✓ | ✓ | ✓ | | | |
| 11 | flag | ✓ | | ✓ | ✓ | |
| 12 | ✓ | ✓ | ✓ | | | |
| 13 | ✓ | ✓ | | | | A, S |
| 14 | | ✓ | | | ✓ | S |
| 15 | | ✓ | | | ✓ | S |
| 16 | ✓ | ✓ | ✓ | | | |
| 17 | ✓ | ✓ | ✓ | | | lint |
| 18 | | ✓ | ✓ | | ✓ | A |
| 19 | | ✓ | | | ✓ | P |
| 20 | | ✓ | ✓ | | ✓ | S |
| 21 | ✓ | ✓ | ✓ | | | |
| 22 | | ✓ | ✓ | | ✓ | |
| 23 | ✓ | ✓ | ✓ | | ✓ | |
| 24 | | ✓ | ✓ | | | S |
| 25 | | ✓ | | | | S |
| 26 | | ✓ | | | | S |
| 27 | version | ✓ | ✓ | ✓ | | |
| 28 | ✓ | ✓ | ✓ | | | |
| 29 | | ✓ | | ✓ | ✓ | |
| 30 | consent | ✓ | | ✓ | | S |
