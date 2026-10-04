# syntax=docker/dockerfile:1.7
# Driver Console — production image (docs/deploy/console.md). Build from the REPOSITORY ROOT:
#
#   docker build -f apps/console/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/trpc -t driver-console .
#
# NEXT_PUBLIC_API_URL is read at BUILD time (inlined into the browser bundle): rebuild to change it.
# `next build` with NEXT_OUTPUT=standalone emits a self-contained server; the runtime stage is that
# server, its static files and node — no pnpm, no node_modules beyond what Next traced.

ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG NEXT_PUBLIC_API_URL
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "--build-arg NEXT_PUBLIC_API_URL=https://<api host>/trpc is required" && exit 1)
RUN npm install --global corepack@latest && corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=driver --filter=@driver/console...
RUN pnpm turbo run build --filter=@driver/console...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/apps/console/.next/standalone ./
COPY --from=build /repo/apps/console/.next/static ./apps/console/.next/static
USER node
EXPOSE 3100
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/console/server.js"]
