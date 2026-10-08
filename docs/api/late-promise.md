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

## The promised time — learned minutes, locked at placement (Ali, 2026-10-07)
Decided by Ali on 2026-10-07 ("yes learned data"); before that the promise used the router's raw
minutes.

- Promised time = the kitchen's promised ready time (`promisedReadyAt`, accept + prep) + the kitchen →
  door ride.
- The ride is the **same learned minutes the customer's ETA shows** (`EtaService.minutes`, the one ETA):
  the router's estimate × the correction learned from finished legs for that zone pair, Baghdad-time
  bucket, vehicle and routing basis, **clamped 0.7–1.6**. Nothing learned yet (or a cell with fewer
  than 5 legs, down the whole fallback chain) = factor 1 = the router's minutes.
- **Locked when the order is placed**: `orders.place` stores the ride in whole minutes on the order
  (`orders.promised_ride_min`, migration `20261007195500_order_promised_ride`). Every read after that
  — `orders.track`, the apology sweep, the `order.delivered` subscriber, the at-risk list — uses the
  stored minutes, so the promise and its deadline never move as the city keeps learning or the hour
  bucket turns. A scheduled order is quoted for its slot's traffic bucket (`scheduledFor`), not the
  hour it was ordered.
- The late credit fires against that locked promise. Only the minutes changed: the amounts, the
  10 / 20-minute steps and once-per-delivery are as below.
- Fallbacks: orders placed before the column (null) and an order whose ETA could not be read at
  placement (logged; placing never fails on an estimate) are promised on the router's own minutes
  (`EtaService.baseMinutes`), as before.

## Step one — the apology (no money)
- Due when the clock passes promised time + `apologyAfterMin`, the order is not delivered, not
  cancelled / rejected / failed, and the customer is not marked unreachable (`lateApologyDue`).
- Sent once per order: an `order.late_apology` event (aggregate `late_promise`, idempotency key
  `late_apology:<orderId>`, actor `system`) with payload `{ customerId, promisedAt, etaAt }`. Whoever gets
  there first sends it: a customer reading `orders.track`, or `LateApologySweeper`, which runs
  `TrackingService.sweepLateApologies()` every `LATE_APOLOGY_SWEEP_MS` (default 30,000; 0 turns it off)
  over `orders.listActive`.
- The new time (`etaAt`): the courier's live ETA when he is sharing a fix; otherwise the kitchen (ready
  time, or now) plus the kitchen → door ride the promise used (the locked learned minutes). Rounded up to the minute, at least a
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
  memo `late_promise` (`LATE_PROMISE_MEMO`, `@driver/contracts`). Platform-funded, whoever funded the
  free delivery. A replay posts nothing.
- Wallet: `wallet.transactions` reads that line as kind `late_credit`, «تعويض التأخير · طلب #3808»
  ("Late delivery credit · Order #3808"), for the fee back and the flat 1,000 alike; other
  `credit_issued` lines stay «رصيد مضاف».
- Push (NTF-22): the same transaction logs one `order.late_credit` {customerId, amountIqd} per order
  (idempotency key `late_credit:<orderId>`); notify sends `order_late_credit` «+1,000 دينار رصيد، لأن
  تأخرنا عليك», opening the wallet. No money posted → no event → no push.
- Simulator invariant `late_credit_once_per_delivery` checks once / deliveries only / payer / amount.

## Outputs
- `orders.quote.latePromise`: `{ afterMin, creditIqd, basis } | null` (null only for non-deliveries).
- `orders.track.latePromise`: `{ afterMin, creditIqd, basis, deadlineAt, credit: { amountIqd, at } | null,
  apologyAfterMin, apology: { at, etaAt } | null } | null`.
- `catalog.today.latePromiseMin` = `afterMin` (welcome line).
- Customer copy: `promiseCopy(basis)` in `apps/customer/src/features/track/late-promise.ts` — "أجرة
  التوصيل" wording only for `delivery_fee`; `flat` uses the `promise.*_flat` / `track.note_late_credit_flat`
  keys ("حطينالك 1,000 دينار رصيد"). Amounts always come from the server.
- Late banner (`LateBanner`): before the deadline «إذا ما وصل قبل {time}، نرجعلك …»; once the live ETA
  is past the deadline (`etaPastDeadline`) «الوقت الجديد بعد الموعد، فنرجعلك 1,000 دينار رصيد الساعة
  {deadline}» (`promise.bar_past[_flat]`, the sheet's late note too); once posted «رجعنالك …». The credit
  toast puts «آسفين على التأخير» on its own line (`promise.toast_sorry`).

## Demo hooks
- Customer: `POST /demo/track?personId=…&scenario=late_apology` (promise moved 11 min into the past: the
  next read sends the apology) and `scenario=late_credit` (21 min: the next read posts the credit);
  `scenario=late&pastPromiseMin=<n>` for any point on the bar.
