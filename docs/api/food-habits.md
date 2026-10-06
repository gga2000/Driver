# Food habits: today's pot, following a dish, usuals, kitchen stories (customer joy J7a)

Plan: `docs/superpowers/plans/2026-10-07-j7a-food-habits.md`. Board ids h2 («العزيزية اليوم» + «قدر اليوم»),
s3 (usuals + «غدا الجمعة»; un-parks maps p4 for food only) and h5 («مطاعمنا»). Nothing here prices
anything: pot prices are menu prices, a Friday booking is an ordinary scheduled `orders.place`.

## «قدر اليوم» — one dish a day per kitchen

Stored in `public.daily_pots` (one row per kitchen and Baghdad date; posting again the same day
replaces the dish). `until` ("HH:MM", optional) hides it after that local time; otherwise it shows to
the end of the day.

| Procedure | Who | Input → Output |
|---|---|---|
| `catalog.pots` (query) | public | `{ cityId, dropoff? }` → `TodayPot[]` — pots that show now and whose dish is on sale, open kitchens first, then the first to cook; `followed` for a signed-in reader |
| `catalog.menu` (query) | public | adds `pot { itemId, note, until } \| null`, `potDishes` (dishes that were the pot in the last 30 days: followable from the item sheet) and `story` (below) |
| `merchantAdmin.pot.get` | owner or staff | `{ merchantOrgId }` → `MerchantPotView { date, today, lastWeek, recent[], followers }` |
| `merchantAdmin.pot.set` | owner or staff | `{ merchantOrgId, itemId, note? (≤ 60), until? }` → `MerchantPotView` |
| `merchantAdmin.pot.clear` | owner or staff | `{ merchantOrgId }` → `MerchantPotView` |

`lastWeek` is the pot of the same weekday seven days ago when that dish is still on sale («نفسها
اليوم», one tap); `recent` the other dishes posted in the last 14 days, newest first. Errors:
`menu_item_not_found` (not this kitchen's dish), `pot_dish_unavailable` (off sale / sold out today).
`set` emits `catalog.pot_posted { merchantOrgId, itemId, dishName, restaurantName, localDate, note,
until, followerIds }` in the same transaction; `clear` emits `catalog.pot_cleared`.

## Following a dish — «خبرني لمن يطبخوه»

`public.dish_follows` (person, kitchen, dish; at most 30 per person → `dish_follow_limit`).

| Procedure | Who | Input → Output |
|---|---|---|
| `catalog.dishFollows` (query) | signed in | → `{ itemIds }` |
| `catalog.followDish` (mutation) | signed in | `{ merchantOrgId, itemId, on }` → `{ itemIds }` (idempotent) |

The push `dish_pot_today` («اليوم مشويات الحاج كريم طابخين تمن وبامية») goes to each follower when the
dish becomes a pot. Rules (notify engine):

- its own switch `notify.preferences.dishPots` (default **on** — following is the opt-in);
- promotional in tone: suppressed on quiet days and held before iftar (`promoHold`), deferred in quiet
  hours (23:00–08:00), silent low-importance Android channel;
- **at most one a day per person**: the request's event id is `dish_pot:<Baghdad date>`, so a second
  kitchen or a re-post the same day dedupes away;
- not counted in the 2-a-week offer cap. Deep link `driver://restaurant/<merchantOrgId>`.

## Usuals — `orders.usuals` (protected query)

`→ Usual[]` (at most 3, weekday usuals first): `{ kind: 'weekday' | 'band', weekday (0 = Sunday … 5 =
Friday) | null, band: 'morning' | 'lunch' | 'evening' | 'late', times, atMinute, row: OrderHistoryRow }`.

From the person's own food orders that reached them in the last 42 days. Two orders are the same when
from the same kitchen with ≥ 70 % of the dishes in common (over the larger order). Weekday usual: ≥ 2
on one weekday and band; band usual: ≥ 3 in one band on any days. The time is the scheduled time when
there was one (Baghdad bands: 04–11, 11–16, 16–23, 23–04). `row` is the newest matching order, so the
app's reorder sheet rebuilds it at today's prices; `atMinute` is the usual half hour.

The app shows «طلبك المعتاد؟» with the reason («طلبته 3 مرات يوم الجمعة»), and Thursday from 16:00 /
Friday 04:00–11:00 «باچر الجمعة · تحجز غداكم؟» for a Friday usual at the Friday slot nearest its time,
inside opening hours and outside the Friday-prayer pause (`RestaurantCard.pauses`, new). Nothing is ever
placed without the person's second tap.

## «مطاعمنا» — the kitchen's story

Stored as `story { text, sinceYear, shown, updatedAt }` in the storefront JSON (`catalogs.storefront`).

| Procedure | Who | Input → Output |
|---|---|---|
| `merchantAdmin.story.get` | owner or staff | `{ merchantOrgId }` → `KitchenStoryView { text, sinceYear, shown, canEdit, updatedAt }` |
| `merchantAdmin.story.set` | owner only | `{ merchantOrgId, text (1–180 chars, ≤ 3 lines) \| null, sinceYear (1900..this year) \| null, shown }` |

`catalog.menu.story` is `{ text, sinceYear }` only while `shown` is on (the owner's consent). The
restaurant page adds «معروف بـ» from the kitchen's real most-ordered dish (`popular[0]`, ≥ 20 orders in 30
days) — never a written claim. No owner name or photo yet (open question).
