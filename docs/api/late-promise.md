# The honest-delay promise — apology at +10, credit at +20 (2026-10-06)

Audit d-5 (`docs/research/ui-ux-audit/customer.md`), two steps decided by Ali on 2026-10-06. Rules are
server config in `MoneyRules.latePromise` (`packages/contracts/src/ledger-rules.ts`), never literals in
the apps:

| Field | Aziziyah | Meaning |
|---|---|---|
| `apologyAfterMin` | 10 | minutes past the promised time when the one apology goes out |
| `afterMin` | 20 | minutes past the promised time when the credit is posted |
| `freeDeliveryCreditIqd` | 1,000 | the credit when the customer paid no delivery fee (free-delivery deal) |

Which orders: food and catalog-grocery deliveries with a promised time (kitchen accepted, kitchen and
door pins known — `promisedArrival` in the tracking module). Every such order carries the promise.

## Step one — the apology (no money)
- Due when the clock passes promised time + `apologyAfterMin`, the order is not delivered, not
  cancelled / rejected / failed, and the customer is not marked unreachable (`lateApologyDue`).
- Sent once per order: an `order.late_apology` event (aggregate `late_promise`, idempotency key
  `late_apology:<orderId>`, actor `system`) with payload `{ customerId, promisedAt, etaAt }`. Whoever gets
  there first sends it: a customer reading `orders.track`, or `LateApologySweeper`, which runs
  `TrackingService.sweepLateApologies()` every `LATE_APOLOGY_SWEEP_MS` (default 30,000; 0 turns it off)
  over `orders.listActive`.
- The new time (`etaAt`): the courier's live ETA when he is sharing a fix; otherwise the kitchen (ready
  time, or now) plus the kitchen → door ride the promise used. Rounded up to the minute, at least a
  minute from now.
- Notify: template `order_late_apology` (category `order_updates`, customer app, push with an SMS twin
  after 60 s undelivered, sent in quiet hours too). Title "آسفين، طلبك تأخر شوية", body "يوصلك تقريباً
  الساعة {time}. تگدر تتابعه من صفحة الطلب"; deep link `driver://order/{orderId}`.
- The live fan-out refreshes the customer's `orders.track`; the late banner's headline then reads
  "آسفين، طلبك تأخر شوية".

## Step two — the credit (unchanged posting)
- Past promised time + `afterMin` (still on the way, or delivered after it) the customer gets wallet
  credit, once per order: posted on an `orders.track` read, or at `order.delivered` by
  `LatePromiseSubscriber` if nobody was watching. None on a cancelled order or while the customer is
  unreachable.
- Amount (`latePromiseTerms`): the delivery fee the customer paid (fee − a free-delivery deal), basis
  `delivery_fee`; when that is 0, `freeDeliveryCreditIqd` (1,000), basis `flat`.
- Ledger: one balanced group `late_promise:<orderId>` — `credit_issued` `platform` → `customer:<id>`,
  memo `late_promise`. Platform-funded, whoever funded the free delivery. A replay posts nothing.
- Simulator invariant `late_credit_once_per_delivery` checks once / deliveries only / payer / amount.

## Outputs
- `orders.quote.latePromise`: `{ afterMin, creditIqd, basis } | null` (null only for non-deliveries).
- `orders.track.latePromise`: `{ afterMin, creditIqd, basis, deadlineAt, credit: { amountIqd, at } | null,
  apologyAfterMin, apology: { at, etaAt } | null } | null`.
- `catalog.today.latePromiseMin` = `afterMin` (welcome line).
- Customer copy: `promiseCopy(basis)` in `apps/customer/src/features/track/late-promise.ts` — "أجرة
  التوصيل" wording only for `delivery_fee`; `flat` uses the `promise.*_flat` / `track.note_late_credit_flat`
  keys ("حطينالك 1,000 دينار رصيد"). Amounts always come from the server.

## Demo hooks
- Customer: `POST /demo/track?personId=…&scenario=late_apology` (promise moved 11 min into the past: the
  next read sends the apology) and `scenario=late_credit` (21 min: the next read posts the credit);
  `scenario=late&pastPromiseMin=<n>` for any point on the bar.
