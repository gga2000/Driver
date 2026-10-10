# Money out: payouts and ledger corrections (Console finance desk)

The ledger already knew how to pay a restaurant, pay a driver and post a hand-written correction.
These procedures put those movements behind the finance role, an audit row and a Console screen. No
amount or money rule changes: the limits are the existing ones.

| Procedure | Kind | Roles | Input | Output |
|---|---|---|---|---|
| `finance.payMerchant` | mutation | `finance` | `{ cityId, merchantId, amountIqd, channel: zaincash \| bank \| ops_round, idempotencyKey (8–128) }` | `{ reference (M-XXXX-XXXX), amountIqd, leftIqd }` |
| `finance.payDriver` | mutation | `finance` | `{ cityId, driverId, amountIqd, channel: zaincash \| agent \| ops_round \| bank, idempotencyKey }` | `{ reference (D-XXXX-XXXX), amountIqd, leftIqd }` |
| `finance.adjust` | mutation | `finance` | `{ cityId, fromAccount, toAccount, amountIqd, reason (5–500), incidentId }` | `{ adjustmentId, status: posted \| pending_second_approval, amountIqd, approvalId }` |
| `merchantAdmin.money.receiveCourierCash` | mutation | the restaurant's owner | see `docs/api/partner-merchant-wave2.md` | `MerchantCashAccount` |

## Paying a restaurant

What the company owes a restaurant is its `merchant_cash:` balance. A payout never goes above it
(`payout_exceeds_balance`), and payouts for one restaurant run one at a time. The settlement reference
comes from the form's `idempotencyKey`: a double click or a retry is the same reference and posts once.
Audit: `finance.merchant_payout` (subject `merchant`).

## Paying a driver

What the company owes a driver is his earnings net of the cash in his hand (`driver:` + `cash:`).
A payout never goes above it (`payout_exceeds_due`); any positive amount up to it may be paid (the
weekly form), not only the amount above the automatic payout line. Payouts for one driver run one at
a time; a retry posts once. Audit: `finance.driver_payout` (subject `driver`).

## Ledger corrections (G-85)

A correction moves money between two different money accounts (`platform`, `bank`, `rounding`,
`driver:`, `cash:`, `merchant_cash:`, `customer:`, `household:`, `promo:`; never points), with a reason
and the support ticket or ledger incident it answers (`adjustment_incident_required` when it is
neither). Up to 25,000 (`MoneyRules.adjustments.secondApproverAboveIqd`) it posts at once
(audit `finance.adjustment_posted`). Above it nothing posts: the request waits in the second-OK queue
(`support.refundApprovals`, kind `adjustment`, audit `finance.adjustment_requested`) until a different
person who holds finance at that moment approves it; it then posts once, in the decision's transaction.
Finance and admin roles are read live at both steps.

## Screens

- Console › المالية: «ادفع» on each restaurant the company owes, and the «تصحيح الدفتر» card.
- Console › a driver's book: «ادفع له» when the company owes him.
- Console › الموافقات: corrections waiting for a second OK, with the two accounts and the ticket.
- Merchant › الفلوس › اليوم: «استلمت منه» on each courier holding the restaurant's cash.

## Where

`MoneyOutService` (`apps/api/src/modules/control-room/money-out.service.ts`) checks roles, fixes the
reference and writes the audit row; `MerchantCashService` and `AdjustmentService` in the ledger module
own the limits and locks.
