# Live moments: compliments, the driver's rating, the lock screen (joy J5b, 2026-10-07)

Plan: `docs/superpowers/plans/2026-10-07-j5b-live-moments.md`. No money rule changes; the tip flow
(`docs/api/tips.md`) is untouched and still comes after the rating.

## Compliments after a good rating (l4)

One-tap kind words a customer picks for the courier or driver who brought the order. Presets only, never
free text; no money; one set per order.

| Key | ar-IQ | Offered on |
|---|---|---|
| `fast` | سريع | food, rides, other deliveries |
| `polite` | مؤدب | food, rides, other deliveries |
| `hot_food` | الأكل وصل حار | food (`food`, `grocery_catalog`) |
| `found_home` | لگى البيت بسهولة | food, other deliveries |
| `smooth_ride` | سياقته هادئة | rides |
| `clean_car` | نظيف ومرتب | rides |

Rules (`COMPLIMENT_RULES`, `packages/contracts/src/order-compliment.ts`): the orderer rated the
courier/driver (`rating.delivery`) **4 or 5**, the order reached him (`delivered`, `closed`, `completed` —
never disputed, refunded or cancelled), within **24 hours** of `deliveredAt`, a courier carried it, at most
**4** words from the order type's set.

### Procedures

| Procedure | Who | What |
|---|---|---|
| `orders.complimentOptions({ orderId })` | the orderer (`forbidden` otherwise) | `{ orderId, offered, reason, keys, untilAt, sent }`. `reason` when not offered: `not_delivered`, `not_rated`, `low_rating`, `window_closed`, `no_driver`. `sent` is what he already sent (then `offered: true`, and the app thanks him). |
| `orders.compliment({ orderId, keys })` | the orderer | `{ orderId, keys, at }`. Duplicate keys are dropped. Once per order: a second call — even with other words — returns the first set. `compliment_invalid` (a word not in the order's set), `compliment_not_offered` (rules above). Serialised per order. |
| `driverAccount.compliments` | driving roles, own only | `{ customers, counts: [{ key, count }], recent: [{ keys, at, ticket, orderType }] }` — counts most-said first, the latest 20. Never the customer. |
| `driverAccount.shiftSummary` | driving roles | gains `compliments: [{ key, count }]` for the shift window (`[]` when none). |

### Storage and events

- Table `public.order_compliments` (migration `20261007210000_j5b_order_compliments`): `order_id`
  (unique), `courier_id`, `customer_id`, `order_type`, `keys text[]`, timestamps. Ids and keys only — no
  personal data. Prisma with `DATABASE_URL`, in-memory otherwise (`compliments.repository.ts`).
- Event `order.complimented` (`{ customerId, courierId, tripId, keys }`, aggregate `compliment`,
  idempotency `compliment:<orderId>`) → notify template `compliment_received` (Partner, push, `orders`
  channel, **held through quiet hours**): «كلام حلو عنك من زينب» / «سريع، مؤدب · طلب #1284», opens
  `driver-partner://compliments`. The customer's first name is the vault's logged read
  (purpose `notify_compliment_received`), as for the tip push.

### Apps

- Customer: the delivered screen shows the courier («حيدر وصّلك طلبك», his approved photo); the rating
  panel's done step: thanks + points → «شنو عجبك بـ حيدر؟» (chips, «دزها لـ حيدر», then «وصل كلامك الحلو لـ
  حيدر») → the tip card exactly as before.
- Partner: `/compliments` («كلام الزبائن», from the account hub and the push) and «قالوا عنك بهالشفت» on the
  shift summary.

## The rating on the courier card (l2)

`CourierCard.rating` / `ratingCount` (`orders.track`) were placeholders (always null/0). They now carry the
public rating: `publicCourierRating(scores)` (`packages/contracts/src/tracking.ts`) over the delivery
scores customers gave him on trips completed in the last 90 days — the newest **50** (the scorecard's
window), shown only from **5** ratings, one decimal. Read once per trip and reader (the tracking card
cache). The driver reveal, the courier card and the float show it as «★ 4.8 · 37 تقييم».

## Lock screen (l1)

No API change. The Android ongoing notification is built on the phone from `orders.mine` + `orders.track`
(the same reads as the live screen) and refreshed at once when an order status push
(`order_accepted`, `order_picked_up`, `courier_arriving`, `order_receipt`, `ride_matched`,
`driver_arrived`, `ride_receipt`, …) arrives while the app runs. With the app killed the card keeps its
last words until the app runs again: a headless task (`expo-task-manager`) and data-only order pushes are
the follow-up, as for the الرجعة pass (`docs/api/rajaa-pass-push.md`). iOS Live Activity: designed in the
plan (widget extension + APNs live-activity pushes), not built.

## Demo

- Customer demo API: `POST /demo/track?personId=…&scenario=kitchen`, `/demo/track/kitchen?orderId=…&step=preparing|ready`,
  `/demo/track/assign?orderId=…[&rated=1]`, `&rated=1` on any scenario; taxi/tuktuk drivers come rated.
- Partner demo API: the courier (0770 111 0001) has 14 compliments; `POST /demo/compliments?who=courier[&keys=…]`.
