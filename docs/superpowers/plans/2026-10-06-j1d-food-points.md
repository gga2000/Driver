# J1d Food and checkout + J1e Money and points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer can order below a restaurant's minimum for a named 500 دينار small-order fee, sees deal prices on the menu, gets a minimum-order progress strip with a gap-closing upsell, finds a useful home at night, sees a different drawing per dish, and can spend points at checkout (delivery first, then the service fee).

**Architecture:** Every amount is decided by the API: the small-order fee and the points redemption are computed in `OrdersService.price()` (shared by `orders.quote` and `orders.place`), stored on the order (two additive columns) and passed to the ledger's `postOrderClosed`, which already books both lines. The rules themselves are pure functions in `@driver/contracts` (`smallOrderFeeIqd`, `pointsRedemption`, `percentDealSaving`, `menuDealOf`) so the API, the ledger and the app's display read one rule. The app only displays what the server returns (`orders.quote`, `catalog.menu`).

**Tech Stack:** Zod + tRPC contracts (`packages/contracts`), NestJS API (`apps/api`), Prisma (`packages/db`), Expo customer app (`apps/customer`), design tokens (`packages/design-tokens`), vitest.

Spec: `docs/specs/2026-10-05-customer-joy.md` §2 (J-D6 small-order fee 500, J-D10 points delivery first) and §5.1 (f10–f14, b3). Findings: `docs/research/ui-ux-audit/2026-10-05-joy/2-food-funnel.md` (F-01, F-02, F-04, F-05, F-15, F-17), `1-discovery.md` (D-03), `4-rajaa-wallet-account.md` (W-02, W-11), `5-design-system.md` (S2-07).

**Money rules implemented (approved by Ali, nothing more):**
- **J-D6:** a food/grocery order whose items (menu prices, before any deal) are below the restaurant's `minOrderIqd` is accepted and carries `smallOrderFeeIqd = MoneyRules.smallOrder.feeIqd` (500). At or above the minimum, or a restaurant without a minimum: 0. The fee is fixed at placement (a partial accept does not add or remove it). It is platform revenue (ledger `service_fee`, memo `small_order`, already in `postOrderClosed`). `order_below_minimum` is no longer thrown by `place`.
- **J-D10:** points redeem against the delivery fee first (after a free-delivery deal), then the service fee. `usePoints: true` on `orders.place` makes the server redeem `min(available points, floor((delivery − delivery deal + service fee) / 10), floor(price before points / 10))` points, each worth 10 دينار (100 points = 1,000). Available = ledger points balance − points held by the customer's open orders. The ledger posts the redemption at close with the same function.

**Before you start:** another session works in this repo. Stage only the files each task names (never `git add -A`). Commit on the worktree branch; do not push.

---

## Already done (checked 2026-10-06, skip)

- **F-17** duplicate check on the checkout cash/wallet rows: `apps/customer/app/checkout.tsx` no longer passes a trailing check (only the top-up button); `ListRow` draws the one check. Nothing to do.
- Wallet copy `points.redeem_rule` already says "تنخصم من التوصيل أول"; Task 6 completes it ("وبعدين من رسوم الخدمة").

## Deviation (decided while planning)

- **f12 «خبرني لمن يفتح»** needs a per-merchant interest table, a migration and a push job at opening time — not cheap. Per the brief, the night card shows the first kitchen to open and its time with «شوف المنيو» only. Listed for a later plan.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `packages/contracts/src/small-order.ts` (+ test) | create | `smallOrderFeeIqd(items, min, rules)` |
| `packages/contracts/src/points-redemption.ts` (+ test) | create | `pointsRedemption` (delivery first), `redeemablePoints` |
| `packages/contracts/src/deals.ts` (+ test) | modify | `percentDealSaving`, `menuDealOf`, `dealLinePrice` |
| `packages/contracts/src/order.ts` | modify | `usePoints`, `pointsIqd` on place input; quote + order fields |
| `packages/contracts/src/catalog-io.ts` | modify | `MenuItem.deal`, `RestaurantCard.smallOrderFeeIqd`, `opensInMin` |
| `packages/contracts/src/ledger-io.ts`, `ledger-rules.ts`, `index.ts` | modify | Comments (delivery first; small-order threshold), exports |
| `packages/db/prisma/schema.prisma` + migration `20261006130000_order_small_fee_points` | modify/create | `orders.small_order_fee_iqd`, `orders.points_redeemed` |
| `apps/api/src/modules/ledger/postings.ts` (+ test) | modify | `redemption()` delegates to contracts, delivery first |
| `apps/api/src/modules/promotions/deal-pricing.ts` | modify | Percent saving via `percentDealSaving` |
| `apps/api/src/modules/orders/orders.config.ts` | modify | `smallOrderFeeIqd`, `pointValueIqd` named config |
| `apps/api/src/modules/orders/orders.repository.ts` | modify | New record fields (memory + Prisma) |
| `apps/api/src/modules/orders/orders.service.ts` | modify | Fee + points in `price`, `quote`, `place`, view, money fact, partial |
| `apps/api/src/modules/orders/orders.module.ts`, `test-harness.ts` | modify | Points balance port |
| `apps/api/src/modules/orders/small-order.test.ts`, `points.test.ts` | create | Quote/place/postings tests |
| `apps/api/src/modules/orders/place-guards.test.ts` | modify | Below minimum is now a fee, not a refusal |
| `apps/api/src/modules/catalog/catalog.rpc.ts`, `storefront.ts` (+ tests) | modify | Menu deal prices, fee on the card, `opensInMin` |
| `apps/customer/src/features/food/checkout.ts`, `price-lines.ts`, `queries.ts` (+ tests) | modify | Totals with fee and points; named lines; `usePoints` |
| `apps/customer/src/features/food/upsell.ts` (+ test) | modify | Gap-closing ranking |
| `apps/customer/src/features/food/min-order.ts` (+ test) | create | Progress strip numbers |
| `apps/customer/src/features/food/MinOrderStrip.tsx` | create | Strip above the cart CTA |
| `apps/customer/app/cart.tsx`, `checkout.tsx` | modify | Strip, fee, points row |
| `apps/customer/src/features/food/DishCard.tsx`, `ItemSheet.tsx`, `app/restaurant/[id].tsx` | modify | Deal prices, small-order fact |
| `apps/customer/src/features/home/night.ts` (+ test), `app/(tabs)/index.tsx` | create/modify | Night home |
| `apps/customer/src/features/food/food-art.ts` (+ test), `FoodArt.tsx` | create/modify | Per-dish motif, neighbour rule, fixed pigments |
| `packages/design-tokens/src/tokens.ts` | modify | `art` pigments (fixed across themes) |
| `packages/i18n/src/locales/ar-IQ.json`, `en.json` | modify | New/changed copy (parity) |
| `docs/specs/2026-10-03-edge-case-decisions.md` §2, `docs/api/deals-and-topup.md`, `docs/api/small-order-and-points.md` | modify/create | Docs agree with J-D6/J-D10 |

---

### Task 1: Contracts — the pure rules

**Files:** create `packages/contracts/src/small-order.ts`, `small-order.test.ts`, `points-redemption.ts`, `points-redemption.test.ts`; modify `deals.ts`, `deals.test.ts` (or create), `index.ts`.

- [ ] **Step 1: failing tests**

```ts
// small-order.test.ts
expect(smallOrderFeeIqd(3_000, 5_000)).toBe(500);
expect(smallOrderFeeIqd(5_000, 5_000)).toBe(0);
expect(smallOrderFeeIqd(3_000, 0)).toBe(0);
expect(smallOrderFeeIqd(0, 5_000)).toBe(0); // empty basket: nothing to charge
expect(SMALL_ORDER_FEE_IQD).toBe(AZIZIYAH_MONEY_RULES.smallOrder.feeIqd);

// points-redemption.test.ts (J-D10: delivery first, then the service fee)
expect(pointsRedemption(60, { serviceFeeIqd: 500, deliveryFeeIqd: 1_000 })).toEqual({ points: 60, againstDelivery: 600, againstService: 0, valueIqd: 600 });
expect(pointsRedemption(120, { serviceFeeIqd: 500, deliveryFeeIqd: 1_000 })).toEqual({ points: 120, againstDelivery: 1_000, againstService: 200, valueIqd: 1_200 });
expect(pointsRedemption(1_000, { serviceFeeIqd: 500, deliveryFeeIqd: 1_000 }).points).toBe(150); // capped at the fees
expect(pointsRedemption(50, { serviceFeeIqd: 500, deliveryFeeIqd: 0 })).toMatchObject({ againstDelivery: 0, againstService: 500 }); // free delivery
expect(redeemablePoints({ availablePoints: 400, serviceFeeIqd: 500, deliveryFeeIqd: 1_000, priceIqd: 900 })).toBe(90); // never more than the price

// deals.test.ts
expect(percentDealSaving(2_500, 20)).toBe(500);
expect(percentDealSaving(2_750, 15)).toBe(412);
const pct = { dealId: 'd1', type: 'percent', value: 20, minOrderIqd: 0, itemIds: [] } as const;
expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [pct])).toEqual({ dealId: 'd1', percent: 20, priceIqd: 2_000 });
expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, minOrderIqd: 10_000 }])).toBeNull(); // a minimum: shown in the cart, not on the dish
expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, itemIds: ['tikka'] }])).toBeNull();
expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, type: 'free_delivery' }])).toBeNull();
expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [pct, { ...pct, dealId: 'd2', value: 25 }])?.dealId).toBe('d2');
expect(dealLinePrice(5_000, { percent: 20 })).toBe(4_000);
expect(dealLinePrice(5_000, null)).toBe(5_000);
```

- [ ] **Step 2:** `pnpm --filter @driver/contracts test` → FAIL (modules missing).
- [ ] **Step 3: implement**

```ts
// small-order.ts
/** J-D6 (Ali, 2026-10-05): below the restaurant's own minimum the order goes ahead with this fee. */
export const SMALL_ORDER_FEE_IQD = AZIZIYAH_MONEY_RULES.smallOrder.feeIqd;
export function smallOrderFeeIqd(itemsTotalIqd: number, minOrderIqd: number, rules: Pick<MoneyRules, 'smallOrder'> = AZIZIYAH_MONEY_RULES): number {
  return minOrderIqd > 0 && itemsTotalIqd > 0 && itemsTotalIqd < minOrderIqd ? rules.smallOrder.feeIqd : 0;
}

// points-redemption.ts
export const POINT_VALUE_IQD = AZIZIYAH_MONEY_RULES.points.pointValueIqd;
export function pointsRedemption(points: number, fees: { serviceFeeIqd: number; deliveryFeeIqd: number }, pointValueIqd = POINT_VALUE_IQD) {
  const delivery = Math.max(0, fees.deliveryFeeIqd); const service = Math.max(0, fees.serviceFeeIqd);
  const usable = Math.max(0, Math.min(Math.floor(points), Math.floor((delivery + service) / pointValueIqd)));
  const valueIqd = usable * pointValueIqd;
  const againstDelivery = Math.min(valueIqd, delivery);
  return { points: usable, againstDelivery, againstService: valueIqd - againstDelivery, valueIqd };
}
export function redeemablePoints(o: { availablePoints: number; serviceFeeIqd: number; deliveryFeeIqd: number; priceIqd: number }, pointValueIqd = POINT_VALUE_IQD): number {
  const byPrice = Math.floor(Math.max(0, o.priceIqd) / pointValueIqd);
  return pointsRedemption(Math.min(Math.max(0, o.availablePoints), byPrice), o, pointValueIqd).points;
}

// deals.ts
export function percentDealSaving(lineIqd: number, percent: number): number { return Math.floor((lineIqd * percent) / 100); }
export function menuDealOf(item: { id: string; priceIqd: number }, deals: ReadonlyArray<Pick<DealBadge, 'dealId' | 'type' | 'value' | 'minOrderIqd' | 'itemIds'>>): { dealId: string; percent: number; priceIqd: number } | null { /* percent, no minimum, covers the item; largest percent, first wins ties */ }
export function dealLinePrice(lineIqd: number, deal: { percent: number } | null | undefined): number { return deal ? lineIqd - percentDealSaving(lineIqd, deal.percent) : lineIqd; }
```

- [ ] **Step 4:** tests PASS; `pnpm --filter @driver/contracts typecheck`.
- [ ] **Step 5:** commit "Contracts: small-order fee, points redemption (delivery first) and menu deal price rules".

### Task 2: Ledger — `redemption()` delivery first (J-D10)

**Files:** `apps/api/src/modules/ledger/postings.ts:175-183`, `postings.test.ts:105-120`, `packages/contracts/src/ledger-io.ts:33`, `packages/contracts/src/deals.ts:11`, `docs/specs/2026-10-03-edge-case-decisions.md` §2, `docs/api/deals-and-topup.md:25`.

- [ ] Change the test "points redeem against the service fee first, then delivery" to "delivery first, then the service fee": with the worked example (service 500, delivery 1,000) 60 points → `points:delivery_fee` 600 and no `points:service_fee` line; 160 points → delivery 1,000 + service 500 (capped 150 points → 1,500). Run → FAIL.
- [ ] `redemption(points, serviceFee, deliveryFee, rules)` returns `pointsRedemption(points, { serviceFeeIqd: serviceFee, deliveryFeeIqd: deliveryFee }, rules.points.pointValueIqd)`. Run → PASS (whole ledger suite; errands use the same function, errand fee counts as delivery).
- [ ] Docs/comments say "delivery fee first, then the service fee (J-D10, Ali 2026-10-05; was service fee first)".
- [ ] Also `deal-pricing.ts` percent line uses `percentDealSaving` (no behaviour change; deal-pricing tests stay green).
- [ ] Commit "Points redeem against delivery first, then the service fee (J-D10)".

### Task 3: DB + orders — small-order fee end to end (J-D6)

**Files:** `schema.prisma` (Order: `smallOrderFeeIqd Int @default(0) @map("small_order_fee_iqd")`, `pointsRedeemed Int @default(0) @map("points_redeemed")`), migration `20261006130000_order_small_fee_points/migration.sql`:

```sql
-- J-D6 small-order fee and J-D10/W-02 points at checkout (Ali, 2026-10-05). Additive, defaults 0;
-- no new table, so no driver_harden call.
ALTER TABLE "public"."orders" ADD COLUMN "small_order_fee_iqd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "points_redeemed" INTEGER NOT NULL DEFAULT 0;
```

`packages/db/src/schema.test.ts` lists the columns if it enumerates order columns. Contracts `order.ts`: `Order.smallOrderFeeIqd`, `Order.pointsRedeemed`, `Order.pointsIqd` (optional); `OrderQuote.smallOrderFeeIqd`, `OrderQuote.smallOrder: { minOrderIqd, feeIqd } | null`. API: `orders.config.ts` `smallOrderFeeIqd`; repository fields; `price()` computes the fee from the storefront minimum and no longer throws `order_below_minimum`; `place` stores it; `quote` returns it; `moneyFact` passes `smallOrderFeeIqd`; `orderPriceIqd`/`reducedTotalOf` include it; `toOrderView` shows it.

- [ ] Failing tests `apps/api/src/modules/orders/small-order.test.ts`: storefront min 12,000 (`withStorefront` pattern of `place-guards.test.ts`), basket 3 × 2,500 = 7,500 (needs a cheap harness item or `kebab` 5,000 × 1): quote → `smallOrderFeeIqd 500`, `smallOrder {minOrderIqd 12000, feeIqd 500}`, total = items + 1,000 + 500 + 500 rounded; place → order `smallOrderFeeIqd 500`, `totalIqd` same; at the minimum → 0; delivered + closed → ledger money fact `smallOrderFeeIqd: 500` (order.closed payload) and `postOrderClosed` books `service_fee` memo `small_order` 500 with the customer charged the order total. `place-guards.test.ts` "below the minimum" now expects the fee instead of `order_below_minimum`.
- [ ] Implement; tests PASS; `pnpm --filter @driver/api typecheck`.
- [ ] Commit "Orders below a restaurant's minimum go ahead with a 500 دينار small-order fee (J-D6)".

### Task 4: Orders — points at checkout (W-02 / f13)

**Files:** contracts `order.ts` (`PlaceOrderInput.usePoints` default false, `pointsIqd` expectation; `OrderQuote.points: { balance, usable, valueIqd } | null`, `OrderQuote.pointsIqd`), `orders.service.ts` (`OrdersWalletPort.pointsBalance?`, `pointsAvailable`, `price()` applies `redeemablePoints`, `place` checks `pointsIqd` → `price_changed`, stores `pointsRedeemed`; money fact passes `pointsRedeemed`), `orders.module.ts` (bind to `ledger.balance(Accounts.points(id))`), `test-harness.ts` (`points` map).

- [ ] Failing tests `points.test.ts`: balance 400 points, worked basket (items 15,000, delivery 1,000, service 500): quote without `usePoints` → `points {balance 400, usable 150, valueIqd 1500}`, `pointsIqd 0`; with `usePoints` → `pointsIqd 1500`, total 15,000; place → `pointsRedeemed 150`; a second open order sees 250 available; close → ledger posts `points:delivery_fee` 1,000 + `points:service_fee` 500 and redeems 150 points; free-delivery deal → points only against the service fee (50 points); `pointsIqd` expectation that differs → `price_changed`; no balance → `points: null`.
- [ ] Implement; PASS; commit "Customers can spend points at checkout; the server applies them (W-02)".

### Task 5: Catalog — deal prices, fee on the card, first to open (f10, f12 data)

**Files:** contracts `catalog-io.ts`; `apps/api/src/modules/catalog/catalog.rpc.ts` (`menu()` maps items through `menuDealOf(item, card.deals)`, `card()` adds `smallOrderFeeIqd` and `opensInMin`), `storefront.ts` (`nextOpening` also gives minutes; `openState.opensInMin`), tests in `catalog.rpc.test.ts`, `storefront.test.ts`.

- [ ] Failing tests: a 20 % all-menu deal → every item `deal: { percent: 20, priceIqd: price − 20 % }`; deal with a minimum → `deal: null`; card `smallOrderFeeIqd 500` when `minOrderIqd > 0` else 0; a kitchen closed until 5:00 → `opensInMin` equals the minutes to 5:00 local.
- [ ] Implement; PASS; commit "Catalog: deal price per dish, the small-order fee and minutes to opening on the card".

### Task 6: Copy (ar/en parity)

Keys (Iraqi, Western digits, "دينار"):
- `restaurant.small_order_note` (exists) used on the facts row.
- `cart.min_progress`: «باقي {amount} دينار وتوصل لأقل طلب» / "{amount} IQD more to reach the minimum".
- `cart.min_or_fee`: «أو اطلب هسة برسوم {fee} دينار» / "or order now with a {fee} IQD fee".
- `cart.upsell_close_gap`: «كمّل أقل طلب» / "Reach the minimum".
- `checkout.points_row`: «استخدم نقاطك · تنزل {amount} دينار» / "Use your points · {amount} IQD off".
- `checkout.points_hint`: «عندك {n} نقطة · تنخصم من التوصيل أول وبعدين من رسوم الخدمة».
- `points.redeem_rule`: «100 نقطة = 1,000 دينار، تنخصم من التوصيل أول وبعدين من رسوم الخدمة».
- `points.referral` (W-11): «دز لأهلك وصحابك: إلك وإلهم 2,000 دينار نقاط بعد ثاني طلب» / "Send it to family and friends: 2,000 IQD in points each after their second order".
- `home.night_title` «المطاعم مسدودة هسة», `home.night_first` «أول واحد يفتح: {name} الساعة {time}», `home.night_menu` «شوف المنيو», `home.rail_opening` «يفتحون الصبح».
- `restaurant.deals_one_applies` «عرض واحد يتطبّق: الأوفر إلك».
- `quote.points` exists; `quote.reason.small_order` exists.

Commit with Task 7.

### Task 7: Customer — totals, price lines, cart strip, upsell (f11, J-D6 UI)

- [ ] Tests first: `checkout.test.ts` — `checkoutTotals` adds `smallOrderFeeIqd` and subtracts `pointsIqd` from the server quote; `price-lines` test — a "رسوم الطلب الصغير" line with reason «الطلب أقل من 5,000 دينار» and a negative «نقاطك» line; `min-order.test.ts` — `minOrderProgress(3_250, 5_000) = { shortIqd: 1_750, ratio: 0.65 }`, met → null; `upsell.test.ts` — short 1,750: a 2,000 dish ranks before a 6,000 one and both before a 1,000 drink; nothing short and no drink in the cart → drinks first; items in the cart never appear.
- [ ] Implement `min-order.ts`, `MinOrderStrip.tsx` (footer: progress bar from tokens + two lines, `accessibilityRole="progressbar"`), cart CTA enabled below the minimum (total includes the fee), upsell title switches to «كمّل أقل طلب»; `useOrderQuote(cart, dropoff, street, usePoints)`.
- [ ] Commit "Cart: minimum-order progress above the button, order now with the small-order fee, gap-closing upsell (f11)".

### Task 8: Customer — checkout points row (f13)

- [ ] `ListRow` «استخدم نقاطك · تنزل {amount} دينار» with a `Switch` (theme colours) when `orderQuote.points` is non-null; `usePoints` in the quote and place input; the `pointsIqd` expectation sent with place; `price_changed` refetches. Checkout no longer blocks below the minimum.
- [ ] Commit "Checkout: use your points switch; total from the server (f13)".

### Task 9: Customer — deal prices on menu and sheet (f10)

- [ ] DishCard: when `item.deal`, show `iqd(item.deal.priceIqd)` in `successText` + struck `item.priceIqd` in `textMuted`; ItemSheet CTA uses `dealLinePrice(price, item.deal)`; restaurant page: the small-order fact and «عرض واحد يتطبّق: الأوفر إلك» when more than one deal.
- [ ] Commit "Menu: deal prices on dishes and the add button (f10); small-order note on the facts".

### Task 10: Customer — night home (f12)

- [ ] `night.ts`: `firstToOpen(cards)` (closed with smallest `opensInMin`), `allCuisines(cards)`; tests. Home: section title «يفتحون الصبح» when none open; card «المطاعم مسدودة هسة» + «أول واحد يفتح: {name} الساعة {time}» + «شوف المنيو»; chips from all kitchens.
- [ ] Commit "Home at night: the first kitchen to open and its menu (f12)".

### Task 11: Food drawings per dish (b3)

- [ ] `food-art.ts`: `motifForDish(name, category?)` with motifs `kebab, tikka, liver, shawarma, wrap, falafel, chicken, rice, soup, bread, salad, pickles, sweet, tea, water, laban, can, juice, plate`; `dishArtFor(items)` returns per item `{ motif, variant }` with `variant = hash(id) % 3` and the no-same-neighbour rule (when a dish shares the previous row's motif and variant, the variant shifts). Tests: water → `water`, شنينة/لبن → `laban`, بيبسي/سفن → `can`; adjacent rows never equal; deterministic.
- [ ] `tokens.ts` `art` (fixed pigments: meat `#A0561C`, char `#5B2E12`, tomato `#C8432F`, herb `#4E8A3A`, bread `#E9C77B`, tea `#B5521B`, plate `#FFF8EC`, line `#3A2414`, paper `#F6EEDF`, water `#7FB7D9`, laban `#FBF7EE`, can `#C8432F`, metal `#9A8F80`, rice `#F3E6C4`); FoodArt reads `art`, never theme roles.
- [ ] Commit "Food drawings per dish, no identical neighbours, fixed pigments (b3)".

### Task 12: Docs, gate, screenshots

- [ ] `docs/api/small-order-and-points.md` (procedures, numbers, errors). Spec J-D6/J-D10 rows say "done".
- [ ] `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] Web export + demo API on 3313; shots: menu with deal prices, cart below minimum, checkout with points, night home (before = main, after = this branch) into the session scratchpad `j1d/`.
