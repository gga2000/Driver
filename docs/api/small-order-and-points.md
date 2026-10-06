# Small-order fee and points at checkout

Customer joy J1d/J1e, 2026-10-06. Decisions by Ali (2026-10-05): **J-D6** small-order fee 500 دينار,
**J-D10** points pay the delivery fee first, then the service fee. Spec: `docs/specs/2026-10-05-customer-joy.md`.
Plan: `docs/superpowers/plans/2026-10-06-j1d-food-points.md`.

## Small-order fee (J-D6)

- An order whose items (menu prices, before any deal; free-text lines count 0) are below the restaurant's
  `minOrderIqd` is **accepted** and carries `smallOrderFeeIqd` = the city money rule
  `MoneyRules.smallOrder.feeIqd` (Aziziyah: 500). At or above the minimum, or a restaurant without one: 0.
  `orders.place` no longer answers `order_below_minimum`.
- Rule: `smallOrderFeeIqd(items, minOrderIqd)` in `@driver/contracts` (`small-order.ts`); orders config
  `ORDERS_RULES.smallOrder`.
- Fixed at placement and stored on `orders.small_order_fee_iqd`; a partial accept keeps it.
- `orders.quote` returns `smallOrderFeeIqd` and `smallOrder: { minOrderIqd, feeIqd } | null` (the cart's
  progress strip and the price line's reason «الطلب أقل من 5,000 دينار»).
- `catalog.restaurants` / `catalog.menu` cards carry `smallOrderFeeIqd` (0 without a minimum) for the facts
  line «طلب أقل من 5,000 دينار عليه رسوم 500 دينار».
- Ledger: the closing money fact passes `smallOrderFeeIqd`; `postOrderClosed` books it as `service_fee`
  (memo `small_order`) to the platform; it counts as platform revenue for points.

Example: Khalid (minimum 5,000), one tikka wrap 2,500 to a mid zone → 2,500 + delivery 1,000 + service 500 +
small-order 500 = **4,500**.

## Points at checkout (W-02, J-D10)

- 100 points = 1,000 دينار (`MoneyRules.points.pointValueIqd` = 10).
- `orders.quote` returns `points: { balance, usable, valueIqd } | null`: the customer's free points (ledger
  points balance less points held by his open orders), how many this order could take, and what they are
  worth. `usable` = min(free points, ⌊(delivery fee − free-delivery deal + service fee) / 10⌋,
  ⌊price after discounts / 10⌋). Null when he has none or the order cannot take any.
- `usePoints: true` on `orders.quote` / `orders.place` spends them: `pointsIqd` comes off the delivery fee
  first, then the service fee (`pointsRedemption` in `@driver/contracts`). Never the dishes, the small-order
  fee or the tip. Merchant orders (food, catalog grocery) only.
- `orders.place` takes the shown `pointsIqd` as an expectation: a different server figure is
  `price_changed` (the app re-quotes). The order stores `orders.points_redeemed`; the view returns
  `pointsRedeemed` and `pointsIqd`.
- Ledger: the closing money fact passes `pointsRedeemed`; `redemption()` (same contracts rule) posts
  `promo_funded` platform → customer, memo `points:delivery_fee` then `points:service_fee`, and the points
  group `points_redeemed`.

Example: items 15,000 + delivery 1,000 + service 500, 400 points free → 150 usable, 1,500 off
(1,000 delivery + 500 service) → **15,000**. With a free-delivery deal: 50 points, 500 off the service fee.

## Points this order earns (`orders.quote` → `pointsEarn`, joy o7)

`pointsEarn` is what the order will be allocated when it closes: `orderPoints` on
`platformRevenueIqd` (the service fee + the commission on the items after an items deal; a ride's take on
its total), 1 point per 100 دينار, capped at 50 with the organiser bonus inside the cap. The close posts
with the same function, so the estimate and the allocation agree (test: `points.test.ts`). The app shows
it as «تكسب {n} نقطة» in the cart and at checkout (on a group order «هذا الطلب يجيب {n} نقطة، تتقسم
عليكم»). Example above: 500 + 15 % of 15,000 = 2,750 → **27 points**. No money rule changes.
