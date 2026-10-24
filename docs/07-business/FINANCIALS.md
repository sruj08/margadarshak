# Financials
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Business lead (with Founder) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [BUSINESS_MODEL](BUSINESS_MODEL.md) · [GTM](GTM.md) · [IMPACT](IMPACT.md) · [GOVERNMENT_ADOPTION](../10-government/GOVERNMENT_ADOPTION.md) · `docs/05-ops/COST.md` · [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md)
> **Read this first:** every revenue, price, conversion, churn and salary number in this file is a **HUNCH** (an assumption for planning, not a measured result). Facts carry a source. Items marked **[unverified]** have an owner and a check-by date. ₹ figures exclude GST. "L" = lakh (₹1,00,000); "cr" = crore (₹1,00,00,000). Financial years here run **Nov–Oct** (Year 1 = Nov 2026 – Oct 2027) to line up with the hackathon.

---

## 1. Summary
| | Year 1 (Nov 26–Oct 27) | Year 2 (Nov 27–Oct 28) | Year 3 (Nov 28–Oct 29) |
|---|---|---|---|
| Revenue | ₹12.4 L | ₹83.2 L | ₹243.4 L |
| Operating cost | ₹51.8 L | ₹135.6 L | ₹240.0 L |
| Operating result | −₹39.4 L | −₹52.4 L | +₹3.4 L |
| Non-dilutive funding in (if awarded) | ₹47 L (grants) | ₹50 L (SISFS debt/convertible) | — |
| Paying school branches (end of year) | 60 | 350 | 1,200 |
| State tenants live | 0 (1 pilot) | 1 (J&K) | 3 (J&K + 2) |
| Citizen MAU on our own tenant (avg) | 8,000 | 40,000 | 80,000 |

**The story in one breath:** citizens cost us roughly ₹5–7 a month each to serve and never pay; schools pay a subscription with ~75% gross margin; states pay for implementation and support with 45–65% margin; grants carry the first 18 months; the plan reaches operating break-even in Year 3 **if** one state signs in Year 2 and two more in Year 3. If no state signs, the school business alone does not cover a 16-person team (see §6 sensitivity).

---

## 2. Unit economics

### 2.1 Driving school (Pro), the first buyer
| Item | Value | Basis |
|---|---|---|
| ARPA (average revenue per branch per month) | ₹799 | HUNCH price ([BUSINESS_MODEL §3.2](BUSINESS_MODEL.md)); range tested ₹499–999 (`03-lifecycle` §C) |
| Direct cost per branch per month (COGS) | ≈ ₹200 | HUNCH: parent WhatsApp updates ≈ 40 learners × 4 messages × ₹0.50 = ₹80 (**[unverified]** per-message template price; owner: Engineering lead, check Meta's India rate card by 2026-11-15); support ≈ 15 min × ₹400/h = ₹100; hosting share ≈ ₹20 |
| Gross margin | ≈ 75% | (799 − 200) / 799 |
| CAC (cost to acquire one paying branch) | ≈ ₹3,500 | HUNCH: a Kerala trip ≈ ₹25,000 yields ~10 demos → ~5 paid; plus remote calls and a free month |
| Monthly churn | 4% | HUNCH (small businesses; seasonal) |
| Expected lifetime | 25 months | 1 / 0.04 |
| **LTV** | **≈ ₹15,000** | 799 × 0.75 × 25 |
| **LTV / CAC** | **≈ 4.3** | target > 3 |
| **CAC payback** | **≈ 5.8 months** | 3,500 / (799 × 0.75) |

### 2.2 Citizen (free), the cost we choose to carry
| Item | Per active user per month | Basis |
|---|---|---|
| Gemini text (Flash-Lite: debriefs, tutor, coach) | ≈ ₹2.5 today, ≈ ₹5 after Flash prices double on 2027-01-01 | `04-ai-adk-gemini.md` §5 (30 turns × 2k in + 300 out ≈ $0.03 at ₹88/$); price rise per [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) as recorded in §5 |
| Gemini vision (decoder, Sign Snap) | ≈ ₹1 | 5 images × 1.5k tokens ≈ $0.01 |
| Voice (Gemini Live) | ≈ ₹20 per 10 min; capped at 10 min/user/month; HUNCH 20% of users use ~5 min → ≈ ₹2 blended | `04` §5 |
| Dogri ASR (Sarvam Saaras) | ≈ ₹30/hour **[unverified aggregator figure]** → negligible blended | `04` §5 |
| Hosting, storage, egress | ≈ ₹1 | HUNCH |
| WhatsApp templates (case clock, ≈ 4/month, opt-in, ≤ 1/day) | ≈ ₹2 | **[unverified]** rate as above |
| **Blended cost per MAU** | **≈ ₹6 (Y1), ₹7 (Y2), ₹5 (Y3 after optimisation)** | Levers in §2.4 |
| **Cost to serve one full licence journey** (≈ 4 active months, LL to card) | **≈ ₹24–28** | vs an agent's ₹2,000–20,000 (`00-JOURNEY-MAP` row 15) and the government fee of ₹700 + ₹200 card for one class (CMVR r.32) |

Learners under 18 (P-07) use the full product, AI included, in family mode; they cost the same as any MAU and are inside the blended figure above (D-13 revised).

### 2.3 State tenant (B2G)
| Item | Implementation (one-time) | Annual support + ops |
|---|---|---|
| Price | ₹25–60 L (model uses ₹30 L for J&K, ₹35 L and ₹25 L for states 2–3) | ₹15–40 L (model uses ₹20–25 L) |
| Delivery cost | ≈ ₹11 L: 3 people × 10 weeks (≈ ₹6 L), travel and on-site (≈ ₹2 L), pre-audit pack prep and accessibility test (≈ ₹3 L) | ≈ ₹14 L: 1.5 FTE (≈ ₹12 L) + on-call and tooling (≈ ₹2 L) |
| Gross margin | ≈ 63% at ₹30 L | ≈ 44% at ₹25 L |
| Paid by the state directly (not our revenue or cost) | Hosting on MeghRaj / MeitY-empanelled CSP or NIC; safe-to-host audit by an STQC- or CERT-In-empanelled auditor | Same |

### 2.4 Cost levers (if AI or messaging prices move)
1. **Code computes, Gemini narrates** (D-09): debriefs fall back to templates (EC-29) with no loss of numbers, so AI is optional per request.
2. Voice cap of 10 min/user/month; voice is never on the critical path of a journey.
3. Cache debrief narrations by finding-ID combination (the M-02 allowlist design makes outputs reusable).
4. State tenants run their own inference (Vertex AI in an Indian region `HUNCH:` asia-south1, or Bhashini), so their users leave our cost base.
5. WhatsApp only for state changes of the case clock (F-09), never for marketing; email and web push are free.

---

## 3. Three-year projection

### 3.1 Revenue build (HUNCH)
| Line | Driver | Year 1 | Year 2 | Year 3 |
|---|---|---|---|---|
| R1 School Pro | avg paying branches × ₹799 × 12 | 25 × → **₹2.4 L** | 200 × → **₹19.2 L** | 800 × → **₹76.7 L** |
| R2 Lead-gen (Year 2+) | verified bookings × ₹300 avg fee (5%, cap ₹400) | — | 3,000 → **₹9.0 L** | 5,770 → **₹17.3 L** |
| R3 State implementation | states signed × price | — | J&K → **₹30.0 L** | states 2 + 3 → **₹60.0 L** |
| R4 State support + ops | live states × annual fee (pro-rated) | — | J&K, last 2 months → **₹5.0 L** | J&K ₹25 L + state 2 part-year ₹20 L → **₹45.0 L** |
| R5 CSR programmes | programmes × size | 1 × ₹10 L → **₹10.0 L** | 2 × ₹10 L → **₹20.0 L** | 3 × ₹12.3 L → **₹37.0 L** |
| R7 Insurer pilot (roadmap) | one paid pilot, only after IRDAI/legal review | — | — | **₹7.4 L** |
| **Total revenue** | | **₹12.4 L** | **₹83.2 L** | **₹243.4 L** |

Year-3 mix: Pro 31.5% · lead-gen 7.1% · implementation 24.7% · support 18.5% · CSR 15.2% · insurer 3.0%.

### 3.2 Cost build (HUNCH)
| Line | Driver | Year 1 | Year 2 | Year 3 |
|---|---|---|---|---|
| People | Y1: 5 (2 founders ₹40k/mo, 2 engineers ₹50k/mo, 1 field ₹30k/mo, Jammu-based) ≈ ₹2.1 L/month; Y2: 9; Y3: 16 | ₹25.0 L | ₹60.0 L | ₹125.0 L |
| Citizen AI + messaging + hosting (our tenant) | avg MAU × cost/MAU × 12 (§2.2) | 8k × ₹6 → ₹5.8 L | 40k × ₹7 → ₹33.6 L | 80k × ₹5 → ₹48.0 L |
| Platform fixed (prod + staging, monitoring, Sentry, backups) | | ₹6.0 L | ₹9.0 L | ₹12.0 L |
| Compliance (VAPT, DPDP legal, trademark, CERT-In readiness) | | ₹5.0 L | ₹8.0 L | ₹12.0 L |
| Field, sales, travel (Kerala, J&K, pilots) | | ₹6.0 L | ₹15.0 L | ₹25.0 L |
| Content: filming, two-rater clip windows, review | | ₹4.0 L | ₹10.0 L | ₹18.0 L |
| **Total operating cost** | | **₹51.8 L** | **₹135.6 L** | **₹240.0 L** |

### 3.3 P&L and cash
| | Year 1 | Year 2 | Year 3 | Cumulative |
|---|---|---|---|---|
| Revenue | 12.4 | 83.2 | 243.4 | 339.0 |
| Operating cost | 51.8 | 135.6 | 240.0 | 427.4 |
| **Operating result** | **−39.4** | **−52.4** | **+3.4** | **−88.4** |
| Grants in (non-dilutive, if awarded; §5) | 47.0 | — | — | 47.0 |
| SISFS debt/convertible (if awarded) | — | 50.0 | — | 50.0 |
| Pre-seed buffer (recommended) | 75.0 | — | — | 75.0 |
| **Closing cash** (₹ L, starting from 0) | 82.6 | 80.2 | 83.6 | — |

The buffer exists because grants pay in milestone instalments (SISFS) and state payments arrive late. Without the pre-seed, Year 2 cash goes negative around month 18 if any state invoice slips by two quarters (HUNCH).

### 3.4 Key assumptions to watch (and their owners)
| # | Assumption | Value | Owner | Check by |
|---|---|---|---|---|
| A-01 | Kerala HPT stays in force from 1 Dec 2026 | yes | Business lead | Recheck on 2026-11-30 and monthly (R-10, EC-28) |
| A-02 | Pro price holds at ₹799 | PH-01 | Business lead | 2026-12-15 |
| A-03 | Monthly school churn 4% | HUNCH | Business lead | after 6 months of data |
| A-04 | One state signs in Year 2 (J&K) after a free pilot | HUNCH | Founder | 2027-06-30 |
| A-05 | Citizen cost per MAU ≤ ₹7 after the 2027-01-01 Flash price rise | HUNCH | Engineering lead | 2027-01-15 |
| A-06 | WhatsApp template price ≈ ₹0.50/message | **[unverified]** | Engineering lead | 2026-11-15 |
| A-07 | Grants awarded in Year 1 (SISFS ₹20 L, J&K ₹20 L, TIDE 2.0 ₹7 L) | HUNCH | Founder | 2027-04-30 |

---

## 4. Market sizing (honest version)
| Layer | Number | Source / status |
|---|---|---|
| Valid DLs on Sarathi | 18+ crore | Lok Sabha reply as reported by Swarajya, via `team-saarthi-report.md` l.364, l.394 (SECONDARY) |
| New LL/DL applicants per year, India | **unknown** | Search on 2026-10-23 found no current national figure. The Road Transport Year Book on data.gov.in has 2019-20 state-wise issuance with some states missing ([data.gov.in](https://www.data.gov.in/resource/statesuts-wise-number-drivers-licences-issued-during-2019-20-incremental)). Owner: Business lead, pull the latest Year Book or a 2024–26 Lok Sabha answer by 2026-11-15 |
| Kerala driving tests per day | ~8,000–8,500 before the 2024 reform → ~5,200 after | `02-rules-process.md` l.262 (SECONDARY, Onmanorama). Derived (HUNCH): ~5,200 × ~290 test days ≈ **15 lakh tests a year**, including retests |
| Kerala driving schools | **unknown** | Owner: Business lead, Kerala MVD list, by 2026-11-30 |
| ADTCs operating nationally | **unknown** | `03-lifecycle` §C gaps |
| J&K registered startups | ~1,400 (2025 JKEDI event report) | SECONDARY ([Kashmir Reader, Oct 2025](https://kashmirreader.com/2025/10/06/jkedi-screening-committee-holds-2nd-meeting-to-evaluate-startups-for-seed-fund/), search snippet) |

**SOM (what this plan needs):** 1,200 paying branches by Year 3 and 3 state tenants. We do not claim a TAM in rupees until the applicant count is sourced.

---

## 5. Funding sources (non-dilutive first)

**Sequencing matters.** SISFS requires that the startup "should not have received more than INR 10 Lakh of monetary support under any other Central or State Government scheme". So **apply for SISFS before taking the J&K seed or TIDE 2.0 money**, or keep the earlier awards under ₹10 L in total.

| Source | What it offers | Conditions (as found) | Fit for Margdarshak | Status |
|---|---|---|---|---|
| **Startup India Seed Fund Scheme (SISFS)**, DPIIT | Up to **₹20 L grant** for proof of concept, prototype or product trials, paid in milestone instalments; up to **₹50 L** for market entry, commercialisation or scaling through convertible debentures, debt or debt-linked instruments; each form once. Outlay ₹945 cr, ~3,600 entrepreneurs via ~300 incubators | DPIIT-recognised; incorporated **≤ 2 years** before applying; Indian promoters ≥ 51%; ≤ ₹10 L from other government schemes; **applied through an approved incubator** | Grant → J&K pilot + clip bank; debt → Year 2 state delivery | SECONDARY: government portals via search excerpts ([India Science & Technology](https://indiascienceandtechnology.gov.in/funding-opportunities/startups/startup-india-seed-fund-scheme-sisfs), [myScheme](https://myscheme.gov.in/schemes/sisfs-fs)). Check the current portal (seedfund.startupindia.gov.in). **Nestiq's DPIIT status and incorporation date are [unverified]** (owner: Founder, by 2026-11-07) |
| **MeitY Startup Hub: TIDE 2.0** | EiR grant up to **₹4 L** (idea validation) and grant up to **₹7 L** (prototype/MVP), via MeitY-supported incubators | Through a TIDE 2.0 incubator; cycles open and close | Hindi/Dogri voice, accessibility work | **[unverified]**: third-party aggregators only ([VIT TBI listing](https://www.startupgrantsindia.com/meity-tide-2-0-grants-program-vittbi-95), [JECRC listing](https://www.startupgrantsindia.com/tide-2-0-eir-grant-program-at-jecrc-incubation-centre-125)). Owner: Founder, confirm on MeitY Startup Hub by 2026-11-30 |
| **MeitY SAMRIDH** | Reportedly up to **₹40 L** plus investor connections | Accelerator-led | Year 2 scaling | **[unverified]**: one aggregator only ([Backrr](https://backrr.com/blog/20govt-grants-for-indian-startups)). Owner: Founder, by 2026-12-31 |
| **J&K Startup Policy 2024–27** (JKEDI nodal agency) | One-time seed assistance **up to ₹20 L in four equal instalments**, capped at 25 startups a year (one secondary analysis); a planned ₹250 cr VC fund with ₹25 cr from government; ₹50 cr allocated for FY 2025-26 | J&K-recognised startup; two-tier screening (JKEDI screening committee → Startup Task Force Committee) | Strong: a J&K team, a J&K pilot, Dogri | SECONDARY, partly conflicting ([Impri](https://www.impriindia.com/?p=73691), [Greater Kashmir](https://m.greaterkashmir.com/article/jk-startup-policy-2024-27-dy-cm-calls-for-prioritising-operational-guidelines-funding-mechanisms-of-policy/401088), [Kashmir Reader](https://kashmirreader.com/2025/10/06/jkedi-screening-committee-holds-2nd-meeting-to-evaluate-startups-for-seed-fund/), [Startup India J&K report](https://www.startupindia.gov.in/srf/portal/SRF_2026_Result_page/Jammu_and_Kashmir_State_Report.pdf)). **[verify]** against the operational guidelines; also check whether Nestiq qualifies as a J&K startup (owner: Founder, by 2026-11-30) |
| **GeM (procurement, not a grant)** | DPIIT startups: exemptions on prior experience, prior turnover and EMD where the tender allows; Startup Runway for products that fit no existing category | DPIIT recognition | The route to R3/R4 | SECONDARY ([Startup India note](https://www.startupindia.gov.in/content/sih/en/reources/startup_india_notes/regulations_and_policies/MakeTheGovernmentYourPrimeCustomer.html)); scope for software services **[unverified]** |
| **CSR** (Companies Act s.135) | Programme funding | Schedule VII fit for road-safety education **[unverified]**; implementing-agency registration | Clip bank, free school seats, J&K pilot | Not approached |
| **Hackathon** | Render Workflows track: $500 / $300 / $100 in Render credits; $50 credits per participant; n8n Pro for every team (B-sponsors §0) | Use Render Workflows load-bearingly | Covers hackathon hosting | Confirmed by the event API (B-sponsors) |
| **Angels / pre-seed** | ₹75 L buffer (§3.3) | Dilutive | Only after a pilot result | Not started |

Not relevant to us: BIRAC (biotech) and iDEX (defence).

---

## 6. Sensitivity (what breaks the plan)
| Scenario | Change | Year-3 operating result |
|---|---|---|
| Base | — | +₹3.4 L |
| Pro price ₹499 instead of ₹799 | R1 × 0.62 | −₹25.7 L |
| Pro price ₹999 with 25% fewer branches | R1 × 0.94 | −₹1.4 L |
| No state signs in Year 3 (only J&K) | R3 −₹60 L, R4 −₹20 L | −₹76.6 L → cut team to 10 |
| Kerala HPT stayed (A-01 fails) | R1 −40% | −₹27.3 L |
| AI cost per MAU ₹10 instead of ₹5 | cost +₹48 L | −₹44.6 L → move users to state tenants faster, tighten voice cap |
| CSR doubles | R5 +₹37 L | +₹40.4 L |

**What we tell judges (Rutvik):** "The school line alone pays for a small team. States make it a company. We modelled a state taking two years to sign, and we fund that gap with SISFS and the J&K seed scheme, not with citizens."

---

## 7. Hackathon build (Phase 1–2) vs Production (Phase 3+)
| | Hackathon | Production |
|---|---|---|
| Spend | Render ($50 credit/participant; Workflows billed per second, no charge when idle, B-sponsors §1), Gemini paid tier for real field-study users (D-13 revised), n8n Pro (sponsor), Meta WhatsApp test number | Per §3.2 |
| Revenue | None | Per §3.1 |
| Metrics on stage | Cost per Nazar session and per debrief, measured from Render and Gemini usage during the event | Monthly cost per MAU on the dashboard (`docs/05-ops/COST.md`) |
