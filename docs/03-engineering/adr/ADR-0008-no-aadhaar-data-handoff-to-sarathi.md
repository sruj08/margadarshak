# ADR-0008: No Aadhaar data; Aadhaar steps are a hand-off to Sarathi
> Project: Margdarshak · Owner: Tech lead + Compliance lead · Status: Accepted · Date: 2026-10-23
> Related: [Architecture §5](../ARCHITECTURE.md) · [Integrations §2.4](../INTEGRATIONS.md) · [Data model §1, §4.1](../DATA_MODEL.md) · [API spec API-12, API-16, API-18](../API_SPEC.md) · ADR-0001

## Context and problem statement
Sarathi's contactless LL flow uses Aadhaar eKYC (and face authentication in some states). A private team cannot do Aadhaar eKYC: private authentication requires Central Government approval under the Jan 2025 Good Governance amendment (verification §3.1 G1; SECONDARY, gazette not read). Offline verification (Secure QR / Paperless XML) is a separate route with OVSE obligations, and onward sharing of offline e-KYC documents triggers Aadhaar Act ss.29 and 37. The team's earlier design included "face match against the Aadhaar photo", which the council cut. Users will also type Aadhaar numbers or OTPs into chat (EC-20).

## Decision drivers
- D-07: never collect an Aadhaar number, OTP, biometrics or face for matching.
- Brief F-56 (updated): AadhaarOfflineAdapter is **mock-only** in Margdarshak; government mode runs through the state.
- Brief §15: never Aadhaar-OTP login; personal values for the copy-pack live in an on-device vault.

## Considered options
1. **Never touch Aadhaar data: eKYC/OTP/payment/submission happen on Sarathi (hand-off); offline verification mock-only (state service in government mode); prohibited-field defences at every layer.**
2. Become an OVSE and verify Secure QR / XML ourselves.
3. Apply for private Aadhaar authentication approval.

## Decision outcome
Chosen option: **1**, because it is lawful today, removes the highest-impact data from our systems, and matches the adoption model (the government already does eKYC inside Sarathi).

### Consequences
- **Class CX (prohibited) data** — Aadhaar number/VID, OTP, biometrics, face templates, document images, Sarathi credentials — is rejected by: Pydantic validators (with Verhoeff check), the `answers` `propertyNames` deny-list in `api/openapi.yaml`, a Postgres `CHECK`, log redaction, and the AI PII gate before any model call.
- The voice agent's `set_field` enum excludes Aadhaar/OTP fields; spoken digits that look like Aadhaar are dropped with "type it only on Sarathi".
- API-16 hand-off returns a **template** only; name, relation name and address fill on the device from the on-device vault.
- API-18 exists as a **mock** that returns derived booleans only, so the flow can be demonstrated with a "simulated" chip; in government mode it calls the state's OVSE service.
- Bad: the user still meets Sarathi's eKYC screens; we prepare them for it (screen decoder, copy-pack, "what to expect").

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| eKYC | user does it on Sarathi | Sarathi (government AUA) via the state |
| Offline check | mock adapter, synthetic samples | state's OVSE service through `AadhaarOfflineStateServiceAdapter` |
| Identity data stored | none (derived age band only) | none |

## Pros and cons of the options
### Option 1
- Good: lawful, simple, lowest breach impact; honest demo.
- Bad: less automation in the Aadhaar step.
### Option 2
- Good: offline age/address checks inside our app.
- Bad: OVSE duties, Reg. 13A application per the Dec 2025 commentary, storage restrictions; not feasible for a hackathon team; the state already holds this role.
### Option 3
- Good: full automation.
- Bad: approval chain (portal → UIDAI → ministry → notification) is long and purpose-limited; not ours to seek for a citizen front end.

## Validation
Contract and property tests assert no CX field survives any path (API, logs, AI prompts, analytics); red-team evals include users pasting Aadhaar numbers and OTPs; DPIA in `docs/06-security-compliance/PRIVACY.md`.

## Links
- https://scroll.in/latest/1078654/it-ministry-notifies-rules-allowing-private-entities-to-carry-out-aadhaar-authentication
- https://uidai.gov.in/images/FAQ_OVSE.pdf · https://www.uidai.gov.in/images/DosandDon_ts_for_Offline_Verification_Seeking_entities.pdf
- https://vinodkothari.com/2025/12/a-new-way-to-verify-aadhaar-offline-introduction-of-face-matching/
- `research/ps1-deep/07-govt-plug-and-play.md` §A3
