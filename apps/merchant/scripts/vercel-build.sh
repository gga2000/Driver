#!/usr/bin/env bash
# Vercel build for the merchant web app (docs/deploy/vercel.md). Runs from apps/merchant.
set -euo pipefail
: "${EXPO_PUBLIC_API_URL:?set EXPO_PUBLIC_API_URL in the Vercel project (e.g. https://driver-api-staging.fly.dev/trpc)}"
cd ../..
pnpm turbo run build --filter=@driver/merchant^...
pnpm --filter @driver/merchant web:export
node scripts/deploy/prepare-web.mjs apps/merchant/dist-web --api-url "$EXPO_PUBLIC_API_URL"
