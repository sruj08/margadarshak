# Demo Script
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Demo driver (with Pitch lead) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PITCH](PITCH.md) (words) · [VISION](VISION.md) · [PROJECT_BRIEF](PROJECT_BRIEF.md) · `docs/02-design/UI_SPEC.md` (screens) · `docs/03-engineering/FRONTEND.md` (routes) · `docs/05-ops/RUNBOOK.md` (demo-day emergency plan) · `docs/08-project/HACKATHON_PLAN.md`
> **Route names below are the demo contract.** If `UI_SPEC.md` or `FRONTEND.md` name a route differently, those documents win and this file is updated (owner: Demo driver).
> Every screen shows the footer: *"Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State Transport Department. Uses simulated government data."* All identities are synthetic. No real Aadhaar, phone or OTP is ever typed on stage.

---

## 0. Roles on stage
| Role | Person | Device | Job |
|---|---|---|---|
| **Narrator** | Pitch lead | Clicker | Says the words in [PITCH](PITCH.md); never touches the phone |
| **Driver** | Demo driver | Phone A (Android, mirrored by `scrcpy` over USB to the laptop) | Taps exactly as below |
| **Backup operator** | Engineering lead | Laptop B with the fallback folder open | Switches the projector input to a fallback clip on a hand signal |
| **Timekeeper** | Any teammate | Phone stopwatch | Shows 1-minute cards; at "30 s left" the narrator jumps to the close |
| **Phone holder** | Any teammate | Phone C (WhatsApp test number recipient, allow-listed) | Holds it up when it buzzes |

**Hand signals:** one raised finger = "switch to fallback for this beat"; flat palm = "skip this beat".

---

## 1. Pre-flight checklist

### 1.1 T−60 minutes
- [ ] Hit the live URL and API health (`GET /v1/health`, API-64) to wake the Render services (free services sleep after 15 min and take ~1 min to wake; B-sponsors §0). Leave a tab auto-refreshing `/v1/health` every 5 minutes until the slot.
- [ ] Run `scripts/demo-seed` (or the admin seed endpoint) to reset the seven demo personas (§2) and clear yesterday's sessions.
- [ ] Trigger `ingest_clip` once with `inject_failure=transcode:1` so a fresh run with a visible retry is on the Render Runs page; bookmark it.
- [ ] Trigger `journey_sweep` from n8n manually once; confirm a WhatsApp lands on Phone C.
- [ ] Open the n8n canvas (journey sweep workflow) in a laptop tab; zoom to fit.
- [ ] Preload the Nazar demo clip in the PWA: open `/learn/nazar/practice?clip=demo-jammu-bus-01`, let it buffer fully, go back (the clip is served from the PWA cache).
- [ ] Voice check: say the line once in a quiet corner; confirm the transcript and the Form 1A card appear.
- [ ] Phone A: brightness max, Do Not Disturb on (except WhatsApp on Phone C), font scale default, battery > 80%, mobile hotspot ready as Wi-Fi backup.
- [ ] Laptop: parivahan.gov.in open in tab 1 (logged out, mega-menu tested); fallback folder open (§5).
- [ ] Re-check Kerala HPT status (no stay) and say "announced format" (D-25).
- [ ] Fill the evidence slide from the Sat 18:00 data freeze; check every ₹ figure against `fees.json`.

### 1.2 T−15 minutes
- [ ] `/v1/health` green; `/v1/stats/public` (API-71) returns current n.
- [ ] Persona switcher opens (§2) and "New user (Kabir)" is selected; app language reset to "choose".
- [ ] Render Runs page and n8n canvas tabs ready on the laptop.
- [ ] QR card printed (backup) and QR slide ready.

### 1.3 T−2 minutes
- [ ] Phone A on the Margdarshak home, language picker visible.
- [ ] Projector showing tab 1 (parivahan.gov.in).
- [ ] Timekeeper ready.

---

## 2. The persona switcher (demo only)
- **Open:** long-press the Margdarshak wordmark for 2 s, or visit `/?demo=1`. A bottom sheet lists personas. It is visible only when `DEMO_MODE=true` and carries the chip "Demo data".
- **What it does:** loads a seeded case (synthetic) through API-10/API-15 and sets the server-side demo clock for that case only. It never changes the device clock (EC-15: server time is the source of truth).

| Persona | Stage | Seeded state | What the home shows (F-08) | Used in beat |
|---|---|---|---|---|
| **Kabir · New** (P-01) | S0 | No case | Language picker → 4 verb tiles + mic | 3.2 |
| Kabir · LL day 12 | S4 | LL issued 12 days ago, MCWG + LMV-NT | "Driving test unlocks in 18 days" + today's drill | optional |
| **Kabir · LL day 31** | S5 | LL day 31, readiness 86, Nazar best 54 | "Book your driving test" + nearest slots + "practise hazards" | 3.6 |
| Kabir · LL expiring | S5 | LL day 165, no test booked | Red-amber banner "LL expires in 15 days" + plan (EC-07) | optional |
| Kabir · Failed test | S6F | DL test failed yesterday (reverse park) | Private debrief → drill → retest date (7-day gap) → remedial-training referral (EC-08) | optional / Q&A |
| **Mohan-ji · DL holder** (P-03) | S9 | DL expiring in 11 months, age 52 | Renewal window, Form 1A note, "no grace period" | 3.3 (after voice) |
| Rahul · 17 (P-07) | S1 | Age 17 | Family mode on a parent's phone: ≤ 50 cc gearless path with guardian consent; full product incl. AI (D-13 revised) | Q&A (Sambyal) |

---

## 3. The run (5-minute version; exact clicks)
Timings match [PITCH §3](PITCH.md). The 3-minute version uses beats 3.1, 3.2, 3.3 (voice only), 3.4 (photo + check answers only), 3.5 (one line), 3.6, 3.8, 3.9.

### 3.1 0:00–0:40 — The real portal
| # | Device | Action | Expected | If it fails |
|---|---|---|---|---|
| 1 | Laptop | Tab 1: `https://parivahan.gov.in/parivahan/` | Homepage with carousel (fraud banner) | **F-1**: play `fallback/01-parivahan-scroll.mp4` (20 s screen recording made on 23 Oct) |
| 2 | Laptop | Hover "Online Services" mega-menu; slowly scroll to show "SLD Maker", "VLTD Maker", "Homologation" | 22-item menu | Same |
| 3 | Laptop | Hover "Informational Services" → show ~40 links | Mega-menu | Same |
| 4 | — | Narrator: "Ten seconds." Pause 3 s | — | — |
| 5 | Laptop | Switch projector to Phone A mirror | Margdarshak language picker | **F-2**: if mirroring fails, the driver holds Phone A under the document camera, or the backup operator plays `fallback/02-full-run.mp4` from beat 3.2 |

### 3.2 0:40–1:30 — 3-tap plan (F-01, F-02, F-03)
| # | Action (Phone A) | Expected | Fallback |
|---|---|---|---|
| 6 | Tap **हिन्दी** on the language picker (`/`) | Home in Hindi: headline, 4 verb tiles, mic, trust line "₹700 + ₹200 card…" | **F-3**: if the API is slow, the home renders from the PWA cache (static); continue |
| 7 | Tap tile **"पहला लाइसेंस लें"** (Get my first licence) → `/plan` | Step 1/3: age | — |
| 8 | Tap age **19** (or enter DOB 2007-05-14) | Step 2/3: vehicle pictures | — |
| 9 | Tap **motorcycle (with gears)** and **car** pictures → "Next" | Step 3/3: state | — |
| 10 | Tap **Jammu & Kashmir** | Plan card (`/plan/result`): MCWG + LMV-NT on one LL; fee lines LL ₹150 × 2, LL test ₹50, DL test ₹300 × 2, DL ₹200 = ₹1,150 + card ₹200; "source: CMVR r.32, checked 22 Oct 2026"; documents; max RTO visits; earliest DL test "day 31"; LL validity 6 months | **F-4**: API-01 error → the client shows the cached plan for this exact input (seeded in the PWA cache at T−60); if that fails, show slide `fallback/03-plan-card.png` |
| 11 | Scroll once to show "Smart class planner" note and "verify at your RTO" chips | — | — |
| 12 | Tap **"WhatsApp पर भेजें"** (Send to WhatsApp) → choose the demo contact | Toast "Sent"; Phone C buzzes in ≤ 10 s (API-04 → n8n → WhatsApp template) | **F-5**: if no buzz in 10 s, narrator continues; Phone holder shows `fallback/04-whatsapp-plan.png` on Phone C's gallery; the email copy also arrives |

### 3.3 1:30–2:15 — Voice guide and family (F-30, F-17)
| # | Action | Expected | Fallback |
|---|---|---|---|
| 13 | Tap the **mic** (bottom centre) | Voice orb (Rive) listening; "AI can't book, pay or submit" line visible | **F-6**: mic permission denied → tap "type instead" and paste the line from the clipboard keyboard suggestion |
| 14 | Say clearly: **"Mere papa 52 saal ke hain, unko car ka licence chahiye."** | Transcript appears; spoken Hindi reply; card: LMV-NT · **Form 1A** (age over 40) · steps · "Start in Helper mode"; source chips with rule IDs | **F-7**: if no reply in 4 s, tap "type instead" (same result through the text path); if the AI is down, the rules-only card still appears from the intent parser with a "voice unavailable" chip (EC-29); last resort `fallback/05-voice.mp4` (20 s) |
| 15 | Tap **"Helper mode में शुरू करें"** | Consent screen: helper name (synthetic), purpose, "recorded consent", "clear this device" | Skip if time is short |
| 16 | Tap **"सहमति दर्ज करें"** (record consent) → back to Kabir | Toast "Helper link created" (E-29) | — |
| 17 | (Optional) Persona switcher → **Mohan-ji · DL holder** | Renewal card: window 1 year before to 1 year after expiry, no grace period, Form 1A | Skip in the 3-min version |

### 3.4 2:15–3:00 — Guided LL application (F-05, F-06, F-07)
| # | Action | Expected | Fallback |
|---|---|---|---|
| 18 | Persona switcher → **Kabir · New**, then tap **"Start my licence"** on the saved plan → `/apply` | Screen 1: one question, "why we ask" link | — |
| 19 | Tap prefilled answers through screens 1–3 (name, DOB, address from the mock DigiLocker consent; chip "simulated") | Progress "3 of 6"; "Saved" tick after each | **F-8**: autosave error → the local draft banner "Saved on this phone, will sync" (EC-11); continue |
| 20 | Screen 4 **Photo**: tap "Choose photo" → pick `demo-bad-selfie.jpg` from the gallery (dark background, tilted) | Fixer runs on-device: crop, rotate, background whitened, size/dimension check → "Meets the size rules" | **F-9**: camera/gallery permission problem → tap "Use sample photo" (bundled asset); if the fixer crashes, show `fallback/06-photo-fixer.mp4` |
| 21 | Screen 5 **Signature**: tap "Use sample signature" | Cleaned signature | — |
| 22 | Screen 6 **Check your answers**: scroll; tap one "Change" link and back | Summary with Change links; note "edits lock after payment on Sarathi" | — |
| 23 | Tap **"Continue on Sarathi"** | Hand-off screen (API-16): copy-pack + deep link; banner "simulated: in production this step runs on Sarathi"; Aadhaar/OTP/payment never shown in Margdarshak | **F-10**: none needed (static); never open the real Sarathi site on stage |

### 3.5 3:00–3:15 — Readiness (F-20, F-21, F-22)
| # | Action | Expected | Fallback |
|---|---|---|---|
| 24 | Bottom nav **Learn** → `/learn` | Readiness "62 = knowledge 70 − calibration 8" and "practise 5 weak signs" | — |
| 25 | Tap **"Practise weak signs"**; answer 5 seeded questions (driver knows the answers) | Readiness animates to "86 = knowledge 90 − calibration 4"; "book anyway" link visible | **F-11**: if the review queue (API-31) is slow, persona switcher → **Kabir · LL day 31** (already at 86) |
| 26 | (5-min only) Tap **"LL test simulator"** → guided first run shows the timer callout for 2 s → back | State format from config | Skip in the 3-min version |

### 3.6 3:15–3:45 — Day 31 and Nazar (F-08, F-10, F-23, F-25)
| # | Action | Expected | Fallback |
|---|---|---|---|
| 27 | Persona switcher → **Kabir · LL day 31** | Home: "Book your driving test", nearest slots (mock, chip "sample data"), "Notify me if an earlier slot opens" | **F-12**: persona switch fails → open `/?demo=1&persona=kabir-day31` from the bookmark |
| 28 | Tap **"Practise hazards (Nazar)"** → `/learn/nazar/practice?clip=demo-jammu-bus-01` | Kerala-format practice card "10 clips × 10 marks, pass 60 (announced format)"; demo plays one clip | — |
| 29 | Tap **Play**; when the bus starts pulling out (about 0:05.6 into the clip), **tap once** | Tap marker on the timeline | **F-13**: clip won't play → it is cached; toggle airplane mode and replay from cache; else `fallback/07-nazar-tap.mp4` |
| 30 | Clip ends → **debrief** (API-36) | Card: "How you did · Where you lacked · What you could have done · Your next drill"; "You tapped 1.4 s late ≈ 16 m at 40 km/h"; "Next time scan parked buses and their front wheels"; chip "numbers computed by scorer, narrated by AI" | **F-14**: AI narration timeout → template debrief with the same numbers (EC-29, chip "AI narration unavailable"); if the API is down, `fallback/08-debrief.png` |
| 31 | (Optional, 5 s) Tap the chip **"How was this computed?"** | Shows onset 0:04.2, tap 0:05.6, Δ 1.4 s, speed 40 km/h → 15.6 m | — |

**Driver's timing note:** the seeded clip's annotated onset is 0:04.2. Tapping at about 0:05.6 reproduces the scripted 1.4 s. If the tap lands elsewhere, the narrator reads the real number from the card; never the scripted one.

### 3.7 3:45–4:15 — Render Workflows + n8n (5-min only)
| # | Device | Action | Expected | Fallback |
|---|---|---|---|---|
| 32 | Laptop | Switch projector to the Render dashboard tab → Workflows → `margdarshak-jobs` → Runs → the bookmarked `ingest_clip` run | Parent run with child tasks `transcode → blur → propose_windows → await_two_raters → compute_agreement → publish`; one child shows "retrying" then "succeeded" | **F-15**: dashboard login/session problem → `fallback/09-render-runs.mp4` (recorded at T−60) |
| 33 | Laptop | Switch to the n8n tab → journey-sweep workflow | Schedule Trigger → HTTP Request (Render run-task API) → WhatsApp node | **F-16**: `fallback/10-n8n-canvas.png` |
| 34 | Phone C | Hold up the WhatsApp message from the sweep ("Your LL expires in 15 days…" for the expiring persona) | — | Screenshot in the gallery |

### 3.8 4:15–4:45 — Evidence
| # | Device | Action | Expected | Fallback |
|---|---|---|---|---|
| 35 | Laptop | Slide 9 (evidence) | Before/after metrics + field numbers + pre-registration hash | — |
| 36 | (Optional) Laptop | `/stats` page (API-71) live counters | n updates | **F-17**: slide only |

### 3.9 4:45–5:00 — Close
| # | Device | Action | Expected | Fallback |
|---|---|---|---|---|
| 37 | Laptop | Slide 1 again with the QR "Take the 3-minute hazard test" | Judges scan → `/nazar/challenge` (18+ consent screen first) | **F-18**: printed QR card handed to each judge; short URL on the slide |

---

## 4. Judge-plays-it moment (if the format allows a judge to hold the phone)
1. Persona switcher → "Guest (18+ challenge)"; hand Phone A to the judge.
2. Consent screen: "I am 18+ and agree" (field-kit §2 text).
3. One practice clip, then the debrief. The narrator reads nothing; the judge reads their own number.
4. Say: "That's a practice score in Kerala's announced format with our Jammu clips, not a verdict on your driving."
5. Their session is a real field-study row **only if** they consented; otherwise it runs in demo mode and is discarded.

---

## 5. Fallback register (every live element)
| ID | Live element | Failure mode | Detection | Fallback | Prepared asset |
|---|---|---|---|---|---|
| F-1 | parivahan.gov.in | Site slow, down, or layout changed | Page not loaded in 5 s | Play recording | `fallback/01-parivahan-scroll.mp4` |
| F-2 | Phone mirroring (scrcpy) | USB/driver failure | Black projector | Document camera, or full-run video | `fallback/02-full-run.mp4` (≤ 4:30, recorded on the final build) |
| F-3 | Home render | API slow | Spinner > 2 s | PWA cached shell renders anyway | — |
| F-4 | Plan API (API-01) | 5xx / timeout | Error state | Cached plan for the scripted input; slide | `fallback/03-plan-card.png` |
| F-5 | WhatsApp via n8n | No delivery in 10 s (Meta test number limits, R-08) | Phone C silent | Screenshot; email copy | `fallback/04-whatsapp-plan.png` |
| F-6 | Mic permission | Denied | Browser prompt | "Type instead" path | Clipboard line |
| F-7 | Voice guide (M-01) | ASR/Live latency or outage | No reply in 4 s | Typed path → same card; rules-only card; video | `fallback/05-voice.mp4` |
| F-8 | Autosave (API-12) | Network | "Saved on this phone" banner | Continue offline (EC-11) | — |
| F-9 | Photo fixer | Permission / crash | Error toast | "Use sample photo"; video | `demo-bad-selfie.jpg`, `fallback/06-photo-fixer.mp4` |
| F-10 | Sarathi hand-off | — (static, mock) | — | — | — |
| F-11 | Review queue (API-31) | Slow | Spinner > 2 s | Jump to persona LL day 31 | — |
| F-12 | Persona switcher | Sheet fails | No sheet | Deep link bookmark `/?demo=1&persona=…` | Bookmarks on Phone A |
| F-13 | Nazar video | Won't play / buffering | No playback in 2 s | Cached replay; recording | `fallback/07-nazar-tap.mp4` |
| F-14 | AI debrief (M-02) | Gemini 429/timeout | Spinner > 3 s | Template debrief with the same computed numbers | `fallback/08-debrief.png` |
| F-15 | Render dashboard | Login expired | Login page | Recording of the run with the retry | `fallback/09-render-runs.mp4` |
| F-16 | n8n canvas | Session expired | Login page | Screenshot | `fallback/10-n8n-canvas.png` |
| F-17 | Live stats (API-71) | Error | Error state | Slide 9 only | — |
| F-18 | Closing QR | Judges can't scan | — | Printed QR cards, short URL | Printed cards |
| F-19 | Venue Wi-Fi | Down | Health tab red | Phone A on mobile hotspot; laptop tethered to Phone C | — |
| F-20 | Render cold start | Service asleep | Health > 5 s | Keep-alive tab from T−60; if still cold, start with the parivahan beat (40 s) while it wakes | — |
| F-21 | Whole live demo | Multiple failures | Narrator's call | Switch to `fallback/02-full-run.mp4` and narrate over it; say "this is a recording of the live build" | — |
| F-22 | Time overrun | Timekeeper card "30 s" | — | Skip to the evidence slide and close (§3.8–3.9) | — |

**Honesty rule:** if a fallback recording is used, the narrator says so in one short phrase ("here's the recording of this step"). Never present a recording as live.

---

## 6. Cut list (if behind schedule during the pitch)
1. Drop beat 3.3 step 17 (Mohan-ji persona).
2. Drop beat 3.5 step 26 (LL simulator).
3. Drop beat 3.7 (Render + n8n) from the live run; it stays on appendix slide A1 and in the video.
4. Drop beat 3.4 steps 19–21; keep only the photo fixer (step 20) and the hand-off (step 23).
Never drop: the plan card (3.2), Nazar + debrief (3.6), the evidence slide (3.8) or the close (3.9).

---

## 7. The ≤ 5-minute submission video (shot list)
| Time | Shot | Source |
|---|---|---|
| 0:00–0:20 | parivahan.gov.in scroll + agent price card | Screen recording |
| 0:20–1:20 | One continuous citizen run on a phone: language → 3 taps → plan card → WhatsApp buzz | Phone screen recording + phone-in-hand B-roll (no faces of participants) |
| 1:20–1:45 | Voice line → Form 1A card | Screen recording |
| 1:45–2:20 | Apply: photo fixer → check answers → hand-off | Screen recording |
| 2:20–3:10 | Day 31 → Nazar clip → tap → debrief "1.4 s late ≈ 16 m" | Screen recording |
| 3:10–3:40 | Render Runs page with retry + n8n canvas + WhatsApp on a real phone | Screen recordings |
| 3:40–4:20 | Evidence slide; a consented audio-only quote | Slide + audio |
| 4:20–4:45 | Architecture slide with owners | Slide |
| 4:45–5:00 | QR + tagline + non-affiliation line | Slide |

The replica of Sarathi screens used in the journey test is labelled "lab replica" in any shot that shows it, and is never shown at a public URL (field kit §11.8).
