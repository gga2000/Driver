# What the customer hears at each turn of an order (W2)

Every change of an order's state either sends the customer a message or is silent for a stated
reason. The table lives in code, `apps/api/src/modules/notify/notify.matrix.ts`, one line per
transition of each order family (food and grocery, errands and parcels, rides). Its test fails when the
order machine gains a transition the table does not answer, and runs every line through the real
notify subscribers, so the table can't drift from what is sent.

| Turn | Message | Notes |
| --- | --- | --- |
| A dish is out (BENCH-03) | `order_partial_ask` «بيبسي خلص بمطعم خالد · نرسل الباقي بـ 11,500 دينار، لو تلغي ببلاش» | push at once, SMS at 20 s; opens the kitchen screen, where he answers «أرسل الباقي» or «ألغِ الطلب ببلاش» (`orders.respondPartial`) |
| He didn't answer within the minute | `order_partial_no_answer` | the order is cancelled free (today's rule; Ali's call open) |
| Kitchen said no | `order_rejected` «المطعم ما گدر ياخذ طلبك» | push, SMS after 60 s if the push isn't delivered |
| Kitchen cancels after accepting (M-17) | `order_rejected_credit` «… نزلنالك 500 دينار رصيد بمحفظتك» | the event's `customerCreditIqd`; the ledger posts it, paid by the kitchen |
| Kitchen never answered | `order_kitchen_no_answer` | same; the reject's reason is `merchant_timeout` |
| We cancelled | `order_cancelled`, or `order_payer_declined` / `order_payer_no_answer` for a household order the payer refused or never answered | his own cancel is silent |
| Picked up | `order_picked_up` «حيدر استلم طلبك ويوصلك الساعة 8:40», or `order_on_the_way` (no time) | the time is the order screen's own ETA (tracking `liveEta` from the courier's last fix); else the kitchen → door minutes locked at placement; never a made-up time |
| At the door | `courier_at_door` | the drop-off stop's `stop.arrived` |
| Can't reach him | `courier_unreachable` (push + WhatsApp, SMS after 60 s), `courier_unreachable_reminder` at minute 3 (push, SMS after 30 s) | safety category: can't be switched off, he is charged when the 5 minutes run out |

Only M-17's rejection names a credit, because that credit is posted with the same event.

## Support (NTF-02)

A customer's complaint answered by phone, WhatsApp or in the app (`support.replied`), refunded (`support.refunded`) or closed (`support.resolved`) reaches him as `support_reply` (the words themselves, one line, 140 characters), `support_refund` («رجعنالك 3,000 دينار … بمحفظتك», money: can't be switched off) and `support_resolved`. Each opens the order (`order/<id>`) or Help when the complaint had no order. Held through quiet hours. A chat case is answered inside the order chat, which pushes on its own.

A second test checks that every notify template has a sender in the API (or a written reason, such as
`marketing_offer`, whose sender is not built yet).

## Two minutes away (NTF-21)
- «الدليفري يوصل بعد دقيقتين» goes out once per drop-off, at 300 m, after its food is picked up, and
  only when it is the courier's next door: a batched courier passing a later door on the way to an
  earlier one says nothing there yet (`nextDoor` in trips).
- A cash order hears «جهّز الكاش {amount} دينار إذا تدفع كاش» (`courier_arriving`); an order already paid
  (wallet, prepaid) hears «طلبك مدفوع، بس استلمه من الباب» (`courier_arriving_paid`, WhatsApp
  `wa.courier_arriving_paid` with no amount).

## Money landing in the wallet (NTF-22)
- The honest-delay credit: `order.late_credit` → `order_late_credit` «+1,000 دينار رصيد، لأن تأخرنا
  عليك», like the change credit (`cash_change_credit`). See `late-promise.md`.
- Invite rewards: none are paid while `MoneyRules.referral.enabled` is off (M-5 waits for Ali); their
  message is added together with the switch.
- Points per order: no push. They show on the delivered order's screen and in the wallet, and a push
  for every order would be noise.

## Push on a live host (OPS-02)

With `NODE_ENV=production` and `DEPLOY_ENVIRONMENT` not `staging`, the API refuses to boot unless
`PUSH_PROVIDER=expo`: the dev push answers "delivered" for every message, so the SMS twin would never
go and nobody would know. There, a token with no transport (raw FCM without FCM set up) fails each
message instead, which brings the SMS twin forward. Staging may keep the dev push.
