# Glossary
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Product/design lead · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) · [BACKLOG](BACKLOG.md) · [FIELD_STUDY](FIELD_STUDY.md) · [Localization](../02-design/LOCALIZATION.md) · [Compliance](../06-security-compliance/COMPLIANCE.md)

Definitions are written for this project. Where a term carries a legal or numeric fact, the source file in `research/` is named; anything not re-checked is marked **[unverified]** with an owner. Legal definitions here are summaries, not legal advice: the rule-pack row or the statute is authoritative.

**Contents:** §1 Licence journey · §2 Vehicle classes · §3 Forms and documents · §4 Laws, rules and sections · §5 Indian institutions, systems and acronyms · §6 Margdarshak product terms · §7 Engineering and AI terms · §8 Research and statistics terms · §9 Hindi/Dogri words used in the product

---

## 1. Licence journey terms

| Term | Meaning | Source / note |
|---|---|---|
| **Learner's Licence (LL)** | The permit to practise driving under conditions (L-plate, a licensed person beside you). Issued after the LL test; valid 6 months | CMVR r.3 (conditions); `02-rules-process.md` §4 |
| **Driving Licence (DL)** | The full licence for one or more vehicle classes, issued after the driving test; printed as a Form 7 card and available in DigiLocker/mParivahan | `02-rules-process.md` §5, §8 |
| **LL test** | A multiple-choice test on signs, rules of the road and the MV Act. Format varies by state; J&K reported as 10 questions, 6 to pass; a 15-question/9-to-pass default is commonly cited but unverified | CMVR r.11; Kashmir Life (Dec 2025) via `02-rules-process.md` |
| **Online / at-home LL test** | The LL test taken on a phone or laptop after Aadhaar-based authentication on Sarathi, or at a CSC; not offered in every state (Kerala scrapped it in 2022) | `02-rules-process.md` §4; EC-10 |
| **30-day minimum wait** | The driving test can be taken only after 30 days from LL issue (day 31 at the earliest) | `02-rules-process.md` §4 |
| **Driving test (DL test)** | The practical test on an RTO ground or an automated track, on your own vehicle with L-plates | CMVR r.14–15 |
| **Retest gap** | A failed driving test can be retaken no earlier than 7 days later, with a fresh appointment and fee | `02-rules-process.md` §5 (low-reliability source; pack row confidence medium) |
| **Remedial training** | Training a candidate must complete after repeated driving-test fails, as the rule pack states | PROJECT_BRIEF §2; EC-08 |
| **LL expiry** | The LL lapses after 6 months; renewing creates a new application number that can break a booked slot | EC-07; journey map row 7 |
| **Slot** | An appointment for the driving test at an office; scarce in many RTOs | F-10 |
| **RTO / ARTO** | Regional Transport Office / Assistant (or Additional) Regional Transport Office: the offices that run tests and issue licences | — |
| **ADTT** | Automated Driving Test Track: sensor/camera tracks that score the test (Delhi reports about 24 parameters) | `02-rules-process.md` §5 |
| **ADTC** | Accredited Driver Training Centre (rules in effect 1 Jul 2021): graduates are exempt from the RTO driving test under MVA s.9(3) | `02-rules-process.md` §6 |
| **Figure-8 / 8-track** | The two-wheeler test layout; a "foot down" is a commonly reported fault | 08 §G5 |
| **H-track / S-track** | Car test layouts; J&K (Kashmir) replaced the H-track with an S-track for LMVs | `02-rules-process.md` §5 |
| **Gradient start** | Starting on a slope without rolling back | 08 §G5 |
| **L-plate** | The "L" sign on a learner's vehicle | CMVR r.3 |
| **Hazard Perception Test (HPT)** | A video test where you tap when you perceive a developing hazard. Kerala announced one from 1 Dec 2026: 10 clips × 10 marks, pass 60/100, as reported (circular text not found) | Onmanorama 14 Sep 2026 via 08 §G1; EC-28 |
| **Approval** | The step after a pass when the RTO approves the DL for printing | F-14 |
| **Smart card** | The printed Form 7 DL card (₹200 surcharge) | CMVR r.32; `02-rules-process.md` §7 |
| **Government fee (one class)** | ₹700 = LL ₹150 + LL test ₹50 + driving test ₹300 + DL issue ₹200; plus ₹200 for the card; a second class adds about ₹450. States may add service charges | CMVR r.32; `fees.json`; D-06 |
| **Agent** | A private intermediary who sells help with the licence process (₹2k–20k reported); not licensed by the MVA or CMVR | PROJECT_BRIEF §2; `02-rules-process.md` §9 |
| **"Setting"** | Colloquial term for an offer of an arranged result or slot; treated as a report to deep-link to vigilance (EC-24), never hosted | EC-24 |
| **Renewal** | Re-validating a DL; no grace period since 2019; more than 1 year late means a retest | `03-lifecycle.md` §0.1–0.2; EC-16 |
| **Add a class / endorsement** | Adding a vehicle class to an existing licence | F-16 |
| **Duplicate DL** | A replacement for a lost or damaged licence | F-16 |
| **IDP** | International Driving Permit, for DL holders driving abroad | F-16; EC-12 |
| **Challan / e-challan** | A traffic fine notice; fake e-challan links and APKs are an active scam | F-15, F-33 |
| **PUC** | Pollution Under Control certificate for a vehicle | F-15 |
| **RC** | Registration Certificate of a vehicle (held in Vahan) | — |
| **Third-party insurance / PA cover** | Mandatory insurance for damage to others; personal-accident cover for the owner-driver (₹15 lakh in the product checklist) | F-15 (re-verify the amount before stage: MD-423) |
| **Golden hour** | The first hour after a crash, when care matters most; Margdarshak's card is static, cited, with a one-tap 112 | F-15; D-14 |
| **112** | India's single emergency number | — |
| **Good Samaritan** | A bystander who helps a crash victim; protected under MVA s.134A | `02-accident-curriculum.md` §1.10 |
| **Rah-Veer** | A government reward scheme for Good Samaritans; amounts stay out of the product until re-verified | D-25; MD-622 |

## 2. Vehicle classes (codes as Sarathi shows them)

| Code | Plain name | Minimum age (as sourced) | Notes |
|---|---|---|---|
| **MC50CC** | Motorcycle up to 50 cc (gearless) | 16, with parent/guardian consent | Most scooters exceed 50 cc, so the 16–17 path is narrow (EC-05); an under-18 learner uses family mode in a parent's account (D-13 revised) |
| **MCWOG** | Motorcycle without gear (scooter) | 18 (above 50 cc) | Content depth: deep |
| **MCWG** | Motorcycle with gear | 18 | Content depth: deep |
| **LMV-NT** | Light Motor Vehicle, non-transport (car) | 18 | Content depth: deep. SC (6 Nov 2024, *Bajaj Allianz v Rambha Devi*) held LMV holders may drive transport vehicles ≤ 7,500 kg; shown with "verify for commercial use" |
| **LMV-TR** | Light Motor Vehicle, transport | 20 | Transport rules flagged "verify" (LMV-holding prerequisite unverified after 2019) |
| **e-Rickshaw / e-Cart** | Battery-operated three-wheelers for passengers/goods | As the state lists | Form 1A required in Delhi; content "coming" |
| **MGV / HGMV** | Medium / Heavy Goods Motor Vehicle | 20 | Transport; medical certificate |
| **HPMV / PSV bus** | Heavy Passenger Motor Vehicle / Public Service Vehicle | 20 | Transport; medical certificate |
| **HTV** | Heavy Transport Vehicle (some states' label) | 20 | Transport |
| **Adapted vehicle / invalid carriage** | A vehicle adapted for a person with a disability | As the state lists | EC-13; rights card |

Source: `research/ps1-current-state/02-rules-process.md` §2; `research/ps1-deep/03-lifecycle.md` §0.3; verification §1 row 2.

## 3. Forms and documents

| Term | Meaning | Source |
|---|---|---|
| **Form 1** | Self-declaration of physical fitness (a check box on Sarathi for non-transport classes) | `02-rules-process.md` §3 |
| **Form 1A** | Medical certificate from a registered medical practitioner: for applicants over 40 and all transport classes; for over-40s the RTO must approve before the online LL test | `02-rules-process.md` §3; EC-04 |
| **Form 2** | LL application, generated online on Sarathi | `02-rules-process.md` §3 |
| **Form 4** | DL application on Sarathi, within LL validity after day 30 | `02-rules-process.md` §5 |
| **Form 7** | The DL card (PVC smart card or laminated card) | `02-rules-process.md` §8 |
| **Application number** | Sarathi's reference for an application; re-entered several times in the current flow | `01-sarathi-screens.md` |
| **Proof of age / address** | Documents accepted per CMVR r.4 and the state pack | CMVR r.4 |
| **Relation line (S/o, D/o, C/o)** | "Son of / Daughter of / Care of" on Aadhaar; a blank line can block the application (EC-03) | journey map row 2 |
| **RTI application (s.6)** | A Right to Information request to the office's Public Information Officer (₹10 fee, reply in 30 days); Margdarshak offers a template only | RTI Act 2005; D-14 |
| **Escalation letter** | A facts-only letter the user approves and sends about a stalled step; never filed for them | F-14 |
| **Practice Record** | The user-held export of in-app practice facts (see §6) | F-28 |

## 4. Laws, rules and sections

| Term | Meaning | Source / status |
|---|---|---|
| **MVA / MV Act 1988** | Motor Vehicles Act 1988, as amended by the MV (Amendment) Act 2019: who may drive, licences, tests, schools | `02-rules-process.md` §1 |
| **MVA s.3, s.4** | No driving without a DL; minimum ages | `02-rules-process.md` §1 |
| **MVA s.7** | Restrictions on transport-vehicle LLs (the LMV-prerequisite reading is flagged unverified post-2019) | verification §1 row 2 |
| **MVA s.9(3)** | Test exemption for ADTC graduates (as reported) | `02-rules-process.md` §6 |
| **MVA s.14** | Validity of licences (as amended 2019) | `02-rules-process.md` §8 [MK] |
| **MVA s.129** | Protective headgear (helmets); not re-fetched, so `verified:false` until checked | 08 §3.12 |
| **MVA s.134A** | Protection of Good Samaritans | `02-accident-curriculum.md` §1.10 |
| **MVA s.184** | Driving dangerously, cited for handset use while driving; basis of the riding lock | verification §1 row 11 |
| **MVA s.199A** | Offences by juveniles (guardian/owner liability) | `03-lifecycle.md` §0.4; EC-17 |
| **CMVR 1989** | Central Motor Vehicles Rules: procedure (r.3 LL conditions, r.4 proof, r.5 medical, r.11 LL test, r.14–15 DL test, r.32 fees, r.139 digital documents) | `02-rules-process.md` §1 |
| **MV Driving Regulations 2017** | Driving regulations (e.g. downhill gives way to uphill: not re-fetched, `verified:false`) | 08 §G7 |
| **DPDP Act 2023 / DPDP Rules 2025** | Digital Personal Data Protection Act and Rules: purpose-bound consent, children = under 18 with verifiable parental consent, rights, grievance. We say "built to DPDP Rules", nothing stronger | verification VG-7; D-19 |
| **Aadhaar Act / 2025 Good Governance Amendment Rules** | Aadhaar authentication by private entities only after a proposal, UIDAI examination and Central Government notification; offline verification is a separate route | verification VG-1 (SECONDARY: gazette not read) |
| **IT Act 2000 s.43** | Penalty for unauthorised access; one reason we never scrape Sarathi or run booking bots | verification VG-3 |
| **IT Rules 2021** | Intermediary guidelines: grievance officer, takedown on notice (relevant to Live Intel and squads) | verification VG-12 [unverified details; owner PD, MD-620] |
| **CERT-In Directions (28 Apr 2022)** | Report specified incidents within 6 hours; keep ICT logs 180 days in India; sync clocks to NIC/NPL NTP | verification VG-6 (SECONDARY) |
| **GIGW 3.0** | Guidelines for Indian Government Websites and Apps: accessibility, security audit before hosting (guideline 5.3.1, primary text not yet read) | verification VG-5 |
| **WCAG 2.1 AA** | Web Content Accessibility Guidelines level AA; the target for every screen | F-52 |
| **RPwD Act 2016** | Rights of Persons with Disabilities Act; obligations for future government hosting (sections to be checked before citing) | verification §3.3 [unverified; owner PD] |
| **CCPA Dark Patterns Guidelines (30 Nov 2023)** | 13 specified dark patterns banned for platforms; each is a lint rule here | 08 §4.10 |
| **Online Gaming Act 2025** | Promotion and Regulation of Online Gaming Act: bans online money games, recognises social/educational games; Rules in force 1 May 2026 | verification VG-9 (SECONDARY) |
| **TRAI DLT** | TRAI's Distributed Ledger Technology registration for commercial SMS (entity, headers, templates); SMS stays off until done | verification VG-11 (HUNCH) |
| **RTI Act 2005** | Right to Information Act | — |
| **Gemini API terms** | Account holder must be 18+; services "likely to be accessed by" under-18s are restricted (open legal item R-13); the free tier allows human review of prompts | verification VG-8 |
| **PSGA (J&K)** | J&K Public Services Guarantee Act: time limits for services; DL timelines not retrieved (unknown) | `02-rules-process.md` §8 |
| **RTS Act** | Right to Services acts in other states (e.g. Kerala RTS Act 2012); DL timelines unknown | `02-rules-process.md` §8 |
| **OSS Policy 2015** | Policy on Adoption of Open Source Software for GoI: OSS preferred for new e-Gov applications | `07-govt-plug-and-play.md` A9 |

## 5. Indian institutions, systems and acronyms

| Acronym | Expansion | What it means for us |
|---|---|---|
| **MoRTH** | Ministry of Road Transport and Highways | Owns Parivahan/Sarathi policy; we are not affiliated |
| **NIC** | National Informatics Centre | Builds and runs Sarathi and Vahan; the natural host for an adopted front end |
| **STD** | State Transport Department | The adopting customer; edits its rule pack |
| **MVD** | Motor Vehicles Department (e.g. Kerala MVD) | Kerala's licensing authority (HPT) |
| **Parivahan** | MoRTH's transport services portal (parivahan.gov.in) | ~120 links on the homepage, about 1 in 10 relevant to a first licence |
| **Sarathi** | NIC's driving-licence system (sarathi.parivahan.gov.in) | The system of record; all eKYC, OTP, payment and submission happen there |
| **Vahan** | NIC's vehicle registration system | RC data; no private access |
| **mParivahan** | MoRTH's mobile app for DL/RC | Pitch: Margdarshak could be an entry card inside it |
| **UMANG** | Unified Mobile Application for New-age Governance | Another host app for an entry card |
| **DigiLocker** | MeitY/NeGD's document wallet; Requester API with OAuth 2.0 + PKCE and the `partners.DRVLC` scope for DLs | Production identity/document path after requester onboarding (MD-701) |
| **API Setu** | GoI's API exchange; access only after the publisher approves | No private Sarathi API is listed for verification/write |
| **NeGD** | National e-Governance Division (MeitY) | Verifies DigiLocker requesters |
| **MeitY** | Ministry of Electronics and Information Technology | Cloud empanelment, Bhashini, UX4G |
| **MeghRaj / GI Cloud** | Government cloud initiative; MeitY-empanelled CSPs after STQC audit | Production hosting target |
| **CSP** | Cloud Service Provider | — |
| **STQC** | Standardisation Testing and Quality Certification Directorate | Security audit / safe-to-host; we say "audit-ready" |
| **VAPT** | Vulnerability Assessment and Penetration Testing | Pre-audit pack MD-609 |
| **CERT-In** | Indian Computer Emergency Response Team | 6-hour reporting, 180-day logs |
| **NPL** | National Physical Laboratory (time standard) | NTP source with NIC servers |
| **UIDAI** | Unique Identification Authority of India | Aadhaar issuer |
| **AUA / KUA** | Authentication User Agency / e-KYC User Agency | Licensed Aadhaar users; we are neither |
| **OVSE** | Offline Verification Seeking Entity | Route for Secure QR / Paperless XML verification (P7, legal gate) |
| **eKYC** | Electronic Know Your Customer | Done by Sarathi, never by Margdarshak |
| **OTP** | One-Time Password | Never typed into or stored by Margdarshak or its AI |
| **Bhashini / ULCA** | National language-technology mission / Universal Language Contribution API | Government-preferred speech/translation path (P7) |
| **UX4G** | MeitY's design system (GIGW-compliant components, Figma kit, npm) | Tenant skin target |
| **PayGov India** | MeitY's government payment gateway | Possible payment redirect target, per state |
| **CSC** | Common Services Centre | Where many people take the J&K LL test; Helper persona |
| **CPGRAMS** | Centralised Public Grievance Redress and Monitoring System | Where users file grievances themselves |
| **ACB** | Anti-Corruption Bureau (state vigilance) | Where corruption reports are deep-linked |
| **PIO** | Public Information Officer (RTI) | Recipient of the RTI template |
| **Jan Parichay / MeriPehchaan** | GoI single sign-on services | Production sign-in via adapter (unverified integration details) |
| **GeM** | Government e-Marketplace | Possible procurement route [unverified mechanics; owner PD, MD-720] |
| **IndEA** | India Enterprise Architecture framework (2018) | Architecture alignment for adoption |
| **DEPA** | Data Empowerment and Protection Architecture (NITI Aayog) | Model for our consent artefacts |
| **AA** | Account Aggregator (RBI framework) | Origin of the consent-artefact pattern |
| **DPI** | Digital Public Infrastructure | How we position the adapter spec and clip bank |
| **iRAD** | Integrated Road Accident Database | Needed for route-risk (cut to roadmap) |
| **RAI** | *Road Accidents in India* (MoRTH annual report) | Source of 2023 crash statistics |
| **BWMI** | The hackathon-ideas benchmark used in research (26 Parivahan redesigns in its top 250) | `G-inspiration-library.md` §1.5 |
| **ISI mark / IS 4151** | Bureau of Indian Standards mark; IS 4151 is the helmet standard | F-15, G8 |
| **Bharat NCAP** | India's car crash-test rating programme | F-15 |
| **ABS / CBS** | Anti-lock Braking System / Combined Braking System | F-15 |
| **J&K** | Jammu and Kashmir (UT); the demo tenant | — |
| **SC** | Supreme Court of India | — |
| **PIL** | Public Interest Litigation | e.g. the Allahabad HC PIL on Aadhaar-based LLs (`02-rules-process.md` §1) |

## 6. Margdarshak product terms

| Term | Meaning |
|---|---|
| **Margdarshak** | "The one who shows the way"; the product. A reference citizen front end plus an open adapter spec |
| **Team Chanakya** | The team (@Nestiq Private Limited) |
| **Stages S0–S9, S6F** | S0 Home · S1 Licence plan · S2 Apply for LL · S3 LL test · S4 30-day bridge · S5 Book DL test · S6 Driving test · S6F Fail and recover · S7 Licence issued · S8 New-rider year · S9 Renew / fix / family |
| **Licence plan / plan card** | The 3-tap answer: eligible classes, steps, max RTO visits, earliest licence date, computed fee, documents, warnings (F-02) |
| **Blocker** | A rule row that would stop or delay an application (EC-01..EC-20), with fix, source and confidence (F-04) |
| **Hand-off (Mode A / Mode B)** | Mode A: prefilled copy-pack + deep link to Sarathi, works today. Mode B: the government-hosted adapter flow, once a state adopts (F-07) |
| **Copy-pack** | The list of field values with copy buttons for the Sarathi screens |
| **Stage-aware home** | The home that shows the single primary action for the user's stage (F-08) |
| **Case / case clock** | One licence journey (E-02) / its timeline: day-30 unlock, LL expiry from day 180, test eve, approval chase (F-09) |
| **Rule pack** | Versioned, signed state rules as data, each row with `source`, `verified_on`, `confidence`, `approver` (E-08) |
| **SourceChip / SimulatedChip** | UI chips that show where a value came from / that a value came from a mock adapter |
| **Tenant** | A state configuration: rule pack, adapter modes, languages, theme, flags (E-31) |
| **Adapter (mock / deeplink / real)** | An implementation of a government port; all pass the same contract tests (F-56) |
| **Nazar** | "Sight"; the hazard-perception practice on real Indian clips in Kerala's announced format (F-23) |
| **Nazar Score** | Mean of the last 3 mock sessions on unseen clips with trust ≥ 0.6 (08 §G1) |
| **Hazard window** | The time span in a clip in which a response to a hazard counts, set by two independent raters |
| **Clip bank** | Blurred, rated clips published under CC-BY 4.0 |
| **Test Readiness Score** | 100 × weighted topic mastery − calibration penalty, shown as "78 = knowledge 84 − calibration 6"; the 85 gate is advisory (F-21) |
| **Road Readiness** | The survival-skill nodes + Nazar Score; never mixed into the LL score |
| **Debrief (Auto notes / Coach notes)** | The 4-part card after a session; "Auto notes" = template, "Coach notes" = AI-narrated (F-25) |
| **Finding / facts** | A deterministic observation from scoring (e.g. `NAZ_LATE_RESPONSE`) and the numbers attached to it |
| **Drill** | The next practice item suggested by the debrief, chosen from candidates computed in code |
| **Record-then-score** | Commentary mode: speak over a clip, transcribe afterwards, match mentions to hazards in code (D-12) |
| **Practice Record** | User-held export of in-app practice facts, signed only for what happened in-app; never "verified" (F-28) |
| **Live Intel** | Structured, moderated crowd reports per office, shown at k ≥ 5 (F-11) |
| **Khud Licence** | A self-declared badge: "got my DL without an agent" |
| **Squad** | 3–5 adult friends in a co-op group; the score rewards anticipation and calibration |
| **Ranks: Gali → Mohalla → Shehar → Highway → Ghat** | Lane → neighbourhood → city → highway → hill; gated by mastery, not XP |
| **Nazar Pledge** | The voluntary novice pledge in the new-rider year |
| **Riding lock** | The UI shows only "Pull over to use Margdarshak" when the device moves faster than about 10 km/h |
| **Helper mode / family mode** | A consented link for a cyber-café/CSC helper or a family member to manage someone's case (F-17). Family mode also holds a minor's case inside a parent's (adult) account, with verifiable parental consent; the minor gets the full product, including AI (D-13 revised) |
| **Lite mode** | The < 300 KB first-load, offline-capable path for low-end phones (F-51) |
| **Track Test Twin** | Layout-familiarisation simulation of the driving-test track (G5) |
| **Scam shield / scam checker** | Rules decide whether a message matches a known government sender; AI only explains; no "safe" verdict (F-33) |
| **Journey-test lab** | An unbranded, `noindex` research replica of the observed Sarathi sequence, used only in the field study (F-57) |
| **Persona switcher** | A demo-tenant control that loads synthetic personas P-01..P-07 |
| **Showcase ladder** | The ordered rungs of the hackathon build (IMPLEMENTATION_PLAN §3) |
| **G0** | The gate at the confirmed hackathon start; nothing is committed or collected before it |
| **RW-1..RW-4** | The four Render Workflows: clip pipeline, case-clock sweep, debrief fan-out, field-study stats |
| **W1..W15** | The fifteen n8n workflows (08 §6) |
| **G1..G10** | The ten games: Nazar, Junction Scan, Stopping Distance, Blind Spot, Track Test Twin, Night & Glare, Hill Road, Helmet Fit, Golden Hour, LL Test Simulator |
| **VG-1..VG-14** | Verification gaps in `margdarshak-verification.md` §3.1 |
| **D-01..D-25** | The council's bible directives |

## 7. Engineering and AI terms

| Term | Meaning in this project |
|---|---|
| **Hexagonal architecture / ports and adapters** | Domain core with interfaces (ports) for rules, cases, games, AI, notifications and government systems; implementations plug in |
| **Anti-corruption layer** | Adapters translate government formats into our objects; nothing else sees DigiLocker XML |
| **Contract test** | One test suite every implementation of a port must pass (mock and real alike) |
| **OpenAPI 3.1 / AsyncAPI** | Machine-readable specs for our HTTP API (`api/openapi.yaml`), the adapter socket (`api/adapters.openapi.yaml`) and events |
| **OAuth 2.0 + PKCE (S256)** | The authorisation flow DigiLocker requires; PKCE binds the code to the client |
| **HMAC** | Keyed hash used to sign n8n ↔ backend requests and payment callbacks |
| **Idempotency key** | A key that makes a repeated request or job run have no extra effect (e.g. `case:milestone:version`) |
| **Render Workflows** | Render's orchestration engine for long-running, retryable tasks defined in code (public beta since 7 Apr 2026; no cron, so n8n triggers runs) |
| **JobRunner** | Our interface over durable jobs; Render Workflows today, a queue-based runner for NIC/MeitY clouds later |
| **n8n** | Workflow automation tool (team has Pro); used only for messaging, schedules and human approvals |
| **Send-and-wait** | n8n operation that sends a message and pauses until a human responds |
| **Google ADK** | Agent Development Kit (Python 2.12 at research time): agents, graph workflows mixing code and LLM nodes, live (voice) mode, evals |
| **LlmAgent / graph workflow** | An ADK agent node / an ADK 2.x workflow of deterministic and LLM nodes |
| **`run_live` / LiveRequestQueue** | ADK's bidirectional streaming API used by the voice guide |
| **Gemini Flash-Lite / Flash / Live** | Google model families used for narration, vision/video and voice; IDs live in env vars |
| **Structured output / output schema** | Constraining the model to a JSON schema; Gemini ignores min/max length, so code checks lengths |
| **Number-provenance validator** | Our check that model text has no digits outside `{{fact:*}}` placeholders and only allowed IDs |
| **PII plugin / redaction** | Removing Aadhaar-like numbers, OTPs, phones and emails before any model call or log |
| **Evalset (`adk eval`)** | ADK's evaluation format and runner; ≥ 30 cases per agent, 150 for the debrief |
| **Red-team set** | Adversarial cases: injections, PII leaks, invented fees, minors trying to bypass family mode |
| **Circuit breaker** | Switches to templates when AI fails too often (> 20% fallback over 5 min) |
| **Sarvam Saaras / Bulbul** | Sarvam's speech-to-text (lists Dogri `doi-IN`) / text-to-speech (no Dogri) |
| **IndicTrans2** | Open Indic translation model, for Dogri screen text after native review |
| **MediaPipe / Face Landmarker / YuNet** | On-device vision for Helmet Fit / a face detector used for blurring clips |
| **Phaser 4** | 2D game framework for the top-down sims (v4.2.1 in research; spike decides vs 3.x) |
| **Rive (canvas-lite)** | Designer-made animation runtime (~222 KB brotli) for the voice orb and track explainer |
| **Fixed timestep / seeded PRNG (mulberry32)** | Game logic advances in fixed 60 Hz steps with seeded randomness, so the server can replay it |
| **Kinematic bicycle model** | Simple vehicle motion model: heading rate = v·tanδ/L |
| **`requestVideoFrameCallback` (rVFC)** | Browser API giving the media time of each presented frame; used for tap timing |
| **Score verifier** | Node service that re-scores sessions from inputs + seed and overwrites client scores |
| **Integrity / trust** | Flags (hidden tab, timing drift, impossible inputs, replay mismatch) combined into a 0–1 trust value |
| **Staircase (Levitt up-down)** | 2 passes → harder, 1 fail → easier; converges near 71% success |
| **FSRS / ts-fsrs** | Free Spaced Repetition Scheduler (v6) and its TypeScript library (5.x pinned) |
| **Retrievability** | FSRS's estimate of the chance you recall a card now |
| **PWA / service worker / Serwist** | Installable web app / offline cache worker / the library that builds it |
| **Range requests** | HTTP partial content; needed to play cached video from a service worker |
| **Lite budget** | < 300 KB compressed first load, fonts included |
| **Multi-tenancy / RLS** | One deployment serving several states / Postgres row-level security by tenant |
| **OpenTelemetry / Sentry** | Tracing and metrics standard / error tracking |
| **SBOM / CodeQL / gitleaks / ZAP** | Software bill of materials / static analysis / secret scanning / dynamic scanning |
| **OWASP ASVS L2 / LLM Top 10** | Application Security Verification Standard level 2 / top risks for LLM apps |
| **STRIDE** | Threat categories: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege |
| **k6 / p95 / SLO** | Load-testing tool / 95th-percentile latency / service level objective |
| **axe / Lighthouse / Playwright** | Accessibility checker / web performance audit / browser test runner |
| **Conventional Commits** | Commit message convention (`feat:`, `fix:` …) |
| **Forward-deployed engineering / ontology** | Palantir's practice of embedding with a customer, and modelling the organisation as objects, links and actions; our P7 method (07 §C) |

## 8. Research and statistics terms

| Term | Meaning |
|---|---|
| **Pre-registration (HYPOTHESES.md)** | Writing hypotheses, scoring and analysis down and committing them before any data exists |
| **Convenience sample** | Participants recruited from whoever was reachable (college groups); results describe this sample, not India |
| **Counterbalancing** | Rotating the order of conditions (and role cards) so order effects cancel out |
| **Think-aloud** | Participants say what they are thinking while doing the task |
| **Mom Test interview** | Asking about past behaviour, not opinions of our idea |
| **SUS** | System Usability Scale: 10 items, score = ((sum of odd items − 5) + (25 − sum of even items)) × 2.5; 68 is average |
| **Wilson interval** | A confidence interval for a proportion that behaves well at small n |
| **Pearson r / Fisher z interval** | Correlation coefficient / its confidence interval via the atanh transform |
| **Wilcoxon signed-rank test** | Paired, non-parametric test of whether differences are centred above zero |
| **Exact McNemar test** | Paired test for changes in a yes/no outcome, using only discordant pairs |
| **Inter-rater agreement (|Δonset|)** | How far apart two raters put the hazard onset; pre-registered as median ≤ 0.5 s |
| **Test-retest reliability** | Correlation between a person's first and second scores |
| **Signal-detection scoring** | Scoring hits against false alarms, so tapping everywhere does not pay |
| **Pattern clicking** | Rapid or rhythmic tapping; scores 0 for that clip |
| **Brier score / calibration / overconfidence** | Mean squared gap between stated confidence and outcome; calibration = how well confidence matches accuracy; overconfidence = confidence − accuracy |
| **k-anonymity threshold (k ≥ 5)** | A value is shown only if at least 5 reports or people contribute |
| **Deviation log** | Record of anything done differently from the pre-registration, with the reason |

## 9. Hindi/Dogri words used in the product

| Word | Script | Meaning | Used in |
|---|---|---|---|
| Margdarshak | मार्गदर्शक | the one who shows the way | Product name |
| Nazar | नज़र | sight, gaze | Hazard game |
| Khud | ख़ुद | oneself | "Khud Licence" badge |
| Pehli Baar | पहली बार | the first time (attempt) | "Pehli Baar Pass" badge (self-declared first-attempt pass) |
| Gali / Mohalla / Shehar / Ghat | गली / मोहल्ला / शहर / घाट | lane / neighbourhood / city / hill pass | Ranks |
| Bolke chalao | बोलके चलाओ | "say it as you ride" | Commentary mode |
| Sangathan | संगठन | organisation, group | "Squad Sangathan" badge |
| Rah-Veer | राह-वीर | road hero | Good Samaritan scheme name |
| Learner se licence tak, bina agent ke | — | from learner's licence to licence, without an agent | Tagline |
