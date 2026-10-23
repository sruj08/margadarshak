# syntax=docker/dockerfile:1.7
# Margdarshak score verifier: Node 22 service that replays game sessions with
# @margdarshak/game-core (pure TS, deterministic) and returns the authoritative SessionResult.
# Private service only: never exposed to the internet (Render pserv / ClusterIP in Kubernetes).
# Build context: repo root.  docker build -f infra/docker/score-verifier.Dockerfile -t margdarshak-score-verifier .

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY packages/game-core ./packages/game-core
COPY services/score-verifier ./services/score-verifier
COPY tsconfig*.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter "@margdarshak/score-verifier..." \
 && pnpm --filter "@margdarshak/score-verifier..." build \
 # produce a self-contained, prod-only deployment folder (pnpm deploy)
 && pnpm --filter "@margdarshak/score-verifier" deploy --prod /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="margdarshak-score-verifier" \
      org.opencontainers.image.source="https://github.com/nestiq/margdarshak" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="Server-side deterministic replay of game sessions (anti-cheat)"
ENV NODE_ENV=production PORT=8081 TZ=UTC \
    # determinism guard: game-core must not read wall-clock or Math.random at replay time
    GAME_CORE_STRICT_DETERMINISM=1
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build --chown=app:app /out ./
USER 10001:10001
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server.js"]
