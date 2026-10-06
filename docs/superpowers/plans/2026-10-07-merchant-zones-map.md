# Restaurant Delivery Area and Fees (r5) + Where My Customers Are (r6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Merchant app, المزيد → «منطقة التوصيل» shows the town's zones coloured by the delivery fee a customer there pays for this store's food, with a legend of those amounts in دينار, and the zone the owner taps (name, fee, paused or not). Read-only: the app shows the server's numbers and nothing changes a fee. On الإحصائيات, a «منين زبائنك» panel shades the same map by how many of the store's orders were delivered to each zone and ranks them; a zone is named only from 5 delivered orders up (spec D7), the rest is one «مناطق ثانية» count.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.7 (r5, r6) and decision D7 ("restaurants see area only"). Ali approved both.

**Architecture:**

- Contracts (`packages/contracts/src/merchant-io.ts`, `routers/merchant.ts`): `merchant.deliveryArea({ merchantOrgId })` → `MerchantDeliveryArea { kitchen, zones[{ key, names, tier, placement, ring, centre, feeIqd, band, service, kitchen }], bands[{ feeIqd, zones }], pricedAt }`; `merchant.customerZones({ merchantOrgId, days = 30 })` → `MerchantCustomerZones { zones[{ key, names, orders }], otherOrders, totalOrders, minOrders, from, to, days }`. Both `MERCHANT_ROLES` (owner and staff); the API checks the role is on that very store. Constants: `DELIVERY_AREA_CACHE_MS` (3 min), `CUSTOMER_ZONE_MIN_ORDERS` (5), `CUSTOMER_ZONES_DEFAULT_DAYS` (30); `feeBandsOf()` is the one band rule.
- API (`apps/api/src/modules/merchant`): `area.ts` holds the pure parts — `foodDeliveryFee` (calls `serverFees` from the orders module, the exact function `orders.place` locks fees with: food, kitchen zone → drop-off zone, door delivery), `composeDeliveryArea`, `composeCustomerZones`. `MerchantService.deliveryArea / customerZones` add the store scope and the cache. A new port `MERCHANT_AREA` (bound in `MerchantModule` over `ZonesService.list`, `PricingService` and `ControlsService.blockingSwitch`) keeps the service testable with plain fakes.
- Orders: `OrdersRepository.deliveredByDropoffZone(merchantOrgId, from, to)` — Prisma: one `SELECT dropoff->>'zoneKey', COUNT(*) … GROUP BY 1` on the `(merchant_org_id, placed_at)` index (`groupBy` cannot group on a JSON path); in-memory twin for tests. `OrdersService.deliveredByDropoffZone` exposes it. No new table, no migration.
- Map package: `fitProjection` / `svgPoints` (`packages/map/src/project.ts`) — equirectangular fit of points into an SVG box at true ground proportions, aspect bounded for phone and tablet panels.
- Merchant app (`apps/merchant/src/features/area/`): `logic.ts` (fee ramp, legend, list order, selection, customer ranking and shading — unit-tested), `queries.ts`, `ZoneMap.tsx` (shared react-native-svg map: polygons, a dot for a zone without an outline, the kitchen pin, tap to select), `DeliveryAreaScreen.tsx` (+ route `app/delivery-area.tsx`, tile in `more.tsx`, guard section), `CustomerZonesPanel.tsx` (on `app/insights.tsx`, following the screen's 7/30/90 range).

## Decisions

1. **Fees come from checkout's own call.** `foodDeliveryFee` runs `serverFees` (pricing engine via `PricingService`) for the pair, with no client input and no copied rule: the map can never show a price checkout would not charge. The "delivery fee" is what the storefront card shows (every shown component except the service fee and promos), quoted at the current time.
2. **Night fees and the cache.** Quotes depend on the Baghdad hour (night fee 23:00–05:00). The per-store cache lives `DELIVERY_AREA_CACHE_MS` (3 min) *and* only within the hour it was priced in (Baghdad is UTC+3, so UTC hour buckets are local hour buckets): a cached fee never crosses a night-window flip. `pricedAt` is shown under the screen («الأسعار حسب الساعة …»).
3. **Out of service = the switches `orders.place` obeys.** A zone is `paused` when `ControlsService.blockingSwitch({ vertical: 'food', zones: [kitchen zone, zone], merchantOrgId })` finds a switch (the zone, the whole food service, or this store); it keeps its fee (what customers pay once it reopens). `no_price` when the engine refuses the pair (`PricingError` → `order_type_not_supported`); any other error is thrown, not hidden. Up to 3 min stale for switches (the cache); the Console switch screen stays the live truth.
4. **A store without a place on file** gets `kitchen: null` and nothing priced; the app shows «مكان محلك بعده ما مسجّل» with the support call instead of an unpriced map.
5. **"Delivered" = `delivered_at` set**, counted by `placed_at` in the window (the indexed column, like insights). Later refunds or disputes don't un-deliver an order.
6. **Privacy (D7):** zones under 5 are not named; orders without a zone and zones no longer on the map join «مناطق ثانية». Counts only leave the database — no order ids, customers or pins. Shares on the list are of *all* delivered orders (other included), so they are honest.
7. **Customers' window follows the insights range** (7/30/90; input allows 1–90, default 30 as the spec says). The threshold applies to any window.
8. **Colours from design tokens only:** fees on `color.primary` 200→700 (cheapest lightest, bands spread across the ramp), unpriced `neutral[200]`, paused `neutral[300]` with a dashed border; customers on the same ramp the peak-hours heatmap uses (`primary` 100/300/500/700). The kitchen pin is ink with a cream core, like the courier radar.
9. **Tap targets:** polygons can be small, so every zone is also a ≥ 64 px row in the list below (fee screen) or the ranking (customers); tapping either selects it on the map.
10. **Demo:** `khalid-history.mjs` now gives delivered orders a weighted drop-off zone from its own seed, so the money and insights story keeps every other number.

## Tasks

- [x] Contracts: schemas, constants, `feeBandsOf`, `MerchantPort` methods, router procedures; role-gate and input tests (`routers/wave2.test.ts`).
- [x] Map: `fitProjection`, `svgPoints` + tests.
- [x] Orders: `deliveredByDropoffZone` (Prisma grouped SQL + in-memory) + Postgres integration test (`delivered-zones.integration.test.ts`).
- [x] Merchant API: `area.ts` + tests (fee = checkout quote, refusals vs faults, bands, paused, no kitchen, threshold, "other", ties); `MerchantService` methods, cache, `MERCHANT_AREA` port and module wiring; service tests (fees equal `serverFees` for every zone, night fee, paused, no kitchen, cache by time and hour, roles and other stores, customers' threshold and window); e2e over HTTP (`merchant-area.e2e.test.ts`).
- [x] Merchant app: logic + tests; `ZoneMap`; «منطقة التوصيل» screen (loading, error, offline with cached data, no kitchen, no zones; phone and tablet layouts); المزيد tile; guard section + test; «منين زبائنك» panel on الإحصائيات (loading, error/offline, empty, map + ranking + other + privacy line).
- [x] Copy: `merchant.area.*`, `merchant.customers.*`, `merchant.more.delivery_area*` in `ar.json` + `en.json` (parity and voice tests).
- [ ] Look at it on the studio at phone and tablet sizes (not run in this session: the Expo bundler hangs on this machine).

## Open questions

- Should the fee map show the daytime fee with a "+250 at night" note instead of the fee at the current hour? Built as "what customers pay now" (same as the storefront card).
- Should owners see «منين زبائنك» only (like money)? Built for owner and staff: it carries no money.
