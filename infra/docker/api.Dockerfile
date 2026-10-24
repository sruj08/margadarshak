# syntax=docker/dockerfile:1.7
# Margdarshak API: Go 1.27 (chi v5, pgx v5 + sqlc, goose, ADK for Go + genai) in services/api
# Build context: repo root.   docker build -f infra/docker/api.Dockerfile -t margdarshak-api .
# Decision: ADR-0011 (Go backend; supersedes ADR-0002).
# The same image runs:
#   - the API:                     /app/api serve        (default CMD)
#   - goose migrations:            /app/api migrate up   (Render preDeployCommand / Helm pre-upgrade Job / compose `migrate`)
#   - the synthetic demo seed:     /app/seed --profile demo --synthetic
#   - production JobRunner worker: /app/api worker       (Temporal Go SDK; design only, INFRASTRUCTURE.md §4.5)
# Base images are pinned by tag here; CI (security.yml) re-pins them by digest at H0.
# The runtime is distroless static (no shell, no package manager, no curl), so the HEALTHCHECK
# calls the binary's own `healthcheck` subcommand (GET http://127.0.0.1:$PORT/v1/health, exit 0/1).

ARG GO_VERSION=1.27

############################
# 1. Build stage (static binary, CGO off)
############################
FROM golang:${GO_VERSION}-bookworm AS build
ARG VERSION=dev
ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOFLAGS=-mod=readonly
WORKDIR /src/services/api

# Module downloads first (best cache hit rate)
COPY services/api/go.mod services/api/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Then the source. Migrations are embedded in the binary (embed.FS). Generated code
# (oapi-codegen -> api/, sqlc -> internal/store/sqlcgen) is committed, so no codegen runs here.
COPY services/api ./
# -tags timetzdata embeds the IANA tz database, so Asia/Kolkata (EC-15: IST server time is the
# source of truth) resolves whatever the runtime image ships.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -tags timetzdata -ldflags="-s -w -X main.version=${VERSION}" -o /out/api ./cmd/api \
 && go build -trimpath -tags timetzdata -ldflags="-s -w -X main.version=${VERSION}" -o /out/seed ./cmd/seed

############################
# 2. Runtime stage (distroless static, non-root)
############################
# static-debian12 ships ca-certificates (TLS to Gemini, the Render API, R2) and tzdata;
# the timetzdata build tag above makes the binary independent of the latter anyway.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
LABEL org.opencontainers.image.title="margdarshak-api" \
      org.opencontainers.image.source="https://github.com/nestiq/margdarshak" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="Margdarshak API (Go: rules engine, journey, ADK agents, government adapter layer)"

ENV TZ=UTC \
    PORT=8000 \
    RULEPACK_DIR=/app/rulepacks \
    PROMPT_DIR=/app/ai/prompts \
    CONTENT_DIR=/app/content \
    MOCK_MEDIA_DIR=/tmp/margdarshak-media

WORKDIR /app
COPY --from=build --chown=10001:10001 /out/api /out/seed /app/
COPY --chown=10001:10001 rulepacks /app/rulepacks
COPY --chown=10001:10001 ai/prompts /app/ai/prompts
# P2: curriculum modules (API-30) and the playable-item index (API-34); no answer keys, no windows.
COPY --chown=10001:10001 content/curriculum /app/content/curriculum
COPY --chown=10001:10001 content/generated /app/content/generated

# Numeric UID/GID: CI checks Config.User == "10001:10001"; distroless needs no /etc/passwd entry.
USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/app/api", "healthcheck"]

# Graceful drain happens in Go: on SIGTERM the server stops accepting, http.Server.Shutdown waits
# up to 25 s for in-flight requests (below the 30 s Render / Kubernetes termination grace period,
# DEPLOYMENT.md §6), then closes the pgx pool and flushes OpenTelemetry.
ENTRYPOINT ["/app/api"]
CMD ["serve"]
