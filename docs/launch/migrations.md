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
| 20261009090000 | scheduled_timers | lane B | #13 |
| 20261009091000 | quotes_expires_at_index | lane B | #13 |
| 20261009092000 | participants_person_id_index | lane B | #13 |
| 20261009100000 | test_kitchen | lane D | BENCH-04 PR |
| 20261009102000 | abuse_limits | lane D | lane D PR (reserved) |
| 20261009104000 | customer_waves | lane D | W5 waves PR (reserved) |
| 20261009120000 | request_offer_wait_terms | trips thread | private car round 2 step 1 (reserved) |
| 20261010081000 | gift_recipient_vault | lane A | W1 small-fixes PR |
| 20261010090000 | seat_taxi_hold | taxi thread | x3 PR (reserved) |
| 20261011090000 | store_closed_until | merchant thread | #19 |
