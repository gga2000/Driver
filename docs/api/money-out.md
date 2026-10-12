# Money out: payouts and ledger corrections (Console finance desk)

The ledger already knew how to pay a restaurant, pay a driver and post a hand-written correction.
These procedures put those movements behind the finance role, an audit row and a Console screen. No
amount or money rule changes: the limits are the existing ones.

| Procedure | Kind | Roles | Input | Output |
|---|---|---|---|---|
| `finance.payMerchant` | mutation | `finance` | `{ cityId, merchantId, amountIqd, channel: zaincash \| bank \| ops_round, idempotencyKey (8–128) }` | `{ reference (M-XXXX-XXXX), amountIqd, leftIqd }` |
| `finance.payDriver` | mutation | `finance` | `{ cityId, driverId, amountIqd, channel: zaincash \| agent \| ops_round \| bank, idempotencyKey }` | `{ reference (D-XXXX-XXXX), amountIqd, leftIqd }` |
| `finance.adjust` | mutation | `finance` | `{ cityId, fromAccount, toAccount, amountIqd, reason (5–500), incidentId }` | `{ adjustmentId, status: posted \| pending_second_approval, amountIqd, approvalId }` |
| `finance.commission` | query | `finance`, `admin` | `{ merchantOrgId }` | `MerchantCommissionView` |
| `finance.setCommissionTier` | mutation | `finance`, `admin` | `{ merchantOrgId, tier: starter \| base \| featured \| marketing }` | `MerchantCommissionView` |
| `merchantAdmin.money.receiveCourierCash` | mutation | the restaurant's owner | see `docs/api/partner-merchant-wave2.md` | `MerchantCashAccount` |

## A restaurant's commission tier

Money §1 tiers come from the city's money rules: `starter` 5 %, `base` 12 %, `featured` 15 %,
`marketing` 18 % (`pickup` 5 % is the rate of pickup orders, not a tier a store is put on, so the
control refuses it). Ali, 2026-10-11: every new restaurant starts on `starter` for its first two months,
and a restaurant with no tier on file is charged at `starter` too (`ORDERS_RULES.defaultCommissionTier`).
`ops.merchantOnboarding` takes an optional `commissionTier` (default `starter`) and writes the same
audit row. The ledger posts the tier read at delivery and keeps it in the commission memo
(`commission:<tier>`), so a change applies to later orders only. `featured` never changes list order.

`MerchantCommissionView`: `{ merchantOrgId, name, tier, pct, onFile, starterSince, starterDays,
reviewDue, lastChange: { at, byName, from, to } | null, options: [{ tier, pct }] }`. The starter period
counts from the restaurant's onboarding (`orgs.created_at`, the date every merchant already has).
**Nothing switches automatically.** From day 49 (7 weeks; `STARTER_COMMISSION.reviewAfterDays`) on
starter, `reviewDue` is true and the finance desk (`finance.desk` → `commissionDue[]`: `{ merchantOrgId,
name, starterSince, days }`, longest first) shows «سعر البداية قرّب يخلص» with «اختار العمولة»; the
Console store page shows the same card to finance and admins. Picking the same tier again writes
nothing. Nobody sets the tier of a shop he belongs to (`staff_own_account`).
Audit: `store.commission_tier_set` (subject `store`, detail `{ from, to, fromPct, toPct }`).

The Merchant app's weekly statement (`merchantAdmin.money.statement`) carries `rate: { tier, pct,
starterSince }`: «عمولتك هسة 5% · سعر البداية من 12 تشرين الأول».

## Paying a restaurant

What the company owes a restaurant is its `merchant_cash:` balance. A payout never goes above it
(`payout_exceeds_balance`), and payouts for one restaurant run one at a time. The settlement reference
comes from the form's `idempotencyKey` alone (not the day): a double click or a retry, even after
midnight, is the same reference and posts once. The same key with another amount or channel is refused
(`idempotency_key_reused`), never answered as already paid.
Audit: `finance.merchant_payout` (subject `merchant`).

## Paying a driver

What the company owes a driver is his earnings net of the cash in his hand (`driver:` + `cash:`).
A payout never goes above it (`payout_exceeds_due`); any positive amount up to it may be paid (the
weekly form), not only the amount above the automatic payout line. Payouts for one driver run one at
a time; a retry posts once, and the same key with another amount or channel is refused
(`idempotency_key_reused`). Audit: `finance.driver_payout` (subject `driver`).

## Ledger corrections (G-85)

A correction moves money between two different money accounts (`platform`, `bank`, `rounding`,
`driver:`, `cash:`, `merchant_cash:`, `customer:`, `household:`, `promo:`; never points), with a reason
and the support ticket or ledger incident it answers (`adjustment_incident_required` when it is
neither). Up to 25,000 (`MoneyRules.adjustments.secondApproverAboveIqd`) it posts at once
(audit `finance.adjustment_posted`). Above it nothing posts: the request waits in the second-OK queue
(`support.refundApprovals`, kind `adjustment`, audit `finance.adjustment_requested`) until a different
person who holds finance at that moment approves it; it then posts once, in the decision's transaction.
Finance and admin roles are read live at both steps.

## Own accounts

Nobody pays out to, or corrects, his own account: a finance person who also drives is paid by a
colleague, nobody pays a shop he belongs to, a correction may not touch the writer's or the
approver's own accounts (`driver:`, `cash:`, `customer:` with his id, or `merchant_cash:` /
`household:` of an org he belongs to), and an owner who also delivers can't take his own hand-in on
the tablet. Each is refused with `staff_own_account`; a refused second OK leaves the request pending.

## Screens

- Console › المالية: «ادفع» on each restaurant the company owes, and the «تصحيح الدفتر» card.
- Console › a driver's book: «ادفع له» when the company owes him.
- Console › الموافقات: corrections waiting for a second OK, with the two accounts and the ticket.
- Merchant › الفلوس › اليوم: «استلمت منه» on each courier holding the restaurant's cash.

## Where

`MoneyOutService` (`apps/api/src/modules/control-room/money-out.service.ts`) checks roles, fixes the
reference and writes the audit row; `MerchantCashService` and `AdjustmentService` in the ledger module
own the limits and locks.
