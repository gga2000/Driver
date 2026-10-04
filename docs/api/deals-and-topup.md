# Merchant deals at checkout, and cash wallet top-up

Date: 2026-10-04. Builds on `docs/api/partner-merchant-wave2.md` (`merchantAdmin.deals.*` stores, projects
and approves deals) and binds them to orders. Contracts: `packages/contracts/src/{deals,topup-io}.ts`,
`OrderQuote` in `order.ts`; API: `apps/api/src/modules/{promotions,orders,topups}`.

## 1. Merchant deals at checkout

### What applies

A deal is **live** when it is approved, switched on by the merchant, inside `[startsAt, endsAt)`, on one
of its local days and inside its local hours (Baghdad, the instant from the clock port), and has budget
left for the whole discount. Types (`promotions/deal-pricing.ts`, pure):

| Type | Discount | Comes off |
|---|---|---|
| `percent` | `value` % of each covered line (modifiers included), floored per line | items |
| `fixed` | `min(value, covered lines)`, split across them | items |
| `bogo` | covered units sorted dearest first; every second one free at its menu price (the cheaper of each pair) | items |
| `free_delivery` | the whole delivery fee | delivery |

`itemIds` empty = the whole menu; free-text requests are never covered. `minOrderIqd` is on the items total.

**Stacking rule:** one merchant deal per order — the one that saves the customer most (ties: the older
deal) — plus points redemption (ledger, service fee first, then what is left of delivery). Platform promo
codes (money §5) are not issued yet; when one resolves it competes with the merchant deal and the larger
wins. No deal ever stacks with another.

### Server-side only

- `orders.quote` (query, same input as `place`): menu-priced items, server fees, the applied deal
  (`discount {promotionId, funder, target, type, label_ar, label_en, amountIqd}`), `lineSavingsIqd[]`
  (per input line), the rounded `totalIqd`, and `nextDeal {label, missingIqd}` (cheapest unmet minimum,
  for the cart nudge). Nothing is stored or reserved.
- `orders.place` recomputes everything. `discountIqd` sent by the client is only its expectation: a
  different server figure (deal ended, paused, capped, changed) is `deal_changed` (CONFLICT, Arabic
  "العرض انتهى أو خلصت ميزانيته…"); the app refetches the quote and shows the new total. A client never
  sends a discount of its own.
- **Totals in multiples of 500** (G-88; 250 with a 250 component): the discount is lowered until the
  total lands on the step — the funder never pays more than the deal promises. The cut is taken from
  the lines that save most first, so per-line savings stay round (`lineSavingsIqd`, legacy).
- **Presentation (2026-10-04)**: the money above is unchanged, but the customer never sees a "20 %"
  deal that reads as 18.7 %. Each line shows the deal's **exact** saving (`dealLineSavingsIqd`: 20 % of
  15,000 → 3,000), the deal line shows the exact total (`discount.dealIqd`), and the rounding is one
  separate small line "تقريب" (`roundingIqd = dealIqd − discountIqd`, in the quote and on
  `Order.discount`; the stored `discount_meta` keeps `dealIqd`). Rounding direction: always **up**
  (against the deal), exactly as the rule above — so the funder's cost (`discountIqd`, the ledger's
  `promo_funded`) never exceeds the promise and no platform-funded rounding is needed. (The fallback
  "round down ≤ 250, platform-funded" was not adopted: it only applies if this rule conflicted, and
  it does not.) Example: items 21,000, fees 1,250, 20 % deal → 4,200 exact, 22,250 − 4,200 = 18,050 →
  18,250: lines save 3,000 / 1,000 / 200, deal −4,200, تقريب +200; the merchant's deal costs 4,000.
  A partial accept that re-prices the deal drops the split (the receipt shows the kept discount).
- **Cap, atomically:** the deal's `spent_iqd` is reserved inside the order's unit of work with one
  conditional `UPDATE … SET spent_iqd = spent_iqd + :x WHERE id = :id AND (budget_cap_iqd IS NULL OR
  spent_iqd + :x <= budget_cap_iqd)`; zero rows = `deal_changed`, nothing written. No overspend under
  concurrent orders (`deals-topups.integration.test.ts`, `orders/deals.test.ts`). Merchant rejection,
  customer or platform cancellation give the spend back; a partial accept re-prices the same deal on
  the remaining lines (the customer approves that figure) and releases the difference.
- Stored on the order: `discount_iqd`, `promotion_id`, `discount_meta` (funder, target, type, labels).
  `Order.discount` is the receipt line.

### Money (ledger, `postOrderClosed`)

Money fact field `merchantDeal {promotionId, target: items|delivery, amountIqd}` (platform promos keep
`platformPromo`).

- **Items deal** — `promo_funded` merchant cash → customer, memo `deal:<id>`. Commission (G-87) is on
  `items − deal`. Merchant net = items − deal − commission. Courier and service fee unchanged.
- **Free delivery** — the courier still earns the full delivery fee (`delivery_fee` customer → driver);
  the merchant pays it: `promo_funded` merchant cash → customer, memo `deal:<id>:delivery`. Commission
  stays on the full items (delivery is not in the commission base).
- Points earn on platform revenue (service fee + commission after the deal); `merchant.payable_accrued`
  carries `dealIqd` and a net that already subtracts it.

Worked example (base 12 %): items 15,000, delivery 1,000, service 500, 20 % deal → discount 3,000, total
13,500; commission 12 % × 12,000 = 1,440; merchant 15,000 − 3,000 − 1,440 = 10,560; courier 1,000;
platform 500 + 1,440.

Merchant app: `money.today.dealsIqd` = what its deals cost today (items + free deliveries), `netIqd`
subtracts it, `commissionByTier.baseIqd` is after items deals; statement lines carry `discountIqd` with
`discountFunder: 'merchant'` (a platform promo shows as `platform` and does not lower the net), plus
`dealIqd` (the exact deal) and `roundingIqd` (given back by rounding): "الخصم 4,200 عرضك · تقريب +200".

### Customer app

Restaurant page and cart show the deal badges (`RestaurantCard.deals`, server labels: "خصم 20% على كل
المنيو", "توصيل مجاني فوق 15,000 دينار"); cart lines show the price after the deal, the menu price struck
through and "توفّر …" (the exact saving); cart and checkout show the "خصم المطعم" / "توصيل مجاني من
المطعم" line from `orders.quote` at the exact deal and, when the total was rounded, a small "تقريب"
line (`PriceBreakdown`'s reconciliation line); the order screen's receipt does the same; the place call sends `discountIqd` and handles `deal_changed`.

## 2. Wallet top-up with cash

No payment gateway yet: the customer pays cash to a field-ops agent or to the courier carrying his next
order.

| Procedure | Who | Input | Output |
|---|---|---|---|
| `wallet.requestTopUp` | the customer | `{amountIqd}` 5,000–100,000, steps of 1,000 | `TopUpView {topUpId, amountIqd, code (6 digits), qrPayload "DRVTU:<code>", state, createdAt, expiresAt (+24 h), confirmedAt, channel, reference, dailyRemainingIqd}` |
| `wallet.topUpStatus` | the customer | `{topUpId?}` (else his latest) | `TopUpView \| null` — the code screen polls it every 3 s |
| `ops.topUpLookup` / `ops.confirmTopUp` | `field_ops`, `admin` | `{code}` / `{code, amountIqd, idempotencyKey?}` | `TopUpLookupView {amountIqd, state, expiresAt, customerName (first), customerPhoneMasked}` / `TopUpConfirmation {reference T-XXXX-XXXX, walletBalanceIqd, …}` |
| `partner.topUpLookup` / `partner.confirmTopUp` | `courier` | same | same — only for a customer whose live order he is carrying (`topup_courier_not_assigned`) |

Rules: one live code per customer (a new amount replaces it; the same amount returns it); per local day
at most 5 codes and 200,000 IQD requested-or-confirmed; codes expire after 24 h; single use (conditional
`pending → confirmed`, concurrent taps credit once; a retry with the same `idempotencyKey` by the same
agent returns the receipt); the counted cash must equal the requested amount. `code` accepts the QR
payload (`DRVTU:` prefix) and spaces.

Ledger: posting group `topup:<id>`, `credit_issued` into `customer:<id>`, memo
`topup:<channel>:<reference>` (the wallet shows it as "شحن رصيد"); from `bank` for an agent (the company
holds the cash), from `cash:<courier>` for a courier (counts on his cash cap until he settles). Events
`wallet.topup_requested`, `wallet.topped_up` (WhatsApp receipt).

ZainCash: `TopUpRailsPort` (topups module) is the seam; nothing is bound.

Errors: `topup_amount_invalid`, `topup_daily_limit`, `topup_code_invalid`, `topup_expired`,
`topup_code_used`, `topup_amount_mismatch`, `topup_courier_not_assigned`, `deal_changed`.

Persistence: migration `20261004120000_deals_checkout_wallet_topup` — `orders.discount_meta` (JSONB),
table `wallet_topups`.

## Known gaps

- ~~Courier top-up has API only.~~ Done 2026-10-04: the Partner job screen has "الزبون يريد يشحن محفظته" while a courier
  carries a live delivery (code → amount → confirm, the cash cap before and after); Ops mode shares the same desk.
- Platform promo codes still resolve nothing (`MerchantDealsPromotions.resolve`).
- Deals are evaluated at the placement instant: a scheduled order gets the deal live when it is placed.
- No `PromoRedemption` rows yet (order + spend counter are the record); deal auto-stop at the cap is the
  badge disappearing, no event.
- `deals-topups.integration.test.ts` was not run locally (no Postgres here); CI runs it.
