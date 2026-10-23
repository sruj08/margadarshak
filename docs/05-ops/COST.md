# Cost
> Project: Margdarshak · Owner: Ops lead (Team Chanakya) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [INFRASTRUCTURE](INFRASTRUCTURE.md) · [N8N_WORKFLOWS](N8N_WORKFLOWS.md) · [OBSERVABILITY](OBSERVABILITY.md) (D9 cost dashboard) · [MODELS](../04-ai/MODELS.md) · [BUSINESS_MODEL](../07-business/BUSINESS_MODEL.md) · [FINANCIALS](../07-business/FINANCIALS.md)

## 0. Read this first
- **Exchange rate:** ₹88 per US$ (the rate `04-ai-adk-gemini.md` assumes). WhatsApp prices are in ₹ already.
- **Tags:** **[S]** = from a sourced research file or a page fetched on 2026-10-23 (URL given) · **[K]** = known list price, not re-checked today; recheck at H0 · **[E]** = our estimate or assumption, not a quote · **[U]** = unverified, with owner and date.
- **Scale tiers** are **monthly active users (MAU)**: 1k (pilot at 1–2 RTOs), 100k (one mid-sized state), 10M (several states).
- **GST:** Indian GST (18 %) applies to Meta's WhatsApp charges [S: baat.ai / Monty Mobile summaries of Meta's India rate card, 2026]. Cloud invoices from foreign providers may attract GST under reverse charge [U; owner: Nestiq finance; before the first paid month]. Totals below include GST only for WhatsApp.
- **Nothing here is a vendor quote.** For a state tenant, replace the [E] infrastructure rows with the empanelled CSP's quote.

## 1. Unit prices we use
| Item | Price | Tag / source |
|---|---|---|
| Gemini `gemini-3.1-flash-lite` (debrief M-02, coach M-03, tutor M-04) | $0.25 in / $1.50 out per 1M tokens | [S] 04 §1.7 (pricing page updated 2026-10-22) |
| **One AI debrief** (≈ 2.4k in + 350 out, 5 % retries) | **≈ $0.0012 ≈ ₹0.10** | [S] 08 §5.8 |
| CoachAgent (4 runs/month) | ≈ ₹0.5 per user-month → ₹0.125 per run | [S] 08 §5.8 |
| Tutor/explainer turn (2k in + 300 out, Flash-Lite) | ≈ $0.00095 ≈ ₹0.084 | [S] computed from 04 §1.7 |
| Vision call (screen decoder M-05, sign snap M-07) on Flash (1.5k in + 300 out) | $0.75 / $3.75 per 1M ⇒ ≈ ₹0.20; **doubles to ≈ ₹0.40 from 1 Jan 2027** | [S] 04 §1.7 |
| Clip-window proposal (M-06), 1-min clip (≈ 18k video + 1.9k audio tokens in, 1k out) | ≈ $0.019 ≈ ₹1.6 per clip (offline, once per clip) | [S] token rates 04 §1.8; [E] token count |
| **Voice** (`gemini-3.8-live`, audio in $0.005/min + out $0.018/min) | **≈ $0.023/min ≈ ₹2/min** | [S] 04 §1.7 |
| Voice cap on the free plan | 10 min per user per month ⇒ ≤ ₹20 per voice user | [S] 04 §5 |
| Sarvam Saaras (Dogri ASR) | about ₹30 per hour | [U] aggregator figure in 04 §5; owner AI lead; H0 |
| Sarvam Bulbul TTS | ₹30 per 10k characters | [S] 04 §1.9 |
| **WhatsApp utility template (India)** | ≈ **₹0.115** per delivered message (Meta base rate from 1 Jan 2026); + 18 % GST ⇒ ≈ ₹0.136 | [S] secondary summaries: [baat.ai](https://baat.ai/blog/whatsapp-api-pricing-india), [Monty Mobile](https://montymobile.com/blogs/whatsapp-business-api-pricing-in-india-inr-rates-gst-and-the-2026-currency-migration-deadline); Meta's own page ([developers.facebook.com pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)) confirms per-message billing since 1 Jul 2025 but the India figure wasn't shown in the search excerpt. [U: confirm on Meta's rate card; owner Ops lead; H0] |
| WhatsApp marketing template (India) | ≈ ₹0.86 per message | [S] same secondary sources. **We send none** (no marketing nudges; ≤ 1 nudge/day, opt-in, 05 §3) |
| WhatsApp service replies / utility inside an open 24-h window | free | [S] Meta pricing doc as summarised |
| Render web `0.5c-512mb` (legacy "starter") | $7/month | [K]; plan renaming had "no changes to pricing" ([compute-plans-update](https://render.com/docs/compute-plans-update)) |
| Render web/pserv `1c-2g` (legacy "standard") | $25/month | [K] |
| Render `2c-4g` (legacy "pro") | $85/month | [K] |
| Render Postgres `0.1c-256mb` (legacy "basic-256mb") | $6/month | [K] (secondary search: "Postgres starts at $6/month") |
| Render Postgres 1 GB tier | $19/month | [K] |
| Render Key Value `256mb` | $10/month | [K] |
| Render Workflows `flex` | $0.20/CPU-h + $0.05/GB-h, capped at ≈ $0.40/h; per-second billing; **no idle charge**; args/results kept 30 days at $0.25/GB-month | [S] B-sponsors §1 (render.com/docs/workflows-limits) |
| Render cron job (alternative to n8n schedule) | $1 minimum per month per cron service | [S] B-sponsors §1 |
| Render workspace | Hobby $0; paid workspace tiers cost per user (sources conflict: $19/user vs $25) | [U] owner Ops lead; H0 |
| n8n Pro (cloud) | ≈ €50/month (annual), ≈ 10k executions/month | [S] B-sponsors §3, 08 §6 |
| Cloudflare R2 | storage ≈ $0.015/GB-month, **no egress fee**, free tier ≈ 10 GB storage + monthly operation allowances | [K] Cloudflare R2 pricing; recheck at H0 |
| India-region managed compute (production) | ≈ ₹2,500 per vCPU-month incl. 4 GB RAM | **[E]** placeholder until a CSP quote |
| India-region egress / CDN (production) | ≈ ₹6 per GB | **[E]** placeholder; negotiable, CDN/NIC peering may be far lower |
| India-region object storage (production) | ≈ ₹2 per GB-month | **[E]** |

## 2. Hackathon month (Render, Singapore)
| Line | Plan / usage | US$ | ₹ | Paid by |
|---|---|---|---|---|
| `margdarshak-web` | `0.5c-512mb` × 1 | 7 | 616 | Render credits |
| `margdarshak-api` | `1c-2g` × 1 | 25 | 2,200 | Render credits |
| `margdarshak-score-verifier` | `0.5c-512mb` pserv × 1 | 7 | 616 | Render credits |
| `margdarshak-db` | Postgres `0.1c-256mb` | 6 | 528 | Render credits |
| `margdarshak-kv` | Key Value `256mb` | 10 | 880 | Render credits |
| Render Workflows | ≈ 120 clip ingests × 10 min + 2,000 debrief fan-outs × 20 s + 31 sweeps + 31 nightly stats, at ≤ $0.30/h effective **[E]** | ≈ 10 | ≈ 880 | Render credits |
| **Render subtotal** | | **≈ 65** | **≈ 5,720** | **covered**: 4 members × $50 = $200 credit [S] B-sponsors §0 |
| Gemini: debriefs | ≈ 1,000 × ₹0.10 | | 100 | card (paid tier) |
| Gemini: voice | ≈ 200 min × ₹2 | | 400 | card |
| Gemini: vision (screen decoder, sign snap) | ≈ 200 × ₹0.20 | | 40 | card |
| Gemini: clip windows | ≈ 120 clips × ₹1.6 | | ≈ 200 | card |
| Gemini: CI evals | ≈ 30 runs × 4 agents, capped at ₹150/run (evals.yml) | | ≤ 500 typical | card (separate eval project) |
| Sarvam (Dogri ASR) | ≈ 2 h | | ≈ 60 [U] | trial credit / card |
| WhatsApp | ≈ 300 utility templates via the test number | | ≤ 41 | Meta (test number billing [U]) |
| n8n Pro | sponsor perk | (≈ €50) | 0 | **sponsor** [S] |
| R2 | < 10 GB, few million reads | | 0 | free tier [K] |
| Sentry, Grafana Cloud | free tiers | | 0 | [U] quotas |
| **Cash out of pocket** | | | **≈ ₹1,300–1,400** | team card |

**Credit runway:** $200 of credit vs ≈ $65/month ⇒ about 3 months of the hackathon stack. Prize credits (Workflows track: $500 / $300 / $100 [S]) would extend this into the pilot. Suspend services after the judging window and post-event review so idle instances don't burn credit.

## 3. Usage model per MAU (assumptions behind §4)
| Driver | Assumption per MAU per month | Tag | ₹ per MAU |
|---|---|---|---|
| Debriefs | 10 sessions; 90 % of MAU are adults (minors get template cards, no AI cost, D-13) ⇒ 9 × ₹0.10 | [E] usage (08 §5.8 has 30 for a heavy learner) | 0.90 |
| Coach plans | 40 % weekly-active learners × 4 runs × ₹0.125 | [E] | 0.20 |
| Tutor / explainer | 5 turns × ₹0.084 | [E] | 0.42 |
| Vision (decoder, sign snap) | 1 call × ₹0.20 (₹0.40 after 1 Jan 2027) | [E] | 0.20 |
| **Voice** | 15 % of MAU use it × 4 min = 0.6 min × ₹2 | [E]; cap 10 min | **1.20** |
| **AI subtotal** | | | **≈ 2.92** |
| WhatsApp | 4 utility templates per opted-in user (LL day-25, expiry T-30/T-7, test-eve, retest plan); 60 % opt in ⇒ 2.4 × ₹0.136 | [E] usage; [S] price | 0.33 |
| Clip windows | fixed by clip-bank size (≈ 300 new clips/year ⇒ ≈ ₹40/month), not per user | [E] | ≈ 0 |

## 4. Monthly cost at 1k / 100k / 10M MAU
| Line | 1k MAU (pilot) | 100k MAU (one state) | 10M MAU (several states) | Notes |
|---|---|---|---|---|
| **Hosting** | Render (as §2, Postgres to 1 GB tier): ≈ **₹6,900** | India CSP **[E]**: ≈ 29 vCPU (web 4, api 8, verifier 2, workers 4, Temporal 4, observability 6, n8n 1) × ₹2,500 = **₹72,500** | **[E]**: ≈ 600 vCPU × ₹2,500 = **₹15,00,000** | production must be in India (INFRASTRUCTURE §3) |
| Postgres | incl. above | managed HA, 8 vCPU / 32 GB + replica **[E]** ≈ **₹60,000** | per-state clusters **[E]** ≈ **₹8,00,000** | partition `game_events` monthly |
| Clip delivery (egress) | R2: **₹0** | 10 clips × 2 MB (360p, EC-19) = 20 MB/MAU ⇒ 2 TB × ₹6 = **₹12,000** | 200 TB × ₹6 = **₹12,00,000** | biggest infra lever (§6) |
| Object storage, logs (180 d), backups | ≈ ₹0–500 | ≈ ₹5,000 (900 GB logs + backups) | ≈ ₹2,80,000 (≈ 90 TB logs + backups) | CERT-In 180-day retention in India |
| **Infra subtotal** | **≈ ₹7,400** | **≈ ₹1,49,500** | **≈ ₹37,80,000** | |
| Gemini: debriefs | ₹900 | ₹90,000 | ₹90,00,000 | ₹0.10 each |
| Gemini: coach + tutor + vision | ₹820 | ₹82,000 | ₹82,00,000 | |
| Gemini: **voice** (₹2/min) | ₹1,200 | ₹1,20,000 | **₹1,20,00,000** | dominant AI line (04 §5) |
| **AI subtotal** | **≈ ₹2,920** | **≈ ₹2,92,000** | **≈ ₹2,92,00,000** | Vertex AI India pricing may differ [U] |
| WhatsApp (utility only, incl. GST) | ₹330 | ₹32,600 | ₹32,60,000 | volume tiers lower the utility rate at scale [S] |
| n8n | ₹0 (Pro perk) | self-hosted, inside the compute line (≈ 1 vCPU) | ops queues only, self-hosted | §5 |
| SMS | 0 | 0 until TRAI DLT; then via the state's NIC/mGov gateway [U] | same | D-16 |
| **Total / month** | **≈ ₹10,650** | **≈ ₹4,74,000** | **≈ ₹3,62,00,000** | |
| **₹ per MAU per month** | **≈ ₹10.7** | **≈ ₹4.7** | **≈ ₹3.6** | AI is 27 % → 62 % → 81 % of the total |

Reading the table:
- At pilot scale, **fixed infrastructure dominates**: ₹7k of ₹10.7k.
- From one state upwards, **AI dominates, and voice is most of it**. The voice cap, template-first debriefs and Bhashini (§6) matter more than any server choice.
- At 10M MAU this is several states' tenants; each state pays for its own hosting under its MoU (BUSINESS_MODEL.md), and AI could move to Bhashini or a state-chosen Indic model behind `LanguagePort` (07 §B4).

## 5. n8n execution budget
Pro ≈ 10,000 executions/month; **each workflow run counts as one execution regardless of the number of steps** (08 §6, third-party sources [S]).

| Workflow group | Executions/month at 1k MAU | At 100k MAU | At 10M MAU |
|---|---|---|---|
| Daily schedules W01, W04, W13 (batch: one run covers every user) | ≈ 90 | ≈ 90 (runs are bigger, not more) | moved to CronJobs |
| Weekly W05, W06, W15 | ≈ 12 | ≈ 12 | CronJobs |
| W12 alerts at 15-min schedule (5 min would be ≈ 8.6k, too many, 08 §6) | ≈ 2,900 | webhook-only alerts ≈ 300 | Grafana alerting, no n8n |
| Event-driven W02, W03, W07–W11, W14 (≈ 3–5 per active user) | ≈ 3,000–5,000 | **≈ 300k–500k ⇒ exceeds Pro** | not in n8n |
| **Total** | **≈ 6,000–8,000 ✓ fits Pro** | ≈ 300k+ | ops queues only (W08 clip review, W09 moderation, W11 letter approvals at low volume, W15) ≈ 20–50k |

**Decision path:**
1. **Hackathon and pilot:** n8n Cloud Pro, batch everything, W12 at 15 min.
2. **One state (100k):** move per-user event messaging (W02, W03, W10) into the backend `NotificationAdapter` + JobRunner (the content and decisions are already in the backend; only the sending moves). Keep n8n for human queues and digests (≈ 10k). Or self-host n8n inside the state's cluster, which has no per-execution fee [K; licence review [U], see helm README §2].
3. **Several states (10M):** n8n is optional per tenant; CronJobs replace schedules; human queues stay in n8n only if the state wants the editable canvas.

This works because n8n holds **no business logic** (D-16): moving a workflow into code never changes a fact the user sees.

## 6. Optimisation levers (biggest first)
| Lever | Saves | Effort | Risk |
|---|---|---|---|
| **Voice cap** 10 min/user/month (already planned, 04 §5); voice is opt-in per tap, never auto-started; debrief read-outs are short (≈ 30 s of Live ≈ $0.009, or Bulbul ≈ 400 characters ≈ ₹1.2, 08 §5.7, so TTS is *not* cheaper and is used only for Hindi voice-out in the Dogri cascade) | caps the largest line | low | none |
| **Bhashini** for speech in a government deployment (government-preferred path, war-room G4) | potentially most of the voice line | medium | pricing/quotas for this use are unknown (07 §A4) [U] |
| **Template-first debriefs**: show the template instantly and call the coach only when the user opens "Coach notes" | 30–60 % of debrief calls **[E]** | low | slightly less fluent default |
| **Gemini Batch API** for offline jobs (clip windows, nightly evals, scenario drafts) | ≈ 50 % on those calls [K; recheck at H0] | low | latency (hours) is fine offline |
| Context caching of the static system instruction (≈ 1.2k of the 2.4k input tokens) | up to ≈ 25 % of debrief input cost **[E]** | low | check cache pricing/minimums [U] |
| 360p clips (1–2 MB, EC-19), CDN, "download practice pack" with the size shown | halves egress | low | none |
| Batch n8n runs; W12 webhook-only | keeps n8n in Pro | low | none |
| Log sampling (keep 100 % of errors and audit; sample debug) | 30–50 % of log storage **[E]** | low | none: audit class untouched (CERT-In) |
| Committed-use / reserved capacity with the CSP | 20–40 % of compute **[E]** | medium | lock-in for the contract term |
| Move Flash vision calls to Flash-Lite where accuracy allows (screen decoder) | ≈ 70 % on those calls | medium | accuracy: gate with evals |

## 7. Sponsor credits and free tiers
| Source | What | Value | Status |
|---|---|---|---|
| Render (all participants) | Render credits | **$50 per participant** | [S] B-sponsors §0 |
| Render Workflows track prize | credits | $500 / $300 / $100 (1st/2nd/3rd) | [S] B-sponsors §0 |
| n8n | Pro membership for every team | "worth $60" | [S] B-sponsors §0 |
| Render migration programme | "up to $10K in migration credits" banner on the pricing page | not applicable to a new project [U] | seen on render.com/pricing, 2026-10-23 |
| Cloudflare R2 | free tier, zero egress | [K] | recheck at H0 |
| Gemini | free tier exists but is **not used for real users** (human review of prompts, 18+ terms; D-13) | — | [S] 04 §0.1–0.2 |
| Sentry, Grafana Cloud | free developer tiers | [U] quotas | owner Ops lead |
| Mastra, GeeksforGeeks, CodeCrafters, OSEN | in-kind sponsors with no credits relevant to hosting | — | [S] B-sponsors §2, §4–§6 |

## 8. Cost guardrails in code and ops
- **Hard caps:** Gemini spend alert at ₹1,000/day in the hackathon (A-21); evals ≤ ₹150 per run (evals.yml); voice 10 min/user/month enforced server-side.
- **Per-call cost is logged** (`md.cost_inr`) and shown on dashboard D9.
- **Budget review:** daily during the event, weekly in the pilot; any line over 120 % of forecast opens a ticket.
- **Under-18 users cost nothing in AI** by design (template cards, no voice), so a younger user base lowers AI cost.
