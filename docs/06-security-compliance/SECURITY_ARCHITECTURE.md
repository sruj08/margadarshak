# Security Architecture
> Project: Margdarshak · Owner: Security lead (SEC) · Status: Draft v0.1 · Last updated: 2026-10-23
> Related: [PROJECT_BRIEF](../00-overview/PROJECT_BRIEF.md) · [THREAT_MODEL](THREAT_MODEL.md) · [PRIVACY](PRIVACY.md) · [COMPLIANCE](COMPLIANCE.md) · [EDGE_CASES](EDGE_CASES.md) · [RISK_REGISTER](RISK_REGISTER.md) · [STQC_PREAUDIT_PACK](STQC_PREAUDIT_PACK.md) · [LEGAL_MEMOS](LEGAL_MEMOS.md) · Architecture: `../03-engineering/ARCHITECTURE.md` · API: `../03-engineering/api/openapi.yaml`

**Scope.** Every security control for the citizen PWA, the FastAPI backend, the score verifier, the ADK agents (M-01..M-09), Render Workflows jobs, n8n, the ecosystem consoles (F-40, F-41, F-42, API-55) and the government adapter layer (F-56).

**Two columns everywhere.** *Hackathon build (Phase 1–2)* is what ships on Render Singapore with **synthetic data only** (plus consented 18+ field-study participants on the Gemini paid tier). *Production (Phase 3+)* is what a State Transport Department (STD) or NIC would host on MeghRaj / a MeitY-empanelled Indian cloud (D-17).

**Claim discipline (D-19).** We say "built to OWASP ASVS L2", "audit-ready", "built to DPDP Rules". We never say "STQC-certified", "DPDP-compliant", "official" or "integrated with Sarathi".

**Owner key used in all security docs**

| Code | Role |
|---|---|
| SEC | Security lead (also the CERT-In point of contact after launch) |
| BE | Backend lead (FastAPI, Postgres, adapters) |
| FE | Frontend lead (PWA, game layer) |
| AI | AI lead (ADK agents, evals, provenance guard) |
| OPS | DevOps lead (Render, CI/CD, observability) |
| CL | Content and clip lead (Nazar clip bank, rule-pack content) |
| PL | Product lead (owns copy, wording bans, consent text) |
| LC | Legal and compliance owner (PL acts until Nestiq counsel is engaged) |
| GO | Grievance Officer (a named Nestiq Pvt Ltd director; also the DPDP Rule 9 contact) |

---

## 1. Security principles (what every control below serves)
1. **Collect the minimum.** We never collect an Aadhaar number, VID, OTP, biometrics, captcha or a face for matching (D-07). We never store document images (E-06 holds only the check result). The LL and DL numbers are never stored in clear (E-04, E-05).
2. **Government steps stay on government systems.** eKYC, OTP, payment and submission happen on Sarathi or the state gateway (F-07). Margdarshak never holds credentials for Sarathi or DigiLocker on the user's behalf. No scraping and no booking bots (D-08; IT Act s.43).
3. **Code owns every number.** Eligibility, fees, timelines, scores and scam verdicts are deterministic (D-09). Gemini only narrates IDs from allowlists, so a prompt injection can at worst change wording, never a fee or a score.
4. **Minors are protected, not excluded.** A learner under 18 gets the full product, including every AI feature, inside a parent's adult account (family mode) with the parent's verifiable consent (D-13 revised, P-07). A child's data is never used for behavioural tracking, profiling or targeted ads (DPDP s.9(3)); squads and share cards for a minor's profile need the parent's consent.
5. **Tenants are states.** Data, keys and rule packs are isolated per tenant (E-31, F-58).
6. **Assume breach.** Field-level encryption for contact data (E-14), pseudonymous IDs elsewhere, an append-only audit log (E-30), and a 6-hour CERT-In clock in the runbook.
7. **Portable controls.** Every control works the same on Render and on MeghRaj/NIC: containers, Postgres 16, Redis, S3-compatible storage, OpenTelemetry. No control depends on a Render-only feature.

---

## 2. System context and trust zones

```mermaid
flowchart LR
  subgraph Z0["Zone 0: user device (untrusted)"]
    PWA["Next.js 16 PWA<br/>(Serwist SW, game-core, MediaPipe on-device)"]
  end
  subgraph Z1["Zone 1: edge (Render / prod: WAF + LB in India)"]
    EDGE["TLS 1.3 termination · WAF rules · rate limiter"]
  end
  subgraph Z2["Zone 2: application (private network)"]
    API["FastAPI core<br/>(rules, cases, consent, auth)"]
    ADK["ADK agents M-01..M-07<br/>+ PII plugin + provenance guard"]
    SV["Score verifier (Node, game-core)"]
    WF["Render Workflows<br/>(clip pipeline, clock sweep, stats, debrief fan-out)"]
  end
  subgraph Z3["Zone 3: data (no public ingress)"]
    PG[("PostgreSQL 16<br/>RLS per tenant")]
    RD[("Redis / Key Value<br/>sessions, rate limits")]
    R2[("Object store<br/>blurred clips only")]
  end
  subgraph Z4["Zone 4: third-party processors"]
    GEM["Gemini API (paid tier)"]
    SAR["Sarvam Saaras (Dogri ASR)"]
    N8N["n8n Pro (staff operations; no citizen data)"]
    WA["Meta WhatsApp Cloud API"]
    MAIL["Email provider"]
    SEN["Sentry (scrubbed)"]
  end
  subgraph Z5["Zone 5: government systems (mock in Phase 1–2)"]
    GOV["Sarathi · DigiLocker · Bhashini · PayGov/state gateway"]
  end
  PWA -->|HTTPS + WSS| EDGE --> API
  API --> ADK --> GEM
  ADK --> SAR
  API --> SV
  API --> PG & RD
  WF --> PG & R2 & GEM
  N8N -->|HMAC webhook API-66 / API-65| API
  API -->|signed staff tasks and alerts| N8N
  API -->|notifier: citizen templates| WA & MAIL
  WA -->|signed receipts, STOP API-66| API
  API -->|adapter port F-56| GOV
  PWA -. "deep link (Mode A hand-off, F-07)" .-> GOV
```

The full DFD with every flow numbered and the STRIDE table per component is in [THREAT_MODEL.md](THREAT_MODEL.md).

---

## 3. Authentication per actor

### 3.1 Actor matrix

| Actor | Persona | Phase 1–2 (hackathon) | Phase 3+ (production) | Session lifetime | Step-up / MFA |
|---|---|---|---|---|---|
| **Anonymous visitor** | P-01/P-02 before sign-up, P-07 (minor, before the parent signs in) | No login. API-01 plan, API-02/03 rules work with a rate-limited anonymous **device session** (opaque 256-bit ID in an `__Host-mg_dev` cookie, HttpOnly, Secure, SameSite=Lax) | Same | 30 days rolling; no personal data attached | None |
| **Registered citizen (18+)** | P-01, P-02, P-03 | Email magic link (one-time token, 10 min, single use, bound to the requesting device session) **or** Google Sign-In (OIDC, `authlib`, PKCE S256, `nonce`, `aud` + `iss` checks) | Add **DigiLocker OAuth 2.0 + PKCE** (requester spec v1.12, `07-govt-plug-and-play.md` §A2) or **Jan Parichay** through the tenant's identity adapter. Mobile OTP only through a DLT-registered sender (D-16) | Access: opaque session ID, 12 h idle / 30 days absolute; rotated on every privilege change | Re-auth (fresh magic link) before export (API-61), delete (API-62), adding a helper (API F-17), or changing the contact (E-14) |
| **Minor (16–17), family mode** | P-07 | **No separate account.** The learner's case is a family member's profile inside the parent's (adult) account, on the parent's phone, with the full product including AI. The parent signs in (same methods as a registered citizen) and gives the consents, recorded with `acting_for` = parent | Parent verified as an identifiable adult per DPDP Rule 10 (DigiLocker or details already held); same full product | Parent's session | Parent's step-up rules apply |
| **Helper** | P-04 (sibling, CSC/cyber-café operator) | A helper acts **inside the applicant's case** through a HelperLink (E-29). The applicant creates the link from their own session; the helper signs in with their own magic link. Consent artefact (E-15) records purpose, scope (`case:read`, `case:edit_draft`), expiry (default 7 days) and is revocable | Same + CSC operator ID attribute when a CSC adapter exists. Helper sessions on shared devices default to "public computer" mode: 15 min idle timeout, no "remember me", "clear this device" button (EC-14) | 15 min idle on shared-device mode, 2 h otherwise | The applicant confirms each sensitive action (send letter, add class) by a link sent to **their** contact, never the helper's |
| **Driving-school staff** | P-05 | Email magic link + **TOTP** (`pyotp`, RFC 6238), roles `school_owner`, `school_instructor` | OIDC with the tenant IdP or Google Workspace + **WebAuthn** passkey (`py_webauthn`) | 8 h | MFA at every login |
| **RTO officer / state console viewer** | P-06 | Demo accounts only (synthetic data), WebAuthn passkey | **Jan Parichay / state SSO** via an `IdentityPort` adapter (Parichay integration **[unverified]**, owner BE, check with NIC by 2026-12-15); MFA enforced by the IdP; IP allowlist for the state network | 8 h, 30 min idle | Step-up for exports |
| **Rule-pack maker / checker** (F-42, API-54) | STD rules cell | Two separate demo accounts; passkey | State SSO + passkey; **maker ≠ checker** enforced in code and in DB constraint (`approved_by <> authored_by`) | 4 h | Step-up on publish |
| **Clip rater / clip admin** (API-55, M-06) | CL team | Passkey; role `clip_rater` (sees blurred media only), `clip_publisher` | Same | 8 h | Step-up on publish |
| **Platform admin / on-call** | OPS, SEC | Passkey (hardware key preferred); just-in-time elevation logged to E-30; no standing DB superuser | Same + bastion with session recording; break-glass account sealed, two-person rule | 1 h | Every elevation |
| **n8n → API** | machine | `POST /internal/webhooks/n8n` (API-66, staff events) and `/internal/clock/sweep` (API-65): HMAC-SHA256 over `timestamp + body` with a 5-min replay window and a nonce cache in Redis; internal paths not routed from the public edge except n8n's egress IPs | Same + mTLS where the host supports it | per request | n/a |
| **Meta / email provider → API** | machine | citizen delivery receipts, replies and STOP on API-66: provider signature (Meta `X-Hub-Signature-256`) + nonce replay cache + `deliveryId` unique (BACKEND §12) | Same | per request | n/a |
| **Render Workflows → API / DB** | machine | Short-lived service token (`aud=workflows`), least-privilege DB role `wf_role` | Workload identity of the host (K8s service account) | 15 min | n/a |
| **Score verifier** | machine | Private service, no public route; called only by API with a service token | Same | per request | n/a |
| **Government adapter (real mode)** | machine | Not used (mocks only) | Credentials from the STD/NIC (DigiLocker client ID, Sarathi API key if granted) in the tenant's KMS; mTLS where offered | per adapter | n/a |

### 3.2 Login hardening (all human actors)
- **Magic links:** 32-byte random token, stored as SHA-256 hash, TTL 10 min, single use, invalidated on use or on a newer request; the link lands on a confirm page (no auto-login on GET, so mail scanners can't consume it). Rate limit: 3 per address per 15 min, 10 per IP per hour.
- **Google OIDC:** `authlib` (pin 1.x at H0), PKCE S256, `state` + `nonce`, strict redirect URI, reject unverified emails.
- **Account enumeration:** identical responses and timing for known and unknown emails.
- **Credential stuffing:** no passwords exist in Phase 1–2, which removes the main ATO vector. If passwords are ever added: Argon2id (`argon2-cffi`, m=64 MiB, t=3, p=1), HIBP k-anonymity check, ASVS V2.1.
- **Session tokens:** opaque, stored in Redis with tenant ID, actor ID, role set, device fingerprint hash (UA family + coarse IP /24, for anomaly scoring only), created/last-seen. Never JWT in browser storage.
- **Cookies:** `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` (Strict for consoles), no `Domain` attribute.
- **CSRF:** SameSite plus a double-submit token on all state-changing requests from the PWA; consoles use `SameSite=Strict` plus the token.
- **Logout everywhere:** API to revoke all sessions for an actor; triggered automatically on account deletion (API-62), contact change and helper revocation (EC-25).

### 3.3 Family mode and consent (D-13 revised) as a security control
- The DOB entered in F-02 / F-05 produces `age_band ∈ {under_16, 16_17, 18_25, 26_40, 41_60, 60_plus}` computed **server-side** with the server clock (EC-15). If the DOB came from an Aadhaar with year only (EC-01), the band uses the conservative assumption (31 Dec of that year), so a borderline user is treated as younger. The band drives licence eligibility and family mode, not access to features.
- AI endpoints (API-40..API-43, API-36 narration) serve every user. The policy layer checks that the session belongs to an adult account holder **and** that `PUR-AI-FEATURES` consent is granted for the case (for a family member's case, the parent's artefact with `acting_for` = parent) before any call to Gemini or Sarvam, and checks again just before the model call (defence in depth).
- A minor profile (`flags.minor`) is excluded from behavioural analytics, profiling and any ad path (DPDP s.9(3)); squad join and share cards for it require the parent's consent.
- A user who changes DOB from <18 to ≥18 must re-confirm the DOB on a declaration screen; changes are rate-limited (1 per 30 days) and logged to E-30. Field-study participants confirm 18+ on the consent form.
- Residual risk: a minor can lie about DOB to open their own account instead of family mode. Mitigation is the declaration and the fact that family mode offers the same full product, so there is no reward for lying. Provider terms on minors: see R-13.

---

## 4. Authorisation

### 4.1 Model
- **RBAC** for roles: `citizen`, `helper`, `school_owner`, `school_instructor`, `rto_viewer`, `state_analyst`, `rule_maker`, `rule_checker`, `clip_rater`, `clip_publisher`, `platform_admin`.
- **ABAC** on every object: `tenant_id`, `owner_applicant_id`, `helper_link.scope`, `case.stage`, `age_band`.
- Enforcement points: (1) FastAPI dependency `authorize(action, resource)` using a single policy module (`policy.py`, table-driven, unit-tested per row); (2) **PostgreSQL Row-Level Security** as the backstop (§5); (3) object IDs are UUIDv7 (not guessable sequence numbers), but authorisation never relies on that.

### 4.2 Permission table (excerpt; full table in `backend/app/policy/policy_table.yaml`)

| Action | citizen (owner) | helper (linked) | school_owner | rto_viewer / state_analyst | rule_maker | rule_checker | clip_publisher | platform_admin |
|---|---|---|---|---|---|---|---|---|
| Read own case (API-11) | ✓ | ✓ if scope `case:read` and not expired | ✗ | ✗ (aggregates only) | ✗ | ✗ | ✗ | break-glass only, logged |
| Autosave case (API-12) | ✓ | ✓ if `case:edit_draft` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Delete case / account (API-17, API-62) | ✓ (step-up) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Generate letter (API-45) | ✓ | draft only; applicant must approve | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| See learner progress (API-52) | — | — | ✓ only for learners who granted a `school_share` consent artefact | ✗ | ✗ | ✗ | ✗ | ✗ |
| State console views (API-53) | ✗ | ✗ | ✗ | ✓ k-anonymised aggregates (k ≥ 10 for console, k ≥ 5 for public Live Intel) | ✗ | ✗ | ✗ | ✗ |
| Draft rule pack (API-54) | ✗ | ✗ | ✗ | ✗ | ✓ own tenant | ✗ | ✗ | ✗ |
| Approve/publish rule pack | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ own tenant, not own draft | ✗ | ✗ |
| Publish clip (API-55) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ after 2 rater windows + 100% blur audit | ✗ |
| Read audit log (E-30) | own entries (via export) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ read-only |

### 4.3 Business-logic authorisation rules (ASVS V11)
- A case stage can only move along the journey state machine (F-08) edges; illegal transitions return 409.
- `POST /v1/cases/{id}/events` (API-15) accepts only user-asserted facts, labelled `source=user`; adapter facts are `source=adapter:<name>`. User facts can never overwrite adapter facts.
- A helper can never: change contact details, add another helper, export, delete, approve a letter, or see consent history.
- Live Intel reports (API-28): one report per account per office per 7 days; account must be ≥ 7 days old **or** have a case at that office; reports never shown until k ≥ 5 (D-14).
- Game scores from the client are **never** trusted; the verifier overwrites them (§11).

---

## 5. Tenancy isolation (E-31, F-58)

| Layer | Phase 1–2 | Phase 3+ |
|---|---|---|
| Identity of tenant | `tenant_id` resolved from host (`jk.margdarshak.app`-style subdomain; domain contains no "gov", "parivahan" or "sarathi", D-01/G10) or from case | Same; a state may require its own domain (e.g. a subdomain the STD controls) |
| Data | Shared schema, `tenant_id NOT NULL` on every tenant table, **RLS** policies `USING (tenant_id = current_setting('app.tenant_id')::uuid)`, `FORCE ROW LEVEL SECURITY` so even the table owner obeys; the API sets `SET LOCAL app.tenant_id` per transaction from the authenticated context; the app DB role is **not** `BYPASSRLS` | Option A (default): same + per-tenant DEK. Option B: schema-per-tenant. Option C: separate deployment in the state's own cloud account (`07-govt-plug-and-play.md` §B3) |
| Keys | One KEK, per-tenant DEK for E-14 | Per-tenant KEK in the tenant's KMS/HSM; the state can revoke (crypto-shred) |
| Rule packs | Per-tenant, signed (Ed25519) by the checker's key; the engine refuses an unsigned or tampered pack | Signed by the STD's key |
| Object storage | One bucket, prefix per tenant; clips are tenant-agnostic (CC-BY bank) | Bucket per tenant for any tenant-specific media |
| Caches | Redis keys prefixed `t:{tenant}:`; no cross-tenant cache keys | Separate Redis DB/instance per tenant on request |
| Analytics | Aggregates computed per tenant; cross-tenant benchmarks only above k ≥ 10 per cell | Same, with state consent |
| Tests | Contract test `test_rls_isolation.py`: user of tenant A cannot read/update/delete any row of tenant B across all 31 entities; runs in CI on every PR | Same + annual pen-test case |

---

## 6. Encryption

### 6.1 In transit
- TLS 1.3 preferred, TLS 1.2 minimum with AEAD suites only; HSTS `max-age=63072000; includeSubDomains; preload` after domain stabilises; OCSP stapling where the host supports it.
- WebSocket for voice (API-40) is WSS only; origin check; per-connection auth token (short-lived, 60 s to open).
- Internal service calls: TLS on the private network in production; on Render, private network services (no public URL) for the verifier and Redis.
- Gemini and Sarvam calls over TLS from the server only. **Client-side Gemini Live connections (if ever used) must use ephemeral tokens, never API keys** (`04-ai-adk-gemini.md` §1.5). Phase 1–2: voice is proxied through the backend, so the key never reaches the browser.

### 6.2 At rest

| Data | Control |
|---|---|
| Postgres volumes | Provider disk encryption (Render managed Postgres encryption at rest **[unverified]**, owner OPS, confirm in Render docs by 2026-10-24; production: provider/NIC volume encryption with India-resident keys) |
| E-14 Contact (phone, email) | **Application-level envelope encryption**: AES-256-GCM with a per-tenant DEK (`cryptography` library, pin at H0), 96-bit random nonce, AAD = `tenant_id‖applicant_id‖field_name`. Lookup through a **blind index** = HMAC-SHA256(index_key, normalised value), truncated to 16 bytes |
| E-04/E-05 LL/DL numbers | Not stored in clear. If the user enters one for the copy-pack (F-07 Mode A), it stays in the browser (IndexedDB, encrypted with WebCrypto AES-GCM key held in memory per session) and is never sent; if a future adapter needs it server-side, store as AES-GCM ciphertext + blind index |
| Consent artefacts E-15 | Signed (Ed25519) JSON; stored in clear (no secret), integrity-protected |
| Audit log E-30 | Append-only table (no UPDATE/DELETE grants), hash chain (`prev_hash`), daily anchor hash exported to a separate bucket |
| Backups | Encrypted by provider; production: encrypted with tenant KEK, stored in India, restore tested monthly |
| Object store (clips) | Only blurred, published clips are public-read via signed CDN URLs; raw ingest media lives in a private bucket, auto-deleted 30 days after publish or reject |
| Browser storage | Drafts and offline mock tests in IndexedDB; no PII beyond what the user typed; "clear this device" wipes IndexedDB, Cache Storage, cookies and the service-worker caches (EC-14) |

---

## 7. Key management

| Key | Purpose | Phase 1–2 storage | Phase 3+ storage | Rotation |
|---|---|---|---|---|
| KEK (per tenant in Phase 3+) | Wraps DEKs | Render secret env var `MG_KEK_V1` (32 bytes, base64), only on the API service | Cloud KMS/HSM in an Indian region or NIC HSM; API has `encrypt/decrypt` permission only, no export | Yearly or on suspicion; versioned (`kid`) so old ciphertext stays readable |
| DEK per tenant | Encrypts E-14 fields | Stored wrapped in `tenant_keys` table | Same | Yearly; lazy re-encryption job (Render Workflow / JobRunner) |
| Blind-index key | HMAC for contact lookup | Env secret `MG_BIDX_V1` | KMS (HMAC key) | Rotation requires re-index job; rare |
| Session signing / CSRF secret | CSRF tokens | Env secret | KMS-derived | 90 days |
| Score-seed HMAC key | Signs game seeds (§11) | Env secret on API + verifier | KMS | 30 days, two keys valid during overlap |
| Rule-pack signing keys | Ed25519, one per checker | Private key in the checker's passkey-protected browser vault (WebCrypto, non-extractable) for the demo | Checker's hardware token or KMS asymmetric key | On staff change |
| Practice Record signing key | Signs the Practice Record QR (F-28, API-47) | Env secret (Ed25519) | KMS | Yearly; public keys published at `/.well-known/margdarshak-keys.json` with `kid` |
| n8n webhook HMAC | API-65/66 | Shared secret in Render env + n8n credential store | Same | 90 days |
| Third-party API keys (Gemini, Sarvam, WhatsApp, email, Sentry DSN) | Outbound | Render env groups, per environment; Gemini key restricted to the Generative Language API and to server egress | Vertex AI service account with workload identity (no long-lived key) | 90 days or on any leak |

Crypto shredding: deleting a tenant DEK makes all that tenant's E-14 data unreadable; used for tenant offboarding and as the last step of account deletion (per-user DEK is roadmap if a state demands it).

---

## 8. Secrets management and configuration
- **No secrets in git.** `gitleaks` pre-commit hook and CI job (blocking); GitHub push protection on.
- **Environments:** `dev` (local, `.env` from `.env.example` with fake values), `preview` (PR deploys, synthetic data, separate keys), `prod-demo` (judging), `prod` (Phase 3+). Keys are never shared between environments.
- **CI:** GitHub Actions uses OIDC to the cloud in Phase 3+; Phase 1–2 uses repository secrets scoped to `environment: prod-demo` with required reviewers.
- **n8n:** credentials only in n8n's credential store; workflows hold no business logic (D-16) and no citizen personal data, only staff work contacts, IDs and k-anonymous aggregates (ADR-0006); n8n execution logs retention set to 7 days and "save data on success" off for staff-messaging workflows. The citizen WhatsApp/email credentials live only in the API's environment (backend notifier).
- **Model IDs and endpoints in env vars** (PROJECT_BRIEF §10), never hard-coded.
- **Security headers** (set in Next.js middleware and FastAPI):
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<cdn>; media-src 'self' blob: https://<cdn>; connect-src 'self' wss://<api>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`
  - `Referrer-Policy: strict-origin-when-cross-origin`; `X-Content-Type-Options: nosniff`; `Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=()`; `Cross-Origin-Opener-Policy: same-origin`; `Cross-Origin-Resource-Policy: same-site`.
  - Camera and microphone permissions requested only at the moment of use (F-06, F-24 Helmet Fit, F-27, F-30).
- **Error handling:** problem+json responses with a correlation ID; no stack traces; Sentry with `send_default_pii=False` and a before-send scrubber that runs the same PII regex set as §10.

---

## 9. Logging, monitoring and CERT-In readiness
- **Structured logs** (JSON) through OpenTelemetry; a redaction processor drops request bodies on all endpoints except an allowlist of non-PII fields, and masks anything matching the §10 patterns.
- **Never logged:** contact values, DOB (only `age_band`), free text from AI chats (only a hash and length), audio, images, consent signatures, session IDs (only a truncated hash).
- **Security events to E-30 (append-only):** logins, failed logins, step-up, helper link create/revoke, consent grant/withdraw, export, delete, rule-pack publish, clip publish, admin elevation, rate-limit bans, PII-guard trips (type only), provenance-guard trips.
- **Clock:** all servers NTP-synced; production points at NIC/NPL time sources as the CERT-In Directions require (hostnames `samay1.nic.in` / `samay2.nic.in` / NPL **[unverified]**, owner OPS, confirm by 2026-11-15). The app treats **server time as the source of truth** for every countdown (EC-15).
- **Retention:** Phase 1–2: 30 days on Render log streams + 180-day copy of security events in E-30. Phase 3+: **180 days rolling, within Indian jurisdiction** (CERT-In Directions 28 Apr 2022, direction (iv)) and **at least 1 year** for personal-data processing logs (DPDP Rules 2025 Rule 8(3), from 13 May 2027). We set one policy: security and processing logs 1 year in India, then delete.
- **Alerting:** p95 latency, 5xx rate, auth-failure spikes, PII-guard trip rate, provenance-guard trip rate, Gemini 429s, Live Intel report bursts per office, verifier rejection rate.
- **Incident response:** the 6-hour CERT-In clock and the DPDP Rule 7 breach flow are in [PRIVACY.md §10](PRIVACY.md) and `../05-ops/RUNBOOK.md`.

---

## 10. PII guards (no Aadhaar, OTP or biometrics, ever)

### 10.1 What is blocked and where

| Pattern | Regex (normalised: strip spaces, hyphens, dots; map Devanagari digits ०-९ to 0-9) | Extra check | Action |
|---|---|---|---|
| Aadhaar number | `\b[2-9]\d{11}\b` | **Verhoeff checksum** valid (reduces false positives on random 12-digit numbers) | Block the send; replace with `[aadhaar removed]`; show "Never share your Aadhaar number here. Margdarshak never needs it." |
| Aadhaar VID | `\b\d{16}\b` near keywords (`VID`, `virtual id`, `वीआईडी`) within 30 chars | — | Block + same message |
| OTP | `\b\d{4,8}\b` within 40 chars of `otp|one time|code|ओटीपी|कोड|पासवर्ड` | — | Block; "Never share an OTP with anyone, including us." |
| Masked Aadhaar shown by UIDAI (`XXXX XXXX 1234`) | `X{4}\s?X{4}\s?\d{4}` | — | Allow but strip (not needed) |
| PAN | `\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b` | — | Redact |
| Indian mobile | `(\+?91[\s-]?)?\b[6-9]\d{9}\b` | — | Redact in AI text; allowed only in the contact field (E-14) |
| Email | RFC 5322-lite | — | Redact in AI text |
| DL number | `\b[A-Z]{2}[\s-]?\d{2}[\s-]?(19|20)\d{2}[\s-]?\d{7}\b` | State-code allowlist (36 codes) | Redact in AI text; never stored server-side |
| Vehicle registration | `\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{4}\b` and BH series `\b\d{2}BH\d{4}[A-Z]{1,2}\b` | — | Redact in AI text and in Live Intel (there is no free text, but defensive) |
| UPI ID | `\b[\w.\-]{2,256}@[a-zA-Z]{2,64}\b` (not an email TLD) | — | Allowed only in the scam checker (F-33), where it's analysed by rules and **not sent to Gemini** (replaced by `[upi_id]` token) |
| Bank account / IFSC | `\b[A-Z]{4}0[A-Z0-9]{6}\b`, `\b\d{9,18}\b` near `a/c|account|खाता` | — | Redact |
| Sarathi application number | State-specific patterns from the rule pack (`rulepack.patterns.application_no`) | — | Redact in AI text; allowed in the user's own case (encrypted) |
| Captcha / password | Keywords `captcha|password|पासवर्ड` + following token | — | Block |
| Face / biometric images | Images to M-05/M-07: on-device face detection (MediaPipe / ML Kit face detection) blurs faces before upload; Aadhaar-like card layouts detected by on-device text recognition (12-digit Verhoeff hit) cause the image to be rejected client-side | — | Reject with message "This looks like an Aadhaar card. We never need it." |

### 10.2 Layers
1. **Client (TS, `@margdarshak/pii-guard`)**: runs on every AI input box, screenshot upload (after on-device OCR) and the voice transcript preview. Blocks before the request leaves the device (EC-20).
2. **Server (Python, `margdarshak.pii_guard`)**: the same patterns from one shared `pii_patterns.json` with **shared test vectors** (≥ 200 positive and negative strings, Hindi, Hinglish, Devanagari digits, spaced and hyphenated forms). CI fails if the TS and Python results differ on any vector.
3. **ADK plugin**: a runner-level plugin (`PiiGuardPlugin`, built on ADK's plugin API and PII Redaction plugin, `04-ai-adk-gemini.md` §1.8) with `before_model_callback` (redact the prompt), `after_model_callback` (redact model output, e.g. if the model echoes a number), and `before_tool_callback` (no tool may receive an Aadhaar-pattern argument). The voice agent's `set_field` tool enum **does not contain** any Aadhaar, OTP or mobile-OTP field IDs.
4. **Logs and Sentry**: the same pattern set in the log redaction processor.
5. **Voice (API-40) caveat.** Live audio is streamed to Gemini before any transcript exists, so redaction cannot happen before the model hears it. Controls: (a) a pre-mic notice "Never say your Aadhaar, OTP or bank details"; (b) system instruction to never repeat or store numbers and to reply with the refusal script; (c) the input transcription stream is scanned in real time; on an Aadhaar/OTP hit the server **ends the live session**, discards the session transcript, and logs `pii_trip:voice` (type only); (d) paid tier, so prompts aren't used for product improvement (Gemini API terms, last updated 2026-04-28; Google still logs prompts for a limited period for abuse detection); (e) residual risk recorded as R-17.

### 10.3 Never sent to any model (shown on screen, `04-ai-adk-gemini.md` §2)
Aadhaar number or VID, OTP, captcha, passwords, face images for authentication, contact details, DOB (only `age_band`), LL/DL/application numbers. A minor profile's AI inputs get the same redaction and are never used for profiling.

---

## 11. Score-verifier anti-cheat (E-16, E-17, API-34, API-35)

**Why it matters.** Scores feed the Test Readiness Score (F-21), the Practice Record (F-28, which a driving school may see) and the field study (F-57, D-22). A forged score corrupts evidence and misleads a learner about readiness.

### 11.1 Protocol

```mermaid
sequenceDiagram
  participant C as PWA (game-core)
  participant A as API (FastAPI)
  participant V as Score verifier (Node, game-core@same version)
  participant DB as Postgres
  C->>A: API-34 POST /v1/games/{gameId}/sessions
  A->>DB: create GameSession(seed, clip order, game_core_version, expires_at)
  A-->>C: {session_id, seed, clip_ids (media URLs only), sig=HMAC(seed‖session_id‖version‖exp)}
  Note over C: Scoring windows are NOT sent. Client records events with<br/>video.currentTime + performance.now(), hash-chained.
  C->>A: API-35 POST /v1/games/sessions/{id}/complete {events[], client_score, chain_head, sig}
  A->>A: verify sig, expiry, single use (nonce), version match
  A->>V: replay(seed, events, server-side windows)
  V-->>A: {verified_score, flags[]}
  A->>DB: store verified_score (client_score kept only for drift metrics)
  A-->>C: {verified_score, debrief_id}
```

### 11.2 Checks (each a flag; any `hard` flag zeroes the session and excludes it from the field study)

| # | Check | Type |
|---|---|---|
| V1 | HMAC signature valid, session not expired (TTL = clip durations + 10 min), single use | hard |
| V2 | `game_core_version` equals the server's pinned build hash | hard |
| V3 | Event hash chain intact (`h_i = SHA-256(h_{i-1}‖event_i)`), monotonic `currentTime` per clip, no event outside clip duration | hard |
| V4 | Wall-clock plausibility: total session duration ≥ sum of clip durations × 0.95 (no fast-forward); `performance.now()` deltas consistent with `currentTime` deltas within ±300 ms (detects seeking, EC-18 buffering is handled by scoring on `currentTime`) | hard if > 3 s drift |
| V5 | **Pattern-clicking rule** (Kerala format, F-23): more than N taps in a window or regular-interval tapping → that clip scores 0 (UK HPT practice) | scoring rule |
| V6 | Reaction-time floor: hits < 150 ms after onset counted as anticipatory guesses → flagged (soft), do not score above band 3 | soft |
| V7 | Client score ≠ verified score → client score discarded; drift counter per device | soft |
| V8 | Rate: ≤ 20 sessions per account per day per game; XP diminishing after 45 min/day (F-26) | soft |
| V9 | Clip order shuffled per session from the seed; windows never leave the server, so memorising answers from DevTools fails | design |
| V10 | Field-study sessions require a study consent artefact and a `study_session` flag; only verified, flag-free sessions enter the nightly stats Workflow | design |

A minor's practice in family mode is verified and stored like anyone else's, inside the parent's account (D-13 revised).

---

## 12. Rate limits and abuse throttling
Implementation: Redis token buckets (sliding window) keyed by `{tenant}:{actor|device|ip}:{route}`, via a FastAPI middleware (`slowapi` or a 40-line custom limiter; pin at H0) plus edge rules. Responses: HTTP 429 with `Retry-After`; repeated breaches produce a 24 h soft ban logged to E-30.

| Endpoint | Key | Limit | Notes |
|---|---|---|---|
| API-01 `POST /v1/plans` (no auth) | IP + device | 30/min, 300/day | Cheap, deterministic; protects against scraping of rule packs (they're CC-BY and downloadable anyway, so the limit is about cost) |
| API-02/03 rules | IP | 120/min | Cacheable (ETag) |
| API-04 send plan to WhatsApp | device + phone hash | 3/day per phone, 10/day per device | Prevents using us to spam numbers; requires explicit consent tick |
| Magic link request | email hash / IP | 3 per 15 min / 10 per hour | Anti-enumeration |
| API-12 autosave | session | 60/min | Debounced client-side to 1 per 2 s |
| API-28 Live Intel report | account + office | 1 per 7 days per office, 5/day total | Plus account-age rule (§4.3) |
| API-34/35 game sessions | account | 20/day/game, 200/day total | V8 |
| API-40 voice WS | account | 3 concurrent → 1; **10 min/user/month on free plan** (`04` §5); 15 min max session | Cost and abuse cap |
| API-41/42/43 AI text/vision | account | 30/hour, 100/day; image ≤ 1024 px, ≤ 2 MB after client downscale | LLM10 unbounded consumption |
| API-47 verify Practice Record | IP | 60/min | Tokens are 128-bit, unguessable |
| API-61 export | account | 2/day | Step-up required |
| API-63 analytics | device | 100/min, batched | Payload schema-validated, no PII fields allowed |
| API-65/66 internal | n8n IP + HMAC (staff events); provider signature for Meta/email channel webhooks on API-66 | 60/min (n8n); channel webhooks sized to notifier volume | Replay window 5 min |
| Global per IP | IP | 600/min | Edge |
| Gemini budget circuit breaker | project | daily ₹ cap (set in env, e.g. ₹2,000/day in Phase 2) | When hit, AI surfaces show template fallback (EC-29) |

---

## 13. OWASP ASVS L2 mapping
Target: **ASVS 4.0.3 Level 2** (the version most Indian empanelled auditors reference). A cross-walk to ASVS 5.0 chapters is maintained in `security/asvs-crosswalk.csv` (ASVS 5.0 reorganised chapters in 2025; chapter numbering **[unverified]**, owner SEC, check owasp.org by 2026-11-01). Evidence column = what the auditor gets.

| ASVS 4.0.3 chapter | Key L2 requirements | How Margdarshak meets it | Evidence | Phase |
|---|---|---|---|---|
| **V1 Architecture, design, threat modelling** | 1.1 secure SDLC, threat model per change; 1.2 auth architecture; 1.4 access control architecture; 1.5 input/output architecture; 1.6 crypto architecture; 1.14 config/segregation | [THREAT_MODEL](THREAT_MODEL.md) reviewed on every epic; one policy module; zones §2; key mgmt §7; container per tier | Threat model, ADRs, DFD | 1–2 |
| **V2 Authentication** | 2.1 passwords (n/a: passwordless), 2.2 anti-automation, 2.3 authenticator lifecycle, 2.5 recovery, 2.7 out-of-band (magic link) 10-min expiry, 2.8 TOTP, 2.9 WebAuthn | §3; magic link TTL 10 min single use; TOTP/WebAuthn for staff | Auth test suite, ZAP report | 1–2 |
| **V3 Session management** | 3.2 token binding, 3.3 logout & timeouts, 3.4 cookie flags, 3.5 token-based sessions, 3.7 re-auth for sensitive ops | §3.2 cookies, idle/absolute timeouts, step-up | Cookie scan, session tests | 1–2 |
| **V4 Access control** | 4.1 deny by default, 4.2 IDOR protection, 4.3 admin MFA | Policy table, RLS, UUIDv7, passkeys for admin | `test_policy_table.py`, `test_rls_isolation.py` | 1–2 |
| **V5 Validation, sanitisation, encoding** | 5.1 input validation (Pydantic v2 strict models, Zod on client), 5.2 sanitisation (model output escaped; Markdown rendered with an allowlist sanitizer), 5.3 output encoding (React auto-escape, no `dangerouslySetInnerHTML` except sanitised), 5.5 deserialisation | Pydantic `strict=True`, `extra="forbid"`; ESLint rule bans `dangerouslySetInnerHTML` outside `SafeMarkdown` | Lint config, unit tests | 1–2 |
| **V6 Stored cryptography** | 6.2 approved algorithms, 6.3 CSPRNG, 6.4 key management | AES-256-GCM, Ed25519, HMAC-SHA256, `secrets`/WebCrypto | §6–7, crypto unit tests | 1–2 |
| **V7 Error handling & logging** | 7.1 no sensitive data in logs, 7.2 log security events, 7.3 log integrity, 7.4 generic errors | §9; hash-chained E-30 | Log samples, redaction tests | 1–2 |
| **V8 Data protection** | 8.1 server-side, 8.2 client-side (no PII in localStorage, clear on logout), 8.3 sensitive private data (minimisation, export, delete) | E-14 encryption, IndexedDB drafts cleared, API-61/62 | [PRIVACY](PRIVACY.md), deletion test | 1–2 |
| **V9 Communications** | 9.1 TLS everywhere, 9.2 server-to-server TLS | §6.1 | SSL Labs A+ report | 1–2 (A+ needs HSTS preload: Phase 3) |
| **V10 Malicious code** | 10.2 no backdoors/time bombs, 10.3 integrity of updates (SW update flow, SRI for any external script) | Code review rule, Serwist update prompt, no third-party scripts in Phase 1–2 | SBOM, review log | 1–2 |
| **V11 Business logic** | 11.1 sequential flow, anti-automation, limits | §4.3, §11, §12 | Abuse tests (T-AB-xx) | 1–2 |
| **V12 Files & resources** | 12.1 upload size, 12.2 type validation, 12.4 storage outside webroot, 12.5 download, 12.6 SSRF | Photo checks run on device; screenshots (API-42) accepted as JPEG/PNG/WEBP ≤ 2 MB, re-encoded server-side with Pillow (pin at H0) to strip EXIF, held in memory only; **no URL fetch tools** in any agent (no SSRF surface) | Upload tests | 1–2 |
| **V13 API & web service** | 13.1 generic, 13.2 RESTful (method allowlist, JSON content-type check, CSRF), 13.4 GraphQL (n/a) | OpenAPI 3.1 contract, schema validation, `openapi.yaml` linted (Spectral) | Contract tests | 1–2 |
| **V14 Configuration** | 14.1 build, 14.2 dependencies (SCA), 14.3 no debug, 14.4 headers, 14.5 request validation | §8 headers, §15 supply chain, `DEBUG=false`, `adk web` never exposed in prod-demo (dev UI is "not meant for production", `04` §1.6) | CI logs, header scan | 1–2 |

Known L2 gaps in Phase 1–2 (accepted, with dates): HSTS preload (Phase 3, OPS), formal key ceremony (Phase 3, SEC), external VAPT (Phase 3, SEC, before any government hosting), WAF managed rules (Phase 3, OPS).

---

## 14. OWASP Top 10 for LLM Applications (2025) mitigations

| ID | Risk | Where it could hit Margdarshak | Mitigations | Test / eval |
|---|---|---|---|---|
| **LLM01 Prompt injection** | Direct: user tells VoiceGuide "ignore rules, book my slot". Indirect: a scam message pasted into F-33, a Sarathi screenshot with injected text into M-05, clip metadata into M-06 | (1) **Closed action enum** (`navigate(screen_id)`, `set_field(field_id, value)`, `confirm()`); no submit/pay/book tools exist (F-30); (2) facts only from `get_rule(rule_id)` and catalogues; (3) Flash-Lite judge plugin screens pasted text (`04` §3.7); (4) Gemini safety settings set explicitly incl. `jailbreak` at `BLOCK_MEDIUM_AND_ABOVE` (defaults are OFF for 2.5+, `04` §1.8); (5) untrusted content wrapped in delimiters and labelled data; (6) the scam verdict is computed by rules, so an injection can't flip it | Evalset `prompt_injection.evalset.json` ≥ 40 cases across M-01..M-05; pass = 0 tool calls outside enum, 0 verdict changes |
| **LLM02 Sensitive information disclosure** | Model echoes PII, or one user's data reaches another's context | §10 PII guards; no cross-user memory (ADK memory services unused, case file is structured state, `04` §1.4); per-request context only; no PII in prompts | PII vectors in CI; evalset `pii_echo` |
| **LLM03 Supply chain** | Compromised ADK/SDK package, model swap | Pinned `google-adk` 2.12.x with hashes (`uv` lock / `pip --require-hashes`), model IDs in env, SBOM, Dependabot, `pip-audit` | CI |
| **LLM04 Data and model poisoning** | Poisoned tutor explanations (F-31), poisoned clip windows (M-06), poisoned Live Intel feeding the console | Tutor text is authored offline, **human-reviewed**, shipped static (`04` §3.5); clip windows set by **two human raters** (M-06 only proposes); Live Intel is structured and k-anonymised, never fed to a model | Review logs; inter-rater Δ |
| **LLM05 Improper output handling** | Model text rendered as HTML/Markdown with links; model output used as a tool argument | Output escaped; links stripped except allowlisted domains; **number-provenance guard** (`after_model_callback`) replaces any ₹/day/age/metre/second not in this turn's tool results (D-10); the debrief uses IDs, text is assembled from templates; no digits in M-02/M-03 model text | Evalset `provenance` ≥ 30 per agent; 0 invented numbers |
| **LLM06 Excessive agency** | Agent books, pays, submits, sends messages | No such tools. Messages are sent only by the backend after an explicit user tap. Voice never fills Aadhaar/OTP/mobile fields | Tool trajectory score 1.0 in `adk eval` |
| **LLM07 System prompt leakage** | User extracts the prompt | Prompts contain no secrets, keys, URLs to internals or user data; prompts are in the public repo anyway (Apache-2.0) | n/a (by design) |
| **LLM08 Vector and embedding weaknesses** | RAG store poisoning or cross-tenant retrieval | No vector store in Phase 1–2 (rules come from tables, not retrieval). If added: per-tenant index, signed content only | n/a |
| **LLM09 Misinformation** | Wrong fee, wrong age, unsafe riding advice, false "you're ready" | Code computes facts (D-09); `UNKNOWN` is a first-class answer; every answer carries a rule-ID source chip; no Search grounding (`04` §0.5); golden hour, fees, eligibility, scam verdicts have **no AI** | Evalsets per agent ≥ 30 (D-10), run in CI |
| **LLM10 Unbounded consumption** | Voice minutes, token floods, image floods, denial-of-wallet | §12 limits; 10 min voice/month on free plan; max tokens per call; image downscale ≤ 1024 px; daily ₹ circuit breaker → template fallback (EC-29) | Load test + budget alarm |

---

## 15. Supply-chain security

| Control | Tool | Gate |
|---|---|---|
| Lockfiles with hashes | `uv.lock` (Python), `pnpm-lock.yaml` (JS) | CI fails on drift |
| SCA (known CVEs) | `pip-audit`, `pnpm audit --prod`, **OSV-Scanner** | Block on High/Critical with a fix available |
| SAST | **Semgrep** (`p/owasp-top-ten`, `p/python`, `p/typescript`, custom rules: no `eval`, no `dangerouslySetInnerHTML`, no rupee literals in UI/prompt strings (D-06), banned words lint (D-19), 13 dark-pattern lint rules (F-26)), **Bandit** | Block on High |
| Secrets | **gitleaks** | Block |
| Container scan | **Trivy** (image + IaC) | Block on Critical |
| SBOM | **Syft** → CycloneDX JSON per release, attached to the GitHub release; **Grype** on the SBOM | Artefact for STQC pack |
| Provenance | GitHub `actions/attest-build-provenance` (SLSA build provenance), images signed with **cosign** (Sigstore) | Phase 3 enforced at deploy |
| Dependency updates | Dependabot (weekly), grouped; Renovate optional | Review required |
| Pinned actions | GitHub Actions pinned by commit SHA; `permissions: read-all` default, job-level least privilege | CI lint (`zizmor` or `actionlint`) |
| Licence compliance | `pip-licenses`, `license-checker`; no AGPL in the core (Apache-2.0 project, `07` §B5) | Review |
| Model supply chain | Gemini model IDs pinned in env and recorded in each Debrief (E-19) for reproducibility; Sarvam model version recorded | Eval rerun on any model change |
| Third-party web content | No third-party scripts or trackers in the PWA (F-55 analytics are first-party) | CSP |

Versions are re-pinned at H0 against the registries; any version written in docs is a floor, not a promise.

---

## 16. Secure SDLC

| Stage | Practice | Owner |
|---|---|---|
| Plan | Each epic gets a 15-min STRIDE pass using [THREAT_MODEL](THREAT_MODEL.md); privacy check against [PRIVACY](PRIVACY.md) inventory (new field = new row) | SEC + PL |
| Design | ADR for any new data flow, processor or AI tool; AI tools reviewed against the closed-enum rule | BE / AI |
| Code | Conventional Commits; branch protection (1 review, status checks); CODEOWNERS for `security/`, `policy/`, `pii_guard/`, `prompts/`, `rulepacks/` | All |
| Build | CI: lint, type-check (mypy strict, `tsc --noEmit`), unit, contract tests (adapters), RLS tests, PII vectors, Semgrep, Bandit, gitleaks, SCA, Trivy, SBOM | OPS |
| Test | Playwright e2e incl. family-mode consent, helper, delete, clear-device; axe accessibility; `adk eval` ≥ 30 cases per agent (D-10); ZAP baseline against preview deploys | FE / AI / SEC |
| Release | Signed tags, changelog incl. rule-pack changes (public `CHANGELOG`, §3.3 of verification), SBOM attached | OPS |
| Operate | Alerts §9, on-call rota during judging, incident runbook | OPS / SEC |
| Learn | Post-incident review within 5 working days; threat model updated | SEC |

**Definition of done (security slice):** no new High findings; PII vectors green; RLS test green; new endpoints in OpenAPI with auth and rate-limit annotations; new data fields in the PRIVACY inventory; banned-wording lint green.

**Hackathon rule (R-14):** no commits and no participant data before the confirmed start time; the repo's first commit timestamp and the field-study consent timestamps are evidence.

---

## 17. Pen-test and assurance plan

| # | Activity | When | Who | Scope | Exit criterion |
|---|---|---|---|---|---|
| PT-1 | Automated baseline: OWASP ZAP baseline + API scan from `openapi.yaml`, Nuclei templates | Every preview deploy (Phase 1–2) | OPS (CI) | Public routes | 0 High |
| PT-2 | Internal manual test (OWASP WSTG v4.2 checklist subset: auth, session, authz/IDOR, input, business logic, file upload, WebSocket) | Before demo freeze (Phase 2) | SEC + one peer not on that module | API-01..API-71, consoles | All High fixed, Medium triaged |
| PT-3 | LLM red-team: promptfoo red-team / garak probes + manual jailbreaks in Hindi, Hinglish, Dogri transliteration | Phase 2, then on every model change | AI | M-01..M-07 | 0 tool calls outside enum, 0 PII echoes, 0 invented numbers |
| PT-4 | Game anti-cheat test: tampered events, replayed sessions, sped-up clocks, DevTools edits | Phase 2 | FE + SEC | API-34/35 | All forged sessions rejected |
| PT-5 | Tenancy test: cross-tenant reads/writes on all 31 entities | Every PR (CI) + Phase 3 manual | BE | DB + API | 0 leaks |
| PT-6 | **External VAPT by a CERT-In-empanelled auditor** (web, API, PWA, config review, source review optional) | Phase 3, before any government hosting (GIGW 3.0 safe-to-host) | SEC with the STD | Full; see [STQC_PREAUDIT_PACK](STQC_PREAUDIT_PACK.md) | Safe-to-host certificate |
| PT-7 | Retest after fixes | Phase 3 | Auditor | Findings | Closure report |
| PT-8 | Responsible disclosure: `SECURITY.md` + `/.well-known/security.txt` (RFC 9116), acknowledgement in 72 h | From public repo day | SEC | All | — |
| PT-9 | Bug bounty (private, small) | Roadmap after 10k users | SEC | — | — |

---

## 18. Hackathon build vs production: summary

| Area | Hackathon build (Phase 1–2) | Production (Phase 3+) |
|---|---|---|
| Hosting | Render Singapore, synthetic data, consented 18+ study data only | MeghRaj / MeitY-empanelled CSP or NIC, India region; data, logs, backups and AI inference in India |
| Identity | Magic link, Google OIDC, passkeys for staff | + DigiLocker OAuth/PKCE, Jan Parichay/state SSO via adapters |
| AI | Gemini API paid tier (D-13 revised; provider terms on minors: R-13) | Vertex AI in an Indian region (Mumbai `asia-south1` lists Gemini 2.5 Flash/Flash-Lite/Pro for in-region ML processing per Google's data-residency page; current-model coverage to be checked), or Bhashini/local Indic models behind the same port |
| Keys | Env-held KEK, per-tenant DEK | KMS/HSM in India, per-tenant KEK |
| Logs | 30 days + E-30 | 1 year in India (covers CERT-In 180 days and DPDP Rule 8(3)) |
| Assurance | CI scanners, internal tests, LLM evals | External VAPT, safe-to-host certificate, annual re-audit, ISO 27001 roadmap |
