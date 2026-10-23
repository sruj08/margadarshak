# Compliance Register
> Project: Margdarshak · Owner: Legal and compliance owner (LC) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [LEGAL_MEMOS](LEGAL_MEMOS.md) · [PRIVACY](PRIVACY.md) · [SECURITY_ARCHITECTURE](SECURITY_ARCHITECTURE.md) · [STQC_PREAUDIT_PACK](STQC_PREAUDIT_PACK.md) · [RISK_REGISTER](RISK_REGISTER.md) · Council directives: `../../../war-room/margdarshak-verification.md` §3.1, §5

**How to read this.** One row per law, rule, guideline, platform policy or standard. Columns: **requirement** (what it asks of us), **MVP compliance** (Hackathon build, Phase 1–2), **production plan** (Phase 3+), **owner**, **status** of our source.

**Source status tags** (same as the council file): **VERIFIED** = primary or near-primary read; **SECONDARY** = law-firm/news summary, check the gazette before quoting on stage; **CARRIED** = verified in an earlier research file (named); **[unverified]** = model knowledge, owner and date given.

**This is not legal advice.** It is the engineering team's compliance map. Nestiq engages counsel before Phase 3 (owner LC, by 2026-12-15).

---

## 1. Summary dashboard

| # | Area | Applies now? | Gate for | Status |
|---|---|---|---|---|
| C-01 | DPDP Act 2023 + Rules 2025 | Partly now; full from 13 May 2027 | Any real user | SECONDARY |
| C-02 | Aadhaar Act 2016 + 2025 Good Governance Amendment Rules | Yes (as a "never do" list) | Every identity flow | SECONDARY |
| C-03 | IT Act 2000 | Yes | Launch | [unverified] sections |
| C-04 | IT (Intermediary Guidelines) Rules 2021 + 2022, 2026 amendments | Yes for Live Intel, squads, any user content | Live Intel launch | SECONDARY |
| C-05 | CERT-In Directions 28 Apr 2022 | Yes (body corporate) | Launch | SECONDARY |
| C-06 | GIGW 3.0 + UX4G | For government hosting | Adoption | SECONDARY |
| C-07 | WCAG 2.1 AA | Yes (our standard) | Launch | VERIFIED (standard) |
| C-08 | RPwD Act 2016 + Rules 2017 | For government hosting; good practice now | Adoption | [unverified] sections |
| C-09 | Promotion and Regulation of Online Gaming Act 2025 + Rules 2026 | Yes (game layer) | Game launch | SECONDARY |
| C-10 | CCPA Guidelines for Prevention and Regulation of Dark Patterns 2023 | Yes | Launch | CARRIED + [unverified] list |
| C-11 | Consumer Protection Act 2019 + E-Commerce Rules 2020 | If the schools marketplace takes bookings/payments | School bookings | [unverified] |
| C-12 | TRAI TCCCPR 2018 / DLT | Before any SMS | SMS | HUNCH (verification G11) |
| C-13 | WhatsApp Business Messaging Policy | Yes (notifications) | Reminders | CARRIED |
| C-14 | Gemini API Additional Terms | Yes | Any AI use | VERIFIED (fetched 2026-10-23) |
| C-15 | Motor Vehicles Act 1988 (as amended 2019) + CMVR 1989 | As rule sources; s.199A, s.184, s.134A content | Content | CARRIED |
| C-16 | Copyright Act 1957 + CC-BY 4.0; bystander privacy | Clip bank, rule packs | Clip publish | [unverified] + design |
| C-17 | Trade Marks Act 1999: "Margdarshak" | Before post-event launch | Brand | Not checked on IP India |
| C-18 | Advocates Act 1961 (letters boundary) | Letters, RTI template | F-13, F-14 | [unverified] sections |
| C-19 | RTI Act 2005 | RTI template | F-13 | CARRIED |
| C-20 | Government procurement: GeM, GFR 2017, OSS policy 2015, Open API policy | Adoption | Sale to a state | SECONDARY / [unverified] |
| C-21 | DigiLocker Requester terms (Jun 2025) | Phase 3+ | DigiLocker adapter | VERIFIED (search excerpts) |
| C-22 | API Setu / Sarathi data access | Phase 3+ | Sarathi adapter | VERIFIED (single source) |
| C-23 | Impersonation: Emblems and Names Act 1950, State Emblem of India (Prohibition of Improper Use) Act 2005, IT Act s.66D, Play Store policy | Yes | Branding | [unverified] + HUNCH |
| C-24 | MeitY AI governance (India AI Governance Guidelines, advisories) | Good practice | AI features | [unverified] |
| C-25 | Telecom Act 2023 | Not as a telecom service; only via TRAI rules for messaging | — | [unverified] |
| C-26 | Global (GDPR, COPPA) | Only if users outside India (geo-limit to India) | — | Design |

---

## 2. Detailed register

### C-01 Digital Personal Data Protection Act 2023 + DPDP Rules 2025
| | |
|---|---|
| **Phased dates** | Rules notified 13/14 Nov 2025 ([The Week/PTI](https://www.theweek.in/wire-updates/business/2025/11/14/del148-biz-dpdp-rules-ld-govt.html)). **Immediate:** Data Protection Board set-up provisions. **+12 months (~13 Nov 2026):** consent-manager registration and obligations (Rule 4). **+18 months (13 May 2027):** Rules 3 (notice), 5–16 (security, breach, erasure, contact, children, PwD, exemptions, SDF, rights, cross-border), 22, 23 ([SCC Online](https://www.scconline.com/blog/?p=371058), [TCSA](https://www.tcsa.in/resources/dpdp-rules-2025-implementation-roadmap)) |
| **Requirements** | Notice (s.5, Rule 3); consent free, specific, informed, unconditional, unambiguous, withdrawable as easily (s.6); legitimate uses (s.7); reasonable security safeguards incl. encryption/masking, access control, logs, backups (s.8(5), Rule 6); breach intimation to the Board and each affected person (s.8(6), Rule 7: without delay + detailed report within 72 h); erase when purpose ends, 48-h pre-erasure notice, keep logs ≥ 1 year (s.8(7), Rule 8); publish a contact (Rule 9); grievance redressal (s.8(10)); children under 18: verifiable parental consent, no tracking/behavioural monitoring/targeted ads (s.9, Rule 10); rights to information, correction/erasure, grievance, nomination (ss.11–14); cross-border negative list (s.16); penalties per Schedule |
| **MVP compliance** | Full design per [PRIVACY](PRIVACY.md): data inventory, artefacts, EN+HI notices, minors rules-only, rights flows in F-54, 48-h warning, breach runbook, logs. Wording "built to DPDP Rules" |
| **Production plan** | Counsel review; government-mode fiduciary/processor contract; India residency; consent-manager interoperability; DPIA refresh; annual audit if ever notified as SDF |
| **Owner** | LC (with SEC for Rules 6–8) |
| **Status** | SECONDARY (Rules text summaries from SCC Online, dpdpa.com; gazette PDF not read) |

### C-02 Aadhaar Act 2016 + Aadhaar Authentication for Good Governance (Social Welfare, Innovation, Knowledge) Amendment Rules 2025
| | |
|---|---|
| **Requirements** | Authentication/e-KYC only by entities permitted (AUA/KUA); the Jan 2025 amendment lets non-government entities authenticate for notified purposes only after proposal → UIDAI examination → ministry review → Central Government notification ([Khaitan](https://www.khaitanco.com/thought-leadership/Aadhaar-authentication-for-private-entities), [Scroll](https://scroll.in/latest/1078654/it-ministry-notifies-rules-allowing-private-entities-to-carry-out-aadhaar-authentication)); offline verification (Secure QR / paperless XML) is a separate route for Offline Verification Seeking Entities with UIDAI obligations ([UIDAI OVSE FAQ](https://uidai.gov.in/images/FAQ_OVSE.pdf)); restrictions on sharing and displaying Aadhaar numbers and core biometric information (s.29) and penalties (Chapter VII) **[section text not re-read; verify on India Code, LC, 2026-11-15]** |
| **MVP compliance** | **Never collect** Aadhaar number, VID, OTP, biometrics or face for matching (D-07). Aadhaar steps = hand-off to Sarathi (F-07 Mode A). The demo's eKYC screen is labelled "simulated: in production this step runs on Sarathi". Face match removed from the LL simulator. PII guards block Aadhaar patterns ([SECURITY §10](SECURITY_ARCHITECTURE.md)). `AadhaarOfflineAdapter` = **mock only** in Phase 1–2 (UIDAI sample data at most) |
| **Production plan** | Government mode: the STD (already the authenticating entity on Sarathi) performs eKYC; we orchestrate the redirect. Any real offline QR/XML verification by Nestiq only after OVSE obligations are reviewed by counsel (Reg. 13A note, [Vinod Kothari](https://vinodkothari.com/2025/12/a-new-way-to-verify-aadhaar-offline-introduction-of-face-matching/)). See [LEGAL_MEMOS M-02](LEGAL_MEMOS.md) |
| **Owner** | LC + BE |
| **Status** | SECONDARY (gazette not read) |

### C-03 Information Technology Act 2000
| | |
|---|---|
| **Requirements** | s.43 / s.66 (unauthorised access, computer-related offences: relevant to any scraping or bot use against Sarathi); s.66C (identity theft) and s.66D (cheating by personation using a computer resource: relevant to impersonators of our brand); s.72A (disclosure in breach of contract); s.79 safe harbour for intermediaries that observe due diligence; s.70B (CERT-In); s.43A compensation for negligent handling of sensitive personal data (to be omitted when DPDP s.44 commences) **[unverified commencement, LC, 2026-11-15]** |
| **MVP compliance** | No scraping, no booking bots, no automated access to `*.parivahan.gov.in` (D-08; CI lint); intermediary due diligence for Live Intel (C-04); security practices per SECURITY_ARCHITECTURE |
| **Production plan** | Counsel review of s.79 posture; ToS and user agreement per Rule 3(1)(a)–(b) of IT Rules |
| **Owner** | LC |
| **Status** | [unverified] section text |

### C-04 IT (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021, as amended 2022, 2023 and Feb 2026
| | |
|---|---|
| **Requirements** | Publish rules, privacy policy and user agreement; inform users not to host prohibited content (Rule 3(1)(b)); act on court/government orders (Rule 3(1)(d)), now **within 3 hours** after the amendment notified 10 Feb 2026 and in force 20 Feb 2026 ([SS Rana](https://ssrana.in/articles/india-tightens-oversight-on-ai-generated-content-under-it-rules/), [Business Today](https://www.businesstoday.in/amp/technology/story/govt-tightens-rules-on-ai-generated-content-mandates-labels-and-faster-takedowns-515505-2026-02-10)); 2-hour window for non-consensual intimate imagery complaints; **label synthetically generated information** (audio/visual/audio-visual content created or altered to appear authentic) with a prominent label and provenance metadata; grievance officer: acknowledge within 24 h, resolve within 15 days (Rule 3(2)) **[2021 text, unverified re-read]**; Grievance Appellate Committee route (2022 amendment) |
| **Where it bites** | Live Intel (F-11), squads (F-26), school listings/feedback (F-40), any synthetic audio from the voice guide (F-30), AI-generated debrief audio, share cards |
| **MVP compliance** | Live Intel: structured fields only, no free text, no names, k ≥ 5, report button, grievance officer in the footer, takedown queue in n8n (moderation workflow W09, for reports the backend precheck flags), 3-hour SLA for government/court orders, 24 h/15 days for user grievances (D-14). Squads: no free-text chat. Voice guide output is labelled "AI voice" on screen and in the transcript, and share cards carry no synthetic imagery of people. No user-uploaded media in Phase 1–2 (clips come only through our contributor pipeline) |
| **Production plan** | Grievance officer resident in India; monthly takedown log; counsel review whether Margdarshak is an intermediary for each surface; provenance metadata on any synthetic audio/video we publish (C2PA-style) |
| **Owner** | LC + GO |
| **Status** | SECONDARY (2026 amendment); 2021 base rules from model knowledge **[unverified]** |

### C-05 CERT-In Directions under s.70B(6), 28 April 2022
| | |
|---|---|
| **Requirements** | Report specified cyber incidents to CERT-In **within 6 hours** of noticing; keep ICT system logs for a **rolling 180 days within Indian jurisdiction**; sync clocks to **NIC or NPL NTP** (or sources traceable to them); designate a point of contact ([PSA Legal](https://psalegal.com/new-cert-in-directions-overview-and-implications/), [Ankura](https://ankura.com/insights/everything-you-need-to-know-about-indias-new-guidelines-related-to-cyber-incident-reporting-by-cert-in/)) |
| **MVP compliance** | Incident runbook with the 6-h clock ([PRIVACY §10](PRIVACY.md), `../05-ops/RUNBOOK.md`); E-30 security events kept 180 days (exportable); NTP on the host (Render's default time sync; NIC/NPL in production); SEC named as point of contact. Note: Render Singapore logs need an India copy for full compliance |
| **Production plan** | All logs in India for 1 year (covers CERT-In and DPDP Rule 8(3)); NTP to NIC/NPL hosts (hostnames to confirm); annual tabletop exercise |
| **Owner** | SEC + OPS |
| **Status** | SECONDARY |

### C-06 Guidelines for Indian Government Websites and Apps (GIGW 3.0) + UX4G
| | |
|---|---|
| **Requirements** | Accessibility (WCAG 2.1 AA), multilingual content, quality, security; guideline 5.3.1 bars production hosting until a security audit clearance by NIC, STQC, an STQC-empanelled or CERT-In-empanelled lab; a named Web Information Manager; site policies (copyright, hyperlinking, privacy, terms, content contribution/moderation/approval, archival, content review, contingency management, security, monitoring) ([TCSA](https://www.tcsa.in/learn/gigw-compliance-before-go-live), [Vikaspedia](https://en.vikaspedia.in/viewcontent/e-governance/national-e-governance-plan/guidelines-for-indian-government-websites)). UX4G 3.0 design system ([ux4g.gov.in](https://ux4g.gov.in/)) |
| **MVP compliance** | GIGW self-assessment matrix and policy set in [STQC_PREAUDIT_PACK](STQC_PREAUDIT_PACK.md); UX4G tokens as the white-label skin (F-58); "audit-ready", never "STQC-certified" |
| **Production plan** | Safe-to-host certificate before any government hosting; WIM named by the STD; policies adopted by the STD |
| **Owner** | PL + SEC |
| **Status** | SECONDARY (primary at guidelines.india.gov.in not read; re-verify GIGW 5.3.1 text, D-25, owner PL, 2026-11-01) |

### C-07 WCAG 2.1 Level AA
| | |
|---|---|
| **Requirements** | Perceivable, operable, understandable, robust; incl. 1.4.3 contrast 4.5:1, 2.1.1 keyboard, 2.3.1 three flashes, 1.2.2 captions, 2.5.5 target size (AAA; we adopt 48 px) |
| **MVP compliance** | F-52: axe in CI, 48 px targets, 18 px+ text, icon + colour + words, captions, reduced motion, ≤ 3 flashes/s, screen-reader alternative to hazard clips (EC-18), no-audio games |
| **Production plan** | Manual audit with screen-reader users (NVDA, TalkBack); WCAG 2.2 delta review |
| **Owner** | FE |
| **Status** | VERIFIED (standard is public) |

### C-08 Rights of Persons with Disabilities Act 2016 + RPwD Rules 2017
| | |
|---|---|
| **Requirements** | Accessibility standards for ICT and services; government and service providers to make information and services accessible; Rules adopt GIGW for websites **[sections 40, 42, 46 and Rule 15 from model knowledge; verify, LC, 2026-11-15]** |
| **MVP compliance** | WCAG 2.1 AA (C-07); EC-13 rights card (adapted vehicles, deaf applicants per MoRTH advisory, colour vision) |
| **Production plan** | Formal accessibility statement; grievance route for accessibility; audit with disabled users |
| **Owner** | FE + PL |
| **Status** | [unverified] |

### C-09 Promotion and Regulation of Online Gaming Act 2025 + Rules (in force 1 May 2026)
| | |
|---|---|
| **Requirements** | Bans online money games and their promotion/financial facilitation; promotes and recognises online social and educational games; Rules set a mechanism to decide money vs social game ([India Code](https://www.indiacode.nic.in/bitstream/123456789/22148/1/a2025-32.pdf), [PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/apr/doc2026430859401.pdf)) |
| **MVP compliance** | F-24/F-23/F-26 are free, stake-free educational games: no entry fee, no cash, crypto, tokens or redeemable prizes; XP is non-transferable and non-redeemable; no ads for money games ([LEGAL_MEMOS M-06](LEGAL_MEMOS.md)) |
| **Production plan** | Any future insurer benefit is tied to training completion, never to a game result; consider seeking recognition as an educational game once the authority's process is live |
| **Owner** | LC + PL |
| **Status** | SECONDARY |

### C-10 CCPA Guidelines for Prevention and Regulation of Dark Patterns 2023
| | |
|---|---|
| **Requirements** | Bans specified dark patterns on platforms offering goods/services in India. The Annexure lists 13 **[list from model knowledge; verify gazette, LC, 2026-11-15]**: false urgency, basket sneaking, confirm shaming, forced action, subscription trap, interface interference, bait and switch, drip pricing, disguised advertisement, nagging, trick question, SaaS billing, rogue malware |
| **MVP compliance** | Lint rule set (F-26) + design review checklist: no countdown pressure except real legal deadlines computed from the case (LL expiry is real, so shown factually, not as a sales timer); no streak guilt ("weekly repairable streaks"); "book anyway" always visible next to the 85 readiness gate; no pre-ticked consent; Pro tier pricing shown in full (no drip); sponsored school listings labelled; unsubscribe one tap; no nagging (≤ 1 nudge/day, `05-psychology.md` §3) |
| **Production plan** | Quarterly dark-pattern self-audit; CCPA self-declaration if required **[unverified, LC]** |
| **Owner** | PL + FE |
| **Status** | CARRIED (REFINED-OVERVIEW §6) + [unverified] list |

### C-11 Consumer Protection Act 2019 + Consumer Protection (E-Commerce) Rules 2020
| | |
|---|---|
| **When it applies** | If F-40 school bookings (API-51) or test-vehicle hire become a marketplace that facilitates sale of services between schools and learners |
| **Requirements** | Marketplace e-commerce entity duties: entity details, grievance officer, seller information, terms of return/refund/cancellation, no manipulation of price, ranking parameters disclosed, record of sellers; no unfair trade practices or misleading ads **[from model knowledge; verify, LC, 2026-12-01]** |
| **MVP compliance** | Phase 1–2: **listing only, no payments** (verification row 14); bookings are requests the school confirms off-platform; no prices invented by AI; ranking parameters shown |
| **Production plan** | If payments are added: comply with marketplace duties, appoint grievance officer, school agreements, display seller details, refund policy |
| **Owner** | LC + PL |
| **Status** | [unverified] |

### C-12 TRAI Telecom Commercial Communications Customer Preference Regulations 2018 (TCCCPR) / DLT
| | |
|---|---|
| **Requirements** | Commercial SMS requires principal-entity registration on an operator DLT platform, registered headers and content templates, and consent/preference scrubbing **[HUNCH from verification G11; not searched]** |
| **MVP compliance** | **No SMS** in Phase 1–2 (D-16). WhatsApp test number + email only, sent by the backend notifier (n8n sends no citizen messages, ADR-0006) |
| **Production plan** | Nestiq registers on DLT (entity, headers, templates) before any SMS; or, in government mode, use the STD's mGov/NIC gateway with its DLT templates |
| **Owner** | OPS |
| **Status** | HUNCH |

### C-13 WhatsApp Business Messaging Policy and Commerce Policy
| | |
|---|---|
| **Requirements** | Opt-in before business-initiated messages; approved templates outside the 24-hour customer-service window; honour opt-out; no prohibited content; quality rating; test numbers reach about 5 allow-listed recipients (B-sponsors §3) **[policy page not re-read; verify, OPS, 2026-10-24]** |
| **MVP compliance** | PUR-REMIND-WA artefact; template-only reminders; "STOP" handled by the Meta channel webhook → API-66 → consent withdrawn (EC-30); footer: "Margdarshak never asks for money, OTP or Aadhaar"; ≤ 1 nudge/day |
| **Production plan** | Verified business account under Nestiq; template approval per language; quality monitoring |
| **Owner** | OPS + PL |
| **Status** | CARRIED |

### C-14 Gemini API Additional Terms of Service
| | |
|---|---|
| **Requirements** (quoted, [terms](https://ai.google.dev/gemini-api/terms), last updated 2026-04-28, fetched 2026-10-23) | "You must be 18 years of age or older to use the APIs"; no use in a client "directed towards or is likely to be accessed by individuals under the age of 18"; Unpaid Services: "human reviewers may read, annotate, and process your API input and output" and "Do not submit sensitive, confidential, or personal information to the Unpaid Services"; Paid Services: prompts not used to improve products, logged for a limited period for abuse detection; data "may be stored transiently or cached in any country in which Google or its agents maintain facilities"; "Don't rely on the Services for medical, mental health, legal, financial, or other professional advice" |
| **MVP compliance** | AI gated server-side to `age_band=18_plus` with consent (D-13); **paid tier** before any real user, including the field study; free tier only for development with synthetic data; no legal/medical advice from AI (golden hour has no AI; letters are templates); cross-border disclosed in the AI notice |
| **Production plan** | Counsel opinion on "likely to be accessed by" for a general-audience app with AI gated to adults (open question, R-13); move to Vertex AI enterprise terms in an Indian region; or swap to Bhashini/local models behind the AI port |
| **Owner** | AI + LC |
| **Status** | VERIFIED |

### C-15 Motor Vehicles Act 1988 (as amended 2019) + Central Motor Vehicles Rules 1989
| | |
|---|---|
| **Role** | **Rule sources** for the rules engine (ages, classes, validity, fees, retests) and content |
| **Key provisions used** | s.4 (age: 16 for ≤ 50 cc gearless with guardian consent, 18 others, 20 transport); s.14/s.15 (validity, no grace period since 2019, retest if > 1 year late, `03-lifecycle.md` §0.1–0.2); s.9 proviso (remedial training after failing); **s.199A** (juvenile offences: guardian/owner deemed guilty, up to 3 years and ₹25,000; registration cancelled 12 months; juvenile barred from LL/DL until 25, `03-lifecycle.md` §0.4); **s.184** (dangerous driving incl. handheld device use: riding lock); **s.134A** (Good Samaritan protection: golden-hour card); CMVR r.32 (fees: LL ₹150, LL test ₹50, DL test ₹300, DL ₹200, smart card ₹200) |
| **MVP compliance** | Each rule row has `source`, `verified_on`, `confidence`; fees only from `fees.json`; trust line "₹700 for one class + ₹200 card; state charges may apply" (D-06); s.199A shown to parents in family mode without shaming (EC-17); riding lock above ~10 km/h |
| **Production plan** | STD signs its rule pack (maker-checker); public CHANGELOG |
| **Owner** | CL (rules content) + BE (engine) |
| **Status** | CARRIED (`03-lifecycle.md`, `02-rules-process.md`) |

### C-16 Copyright Act 1957; CC-BY 4.0; bystander privacy for clips
| | |
|---|---|
| **Requirements** | Own or license all clips, images, questions; respect third-party copyright (no lifting YouTube dashcam clips or Sarathi question banks verbatim); attribution under CC-BY; privacy of filmed persons (constitutional privacy, DPDP for personal data in footage) |
| **MVP compliance** | Clips filmed by the team or contributors under a signed contribution licence (CC-BY 4.0 release + warranty); face/plate blur + 100% audit; audio stripped; takedown in 72 h; LL questions written by us as variants (not copied); MoRTH data cited with source; golden-hour steps cited with attribution on screen |
| **Production plan** | Contributor agreements template reviewed by counsel; DMCA-style takedown policy page (GIGW copyright policy) |
| **Owner** | CL |
| **Status** | [unverified] statute details; design per [LEGAL_MEMOS M-09](LEGAL_MEMOS.md) |

### C-17 Trade Marks Act 1999: "Margdarshak"
| | |
|---|---|
| **Requirements** | Avoid infringing an existing mark in related classes; descriptive Hindi words face distinctiveness objections |
| **Check done** | One web search on 2026-10-23 found no app, scheme or mark named "Margdarshak" in transport ([search results incl. OpenGov Asia](https://archive.opengovasia.com/2017/10/28/ministry-of-road-transport-in-india-to-launch-two-mobile-apps-e-challan-and-m-parivahan/)). Not a trademark search. `HUNCH:` close to AICTE's "Margdarshan" mentoring scheme |
| **MVP compliance** | Use as a project name during the hackathon; no ® symbol; no claim of exclusivity |
| **Production plan** | IP India public search (word mark, Devanagari and Latin) in classes 9, 41, 42 (and 45 if relevant) → clearance opinion → file a device mark with a distinctive logo; fallback names list |
| **Owner** | LC |
| **Status** | Not checked on IP India **[due 2026-11-07]** |

### C-18 Advocates Act 1961: the boundary for letters
| | |
|---|---|
| **Requirements** | Only enrolled advocates may practise law (s.29, s.33) **[unverified sections]**; Bar Council rules restrict solicitation |
| **MVP compliance** | Letters (F-14) and the RTI template (F-13) are fill-in-the-blank templates with facts the user enters; the user reviews, approves and sends them; label "This is a template, not legal advice"; no case strategy, no prediction of outcomes, no AI-written legal text |
| **Production plan** | Counsel reviews templates; partner legal-aid referral (e.g. State Legal Services Authority) for disputes |
| **Owner** | LC |
| **Status** | [unverified] |

### C-19 Right to Information Act 2005
| | |
|---|---|
| **Requirements** | s.6 application to the PIO with the fee (₹10 under central rules; state rules vary), s.7 reply within 30 days, s.8 exemptions incl. personal information |
| **MVP compliance** | F-13 template asks for the applicant's own test record and the published criteria; never promises a video exists; user files it ([LEGAL_MEMOS M-08](LEGAL_MEMOS.md)) |
| **Production plan** | State-specific fee and PIO details in the rule pack |
| **Owner** | CL |
| **Status** | CARRIED (verification row 13) |

### C-20 Government procurement and policy
| | |
|---|---|
| **Instruments** | GeM (Government e-Marketplace) listing for services; General Financial Rules 2017 (procurement methods); Startup India relaxations for public procurement (prior experience/turnover) **[unverified]**; **Policy on Adoption of Open Source Software for GoI (2015)** (OSS preferred, `07` §A9, SECONDARY); Policy on Open APIs for GoI (2015) **[unverified]**; IndEA; MeitY cloud empanelment (MeghRaj) |
| **MVP compliance** | Apache-2.0 code, CC-BY rule packs and clips, OpenAPI 3.1 adapter spec, containerised and cloud-agnostic, UX4G skin |
| **Production plan** | DPIIT Startup India recognition for Nestiq; GeM seller registration; pilot via MoU with one J&K RTO/ARTO, then state tender or GeM custom bid; source escrow and exit plan |
| **Owner** | PL |
| **Status** | SECONDARY / [unverified] |

### C-21 DigiLocker Requester onboarding and Terms of Use (June 2025)
| | |
|---|---|
| **Requirements** | Registered Indian organisations eligible; demonstrable online citizen services; senior authorised representative; registration from the organisation's email domain; NeGD verification → integration → test/audit → go-live ([Partner SOP](https://cf-media.api-setu.in/resources/Partners-SOP.pdf), [Requester ToU](https://cf-media.api-setu.in/resources/DigiLocker-Terms-of-User-Requester-june-2025.pdf)); OAuth 2.0 + PKCE, consent screen, `partners.DRVLC` scope (`07` §A2) |
| **MVP compliance** | Mock DigiLocker adapter showing the real consent pattern (purpose, documents, validity) |
| **Production plan** | Nestiq applies after the event ([LEGAL_MEMOS M-01](LEGAL_MEMOS.md)) |
| **Owner** | BE + LC |
| **Status** | VERIFIED (search excerpts of the PDFs) |

### C-22 Sarathi / Vahan data access (API Setu)
| | |
|---|---|
| **Facts** | API Setu grants access only after publisher approval; NIC's RTI reply (16 Oct 2026) says sharing with private entities was discontinued from 1 Oct 2026 ([IFF](https://internetfreedom.in/who-reads-your-vehicle-record-nic-gave-us-numbers-morth-gave-us-a-generic-webpage/)) |
| **MVP compliance** | Mock adapters; deep-link hand-off; no scraping; wording "not integrated" ([LEGAL_MEMOS M-03](LEGAL_MEMOS.md)) |
| **Production plan** | Government-run adapter inside NIC |
| **Owner** | BE + PL |
| **Status** | VERIFIED (single advocacy source quoting the RTI reply) |

### C-23 Impersonation, emblems and app-store policy
| | |
|---|---|
| **Instruments** | State Emblem of India (Prohibition of Improper Use) Act 2005 and the Emblems and Names (Prevention of Improper Use) Act 1950 **[unverified applicability details]**; IT Act s.66D; BNS cheating by personation **[unverified section]**; Google Play misrepresentation/government-information policy (HUNCH, verification G10) |
| **MVP compliance** | No State Emblem, Parivahan logo, tricolour "Government of India" header, "official" wording; first-launch disclaimer + persistent footer: *"Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State Transport Department. Uses simulated government data."*; domain without gov/parivahan/sarathi; source links on every rule ([LEGAL_MEMOS M-04](LEGAL_MEMOS.md)) |
| **Production plan** | In government mode the STD may apply its own branding under its authority; Play listing with source links and non-affiliation statement; brand-abuse monitoring |
| **Owner** | PL + LC |
| **Status** | [unverified] + HUNCH |

### C-24 MeitY AI governance
| | |
|---|---|
| **Instruments** | India AI Governance Guidelines and MeitY advisories on AI models (labelling, testing, user disclosure) **[status and text not checked this session; LC, 2026-11-15]**; IT Rules 2026 synthetic content labelling (C-04) |
| **MVP compliance** | AI surfaces labelled; "AI can't book, pay or submit" line; evals ≥ 30 per agent (D-10); provenance guard; human review of clip windows and tutor content |
| **Production plan** | ISO/IEC 42001 roadmap; model cards per agent in `../04-ai/` |
| **Owner** | AI |
| **Status** | [unverified] |

### C-25 Telecom Act 2023
Not applicable as a telecom service. Messaging duties come through TRAI regulations (C-12) and platform policy (C-13). Owner LC, status [unverified].

### C-26 Global
Margdarshak serves India only. Gemini terms allow only Paid Services for clients made available in the EEA, Switzerland or the UK; we geo-limit sign-up to India and use the paid tier anyway. GDPR/UK GDPR/COPPA not targeted. Owner LC.

---

## 3. Certifications and assurance roadmap

| Item | When | Notes | Owner |
|---|---|---|---|
| OWASP ASVS L2 self-assessment | Phase 2 | [SECURITY §13](SECURITY_ARCHITECTURE.md) | SEC |
| GIGW 3.0 self-assessment + policy set | Phase 2 | [STQC_PREAUDIT_PACK](STQC_PREAUDIT_PACK.md) | PL |
| External VAPT + safe-to-host (CERT-In-empanelled / STQC) | Before any government hosting | Paid by the STD or the pilot budget | SEC |
| ISO/IEC 27001:2022 | 12–18 months after first state pilot | ISMS for Nestiq | SEC |
| ISO/IEC 27701 (privacy extension) | With 27001 | Maps well to DPDP | LC |
| ISO/IEC 42001 (AI management) | After 27001 | For AI features | AI |
| SOC 2 Type II | Only if B2B schools/insurers ask | — | SEC |
| STQC website quality certification | If a state requires it | — | PL |

---

## 4. Licences and partners needed

| Need | Who holds it | Our route |
|---|---|---|
| Aadhaar authentication / eKYC | UIDAI-approved AUA/KUA (the STD on Sarathi) | Never ourselves in Phase 1–3; hand-off |
| DigiLocker requester | NeGD-approved requester | Nestiq application post-event; or the STD's client ID |
| Sarathi APIs | NIC / MoRTH / STD | Government-run adapter |
| SMS | DLT-registered principal entity | Nestiq DLT or the STD's mGov gateway |
| WhatsApp | Meta verified business | Nestiq |
| Government hosting | MeitY-empanelled CSP / NIC | The STD's choice |
| Bhashini | MeitY / Bhashini onboarding | Via the STD partnership |
