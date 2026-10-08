# API hosting: Fly.io, Frankfurt

**Decision: the API and its Redis run on Fly.io in `fra` (Frankfurt); the database is Supabase in
Frankfurt (`eu-central-1`); the web apps are static files on Cloudflare Pages ([web.md](web.md)).**
About **$126/month** at launch sizes (table below). Files: `apps/api/Dockerfile`, `deploy/fly/api.toml`,
`deploy/fly/redis.toml`, `deploy/fly/redis/Dockerfile`, `.github/workflows/deploy.yml`.

## Why Fly (and not Railway or Render)

| | **Fly.io** (chosen) | Railway | Render |
| --- | --- | --- | --- |
| Region next to the database | **Frankfurt** — same metro as Supabase eu-central-1, ~1 ms per query | EU West = Amsterdam, ~8–10 ms per query | Frankfurt |
| Latency to Iraq | Frankfurt ≈ 60–80 ms | Amsterdam ≈ 70–90 ms | Frankfurt ≈ 60–80 ms |
| API cost at launch | 1 × shared-cpu-1x 512 MB ≈ **$3–4** | Hobby $5 minimum + usage ≈ $8–12 | Starter web $7 |
| Redis | own Redis machine + 1 GB volume ≈ **$2** (or Upstash) | Redis service, usage-based ≈ $1–3 | Key Value Starter **$10** (the free one keeps nothing on restart) |
| Total, API + Redis (first, ~100 orders a day sizing) | **≈ $6** | ≈ $10–15 | ≈ $17 |
| SSE / WebSockets | yes (plain HTTP proxy, no request time limit) | yes | yes |
| Zero-downtime deploy with one instance | yes (`bluegreen`) | yes | yes |
| Ease for a non-coder | CLI first; the GitHub workflow does the deploys | easiest dashboard | easy dashboard |

Each API request runs several queries (a transaction, the outbox row, a lock), so the database being
1 ms away instead of 10 ms is felt on every tap. Fly gives that for the lowest price, and a Redis that
BullMQ can poll all day without a per-command bill. The price is a command-line setup once (below,
copy-paste); after that every deploy is a git tag. If you prefer a dashboard over a terminal, Render in
Frankfurt is the fallback: same Dockerfile, ~$11/month more.

## What runs where

```
phones / browsers ──HTTPS──▶ Fly proxy (fra) ──▶ driver-api, process group `app` (2 machines, always on)
                                                   │  DRIVER_ROLE=web: HTTP API (tRPC), SSE, /files, /uploads.
                                                   │  Enqueues jobs, runs none.
                                                   │
                                                 driver-api, process group `worker` (1 machine, no public traffic)
                                                   │  DRIVER_ROLE=worker: outbox, dispatch waves, order and trip
                                                   │  timers, notify, routes scheduler, nightly close, purges
                                                   │
                                                   ├──▶ driver-redis.internal:6379  (Fly private network; jobs and live fan-out)
                                                   └──▶ Supabase Postgres (Supavisor :6543) + Storage (S3)
```

## Web and worker machines (launch sizes)

Measured in the launch load test (plan 7.1): one shared-CPU machine runs out of CPU credit within
11–38 minutes at the launch-night peak, and on six weeks of data it runs out of memory. So the API runs
as two **process groups** from one image and one `deploy/fly/api.toml`:

| Group | Machines | Size | `DRIVER_ROLE` | Heap cap | Does |
| --- | --- | --- | --- | --- | --- |
| `app` | 2 (min 2 running) | performance-1x: 1 dedicated vCPU, 2 GB | `web` | 1,536 MB | requests and streams; one can die at 1× load and the other carries it |
| `worker` | 1 | shared-cpu-2x, 1 GB | `worker` | 768 MB | every background job and sweep |

`DRIVER_ROLE` (`apps/api/src/shared/process-role.ts`): `web` attaches no BullMQ worker and runs no
sweep; `worker` runs them and serves only its health check; `all` (the default) does both, as before.
`web` and `worker` need `REDIS_URL` (they hand jobs to each other through Redis) and refuse to boot
without it. Each group's command in the toml sets its role and its heap cap (75 % of the machine), so
an overload fails fast and restarts instead of swapping.

Set the counts once per app (and after `fly scale count 0`):

```bash
fly scale count app=2 worker=1 --config deploy/fly/api.toml
```

**Back to one process** (the switch-off in plan 7.6): `fly scale count app=2 worker=0`, then set the
`app` command to `DRIVER_ROLE=all` (edit `[processes]` and deploy). Jobs are safe across the switch:
BullMQ keeps them in Redis until a process with workers attaches.

BullMQ, the outbox (`SKIP LOCKED`) and the dispatch locks are safe with several processes, so more
capacity is "add a machine": `fly scale count app=3 --config deploy/fly/api.toml` (the plan's fallback
if the 2× load test fails is 3–4 `app` machines).

### Monthly cost at launch sizes

Fly list prices for Frankfurt (`fra` is about 15 % over the US base), October 2026, 30 days always on:

| Part | Size | ≈ $/month |
| --- | --- | --- |
| API `app` | 2 × performance-1x 2 GB | 76 |
| API `worker` | 1 × shared-cpu-2x 1 GB | 8.5 |
| Redis | shared-cpu-1x 256 MB + 1 GB volume | 2.7 |
| Road routing (OSRM) | shared-cpu-1x 1 GB | 6.6 |
| Console | shared-cpu-1x 256 MB, one machine always on | 2.2 |
| Supabase | Pro plan $25 + Small compute $15, less the $10 compute credit | 30 |
| **Production total** | | **≈ 126** |
| Fallback: each extra `app` machine | performance-1x 2 GB | +38 |
| Staging (only while testing) | same sizes, billed by the hour; stopped between tests | ≈ 5–25 |

Check the current prices on <https://fly.io/docs/about/pricing/> and <https://supabase.com/pricing>
before turning it on.

## Realtime (SSE) on Fly — for the realtime work

- Fly's proxy passes Server-Sent Events and WebSockets through unchanged, with no time limit per
  request. It closes a connection that sends nothing for about a minute: **send a comment line
  (`: ping`) at least every 30 s** on every stream.
- `[http_service.concurrency]` counts **connections** (soft 300 / hard 400 per `app` machine, to be
  calibrated by the load test), so open streams are what fill a machine. Overload is answered inside
  the process with a 503 and `Retry-After` for requests, never by refusing a stream.
- On deploy or shutdown, open streams get 10 s and are then closed (`src/shutdown.ts`); `EventSource`
  reconnects by itself, to the new machine. Send `retry:` and use `Last-Event-ID` if missed events
  matter.
- With two machines, a stream and the event that should reach it may be on different machines: live
  events fan out through Redis pub/sub (`RedisLiveBus`), never process memory.

## One-time setup (about 20 minutes)

You need: a Fly account with a card (<https://fly.io/app/sign-up>), and `flyctl` on a computer
(<https://fly.io/docs/flyctl/install/>). In a terminal, at the repository root:

```bash
fly auth login

# 1. Create the apps (names must be unique on Fly; if taken, pick another and change `app =` in the toml)
fly apps create driver-api
fly apps create driver-redis

# 2. Redis: a 1 GB volume and a password
fly volumes create redis_data --config deploy/fly/redis.toml --region fra --size 1 --yes
REDIS_PASSWORD=$(openssl rand -hex 24)
fly secrets set --config deploy/fly/redis.toml REDIS_PASSWORD="$REDIS_PASSWORD" --stage
fly deploy . --config deploy/fly/redis.toml --dockerfile deploy/fly/redis/Dockerfile --remote-only

# 3. API secrets (values from supabase.md; generate the random ones with: openssl rand -hex 32)
fly secrets set --config deploy/fly/api.toml --stage \
  DATABASE_URL='<transaction pooler, :6543>' \
  DATABASE_CA_CERT="$(cat ~/Downloads/prod-ca-2021.crt)" \
  REDIS_URL="redis://default:${REDIS_PASSWORD}@driver-redis.internal:6379?family=6" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  JWT_KID=k1 \
  PHONE_HASH_PEPPER='<the value you used in supabase-setup — NEVER change it>' \
  UPLOADS_SECRET="$(openssl rand -hex 32)" \
  SHARE_LINK_SECRET="$(openssl rand -hex 32)" \
  SAFETY_LINK_SECRET="$(openssl rand -hex 32)" \
  S3_ENDPOINT='<from supabase.md step 5>' S3_BUCKET=uploads S3_REGION=eu-central-1 S3_FORCE_PATH_STYLE=true \
  S3_ACCESS_KEY_ID='<…>' S3_SECRET_ACCESS_KEY='<…>'

# 4. First deploy (later deploys come from GitHub, runbook.md), then the machine counts
fly deploy . --config deploy/fly/api.toml --dockerfile apps/api/Dockerfile --remote-only
fly scale count app=2 worker=1 --config deploy/fly/api.toml

# 5. Check: db and redis must both say "ok"
curl -s https://driver-api.fly.dev/trpc/health.ready
```

Then, for GitHub to deploy for you: `fly tokens create deploy -a driver-api` → copy the token into
GitHub → Settings → Secrets and variables → Actions → **New repository secret** `FLY_API_TOKEN`
(for the Console too, use `fly tokens create org` instead, which covers every app). Add the variable
`API_PUBLIC_URL` = `https://driver-api.fly.dev/trpc` (later your own domain).

### Your own domain (later)

`fly certs add api.<your-domain> --config deploy/fly/api.toml`, then add the DNS records it prints
(at Cloudflare: proxy **off**, "DNS only", for the API). Update `API_PUBLIC_URL`, `CORS_ORIGINS`, and
rebuild the web apps and mobile apps (the URL is baked into them).

## Environment variables of the API

Secrets go in with `fly secrets set` (encrypted, never shown again). Plain settings are in
`deploy/fly/api.toml` `[env]` or also set as secrets — both end up as environment variables.

**What stops boot** (SEC-16, `modules/config/boot-check.ts`). Staging and production refuse to start
without `DATABASE_URL` or `REDIS_URL`. Production (any `NODE_ENV=production` host without
`DEPLOY_ENVIRONMENT=staging`) also refuses dev SMS and a `STAGING_TEST_OTP`; push other than Expo is
refused where push is built (see `PUSH_PROVIDER` below).
The log line lists every problem at once. A database or Redis that is configured but unreachable never
stops boot: `health.ready` shows it, and `health.live` fails after 30 s without the database.

| Variable | Secret? | Value / note |
| --- | --- | --- |
| `NODE_ENV` | no | `production` (toml). With it, the API refuses to boot without strong `JWT_SECRET` and `PHONE_HASH_PEPPER`. |
| `PORT` | no | `3000` (toml) |
| `DEPLOY_ENVIRONMENT` | no | `staging` on the staging app (Staging setup sets it). Unset means production rules |
| `DATABASE_URL` | **yes** | Supabase transaction pooler, port 6543 |
| `DATABASE_CA_CERT` | yes | Supabase CA certificate (PEM). Optional but recommended. |
| `DATABASE_POOL_MAX` | no | `10` (toml), per lane per process. Each process has a request lane and a background lane (below), opened on first use: web machines mostly use the request lane, the worker the background lane, so 3 processes stay well under Small compute's 400 pooled clients |
| `DATABASE_STATEMENT_TIMEOUT_MS` | no | default `5000`: a query made while answering a phone is cancelled after 5 s ([Database time limits](#database-time-limits)). `0` = no limit |
| `DATABASE_JOB_STATEMENT_TIMEOUT_MS` | no | default `120000`: the limit for jobs, sweeps and outbox deliveries (their transactions may stay open as long). `0` = no limit |
| `DRIVER_ROLE` | no | set per process group by `[processes]` in the toml: `web`, `worker`; unset = `all` (one process does everything) |
| `TIMERS_SWEEPER` | no | `on` (toml); unset = `off`. A sweeper on the job machines fires due timers from `scheduled_timers`, so a Redis loss only delays them. Today it holds dispatch's far-ahead timers (a booked ride's evening offer, deadline, reminder and T−30 search; a departure's start and low-fill check), each due a minute after its Redis job and marked fired when that job ran. `TIMERS_SWEEP_MS` default 5000 |
| `REDIS_URL` | **yes** | `redis://default:<password>@driver-redis.internal:6379?family=6` |
| `JWT_SECRET` | **yes** | 64 hex chars; signs 15-minute access tokens. Rotation below. |
| `JWT_KID` | no | `k1`, then `k2`, … on each rotation |
| `PHONE_HASH_PEPPER` | **yes** | 64 hex chars. **Never changes**: changing it orphans every account. |
| `UPLOADS_SECRET` | **yes** | signs `/files` and `/uploads` links; defaults to `JWT_SECRET` — set it so a JWT rotation does not break photo links |
| `SHARE_LINK_SECRET` | **yes** | 64 hex chars; signs trip-share links. Production refuses to boot without it (at least 32 characters, different from `JWT_SECRET` and `SAFETY_LINK_SECRET`) |
| `SAFETY_LINK_SECRET` | **yes** | 64 hex chars; signs SOS links. Same rule: required in production, its own value |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | no | Supabase Storage, [supabase.md](supabase.md) step 5 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **yes** | Supabase Storage S3 key |
| `TRUST_PROXY` | no | `1` (toml): Fly's proxy is one hop, so OTP limits see the client's IP |
| `CORS_ORIGINS` | no | once the web domains exist: `https://app.<domain>,https://console.<domain>` |
| `SMS_PROVIDER` | no | `fake` today (codes are written to the log — see the runbook); `gateway` + `SMS_GATEWAY_URL` / `SMS_GATEWAY_KEY` (secret) when the SMS provider exists |
| `OTP_RATE_LIMIT_PER_*`, `OTP_SMS_DAILY_BUDGET`, `OTP_BLOCK_SPIKE_PER_HOUR`, `OTP_SMS_HARD_CAP_MULTIPLIER`, `OTP_GUARD_MODE*`, `OTP_BUDGET_MODE` | no | the OTP guard, [docs/api/otp-guard.md](../api/otp-guard.md). Launch values are the defaults; set `OTP_SMS_DAILY_BUDGET` to 3 × the expected day-one installs |
| `CALL_PROXY_NUMBER` | no | the platform number for masked calls (unset: calling is off) |
| `LOG_FORMAT`, `LOG_LEVEL` | no | `json` (toml); `LOG_LEVEL=debug` temporarily for more |
| `REQUEST_LOG` | no | `on` by default in production: one JSON line per `/trpc` request (observability.md); `off` silences it, metrics stay |
| `METRICS_PORT` | no | `9091` (toml): private `/metrics` port Fly scrapes; unset = no metrics server |
| `SENTRY_DSN` | yes-ish | optional error reporting (below) |
| `OSRM_URL` | no | road routing (below): `http://driver-osrm.internal:5000`. Unset: arrival times use the straight-line estimate |
| `OSRM_TIMEOUT_MS` | no | default 1500; slower answers fall back to the straight-line estimate |
| `APP_RELEASE` | no | set by the deploy workflow (`v1.2.3@abc1234`) |
| `SHUTDOWN_TIMEOUT_MS` | no | default 25000 (under `kill_timeout = 30`) |

New providers (notifications, SMS, maps) add their variables to `.env.example`; put the keys in with
`fly secrets set` the same way.

## Database time limits

One database role, two lanes. While the API answers an HTTP request, its queries go through the
**request lane**: each statement may run 5 s, so one slow query can't hold a connection that a crowd
is queueing for. Queued jobs, interval sweeps, outbox deliveries and boot use the **background
lane**: 2 minutes (Supabase's own global cap), and their transactions may stay open as long. The
limits are set twice: when a connection opens, and again at the start of every transaction
(`SET LOCAL`), because Supabase's transaction pooler (port 6543) may drop the first.

Check after each first deploy (staging, then production): the log of every process says once per
lane `database request lane: statement_timeout 5000 ms` (and `background … 120000 ms`). A warning
`… is 120000 ms, wanted 5000 ms (connection setting dropped …)` means the pooler dropped the
connection setting: transactions still get theirs, but single queries outside a transaction get the
role's default. If so, give the role the request limit once, in the Supabase SQL editor:

```sql
ALTER ROLE postgres SET statement_timeout = '5s';
```

Then the warning disappears from web machines; the background lane keeps its 2 minutes inside
transactions. Migrations run through the session pooler (port 5432) with the same role, so from
then on a migration that may run long (a big index, a backfill) starts with its own
`SET statement_timeout = '10min';` next to `SET lock_timeout = '3s';`. Undo with
`ALTER ROLE postgres RESET statement_timeout;`.

## Rotating the JWT secret

Access tokens live 15 minutes; refresh tokens are random strings stored hashed in the database, not
signed with `JWT_SECRET`. So a rotation signs nobody out:

```bash
fly secrets set --config deploy/fly/api.toml JWT_SECRET="$(openssl rand -hex 32)" JWT_KID=k2
```

Fly restarts the API with the new secret. Every phone's current access token stops verifying, the app
gets a 401, refreshes once with its refresh token, gets a new pair, and carries on. Do it when someone
who knew the secret leaves, or after a leak. (With `UPLOADS_SECRET` set separately, photo links keep
working; share-trip and SOS links have their own secrets and are never affected.) `PHONE_HASH_PEPPER` is
never rotated.

## Logs and errors

- **Logs** are JSON lines (`{"time","level","context","msg","stack"?,"service"}`):
  `fly logs --config deploy/fly/api.toml`, or the app's **Monitoring** page on fly.io. Search for
  `"level":"error"`. Fly keeps a short history only: for longer retention ship them (Fly log shipper
  → Better Stack / Axiom free tiers).
- **Uptime checks**: Fly's own checks restart a sick machine but tell nobody. Before launch, add a free
  external monitor (Better Stack Uptime or UptimeRobot) that checks every minute and alerts the on-call
  phone: the API at `https://driver-api.fly.dev/trpc/health.live` (status 200; 503 means the
  database has been unreachable for 30 seconds), `https://driver-api.fly.dev/trpc/health.ready` for the dependencies
  (the text `"ok":true`; `"redis":"unavailable"` alone does not take the API down), and the Console at `https://driver-console.fly.dev/login` (status 200). Use the
  custom domains once they exist.
- **Metrics**: the Fly dashboard shows CPU, memory, HTTP status codes and response times per machine;
  Supabase → Reports shows database load and slow queries.
- **Errors to Sentry (optional)**: create a free Sentry project (platform Node.js, data region EU),
  copy its DSN, `fly secrets set --config deploy/fly/api.toml SENTRY_DSN='https://…'`. Every logged
  error (with its stack), unhandled rejection and crash is sent, at most 30 a minute. Without
  `SENTRY_DSN` nothing is sent and nothing is loaded.
- **Crash reports from the apps and the Console (optional, built 2026-10-07, off until a DSN is set)**:
  the same approach as the server — plain `fetch` to Sentry's envelope endpoint, no Sentry SDK and no
  native module, so it also works in Expo Go and on the web studio. The shared code is
  `packages/contracts/src/crash-report.ts` (`@driver/contracts/crash-report`; the API's DSN parsing is
  the same function). What is caught:
  - phone apps (customer, partner, merchant): unhandled JS errors (React Native's `ErrorUtils` global
    handler, chained to the previous one), unhandled promise rejections (Hermes' tracker in builds; the
    window's `unhandledrejection` on the web), and render crashes caught by the root error boundary,
    which shows «صار خلل بالتطبيق» with «جرّب مرة ثانية» instead of a white screen;
  - Console: `app/error.tsx` (a page breaks, the shell stays), `app/global-error.tsx` (the layout
    breaks) and the window's `error` / `unhandledrejection`.

  **Privacy**: before anything leaves the device, messages and stacks are scrubbed of Iraqi phone
  numbers (07xx…, +964…, also in Arabic digits), 4–6 digit codes (OTPs, PINs), emails, bearer/JWT
  tokens and `token=` / `Authorization:` / `otp=` style values. No user, no person id (the API's
  reporter sends none either), no request bodies, no breadcrumbs; extra fields are short plain values
  under safe keys only. At most 10 reports a minute per device; the same error is sent once.

  Setup: create one Sentry project per app (platform JavaScript / React Native / Next.js, data region
  EU), copy each DSN and set it **at build time** (DSNs are public; they end up in the bundle):

  | Variable | Where | Notes |
  |---|---|---|
  | `EXPO_PUBLIC_SENTRY_DSN` | expo.dev → each app → Environment variables (production, preview); GitHub variable `SENTRY_DSN` for the web builds (one Sentry project "driver" for everything; `SENTRY_DSN_CUSTOMER`, `SENTRY_DSN_PARTNER`, `SENTRY_DSN_MERCHANT` override it per app) | unset = nothing sent |
  | `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | same | default `development` under `expo start`, `production` in builds |
  | `EXPO_PUBLIC_APP_RELEASE` | same | default `iq.driver.<app>@<app.json version>` |
  | `NEXT_PUBLIC_SENTRY_DSN` | GitHub variable `SENTRY_DSN`, or `SENTRY_DSN_CONSOLE` to override it (the deploy workflow passes it as a Docker build argument) | unset = nothing sent |
  | `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_APP_RELEASE` | build argument / environment | defaults `NODE_ENV`, `driver-console@<package.json version>` |

  Sentry shows minified stacks for now (no source-map upload yet); the message, the screen's component
  stack and the release are enough to find most crashes.
- **Speed reports from real phones (optional, built 2026-10-08, customer app; off until the DSN above
  is set)**: the same DSN also carries how long the app took to start (`app start`, from the native
  process start to the first screen drawn after the splash, plus the JS heap then) and how long each
  screen took to open (from the tap to the new screen drawn, named by its route pattern such as
  `restaurant/[id]`, never an id). They show in Sentry → Performance (Insights → Mobile vitals /
  transactions). Only 1 app session in 10 reports (`EXPO_PUBLIC_SPEED_SAMPLE`, 0–1; e.g. `1` for a
  test build), at most 20 a minute, never in development; nothing personal, no timers (nothing runs
  on an idle screen). Code: `packages/contracts/src/speed-report.ts`, `apps/customer/src/lib/speed.ts`.
  The lab numbers in CI are `docs/perf-budgets.md`; these are the phones people actually hold.
- **Graceful shutdown**: on every deploy or restart the old machine gets SIGTERM and, within 25 s, stops
  taking requests, finishes the ones in flight, delivers the outbox rows still due, lets the BullMQ
  workers finish their current job, closes Redis and Postgres, and exits. Anything left is retried by
  the new machine (outbox rows stay `pending`; BullMQ re-queues a stalled job). Nothing is lost.

## Road routing (OSRM)

Arrival times and route lines come from our own OSRM server (maps program decision D3). Without it the
API uses one shared straight-line estimate (×1.4 at town speeds), so nothing breaks — times are just
less accurate around the river.

`deploy/fly/osrm.toml` runs it on a private Fly machine (no public address, 1 GB, ≈ $6–10 a month).
The image build downloads the latest Iraq map from Geofabrik, keeps Baghdad – Aziziyah – Kut, and
prepares the road graph (a few minutes on Fly's builder):

```bash
fly apps create driver-osrm
fly deploy . --config deploy/fly/osrm.toml --dockerfile deploy/fly/osrm/Dockerfile --remote-only
fly secrets set --config deploy/fly/api.toml OSRM_URL=http://driver-osrm.internal:5000
```

Check from the API machine: `fly ssh console --config deploy/fly/api.toml -C "wget -qO- 'http://driver-osrm.internal:5000/route/v1/driving/45.0612,32.9062;45.0709,32.8961?overview=false'"`
must answer `"code":"Ok"`. Monthly: run the `fly deploy` line again for fresh map data (streets added in
OpenStreetMap appear after the next deploy). If OSRM stops answering, the API notices within seconds,
uses the straight-line estimate for a minute, then tries again — customers never see an error.

## Redis: own machine or Upstash

`deploy/fly/redis.toml` runs Redis 7 on a 256 MB machine with a 1 GB volume: append-only file every
second (queued timers survive a restart), `noeviction` (BullMQ must never lose a key), password, and no
public address. Cost ≈ $2/month. If that machine restarts (Fly host maintenance), the API logs Redis as
unavailable for a few seconds; outbox rows wait as `pending` and drain when it is back.

Alternative: `fly redis create` (Upstash, managed). Upstash bills per command on its pay-as-you-go
plan, and BullMQ polls continuously (blocking reads, stalled-job checks, the 500 ms outbox tick), which
adds up to millions of commands a month: choose a **fixed-price** Upstash plan if you go that way. Set
`REDIS_URL` to the URL it prints (keep `?family=6` on Fly).

## Scaling to Wasit

| Load | Change | Cost |
| --- | --- | --- |
| Launch night (≈ 225 active orders, 112 streams; plan 7.1) | the launch sizes above | ≈ $126 in all |
| 2× load test fails, or a second town | `fly scale count app=3` or 4 | +$38 per machine |
| Database CPU > 60 % at 2× | Supabase compute Small → Medium | +~$45 |
| Thousands of SSE streams | more machines; Redis pub/sub fan-out | per machine |
