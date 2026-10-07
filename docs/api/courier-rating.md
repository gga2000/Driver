# Rate the courier (2026-10-07)

Closes the before-launch gap "customers can't rate the courier yet" (`docs/before-launch.md` §6),
following the customer app spec's two-tap rating ("delivery and food separately",
`docs/specs/2026-10-03-customer-app.md` §4). The delivery score already existed on the order; now it is
also the courier's own rating (`courier_ratings`), with one-tap reasons under a low score, and it feeds
his scorecard. The average on his card (joy l2) and the compliments after a good rating (joy l4) were
built alongside and are unchanged.

## Rules

| Rule | Value | Meaning |
|---|---|---|
| `RATING_RULES.windowHours` | 24 | a scored rating is taken until 24 h after the order reached him (`deliveredAt`); later is `rating_window_closed` — the same 24 h as the tip and the compliments after a good rating, so they always follow a rating that counted |
| `COURIER_RATING_MIN_COUNT` / `COURIER_RATING_WINDOW` | 5 / 50 | the card shows his average only from 5 ratings, over his newest 50 (`publicCourierRating`, joy l2) |

## `orders.rate` (extended)
`orders.rate({ orderId, delivery?, food?, tags?, courierReasons?, note? })`

- Only the orderer (`forbidden` otherwise). Once per order: the first rating stands, a second call
  returns the order unchanged.
- `courierReasons` (≤ 5) need a `delivery` score of 1–3 and must be the set offered under it
  (`courierReasonsFor(score, ride)`), else `invalid_input`: `late` تأخر, `rude` ما كان لطيف,
  `mishandled` الطلب انضرب أو انكب (deliveries), `hard_to_reach` ما كان يرد, `unsafe_driving` سياقته
  خطرة (rides). A 4–5 score takes no reasons: the kind words after a good rating are compliments
  (`orders.compliment`, `docs/api/compliments-and-live.md`).
- With a delivery score and a driver who carried it (`trips.courierOf`), one `courier_ratings` row is
  written in the same transaction: `{ orderId, tripId, driverId, customerId, score, reasons, ratedAt }`
  (unique per order; ids only, no names). A food-only rating writes none. The order's own `rating`
  keeps `courierReasons` too.
- The plain "close early" call (no scores) is not a rating and is still accepted after the window.

## Where it shows
- Partner scorecard (`driverAccount.scorecard`): the `rating` metric now reads his own
  `courier_ratings` rows (newest 50) instead of walking his trips' orders.
- Customer courier card (`orders.track` → `courier.rating`, `ratingCount`): unchanged from joy l2 — the
  same delivery scores, read through the tracking module's ratings port.
- Customer app (`apps/customer/src/features/track/Arrival.tsx`, `rating-logic.ts`): step 1 is the
  courier — his stars; 1–3 asks «شنو اللي ما عجبك بـ عباس؟» with the chips («اختياري، يساعدنا نخلي
  التوصيل أحسن») and «كمّل» / «دز التقييم», 4–5 moves straight on; step 2 the food (kitchen orders).
  A low courier score still offers «افتح شكوى»; a late courier opens `cold_or_late`, others `other`.
  The tip after a good rating is unchanged (`docs/api/tips.md`).

## Database
`courier_ratings` (migration `20261007211000_courier_ratings`, hardened with `driver_harden`): unique
`order_id`, index `(driver_id, rated_at)`, no foreign keys (orders and trips belong to their modules).

## Tests
`apps/api/src/modules/orders/courier-rating.test.ts` (row, once per order, only the orderer, the
window, the reasons, his own rows), `apps/api/src/modules/driver-account/driver-account.service.test.ts`
(scorecard reads his rows), `apps/customer/src/features/track/rating-logic.test.ts`.
