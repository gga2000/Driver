# Merchant late reject credit (M-17)

**Status: ON** (Ali, 2026-10-08: "Yes, 500"). The switch lets ops stop it without a release.

Rule (`docs/specs/2026-10-02-dispatch-and-pricing-detail.md`, line 19): a merchant who rejects an order
**after accepting it** takes a scoring hit, and the customer gets **500 دينار** credit funded by the merchant.

- Switch: `MoneyRules.merchantLateRejectCredit.enabled` (`packages/contracts/src/ledger-rules.ts`),
  `true` in `AZIZIYAH_MONEY_RULES`. Amount: `ORDERS_RULES.merchantLateRejectCreditIqd` (500).
- Event: `order.rejected` (`OrderRejectedPayload`, contracts domain events) now carries `orderId`,
  `occurredAt`, `customerId`, `householdId?`, `merchantOrgId`, `afterAccept`, `customerCreditIqd`,
  `creditFundedBy`. `customerCreditIqd` is 500 only when the reject is late **and** the switch is on;
  otherwise 0 and `creditFundedBy: null`, so the event never claims a credit that will not post.
- Ledger: `postMerchantLateReject` posts one `cancellation_fee` line, `merchant_cash:<merchantOrgId>` →
  `customer:<customerId>`, memo `merchant_late_reject`, group `order:<orderId>:merchant_late_reject`
  (idempotent on redelivery). The customer's wallet shows it as credit; the merchant's statement shows
  it as a fee on that order. Mirrors M-15 (`postDriverCancelled`, `driverCancelCredit`).
- Push: there is no customer push for a merchant rejection today (lane D is adding one). It needs a
  credit variant (`order_rejected_credit`, like `ride_driver_cancelled_credit`) that names the 500.
