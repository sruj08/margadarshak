# ADR-0001: Hexagonal core with a Government Adapter Layer (mock + real adapters, same contract tests)
> Project: Margdarshak · Owner: Tech lead · Status: Accepted · Date: 2026-10-23
> Related: [Architecture §3, §5](../ARCHITECTURE.md) · [Integrations](../INTEGRATIONS.md) · [Backend §3](../BACKEND.md) · ADR-0008 · ADR-0009

## Context and problem statement
Margdarshak is positioned as "a reference citizen front end plus an open adapter specification that MoRTH/NIC can host" (D-02). Every government system it touches is either closed to private entities or gated:
- NIC's RTI reply says data sharing with private entities stopped on 1 Oct 2026 (verification §3.1 G3).
- Private Aadhaar authentication needs Central Government approval (G1); Aadhaar offline verification carries OVSE duties.
- DigiLocker requester access needs NeGD onboarding (G2); API Setu access needs publisher approval.
- Bhashini onboarding terms for private apps are unknown (`07` §A4).

The hackathon build must still work end to end (D-04: no dead buttons) and the design must let a state flip a switch, not rewrite code, when it adopts (F-56, `07` §B1).

## Decision drivers
- D-02 / D-08: never claim live integration; never scrape or automate government sites.
- F-56: SarathiAdapter, DigiLockerAdapter, AadhaarOfflineAdapter, BhashiniAdapter, PaymentAdapter, NotificationAdapter, SlotAdapter, each mock + real, same contract tests.
- D-17: cloud-agnostic and auditable by NIC.
- Judges' question "is this on real APIs?" (Rutvik persona) needs an honest, demonstrable answer.

## Considered options
1. **Hexagonal core (ports and adapters) with a Government Adapter Layer**, adapter chosen per tenant, one contract suite per port.
2. Direct integrations coded in the services, with feature flags for mocks.
3. A separate "integration microservice" per government system.

## Decision outcome
Chosen option: **1**, because it makes the honest claim ("we ship the socket and the spec; the government plugs in") literally true in code, lets the demo run on mocks, and lets a state activate a real adapter by configuration once it passes the same contract tests.

### Consequences
- Good: domain logic is pure and testable; adapters are swappable per state; NIC can implement the server side of an adapter spec without our code; the mock adapters double as demo fixtures with "simulated" chips.
- Good: anti-corruption — nothing outside an adapter sees Sarathi field names, DigiLocker XML or gateway payloads.
- Bad: more interfaces than a quick hackathon app; mitigated by keeping each port to 3–5 methods.
- Follow-ups: `api/adapters/sarathi.yaml` government-side spec (owner Tech lead, Phase 2); contract suites per port in `tests/contract/` (owner Backend lead, H+12).

### Hackathon (Phase 1–2) vs production (Phase 3+)
| Port | Hackathon | Production |
|---|---|---|
| Sarathi | `SarathiDeeplinkAdapter` (Mode A, works today) + `SarathiMockAdapter` | `SarathiRealAdapter` (Mode B, NIC-granted) |
| DigiLocker | `DigiLockerMockAdapter` | `DigiLockerRequesterAdapter` after NeGD onboarding |
| AadhaarOffline | `AadhaarOfflineMockAdapter` only | the state's OVSE service |
| Bhashini | `BhashiniMockAdapter` | `BhashiniDhruvaAdapter` |
| Payment | `PaymentRedirectAdapter` + mock gateway | `PaymentStateGatewayAdapter` |
| Notification | `WhatsAppCloudNotifier` (Meta WhatsApp Cloud API, direct), `EmailNotifier`, `WebPushNotifier`, `ConsoleNotifier` (citizen messages never go through n8n, ADR-0006) | + `MgovSmsNotifier` after DLT |
| Slot | `SlotMockAdapter`, `SlotCrowdIntelAdapter` | `SlotRealAdapter` |

## Pros and cons of the options
### Option 1 — hexagonal + adapter layer
- Good, because adoption becomes configuration, and mocks are first-class.
- Good, because contract tests encode the legal guardrails (no CX fields, `collected_by = state_gateway`, Unknown status allowed).
- Bad, because of extra abstraction cost (small).
### Option 2 — direct integrations + flags
- Good, because fewer files.
- Bad, because mock and real paths diverge silently; government formats leak into the domain; adoption needs code changes.
### Option 3 — integration microservices
- Good, because isolation.
- Bad, because more deployables, network hops and on-call surface in 48 h (R-05).

## Validation
- CI: every port's suite runs against mock and recorded-real adapters on every PR; `depguard` (golangci-lint) plus a `go list -deps` architecture test forbid `internal/domain` → adapters imports (ADR-0011).
- Demo: switch the JK tenant's Sarathi adapter between `mock` and `deeplink` live without a deploy.

## Links
- `research/ps1-deep/07-govt-plug-and-play.md` §A, §B1–B4
- `war-room/margdarshak-verification.md` §3.1 G1–G4, §5 D-02, D-08
