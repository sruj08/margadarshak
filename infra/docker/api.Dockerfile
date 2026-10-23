# syntax=docker/dockerfile:1.7
# Margdarshak API: Python 3.12 + FastAPI + Google ADK + adapters (services/api)
# Build context: repo root.   docker build -f infra/docker/api.Dockerfile -t margdarshak-api .
# Same image runs: the API (default CMD), Alembic migrations (Helm pre-upgrade Job / Render
# preDeployCommand) and, in production, the JobRunner worker (`python -m app.jobs.worker`).
# Base images are pinned by tag here; CI (security.yml) re-pins them by digest at H0.

ARG PYTHON_VERSION=3.12
ARG UV_VERSION=0.8

############################
# 1. uv binary
############################
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

############################
# 2. Dependency + build stage
############################
FROM python:${PYTHON_VERSION}-slim-bookworm AS build
COPY --from=uv /uv /uvx /usr/local/bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# Install locked third-party deps first (best cache hit rate)
COPY services/api/pyproject.toml services/api/uv.lock ./services/api/
RUN --mount=type=cache,target=/root/.cache/uv \
    cd services/api && uv sync --frozen --no-dev --no-install-project

# Then the project itself, the rule packs and the reviewed prompts
COPY services/api ./services/api
COPY rulepacks ./rulepacks
COPY ai/prompts ./ai/prompts
RUN --mount=type=cache,target=/root/.cache/uv \
    cd services/api && uv sync --frozen --no-dev

############################
# 3. Runtime stage (no compiler, no uv, non-root)
############################
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
LABEL org.opencontainers.image.title="margdarshak-api" \
      org.opencontainers.image.source="https://github.com/nestiq/margdarshak" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="Margdarshak API (FastAPI, ADK agents, government adapter layer)"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

ENV PATH="/app/services/api/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=UTC \
    PORT=8000 \
    WEB_CONCURRENCY=2 \
    RULEPACK_DIR=/app/rulepacks \
    PROMPT_DIR=/app/ai/prompts

WORKDIR /app
COPY --from=build --chown=app:app /app /app
WORKDIR /app/services/api
USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/v1/health" || exit 1

# uvicorn workers behind gunicorn give graceful SIGTERM drain (zero-downtime, DEPLOYMENT.md §6).
# --graceful-timeout must stay below Render's / Kubernetes' termination grace period (30 s).
CMD ["sh", "-c", "exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY} -b 0.0.0.0:${PORT} --graceful-timeout 25 --timeout 60 --keep-alive 5 --access-logfile - --forwarded-allow-ips='*'"]
