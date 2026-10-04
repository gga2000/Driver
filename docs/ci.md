# CI

`.github/workflows/ci.yml` runs one job, **verify**, on every pull request and on every push to `main`
(plan `docs/plans/2026-10-02-milestone-2-platform-core.md`, Step 9). It runs against real service
containers, the same images `docker-compose.yml` starts on a laptop:

| Service  | Image                    | URL in CI                                                     |
| -------- | ------------------------ | ------------------------------------------------------------- |
| Postgres | `postgis/postgis:16-3.4` | `postgresql://postgres:postgres@localhost:5432/driver`        |
| Shadow   | same server              | `postgresql://postgres:postgres@localhost:5432/driver_shadow` |
| Redis    | `redis:7-alpine`         | `redis://localhost:6379`                                      |

The job sets `JWT_SECRET`, `JWT_KID` and `PHONE_HASH_PEPPER` to dummy values and `SMS_PROVIDER=fake`. No
real secret is used anywhere in CI.

## What the job does, in order

| #   | Step              | Command                                                                                                                  | Fails when                                                        |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | Install           | `pnpm install --frozen-lockfile` (pnpm via corepack, store cached on `pnpm-lock.yaml`)                                   | the lockfile is out of date                                       |
| 2   | Build packages    | `pnpm turbo run build --filter='./packages/*'`                                                                           | `prisma generate` or `tsc` fails in a package                     |
| 3   | Migrate           | `pnpm db:migrate` (`prisma migrate deploy`)                                                                              | a migration's SQL fails on a fresh PostGIS database               |
| 4   | Shadow DB         | `createdb driver_shadow` inside the Postgres container                                                                   | —                                                                 |
| 5   | Drift check       | `pnpm db:drift` (`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`) | `schema.prisma` and the migrations disagree (exit 2)              |
| 6   | Seed              | `pnpm db:seed`                                                                                                           | the seed throws (constraint, missing city, …)                     |
| 7   | Lint              | `pnpm lint`                                                                                                              | ESLint, including the module-boundary and vault-isolation rules   |
| 8   | Typecheck         | `pnpm typecheck`                                                                                                         | `tsc --noEmit` / `prisma validate`                                |
| 9   | Unit tests        | `pnpm test`                                                                                                              | any unit test                                                     |
| 10  | Integration tests | `pnpm test:integration`                                                                                                  | any integration test, **or** `DATABASE_URL` / `REDIS_URL` missing |
| 11  | Build apps        | `pnpm turbo run build --filter=@driver/api --filter=@driver/console`                                                     | API `tsc` or `next build`                                         |
| 12  | API smoke         | starts `apps/api/dist/main.js` on :3999, curls `/trpc/health.ping`                                                       | no answer in 20 s, or `db` / `redis` not `"ok"`                   |
| 13  | Simulate          | `pnpm sim --orders 2000 --seed 1 --ci`                                                                                   | the simulator exits non-zero (an invariant violation)             |
| 14  | Artifacts         | `simulation-report` (always), `ci-logs` (`api.log`, `simulation.log`, on failure)                                        | —                                                                 |

Prisma runs with its **real engines** in CI. The `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` stub is not set,
because it would turn `migrate deploy` and `migrate diff` into no-ops that always pass.

### Unit vs integration

`apps/api` and `packages/db` each have two Vitest projects (see their `vitest.config.ts`):

- **unit** (`pnpm test`, the `test` turbo task, cached). Every `*.test.ts` except `*.integration.test.ts`
  and `*.redis.test.ts`. It is hermetic: `DATABASE_URL` and `REDIS_URL` are blanked inside the test
  workers, so a unit run never touches a database, whatever your shell or the CI job has set.
- **integration** (`pnpm test:integration`, the `test:integration` turbo task, never cached).
  `*.integration.test.ts`, `*.redis.test.ts` and the Redis block of `dispatch/geo-index.test.ts`. Files run
  one at a time, because they share one database and one Redis. Without the services, every suite skips
  cleanly and the run passes with a warning. With `CI` set, `vitest.integration-setup.ts` fails the run
  instead, so CI can never go green on skipped integration tests.

A new test that needs Postgres or Redis goes in a file named `*.integration.test.ts`, gated with
`describe.skipIf(!process.env['DATABASE_URL'])`.

### Simulator gate

`pnpm sim --orders 2000 --seed 1 --ci` is the Step 7 Aziziyah simulator. It boots the real API
(`AppModule`) **in memory** on a fake clock — it drops `DATABASE_URL` and `REDIS_URL` itself, so the CI
services are not touched — and runs one simulated day (10:00–24:00 Baghdad, lunch and dinner peaks)
through the real services: 60 drivers (10 bikes, 25 tuktuks, 25 cars; `--drivers` scales the mix), 10
restaurants (`--restaurants`), customers on the 34 seed zones; 70 % food (auto-assign), 25 % city rides
(broadcast), 5 % cancelled at a random stage; couriers who go offline and replay their taps, kitchens
that reject or partially accept, a dispatcher who works the red cards. About a minute on a laptop.

It prints an Arabic + English summary and writes `apps/api/simulation-report.json` (`--report <path>`
elsewhere): counts by terminal state, p50/p95 time-to-accept and time-to-deliver, the revenue split,
every named invariant with how many things it checked, and `violations[]` with first examples. Any
violation exits 1 and prints `violation: <name>`. The same `--seed` reproduces the run exactly.
`pnpm sim --orders 30 --inject-fault ledger_money_balanced` shows the gate failing on purpose (any
invariant name works).

The Console's System page (`system.simulator.start/status/stop`, admin and dispatcher) runs the same
actors live against the running API at 60× (or `speed`), with real presence, so the map shows the
drivers moving.

## Reading a failure

Open the PR's **Checks** tab, choose **CI / verify**, and expand the first red step. Everything after it is
skipped.

- **Install.** If the error mentions `ERR_PNPM_OUTDATED_LOCKFILE`, run `pnpm install` and commit
  `pnpm-lock.yaml`.
- **Build packages.** A Prisma schema error prints file and line. A `tsc` error in `packages/*` comes
  next.
- **Migrate.** The failing migration's directory name and the Postgres error are printed. The database is
  fresh in every run, so the SQL itself is wrong or depends on an order it does not get. Two folders with
  the same timestamp apply in alphabetical order.
- **Drift check.** Exit code 2 and a summary such as `[+] Added tables` or `[*] Changed the "orders"
table` mean the migrations do not reproduce `schema.prisma`. Either a schema change has no migration,
  or a hand-edited migration differs from what Prisma expects. Write the missing migration and do not edit
  applied ones. To see the SQL Prisma would add, run `pnpm --filter @driver/db exec prisma migrate diff
--from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`.
- **Seed.** Usually a seed upsert that no longer matches a renamed or required column.
- **Lint / Typecheck / Unit tests.** These are the same commands you run locally. The failing file and test
  name are in the log.
- **Integration tests.** `integration tests: DATABASE_URL, REDIS_URL not set` means a service container
  did not start, so check "Initialize containers" at the top of the job. Otherwise read the failing suite.
  These suites run on the migrated and seeded database from steps 3–6.
- **API smoke.** The step prints the `health.ping` JSON and then `api.log`. `"db":"unavailable"` or
  `"redis":"unavailable"` means the built API could not reach that service. The cause is a boot or
  configuration error, and the reason is in `api.log`, which is also in the `ci-logs` artifact.
- **Simulate.** The log names the violation, for example `violation: ledger_money_balanced`, with its
  first examples. Download the `simulation-report` artifact (its `violations[]`) or `ci-logs` →
  `simulation.log` and reproduce it locally with the same `--seed`.

## Running the same thing locally

Prerequisites are Docker with Compose ≥ 2.23.1, Node 22, and `corepack enable`. Prisma 7 and the seed
read connection strings only from the environment, not from `.env`, so export them first:

```bash
cp .env.example .env            # once
set -a; . ./.env; set +a        # export DATABASE_URL, REDIS_URL, JWT_SECRET, … into this shell
export SHADOW_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/driver_shadow
export CI=1                     # optional: make test:integration fail instead of skip if a service is down

pnpm install --frozen-lockfile
pnpm db:up                      # postgres (PostGIS) + redis, waits for health checks
pnpm turbo run build --filter='./packages/*'
pnpm db:migrate
pnpm db:drift
pnpm db:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
pnpm turbo run build --filter=@driver/api --filter=@driver/console
PORT=3999 node apps/api/dist/main.js &  sleep 3
curl -s localhost:3999/trpc/health.ping | jq '.result.data.json | {db, redis}'   # both "ok"
kill %1
pnpm sim --orders 2000 --seed 1 --ci
```

On a fresh volume, `docker-compose.yml` creates `driver_shadow` from an init script. For a volume created
before that script existed, create it once:
`docker compose exec postgres createdb -U postgres driver_shadow`.

To start from a clean database, run `pnpm db:down && docker volume rm driver_driver-pg` (the volume name
is prefixed with the Compose project, which is usually the directory name). Then run the steps above
again.

### Offline escape hatch (no Prisma engine download)

Some sandboxes and laptops cannot reach `binaries.prisma.sh`, and there `prisma generate` and
`prisma validate` fail on the engine checksum. For build, lint, typecheck and unit tests only, set:

```bash
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
export PRISMA_SCHEMA_ENGINE_BINARY=/bin/true
```

With these set, `pnpm db:migrate` and `pnpm db:drift` still exit 0 but **do nothing**, because the schema
engine is `/bin/true`. Never set them in CI, and never trust a migration or drift result produced with
them.

## Deploy and backup workflows

Two more workflows live next to `ci.yml`; neither runs on pull requests:

- `.github/workflows/deploy.yml` — on a `v*` tag or by hand: `prisma migrate deploy` over `DIRECT_URL`
  (+ `driver_harden()` and the setup script's checklist), the API to Fly (image built by Fly's remote
  builder, blue-green), a health smoke test, then the Console and the web apps. Each part skips with a
  notice while its secrets are not configured.
- `.github/workflows/backup.yml` — nightly encrypted `pg_dump` of `public` + `identity_vault`.

Details, secrets and rollback: [deploy/runbook.md](deploy/runbook.md).
