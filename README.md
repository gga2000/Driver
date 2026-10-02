# Driver (درايفر)

منصة توصيل وتنقّل محلية تنطلق من العزيزية (واسط): توصيل أكل، تسوّق "اشتري لي"، تكسي وتكتك داخل المدينة، سفر بين المدن مع اختيار المقعد، وخطوط اشتراك دورية.

**العربية (اللهجة العراقية) هي اللغة الأولى لكل شاشة، والاتجاه من اليمين لليسار هو الافتراضي.** الإنكليزية ترجمة ثانوية. كل النصوص في `packages/i18n`، وكل الألوان والمسافات والخطوط في `packages/design-tokens`.

The approved design is in [`docs/specs/2026-10-02-platform-core-design.md`](docs/specs/2026-10-02-platform-core-design.md); architecture rules are in [`docs/architecture.md`](docs/architecture.md). This repository is **Milestone 1**: a monorepo that installs, type-checks, boots the API, and passes a first test suite with real pricing, ledger and dispatch cores.

## Layout

| Path | What |
|---|---|
| `apps/api` | NestJS 10 modular monolith exposing tRPC v11 (`/trpc`). 15 modules under `src/modules`. |
| `apps/console` | Next.js 15 "Driver Console" (RTL) — health + live quote breakdown. |
| `apps/customer`, `apps/partner`, `apps/merchant` | Expo SDK 52 + expo-router apps, RTL forced, one screen each fetching a quote. |
| `packages/contracts` | zod schemas, TS types, the tRPC `AppRouter` and wire transformer. Root export is client-safe; `@driver/contracts/router` is server-only. |
| `packages/db` | Prisma 7 schema (Postgres + PostGIS) for the spec's domain model. |
| `packages/design-tokens` | Colors, spacing (×4), radii, Arabic-first type scale, motion. |
| `packages/i18n` | `ar-IQ.json`, `en.json` and a tiny `t()` helper. |

## Run

Requires Node 22 (`.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm typecheck          # every package and app
pnpm test               # vitest across api, contracts, tokens, i18n
pnpm lint               # includes the module-boundary rule in apps/api
pnpm build              # contracts, tokens, i18n, api, console (next build)

pnpm dev:api            # http://localhost:3000/trpc  (PORT overrides)
pnpm dev:console        # http://localhost:3100       (NEXT_PUBLIC_API_URL overrides)
pnpm --filter @driver/customer start   # Expo dev server; same for partner / merchant
```

Try the API once it is up:

```sh
curl 'http://localhost:3000/trpc/health.ping'
curl -G 'http://localhost:3000/trpc/pricing.quote' --data-urlencode \
  'input={"json":{"cityId":"aziziyah","vertical":"intercity","stops":[{"zoneId":"center","type":"pickup"},{"zoneId":"kut","type":"dropoff"}],"options":{"frontSeat":true},"at":"2026-10-02T09:00:00Z"}}'
```

Prisma in an offline environment (no engine download, no database):

```sh
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 PRISMA_SCHEMA_ENGINE_BINARY=/bin/true \
  pnpm --filter @driver/db validate
```

`prisma generate` runs on `pnpm build` and writes the client to `packages/db/src/generated` (git-ignored). Migrations are deliberately not run in Milestone 1.

## Conventions

- Money is integer IQD, rounded to the nearest 250 by default, never floats.
- Every price is a sum of named components with Arabic labels; `distance` and `time` are always computed as *shadow* components and hidden until a city enables them.
- The ledger is append-only; balances are computed from events and the whole book sums to zero.
- A module exposes only what its `index.ts` exports. ESLint fails the build on any import of another module's internals.
