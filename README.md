# Driver (درايفر)

منصة توصيل وتنقّل محلية تنطلق من العزيزية (واسط): توصيل أكل، تسوّق "اشتري لي"، تكسي وتكتك داخل المدينة، سفر بين المدن مع اختيار المقعد، وخطوط اشتراك دورية.

**العربية (اللهجة العراقية) هي اللغة الأولى لكل شاشة، والاتجاه من اليمين لليسار هو الافتراضي.** الإنكليزية ترجمة ثانوية. كل النصوص في `packages/i18n`، وكل الألوان والمسافات والخطوط في `packages/design-tokens`.

The approved design is in [`docs/specs/2026-10-02-platform-core-design.md`](docs/specs/2026-10-02-platform-core-design.md); architecture rules are in [`docs/architecture.md`](docs/architecture.md); going live (Supabase, Fly, Cloudflare Pages, EAS, deploys, backups, runbook) is in [`docs/deploy/`](docs/deploy/runbook.md). Milestone 1 delivered the monorepo with in-memory modules; **Milestone 2** (in progress, plan in [`docs/plans/2026-10-02-milestone-2-platform-core.md`](docs/plans/2026-10-02-milestone-2-platform-core.md)) adds Postgres + Redis, the full domain model and the state machines.

## Layout

| Path | What |
|---|---|
| `apps/api` | NestJS 10 modular monolith exposing tRPC v11 (`/trpc`). 15 modules under `src/modules`. |
| `apps/console` | Next.js 15 "Driver Console" (RTL) — health + live quote breakdown. |
| `apps/customer`, `apps/partner`, `apps/merchant` | Expo SDK 52 + expo-router apps, RTL forced, one screen each fetching a quote. |
| `packages/contracts` | zod schemas, TS types, the tRPC `AppRouter` and wire transformer. Root export is client-safe; `@driver/contracts/router` is server-only. |
| `packages/db` | Prisma 7 schema (Postgres + PostGIS, `public` + `identity_vault` schemas), migration, seed. |
| `packages/design-tokens` | Colors, spacing (×4), radii, Arabic-first type scale, motion. |
| `packages/i18n` | `ar-IQ.json`, `en.json` and a tiny `t()` helper. |

## See the apps (no database needed)

```sh
pnpm install
pnpm studio            # all apps with live reload on demo data → http://localhost:4000
pnpm studio customer   # or just some: customer | partner | merchant | console
```

First-time Mac setup in plain steps: [`docs/dev/mac-setup.md`](docs/dev/mac-setup.md). Working with
Claude Code: [`CLAUDE.md`](CLAUDE.md).

## Run

Requires Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`) and Docker for the local database.

```sh
pnpm install
cp .env.example .env    # DATABASE_URL, REDIS_URL, JWT_SECRET, SMS_PROVIDER=fake, PORT

pnpm db:up              # Postgres 16 + PostGIS and Redis 7 via docker compose
pnpm db:migrate         # prisma migrate deploy (public + identity_vault schemas, GIST indexes, ledger trigger)
pnpm db:seed            # 3 cities, 34 Aziziyah zones, garages + meeting points, taxonomy, demo restaurant, dispatcher
pnpm db:reset           # drop everything and re-apply migrations (then db:seed again)
pnpm db:studio          # Prisma Studio: browse the tables

pnpm typecheck          # every package and app
pnpm test               # vitest across db, api, contracts, tokens, i18n (DB integration tests skip without DATABASE_URL)
pnpm lint               # includes the module-boundary rule in apps/api
pnpm build              # contracts, db, tokens, i18n, api, console (next build)

pnpm dev:api            # http://localhost:3000/trpc  (PORT overrides); health.ping reports db/redis status
pnpm dev:console        # http://localhost:3100       (NEXT_PUBLIC_API_URL overrides)
pnpm sim --orders 200 --drivers 10 --seed 1   # in-memory simulator; exits 1 on a ledger violation
pnpm --filter @driver/customer start   # Expo dev server; same for partner / merchant
```

Try the API once it is up:

```sh
curl 'http://localhost:3000/trpc/health.ping'
curl -G 'http://localhost:3000/trpc/pricing.quote' --data-urlencode \
  'input={"json":{"cityId":"aziziyah","vertical":"food","stops":[{"zoneId":"centre","type":"pickup"},{"zoneId":"khamas","type":"dropoff"}],"at":"2026-10-02T09:00:00Z"}}'
# → delivery fee 1,500 (centre → الخماس is a far-tier pair) + service fee 500
```

Prisma in an offline environment (no engine download, no database):

```sh
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 PRISMA_SCHEMA_ENGINE_BINARY=/bin/true \
  pnpm --filter @driver/db validate
```

`prisma generate` runs on `pnpm build` and writes the client to `packages/db/src/generated` (git-ignored). The migration under `packages/db/prisma/migrations` is hand-maintained (the sandbox has no schema engine); `packages/db/scripts/schema-to-sql.ts` regenerates its DDL part from the schema.

## Conventions

- Money is integer IQD, rounded to the nearest 250 by default, never floats.
- People are pseudonymous: phone numbers, names and documents live only in the `identity_vault` schema (named `vault` until 2026-10-04; Supabase reserves that name), reachable through the identity module.
- Delivery is priced by zone tier pair (centre/near↔near 500 · near↔mid 1,000 · any↔far 1,500 · edge 2,000); exact zone pairs override.
- Every price is a sum of named components with Arabic labels; `distance` and `time` are always computed as *shadow* components and hidden until a city enables them.
- The ledger is append-only; balances are computed from events and the whole book sums to zero.
- A module exposes only what its `index.ts` exports. ESLint fails the build on any import of another module's internals.
