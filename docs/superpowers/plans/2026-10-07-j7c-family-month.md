# J7c — family hub «بيتنا» and «شهرك»: implementation plan

> **For agentic workers:** implement task by task, TDD for logic, commit after every task (plain-English
> message ending in the Co-Authored-By line). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the household becomes a place («بيتنا»): who is in it, who orders on the household wallet, a
monthly budget per member that the server enforces at order placement by asking the payer (never a
silent block), this month's spend per member and the family's shared table orders. And a private
monthly page («شهرك») computed on the server from real orders, rides, الرجعة trips, savings and points.

**Spec:** `docs/specs/2026-10-05-customer-joy.md` §5.7 (w4, w6), §6 rules, §8 testing. Design source:
`docs/research/ui-ux-audit/2026-10-05-joy/4-rajaa-wallet-account.md` (A-04, A-05, S-4, S-5) and
`6-delight-strategy.md` (month-start rhythm; "What not to do": no eating-volume gamification, discovery
and family stats instead). Builds on J5d (`2026-10-06-j5d-rajaa-wallet-account.md`: approvals with
context, the wallet's «وفّرت», the safety page) and J5a (`2026-10-06-j5a-food.md`: «للسفرة» lines).

**What exists today (read before building):**
- `modules/orgs`: households with `payer | orderer | member` roles and a per-order `spendingLimitIqd`;
  `requestPayerApproval` / `resolvePayerApproval` exist and J5d shows the request with context — **but
  nothing calls `requestPayerApproval` at order placement**, and `orders.place` accepts any
  `householdOrgId` without checking membership. The customer checkout never sends `householdOrgId`.
- `ledger/customer-wallet.ts` `savedThisYear()` is the w10 «وفّرت» sum.
- J5a «للسفرة» lines are cart-only: on the wire they look like the orderer's own lines.

**Architecture:**
- **Budget rule, server-side.** `org_members.monthly_budget_iqd` (null = none). At `orders.place` with a
  `householdOrgId` the server checks: the orderer is a member with role `payer` or `orderer`
  (`household_cannot_order` otherwise); the order is a kitchen/shop order (rides and errands can't wait
  for a yes: `household_wallet_food_only`); then the pure `householdApproval({ role, orderLimitIqd,
  monthlyBudgetIqd, monthSpentIqd, totalIqd })` (contracts, shared with the checkout hint) decides
  `null | 'order_limit' | 'month_budget' | 'both'`. When a reason comes back the order is created and
  **held** (`orders.held_for_payer = true`, state stays `placed`, the kitchen is not offered it), the
  approval request is written in the same transaction with its reason, and a timer cancels it free after
  `HOUSEHOLD_RULES.approvalWaitMin` (30) without an answer. Approve → the kitchen gets it (now, or at
  the scheduled offer time); decline → `platform_cancelled` (`payer_declined`), free. A customer cancel
  of a held order withdraws the request (`withdrawn`). Payers are never limited. This is a household
  spending limit: prices, fees, points and ledger postings are untouched (the order settles exactly as
  any household-wallet order does today).
- **Month spend** = the member's household-wallet orders placed this Baghdad month that were not
  refused or cancelled (held ones included, so two orders can't slip under the budget together); one
  pure function `householdMonthSpend` used by placement and by the hub.
- **Family table**: `PlaceOrderInput.familyTable` (true when the cart has «للسفرة» lines) →
  `orders.family_table`. The hub's «سفرة البيت» lists this month's family-table orders of every member
  plus household-wallet orders (payer: everyone's; others: their own).
- **«شهرك»** = new `insights` API module (reads orders, orgs/catalog names, الرجعة bookings and the
  ledger): `wallet.month({ month? })` → meals, kitchens tried, top kitchen, top dish, rides, الرجعة trips,
  saved (the same `savedBetween()` that w10's `savedThisYear()` now calls), points earned. The warm line
  is picked in the app from those counts (copy lives in i18n). Private: no share.
- **Month-start card**: in the app, days 1–3 of a month, on the wallet and account, when last month had
  activity, once per device per month, never on a quiet day. Push only to people with marketing on:
  `MonthCardJob` emits `insights.month_ready` (idempotency key per person + month) on the 1st after 10:00
  Baghdad → notify template `month_ready` (category `marketing`: preference, weekly cap, quiet hours and
  quiet days already enforced by the notify engine).
- **Payer push**: `org.payer_approval_requested` → `household_approval` («طلب من منار يحتاج موافقتك»).

**Tech stack:** Expo Router (SDK 52, installed packages only), `@driver/ui` (Istikan theme, `SketchScene`),
NestJS modules (in-memory + Prisma repositories), zod contracts, Vitest.

**Not in this slice:** live member status on the hub (S-4 avatars with «بالطريق»; needs per-member
opt-in, later), family points pooling (a ledger rule, needs Ali), contact-picker/WhatsApp invite (A-05),
household wallet for rides/errands (no waiting state for a driver search), a year story (g9).

---

## File map

| Area | Files |
|---|---|
| Contracts | `account-io.ts` (member budget/spend, `SetBudgetInput`, approval `reason`/`withdrawn`/month figures, `HouseholdView.month`, `MonthInsightsView`, `MonthInput`, `InsightsPort`), `household-budget.ts` (+test: `householdApproval`, `HOUSEHOLD_RULES`, Baghdad month helpers), `order.ts` (`heldForPayer`, `familyTable`), `routers/account.ts` (`household.setBudget`, `wallet.month`), `trpc.ts` (`insights`), `errors.ts`, `notify-io.ts` (`household_approval`, `month_ready`) |
| DB | `schema.prisma`; migration `20261007150000_j7c_household_budgets` (ALTER only + enum value + index) |
| API | `modules/orgs` (budget, reason, withdraw, `setBudget`, month view via bound reader), `modules/orders` (placement check, hold, decision, timer, cancel withdraw, `householdOrdersBetween`), `modules/ledger/customer-wallet.ts` (`savedBetween`), new `modules/insights` (service, month-card job, module binding), `modules/notify` (two mappings), `trpc/trpc.module.ts`, `app.module.ts` |
| Customer | `app/household/{index,member}.tsx`, `features/account/{ApprovalCard,family,month}.ts(x)`, `app/month.tsx`, `app/(tabs)/{wallet,account}.tsx`, `app/checkout.tsx` + `features/food/checkout.ts` (household row, `familyTable`), `features/track/timeline.ts` (held line), `scripts/demo-api.mjs`, `scripts/web-shots.mjs`, README |
| Copy | `packages/i18n/src/locales/{ar-IQ,en}.json` |
| Docs | `docs/api/family-and-month.md` |

---

### Task 1 — contracts, rule and migration
- [ ] Test `household-budget.test.ts`: `householdApproval` (payer never; null limit/budget = none; over
  the order limit; over the month with the order; both; exactly at the limit is fine); `baghdadMonth(at)`
  (`2026-09-30T21:30Z` → `2026-10`), `baghdadMonthRange('2026-10')`, `previousMonth`.
- [ ] `household-budget.ts`; `account-io.ts` views and inputs; `Order.heldForPayer?`,
  `PlaceOrderInput.familyTable?`; errors `household_cannot_order`, `household_wallet_food_only`.
- [ ] Prisma: `OrgMember.monthlyBudgetIqd`, `PayerApproval.reason`, enum `withdrawn`, `Order.heldForPayer`,
  `Order.familyTable`, index `(household_org_id, placed_at)`; migration ends with `driver_harden`. Commit.

### Task 2 — orgs: budgets, reasons, withdraw, the hub view
- [ ] Tests (orgs.service / households.rpc): `setMonthlyBudget` (payer only, not on a payer,
  `org.member_budget_set`); `requestPayerApproval` keeps `reason`; `withdrawApproval` (pending →
  withdrawn, idempotent, resolved stays); `mine` → members carry `monthlyBudgetIqd` and `monthSpentIqd`
  (payer sees all, others only their own, null otherwise); `month.tableOrders` filtered by viewer;
  approval view carries `reason`, `monthBudgetIqd`, `monthSpentIqd`; decision hook called after approve.
- [ ] Repos (in-memory + Prisma) map the new columns. Commit.

### Task 3 — orders: the budget at placement
- [ ] Tests (orders.service): non-member / `member` role refused; ride with a household refused; within
  limits → offered to the kitchen; over → held, not offered, approval with reason, `order.awaiting_payer`;
  month spend counts earlier household orders (not cancelled ones); approve → offered (scheduled → at its
  time); decline → `platform_cancelled` free with `payer_declined`; no answer after 30 min → cancelled
  `payer_no_answer` and withdrawn; customer cancel of a held order → free, withdrawn; `familyTable` stored.
- [ ] `OrdersRepository.householdOrdersBetween` (+ Prisma), `OrderRecord.heldForPayer/familyTable`.
- [ ] `OrdersModule.onModuleInit` binds `households.bindDecision(...)`. Commit.

### Task 4 — «شهرك» on the server
- [ ] Refactor `savedThisYear` → `savedBetween(account, events, from, to)` (w10 test unchanged).
- [ ] Tests (insights.service): meals = delivered food orders of the month; kitchens tried; top kitchen
  (ties → latest); top dish by orders that had it; rides completed; الرجعة trips completed; saved =
  `savedBetween`; points earned (earned + organiser bonus); another person's orders never count; month
  validation (future / more than 12 back → `invalid_input`).
- [ ] `modules/insights` (service + module binding the household month reader); `ctx.insights`,
  `wallet.month`. Commit.

### Task 5 — pushes
- [ ] Tests: notify mapping `org.payer_approval_requested` → `household_approval` to the payer;
  `insights.month_ready` → `month_ready`; `MonthCardJob.tick` only on the 1st after 10:00 Baghdad,
  only people with activity last month, idempotency key `insights.month_ready:<person>:<YYYY-MM>`.
- [ ] Templates + copy. Commit.

### Task 6 — app: «بيتنا»
- [ ] Test `features/account/family.ts`: `budgetBar(spent, budget)` (fraction clamped, over flag),
  `memberLine` order (payer first, me next), `roleOrders(role)`.
- [ ] Hub: header (name, members, role), «هالشهر» bullet bars (single hue, tick = budget, labels in
  text tokens), approvals, members with «يطلب على حساب البيت / يستخدم أماكن البيت بس», «سفرة البيت
  هالشهر», trusted people row → `/profile/safety`, children, shared places. Loading/empty/error/offline.
- [ ] Member editor: per-order limit presets 10,000 / 25,000 / 50,000 / بلا حد, monthly budget presets
  50,000 / 100,000 / 150,000 / بلا حد + custom, «هالشهر صرف …». ApprovalCard: reason lines and the
  `withdrawn` pill. Commit.

### Task 7 — app: checkout and tracking
- [ ] Checkout: «من حساب البيت» row for payers/orderers (balance; «يروح لـ{payer} يوافق» hint from
  `householdApproval` on the household view's numbers); `familyTable` sent when the cart has «للسفرة».
- [ ] Track: a held order says «ننتظر موافقة حساب البيت» (status + timeline note; test). Commit.

### Task 8 — app: «شهرك»
- [ ] Test `features/account/month.ts`: `warmLine(view)` key choice; `monthCardDue(now, seen, quiet)`
  (days 1–3, not seen this month, not quiet); month label/back-forward bounds.
- [ ] `app/month.tsx` (sketch scene, stat tiles, top kitchen/dish, saved, points, warm line, month
  stepper; private, no share), wallet row + account row, the month-start card. Commit.

### Task 9 — demo, docs, shots
- [ ] `demo-api.mjs` `POST /demo/family?personId=…`: budgets (منار 25,000 per order + 100,000 a month,
  حسين 10,000 + 50,000), a month of household orders (منار and حسين on the household wallet, a family-
  table order of yours), a held order of حسين over his budget, last month's history for «شهرك» (meals at
  three kitchens, a ride, a الرجعة trip, savings, points). README hooks; `docs/api/family-and-month.md`.
- [ ] `web-shots.mjs` `family-*` group at 390 and 360. Commit.
