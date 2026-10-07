# CI

`.github/workflows/ci.yml` runs two jobs on every pull request and on every push to `main`; their names
are the required checks. **`ci`** (job id `verify`; plan `docs/plans/2026-10-02-milestone-2-platform-core.md`,
Step 9) is described first. **`e2e-postgres`**, the built API on Postgres, is
[further down](#e2e-postgres-the-built-api-on-postgres). Both run against real service
containers, the same images `docker-compose.yml` starts on a laptop:

| Service  | Image                    | URL in CI                                                     |
| -------- | ------------------------ | ------------------------------------------------------------- |
| Postgres | `postgis/postgis:16-3.4` | `postgresql://postgres:postgres@localhost:5432/driver`        |
| Shadow   | same server              | `postgresql://postgres:postgres@localhost:5432/driver_shadow` |
| Redis    | `redis:7-alpine`         | `redis://localhost:6379`                                      |

The job sets `JWT_SECRET`, `JWT_KID` and `PHONE_HASH_PEPPER` to dummy values and `SMS_PROVIDER=fake`. No
real secret is used anywhere in CI.

## What `ci` does, in order

| #   | Step              | Command                                                                                                                  | Fails when                                                        |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 0   | Migration times   | `node scripts/ci/check-migrations.mjs --base origin/<base>` (pull requests only)                                       | a new migration reuses a timestamp or is older than the base's newest ([below](#migration-timestamps)) |
| 1   | Install           | `pnpm install --frozen-lockfile` (pnpm via corepack, store cached on `pnpm-lock.yaml`)                                   | the lockfile is out of date                                       |
| 2   | Build packages    | `pnpm turbo run build --filter='./packages/*'`                                                                           | `prisma generate` or `tsc` fails in a package                     |
| 3   | Migrate           | `pnpm db:migrate` (`prisma migrate deploy`)                                                                              | a migration's SQL fails on a fresh PostGIS database               |
| 4   | Shadow DB         | `createdb driver_shadow` inside the Postgres container                                                                   | —                                                                 |
| 5   | Drift check       | `pnpm db:drift` (`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`) | `schema.prisma` and the migrations disagree (exit 2)              |
| 6   | Seed              | `pnpm db:seed`                                                                                                           | the seed throws (constraint, missing city, …)                     |
| 7   | Lint              | `pnpm lint`                                                                                                              | ESLint, including the module-boundary and vault-isolation rules   |
| 8   | Typecheck         | `pnpm typecheck`                                                                                                         | `tsc --noEmit` / `prisma validate`                                |
| 9   | Unit tests        | `pnpm test` (turbo, then `pnpm test:scripts`: the node tests in `scripts/ci/` and `scripts/`)                           | any unit test, including the locale key-parity test               |
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

Open the PR's **Checks** tab, choose **CI / ci**, and expand the first red step. Everything after it is
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

## e2e-postgres: the built API on Postgres

Everything above runs the services on in-memory repositories or repository by repository, so a foreign
key or an aborted transaction that only Postgres enforces never shows (CRIT2-04). This job does: it
migrates and seeds a fresh database (`SEED_ADMIN_PHONE=07700000099` adds an admin), builds the API,
starts `apps/api/dist/main.js` with `NODE_ENV=test`, `LOG_FORMAT=json`, Postgres and Redis (stdout →
`api.log`), and runs `node scripts/e2e/realdb-core.mjs`, a plain tRPC client that drives five flows, each
as new people with its own `x-request-id` prefix:

| Flow     | Prefix        | What it does                                                                                                                 |
| -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `signin` | `e2e-signin-` | `requestOtp` → `devLastOtp` (`SMS_PROVIDER=fake`) → `verifyOtp` → `me`                                                       |
| `food`   | `e2e-food-`   | مطعم خالد (seeded) open all day via its new owner, `orders.quote` → `orders.place` (cash)                                    |
| `sos`    | `e2e-sos-`    | emergency contact set, a taxi ride placed, `safety.sos`, `safety.status`                                                     |
| `ride`   | `e2e-ride-`   | `pricing.quote` → `orders.place` with the quote id, as the app sends it                                                      |
| `share`  | `e2e-share-`  | a ride, `tracking.createShareLink`, the admin forces it on a new driver (`dispatch.override`), he accepts, `tracking.shared` |

The API stamps the request id on every log line of a call (`apps/api/src/shared/request-context.ts`),
logs every failed Prisma query under the `Prisma` context (`shared/db/prisma-error-log.ts`), and tags
background work with `outbox-<row id>` or `job-<queue>-<name>-<job id>`. After the flows the script waits
for the outbox and the notification sends to make their first attempt, then collects, from the part
of `api.log` written during the run and from the database:

- `prisma`: a failed query; `error`: any `level: error` line (a tRPC 5xx, the outbox giving up);
  `subscr`: "subscriber … failed" (an outbox retry);
- `deliv`: `subscriber_deliveries` rows with `last_error` set or `attempts > 1`; `sends`:
  `notify_deliveries` rows retried (`reason` `retry:…`) or `failed`.

Each one is attributed to a flow by its request-id prefix or, for background work, by the flow's
subject ids (people, orders, trips, incidents) found in the line or in the outbox / notify row it
names. A flow **fails** on any attributed problem, an HTTP 5xx or an unexpected result.

### The known-failures ratchet

`scripts/e2e/known-failures.json` maps an issue id to the flow (or flows) it breaks today:

```json
{ "CRIT2-01": "sos", "CRIT2-02": "share", "LOAD-01": "ride", "LOAD-02": ["food", "share"] }
```

- a failing flow that is listed shows `known (<issues>)` and does not fail the job;
- a failing flow that is not listed shows `FAIL`;
- a listed flow that **passes** shows `FAIL: passes now — remove <issue> from known-failures.json`:
  the PR that fixes it removes the entry, so the list only shrinks;
- a problem no flow owns (the `(none)` row) fails the job, as does an entry naming an unknown flow.

### Reading it

The last lines of the step are a table, one row per flow (`checks`, `unexp`ected results, `5xx`, then
the problem counts above, then the verdict), then each failing flow's problems, then
`realdb-core: GREEN|RED`. The full `api.log` is the `e2e-postgres-api-log` artifact on failure; search it
for the request id shown in brackets (`[e2e-sos-<run>-8]`) to see that call's lines.

### Running it locally

With the services up and the variables exported as in "Running the same thing locally" above:

```bash
SEED_ADMIN_PHONE=07700000099 pnpm db:seed
pnpm turbo run build --filter='./packages/*' --filter=@driver/api
NODE_ENV=test LOG_FORMAT=json PORT=3999 SMS_PROVIDER=fake \
  OTP_RATE_LIMIT_PER_IP_HOUR=10000 OTP_RATE_LIMIT_PER_DEVICE_HOUR=10000 \
  node apps/api/dist/main.js >> api.log 2>&1 &
E2E_API_LOG=api.log node scripts/e2e/realdb-core.mjs     # FLOWS=sos,share to run some only
kill %1
```

Each run makes new people, so it can be repeated on the same database; problems about rows an earlier
run left behind (its retries) are counted as "from an earlier run" and not judged. Start the API with
`>>` (append), not `>`, if anything else writes to the same log.

## Merge safety: review-gate, freeze, migrations, locale files

### review-gate

A third required check, in its own workflow (`.github/workflows/review-gate.yml`, logic in
`scripts/ci/review-gate.mjs`). Every thread pushes as the same GitHub user, so GitHub's own "approving
review" can never come from a different person; this label stands in for it.

- A PR that changes money modules (`apps/api/src/modules/{ledger,orders,routes,topups,referrals}`),
  sign-in (`modules/identity`), any migration, `schema.prisma`, `modules/notify/providers` or
  `src/trpc/trpc.module.ts` (or the gate's own files) needs a label **`reviewed:<head sha>`**: the full
  commit id of the PR's current head, or its first 7 or more characters.
- **Only the reviewer thread sets that label**, after reviewing that exact commit; the author never
  does. A new push changes the head, so the old label stops matching and the check goes red until
  someone reviews again and adds a new label. Old `reviewed:` labels can stay; only the current head counts.
- Adding or removing a label re-runs the check, so there is no need to push again.
- A failure lists the files that need review and the exact label to add.

### Freeze

A PR labelled **`freeze`** may only gain commits whose message starts with `fix:`, `test:` or
`rebase:` (a scope like `fix(api):` is fine); merge commits ("Merge …") are allowed. The freeze time
comes from a label `freeze:<ISO time>` (for example `freeze:2026-10-07T20:27:00Z`), or else from
`scripts/ci/freeze.json`, keyed by PR number. A commit counts as "after the freeze" by its author
date, so rebasing older work does not trip it. A `freeze` label with no time anywhere fails.

### Migration timestamps

Before creating a migration, add a line to [`docs/launch/migrations.md`](launch/migrations.md) with a
timestamp later than every line there. Step 0 of `ci` then fails a pull request when a migration
folder it **adds** shares its 14-digit timestamp with any other migration, or is older than the newest
migration already on the base branch. Older migrations that already share a timestamp on `main` are
history and are not reported. The fix is always the same: rename the new folder to a later timestamp
and update its line in the ledger. On a push to `main` the step is skipped. Locally:
`node scripts/ci/check-migrations.mjs` (against `origin/main`, or `--base <ref>`).

### Locale files

`packages/i18n/src/locales/ar-IQ.json` and `en.json` are edited by many PRs at once, so git merges
them with a JSON-aware driver (`.gitattributes` → `scripts/i18n-merge.mjs`) instead of line by line:

- it keeps every key either side added, and drops a key one side deleted while the other left it alone;
- when both sides changed the same key to different values (or one edited what the other deleted) it
  stops, lists the keys, and leaves `<<<<<<<` markers around them to resolve by hand;
- it keeps the files' existing order. They are grouped by feature, **not sorted**, so the plan's
  "sorted" check is skipped. Our side's order is kept, and each key only the other side added goes
  right after the key it follows on that side, so a merge adds only the lines each side added.

Git uses the driver only where it is configured. The repo's SessionStart hook (`.claude/settings.json`)
sets it up in every Claude session; by hand:
`git config merge.i18n-json.driver "node scripts/i18n-merge.mjs %O %A %B"`. GitHub's merge button does
not run it, so rebase locally when locale files conflict. Key parity between the two files is checked by
the existing test in `packages/i18n/src/index.test.ts`, part of `pnpm test`.

## Deploy and backup workflows

Two more workflows live next to `ci.yml`; neither runs on pull requests:

- `.github/workflows/deploy.yml` — on a `v*` tag or by hand: `prisma migrate deploy` over `DIRECT_URL`
  (+ `driver_harden()` and the setup script's checklist), the API to Fly (image built by Fly's remote
  builder, blue-green), a health smoke test, then the Console and the web apps. Each part skips with a
  notice while its secrets are not configured.
- `.github/workflows/backup.yml` — nightly encrypted `pg_dump` of `public` + `identity_vault`.

Details, secrets and rollback: [deploy/runbook.md](deploy/runbook.md).
