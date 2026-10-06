# «تحب تكرم عباس؟» — the tip after a good rating (2026-10-06)

Ali's open decision "tips after a 5-star rating", answered "do whatever is best". Cash-first market, so
the app only moves wallet money; a cash tip is handed over at the door and never passes through the app.
Decision line: `docs/specs/2026-10-03-edge-case-decisions.md`, "Phase 3 follow-up decisions".

## Rules (server, `MoneyRules.afterTip`, `packages/contracts/src/ledger-rules.ts`)

| Field | Aziziyah | Meaning |
|---|---|---|
| `amountsIqd` | 500, 1,000, 2,000 | the chips; any other amount is `tip_amount_invalid` |
| `minRating` | 4 | the delivery (courier/driver) score the order must carry |
| `windowHours` | 24 | after `deliveredAt`; later is `tip_window_closed` |

A tip is possible when the caller is the orderer, the order reached him (`delivered`, `closed` or
`completed` — never disputed, refunded, cancelled), it is rated with delivery ≥ `minRating`, no tip was
given at checkout (`tipIqd` 0, else `tip_already_given`), a driver carried it (`courierOf`) and the
window is open. Anything else is `tip_not_offered`. His own wallet must cover it: the ledger balance of
`customer:<id>` less his open wallet orders (charged at close), else `wallet_insufficient`. Household
wallets are never used.

## Procedures
- `orders.tipOptions({ orderId })` → `{ orderId, offered, reason, amountsIqd, walletIqd, untilAt, tip }`.
  `amountsIqd` lists only the chips his wallet covers (empty → the app shows the cash note); `reason`
  (`not_rated`, `low_rating`, `not_delivered`, `window_closed`, `tipped_at_checkout`, `no_driver`) when not
  offered; `tip` is the one already given.
- `orders.tip({ orderId, amountIqd })` → `{ orderId, amountIqd, at, walletIqd }`. One per order: the same
  amount again returns the tip already given (a retry is safe), another amount is `tip_already_given`.
  Serialised per customer (`DistributedKeyedLock` `orders.tip:<customerId>`), so two tips can't spend the
  same balance.

## Ledger
One balanced group `tip:<orderId>` (`afterTipGroupId`): `tip` from `customer:<id>` to `driver:<id>`,
memo `after_rating` (`AFTER_TIP_MEMO`), refs `{ orderId, tripId }` — 100 % to the driver, no take. A
replay posts nothing. Simulator invariant `tip_after_rating_once_and_to_the_driver` (one line, orderer →
the trip's driver, a configured amount, rated ≥ 4, no checkout tip, inside the window); sim customers
who paid by wallet sometimes rate and tip.

## Who sees it
- Driver: event `order.tipped` (`{ customerId, courierId, tripId, amountIqd }`, aggregate `tip`) → notify
  template `tip_received` (Partner, push): «علي كرمك 1,000 دينار» / «إكرامية على طلب #1284، كلها إلك»,
  opens الأرباح. The line is a `tip` on his job (same trip): earnings and the shift summary count it in
  tips, the job receipt shows «إكرامية» (the receipt reads 25 h ahead of the job for it).
- Customer: the rating panel's done step (`TipOffer` in `apps/customer/src/features/track/`), only when
  every score he gave is 4–5: «تحب تكرم عباس؟», «الإكرامية كلها إله، من رصيد محفظتك», the chips, «كرّمه
  بـ 1,000 دينار» and «لا شكراً»; with no chip covered «إذا تحب تكرم عباس، تگدر تنطيه كاش بإيده»; after it
  «وصلت إكراميتك لـ عباس». His wallet lists it as «إكرامية · طلب #1284» (`WalletLineKind` `tip`).
