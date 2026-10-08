# Shop rules from Ali's picks (2026-10-08)

Ali tapped "Use my picks" on the merchant thread's shop rules card (12:27Z, 2026-10-08). Four of the
picks are server rules; the Merchant app's side (t5, r5, x6, p4) is built in the merchant thread.

| Pick | Rule | Where | State |
|---|---|---|---|
| h5 | A shop whose tablet has sent no heartbeat for **5 minutes** takes no new orders | `orders/shop-load.ts` `tabletOffline`, `orders.place`, the storefront card | live |
| l4 | From **15 waiting orders** (placed, accepted or being made; scheduled ones not yet due don't count) new customers see the shop busy and its promise carries the busy +10 min | `orders/shop-load.ts` `ShopLoad`, `OrdersService.busyExtra`, the storefront card | live |
| c6 | No courier at the pass within **10 minutes** of «جاهز» → the kitchen remakes and Driver pays the first batch | `orders.merchant.remake`, `OrdersStaffService.merchantRemake` | built, **switched off** (`MERCHANT_REMAKE_PAY`) |
| f3 | An instant ZainCash cash-out carries a fee paid by the shop; the nightly payout stays free | — | not built: there is no instant cash-out yet (shops are paid by the nightly payout). Build the fee with the instant cash-out when it comes. |

## h5: tablet offline → paused

- `SHOP_LOAD_RULES.offlinePauseAfterMin = 5`. The tablet's heartbeat is `orders.merchant.heartbeat`
  (every 30 s while the Merchant app is open, `merchants.lastHeartbeatAt`).
- `orders.place` refuses a now-order with `merchant_paused` (the same refusal as an early close or a
  pause window). A scheduled order still goes in: the kitchen is offered it later, by which time the
  tablet may be back (the existing no-answer timer covers it if not).
- The storefront card shows the shop **closed** while its tablet is offline, so customers don't build
  a basket they can't order.
- A shop whose tablet never connected (no heartbeat at all) is not paused by this rule: it has no
  heartbeat to lose (field ops set such shops up first; the 90 s no-answer timer still protects them).
- The heartbeat comes back → the shop opens again on the next read; nothing to switch back on.
- The Merchant app pings only while it is open on a store, so a shop that runs on a phone and leaves
  the app in the background for 5 minutes is paused too. The board's offline strip and the merchant
  thread's t5 wording tell the shop why.

## l4: 15 waiting orders → busy

- `SHOP_LOAD_RULES.busyAtWaitingOrders = 15`. Counted per shop, read at most once every 20 s per API
  instance (the restaurant list asks for every card).
- While it holds, the card says busy (`busy: true`, «مزدحم») and every new promise for that kitchen
  carries the busy-mode +10 min (`MERCHANT_BUSY_RULES.extraPrepMinutes`): the accept, the
  auto-accept, the scheduled offer lead and `kitchenTiming`. It is the same +10 as busy mode switched
  on in the Merchant app, never added twice.
- No money moves; customers can still order.

## c6: remake pay (switched off)

- `orders.merchant.remake({ orderId })` (merchant staff of that shop) → `{ orderId, paidIqd,
  alreadyPaid }`. `orders.merchant.remakeRule` → `{ pay, afterReadyMin }` so the app shows the button
  only when the rule is on, and only from 10 minutes after «جاهز».
- Allowed when: the order is a shop order, still `ready` (not picked up), marked ready at least
  `afterReadyMin` (10) minutes ago, and no courier has arrived at its pickup stop. Otherwise
  `order_state_conflict`; switched off → `money_rule_off`.
- Money: one balanced group `order:<id>:remake`, `credit_issued` platform → `merchant_cash:<shop>`,
  the order's items at menu price (`itemsTotalIqd`), memo `remake:food`, once per order (a second tap
  returns `alreadyPaid: true`). The order itself is unchanged: it stays ready for the courier who comes.
- Event `order.remake_paid` (`merchantOrgId`, `readyAt`, `paidIqd`, `tripId`); the Console's
  `orders.ops.switches` carries `remakePay`.
- Switching it on is Ali's call (money rule): set `MERCHANT_REMAKE_PAY=on`.
