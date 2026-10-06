# «أني نازل» — `orders.comingOut`

Customer joy J1b, decision J-D8. When the courier is at the door and can't reach the customer, he
starts the unreachable protocol: dispatcher card at 3:00, "فشل" allowed for the courier at 5:00. The
customer's «أني نازل» moves the courier's "فشل" to 7:00, once per stop.

| Procedure | Who | What |
|---|---|---|
| `orders.comingOut({ orderId })` | the orderer or anyone on the order | `{ extended, failAllowedAt }`. The first call during the countdown sets `trip.unreachable.extendedAt` and moves `failAllowedAt` by 120 s (`UNREACHABLE_EXTEND_SEC`); later calls return `extended: false` with the same time. `forbidden` for anyone else; `unreachable_not_active` when no countdown runs at this order's door. |

Rules:
- Once per protocol run, and a run belongs to one stop: the extension is cleared with the run (hand-over,
  failure of a batched order, trip end).
- The dispatcher's 3:00 rule does not move.
- The `unreachable.allowFail` job at 5:00 stays quiet when extended; a second job (id suffixed `ext`)
  announces `trip.unreachable_fail_allowed` at 7:00. The fail permission is always re-checked against the
  clock (`canFail(startedAt, now, role, extendedAt)`).
- Event `trip.unreachable_extended` `{ stopId, byCustomer, extraMs, failAllowedAt }` on the order.
- Money is unchanged: if the customer still doesn't come, the usual unreachable default applies, later.

The customer app sends the `customer_coming_out` chat quick reply right after, so the courier also reads
it in the thread; the courier's job screen shows «الزبون نازل» while `extendedAt` is set.

Storage: `trips.unreachable_extended_at` (migration `20261006130000_unreachable_extension`).
