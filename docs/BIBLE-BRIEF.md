# Brief for every bible-writing agent: Margdarshak
**Project root:** `G:\HACKATHON_PROJECTS\HACKCACHE26\margdarshak\` (write ONLY under this root; never write to C:).

**Read first, in order:**
1. `docs\00-overview\PROJECT_BRIEF.md`: the single source of truth for IDs F-xx, E-xx, API-xx, M-xx, EC-xx, R-xx, P-xx, D-xx and the stack.
2. `C:\Users\satav\.claude\skills\bible\references\doc-catalog.md`: the required sections and header block for each doc.
3. `G:\HACKATHON_PROJECTS\HACKCACHE26\war-room\margdarshak-verification.md`: the council's 25 directives (D-01..D-25), which every doc must obey.

**Research to read** (all under `G:\HACKATHON_PROJECTS\HACKCACHE26\research\`; read what your group needs):
- `ps1-deep\REFINED-OVERVIEW.md` (the flow)
- `ps1-deep\team-saarthi-report.md` (homepage teardown, e-Visa lessons, benchmarks; replace "Saarthi" with "Margdarshak", fix fee to ₹700 for one class + ₹200 card)
- `ps1-deep\01-abroad.md`, `02-accident-curriculum.md`, `03-lifecycle.md`, `04-ai-adk-gemini.md`, `05-psychology.md`, `06-design-language.md`, `07-govt-plug-and-play.md`, `08-game-ai-n8n.md`, `00-ps1-checklist.md`
- `ps1-current-state\00-JOURNEY-MAP.md`, `01-sarathi-screens.md`, `02-rules-process.md`, `03-user-pain.md`
- `C-judges.md`, `B-sponsors.md`, `E-competition.md`, `G-inspiration-library.md`
- `G:\HACKATHON_PROJECTS\HACKCACHE26\field-kit\NAZAR-FIELD-KIT.md`

**Standard:** this is a professional startup's product bible, not a student prototype.
- Be extremely detailed and concrete: real library names and pinned versions, real government APIs with links, ₹ numbers, measurable targets, Mermaid diagrams, tables.
- Keep "Hackathon build (Phase 1–2)" and "Production (Phase 3+)" clearly separated.
- Use the IDs from PROJECT_BRIEF exactly.
- Handle edge cases EC-01..EC-30 wherever relevant.

**Facts:**
- Never invent laws, APIs, prices or quotes.
- Reuse the sources already in the research files, with their URLs.
- If you must check something new, the web search budget is scarce: max 6 WebSearch per agent (load via ToolSearch "select:WebSearch,WebFetch"); prefer WebFetch of known URLs.
- Mark anything not verified as [unverified] with an owner and date.

**Wording bans (D-19):** "first" (as in first-ever), "official", "DPDP-compliant", "integrated with Sarathi", "lives saved", "Saarthi".

**Fees:** ₹700 for ONE class (LL ₹150 + LL test ₹50 + DL test ₹300 + DL ₹200) + ₹200 smart card; a second class adds about ₹450 (from `fees.json`, CMVR r.32).

**Do not:**
- start implementing application code (config files, schemas, OpenAPI, prompts, eval datasets and workflow YAML are allowed where the doc catalog calls for them)
- change PROJECT_BRIEF.md (report inconsistencies instead)

**Return:** the list of files written + inconsistencies found + items marked unverified.
