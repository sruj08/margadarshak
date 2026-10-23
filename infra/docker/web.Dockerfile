# syntax=docker/dockerfile:1.7
# Margdarshak citizen PWA: Next.js 16 (App Router) with `output: "standalone"` (apps/web)
# Build context: repo root.   docker build -f infra/docker/web.Dockerfile -t margdarshak-web .
# Requires next.config.ts: { output: "standalone", outputFileTracingRoot: <repo root> }.
# NEXT_PUBLIC_* values are inlined at build time, so they are build args here.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.18.0

############################
# 1. Base with pnpm via corepack
############################
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

############################
# 2. Fetch deps from the lockfile only (cache-friendly)
############################
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile

############################
# 3. Build the web app and its workspace packages
############################
FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_DISCLAIMER
ARG NEXT_PUBLIC_BUILD_SHA=dev
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_SITE_DISCLAIMER=${NEXT_PUBLIC_SITE_DISCLAIMER} \
    NEXT_PUBLIC_BUILD_SHA=${NEXT_PUBLIC_BUILD_SHA}
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter "@margdarshak/web..." \
 && pnpm --filter "@margdarshak/web..." build

############################
# 4. Runtime: only the standalone server + static assets, non-root
############################
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="margdarshak-web" \
      org.opencontainers.image.source="https://github.com/nestiq/margdarshak" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="Margdarshak citizen PWA (Next.js 16)"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=UTC
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
# standalone output mirrors the monorepo layout: server.js lives under apps/web/
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER 10001:10001
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
