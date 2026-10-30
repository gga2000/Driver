#!/usr/bin/env bash
# Vercel build for the partner (courier/driver) web app, for testing on staging (docs/deploy/vercel.md).
# Runs from apps/partner. Background location and push need the phone app; the web version is for a look.
set -euo pipefail
: "${EXPO_PUBLIC_API_URL:?set EXPO_PUBLIC_API_URL in the Vercel project (e.g. https://driver-api-staging.fly.dev/trpc)}"
cd ../..
pnpm turbo run build --filter=@driver/partner^...
pnpm --filter @driver/partner web:export
node scripts/deploy/prepare-web.mjs apps/partner/dist-web --api-url "$EXPO_PUBLIC_API_URL"
