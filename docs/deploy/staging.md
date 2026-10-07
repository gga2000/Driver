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
   compute **Small**. Follow [supabase.md](supabase.md) for it exactly as for production, with **new**
   secrets: its own database password and a **different** `PHONE_HASH_PEPPER`. Note the project ref
   (the `abcd…` part of its URL).
2. **Fly apps.** At the repository root:

   ```bash
   fly apps create driver-api-staging
   fly apps create driver-redis-staging

   fly volumes create redis_data --config deploy/fly/redis.toml --app driver-redis-staging --region fra --size 1 --yes
   REDIS_PASSWORD=$(openssl rand -hex 24)
   fly secrets set --config deploy/fly/redis.toml --app driver-redis-staging REDIS_PASSWORD="$REDIS_PASSWORD" --stage
   fly deploy . --config deploy/fly/redis.toml --app driver-redis-staging --dockerfile deploy/fly/redis/Dockerfile --remote-only

   fly secrets set --config deploy/fly/api.toml --app driver-api-staging --stage \
     DATABASE_URL='<staging transaction pooler, :6543>' \
     REDIS_URL="redis://default:${REDIS_PASSWORD}@driver-redis-staging.internal:6379?family=6" \
     JWT_SECRET="$(openssl rand -hex 32)" JWT_KID=k1 \
     PHONE_HASH_PEPPER='<the staging pepper>' UPLOADS_SECRET="$(openssl rand -hex 32)" \
     SMS_PROVIDER=fake
   ```

   Storage (`S3_*`) comes from the staging project's own Storage, as in [supabase.md](supabase.md) step 5.
3. **GitHub.** Settings → Environments → **New environment** `staging`. On it (not on the repository):
   - secrets `DIRECT_URL` (staging), `FLY_API_TOKEN` (`fly tokens create deploy -a driver-api-staging`),
     and the Cloudflare ones only if staging web apps are wanted;
   - variables `DEPLOY_ENVIRONMENT` = `staging`, `DATABASE_REF` = the staging project ref,
     `FLY_API_APP` = `driver-api-staging`, `API_PUBLIC_URL` = `https://driver-api-staging.fly.dev/trpc`.

   Keep production's deploy secrets on the `production` environment too, never at repository level:
   GitHub falls back to repository secrets when an environment lacks one. The deploy workflow's
   **staging guard** refuses to run when staging does not name itself, its apps do not end in
   `-staging`, or `DIRECT_URL` is not the database named by `DATABASE_REF`.

## Deploying to staging

Actions → **Deploy** → Run workflow → environment **staging** → target `all` (or `api`). It migrates
the staging database, deploys both process groups blue-green and runs the same smoke as production.
The first time, set the machine counts:

```bash
fly scale count app=2 worker=1 --config deploy/fly/api.toml --app driver-api-staging
```

## Between tests: stop it

Staging is billed by the hour. When no test is planned:

```bash
fly scale count app=0 worker=0 --config deploy/fly/api.toml --app driver-api-staging --yes
fly scale count 0 --config deploy/fly/redis.toml --app driver-redis-staging --yes
```

and pause the `driver-staging` project in Supabase. Bring it back with the same commands
(`app=2 worker=1`, Redis `1`) and **Restore** in Supabase. Data in the database and the Redis volume
survives.

## Rules

- **No real people.** Staging holds generated data only: no copy of production, no real phone numbers.
- **Own secrets.** No secret is shared with production (database, `JWT_SECRET`, `PHONE_HASH_PEPPER`,
  Redis password, storage keys). A leaked staging secret must not open production.
- **Same code, same sizes.** Deploy the commit you plan to release. Change sizes only in `api.toml`,
  so production and staging change together.
- **Load-test data.** The load test needs at least 45,000 orders, as six weeks of trade (plan 7.1);
  the seeding and k6 scripts live in `scripts/load/` (W4).
