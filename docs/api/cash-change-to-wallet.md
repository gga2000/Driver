# "الخردة علينا" — the stated note and change to the wallet (2026-10-05)

Rule and status: `docs/specs/2026-10-03-edge-case-decisions.md` § "Change to wallet when the courier has
no change" (approved by Ali 2026-10-06: 25,000 cap, 50,000 tender limit, extra cash must be named). Shared rules: `packages/contracts/src/cash-change.ts`
(`tenderOptions`, `tenderProblem`, `changeToWalletProblem`), used by the API and both apps.

## Inputs
- `orders.place` — optional `statedTenderIqd` (cash only): the note the customer will hand over. Checked
  on the server's cash total: ≥ total, ≤ total + 50,000 (`MoneyRules.changeToWallet.tenderMaxOverIqd`),
  in 250s; otherwise `tender_invalid`. Part of the same idempotent call (`clientRequestId`): a retry
  returns the order already placed with its note. Stored as `orders.stated_tender_iqd`.
- `trips.completeStop` (drop-off) — `handover.changeToWalletIqd` with `handover.cashCollectedIqd` = the
  whole note. Before the stop is completed the orders module checks it against the order
  (`TripsService.bindHandoverCheck`, bound by `OrdersModule`):
  `change_to_wallet_not_cash` (wallet order / no order), `change_to_wallet_mismatch` (≠ collected − total,
  not in 250s, ≤ 0, or cash above the total sent without it), `change_to_wallet_above_cap` (> 25,000,
  `MoneyRules.changeToWallet.maxIqd`). A completed stop answers a retry with the trip, nothing new.

## Outputs
- `Order.statedTenderIqd`, `Order.changeToWalletIqd` (null when none); `PartnerJobStop.tenderIqd`.
- Events: `stop.completed` carries `changeToWalletIqd`; `order.cash_collected` carries it (top level and
  in the money fact); `order.change_to_wallet` `{customerId, courierId, tripId, amountIqd, collectedIqd,
  totalIqd}` — notify sends `cash_change_credit` ("+7,250 دينار رصيد (الباقي)", deep link the wallet); the
  live fan-out refreshes the customer's `orders.track`.
- Ledger (money group `order:<id>:money`, posted on cash collection, the same lines again on close):
  `cash_collected` (price) + `cash_rounding_credit` (0–249, memo `change_as_credit`) +
  `cash_change_to_wallet` (the extra, memo `no_change`), all `cash:<courier>` → `customer:<id>`. Wallet
  lines: the order, "الباقي رصيد" and "باقي الكاش" (`WalletLineKind` `change_to_wallet`).

## Demo hooks
- Customer: `POST /demo/track?personId=…&scenario=near|arrived&tender=25000[&nochange=1]`.
- Partner: `POST /demo/job?who=courier&step=to_dropoff|at_dropoff&tender=25000`; shots `SHOTS=cash`.
- Console: `POST /demo/cash-change` → the latest order with a no-change credit and its courier.
