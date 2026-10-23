# ADR-0010: Apache-2.0 for code, CC-BY 4.0 for the clip bank and rule packs
> Project: Margdarshak · Owner: Product lead + Tech lead · Status: Accepted · Date: 2026-10-23
> Related: [Architecture §15.2](../ARCHITECTURE.md) · [Tech stack](../TECH_STACK.md) · [Data model §4.2, §4.6](../DATA_MODEL.md) · ADR-0007

## Context and problem statement
Government adoption favours open source: the Policy on Adoption of OSS for GoI (2015) prefers OSS for new e-Gov applications, with source available to study, modify and redistribute (`07` §A9). Kerala's HPT circular asks driving schools to train with open-source computer-based tools (`02-rules-process.md` §5). The hackathon requires a public GitHub repository. We also want the hazard-clip bank and rule packs to become shared public goods, while keeping the "Margdarshak" name controlled for quality.

## Decision drivers
- OSS-first government policy; NIC/system integrators must be able to extend freely.
- Patent grant to reduce adopter risk.
- Content (clips, rule packs) should be reusable with attribution.
- Bystander privacy in clips (faces and plates blurred, R-12).

## Considered options
1. **Apache-2.0 code; CC-BY 4.0 for the published clip bank (blurred) and rule packs; trademark retained.**
2. MIT code; CC0 content.
3. AGPL-3.0 code; CC-BY-SA content.

## Decision outcome
Chosen option: **1**, because Apache-2.0 is OSS-policy compliant and includes a patent grant, CC-BY keeps attribution (and therefore provenance) on clips and rule packs, and a retained trademark lets us control what is called Margdarshak.

### Consequences
- `LICENSE` (Apache-2.0) and `NOTICE` at the repo root; `content/` and `rulepacks/` carry CC-BY 4.0 notices; every published clip row has `licence = 'CC-BY-4.0'` and an attribution string; contributor consent is recorded (E-15 `clip_contribution`).
- Only **blurred** clips are published (100% human blur audit); raw clips are private and deleted 7 days after publish.
- Dependency licences are checked in CI (SBOM); copyleft components are used only as separate tools (e.g. ffmpeg as a process, k6 as a test tool); n8n's Sustainable Use License applies only to the edge, which is replaceable (ADR-0006).
- Trademark: run an IP India check on "Margdarshak" before any post-event launch (verification §1 row 4; owner Product lead).
- Bad: forks may go closed (Apache permits it) — acceptable for a digital public good.

### Hackathon vs production
| Aspect | Hackathon | Production |
|---|---|---|
| Repo | public GitHub | public GitHub + OpenForge mirror if a state asks [unverified availability] |
| Content | seeded clips (team-filmed, consented) | growing CC-BY bank with partner schools |

## Pros and cons of the options
### Option 1
- Good: policy fit, patent grant, attribution keeps provenance.
- Bad: forks may close.
### Option 2
- Good: simplest.
- Bad: no patent grant; CC0 drops attribution (provenance).
### Option 3
- Good: forces sharing by operators.
- Bad: procurement and SI reluctance; may deter adoption.

## Validation
Licence check job in CI; every published clip has licence + attribution; README states licences clearly.

## Links
- `research/ps1-deep/07-govt-plug-and-play.md` §A9, §B5
- https://sflc.in/policies-and-cases/policy-on-adoption-of-open-source-software-for-government-of-india/
