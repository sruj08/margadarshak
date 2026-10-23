# Accessibility
> Project: Margdarshak · Team: Chanakya (@Nestiq Private Limited) · Owner: Accessibility lead (Design lead in the hackathon) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [Design system](DESIGN_SYSTEM.md) · [Localization](LOCALIZATION.md) · [Content style](CONTENT_STYLE.md) · [UI spec](UI_SPEC.md) · [Testing](../03-engineering/TESTING.md) · [Compliance](../06-security-compliance/COMPLIANCE.md) · [Game design](../09-learning-games/) · [Government adoption](../10-government/)
> Features: F-52 (accessibility), F-50 (languages), F-51 (Lite/offline), F-23/F-24 (games), F-30 (voice), F-17 (Helper). Directives: D-21 (accessibility), D-19 (wording), D-13 (age gates).

---

## 0. Our claim, in words we can defend
- **Target:** conformance with **WCAG 2.1 Level AA**, plus the **WCAG 2.2 Level A/AA additions**, plus selected AAA criteria listed in §2.3.
- **Mapped to:** GIGW 3.0, BIS **IS 17802 (Part 1): 2021 and (Part 2): 2022**, and UX4G 3.0's accessibility foundation.
- **Wording on stage and in the product:** "Designed and tested to WCAG 2.1 AA and GIGW 3.0", plus "audit-ready". We never say "certified", "STQC-certified" or "fully accessible" (D-19, G5). We say "WCAG 2.1 AA conformant" only after the §9 test plan passes in full and the accessibility statement (§10) is published with known issues listed.
- **Why it matters for this user base:** the government portal's own accessibility controls are superficial:
  - hover-only mega-menus;
  - a continuously scrolling marquee (fails 2.2.2);
  - one Hindi toggle (`team-saarthi-report.md` l.71);
  - Sarathi's screen-reader page claims WCAG **2.0** AA and lists discontinued screen readers such as Window-Eyes (`ps1-current-state/01-sarathi-screens.md` l.290).

  Low-literacy and non-English users depend on a "cyber-café uncle" (`03-user-pain.md` l.413).

| | Hackathon build (Phase 1–2) | Production (Phase 3+) |
|---|---|---|
| Scope | Three deep slices (D-04): plan card → guided LL application → check answers; Nazar + debrief; stage-aware home. Every other screen passes automated checks and keyboard/TalkBack smoke tests. | Every screen, every locale, every tenant skin |
| Testing | axe + Playwright in CI, contrast CI, manual TalkBack/NVDA scripts, 2–3 users with disabilities in the journey test where they consent | Quarterly audit by a certified accessibility professional; users with disabilities in UAT for every new feature (the pattern the Supreme Court directed for banks in *Pragya Prasun*, `research/domains/ps3-standard-banking.md` l.126); UX4G Audit 360; STQC/CERT-In-empanelled audit before government hosting |
| Evidence | Accessibility statement draft, axe report, Lighthouse a11y ≥ 97 on key routes | Published statement, IS 17802 conformance report (ACR) if the RPwD 2026 draft amendment is notified |

---

## 1. Legal and standards frame
| Instrument | What it requires (as we understand it) | Status of our source | How Margdarshak responds |
|---|---|---|---|
| **Rights of Persons with Disabilities Act 2016** | Accessibility of information and communication technology, and of transport-related services, for persons with disabilities [section numbers, e.g. s.40 and s.42, to be cited only after reading the Act text, per the `verification.md` §3.3 instruction; owner: Accessibility lead, 2026-10-26] | Unverified section text | Treat as binding for government-hosted mode; design for it now |
| **RPwD (Amendment) Rules 2023** (notified 11 May 2023, amending Rule 15 of the RPwD Rules 2017) | Covered ICT (websites, applications, ICT-based public services) must meet **IS 17802 (Part 1): 2021** (requirements) and **IS 17802 (Part 2): 2022** (determination of conformance) | SECONDARY: search summaries of the gazette ([Voice of SAP PDF](https://www.voiceofsap.org/wp-content/uploads/2023/05/RPWD-Amendment-Rules-2023-ICT-Products-and-Services.pdf), [SCC Online](https://scconline.com/blog/?p=291941)), gazette not read | §4 maps IS 17802 functional performance statements to features |
| **Draft RPwD (Amendment) Rules 2026** | Revises Rule 15(1)(c) and adds an **Accessibility Conformance Report** requirement | Draft only; final notification not confirmed ([IndiaLaw](https://www.indialaw.in/blog/regulatory/rpwd-amendment-rules-2026/), [Mondaq](https://www.mondaq.com/india/compliance/1824050/the-new-accessibility-conformance-regime-key-takeaways-from-the-draft-rpwd-amendment-rules-2026)) | Production: produce an ACR (VPAT-style, IS 17802 clauses) per release [owner: Accessibility lead, Phase 3] |
| **GIGW 3.0** (Guidelines for Indian Government Websites and Apps) | WCAG 2.1 AA baseline; bilingual content; accessibility statement; security audit clearance before hosting (guideline 5.3.1, secondary source); a named Web Information Manager | SECONDARY: primary manual at https://guidelines.india.gov.in/ not read (D-25) | §3 self-assessment matrix |
| **GuDApps** (GIGW for apps) | Mobile app guidance | Link only (https://guidelines.india.gov.in/about-gudapps/) | PWA installable, offline, Lite |
| **UX4G 3.0** | WCAG 2.1 AA; "never colour alone"; no saffron body text; Accessibility Widget; Audit 360 | VERIFIED live in `06` A5 | Tokens mapped (DESIGN_SYSTEM §13); Audit 360 pre-audit (§9.6) |
| **WCAG 2.1 / 2.2** (W3C) | Success criteria below | Standard | §2 |
| **CCPA Dark Patterns Guidelines 2023** | Bans false urgency, confirm-shaming, forced action etc. | `05` §2 [V] | Accessibility overlap: no fake timers, no forced camera (Helmet Fit has a no-camera path), no confirm-shaming |
| **MoRTH advisory on deaf applicants** | Deaf applicants may hold licences (as referenced in `verification.md` row 17, CARRIED) | Carried, not re-read | EC-13: deaf-friendly flows (§5.4) |

---

## 2. WCAG checklist

### 2.1 WCAG 2.1 Level A and AA (all 50 criteria)
Test key:
- **A** = automated (axe/Playwright/Lighthouse/contrast script);
- **M** = manual (keyboard/screen reader/visual);
- **U** = user test.

| SC | Level | Name | How Margdarshak meets it | Test |
|---|---|---|---|---|
| 1.1.1 | A | Non-text content | Every meaningful image has an `alt`/`aria-label` in the active language. Road signs carry `<title>` (name) and `<desc>` (meaning). Decorative glows, kolam lines and illustrations are `aria-hidden`. Nazar still frames have descriptions written by the clip raters. Vehicle pictograms are labelled with the legal class name. | A + M |
| 1.2.1 | A | Audio-only and video-only (prerecorded) | Nazar clips are **video-only** (no meaningful audio). The text alternative is the per-clip hazard description, shown in the debrief and in the screen-reader alternative mode. The Rive track explainer has step captions. | M |
| 1.2.2 | A | Captions (prerecorded) | Any explainer video with speech (track explainer voice-over, test-day calm-down) has captions in EN/HI (WebVTT). Voice guide TTS answers are always captioned on screen. | M |
| 1.2.3 | A | Audio description or media alternative | Track explainer: a step-by-step text alternative ("Step 3: reverse into the bay; the examiner checks the line"). Nazar: an alternative still-frame lesson. | M |
| 1.2.4 | AA | Captions (live) | No live media in the hackathon. Gemini Live voice is roadmap (D-12); if added, the transcript is shown live. | — |
| 1.2.5 | AA | Audio description (prerecorded) | Explainer videos with visual-only steps also have a described version (text track `kind="descriptions"` or a narrated variant). | M |
| 1.3.1 | A | Info and relationships | Semantic HTML through React Aria/HeroUI: landmarks (`header`, `nav`, `main`, `contentinfo`), headings in order, `ol` for journey steps, `table` with `caption` for fees, `fieldset`/`legend` for question groups, `label` for every field. | A + M |
| 1.3.2 | A | Meaningful sequence | DOM order = visual order in both LTR and RTL. The docked orb comes after `main` in the DOM. | M |
| 1.3.3 | A | Sensory characteristics | Instructions never rely on shape, colour, position or sound alone ("Tap **Continue**", never "tap the button on the right" or "the green one"). | M (copy review) |
| 1.3.4 | AA | Orientation | Works in portrait and landscape. Nazar *suggests* landscape but never locks it. | M |
| 1.3.5 | AA | Identify input purpose | `autocomplete` on personal fields: `name`, `bday`, `street-address`, `postal-code`, `tel`, `email`. Fields we must not collect (Aadhaar, OTP) do not exist. | A |
| 1.4.1 | A | Use of colour | Status = glyph + colour + word (DESIGN_SYSTEM §3.5). Links are underlined. Charts use direct labels + hatching. Nazar hazard bands use a striped pattern (`08` l.205). | M |
| 1.4.2 | A | Audio control | No audio autoplays. Game sound starts muted until the user turns it on. TTS has pause/stop. | M |
| 1.4.3 | AA | Contrast (minimum) | Every text pair is computed in `tokens.json`; CI fails below 4.5:1 (DESIGN_SYSTEM App. A). Lowest legal text pair: ink-3 on surface-3 at 4.71. | A |
| 1.4.4 | AA | Resize text | rem units; `html { font-size: 100% }`; tested at 200% with no loss of content. 18 px body floor. | A (Playwright zoom) + M |
| 1.4.5 | AA | Images of text | None, except the share card image (an exempt "essential" representation), which carries its full text as `alt` and in the share message. | M |
| 1.4.10 | AA | Reflow | No horizontal scroll at 320 CSS px (400% zoom of 1280). Fee tables restack into rows. | A (Playwright 320 px) |
| 1.4.11 | AA | Non-text contrast | Input outlines `#808080` (3.52–3.95), focus ring (4.56+), current-step ring (3.63), Nazar ring on road (7.69). HeroUI's transparent `--field-border` is overridden. | A + M |
| 1.4.12 | AA | Text spacing | Survives line-height 1.5, paragraph spacing 2×, letter-spacing 0.12 em and word-spacing 0.16 em. Indic text forbids *our* letter-spacing, but user stylesheets are allowed and tested (bookmarklet test). | M |
| 1.4.13 | AA | Content on hover or focus | Tooltips are dismissible (Esc), hoverable and persistent. On touch, glossary terms open a Popover on tap. Tooltips never hold essential info. | M |
| 2.1.1 | A | Keyboard | Everything works by keyboard, including Nazar (Space or Enter = tap at the current focus point; in keyboard mode the tap registers as "hazard now" without position) and games (tap-only modes). | M + A (Playwright keyboard paths) |
| 2.1.2 | A | No keyboard trap | Modals/Drawers trap focus correctly (React Aria) and release on close. The Rive canvas is not focusable. | M |
| 2.1.4 | AA | Character key shortcuts | Single-key shortcuts exist only in the console (F-41) and in Nazar while focused, and can be turned off in Settings. | M |
| 2.2.1 | A | Timing adjustable | No timers in journey flows. The **LL test simulator** offers "Practice (no timer)" and "Real format (timed, as your state's test)". The timed mode warns and allows pause [the timer is part of the simulation; we treat it as user-chosen, not essential]. Helper-mode auto-logout warns at 60 s and can be extended. | M |
| 2.2.2 | A | Pause, stop, hide | No marquees or carousels. The orb's idle breathing stops after 3 cycles. The listening rings run only while the mic is on. Clips have Pause. | M |
| 2.3.1 | A | Three flashes or below threshold | Every Nazar clip and game asset passes the flash check (§6). Night & Glare caps flashes below 3 per second. | A (clip pipeline) + M |
| 2.4.1 | A | Bypass blocks | Skip link "Skip to main content" (`.md-skip-link`), landmarks. | A |
| 2.4.2 | A | Page titled | Every route has a unique `<title>` in the active language: "{Screen} · {Stage} · Margdarshak". | A |
| 2.4.3 | A | Focus order | Logical order; after route change, focus moves to the `h1`; after a submit error, to the ErrorSummary. | M |
| 2.4.4 | A | Link purpose (in context) | Link text says where it goes ("Change date of birth", "Read CMVR rule 32 (opens in new tab)"). | A + M |
| 2.4.5 | AA | Multiple ways | Bottom tabs, "All services" grouped by who you are, search, voice guide, sitemap page. | M |
| 2.4.6 | AA | Headings and labels | One `h1` per screen = the question or stage. Labels are visible and specific. | M |
| 2.4.7 | AA | Focus visible | 3 px `--md-focus` ring, 2 px offset, never removed (`*:focus-visible`). | A + M |
| 2.5.1 | A | Pointer gestures | No path-based or multi-point gestures are required. Swipe on the debrief stack has Next/Previous buttons. | M |
| 2.5.2 | A | Pointer cancellation | Actions fire on up-event (React Aria `onPress`). Nazar registers the tap at the *down* event for timing accuracy, which is the "essential" exception, and an accidental tap can be undone within the clip (no penalty for a single false alarm). | M |
| 2.5.3 | A | Label in name | The accessible name contains the visible label. Voice-guide commands match visible labels ("say 'Continue'"). | A |
| 2.5.4 | A | Motion actuation | The riding lock (speed > 10 km/h) is a *safety* gate with a "I'm a passenger" button. No shake or tilt is required; tilt input in games is optional (`08` l.40). | M |
| 3.1.1 | A | Language of page | `<html lang>` = active locale (`en`, `hi`; `doi` content is tagged `doi`). | A |
| 3.1.2 | AA | Language of parts | Language names in the picker, Hindi phrases in English screens, Latin legal codes in Hindi screens (e.g. "CMVR r.32") get `lang`. | A + M |
| 3.2.1 | A | On focus | No context change on focus. | M |
| 3.2.2 | A | On input | **No auto-submit on select** (Sarathi's state dropdown submits `onchange`: the anti-pattern). Choosing a state shows a Continue button. | M |
| 3.2.3 | AA | Consistent navigation | Same 4 tabs (Home · My Licence · Learn · Help) everywhere; same header. | M |
| 3.2.4 | AA | Consistent identification | Same icon + label for the same function across screens (e.g. the source chip, the AI chip). | M |
| 3.3.1 | A | Error identification | ErrorSummary + inline error text with ⬣ + `aria-invalid`. | A + M |
| 3.3.2 | A | Labels or instructions | Every question has a label, a hint and "Why we ask". Formats shown ("Day Month Year"). | M |
| 3.3.3 | AA | Error suggestion | Errors say how to fix ("Enter a date of birth in the past, like 14 08 2007"). | M (copy review) |
| 3.3.4 | AA | Error prevention (legal, financial, data) | **Check answers** before the Sarathi hand-off (edits lock after payment there). Deleting the account and clearing a device need confirmation. Consent can be withdrawn. | M |
| 4.1.1 | A | Parsing | Obsolete in WCAG 2.2 (removed). We still validate HTML in CI. | A |
| 4.1.2 | A | Name, role, value | React Aria primitives; custom components (ReadinessDial `meter`, JourneyMap `aria-current="step"`, VoiceOrb `button` with state in the name) have Storybook a11y tests. | A + M |
| 4.1.3 | AA | Status messages | `role="status"` for Saved/Copied/Sent toasts, payment status refresh and the voice transcript; `role="alert"` for errors. | A + M |

### 2.2 WCAG 2.2 additions (Level A and AA)
| SC | Level | Name | Margdarshak |
|---|---|---|---|
| 2.4.11 | AA | Focus not obscured (minimum) | The docked orb (72 px) and the bottom tab bar never cover the focused element. `scroll-padding-bottom` = tab bar + orb + 16 px. Sticky headers use `scroll-padding-top`. |
| 2.5.7 | AA | Dragging movements | Every drag has a single-pointer alternative: the Stopping Distance slider has arrow buttons; debrief swipes have Next/Previous; Blind Spot "place your bike" offers 3 tap-only lane buttons (`08` l.268). |
| 2.5.8 | AA | Target size (minimum) | We exceed it: 48 × 48 px minimum, 8 px spacing (DESIGN_SYSTEM §5.3). |
| 3.2.6 | A | Consistent help | "Help" tab + voice orb in the same place on every screen; the helpline/grievance contact in the footer. |
| 3.3.7 | A | Redundant entry | DOB, name and state are asked **once** and reused across the journey (Sarathi re-asks DOB about 6 times: `00-JOURNEY-MAP.md` row 3). The copy-pack pre-fills what Sarathi will ask. |
| 3.3.8 | AA | Accessible authentication (minimum) | No captchas, no memory or transcription tests in Margdarshak. Login is an email magic link or Google; magic-link codes can be pasted; password managers are supported. Sarathi's own captchas/OTPs are outside our UI (hand-off), and we warn about them in the copy-pack. |

### 2.3 Selected AAA we adopt
| SC | Why |
|---|---|
| 1.4.6 Contrast (enhanced) | Met in high contrast and Sunlight modes (ink-3 ≥ 9.05, SUN pairs ≥ 7) |
| 1.4.8 Visual presentation (partial) | 680 px measure, 1.5+ line height, no justified text |
| 2.2.3 No timing | All learning, games and Nazar have no countdown (anticipation, not speed) |
| 2.3.3 Animation from interactions | Reduced motion = opacity-only; in-app toggle |
| 2.5.5 Target size (enhanced) | 48 px exceeds 44 px |
| 3.1.5 Reading level | Plain language targets (CONTENT_STYLE §3) |

---

## 3. GIGW 3.0 self-assessment matrix (primary text not read; based on secondary sources and UX4G; re-verify, D-25)
| Area | Expectation (secondary) | Margdarshak evidence | Gap / owner |
|---|---|---|---|
| Accessibility baseline | WCAG 2.1 AA | §2, CI reports | Full audit before hosting (Accessibility lead) |
| Bilingual / multilingual | English + Hindi minimum; regional languages encouraged | EN + HI in full; Dogri voice-in (F-50, D-21) | Native review records (LOCALIZATION §11) |
| Accessibility statement | Published, with contact and known issues | §10 template | Publish at launch (Content lead) |
| Feedback / contact | Visible feedback mechanism and response | Footer "Report an accessibility problem" form → backend (stored as a ticket, emailed to the team inbox by the notifier; citizen text never passes through n8n, ADR-0006); target reply ≤ 5 working days | Backend ticket + W18 staff reminder (Backend lead) |
| Content currency | Page-level "last updated" / content review dates | Every rule shows `verified_on`; footer "Last updated {date}" | — |
| Sitemap, help, search | Present | `/sitemap`, Help tab, search | — |
| Security clearance before hosting | Audit clearance from NIC/STQC/empanelled lab (5.3.1, secondary) | "Audit-ready" pack (SBOM, VAPT scope, threat model) | Production only (Security lead) |
| Web Information Manager | Named person | Named in the tenant config for government-hosted mode | Tenant (Phase 3) |
| No hover-only navigation | Keyboard/touch-operable menus | Bottom tabs and plain links; no mega-menus | — |
| Downloadable documents accessible | Tagged PDFs, HTML alternatives | Practice Record PDF tagged (PDF/UA target), HTML version first | Production (Frontend lead) |
| Identity | Government identity for government sites | **Not applicable to our independent build**: no emblem, non-affiliation footer (D-01). Government shell slot only for a government tenant (DESIGN_SYSTEM §13.4) | — |
| Mobile | Responsive, app guidance (GuDApps) | PWA, offline, Lite | — |

---

## 4. IS 17802 functional performance mapping
IS 17802 Part 1 is widely described as aligned with the European EN 301 549 structure [alignment and clause numbering are unverified for the BIS text; owner: Accessibility lead, 2026-10-26]. We therefore organise conformance around its **functional performance statements** (how people with different abilities can use the product), plus the web (WCAG-equivalent) clauses. The clause numbers below follow EN 301 549 §4.2 and must be re-checked against the BIS standard.

| Functional need (EN 301 549 §4.2.x analogue) | Margdarshak provision |
|---|---|
| Usage without vision | TalkBack/VoiceOver/NVDA support (§5.1); voice guide (F-30) with spoken answers; Nazar screen-reader alternative lesson; LL simulator questions read aloud; road signs described in text |
| Usage with limited vision | 18 px body, 200% text, 400% zoom reflow, high contrast mode, Sunlight mode, 48 px targets, no information in thin hairlines |
| Usage without perception of colour | Glyph + word status; patterns in charts and Nazar bands; colour-vision notes in Learn for exam questions about signal colours (EC-13) |
| Usage without hearing | No meaningful audio in games (no-audio default); captions on all speech; WhatsApp/text instead of calls; ISL summaries on the roadmap |
| Usage with limited hearing | Captions; no audio-only alerts; adjustable TTS volume |
| Usage without vocal capability | Voice is never required; every voice action has a tap/type path |
| Usage with limited manipulation or strength | 48 px targets, no drag-only actions, no time limits, one-hand reachable primary actions, tap-only game modes |
| Usage with limited reach | Primary action in the bottom third; orb at the bottom; no top-corner-only actions |
| Minimise photosensitive seizure triggers | §6 flash check, no flashing UI, reduced motion |
| Usage with limited cognition, language or learning | Plain language, one question per screen, pictures for class choice, "Why we ask", read-aloud, autosave, no timers, Helper mode (§5.6) |
| Privacy | Screen-reader users get the same privacy: Helper mode consent is spoken; "clear this device" is announced; no PII read aloud on lock screens (notifications carry no personal data) |

---

## 5. Inclusive design by user need

### 5.1 Screen readers
| Platform | Screen reader | Browser | Priority | Notes |
|---|---|---|---|---|
| Android 9+ | **TalkBack** | Chrome | **P1** (most users) | Hindi TTS via Google Speech Services. Dogri has no TTS, so Dogri strings (if any) are read with the Hindi voice; tag `lang="doi"` and test what TalkBack does [unverified behaviour; owner: QA lead, H0] |
| iOS 16+ | VoiceOver | Safari | P2 | Hindi voice available on iOS [verify at H0] |
| Windows 10/11 | NVDA 2024+ | Chrome / Firefox | P2 (CSC/cyber café, P-04) | — |
| Windows | JAWS | Chrome / Edge | P3 (government offices) | Production audit |
| Android | Jio/KaiOS feature phones | — | Out of scope; WhatsApp/SMS fallbacks cover them (F-53) | — |

Rules:
- **Landmarks and headings first.** Every screen has `header` / `nav` / `main` / `contentinfo` and a single `h1`.
- **Route changes are announced:** focus moves to `h1`, and the title updates.
- **Live regions are polite** except errors. The voice transcript uses `aria-live="polite"` with `aria-atomic="false"`, so words are not re-read.
- **Canvas content is never the only path.** Phaser 4 games (Junction Scan, Track Test Twin, Hill Road) render to WebGL/canvas, which TalkBack cannot read (`08` l.53). Each has a `screen_reader_alt` mode: a DOM step-by-step explainer quiz.
- **Numbers read correctly:**
  - fees as "₹700" with `aria-label` "700 rupees" in EN and "700 रुपये" in HI;
  - dates as full words ("14 March 2027");
  - Nazar timing as "1.4 seconds early".
- **React Aria** gives correct roles for HeroUI components. Custom components are tested with the Storybook a11y addon plus a manual TalkBack script (§9.4).

### 5.2 Games without audio or sight
| Game (F-23/F-24) | Default a11y | `a11yModes` (Game SDK, `08` l.117) | Screen-reader alternative |
|---|---|---|---|
| **Nazar** hazard clips | No audio; tap anywhere; striped hazard bands in the debrief | `no_audio`, `colour_safe`, `one_hand`, `reduced_motion`, `tap_only`, `screen_reader_alt` | **Still-frame "which one is the hazard?"** mode with described frames. Labelled honestly: "This is a different skill from the timed clip test. Your score here is not a Nazar Score." (`08` l.205) |
| Stopping Distance | Numbers always shown, not just animated; big slider with buttons | as above | DOM quiz: "At 60 km/h on a wet road, how many metres to stop?" (numbers from physics code) |
| Blind Spot | Tap-only lane thirds; hatched no-zones + icon | as above | Described diagram + quiz |
| Junction Scan | Buttons only; arrows + labels; sight-lines as solid vs hatched | as above | Scan-order quiz |
| Track Test Twin | Tap-only "assist" mode; haptic + icon faults | as above | Step-by-step explainer quiz (`08` l.288) |
| Helmet Fit | Voice + visual prompts; **no-camera path** (quiz + checklist) with the same score cap, so camera use is never forced (CCPA "forced action") | as above | Checklist |
| Golden Hour | DOM, TalkBack-friendly, no timing pressure | n/a | Native (it is DOM) |
| Night & Glare | Glare as a brightness gradient plus an outline; safe-luminance option; flashes < 3/s | as above | Quiz |
| Hill Road (J&K) | Buttons for gear, brake, horn; horn feedback visual + haptic | as above | Quiz |
| LL Test Simulator | DOM; questions readable aloud; untimed practice mode | n/a | Native |

Scoring fairness:
- Alternative modes never produce a score that is compared with standard-mode scores.
- Squads show the mode used.
- No-audio mode is the default, so deaf users are not on an "alternative" at all.

### 5.3 Photosensitivity
§6 has the full procedure. Summary: ≤ 3 flashes per second, no red flashes, a luminance-delta cap in Rive/Lottie, and clip QA before publish.

### 5.4 Deaf and hard-of-hearing applicants (EC-13)
- The hazard game is visual by design.
- No audio cue is ever required. Captions are on for every speech.
- The voice guide is optional; every action has a tap path.
- Test-day co-pilot: a "show at counter" card with written phrases ("I am deaf. Please write instructions.") in EN/HI.
- A rights card (content from the MoRTH advisory, re-verified before shipping; owner: Content lead).
- ISL video summaries are roadmap (`REFINED-OVERVIEW` §4).

### 5.5 Colour vision (EC-13)
- Status never depends on colour.
- Learn adds a "colour-vision note" on questions involving signal colours, explaining position cues (red on top, amber in the middle, green at the bottom for vertical signals). Content is re-verified against IRC/MoRTH material before shipping.
- The colour-safe game mode replaces red/green feedback with shape (✓ / ✕) and pattern.

### 5.6 Low literacy and low digital confidence (P-03 Mohan-ji, P-04 Helper users)
| Pattern | Implementation |
|---|---|
| Pictures before words | Vehicle pictograms for class choice (F-02); document pictograms with "Example" |
| One question per screen | QuestionPage (GOV.UK) with a large `h1` question |
| Read aloud everywhere | A 🔊 "Listen" button on every content screen and question (browser `speechSynthesis` offline for EN/HI where voices exist; Bulbul `hi-IN` online). Not AI-generated text: it reads the screen's own reviewed copy |
| Voice to navigate | VoiceGuide (adult only, D-13); prompt chips show what to say |
| Short sentences, common words | CONTENT_STYLE §3 targets; Hindi uses everyday words and common English loanwords (LOCALIZATION §9) |
| Numbers as digits, money as ₹ | "₹700", "30 दिन", never words-for-numbers |
| Confirm by reading back | "We'll use this name: Kabir Sharma. Is that right?" |
| Never punish mistakes | Undo, Change links, autosave, no timeouts |
| Helper mode | A family member or CSC operator can fill with recorded consent (F-17); the banner always shows who is helping |
| "Show papa" card | A one-screen summary to share with the family decision-maker (`05` principle 6) |
| Icons always labelled | No icon-only navigation |

### 5.7 Older devices, low bandwidth and outdoor use (EC-19)
| Baseline | Target |
|---|---|
| Device floor | Android 8+ with Chrome 100+, 2 GB RAM, 360 × 640 CSS px. Test device: Moto G-class or Redmi A-series (team-owned) [exact model at H0; owner: QA lead] |
| Network | First load < 300 KB in Lite mode; usable on "Slow 3G" (Lighthouse throttling); offline mock tests and cached lessons via Serwist |
| Clip size | 360p, about 1–2 MB per clip, preloaded fully before scoring (EC-18) |
| CPU | Rive capped at 30 fps on `deviceMemory ≤ 4`; Lite removes Rive/Lottie |
| Sunlight | Sunlight mode (AAA contrast, 20 px body, no glows) for RTO yards |
| Font scaling | Android "Largest" font + 200% browser zoom pass |

### 5.8 Cognitive load and anxiety (test day, fail moments)
- A 2-minute calm-down (Diya `calm-breath`, visual-only breathing guide).
- No countdowns on learning screens.
- The fail debrief is private and face-saving (CONTENT_STYLE §5.12).
- One primary action per screen.
- The plan card shows "max RTO visits", to remove uncertainty.

### 5.9 Under-18 users (P-07, EC-05)
These are accessibility features without AI: read-aloud uses the browser's on-device TTS (not Gemini), and the rules-only plan card and static lessons are fully accessible. No telemetry is collected (D-13).

---

## 6. Photosensitivity: WCAG 2.3.1 procedure
1. **Design limits:**
   - no UI element flashes;
   - no more than 3 flashes in any 1-second period anywhere;
   - no saturated-red transitions over a large area;
   - Rive and Lottie assets keep frame-to-frame luminance change < 10% of the frame area.
2. **Nazar clip pipeline gate** (a step in the Render Workflow clip pipeline, before `publish`; D-15):
   - compute per-frame relative luminance on a 1/10-viewport grid;
   - count general flashes (pairs of opposing ≥ 10% luminance changes where the darker frame is < 0.80) and red flashes per 1-second window;
   - **fail** if any window has > 3;
   - failing clips are rejected or have the segment cut. The check result is stored on the `Clip` (E-20).

   Reference tools for spot checks: PEAT (Photosensitive Epilepsy Analysis Tool, Trace Center) [availability unverified; owner: AI/media lead, 2026-10-25]. The in-house check follows the WCAG 2.3.1 definitions (https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html).
3. **Real-world flashes in footage** (hazard lights, headlight glare at night) are the most likely failure. Night clips get a stricter human review and an optional "reduced glare" filter.
4. **Settings:** reduced motion also dims bright transitions; the Night & Glare game offers a safe-luminance option.
5. **Warning:** the Nazar intro says "Short road videos. No flashing lights; tell us if anything bothers you." There is a report link per clip.

---

## 7. Language accessibility (summary; detail in LOCALIZATION.md)
- `lang` set correctly at page and part level (3.1.1/3.1.2).
- Script-specific line heights so matras and Nastaliq are not clipped.
- RTL readiness for Urdu/Kashmiri (rule-pack-ready, not shipped).
- No letter-spacing or uppercase on Indic scripts.
- Devanagari digit input accepted everywhere a number is typed; normalised before validation.

---

## 8. Edge cases with accessibility impact
| EC | Accessibility response |
|---|---|
| EC-11 Sarathi outage | Status banner announced politely; drafts saved; no data loss |
| EC-13 Disability, adapted vehicles, deaf, colour vision | §5.4, §5.5; adapted-vehicle class shown in the planner with "verify at your RTO" |
| EC-14 Shared phone / cyber café | Helper banner; auto-logout warning with extend (2.2.1); "clear this device" announced |
| EC-18 Games: buffering, spam taps, screen readers, photosensitivity | Preload; spam-tap void notice in text; SR alternative; §6 |
| EC-19 Low-end phone on 2G | §5.7 |
| EC-20 Aadhaar/OTP typed into AI | The redaction notice is spoken and shown; nothing is sent |
| EC-29 AI unavailable | Template fallback; read-aloud still works offline |

---

## 9. Test plan

### 9.1 Automated (every PR, GitHub Actions)
| Check | Tool | Gate |
|---|---|---|
| Token contrast | `python -I scripts/check_contrast.py` | Any unexpected FAIL / UNEXPECTED PASS |
| Component a11y | Storybook 8 + `@storybook/addon-a11y` (axe) on every story and state | 0 violations at serious/critical |
| Route a11y | `@axe-core/playwright` on 25 key routes × locales `en`, `hi` × themes light, dark, high contrast | 0 serious/critical; WCAG tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` |
| Lint | `eslint-plugin-jsx-a11y` (recommended + strict on `packages/ui`) | 0 errors |
| Lighthouse | Lighthouse CI, mobile emulation, Slow 4G throttling | Accessibility ≥ 97 (the Lexington themes' bar), Performance ≥ 80 in Lite |
| Reflow | Playwright at 320 × 640 | No horizontal scroll (`scrollWidth ≤ clientWidth`) |
| Zoom | Playwright with `deviceScaleFactor` and CSS `zoom: 2` | No clipped text (overflow check on text nodes) |
| Keyboard paths | Playwright keyboard-only scripts for the 3 deep slices | Completes without pointer |
| Target size | Playwright: every `button, a, [role=button], input` bounding box ≥ 48 × 48 | 0 failures (exceptions list reviewed) |
| HTML validity | `html-validate` | 0 errors |
| Flash check | Clip pipeline step (§6) | Clip not published |

Example Playwright + axe test (lives in `tests/a11y/`, allowed as test config):
```ts
// tests/a11y/routes.spec.ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = ["/en", "/hi", "/en/plan", "/hi/plan", "/en/apply/dob", "/en/apply/check-answers",
  "/en/learn", "/en/nazar", "/en/nazar/debrief/demo", "/en/help"];
const themes = ["light", "dark"] as const;

for (const route of routes) for (const theme of themes) {
  test(`axe: ${route} [${theme}]`, async ({ page }) => {
    await page.addInitScript(t => document.documentElement.dataset.theme = t, theme);
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .exclude("[data-test-exclude-axe]")   // only third-party embeds, each listed in KNOWN_ISSUES.md
      .analyze();
    const serious = results.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""));
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}

test("targets are at least 48x48", async ({ page }) => {
  await page.goto("/en/plan");
  const small = await page.$$eval("button, a[href], [role=button], input:not([type=hidden])", els =>
    els.map(e => ({ t: e.textContent?.trim(), r: e.getBoundingClientRect() }))
       .filter(x => x.r.width > 0 && (x.r.width < 48 || x.r.height < 48)));
  expect(small).toEqual([]);
});
```

### 9.2 Manual: keyboard (per release, 3 deep slices + home)
Tab order, visible focus, no traps, Esc closes overlays, Enter/Space activate, arrow keys in radio groups/tabs/toolbars, the skip link works, focus returns after a modal, and focus is not obscured by the orb (2.4.11).

### 9.3 Manual: visual
- 200% text (Android Largest + Chrome zoom).
- 400% zoom on desktop.
- High contrast, Sunlight, dark and Windows forced colours.
- Text-spacing bookmarklet.
- Pseudo-locale +40%.
- Urdu RTL Storybook pass.

### 9.4 Manual: screen-reader scripts (TalkBack P1, NVDA P2, VoiceOver P2)
| Script | Steps | Pass when |
|---|---|---|
| SR-01 Plan in 3 taps | Language → age → vehicle picture → state → plan card | Every control announced with name/role/state; the fee table is read with caption and totals; the source chip is read with date |
| SR-02 Guided LL application | DOB → address → photo fixer (upload path) → check answers → hand-off | Errors announced; Change links have context; Simulated chip read |
| SR-03 Nazar alternative | Nazar → SR alternative mode → 3 still frames → debrief | Mode labelled "different skill"; descriptions read; no score comparison |
| SR-04 Voice guide | Open orb → speak → transcript → answer with source chip | Transcript announced without repetition; Stop reachable |
| SR-05 Helper mode | Start help → consent → end help → clear device | Consent text read in full; "Device cleared" announced |
| SR-06 Payment pending | Simulated pending → refresh | Status change announced politely; "Don't pay again" read |

### 9.5 User testing (field-study integration, D-22)
- Hackathon: the 5–8 person journey test includes at least 1 participant aged 50+ with low digital confidence (P-03 profile), and, if one consents, a screen-reader user. Record SUS and task completion, and note accessibility issues separately.
- Production: users with disabilities (blind, low-vision, deaf, motor, cognitive) in UAT for every major feature; at least 5 per release cycle; paid at fair rates; consent via the F-57 module.

### 9.6 UX4G Audit 360 and pre-audit (production path)
1. Onboard at https://audit360.ux4g.gov.in/onboarding with the staging URL [onboarding eligibility for a private entity: unverified; owner: Product lead, 2026-10-26].
2. Run the **UX Self Health Check** and export the result.
3. Fix all Audit 360 findings at severity high or above.
4. Attach to the STQC/CERT-In-empanelled audit pack: axe reports, Lighthouse, manual SR results, accessibility statement, ACR (IS 17802).
5. Re-run after each major release.

### 9.7 Defect severity
| Severity | Definition | Fix SLA |
|---|---|---|
| S1 Blocker | A user group cannot complete a core task (plan, apply, Nazar alt, consent) | Before release / within 24 h in production |
| S2 Major | Completes with significant difficulty or misinformation (e.g. a fee read wrongly) | 5 working days |
| S3 Minor | Annoyance, workaround exists | Next sprint |
| S4 Cosmetic | — | Backlog |

---

## 10. Accessibility statement (template, EN; Hindi version reviewed per LOCALIZATION §11)
> **Accessibility of Margdarshak.** Margdarshak is an independent prototype by team Chanakya, not affiliated with MoRTH, NIC or any State Transport Department. We design and test it to WCAG 2.1 Level AA and the Guidelines for Indian Government Websites (GIGW 3.0).
> **What you can do:** use it with TalkBack, VoiceOver or NVDA; zoom to 400%; turn on High contrast, Sunlight or Lite mode; play every game without sound; use the voice guide (18+) or type instead.
> **Known issues on {date}:** {list from KNOWN_ISSUES.md, e.g. "The Junction Scan game uses a canvas; screen-reader users get a step-by-step quiz instead."}
> **Tell us:** {feedback link} · {grievance officer contact}. We reply within 5 working days.
> **Last tested:** {date}, with {tools}. **Last updated:** {date}.

---

## 11. Open items and unverified
| Item | Owner | Due |
|---|---|---|
| RPwD Act 2016 section numbers and text | Accessibility lead | 2026-10-26 |
| IS 17802 Part 1 clause structure vs EN 301 549 | Accessibility lead | 2026-10-26 |
| GIGW 3.0 primary text (accessibility chapter, 5.3.1) | Accessibility lead | 2026-10-25 (D-25) |
| MoRTH deaf-applicant advisory text for the rights card | Content lead | 2026-10-25 |
| TalkBack behaviour for `lang="doi"` | QA lead | H0 |
| Audit 360 eligibility for private entities | Product lead | 2026-10-26 |
| PEAT availability | AI/media lead | 2026-10-25 |
| Test device models | QA lead | H0 |

## Sources
- WCAG 2.1: https://www.w3.org/TR/WCAG21/ · WCAG 2.2: https://www.w3.org/TR/WCAG22/ · 2.3.1 understanding: https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html
- RPwD Amendment Rules 2023 (IS 17802): https://www.voiceofsap.org/wp-content/uploads/2023/05/RPWD-Amendment-Rules-2023-ICT-Products-and-Services.pdf · https://scconline.com/blog/?p=291941
- Draft RPwD Amendment Rules 2026: https://www.indialaw.in/blog/regulatory/rpwd-amendment-rules-2026/ · https://www.mondaq.com/india/compliance/1824050/the-new-accessibility-conformance-regime-key-takeaways-from-the-draft-rpwd-amendment-rules-2026
- GIGW 3.0: https://guidelines.india.gov.in/ · GuDApps: https://guidelines.india.gov.in/about-gudapps/ · secondary: https://www.tcsa.in/learn/gigw-compliance-before-go-live
- UX4G: https://www.ux4g.gov.in/foundations/accessibility · Audit 360: https://audit360.ux4g.gov.in/onboarding
- *Pragya Prasun* (SC, digital KYC accessibility): https://indiankanoon.org/doc/68332080/ (via `research/domains/ps3-standard-banking.md`)
- Research: `team-saarthi-report.md` l.71, l.277; `ps1-current-state/01-sarathi-screens.md` l.290; `00-JOURNEY-MAP.md` row 3; `08-game-ai-n8n.md` §1, a11y lines 172–380; `verification.md` §3.2–3.3
