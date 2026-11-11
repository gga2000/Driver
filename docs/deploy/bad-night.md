# A bad night: what to press

One page for the moment something is wrong in production. Every fix here is a button: **Actions → Ops →
Run workflow**, pick `production`, pick the action. Nobody types server commands. Each run checks the API
afterwards and writes what it did on its run page. `status` changes nothing, so start there when unsure.

The same buttons work on `staging`, and the game day (26 Nov) rehearses each one there
([game-day.md](../launch/game-day.md), row 15).

## First, two minutes to look

1. **Ops → `status`.** It shows every API and Redis machine (running or not), the last five API releases,
   and which build each web app is showing.
2. **What changed last?** The last Deploy run (Actions), the last phone update (expo.dev), a setting
   changed in Fly. If the trouble started right after a deploy, roll back first and investigate after.
3. Then pick the row below that matches what people see.

## What people see → what to press

| What people see                                                                                                        | Press                                                                  | What it does                                                                                                                                                                | Done when                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything was fine, then a deploy, now errors or a broken screen in every app                                         | **`rollback-api`**                                                     | the API goes back to the image of the release before the running one (blue-green: the old machines keep serving until the new ones pass their health check, about a minute) | the run is green and `health.ready` shows `db: ok`. Press it again to go one more release back; `to` picks an exact version from the `status` list |
| One web site (customer, restaurant or partner) is broken after an update, the phone apps are fine                      | **`promote-previous-web`**, pick the site                              | that site's address goes back to the build before the live one, in seconds (nothing is rebuilt)                                                                             | the site works in a fresh browser tab. Press again to go one more back; `to` takes a deployment id                                                 |
| Orders are placed but nothing moves on: kitchens don't hear of orders, timers don't fire, the nightly close didn't run | **`restart-worker`**                                                   | restarts the worker machine, which runs the timers, queues and nightly jobs; nothing is lost (timers that were due fire when it is back)                                    | the run is green; a test order reaches the kitchen board                                                                                           |
| The run page or `status` shows `redis` not ok; sign-in codes, live tracking or offers to couriers are stuck            | **`restart-redis`**                                                    | restarts the Redis machine (queues and caches only; the database is not touched, and Redis keeps its data on disk)                                                          | the run is green with no Redis warning. Queued work catches up by itself                                                                           |
| Money is wrong or data is leaking: everything must stop now                                                            | not a button: [runbook.md](runbook.md), "Kill switches" (stop the API) |                                                                                                                                                                             |                                                                                                                                                    |

Smaller trouble has smaller switches: one kitchen overwhelmed, one zone, one service. Those are in the
Console (التحكم), listed in [runbook.md](runbook.md), "Kill switches".

## After a press

- **After `promote-previous-web`:** Vercel keeps the promoted build live and stops moving the address to
  new builds by itself. Once the fix is merged and built, open Vercel → the project → Deployments → the new
  build → **Promote**, then check that the next merge goes live on its own again.
- **After `rollback-api`:** the next Deploy run ships main again, so merge the fix first. Migrations are
  never rolled back: ours only add, so the older API keeps working on the newer database.
- Tell restaurants and couriers on WhatsApp what happened, in one line, if they noticed.
- Write down what happened, when, how many orders were affected and the fix, as in [runbook.md](runbook.md),
  "Incident checklist", step 8.

## If a button fails

The run page says why in one line. The usual causes:

| The run page says                                             | Fix                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `secret FLY_API_TOKEN is not set`                             | Fly → Tokens → create an **org** token; **paste it only into GitHub (the production environment's secrets), not into a chat**                                                                                |
| `no machine in driver-redis`                                  | the Fly token is a deploy token for the API only: replace it with an org token (above)                                                                                                                       |
| `secret VERCEL_TOKEN is not set`                              | Vercel → Account Settings → Tokens → create one for the team; **paste it only into GitHub (the environment's secrets), not into a chat**. If the sites are in a team, also set the variable `VERCEL_TEAM_ID` |
| `no earlier image` / `no earlier ready production deployment` | there is nothing older to go back to; use the manual steps in [runbook.md](runbook.md), "Roll back"                                                                                                          |

## Set up once (before launch)

On the `production` GitHub environment (Settings → Environments → production):

- secrets `FLY_API_TOKEN` (an org token, so it reaches both the API and Redis) and `VERCEL_TOKEN`;
- variables `FLY_API_APP` (`driver-api`), `FLY_REDIS_APP` (`driver-redis`), `VERCEL_TEAM_ID` if the sites
  live in a Vercel team, and `VERCEL_PROJECT_CUSTOMER` / `_MERCHANT` / `_PARTNER` only if the project names
  differ from `driver-customer`, `driver-merchant` and `driver-partner`;
- required reviewers (Ali): every press on production then waits for one tap of approval.

The `staging` environment needs the same secrets for the game-day rehearsal (its apps end in `-staging`; the
workflow refuses anything else there, and refuses `-staging` apps on production).
