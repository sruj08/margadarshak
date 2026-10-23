# Legal Memos
> Project: Margdarshak · Owner: Legal and compliance owner (LC) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [COMPLIANCE](COMPLIANCE.md) · [PRIVACY](PRIVACY.md) · [THREAT_MODEL](THREAT_MODEL.md) · [RISK_REGISTER](RISK_REGISTER.md) · Council: `../../../war-room/margdarshak-verification.md` §3.1 (G1–G14)

**Nature of these memos.** Short internal position notes written by the product team (Harvey Specter / R.S. Sharma seats) so engineering, pitch and copy stay inside the law. **They are not legal opinions.** Each lists what we verified, what we didn't, and the counsel question to ask before Phase 3 (Nestiq engages counsel by 2026-12-15, owner LC).

Format: **Question → Short answer → Facts and sources → Analysis → What we do (Hackathon build / Production) → Open questions → Status.**

| Memo | Topic | Status |
|---|---|---|
| M-01 | DigiLocker requester eligibility | VERIFIED (search excerpts of NeGD PDFs) |
| M-02 | Aadhaar non-use and offline QR/XML | SECONDARY |
| M-03 | Sarathi data access after 1 Oct 2026 | VERIFIED (single source) |
| M-04 | Impersonation and non-affiliation | [unverified] statutes + design |
| M-05 | Gemini terms and minors | VERIFIED (terms fetched 2026-10-23) |
| M-06 | Online Gaming Act 2025 | SECONDARY |
| M-07 | Intermediary liability for Live Intel | SECONDARY |
| M-08 | RTI template and letters (Advocates Act boundary) | CARRIED + [unverified] |
| M-09 | Filming public roads for the clip bank | [unverified] + design |

---

## M-01 DigiLocker requester eligibility

**Question.** Can Nestiq Private Limited become a DigiLocker requester so a citizen can share their Sarathi-issued DL with Margdarshak?

**Short answer.** Yes in principle, after the event, through NeGD's onboarding. Not in 48 hours.

**Facts and sources.**
- NeGD's Partner SOP and the Requester Terms of Use (June 2025) make registered Indian organisations eligible (Companies Act entities, MSMEs, Startup India entities, trusts and others), subject to: demonstrable experience of providing online services to citizens; a senior authorised representative; registration from the organisation's own email domain; NeGD verification; then integration → test/audit → go-live ([Partner SOP](https://cf-media.api-setu.in/resources/Partners-SOP.pdf), [Requester ToU, Jun 2025](https://cf-media.api-setu.in/resources/DigiLocker-Terms-of-User-Requester-june-2025.pdf); verification G2).
- The Requester API spec v1.12 uses OAuth 2.0 authorisation code + **PKCE (S256, required)**, a consent screen filtered by `req_doctype` (e.g. `DRVLC`), scope `partners.DRVLC`, issued URIs `in.gov.transport-DRVLC-<DL no.>`; the token response includes `dob`, `name`, `gender`, `eaadhaar` (Y/N) and `consent_valid_till` (`07-govt-plug-and-play.md` §A2).
- A third-party integrator reports **no sandbox**; testing hits production (`07` §A2, Sunbird RC).

**Analysis.** Eligibility depends on "demonstrable experience of online citizen services": a hackathon prototype probably doesn't meet it on day one; a live product with users, or a state pilot, would. The pull API returns more than we need (name, gender): our adapter must map the response to E-05 fields only and discard the rest (anti-corruption layer, data minimisation under DPDP s.6).

**What we do.**
- *Hackathon build:* `DigiLockerAdapter.mock` reproduces the real consent pattern (purpose, documents, validity) with a "simulated" chip.
- *Production:* (1) Nestiq applies with an email on its own company domain and a director as authorised representative; (2) or, in government mode, use the **STD's existing** DigiLocker client; (3) store only `dl_validity`, `classes`, `issue_date` in E-05; LL/DL number encrypted with blind index if needed; (4) consent artefact per pull (E-15).

**Open questions for counsel.** Does the Requester ToU allow use of DL data for reminders and analytics, or only for the stated verification purpose? Retention limits on pulled data?

**Status.** VERIFIED (search excerpts). Owner BE + LC. Checklist in `../10-government/` adoption doc.

---

## M-02 Aadhaar: non-use, and offline QR/XML

**Question.** Can Margdarshak do Aadhaar eKYC, read Aadhaar numbers, or verify the Aadhaar Secure QR?

**Short answer.** No eKYC; no Aadhaar numbers; no biometrics; no face match. Offline QR/XML verification is a legal route for Offline Verification Seeking Entities, but we keep it **mock-only** until counsel signs off, because it isn't needed: Sarathi already does Aadhaar-based eKYC.

**Facts and sources.**
- The *Aadhaar Authentication for Good Governance (Social Welfare, Innovation, Knowledge) Amendment Rules, 2025* (notified 31 Jan 2025) let non-government entities authenticate only after a proposal → UIDAI examination → ministry review → Central Government notification, for specified purposes, with DPDP and IT Act compliance ([Scroll](https://scroll.in/latest/1078654/it-ministry-notifies-rules-allowing-private-entities-to-carry-out-aadhaar-authentication), [Khaitan](https://www.khaitanco.com/thought-leadership/Aadhaar-authentication-for-private-entities), [S.S. Rana](https://ssrana.in/articles/aadhaar-authentication-by-private-entities-from-data-privacy-perspective/)).
- Offline verification (Secure QR, paperless offline e-KYC XML) is a separate route; UIDAI has an OVSE FAQ and do's/don'ts ([OVSE FAQ](https://uidai.gov.in/images/FAQ_OVSE.pdf), [do's and don'ts](https://www.uidai.gov.in/images/DosandDon_ts_for_Offline_Verification_Seeking_entities.pdf)). A Dec 2025 commentary says regulated entities must now apply under Reg. 13A for paperless offline e-KYC verification ([Vinod Kothari](https://vinodkothari.com/2025/12/a-new-way-to-verify-aadhaar-offline-introduction-of-face-matching/)). Onward sharing of offline e-KYC data engages ss.29 and 37 of the Aadhaar Act (verification G1).
- DigiLocker returns `eaadhaar=Y/N` and offers an e-Aadhaar XML endpoint to approved requesters (`07` §A2).

**Analysis.** A private entity doing eKYC without approval would breach the Act and the 2025 Rules. Even lawful offline verification brings OVSE duties (consent, purpose, no storage of the number, security) and possibly a Reg. 13A application, for no product gain: our eligibility needs only a DOB, which the user can enter and Sarathi verifies anyway. Year-only DOB on Aadhaar (EC-01) is solved by asking for another DOB document, not by reading Aadhaar.

**What we do.**
- *Hackathon build:* never collect; PII guards block Aadhaar/VID/OTP patterns (Verhoeff check) on client, server and in the ADK plugin; "simulated: in production this step runs on Sarathi" eKYC screen; face match removed; `AadhaarOfflineAdapter` uses UIDAI sample data at most and is disabled in prod-demo.
- *Production:* government mode: the STD's Sarathi flow performs eKYC; Margdarshak redirects and receives only `ekyc_done=true` + timestamp. Independent mode: hand-off only.

**Open questions for counsel.** If a state asks us to verify Secure QR on its behalf, are we its agent (its OVSE status) or do we need our own? Exact current text of s.8A and Reg. 13A.

**Status.** SECONDARY (gazette not read; D-25 re-verify the 2025 rule text before stage, owner LC, 2026-10-24). Pitch wording: "We never touch Aadhaar. Sarathi does that, as it already does."

---

## M-03 Sarathi data access after 1 October 2026

**Question.** Can Margdarshak call Sarathi/Vahan APIs, or scrape Sarathi, to fetch status, slots or fees?

**Short answer.** No private access exists now, and none should be assumed. Never scrape. Design for a government-run adapter.

**Facts and sources.**
- API Setu grants access only after the publisher approves ([API Setu SOP](https://cdn.apisetu.gov.in/portal/assets/sop-apisetu-v0.pdf)). The public MoRTH listing describes DL/RC pull into DigiLocker, not a third-party verification endpoint (`07` §A1).
- NIC's RTI reply dated 16 Oct 2026: "the arrangement for sharing information with private entities was discontinued with effect from 01.10.2026", after a CERT-In disclosure of VAHAN records sold on Telegram ([IFF, 20 Oct 2026](https://internetfreedom.in/who-reads-your-vehicle-record-nic-gave-us-numbers-morth-gave-us-a-generic-webpage/)). Whether it names Sarathi explicitly is not stated (verification G3).
- Commercial "DL verification APIs" exist, upstream unknown (`07` §A1).

**Analysis.** Using a reseller whose upstream may be the discontinued arrangement creates legal and reputational risk for a product pitched to government. Automated access to Sarathi without authorisation risks IT Act s.43/s.66 exposure and would kill adoption. The discontinuation strengthens our positioning: data stays with NIC; the front end runs inside NIC with NIC's adapter.

**What we do.**
- *Hackathon build:* `SarathiAdapter` in `mock` and `deeplink` modes only; slot watcher is reminder-only (F-10); CI lint blocks HTTP clients to `*.parivahan.gov.in` outside the adapter package; no reseller APIs.
- *Production:* `SarathiAdapter.real` implemented by or with NIC under an STD MoU; contract tests shared with NIC.
- *Pitch line:* "Since 1 Oct, MoRTH stopped private data sharing. Our design never needed it." Never "integrated with Sarathi" (D-19).

**Open questions.** Does the discontinuation cover Sarathi and DigiLocker-mediated pulls (we believe DigiLocker consented pulls are a different channel)? Ask NIC through the pilot STD.

**Status.** VERIFIED (single advocacy source quoting the RTI reply). Owner PL + BE.

---

## M-04 Impersonation and non-affiliation

**Question.** How do we present a government-adoptable front end without impersonating MoRTH, NIC or a state?

**Short answer.** No emblem, no Parivahan logo, no "official", no gov-style domain or header, a first-launch disclaimer and a persistent non-affiliation footer. In government mode the STD brands it under its own authority.

**Facts and sources.**
- Fake "apply" apps (1M+ installs), fake e-challan APKs and a "SYSTEM HACKED" banner on the government homepage are live trust failures (PROJECT_BRIEF §2.6; journey map row 16).
- The council cut the team report's "Official service of MoRTH" trust strip as impersonation (verification §1 row 3, D-01).
- Instruments to respect: the State Emblem of India (Prohibition of Improper Use) Act 2005; the Emblems and Names (Prevention of Improper Use) Act 1950; IT Act s.66D (cheating by personation using a computer resource); consumer law on misleading representation; Google Play's misrepresentation policy for apps carrying government information (HUNCH: source link + non-affiliation disclosure) **[statute applicability not verified; LC, 2026-11-15]**.

**Analysis.** Even accidental resemblance hurts twice: legal exposure, and teaching citizens to trust look-alikes. Our scam shield (F-33) would be hypocritical if our own UI looked governmental.

**What we do.**
- Footer on every page: *"Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State Transport Department. Uses simulated government data."*
- First-launch disclaimer screen (EN + HI), dismissible, re-shown after major versions.
- Domain contains none of "gov", "parivahan", "sarathi"; no tricolour ribbon header; UX4G tokens used as a neutral skin, not government branding.
- "Simulated" chips on every mock government screen.
- Banned wording lint (D-19): "official", "first", "integrated with Sarathi/Aadhaar", "verified licence", "STQC-certified", "DPDP-compliant".
- Brand-abuse playbook (THREAT_MODEL AC-04): registrar/host abuse reports, Meta and Google Play impersonation reports, cybercrime.gov.in / 1930, CERT-In for malware.
- Trademark: IP India search and filing before post-event launch (COMPLIANCE C-17).

**Status.** Design decided; statutes [unverified]. Owner PL + LC.

---

## M-05 Gemini API terms and minors

**Question.** Can a learner app with 16–17-year-old users use the Gemini API?

**Short answer.** Only for adults, only on the paid tier, and with an open question about the "likely to be accessed by" clause that counsel must answer before launch.

**Facts (quoted from [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms), last updated 2026-04-28, fetched 2026-10-23).**
- "You must be 18 years of age or older to use the APIs."
- You may not use the Services in a client "...that is directed towards or is likely to be accessed by individuals under the age of 18."
- Unpaid Services: "human reviewers may read, annotate, and process your API input and output"; "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
- Paid Services: Google doesn't use prompts to improve its products; "Google logs prompts and responses for a limited period of time, solely for detecting and preventing violations."
- "This data may be stored transiently or cached in any country in which Google or its agents maintain facilities."
- "Don't rely on the Services for medical, mental health, legal, financial, or other professional advice."
- A developer forum thread raises exactly our case (general-audience app with an adult-only AI feature) ([forum](https://discuss.ai.google.dev/t/age-restrictions-in-gemini-api-terms-general-audience-app-rated-3-with-an-adult-only-ai-feature/179916)); no authoritative answer recorded (`04-ai-adk-gemini.md` §0.1).

**Analysis.** The core users are 18–19 (P-01, P-02). 16–17-year-olds are a legitimate minority (≤ 50 cc class). Gating AI server-side to verified-by-declaration 18+ addresses the first clause; whether the **client** (the app) is "likely to be accessed by" minors is a fact question, and an honest reading says some minors will access the app. Mitigations reduce but may not remove the risk: the AI features are a separate, adult-only area; minors are routed to a rules-only mode; no AI call is ever made for a minor's request. DPDP s.9 independently requires us not to track minors.

**What we do.**
- *Hackathon build:* server-side `age_band=18_plus` + `PUR-AI-FEATURES` consent before any Gemini/Sarvam call (SECURITY §3.3); paid tier before any real user (field study included); free tier for synthetic data only; AI never gives legal/medical advice (golden hour static, letters templated).
- *Production:* counsel opinion; option A: Vertex AI enterprise terms in an Indian region (data residency page lists Mumbai `asia-south1` for several Gemini models; check current models); option B: route AI through Bhashini/local Indic models behind the AI port for any surface minors could reach.

**Status.** VERIFIED (terms text). Open question logged as R-13. Owner AI + LC.

---

## M-06 Online Gaming Act 2025

**Question.** Does the game layer (F-23, F-24, F-26) fall under the Promotion and Regulation of Online Gaming Act 2025?

**Short answer.** It is an online social/educational game, which the Act promotes; it must never become an online money game.

**Facts and sources.** The Act bans online money games and their promotion and financial facilitation, and promotes and recognises online social and educational games; Rules in force 1 May 2026 provide a mechanism to decide money vs social game ([India Code](https://www.indiacode.nic.in/bitstream/123456789/22148/1/a2025-32.pdf), [PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/apr/doc2026430859401.pdf), [Drishti](https://www.drishtiias.com/daily-updates/daily-news-editorials/prog-act-2025-and-online-gaming-dilemma/print_manually); verification G9).

**Analysis.** A money game turns on deposits with an expectation of winnings. We take no deposits and give no winnings. Risks would arise from: paid entry to tournaments, redeemable XP, cash or voucher prizes, crypto/NFT badges, or insurer discounts tied to a game score.

**What we do.** No entry fees; XP, badges and ranks are non-transferable and non-redeemable; no cash, vouchers, tokens or prizes; the Pro tier (F-40) is a B2B subscription for schools, not a game purchase; share cards carry no prize claims; future insurer benefits tie to completed training modules, not to game results; labelled "practice and familiarisation, not certification" (D-11). Keep the option to seek educational-game recognition.

**Status.** SECONDARY. Owner LC + PL.

---

## M-07 Intermediary liability for RTO Live Intel

**Question.** Does hosting crowd reports about RTOs make Nestiq an intermediary, and what must we do to keep safe harbour and avoid defamation?

**Short answer.** Treat Live Intel (and squads, school feedback) as intermediary functions: follow IT Rules 2021 due diligence, and design out the harmful content (no free text, no names).

**Facts and sources.**
- IT Act s.79 safe harbour depends on due diligence under the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021 (verification G12, HUNCH there; model knowledge for the base rules **[unverified]**).
- Amendment notified 10 Feb 2026, in force 20 Feb 2026: takedown of court/government-flagged unlawful content **within 3 hours** (from 36); 2-hour window for non-consensual intimate imagery; labelling of synthetically generated information with provenance metadata ([SS Rana](https://ssrana.in/articles/india-tightens-oversight-on-ai-generated-content-under-it-rules/), [Business Today](https://www.businesstoday.in/amp/technology/story/govt-tightens-rules-on-ai-generated-content-mandates-labels-and-faster-takedowns-515505-2026-02-10), [IFF critique](https://internetfreedom.in/it-intermediary-amendment-rules-2026-contradict-their-purpose/)).
- Grievance officer duties (acknowledge in 24 h, resolve in 15 days) **[2021 base text, unverified re-read]**.

**Analysis.** The biggest risks are defamation of named officials and bribery allegations (criminal-law territory), and touts manipulating the feed (THREAT_MODEL AC-01). A structured form removes almost all unlawful-content vectors; k ≥ 5 removes single-report harm; routing corruption reports to ACB/vigilance and CPGRAMS keeps us out of hosting allegations.

**What we do.**
- Fields only: slot-release time seen, documents asked (checklist), track type, wait-time band, test-day steps checked. No free text, no names of officials, examiners or agents, no photos.
- Show a cell only at k ≥ 5 reports in 30 days; seeded rows carry a "sample data" chip.
- "Someone asked me for money / offered a setting" → a static screen linking the state ACB/vigilance and CPGRAMS; we never publish or store the allegation.
- Grievance officer in the footer; report button on every cell; moderation queue (n8n → API); SLAs: government/court orders 3 h, user grievances 24 h ack / 15 days.
- Terms of use with prohibited content per Rule 3(1)(b); privacy policy; repeat-abuser bans.

**Status.** SECONDARY. Owner LC + GO.

---

## M-08 RTI template legality and the letters boundary (Advocates Act)

**Question.** Can we give users an RTI application template and escalation letters without practising law?

**Short answer.** Yes, as fill-in templates the user completes and sends, with no legal advice and no filing on their behalf.

**Facts and sources.**
- RTI Act 2005: s.6 application to the PIO with the prescribed fee (₹10 under central rules), s.7 reply within 30 days, s.8 exemptions (verification row 13, CARRIED). States set their own fee rules for state public authorities **[verify per state; CL in rule pack]**.
- No published right to the examiner's sheet exists; some automated tracks record video (Punjab) (verification row 13).
- Advocates Act 1961: practising law is reserved to enrolled advocates (ss.29, 33) **[unverified sections]**. Templates and general information are widely published by government and NGOs.

**Analysis.** A template with blanks, general information about the RTI process and the user's own facts is information, not legal practice. Risk rises if we tailor legal strategy, predict outcomes, draft pleadings, or file on users' behalf (a helper filing via CSC is the user's own act through their agent, with consent).

**What we do.** RTI template asks for (a) the user's own test record and result sheet, (b) the published evaluation criteria for the track, (c) any video recording "if it exists" (never promised). Escalation letters (F-14): facts only (application number entered by the user on the device, dates, stage), polite, addressed to the RTO/grievance cell; no accusations; user approves and sends; label "Template, not legal advice. For disputes, contact your State Legal Services Authority." AI never writes legal text (M-02..M-05 agents have no letter tool).

**Status.** CARRIED + [unverified] Advocates Act sections. Owner LC + CL.

---

## M-09 Filming public roads for the Nazar clip bank

**Question.** Can we film public roads (including J&K roads) for hazard clips and publish them under CC-BY?

**Short answer.** Yes, with safeguards: passenger or fixed-mount filming only, no filming of prohibited places or security forces, blur faces and plates, strip audio and GPS, contributor licences, takedown on request.

**Facts and sources.**
- No general permit is needed to film from a vehicle on a public road in India **[unverified as a general proposition; LC, 2026-11-15]**. Drones need separate permissions (Drone Rules 2021) and are out of scope.
- MV Act s.184 covers dangerous driving including handheld device use, so the rider must never film (verification §3.3).
- Official Secrets Act 1923 s.3 prohibits photographing prohibited places; J&K roads (NH44 and others) pass defence installations and carry army convoys **[unverified specifics; CL to brief contributors]**.
- Bystander privacy: footage of identifiable people and plates is personal data under DPDP once processed by us; blur makes it non-identifiable for publication (PRIVACY §7).
- Copyright: the person filming owns the footage; we take a licence to publish under CC-BY 4.0.

**What we do.**
- Contributor agreement: CC-BY 4.0 release, warranty of lawful filming, no filming by the rider, no prohibited places, convoys, checkpoints or accidents with victims identifiable; no staged stunts.
- Pipeline (Render Workflows): transcode → blur faces/plates (M-09) → strip audio + EXIF/GPS → propose windows (M-06, Gemini video, offline) → two human raters → 100% blur audit → publish.
- No gore; accident aftermath clips excluded (D-11; fear imagery backfires, `05-psychology.md` §3).
- "Report this clip": takedown within 72 h.

**Status.** [unverified] statute points + design. Owner CL + LC.
