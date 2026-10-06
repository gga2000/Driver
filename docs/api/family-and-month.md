# Family hub «بيتنا» and «شهرك» (joy J7c, 2026-10-07)

Plan: `docs/superpowers/plans/2026-10-07-j7c-family-month.md`. Ideas w4 and w6 of the joy board.
**No money rule changes**: prices, fees, points and ledger postings are untouched. The monthly budget
is a household spending limit that asks the payer; it never blocks an order silently.

## Household budgets (w4)

- `org_members.monthly_budget_iqd` (null = none; payers have none). Set by a payer with
  `household.setBudget({ householdId, personId, monthlyBudgetIqd })` (event `org.member_budget_set`);
  `household_payer_only` for anyone else, `invalid_input` on a payer.
- Shared rule `householdApproval({ role, orderLimitIqd, monthlyBudgetIqd, monthSpentIqd, totalIqd })`
  (`@driver/contracts/household-budget.ts`) → `null | order_limit | month_budget | both`. Payers are
  never limited; reaching a limit exactly is fine. Month = Baghdad calendar month (`baghdadMonthRange`).
- Month spend (`householdMonthSpend`) = the member's orders on that household wallet placed this month,
  except refused, cancelled, failed and refunded ones. **Placement counts orders still waiting for the
  payer** (two orders can't slip under together); **the hub shows only settled ones** as spent.

### `orders.place` with `householdOrgId`

1. Only a `payer` or `orderer` of that household (`household_cannot_order` otherwise — strangers and
   place-only members). Before J7c any `householdOrgId` was accepted.
2. Kitchen and shop orders only (`household_wallet_food_only` for rides, errands, parcels: a driver
   search can't wait for a yes).
3. Over a limit: the order is created **held** (`orders.held_for_payer`, `Order.heldForPayer`), state
   `placed`, never offered to the kitchen (the merchant board hides it); `payer_approvals` row with
   `reason`, event `order.awaiting_payer`, timer `order.payerTimeout` after
   `HOUSEHOLD_RULES.approvalWaitMin` (30).
4. Payer says yes (`household.approve`) → `order.payer_approved`, offered now (or at the scheduled
   offer time). No → `platform_cancelled`, reason `payer_declined`, free. Silence for 30 min →
   `platform_cancelled`, `payer_no_answer`, free, request `withdrawn`. An answer whose hand-off was
   lost is applied by the timer. The orderer cancelling a held order → free, request `withdrawn`.
5. `PlaceOrderInput.familyTable` (the cart has «للسفرة» lines) → `orders.family_table`.

### Views

- `HouseholdMemberView.monthlyBudgetIqd`, `.monthSpentIqd` (payer sees everyone's; others only their
  own, null otherwise).
- `HouseholdView.month = { month, tableOrders[] }` — «سفرة البيت»: this month's «للسفرة» orders of any
  member plus orders on the household wallet (payer: all; others: their own), newest first, refused /
  cancelled left out, `status: waiting | live | done`. Null when the month can't be read.
- `PayerApprovalView.reason`, `.monthBudgetIqd`, `.monthSpentIqd` (spent before this order);
  `state: withdrawn` («انلغى الطلب»).

### Pushes

- `org.payer_approval_requested` → template `household_approval` to the payer
  («طلب من منار: مطعم خالد · 32,000 دينار»), category `order_updates`.

## «شهرك» (w6) — `wallet.month({ month? })`

`MonthInsightsView` for the caller only, current Baghdad month by default, at most 12 months back
(`invalid_input` otherwise): `meals` (food/shop orders delivered), `kitchens`, `topKitchen {name,
orders}` (ties: latest), `topDish {name, kitchen, orders}` (orders that had it; ties: portions, then
latest), `rides` (completed), `rajaaTrips` (bookings completed in the month), `savedIqd` (the same
`savedBetween` the account header's year uses: points spent, deals, late-delivery credit, change kept),
`pointsEarned` (`points_earned` + `organizer_bonus`), `hasActivity`, `earliestMonth`. The warm line is
chosen in the app (`features/account/month.ts`): safe الرجعة travel, discovering kitchens, a favourite,
savings, thanks — never eating volume. Private: nothing is shared.

- Month-start card (app): days 1–3 of a month, last month, once per device, hidden on quiet days.
- Push: `MonthCardJob` (hourly) on the 1st from 10:00 Baghdad emits `insights.month_ready` with key
  `insights.month_ready:<person>:<YYYY-MM>` for everyone with an order served last month → template
  `month_ready`, category `marketing` (only with marketing on; weekly cap, quiet hours and quiet days
  apply), link `driver://month?month=YYYY-MM`.

## Module map

`modules/orgs` (budgets, reasons, withdraw, hub view through bound readers), `modules/orders`
(placement check, hold, decision, timer; `households.port.ts`), `modules/insights` (new: `wallet.month`,
the month-start job, the hub's month reader), `modules/ledger/customer-wallet.ts` (`savedBetween`),
`modules/notify` (two mappings). Migration `20261007190000_j7c_household_budgets` (ALTER only).
