# Owed fees on the next cash order («ينضاف لطلبك الجاي», M-3)

The wallet tells a customer who owes money «نقص كاش من طلب سابق. ينضاف لطلبك الجاي أو اشحن»
(`wallet.owe_body`). Before this change nothing added it: an unpaid cancellation fee stayed on his
wallet until he topped up. With the switch on, his next cash food or shop order collects it.

**Switch:** `CASH_DEBT_COLLECT` (`OrderOutcomeRules.cashDebt.collectOnNext`), **off by default**. It is a
money rule: it waits for Ali. Off, nothing below happens and the wallet line is the only reminder.

## The rule

- **Which orders:** cash, on his own account (no household), food or catalog shop. Wallet orders,
  rides, errands and parcels never carry it.
- **How much:** what his wallet is below 0, in whole 250s (an odd rest stays owed), less what his
  orders not yet at his door already carry. A fee is asked for once: a second order placed while the
  first is on its way carries nothing.
- **When it is fixed:** at placement, on the order (`orders.debt_collect_iqd`). It never changes after.
- **Checkout:** `orders.quote` returns `debtCollectIqd` (absent = none); the app shows it as its own
  line under the total and may send it back with `orders.place` (`debtCollectIqd`). A different figure
  (he paid at an agent, or another order took it) is `price_changed`, so the checkout refreshes.
- **"الخردة علينا":** the note he says he will pay with must cover the total plus the owed fees.

## At the door

- The courier's stop asks for `collectIqd` = order total + owed fees, and names the fees in
  `owedFeesIqd` (absent = none). The trip's cash total includes them.
- The cash he records is checked against total + fees (no-change credit, the discrepancy on
  `order.cash_collected`: `expectedIqd` is total + fees).

## Ledger

In the order's money group (`order:<id>:money`), cash only:

| Line | Amount | From → to | Memo |
|---|---|---|---|
| `debt_settled` | the fees he paid | `cash:<courier>` → `customer:<id>` | `owed_fees` |

The price comes first: the fees settled are `min(fees, cash − no-change credit − rounded price)`. If
he hands over only the price, nothing is settled and the fees stay owed (the next order asks again).
`debt_settled` only ever adds to his wallet, so if he also paid the fees elsewhere in the meantime,
the second payment is wallet credit, never lost.

The courier's cash figures count it (`CASH_IN_TYPES`); it is not his earnings (`SETTLEMENT_TYPES`).

## Wallet

The order is still one line for what it cost; the fees are their own line:
**«سددت الرسوم»** — «رسوم إلغاء كانت عليك، دفعتها كاش ويا هالطلب» (kind `debt`, positive amount).

## Simulator

`customer_cash_rounds_to_250` counts `debt_settled` as part of the cash he handed over. Run with
`CASH_DEBT_COLLECT=on pnpm sim --orders 2000 --seed 1 --ci` to exercise it.
