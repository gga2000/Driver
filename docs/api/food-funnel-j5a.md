# Food funnel additions (joy J5a, 2026-10-06)

Plan: `docs/superpowers/plans/2026-10-06-j5a-food.md`. No money rule changes.

## `catalog.menu`

- **Portions (o3).** `MenuItem.serves` and each `MenuModifier.serves` = `{ min, max }` people, or null
  when the kitchen said nothing. Stored on `catalog_items.serves_min/serves_max` and
  `modifiers.serves_min/serves_max` (migration `20261006192000_menu_serves_labels`). The Merchant app
  sets them per option («يشبّع كم؟ مثلاً 2–3»); `merchantAdmin.menu.setModifiers` refuses a range typed
  high to low (`invalid_input`).
- **Labels (o8).** `MenuItem.labels` ⊆ `spicy | new | family` (`DISH_LABELS`), set by the kitchen
  (`merchantAdmin.menu.upsertItem` `labels`, column `catalog_items.labels`).
- **Most ordered (o8).** `RestaurantMenu.popular` = item ids, most first: a dish counts once per order
  that had it over the last 30 days, refused/cancelled orders and removed lines left out; only dishes
  with ≥ 20 such orders, top 3 (`POPULAR_RULES`). Counted by the orders module
  (`OrdersStorefrontMerchants.dishOrderCounts`). Demo: `POST /demo/popular`.

## `catalog.restaurants` / `catalog.menu` cards

- **Hours (o11).** `RestaurantCard.hours` = the weekly opening windows on the city's clock (empty =
  always open). The app offers pre-order slots for «اليوم / باچر» inside them; `orders.place` checks the
  same hours at the scheduled time (pause windows such as Friday prayer are still checked only there).

## `catalog.carryOver` (o15, public)

Input `{ cityId, merchantId (the kitchen that said no), dropoff?, lines: [{ name, qty, choices[] }] }`.
Output `{ options: [{ restaurant, moved, of, missing[], totalIqd }] }` for the two similar open kitchens
(`similarKitchens`: shared cuisine tags, then ETA, then rating). Lines carry over by the shared rule in
`@driver/contracts/carry-over.ts` (`matchDish`, `carryModifierPicks`) — the same one the app's «انقل
سلتي لهنا» uses. `totalIqd` is about what the carried cart costs there in cash: menu prices + the card's
delivery and service fees to `dropoff` + the small-order fee, rounded up to 250; no deal is applied
(the app says «تقريباً»; checkout's `orders.quote` is exact). Null without a drop-off or when nothing
moves.

## `orders.quote`

- **`pointsEarn` (o7).** See `docs/api/small-order-and-points.md`.
