# Staging: production's twin for load tests and rehearsals

Staging is a second, separate copy of the server side at **exactly the production sizes**
([hosting.md](hosting.md#web-and-worker-machines-launch-sizes)). It exists for the launch load tests
(plan 7.1: first run D-28, retest D-14), the game day (plan 7.7) and rehearsing deploys and rollbacks.
Customers never see it. It never holds real people's data.

| Part | Production | Staging |
| --- | --- | --- |
| API (Fly, `fra`) | `driver-api` | `driver-api-staging`, same `deploy/fly/api.toml` (`--app`) |
| Redis (Fly, `fra`) | `driver-redis` | `driver-redis-staging`, same `deploy/fly/redis.toml` (`--app`) |
| Database (Supabase, Frankfurt) | `driver` project, Small | `driver-staging` project, Small |
| Console (Fly) | `driver-console` | `driver-console-staging` (optional) |
| GitHub environment | `production` | `staging` |
| SMS | real provider | `SMS_PROVIDER=fake` (codes in the log) |

Because staging deploys the same toml files with another app name, it cannot drift from production's
sizes, process groups, limits or checks: a change to `api.toml` reaches both.

## One-time setup (about 30 minutes)

1. **Database.** In Supabase, create a second project `driver-staging` in Frankfurt (`eu-central-1`),
   compute **Small** before a load test. Follow [supabase.md](supabase.md) steps 1–4 with its **own**
   database password; step 3 below replaces steps 6–7 (and makes staging's own `PHONE_HASH_PEPPER`).
   Note the project ref (the `abcd…` part of its URL).
2. **GitHub.** Settings → Environments → **New environment** `staging`. On it (not on the repository):
   - secrets `DIRECT_URL` (the staging **session pooler**, port 5432, password in place of
     `[YOUR-PASSWORD]` with the brackets removed) and `FLY_API_TOKEN` (fly.io → Tokens → **Org Deploy
     Token** for the organisation; an org token, because the apps don't exist yet);
   - variables `DEPLOY_ENVIRONMENT` = `staging`, `DATABASE_REF` = the staging project ref,
     `FLY_API_APP` = `driver-api-staging`, `API_PUBLIC_URL` = `https://driver-api-staging.fly.dev/trpc`;
     optional `FLY_REDIS_APP` (default `driver-redis-staging`), `FLY_ORG` (default `personal`),
     `STAGING_ADMIN_PHONE` (default `07700000099`, a made-up number: codes go to the API log);
   - **Deployment branches and tags** → **Selected branches and tags** → `main`, so only reviewed code
     can reach the staging secrets.
3. **Actions → Staging setup → Run workflow** (`.github/workflows/staging-setup.yml`). Nobody runs
   `flyctl` or handles a secret: it creates the two Fly apps and Redis's volume, generates the API's
   secrets on the runner and hands them straight to Fly (`JWT_SECRET`, `PHONE_HASH_PEPPER`,
   `UPLOADS_SECRET`, `SHARE_LINK_SECRET`, `SAFETY_LINK_SECRET`, the Redis password; never printed or stored in GitHub), sets `DATABASE_URL` (the
   same pooler on port 6543), `SMS_PROVIDER=fake` and `DATABASE_CA_CERT` (Supabase's public root CA,
   `deploy/supabase/prod-ca-2021.crt`, unless a `DATABASE_CA_CERT` secret is set), deploys Redis, then
   migrates, hardens, seeds (production profile + the staging admin) and verifies the database. It is
   safe to run again: what exists is kept. Storage (`S3_*`) is not set up yet.

   Keep production's deploy secrets on the `production` environment too, never at repository level:
   GitHub falls back to repository secrets when an environment lacks one. The deploy workflow's
   **staging guard** refuses to run when staging does not name itself, its apps do not end in
   `-staging`, or `DIRECT_URL` is not the database named by `DATABASE_REF`.

## Deploying to staging

Actions → **Deploy** → Run workflow → environment **staging** → target `all` (or `api`). It migrates
the staging database, deploys both process groups blue-green and runs the same smoke as production.
A first deploy starts production's layout (2 web + 1 worker). Then pick how much runs with
**Actions → Staging machines** (below).

## How much runs: Actions → Staging machines

Staging is billed by the hour, so nobody runs `fly` by hand: **Actions → Staging machines → Run
workflow** (`.github/workflows/staging-machines.yml`) and pick a mode.

| Mode | Runs | For |
| --- | --- | --- |
| `everyday` | 1 web + 1 worker + Redis | people trying the apps and the web version |
| `launch` | 2 web + 1 worker + Redis (production's layout) | the load test, the game day |
| `off` | nothing (machines stopped; disks kept) | no test planned |

Sizes always come from `api.toml`; the mode only changes how many machines run. In `off`, a browser
or phone calling the API wakes one web machine by itself (Fly auto-start), but background jobs wait
until the next `everyday` or `launch`. The database, Redis's data and every secret survive all modes.
Before a load test also set the Supabase project to **Small**; when staging stays off for weeks,
pause the project in Supabase (and **Restore** it before switching back on).

## Which web sites may call staging (CORS)

`CORS_ORIGINS` on the staging API lists the exact web origins allowed to call it from a browser.
Staging setup sets it on every run: the GitHub variable `CORS_ORIGINS` on the `staging` environment,
default `https://driver-customer-iota.vercel.app` (the customer web version,
[vercel.md](vercel.md)), plus `https://<FLY_CONSOLE_APP>.fly.dev` when a staging Console exists.
Exact origins only: Vercel preview links are not on the list. After changing it, run Staging setup,
then Deploy → staging (the setting reaches the API with the deploy). Phones send no origin and are
never affected.

## Rules

- **No real people.** Staging holds generated data only: no copy of production, no real phone numbers.
- **Own secrets.** No secret is shared with production (database, `JWT_SECRET`, `PHONE_HASH_PEPPER`,
  Redis password, storage keys). A leaked staging secret must not open production.
- **Same code, same sizes.** Deploy the commit you plan to release. Change sizes only in `api.toml`,
  so production and staging change together.
- **Load-test data.** The load test needs at least 45,000 orders, as six weeks of trade (plan 7.1);
  the seeding and k6 scripts live in `scripts/load/` (W4).
