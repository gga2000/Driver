# API hosting: Fly.io, Frankfurt

**Decision: the API and its Redis run on Fly.io in `fra` (Frankfurt); the database is Supabase in
Frankfurt (`eu-central-1`); the web apps are static files on Cloudflare Pages ([web.md](web.md)).**
About **$6/month** for API + Redis at launch. Files: `apps/api/Dockerfile`, `deploy/fly/api.toml`,
`deploy/fly/redis.toml`, `deploy/fly/redis/Dockerfile`, `.github/workflows/deploy.yml`.

## Why Fly (and not Railway or Render)

| | **Fly.io** (chosen) | Railway | Render |
| --- | --- | --- | --- |
| Region next to the database | **Frankfurt** — same metro as Supabase eu-central-1, ~1 ms per query | EU West = Amsterdam, ~8–10 ms per query | Frankfurt |
| Latency to Iraq | Frankfurt ≈ 60–80 ms | Amsterdam ≈ 70–90 ms | Frankfurt ≈ 60–80 ms |
| API cost at launch | 1 × shared-cpu-1x 512 MB ≈ **$3–4** | Hobby $5 minimum + usage ≈ $8–12 | Starter web $7 |
| Redis | own Redis machine + 1 GB volume ≈ **$2** (or Upstash) | Redis service, usage-based ≈ $1–3 | Key Value Starter **$10** (the free one keeps nothing on restart) |
| Total, API + Redis | **≈ $6** | ≈ $10–15 | ≈ $17 |
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
phones / browsers ──HTTPS──▶ Fly proxy (fra) ──▶ driver-api  (1 machine, 512 MB, always on)
                                                   │  HTTP API (tRPC), SSE, /files, /uploads
                                                   │  BullMQ workers in the same process: outbox, dispatch
                                                   │  waves, order timers, routes scheduler, nightly close
                                                   ├──▶ driver-redis.internal:6379  (Fly private network)
                                                   └──▶ Supabase Postgres (Supavisor :6543) + Storage (S3)
```

**One process does both web and workers.** At ~100 orders a day the workers are idle most of the time,
and BullMQ, the outbox (`SKIP LOCKED`) and the dispatch locks (Redis / advisory locks) are all safe with
several processes, so scaling is "add a machine": `flyctl scale count 2 --config deploy/fly/api.toml`.
A separate worker process only pays off when the queues slow the HTTP side down (thousands of orders a
day); that needs a small code switch (`DRIVER_ROLE=web|worker`) that does not exist yet.

The machine never sleeps (`auto_stop_machines = "off"`): the timers live in it.

## Realtime (SSE) on Fly — for the realtime work

- Fly's proxy passes Server-Sent Events and WebSockets through unchanged, with no time limit per
  request. It closes a connection that sends nothing for about a minute: **send a comment line
  (`: ping`) at least every 30 s** on every stream.
- `[http_service.concurrency]` counts **connections** (soft 800 / hard 1000 per machine), so open
  streams are what fill a machine; raise `memory` before raising the limits.
- On deploy or shutdown, open streams get 10 s and are then closed (`src/shutdown.ts`); `EventSource`
  reconnects by itself, to the new machine. Send `retry:` and use `Last-Event-ID` if missed events
  matter.
- With two machines, a stream and the event that should reach it may be on different machines: fan out
  through Redis pub/sub, not process memory.

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
  S3_ENDPOINT='<from supabase.md step 5>' S3_BUCKET=uploads S3_REGION=eu-central-1 S3_FORCE_PATH_STYLE=true \
  S3_ACCESS_KEY_ID='<…>' S3_SECRET_ACCESS_KEY='<…>'

# 4. First deploy (later deploys come from GitHub, runbook.md)
fly deploy . --config deploy/fly/api.toml --dockerfile apps/api/Dockerfile --remote-only

# 5. Check: both must say "ok"
curl -s https://driver-api.fly.dev/trpc/health.ping
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

| Variable | Secret? | Value / note |
| --- | --- | --- |
| `NODE_ENV` | no | `production` (toml). With it, the API refuses to boot without strong `JWT_SECRET` and `PHONE_HASH_PEPPER`. |
| `PORT` | no | `3000` (toml) |
| `DATABASE_URL` | **yes** | Supabase transaction pooler, port 6543 |
| `DATABASE_CA_CERT` | yes | Supabase CA certificate (PEM). Optional but recommended. |
| `DATABASE_POOL_MAX` | no | `10` (toml) |
| `REDIS_URL` | **yes** | `redis://default:<password>@driver-redis.internal:6379?family=6` |
| `JWT_SECRET` | **yes** | 64 hex chars; signs 15-minute access tokens. Rotation below. |
| `JWT_KID` | no | `k1`, then `k2`, … on each rotation |
| `PHONE_HASH_PEPPER` | **yes** | 64 hex chars. **Never changes**: changing it orphans every account. |
| `UPLOADS_SECRET` | **yes** | signs `/files` and `/uploads` links; defaults to `JWT_SECRET` — set it so a JWT rotation does not break photo links |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | no | Supabase Storage, [supabase.md](supabase.md) step 5 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **yes** | Supabase Storage S3 key |
| `TRUST_PROXY` | no | `1` (toml): Fly's proxy is one hop, so OTP limits see the client's IP |
| `CORS_ORIGINS` | no | once the web domains exist: `https://app.<domain>,https://console.<domain>` |
| `SMS_PROVIDER` | no | `fake` today (codes are written to the log — see the runbook); `gateway` + `SMS_GATEWAY_URL` / `SMS_GATEWAY_KEY` (secret) when the SMS provider exists |
| `OTP_RATE_LIMIT_PER_IP_HOUR`, `OTP_RATE_LIMIT_PER_DEVICE_HOUR` | no | defaults 10 / 5 |
| `CALL_PROXY_NUMBER` | no | the platform number for masked calls (unset: calling is off) |
| `LOG_FORMAT`, `LOG_LEVEL` | no | `json` (toml); `LOG_LEVEL=debug` temporarily for more |
| `SENTRY_DSN` | yes-ish | optional error reporting (below) |
| `OSRM_URL` | no | road routing (below): `http://driver-osrm.internal:5000`. Unset: arrival times use the straight-line estimate |
| `OSRM_TIMEOUT_MS` | no | default 1500; slower answers fall back to the straight-line estimate |
| `APP_RELEASE` | no | set by the deploy workflow (`v1.2.3@abc1234`) |
| `SHUTDOWN_TIMEOUT_MS` | no | default 25000 (under `kill_timeout = 30`) |

New providers (notifications, SMS, maps) add their variables to `.env.example`; put the keys in with
`fly secrets set` the same way.

## Rotating the JWT secret

Access tokens live 15 minutes; refresh tokens are random strings stored hashed in the database, not
signed with `JWT_SECRET`. So a rotation signs nobody out:

```bash
fly secrets set --config deploy/fly/api.toml JWT_SECRET="$(openssl rand -hex 32)" JWT_KID=k2
```

Fly restarts the API with the new secret. Every phone's current access token stops verifying, the app
gets a 401, refreshes once with its refresh token, gets a new pair, and carries on. Do it when someone
who knew the secret leaves, or after a leak. (With `UPLOADS_SECRET` set separately, photo links keep
working.) `PHONE_HASH_PEPPER` is never rotated.

## Logs and errors

- **Logs** are JSON lines (`{"time","level","context","msg","stack"?,"service"}`):
  `fly logs --config deploy/fly/api.toml`, or the app's **Monitoring** page on fly.io. Search for
  `"level":"error"`. Fly keeps a short history only: for longer retention ship them (Fly log shipper
  → Better Stack / Axiom free tiers).
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
  | `EXPO_PUBLIC_SENTRY_DSN` | expo.dev → each app → Environment variables (production, preview); GitHub variables `SENTRY_DSN_CUSTOMER`, `SENTRY_DSN_PARTNER`, `SENTRY_DSN_MERCHANT` for the web builds | unset = nothing sent |
  | `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | same | default `development` under `expo start`, `production` in builds |
  | `EXPO_PUBLIC_APP_RELEASE` | same | default `iq.driver.<app>@<app.json version>` |
  | `NEXT_PUBLIC_SENTRY_DSN` | GitHub variable `SENTRY_DSN_CONSOLE` (the deploy workflow passes it as a Docker build argument) | unset = nothing sent |
  | `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_APP_RELEASE` | build argument / environment | defaults `NODE_ENV`, `driver-console@<package.json version>` |

  Sentry shows minified stacks for now (no source-map upload yet); the message, the screen's component
  stack and the release are enough to find most crashes.
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
| ~100 orders/day (launch) | as above | API $3–4 + Redis $2 |
| ~1,000/day, several towns | `memory = "1gb"` and/or `fly scale count 2` (two machines = no single point of failure) | +$4–8 |
| Database busy | Supabase compute Micro → Small | +~$15 |
| Thousands of SSE streams | more machines; Redis pub/sub fan-out | per machine |
