# Migration ledger

One line per database migration, so parallel threads never pick the same timestamp.

**Before you create a migration**, append a line to the table below: its 14-digit timestamp, its
name, your thread or lane, and the PR. The timestamp must be later than every line already here. CI
(`scripts/ci/check-migrations.mjs`, in the `ci` check) fails a PR whose new migration shares a
timestamp with another migration or is older than the newest migration on `main`. If that happens
after a rebase, the later PR renames its migration folder to a new, later timestamp and fixes its line
here. When two PRs both add lines, whoever merges second keeps both (the union), in timestamp order.

Migrations merged before this ledger started (up to `20261008101500_garage_taxis`) are not listed.

| Timestamp | Migration | Thread / lane | PR |
|---|---|---|---|
| 20261008130000 | vault_accessor_kind | lane A | #20 (merged) |
| 20261008130100 | quote_expiry | lane A | #20 (merged) |
| 20261009090000 | scheduled_timers | lane B | #13 (merged) |
| 20261009091000 | quotes_expires_at_index | lane B | #13 (merged) |
| 20261009092000 | participants_person_id_index | lane B | #13 (merged) |
| 20261009100000 | test_kitchen | lane D | BENCH-04 PR |
| 20261009102000 | abuse_limits | lane D | lane D PR (reserved) |
| 20261009104000 | customer_waves | lane D | W5 waves PR (reserved) |
| 20261009110000 | ledger_events_order_trip_indexes | lane B | DB time limits + speed PR |
| 20261010092000 | on_call | lane E | #14 (merged) |
| 20261010100000 | inbox | lane E | #14 (merged) |
| 20261010130000 | fleet_planned_vehicle | partner app thread | #15 (merged) |
| 20261010131000 | gift_recipient_vault | lane A | #29 (merged) |
| 20261010132000 | seat_taxi_hold | taxi thread (W11) | #31 |
| 20261010230000 | store_closed_until | merchant | #19 |
| 20261010240000 | console_watch | lane E | #37 |
| 20261010260000 | merchant_setup (+ shop rules columns) | merchant | setup PR |
| 20261010270000 | driver_running_balance | lane A | speed PR |
| 20261010310000 | order_debt_collect | lane A | M-3 owed cancel fee |
| 20261010340000 | request_offer_wait_terms | trips thread | private car round 2 step 1 (#41, merged) |
| 20261010350000 | request_wait_clock | trips thread | private car round 2 step 2 (#161, merged) |
| 20261010360000 | request_fetch_person | trips thread | private car round 2 step 3 (#161, merged) |
| 20261010370000 | trip_agreed_items | trips thread | private car round 2 step 4 (#161, merged) |
| 20261010380000 | seat_return_bundle | trips thread | private car round 2 step 5 (#161, merged) |
| 20261010390000 | request_shares | trips thread | private car round 2 step 6 (#161, merged) |
| 20261010400000 | trip_chat | trips thread | private car round 2 step 4c, chat (#161, merged) |
| 20261010470000 | driver_pauses | lane E | #144, merged |
| 20261010490000 | share_boarding | trips thread | shared car way C, who got in (#170, merged) |
| 20261010500000 | refund_approvals | lane A | second OK on big refunds |
| 20261010510000 | handover_notes | lane E | shift handover note on Today (h5) |
| 20261010520000 | outbox_event_id_index | fix wave (event-reads) | event-history reads speed PR |
| 20261010530000 | merchant_staff_invites | PRV-08 (merchant staff accept) | staff join only after accepting the invite |
| 20261010550000 | food_carts | food carts thread | «عربانات»: carts, follows, walk-over tickets |
| 20261010570000 | shopping | shopping thread | stalls' daily prices, bakery items, «صمون كل يوم», weighed and دوّرلي order lines (after 540000 home cooks, 550000 carts, 560000 lane A) |
| 20261010580000 | parcel_sends | parcels thread | طرود: send, receiver sets the door (reserved 10-12) |
| 20261010590000 | home_kitchens | home cooks thread | أكل بيت: `catalog_items.home_sale` (ready today / by reservation). Was 540000; re-stamped after carts landed first (2026-10-12) |
| 20261010600000 | notify_stuck_claims_index | lane D | (status, sent_at) index for the every-minute stuck-send count (#321 follow-up) |
| 20261010610000 | street_closures | lane A | N20 «شارع مسدود», closed streets for today (re-stamped 560000 → 610000; 600000 went to #323's notify index) |

Queue note (2026-10-08, coordinator): #19's `20261010230000` landed ahead of #41 (trips, was `20261010140000`)
and #38 (lane B, `20261010220000`). #38 re-stamps to the next free timestamp when it lands. Trips steps 1–6
re-stamped to `20261010340000`–`20261010390000` (coordinator, 22:37Z); they merge after lane A's `20261010310000`.

Indexes built `CONCURRENTLY` (outbox_event_id_index, notify_stuck_claims_index): if the build fails midway Postgres keeps an
INVALID index that `IF NOT EXISTS` then skips. Fix: `DROP INDEX CONCURRENTLY <name>;`, delete the failed row from
`_prisma_migrations` (`prisma migrate resolve --rolled-back <migration>`), then deploy again.
