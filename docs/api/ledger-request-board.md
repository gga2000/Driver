# Request-board money (RDB-01/02, 2026-10-08)

A private intercity request (طلب سيارة خاصة) is not a `trips`, `orders` or `departures` row, so its
money must not land in those foreign-key columns (on Postgres the posting failed with an FK
violation and the outbox row ended `failed`). The three payloads that carry it, `RideMoneyPayload`
(`order.closed` / `order.cash_collected`, kind `ride`, take class `intercity_private`),
`order.cancelled` (deposit forfeit on a late cancel or rider no-show) and `departure.cancelled`
(driver no-show, 2× the deposit back to the rider), take an optional `requestId`. When it is set:

- the trip / order / departure id may be left out (a refine refuses a payload with neither);
- the groups are `request:<id>:money`, `request:<id>:points`, `request:<id>:cancel` and
  `request:<id>:driver_no_show`, and their lines carry no `trip_id` / `order_id` / `departure_id`.

Every other payload keeps its own group ids and refs. Rows lost before this change exist only on
staging and CI test data (no production data yet); correcting them would be insert-only postings of
the same groups, not edits.
