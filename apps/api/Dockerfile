# syntax=docker/dockerfile:1.7
# Driver API — production image (docs/deploy/hosting.md). Build from the REPOSITORY ROOT:
#
#   docker build -f apps/api/Dockerfile -t driver-api .
#   docker run --rm -p 3000:3000 -e DATABASE_URL=… -e REDIS_URL=… -e JWT_SECRET=… -e PHONE_HASH_PEPPER=… driver-api
#
# Stage 1 installs only what @driver/api needs, builds it and its workspace packages (contracts, db with
# `prisma generate`), then `pnpm deploy --prod` copies the API with production dependencies only into
# /out (workspace packages become real folders, dist included). Stage 2 is node:22-slim with /out, run
# as the unprivileged `node` user under tini. Migrations are NOT run here: the deploy workflow runs
# `prisma migrate deploy` over DIRECT_URL before it ships the image (docs/deploy/runbook.md).

ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
# openssl: Prisma's CLI detects it while generating. ca-certificates: engine/npm downloads.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
RUN npm install --global corepack@latest && corepack enable
WORKDIR /repo
COPY . .
# Root (turbo) + @driver/api and its workspace dependencies; no Expo or Next.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=driver --filter=@driver/api...
RUN pnpm turbo run build --filter=@driver/api...
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@driver/api deploy --prod --legacy /out \
 && rm -rf /out/src /out/Dockerfile /out/*.test.* /out/vitest.config.ts /out/eslint.config.js /out/tsconfig*.json

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_FORMAT=json
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 3000
# Liveness: the HTTP server answers health.ping (db / redis status are in the body, not the code, so a
# database outage does not make the host restart a healthy process in a loop).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/trpc/health.ping').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# SIGTERM → src/shutdown.ts: stop accepting, finish requests, drain the outbox, close workers, exit.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
