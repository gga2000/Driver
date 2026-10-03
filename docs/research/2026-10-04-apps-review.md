# Three apps review — customer, partner, merchant (2026-10-04)

Senior product + QA pass over `apps/customer`, `apps/partner`, `apps/merchant`, driven end to end
against ONE in-memory API (`scripts/e2e/three-apps.mjs`, port 3340) instead of each app's own
`demo-api.mjs`. Goal: find what breaks for a real user, especially cross-app flows that only work
because a demo script injects data.

Status: in progress — findings are added as they are confirmed.

## How to reproduce

```sh
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 PRISMA_SCHEMA_ENGINE_BINARY=/bin/true
pnpm install && pnpm turbo run build --filter='./packages/*' && pnpm --filter @driver/api build
node scripts/e2e/three-apps.mjs            # API-only walk of the three flows, asserts every app's reads
```

## Findings

Severity: **S1** a real user cannot finish the flow · **S2** wrong/misleading data or a broken
screen state · **S3** UX/copy/accessibility polish.

| # | Sev | App | Screen / area | What | Fixed? / how |
|---|-----|-----|---------------|------|--------------|
