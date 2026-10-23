# Margdarshak Helm chart: outline for state deployments
> Project: Margdarshak · Owner: Ops lead · Status: Draft v0.1 (outline; the chart is built in Phase 3) · Last updated: 2026-10-23
> Related: [INFRASTRUCTURE](../../docs/05-ops/INFRASTRUCTURE.md) · [DEPLOYMENT](../../docs/05-ops/DEPLOYMENT.md) · [OBSERVABILITY](../../docs/05-ops/OBSERVABILITY.md) · [RUNBOOK](../../docs/05-ops/RUNBOOK.md) · [deploy.yml](../../.github/workflows/deploy.yml)

This chart is how a State Transport Department (or NIC on its behalf) runs Margdarshak on **MeghRaj / NIC cloud or a MeitY-empanelled CSP in an Indian region** (D-17, `research/ps1-deep/07-govt-plug-and-play.md` §B4). It holds **no proprietary managed services**: Kubernetes, Postgres, an S3-compatible object store and OpenTelemetry are enough. The hackathon build runs on Render instead (`infra/render.yaml`). Both use the same three images from `infra/docker/`.

> **Status:** outline only. No chart templates exist yet. The `values` keys below are the contract that `deploy.yml` (`helm upgrade --install … -f values-<tenant>.yaml`) and the tenant files will follow.

## 1. Layout
```
infra/helm/
├── README.md                         ← this file
├── margdarshak/                      ← the application chart (Phase 3)
│   ├── Chart.yaml                    apiVersion v2, appVersion = git tag vX.Y.Z
│   ├── values.yaml                   safe defaults (all adapters = mock, AI off)
│   ├── values.schema.json            JSON Schema; `helm lint --strict` fails on unknown keys
│   └── templates/
│       ├── _helpers.tpl
│       ├── web-deployment.yaml       Next.js standalone, port 3000
│       ├── web-service.yaml
│       ├── api-deployment.yaml       FastAPI/gunicorn, port 8000
│       ├── api-service.yaml
│       ├── score-verifier-deployment.yaml   ClusterIP only, port 8081, never on Ingress
│       ├── score-verifier-service.yaml
│       ├── jobrunner-worker-deployment.yaml JobRunner=temporal worker (api image, `python -m app.jobs.worker`)
│       ├── scheduler-cronjobs.yaml   replaces n8n Schedule triggers when n8n is not used (W01, W04, W13, W15)
│       ├── migrate-job.yaml          helm.sh/hook: pre-install,pre-upgrade; `alembic upgrade head`
│       ├── ingress.yaml              TLS (state CA or Let's Encrypt), WAF annotations, HSTS
│       ├── hpa.yaml                  web, api, worker
│       ├── pdb.yaml                  minAvailable 1 for web/api/verifier
│       ├── networkpolicies.yaml      default-deny + explicit allow-list (§4)
│       ├── externalsecret.yaml       External Secrets Operator → state Vault/KMS
│       ├── configmap-tenant.yaml     tenant id, rule-pack version, languages, theme tokens (E-31)
│       ├── servicemonitor.yaml       Prometheus Operator scrape (/metrics)
│       ├── otel-collector.yaml       optional sidecar/daemonset config (OBSERVABILITY.md §3)
│       ├── chrony-config.yaml        NTP to NIC/NPL servers for nodes that we own (CERT-In)
│       └── NOTES.txt
└── tenants/
    ├── values-jk.yaml                Jammu & Kashmir pilot (en, hi, Dogri voice-in)
    └── values-kl.yaml                Kerala (HPT format from rule pack; Malayalam translation-ready)
```

## 2. Dependencies (installed by the platform team, not sub-charts by default)
| Component | Chart / operator | Why | Data stays in India |
|---|---|---|---|
| PostgreSQL 16 | CloudNativePG operator (`cloudnative-pg`), or the CSP's managed Postgres in an Indian region | HA primary + 2 replicas, PITR to object storage | WAL + base backups to an India-region bucket |
| Valkey 8 (Redis-compatible) | Bitnami `valkey` or the CSP's managed Redis | rate limits, sessions, idempotency keys, circuit breaker | ephemeral |
| Object storage | the CSP's S3-compatible store, or MinIO | clips (blurred), ICS files, exports, backups | yes |
| Temporal (JobRunner) | `temporalio/helm-charts` (MIT) | durable jobs that Render Workflows does on Render: clip pipeline, case-clock sweep, debrief fan-out, nightly stats | yes |
| OpenTelemetry Collector | `open-telemetry/opentelemetry-collector` | traces, metrics, logs → state SIEM / Grafana stack | yes |
| Grafana LGTM | `grafana/loki`, `grafana/tempo`, `prometheus-community/kube-prometheus-stack` | dashboards, alerts, 180-day log retention (CERT-In) | yes |
| External Secrets | `external-secrets/external-secrets` | pull secrets from the state's Vault / CSP KMS | yes |
| n8n (optional) | self-hosted n8n, if the state accepts its licence | messaging edge + approvals; otherwise `scheduler-cronjobs.yaml` + backend NotificationAdapter | yes |

> **n8n licence note:** n8n is distributed under its "Sustainable Use License" (fair-code), not an OSI open-source licence [unverified for government self-hosting terms; owner: Nestiq legal; due before the first state MoU]. Because n8n holds **no business logic** (D-16), a state can drop it and lose only the editable canvas. Schedules move to CronJobs and messages go through the backend's NotificationAdapter.

## 3. Values contract (keys `deploy.yml` and tenant files rely on)
```yaml
global:
  tenant: jk                      # E-31 Tenant id
  imageRegistry: harbor.<state-dc>.internal/margdarshak   # images mirrored + cosign-verified
  imageTag: <git sha>             # immutable; set by deploy.yml
  imagePullSecrets: [state-registry]
  dataResidency: IN               # chart refuses to render if any endpoint below is outside India (values.schema.json)
  timezoneDisplay: Asia/Kolkata

web:
  replicas: 2
  resources: { requests: { cpu: 250m, memory: 384Mi }, limits: { memory: 768Mi } }
  hpa: { min: 2, max: 20, targetCPU: 65 }
  env:
    NEXT_PUBLIC_SITE_DISCLAIMER: "<state-approved footer; non-affiliation text removed only if the state itself hosts and brands it>"

api:
  replicas: 3
  resources: { requests: { cpu: 500m, memory: 768Mi }, limits: { memory: 1536Mi } }
  hpa: { min: 3, max: 40, targetCPU: 60 }
  webConcurrency: 2
  adapters:                       # F-56; flip per tenant without a code change
    sarathi: deeplink             # mock | deeplink | real (NIC-granted API)
    digilocker: real              # needs the state's DigiLocker requester client id
    aadhaarOffline: real          # Secure QR / XML verification, no Aadhaar number stored
    bhashini: real
    payment: sarathi-redirect     # never collects government fees itself
    notification: mgov            # NIC/mGov SMS with DLT-registered templates, + WhatsApp if approved
    slot: real
  ai:
    provider: vertex              # Vertex AI, Indian region [unverified: asia-south1 model availability; owner AI lead]
    enabled: true                 # per-tenant kill switch; under-18 is always off (D-13)

scoreVerifier:
  replicas: 2
  resources: { requests: { cpu: 250m, memory: 256Mi }, limits: { memory: 512Mi } }

jobRunner:
  kind: temporal                  # render_workflows is Render-only
  worker: { replicas: 2, hpa: { min: 2, max: 30, queueDepthTarget: 50 } }

scheduler:
  mode: cronjobs                  # cronjobs | n8n
  timezone: Asia/Kolkata          # CronJob .spec.timeZone
  jobs:
    caseClock: "30 6 * * *"
    testEve: "0 19 * * *"
    analyticsDigest: "0 21 * * *"
    rulesFreshness: "0 9 * * 1"

postgres:
  externalSecretRef: md-db        # DATABASE_URL
  pool: { size: 10, maxOverflow: 5 }   # per api pod; PgBouncer in front if pods > 20
objectStore:
  endpoint: https://<india-region-s3-endpoint>
  buckets: { clips: md-<tenant>-clips, ingest: md-<tenant>-ingest, backups: md-<tenant>-backups }

observability:
  otlpEndpoint: http://otel-collector.observability:4318
  logRetentionDays: 180           # CERT-In Directions 28 Apr 2022, India jurisdiction
  ntpServers: [samay1.nic.in, samay2.nic.in]   # [unverified hostnames; owner Ops lead; confirm with NIC before go-live]

ingress:
  className: nginx
  host: margdarshak.<state-domain>
  tls: { secretName: md-tls }
  waf: { enabled: true, mode: block }   # ModSecurity + OWASP CRS, or the CSP WAF

security:
  podSecurity: restricted         # runAsNonRoot (uid 10001), readOnlyRootFilesystem, drop ALL caps, seccomp RuntimeDefault
  networkPolicies: true
```

## 4. Network policy allow-list (default deny)
| From | To | Port | Why |
|---|---|---|---|
| ingress-nginx | web | 3000 | citizen traffic |
| ingress-nginx | api | 8000 | API (`/v1/*`); `/internal/*` blocked at Ingress |
| web | api | 8000 | server-side rendering fetches |
| api | score-verifier | 8081 | session replay (API-35) |
| api, worker | postgres | 5432 | data |
| api, worker | valkey | 6379 | rate limits, idempotency |
| api, worker | object store | 443 | clips, exports |
| api, worker | temporal-frontend | 7233 | start/await jobs |
| api, worker | egress allow-list | 443 | Vertex AI (India region), DigiLocker `api.digitallocker.gov.in`, Bhashini, NIC/mGov SMS. Nothing else |
| all pods | otel-collector | 4317/4318 | telemetry |

## 5. Rollout rules (summary; full steps in DEPLOYMENT.md §4)
- `helm upgrade --install --atomic --wait --timeout 15m`: a failed rollout auto-rolls back.
- The migration Job runs as a pre-upgrade hook. Migrations follow **expand → migrate → contract** across two releases, so the old pods keep working during a rolling update.
- Deployments: `maxUnavailable: 0`, `maxSurge: 25%`, readiness probe `/v1/health?deep=false`, `preStop: sleep 10`, `terminationGracePeriodSeconds: 30`.
- One namespace per tenant (`margdarshak-<tenant>`), or one cluster per state for states that require it (07 §B3).
- Images are mirrored into the state registry and **cosign-verified** before deploy (deploy.yml).

## 6. Acceptance checklist before a state go-live
- [ ] `helm lint --strict` + `helm template | kubeconform -strict` pass in CI
- [ ] Trivy config scan of rendered manifests: no HIGH/CRITICAL
- [ ] All endpoints in values resolve to India-region hosts (`dataResidency: IN` check)
- [ ] Backups restore-tested (RUNBOOK.md §5), RPO ≤ 15 min, RTO ≤ 4 h
- [ ] 180-day log retention configured in Loki + object-store archive, in India
- [ ] Nodes NTP-synced to NIC/NPL; `/v1/health` reports `ntp_offset_ms < 1000`
- [ ] Safe-to-host certificate from NIC / STQC / a CERT-In-empanelled auditor (GIGW 3.0 §5.3.1 as summarised in war-room G5; say "audit-ready", never "certified" until issued)
