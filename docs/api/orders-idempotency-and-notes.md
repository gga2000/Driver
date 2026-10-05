# No duplicate orders, and kitchen vs courier notes (2026-10-05)

## `orders.place`: `clientRequestId` (additive, optional)

The customer app makes one key per checkout attempt (`chk_<time>_<random>`, rides `ride_…`; 8–64
characters of `[A-Za-z0-9_-]`) and sends it with every try of that attempt.

- A repeated key from the same orderer answers with the order that key already placed: the same view
  `orders.get` returns. Nothing is priced, reserved (merchant deal budget), offered to the kitchen or
  evented a second time.
- Concurrent calls with one key place one order: an in-process lock per (orderer, key), then inside
  the transaction a Postgres advisory lock on `orders.place:<orderer>:<key>` and a re-check, and
  finally the unique index `orders_orderer_id_client_request_id_key`. A losing insert is answered with
  the winner's order.
- The key is scoped per orderer (another person's identical key is a different order). Re-using a key
  for a different order type or restaurant is refused with `invalid_input`.
- No key: placing behaves as before (every call places an order).
- The order view carries `clientRequestId` (null when none was sent).

The app (`apps/customer/src/features/food/place-attempt.ts`) keeps the key, persisted with the cart,
until the answer is known: placed → done; refused with a named code (`price_changed`,
`wallet_insufficient`…) → nothing was placed, the key is dropped; anything else (network drop,
timeout, server failure) → the key is kept, the checkout says "ما راح ينطلب مرتين", and the app
re-sends it once when the screen can and each time the network comes back (never in a loop). The
ride "اطلب" does the same within the screen.

## الرجعة seats: retried `routes.holdSeat` / `routes.bookSeat`

- `holdSeat` for the seats the rider already holds on that departure (unexpired) answers with that
  hold; any other live booking is still `booking_state_conflict`.
- `bookSeat` on a booking already booked with the same payment answers with it (no second
  `seat.booked`); a different payment is still `booking_state_conflict`.

## `orders.place`: `courierNote` (additive, optional, ≤ 300)

`note` is the kitchen's (the merchant card and receipt), `courierNote` the courier's (UI/UX audit
M-09). Stored in `orders.courier_note`; on the order view and `merchant.board` (`BoardOrder.courierNote`,
shown only in the detail sheet). The courier's drop-off stop (`partner` job) shows `courierNote`, or
`note` for orders placed with a single note. `mentionsAllergy(...)` (contracts) flags allergy words
in kitchen notes for the "حساسية" pill — display only, nothing is refused.

Migration `20261005150000_order_idempotency_courier_note`: two nullable columns and one unique index
(no new table, so no `driver_harden` call).
