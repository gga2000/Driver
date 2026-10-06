# J7a — Food habits: «العزيزية اليوم» + «قدر اليوم», «طلبك المعتاد؟» + «غدا الجمعة», «مطاعمنا» — Implementation Plan

> For agentic workers: implement task by task, TDD for every pure function, one commit per task.

**Goal:** a daily reason to open the app without spending anything (today's pots from the town's
kitchens, and a push when a dish you follow is cooked), the second order faster than the first (the
home knows your usual and books Friday's lunch in two taps), and kitchens with a face (the owner's own
lines, shown only when he says so).

**Spec:** `docs/specs/2026-10-05-customer-joy.md` §5.7 (J7: h2, h5, s3), §6, §8. Detail:
`docs/research/ui-ux-audit/2026-10-05-joy/6-delight-strategy.md` §4 bets 1–2 (E1, E2, G3, E8) and
`1-discovery.md` 4-3 «مطاعمنا». Maps p4 («your usuals», parked in the maps spec §10) has no further
spec: s3 *is* p4 for food, so this slice un-parks it for the customer/food side only — nothing in
`packages/map/**` or map feature folders.

**Architecture:** every figure is the server's. Pots and dish follows live in the catalog module
(customer-facing, next to the storefront); the merchant writes through `merchantAdmin.*` (as the menu
does); the kitchen story is a field of the storefront JSON (no new column). Usuals are computed by the
tracking module from the person's real delivered orders (beside `orders.history` and `orders.firsts`),
as pure functions with an injected clock. The follow push goes through the notify engine as its own
category so the person's switch, quiet hours (23:00–08:00) and quiet days (`promoHold`) all apply, and
one push a day at most. The customer app keeps pure, tested helpers in `features/home/*.ts` and
`features/food/*.ts`; screens only display. Reorder reuses J5a's express sheet (o13) and pre-order slots
(o11).

**Money rules:** none change. Prices on pots are menu prices; the Friday booking is an ordinary
scheduled order (`orders.place` with `scheduledFor`) priced by the server.

## Decisions

1. **One pot per kitchen per Baghdad day** (`daily_pots` unique on org + local date). Posting again the
   same day replaces it; «شيلها» deletes it. `until` ("HH:MM", optional) hides it after that time;
   otherwise it shows to the end of the day. Owner **and** staff may post (a daily kitchen task, like
   «خلص اليوم»); only the dish must be on the store's menu and on sale.
2. **One-tap in the Merchant app** instead of a weekly template: the pot screen leads with «الأسبوع
   الماضي يوم الخميس: تمن وبامية · نفسها اليوم» (same weekday last week) and the dishes used in the
   last 14 days as chips; one tap posts. The full menu is below for anything else.
3. **Follow a dish** («خبرني لمن يطبخوه»): `dish_follows` (person, kitchen, dish), at most 30 per
   person. Shown on the home pot cards, the restaurant's pot banner and the item sheet of any dish that
   was a pot in the last 30 days. Guests don't see the bell (it needs an account).
4. **The push** (`dish_pot_today`): new notify category `dish_pot` with its own switch `dishPots`
   (default **on** — following a dish is the opt-in; the switch turns all of them off). It is
   promotional in tone, so the engine treats it like marketing for **quiet days** (`promoHold`:
   suppressed on mourning days, waits past iftar) and **quiet hours** (deferred to 08:00), but it is
   not counted in the 2-a-week offer cap. **At most one a day per person**: the request's event id is
   `dish_pot:<Baghdad date>`, so the engine's dedupe (event + template + person) drops a second kitchen
   or a re-post. Silent Android channel (`marketing`, low importance). Sent when the pot is posted.
5. **Usuals** (`orders.usuals`): from the person's own food orders that reached them in the last 42
   days. Two orders are "the same" when they are from the same kitchen and share ≥ 70 % of their
   dishes (by catalog item, over the larger order). A **weekday usual**: ≥ 2 the same weekday and time
   band (Baghdad; morning 04–11, lunch 11–16, evening 16–23, late 23–04, by the scheduled time when
   there was one). A **band usual**: ≥ 3 in the same band on any days. Each comes with the newest
   matching order as an `OrderHistoryRow` (so the reorder sheet takes it as is), how many times, and
   the usual minute of day. At most 3, weekday ones first. Always explained («طلبته 3 مرات يوم
   الجمعة»), never placed by itself.
6. **Home**: the usual for *now* (same band; same weekday for a weekday usual) replaces the generic
   «اطلبه مرة ثانية» card. **«غدا الجمعة»** shows Thursday 16:00–23:59 and Friday 04:00–10:59 only
   when a Friday usual exists and a slot can be found: the Friday half-hour slot nearest its usual time,
   inside opening hours and **outside the Friday-prayer pause** (the card's new `pauses`), ≥ 45 min
   ahead. «احجزه» opens the same express sheet with that time; placing sends `scheduledFor`. When the
   usual time fell in the prayer pause, the card says «المطاعم ترجع بعد صلاة الجمعة».
   Priority when nothing is live: Friday card > usual > last order > الرجعة.
7. **Kitchen story** (h5): storefront `story {text ≤ 180 chars / 3 lines, sinceYear 1950..this year,
   shown, updatedAt}`; owner edits, staff read; customers see it on the restaurant page only when
   `shown` is on, with «معروف بـ: {dish}» from the kitchen's real popularity (`popular[0]`, ≥ 20 orders)
   — never a made-up count. No owner name or photo in this slice (names are personal data in the vault;
   a photo needs Console approval) — open question for Ali.
8. **No seed stories or pots in `db:seed`** (a story needs the owner's consent; a pot is today's).
   The demo APIs seed them for review, clearly as demo data.

## API

| Procedure | Who | Input | Output |
|---|---|---|---|
| `catalog.pots` | public | `{cityId, dropoff?}` | `TodayPot[]` (open kitchens first; `followed` for the signed-in) |
| `catalog.dishFollows` | signed in | — | `{itemIds}` |
| `catalog.followDish` | signed in | `{merchantOrgId, itemId, on}` | `{itemIds}` |
| `catalog.menu` | public | (unchanged) | + `pot`, `potDishes`, `story` |
| `merchantAdmin.pot.get` | owner/staff | `{merchantOrgId}` | `MerchantPotView` |
| `merchantAdmin.pot.set` | owner/staff | `{merchantOrgId, itemId, note?, until?}` | `MerchantPotView` |
| `merchantAdmin.pot.clear` | owner/staff | `{merchantOrgId}` | `MerchantPotView` |
| `merchantAdmin.story.get` | owner/staff | `{merchantOrgId}` | `KitchenStoryView` |
| `merchantAdmin.story.set` | owner | `{merchantOrgId, text, sinceYear, shown}` | `KitchenStoryView` |
| `orders.usuals` | signed in | — | `Usual[]` |

Event `catalog.pot_posted {merchantOrgId, itemId, dishName, restaurantName, localDate, followerIds}`
(org stream) → notify. `notify.preferences` gains `dishPots`.

## File map

| File | Change |
|---|---|
| `packages/contracts/src/habits-io.ts` (+ test) | rules, pot/follow/story/usual schemas, `localDateKey`-free pure helpers |
| `packages/contracts/src/catalog-io.ts`, `routers/catalog.ts` | `RestaurantCard.pauses`, `RestaurantMenu.pot/potDishes/story`, three procedures |
| `packages/contracts/src/merchant-admin-io.ts`, `routers/merchant-admin.ts` | `pot.*`, `story.*` |
| `packages/contracts/src/tracking.ts`, `routers/orders.ts` | `Usual`, `orders.usuals` |
| `packages/contracts/src/notify-io.ts` | category `dish_pot`, pref `dishPots`, template `dish_pot_today` |
| `packages/db/prisma/schema.prisma` + `20261007170000_food_habits` | `daily_pots`, `dish_follows`, `notify_preferences.dish_pots` |
| `apps/api/src/modules/catalog/*` | repository (memory + Prisma), `CatalogService` pots/follows/story, `CatalogRpc` reads |
| `apps/api/src/modules/merchant-admin/*` | pot/story procedures, event with followers |
| `apps/api/src/modules/tracking/usuals.ts` (+ test), `tracking.service.ts` | usuals |
| `apps/api/src/modules/notify/*` | engine (promo categories), repository pref column, subscriber |
| `apps/customer/src/features/home/{habits.ts,PotsStrip.tsx,UsualCard.tsx,FridayCard.tsx}` | home |
| `apps/customer/src/features/food/{PotBanner.tsx,KitchenStory.tsx,follow.ts}`, `ItemSheet.tsx`, `slots.ts` | restaurant page, follow, pauses in slots |
| `apps/customer/src/features/orders/{ReorderSheet.tsx,queries.ts}` | scheduled express booking |
| `apps/customer/app/profile/notifications.tsx` | the «قدر اليوم» switch |
| `apps/merchant/app/{pot,story}.tsx`, `src/features/{pot,story}/*` | the two merchant screens, menu entry, المزيد tiles |
| demo APIs, READMEs, `docs/api/food-habits.md` | demo data and hooks, docs |

## Tasks (one commit each)

1. **Plan** — this file.
2. **Contracts** — schemas + router procedures + tests (`habits-io.test.ts`: rules, input validation —
   note ≤ 60, until "HH:MM", story ≤ 180 chars and ≤ 3 lines, year range; router role gates).
3. **DB** — Prisma models + migration (ends with `driver_harden`), `prisma generate`.
4. **Catalog pots, follows, story** — repository (memory + Prisma), service, rpc; tests: pot replace /
   clear / until hides / closed kitchens after open ones / other cities; follow on/off/limit/unknown
   dish; menu carries pot, potDishes (30 days), story only when shown.
5. **Merchant admin** — `pot.*` and `story.*`; tests: staff may post, other store forbidden, dish
   must be on sale, event carries the followers, last-week suggestion and recent list, story owner-only.
6. **Notify** — category, pref (memory + Prisma), engine promo categories, subscriber; tests: one
   request per follower with the day key, suppressed by `dishPots: false`, suppressed on a quiet day,
   deferred in quiet hours, not counted in the offer cap.
7. **Usuals (API)** — `usuals.ts` tests first: weekday usual at 2, band usual at 3, 70 % rule, other
   kitchens never mix, scheduled time decides the band, older than 42 days ignored, refused/cancelled
   ignored, other people's orders ignored, newest order is the row, at most 3; then `orders.usuals`.
8. **Customer home** — `habits.ts` tests first (`usualNow`, `fridayAhead`, `fridaySlot` with the
   prayer pause, `timesWord`, `visiblePots`, `potUntilLabel`, `homeContext` priorities); `PotsStrip`,
   `UsualCard`, `FridayCard`; the express sheet takes `scheduledFor`; `preorderSlots` skips pauses.
9. **Customer restaurant page + follow + settings** — pot banner, story card, item-sheet follow row,
   notifications switch; copy in ar-IQ/en.
10. **Merchant app** — pot screen (one tap: last week's, recent chips, menu list; note; until chips;
    clear), story screen (owner editor with consent switch and a preview, staff read-only), menu entry
    card, المزيد tiles; `logic.ts` tests for both.
11. **Demo + docs** — customer demo: pots and stories seeded, `POST /demo/usuals?personId=…`,
    `POST /demo/pot?key=…&item=…` (posts like the merchant would, sending the push); merchant demo:
    last week's pot, `POST /demo/pot/reset|clear`; READMEs; `docs/api/food-habits.md`.
12. **Gate + screenshots** — rebase, verify ancestry, fresh install, build, typecheck, lint, test; web
    shots at 390 and 360 (home with pots + usual, Thursday-evening Friday card, the express booking,
    restaurant pot banner + story, item sheet follow, notifications switch) and the merchant pot and
    story screens.

## Self-review

h2 → tasks 2–6, 8–11; s3 → 2, 7, 8, 11; h5 → 2, 4, 5, 9, 10. Quiet days: the push (6). Reduced motion:
no new animation beyond existing presets. Every new surface has loading, empty, error and offline
states (strip, banner, cards, merchant screens). Money: untouched.
