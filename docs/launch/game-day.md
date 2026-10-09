# Game day: breaking staging on purpose

**In short.** One afternoon before launch, we break the staging copy of the server in the ways launch
night could break it. Each time we check that customers barely notice, that someone is told, and that one
known step puts it right. Nothing real is touched: staging has its own database, Redis and made-up people.
Plan §7.7 sets the experiments and pass lines. This page says how each one is run and judged.

**When:** Thu **26 Nov** (D-11), 14:00–18:00 Baghdad time, the day after device session 2. A failed row is
fixed and run again by **Wed 2 Dec** (D-5). Everything is repeated around D+30.
**Who:** Ali (on call: he reads the alerts on his phone and decides when something is "fixed"); the
platform thread (runs each step and writes the results); one person on a phone with the customer app
(the staging build) placing orders throughout.
**Result:** `docs/launch/game-day-2026-11-26.md`, one row per experiment: pass/fail, what customers saw,
how long until the alert arrived, how long until fixed, and the follow-up for each failure.

## Before the day

| What                                                                                                                                                                                                                                                                                               | Who            | By            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------- |
| Staging at launch layout: Actions → **Staging machines** → `launch`                                                                                                                                                                                                                                | platform       | 26 Nov, 13:30 |
| Background traffic: Actions → **Load test** → `1x`, `duration` 4 h (keeps about 1 order a second flowing)                                                                                                                                                                                          | platform       | 26 Nov, 13:45 |
| Uptime monitor and alert rules point at **staging** for the afternoon (production's come later)                                                                                                                                                                                                    | platform + Ali | 25 Nov        |
| A **Game day** workflow (Actions, environment `staging` only) with one button per fault below, so nobody types server commands by hand. It refuses any app name that doesn't end in `-staging`. **Built** (`.github/workflows/game-day.yml`); try each button once on a quiet day before the 26th. | platform       | 20 Nov        |
| Apps' reconnect probe backs off (5 s → 30 s with jitter, plan W6 SEC-16). Until it does, the "urgent deploy while the DB is down" row is expected to show a probe herd.                                                                                                                            | platform       | 20 Nov        |
| A fresh nightly backup exists (for the restore drill)                                                                                                                                                                                                                                              | platform       | 25 Nov        |

Faults are switched on and off through the workflow (Actions → **Game day** → pick the fault), never on
production. Its buttons by row: 1 `missing-setting`; 3 `redis-blip-20s`; 4 `redis-stop`, then
`restart-one-web`, undo `redis-start`; 5 `push-fail`, undo `push-restore`; 6 `sms-slow`, undo
`sms-restore`; 7 `lock-orders-20s`; 9 `restart-one-web`; 12 `urgent-deploy`. Each run's summary keeps the
times and `health.ready` answers for the results page. Rows 2, 8, 10 and 13 use what already exists (the
Console, Supabase, Actions → Deploy, the backup). Row 12's database block is done by hand in Supabase →
Database settings → Network restrictions (allow only `127.0.0.1/32`; undo: allow all again). Row 11 needs a
way to start the nightly close on demand, which does not exist yet; until it does, that row is run by
hand around the scheduled close time. Each fault has an **undo**
that is run even if the row failed. The afternoon stops early if staging can't be put back.

## The experiments

Order: the gentle ones first, so a broken alert is found before the hard ones.

| #   | Fault (how the workflow causes it)                                                                     | Watch                             | Pass (plan §7.7)                                                                                                                          | Undo                     |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | **Missing setting at boot**: start one extra machine without `REDIS_URL`                               | its log                           | refuses to start with one clear message; the running machines are untouched                                                               | delete that machine      |
| 2   | **Kill switches**: Console → التحكم, stop food in one zone, then one kitchen, then a screen switch     | the phone                         | each shows in the app within 60 s; checkout refuses with the Arabic note                                                                  | switch back on           |
| 3   | **Redis gone for 20 s** under 1 order/s: stop the Redis machine, start it 20 s later                   | phone, load summary, logs, alerts | orders still place; sign-in works; one log line about Redis, not thousands; `ready` alert fires; no API machine leaves rotation           | start Redis              |
| 4   | **Boot with Redis down**: stop Redis, restart one API machine                                          | `health.ready`, alert             | API boots and serves; `ready` shows `redis: down`; alert fires                                                                            | start Redis              |
| 5   | **Phone notifications fail for 10 min**: `EXPO_PUSH_URL` pointed at an address that refuses every call | outbox, alerts, phone             | API stays in rotation; sends are retried with growing waits; push-error alert fires; the order states that matter go by SMS instead (D-9) | unset `EXPO_PUSH_URL`    |
| 6   | **Slow SMS (8 s)**: `SMS_HTTP_URL` pointed at an address that waits 8 s                                | sign-in on the phone              | the code still arrives and verifies; nothing else slows down                                                                              | put the SMS setting back |
| 7   | **Orders table locked for 20 s** (`LOCK TABLE orders`, released after 20 s)                            | phone, load summary               | requests give up at 5 s with a "try again" error; `health.live` still answers in < 500 ms                                                 | the lock ends by itself  |
| 8   | **Database restart** (Supabase → restart project)                                                      | phone                             | the app says "reconnecting", never "sign in again"; `live` fails only while the database is really down                                   | none (it comes back)     |
| 9   | **Machine stopped mid-checkout** (SIGTERM one web machine)                                             | phone, load summary               | the order goes through once (safe replay)                                                                                                 | Fly restarts it          |
| 10  | **Deploy during load**: Actions → Deploy → staging                                                     | load summary                      | no failures beyond in-flight retries                                                                                                      | none                     |
| 11  | **Nightly close on a web machine** (`DRIVER_ROLE=all`, then run the close)                             | its log                           | completes, not cut off at 5 s                                                                                                             | role back to `web`       |
| 12  | **Database down, urgent fix**: block the database, then deploy                                         | Deploy run, phone                 | the normal deploy waits on `health.live`; `fly deploy --strategy immediate` ships the fix; the apps don't stampede when it returns        | unblock                  |
| 13  | **Restore drill** (after the load test stops): last night's backup into a new Supabase project         | the checklist                     | under 1 h; the ledger balances; photos restore                                                                                            | delete the drill project |

"Alert fires" means Ali's phone gets it **within 5 minutes**, and the message says what is wrong in
plain words. An alert that arrives but can't be understood is a fail.

## After

- Staging back to `everyday`, the load test stopped, alerts back on production.
- Results page written the same evening; each fail becomes a fix with an owner and a re-run date before
  D-5. Rows that pass go into `docs/deploy/runbook.md` as rehearsed steps.
