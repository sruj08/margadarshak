# Margdarshak docs

> Where to find anything. The front door is the [project README](../README.md); every ID and decision lives in [PROJECT_BRIEF](00-overview/PROJECT_BRIEF.md).

## Folders

| Folder | What is inside |
|---|---|
| [`00-overview/`](00-overview) | PROJECT_BRIEF (single source of truth for every ID) · VISION · PITCH · DEMO_SCRIPT |
| [`01-product/`](01-product) | PRD · PERSONAS · USER_JOURNEYS · USER_STORIES · FEATURES (PS1 checklist) · ROADMAP · METRICS · COMPETITIVE_ANALYSIS |
| [`02-design/`](02-design) | DESIGN_SYSTEM · UI_SPEC (journey + learn/games) · ACCESSIBILITY · LOCALIZATION · CONTENT_STYLE |
| [`03-engineering/`](03-engineering) | ARCHITECTURE · TECH_STACK · DATA_MODEL · API_SPEC · INTEGRATIONS · FRONTEND · BACKEND · TESTING · PERFORMANCE · ENVIRONMENT_SETUP · `adr/` |
| [`04-ai/`](04-ai) | MODELS · AGENTS · VOICE · PROMPTS · AI_EVALS · RESPONSIBLE_AI · DATA_PIPELINE |
| [`05-ops/`](05-ops) | CICD · INFRASTRUCTURE · DEPLOYMENT · OBSERVABILITY · RUNBOOK · COST · N8N_WORKFLOWS |
| [`06-security-compliance/`](06-security-compliance) | SECURITY_ARCHITECTURE · PRIVACY · COMPLIANCE · LEGAL_MEMOS · EDGE_CASES · RISK_REGISTER · STQC_PREAUDIT_PACK |
| [`07-business/`](07-business) | BUSINESS_MODEL · GTM · FINANCIALS · IMPACT |
| [`08-project/`](08-project) | IMPLEMENTATION_PLAN · BACKLOG · BUILD_CONVENTIONS · TEAM · GLOSSARY · FIELD_STUDY · WHATS_LEFT · HYPOTHESES.draft |
| [`09-learning-games/`](09-learning-games) | CURRICULUM · GAME_DESIGN · GAME_SDK · GAMIFICATION_ENGINE · NAZAR · DEBRIEF_SPEC · VIDEO_GENERATION_GUIDE |
| [`10-government/`](10-government) | GOVERNMENT_ADOPTION · PALANTIR_METHOD |
| [`assets/`](assets) | README screenshots |

## Where do I find…?

| Question | Document |
|---|---|
| Every ID, decision and resolved conflict | [PROJECT_BRIEF](00-overview/PROJECT_BRIEF.md) (§15) |
| Does it tick every PS1 box? | [FEATURES §4](01-product/FEATURES.md) |
| What exactly does each feature do? | [PRD](01-product/PRD.md) · [FEATURES](01-product/FEATURES.md) |
| Who are the users? | [PERSONAS](01-product/PERSONAS.md) · [USER_JOURNEYS](01-product/USER_JOURNEYS.md) |
| What does each screen look like? | [UI_SPEC](02-design/UI_SPEC.md) |
| Colours, fonts, motion, components | [DESIGN_SYSTEM](02-design/DESIGN_SYSTEM.md) · `packages/ui/tokens.css` |
| What we say on screen (and never say) | [CONTENT_STYLE](02-design/CONTENT_STYLE.md) |
| How the games work and are scored | [GAME_DESIGN](09-learning-games/GAME_DESIGN.md) · [GAME_SDK](09-learning-games/GAME_SDK.md) · [NAZAR](09-learning-games/NAZAR.md) |
| What we teach, and why | [CURRICULUM](09-learning-games/CURRICULUM.md) |
| How the AI explains without making things up | [DEBRIEF_SPEC](09-learning-games/DEBRIEF_SPEC.md) · [AGENTS](04-ai/AGENTS.md) · [PROMPTS](04-ai/PROMPTS.md) · [RESPONSIBLE_AI](04-ai/RESPONSIBLE_AI.md) |
| The voice guide | [VOICE](04-ai/VOICE.md) |
| Architecture and government adapters | [ARCHITECTURE](03-engineering/ARCHITECTURE.md) · [INTEGRATIONS](03-engineering/INTEGRATIONS.md) |
| Database schema | [DATA_MODEL](03-engineering/DATA_MODEL.md) |
| Endpoints | [API_SPEC](03-engineering/API_SPEC.md) · [`api/openapi.yaml`](../api/openapi.yaml) |
| Set up and run it | [ENVIRONMENT_SETUP](03-engineering/ENVIRONMENT_SETUP.md) |
| Testing | [TESTING](03-engineering/TESTING.md) · [AI_EVALS](04-ai/AI_EVALS.md) |
| Deploying and cost | [DEPLOYMENT](05-ops/DEPLOYMENT.md) · [COST](05-ops/COST.md) · [RUNBOOK](05-ops/RUNBOOK.md) |
| n8n workflows | [N8N_WORKFLOWS](05-ops/N8N_WORKFLOWS.md) · [`n8n/`](../n8n) |
| Aadhaar, DPDP, minors, legal | [COMPLIANCE](06-security-compliance/COMPLIANCE.md) · [LEGAL_MEMOS](06-security-compliance/LEGAL_MEMOS.md) · [PRIVACY](06-security-compliance/PRIVACY.md) |
| Edge cases EC-01..EC-30 | [EDGE_CASES](06-security-compliance/EDGE_CASES.md) |
| How a state adopts it | [GOVERNMENT_ADOPTION](10-government/GOVERNMENT_ADOPTION.md) · [STQC_PREAUDIT_PACK](06-security-compliance/STQC_PREAUDIT_PACK.md) |
| Business model and growth | [BUSINESS_MODEL](07-business/BUSINESS_MODEL.md) · [GTM](07-business/GTM.md) · [IMPACT](07-business/IMPACT.md) |
| Build order and open items | [IMPLEMENTATION_PLAN](08-project/IMPLEMENTATION_PLAN.md) · [BACKLOG](08-project/BACKLOG.md) · [WHATS_LEFT](08-project/WHATS_LEFT.md) |
| Terms like MCWOG, Form 1A, PSGA | [GLOSSARY](08-project/GLOSSARY.md) |
