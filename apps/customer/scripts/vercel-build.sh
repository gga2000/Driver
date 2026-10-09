#!/usr/bin/env bash
# Vercel build for the customer web app (docs/deploy/vercel.md). Vercel runs it from apps/customer
# after installing the whole workspace. EXPO_PUBLIC_* values are baked into the bundle here, so the
# API URL must be set in the Vercel project (staging until launch).
set -euo pipefail
: "${EXPO_PUBLIC_API_URL:?set EXPO_PUBLIC_API_URL in the Vercel project (e.g. https://driver-api-staging.fly.dev/trpc)}"
# Share and invite links point at this site's own address unless the project sets one.
export EXPO_PUBLIC_SHARE_BASE_URL="${EXPO_PUBLIC_SHARE_BASE_URL:-https://${VERCEL_PROJECT_PRODUCTION_URL:-$VERCEL_URL}}"

cd ../..
pnpm turbo run build --filter=@driver/customer^...
pnpm --filter @driver/customer web:export
# Offline worker and the version name every page and /version.json carry (WEB_OFFLINE=off removes the
# worker from phones). Before prepare-web, which copies index.html into invite.html.
node apps/customer/scripts/web-offline.mjs apps/customer/dist-web
# Same checks as the Cloudflare build (API URL inlined, no 404.html) and writes invite.html for /i/*.
# Its _headers/_redirects files are Cloudflare syntax; on Vercel, vercel.json does that job.
node scripts/deploy/prepare-web.mjs apps/customer/dist-web --api-url "$EXPO_PUBLIC_API_URL"
