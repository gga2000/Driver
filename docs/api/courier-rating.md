# Rate the courier (2026-10-07)

Closes the before-launch gap "customers can't rate the courier yet" (`docs/before-launch.md` §6),
following the customer app spec's two-tap rating ("delivery and food separately",
`docs/specs/2026-10-03-customer-app.md` §4). The delivery score already existed on the order; now it is
also the courier's own rating, with one-tap reasons, and it feeds his scorecard and the average on his
card.

## Rules (`RATING_RULES`, `packages/contracts/src/order.ts`)

| Field | Value | Meaning |
|---|---|---|
| `windowHours` | 24 | a scored rating is taken until 24 h after the order reached him (`deliveredAt`); later is `rating_window_closed` — the same 24 h as the tip after a good rating, so a tip always follows a rating that counted |
| `minCountShown` | 5 | the courier card shows his average only from 5 ratings (one early 1-star never brands a new courier) |
| `averageOf` | 50 | the average and the scorecard read his newest 50 |

## `orders.rate` (extended)
`orders.rate({ orderId, delivery?, food?, tags?, courierReasons?, note? })`

- Only the orderer (`forbidden` otherwise). Once per order: the first rating stands, a second call
  returns the order unchanged.
- `courierReasons` (≤ 5) need a `delivery` score and must be the set offered under it
  (`courierReasonsFor(score, ride)`), else `invalid_input`:
  - 1–3: `late` تأخر, `rude` ما كان لطيف, `mishandled` الطلب انضرب أو انكب (deliveries),
    `hard_to_reach` ما كان يرد, `unsafe_driving` سياقته خطرة (rides);
  - 4–5: `polite` خلوق ومحترم, `fast` سريع, `careful` حافظ عالطلب (deliveries), `found_us` لگانا بسهولة,
    `safe_driving` سياقته هادئة (rides).
- With a delivery score and a driver who carried it (`trips.courierOf`), one `courier_ratings` row is
  written in the same transaction: `{ orderId, tripId, driverId, customerId, score, reasons, ratedAt }`
  (unique per order; ids only, no names). A food-only rating writes none. The order's own `rating`
  keeps `courierReasons` too.
- The plain "close early" call (no scores) is not a rating and is still accepted after the window.

## Where it shows
- Partner scorecard (`driverAccount.scorecard`): the `rating` metric now reads his own
  `courier_ratings` rows (newest 50) instead of walking his trips' orders.
- Customer courier card (`orders.track` → `courier.rating`, `ratingCount`): his average, one decimal,
  from 5 ratings.
- Customer app (`apps/customer/src/features/track/Arrival.tsx`, `rating-logic.ts`): step 1 is the
  courier — his stars, then «شنو اللي ما عجبك بـ عباس؟» (1–3) or «شنو عجبك بـ عباس؟» (4–5) with the
  chips («اختياري، يساعدنا نخلي التوصيل أحسن») and «كمّل» / «دز التقييم»; step 2 the food (kitchen orders).
  A low courier score still offers «افتح شكوى»; a late courier opens `cold_or_late`, others `other`.
  The tip after a good rating is unchanged (`docs/api/tips.md`).

## Database
`courier_ratings` (migration `20261007210000_courier_ratings`, hardened with `driver_harden`): unique
`order_id`, index `(driver_id, rated_at)`, no foreign keys (orders and trips belong to their modules).

## Tests
`apps/api/src/modules/orders/courier-rating.test.ts` (row, once per order, only the orderer, the
window, the reasons, the average), `apps/api/src/modules/driver-account/driver-account.service.test.ts`
(scorecard reads his rows), `apps/customer/src/features/track/rating-logic.test.ts`.
