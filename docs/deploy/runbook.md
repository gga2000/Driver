# Runbook: deploy, roll back, rotate, restore, incidents

For whoever is on call (at launch: Ali). Short steps; each links to the page with the detail. Setup of
each piece: [supabase.md](supabase.md), [hosting.md](hosting.md), [web.md](web.md),
[console.md](console.md), [mobile.md](mobile.md), [staging.md](staging.md).

## Environments

| | **dev** (laptop) | **staging** ([staging.md](staging.md)) | **prod** |
| --- | --- | --- | --- |
| Database | Docker `postgis/postgis:16-3.4` (`pnpm db:up`) | a second Supabase project `driver-staging`, Small, Frankfurt | Supabase Pro, Frankfurt (`driver-prod`) |
| `DATABASE_URL` / `DIRECT_URL` | one local URL | its own pooler strings | transaction pooler :6543 / session pooler :5432 |
| Redis | Docker `redis:7-alpine` | `driver-redis-staging` on Fly (same toml, `--app`) | `driver-redis` on Fly (volume, AOF) |
| API | `pnpm dev:api` (:3000) | Fly app `driver-api-staging` (same toml and sizes, `--app`) | Fly app `driver-api`, fra |
| Seed | `pnpm db:seed` (demo restaurant + demo dispatcher +9647700000001) | setup script with `--dev-seed`; load-test data from `scripts/load/` | setup script, production profile + your admin phone |
| SMS | `fake` (codes in the terminal) | `fake` | `fake` until the provider exists, then `gateway` |
| Photos | memory / `UPLOADS_DIR` | Supabase Storage of the staging project | Supabase Storage `uploads` |
| Web apps | `pnpm --filter @driver/customer web` | Pages preview branches | Cloudflare Pages `driver-customer`, `driver-merchant` |
| Mobile | Expo Go / dev build | EAS `preview` profile (APK) + channel `preview` | EAS `production` profile + channel `production` |
| Secrets | `.env` (dummies) | Fly secrets of the staging app, GitHub environment `staging` | Fly secrets, GitHub secrets |
| Logs | terminal, pretty | Fly, JSON | Fly, JSON (+ Sentry) |

Staging runs at production sizes for the launch load tests and the game day; it is stopped between
them. When a change touches money, dispatch or migrations, run it there first: Actions → Deploy →
environment `staging`.

## Deploy

Normal path — a version tag:

```bash
git checkout main && git pull
git tag v1.0.3 && git push origin v1.0.3
```

GitHub → Actions → **Deploy** runs: **plan** (what is configured) → **migrate** (`prisma migrate
deploy` over `DIRECT_URL`, then `driver_harden()` and the checklist) → **API** (Fly builds the image
and starts a new machine; it takes traffic only after `/trpc/health.live` passes; the old one drains
and stops) → smoke test (`db: ok`, `redis: ok`) → **Console** and **web apps**. A red step stops the
ones after it. By hand: Actions → Deploy → Run workflow (target: all / api / web / console /
migrate-only).

Before tagging: CI green on `main`; if the release has a migration, read it (anything that drops or
rewrites a column needs a backup first: Actions → Backup → Run workflow).

Mobile releases are separate (store review): [mobile.md](mobile.md). JavaScript-only fixes can go out
as an OTA update the same day.

## Roll back

**API** (bad code, database fine) — go back to the previous image, takes a minute:

```bash
fly releases --config deploy/fly/api.toml            # find the last good version and its image
fly deploy --config deploy/fly/api.toml --image registry.fly.io/driver-api:<label of the good release>
```

(or re-run the Deploy workflow on the previous tag: Actions → Deploy → Run workflow → "Use workflow
from" the old tag; migrations already applied are skipped.)

**Migrations are never rolled back automatically.** Our migrations only add (tables, columns, indexes),
so the previous API version keeps working on the newer schema. If a migration itself is wrong, write a
new migration that fixes it and deploy that.

**Web apps**: Cloudflare → the Pages project → Deployments → the previous one → **Rollback**.
**Console**: like the API (`fly releases --config deploy/fly/console.toml`).
**OTA update**: `cd apps/<app> && eas update:roll-back-to-embedded --channel production` (or republish the
previous update group from expo.dev). Publish a new OTA update only with
`node scripts/deploy/eas-update.mjs <customer|partner|merchant> <preview|production> "what changed"`, never a bare
`eas update`: the script takes the server address from the expo.dev environment and refuses an update
without it (CORE-04); a bare `eas update` is not checked and can point every phone at localhost.

### A migration failed

The Deploy run shows the migration name and the SQL error; the API was not deployed. Prisma marks the
migration as failed and refuses to run anything else until it is resolved.

1. Look at the error. If the migration did nothing (it runs in one transaction, so usually nothing was
   applied): fix the SQL in a new commit **only if the migration never succeeded anywhere**, then
   `pnpm --filter @driver/db exec prisma migrate resolve --rolled-back <migration_name>` with
   `DIRECT_URL` set, and deploy again.
2. If it was partly applied (rare): no restore needed — finish or undo it by hand with the SQL editor in
   Supabase, then `prisma migrate resolve --applied <name>` (finished) or `--rolled-back <name>` (undone).
3. Run `node scripts/deploy/supabase-setup.mjs --verify-only` until the checklist is green.

## Rotate secrets

| Secret | How | Effect on users |
| --- | --- | --- |
| `JWT_SECRET` | `fly secrets set --config deploy/fly/api.toml JWT_SECRET=$(openssl rand -hex 32) JWT_KID=k<n+1>` | none: apps refresh their token once ([hosting.md](hosting.md#rotating-the-jwt-secret)) |
| Database password | Supabase → Project Settings → Database → **Reset database password**; then update `DATABASE_URL` on Fly and `DIRECT_URL` in GitHub | API restarts (seconds) |
| Supabase S3 key | Storage → S3 → new key, set both `S3_*` keys on Fly, then delete the old key | none |
| Redis password | `fly secrets set --config deploy/fly/redis.toml REDIS_PASSWORD=…` and the same in the API's `REDIS_URL` | a few seconds of "redis unavailable"; outbox rows wait |
| `UPLOADS_SECRET` | `fly secrets set` | photo links already open stop working; they are re-issued on the next screen load |
| `SHARE_LINK_SECRET`, `SAFETY_LINK_SECRET` | `fly secrets set --config deploy/fly/api.toml <NAME>=$(openssl rand -hex 32)`, each its own value | trip-share and SOS links already sent stop opening; rotate outside a live SOS |
| `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN` | create a new one, replace the GitHub secret, revoke the old one | none |
| `PHONE_HASH_PEPPER` | **never** | changing it would make every account unknown |
| `BACKUP_PASSPHRASE` | new value in GitHub; keep the old one as long as old backups exist | none |

After someone with access leaves: rotate `JWT_SECRET`, the database password, the S3 key and the deploy
tokens, and remove them from Supabase, Fly, Cloudflare, Expo and GitHub.

## Backups

- **Supabase daily backups** (Pro): Database → Backups, 7 days. One-click restore of the whole project
  to that day (everything after it is lost — use it for disasters only).
- **Nightly logical dump** (`.github/workflows/backup.yml`, 01:17 UTC): `pg_dump` of `public` and
  `identity_vault`, encrypted (AES-256, your `BACKUP_PASSPHRASE`), copied to a bucket you own
  (Cloudflare R2: free egress, $0.015/GB; secrets `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
  `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`). The repository is public, so no copy is
  kept as a GitHub artifact (anyone signed in could download it); on a private repository the variable
  `BACKUP_KEEP_ARTIFACT=true` adds a 14-day one. Set secrets `DIRECT_URL` (already there),
  `BACKUP_PASSPHRASE` and the bucket ones; run it once by hand to see it work. Once production exists
  (the variable `API_PUBLIC_URL` is set), a missing secret turns the nightly run **red** instead of
  skipping, so a night without a backup is never silent (SEC-13).
- **PITR**: off at launch (≈$100/month). Turn it on once a lost hour of orders would cost more.
- **Redis** holds only queues and caches; it is rebuilt from the database. Its AOF survives restarts.

### Restore

From a nightly dump into a **new** Supabase project (never over the live one):

```bash
# 1. download driver-<date>.dump.enc from the Backup run (or your bucket), then decrypt:
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in driver-<date>.dump.enc -out driver.dump -pass env:BACKUP_PASSPHRASE
# 2. new Supabase project (Frankfurt) → do NOT run migrations; enable PostGIS into public:
psql "$NEW_DIRECT_URL" -c 'CREATE EXTENSION IF NOT EXISTS postgis'
# 3. restore both schemas, tables owned by the connecting user:
pg_restore --dbname="$NEW_DIRECT_URL" --no-owner --no-acl driver.dump
# 4. lock it down and check
DATABASE_URL=… DIRECT_URL=… node scripts/deploy/supabase-setup.mjs --skip-seed
```

Then point the API at it (`fly secrets set DATABASE_URL=…`) and GitHub's `DIRECT_URL`. Use `pg_restore`
version 17 (`brew install postgresql@17` / `apt install postgresql-client-17`). For a single table
or row, restore into the new project and copy what you need across — never restore over live data.

## Kill switches

What exists today, from the narrowest to the widest:

| Situation | Switch | Where |
| --- | --- | --- |
| One restaurant overwhelmed / closed | **Busy mode** (+10 min prep, 60 min) or **close early** with a reason | merchant app (owner/staff) — `merchant.setBusy`, `merchant.setOpen` |
| A courier, driver or staff member must stop working | revoke the role (`identity.revokeRole`, admin only) | Console / API — the person keeps the account, loses the job |
| Stop a service (food, taxi…), one kitchen, a zone or a الرجعة corridor; cap active orders in a zone | **kill switches** and the **zone throttle** (launch playbook §3), with an Arabic note for customers | Console → التحكم (`/controls`, dispatcher or admin; every change is in the audit). A stopped kitchen shows «موقوف» with the note on its card, and checkout's price check and placing both refuse with the note (REL-16) |
| Everything must stop now (data leak, money bug) | **stop the API**: `fly scale count app=0 worker=0 --config deploy/fly/api.toml --yes` | apps show "no connection"; nothing is written. Bring back: `fly scale count app=2 worker=1 --config deploy/fly/api.toml` |
| A bad mobile update | `eas update:roll-back-to-embedded --channel production` | Expo |

Stopping the API is safe for data: orders already placed stay in the database, outbox rows wait, and
timers resume when it is back (late timers fire on start). Tell restaurants and couriers on WhatsApp.

## Deploying while the database is down

Fly and the bluegreen swap watch `/trpc/health.live`, which answers 503 once the database has been
unreachable for 30 seconds without a break (shorter blips are ridden out, so one failover does not pull
every machine from rotation at once). A bluegreen deploy then never finishes: the new machines never pass their check and the
old ones keep serving. When a fix must ship anyway (for example a wrong `DATABASE_URL`), the on-call
person deploys without waiting for the check, and tells Ali:

```bash
fly deploy . --config deploy/fly/api.toml --dockerfile apps/api/Dockerfile --remote-only --strategy immediate
```

`immediate` replaces every machine at once, with no health gate and a short gap in service. Use it
only for this case. The game day rehearses it.

## Incident checklist

1. **Is it down?** `curl -s https://driver-api.fly.dev/trpc/health.ready` → `db` and `redis` must be `ok`.
   `health.live` answering 503 means the machines have not reached the database for 30 seconds (see "Deploying while the
   database is down" below).
   Fly dashboard → driver-api → Monitoring. Supabase → status / Reports. <https://status.flyio.net>,
   <https://status.supabase.com>.
2. **What changed?** Last deploy (GitHub Actions), last OTA update (expo.dev), last secret change
   (`fly releases`). If it started right after a deploy → roll back first, investigate second.
3. **Logs**: `fly logs --config deploy/fly/api.toml | grep '"level":"error"'`; Sentry if configured.
4. **Database**: Supabase → Reports (CPU, connections). "Too many connections" → lower
   `DATABASE_POOL_MAX` or scale compute. Outbox stuck: Console → System shows pending / failed rows.
5. **Redis**: `fly status --config deploy/fly/redis.toml`; restart: `fly machine restart <id> --config deploy/fly/redis.toml`.
6. **Contain**: restaurant busy/close; freeze an account; worst case stop the API (kill switches above).
7. **Communicate**: WhatsApp groups for couriers and restaurants; customers see the app's error state.
8. **After**: write down what happened, when, the impact (orders affected), the fix, and one change that
   prevents it. If money was involved, check the ledger in the Console (finance) before closing the incident.

## Before SMS exists

Sign-in sends a one-time code by SMS. Until an SMS provider is connected, the API runs with
`SMS_PROVIDER=fake`, which writes each code to the API log instead of sending it:

```bash
fly logs --config deploy/fly/api.toml | grep FakeSms
```

That is workable for a closed test with people you know (you read them their code), not for a public
launch, and the log then contains phone numbers. Connect the provider (`SMS_PROVIDER=gateway`,
`SMS_GATEWAY_URL`, `SMS_GATEWAY_KEY`) before opening sign-up to the public.
