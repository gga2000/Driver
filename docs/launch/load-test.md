# Launch load test

**In short.** Before launch we play launch night against the staging copy of the server: hundreds of
pretend customers open the app, look at menus, order, watch their orders, and the four launch kitchens
accept and cook. The run says whether the server stays fast enough (plan §7.1) or where it gives way. It
runs from GitHub with one button and touches nothing real: made-up people on the staging database only.

First run: **9 Nov (D-28)**, retest by D-14. Each run's numbers go in `docs/launch/load-YYYY-MM-DD.md`.

## Running it

1. Put staging at production's layout: Actions → **Staging machines** → `launch` (2 web + 1 worker).
   The test refuses anything but `smoke` on a smaller staging.
2. Actions → **Load test** → Run workflow → pick a profile. The run page ends with a table of the pass
   numbers; k6's full summary (timings and counts only) is attached to the run.
3. Afterwards: Staging machines → `everyday` (or `off`).

| Profile | Rate | Length | Live orders (with a tracking stream) | Pass                                                                                     |
| ------- | ---- | ------ | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `smoke` | 0.2× | 3 min  | 20 (10)                              | a check that the kit and the API agree, not a §7.1 row                                   |
| `1x`    | 1×   | 2 h    | 225 (112)                            | home p95 < 800 ms, menu p95 < 600 ms, place p95 < 1 s, errors < 0.1 %, no stream refused |
| `2x`    | 2×   | 1 h    | 450 (250)                            | the same, and stream connects p95 < 1 s                                                  |
| `3x`    | 3×   | 15 min | 675 (336)                            | refusals allowed, but as 503 with `Retry-After` in p95 < 100 ms; nothing else fails      |

1× is 0.75 home-screen opens a second, 0.5 menus, 0.25 searches and 0.25 orders (plan §7.1 measured
launch night at 45.6 requests a second in all). `duration` and `k` on the Run form override a profile's
length and rate.

**1× minus one machine** is the `1x` profile with one web machine stopped by hand partway through
(`flyctl machines stop <id> --app driver-api-staging`); pass is errors < 1 % over the two minutes after.

## What the virtual users do

All in `scripts/load/k6/launch.js`, sending exactly what the apps send (tRPC batches, superjson):

- **App visits** (arrival rate): the home screen's queries in the app's two parallel batches → a third
  search → two thirds open a menu → half of those order (`orders.quote` → `orders.place`, cash, baskets
  under the new-customer cash cap) and poll `orders.get` every 2 s until the kitchen answers.
- **Live orders**: one virtual user per order on its way; `orders.mine` + `orders.history` every 15 s,
  `orders.track` + `orders.courierPosition` + `chat.threads` every 30 s; a new order when one ends.
- **Tracking streams**: the same with `live.order` open over SSE, polls every 60 s as the app does with
  the stream on; the stream is reopened every 10 minutes (a stream token lasts 15).
- **Kitchens**: one per launch kitchen; heartbeat and board every 30 s, accept new orders at 10 minutes'
  prep, mark them ready when that time is up. Setup opens the four kitchens all day for the run;
  teardown puts each kitchen's days and closures back.

## The people it runs as

`scripts/load/prepare.mjs` writes 1,500 load customers (`load_c_…`) and one owner per launch kitchen
(`load_m_…`) with made-up numbers in +964 7999 1xxxxx / 2xxxxx; their phone hashes are unpeppered, so
nobody can ever sign in as them. It then makes fresh sessions: the refresh tokens are generated on the
runner and only their SHA-256 reaches the database, exactly as the API stores them. k6 trades each for an
access token through the real `identity.refresh`, so no signing key leaves Fly. A refresh token rotates
on use, so every virtual user and every app visit has a session of its own (`--profile` works out how
many). After the run every load session is ended, whatever happened.

The tokens file never leaves the runner: nothing prints it, the only upload is k6's summary, and k6's
setup data holds kitchen hours only. The repository is public: keep it that way when changing the kit.

## Locally

Against a local API on Postgres (as in CI's `e2e-postgres` job, seeded with `pnpm db:seed`), with k6 built
with the SSE extension (`xk6 build v1.3.0 --with github.com/phymbert/xk6-sse@v0.1.11`):

```sh
node scripts/load/prepare.mjs --customers 300 --profile smoke --out .load
k6 run -e LOAD_PROFILE=smoke -e LOAD_TOKENS=$PWD/.load/tokens.json -e LOAD_WORLD=$PWD/.load/world.json \
  --summary-export .load/summary.json scripts/load/k6/launch.js
node scripts/load/summary.mjs .load/summary.json smoke
node scripts/load/prepare.mjs --revoke
```

`prepare.mjs` refuses any database that is not local unless `LOAD_TARGET=staging` and
`DEPLOY_ENVIRONMENT=staging`.

## Still to come

- Couriers: online drivers taking offers, 20 GPS fixes a second at 1× (`trips.reportPositions`), pick-up and
  hand-over, so orders finish instead of waiting for a courier.
- Six weeks of history (≥ 45,000 orders, 1,500 customers weighted by how often they order) seeded before
  the run, since "my orders", menus and history get slower as orders pile up.
- The 1,500-sign-in spike from 3 addresses and the probe herd (1,500 clients probing `health.ping` during a
  2-minute 503 storm).
