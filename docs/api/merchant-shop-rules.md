# Merchant shop rules (Ali, 2026-10-08)

Four rules for shops in the Merchant app. Built in the merchant app and the `merchant`,
`merchant-admin`, `catalog` and `orgs` modules; the parts that belong to other teams are listed at the end.

## t5 — prep choices for juice bars and cafés

- `merchant.storeStatus` → `prepKind: 'food' | 'drinks'` (additive). `drinks` when everything the shop
  sells is a drinks door (`cafe`, `cold`): from «شنو تبيع؟» (`orgs.setup.kinds`) when the shop went
  through setup, else from its storefront tags (`doorsOfTags`). A shop with food as well is `food`.
- The accept sheet offers `PREP_CHOICES[prepKind]`: food 10 / 15 / 25, drinks 3 / 5 / 8 (custom from
  1 minute for drinks, 5 for food).
- `defaultPrepMinutes` for a drinks shop with no usual time of its own is `DRINKS_DEFAULT_PREP_MIN` (5).
- Validation: `orders.merchant.accept` takes `prepMinutes` 1–240 (`MerchantAcceptInput`), so 3 / 5 / 8
  pass; nothing changed there.

## r5 — busy mode +10 or +20

- `merchant.setBusy` takes `extraMinutes: 10 | 20` (optional, default 10; any other value is a schema
  error). Still for an hour. Stored on `orgs.busy_extra_min` (NULL = +10); the `merchant.busy_on` event
  carries `extraMinutes`.
- `storeStatus.busy.extraPrepMinutes` is the picked value while busy mode is on.
- Orders adds the same picked value (`busyExtraMinutes` in `orders/busy.ts`, read from
  `MerchantProfile.busyExtraMin`; +10 when unset or not 10/20), so +20 reaches the promised ready time,
  the courier's timing and the customer's ETA, and the late promise is not set 10 minutes short. The
  l4 crowded mark (15 waiting) stays +10.

## x6 — «وضعك»

- `merchantAdmin.insights` → `foodRating: { avg, count }` (additive): the customers' food score over the
  window, every rated order. The app's «وضعك» card on المحل (owner and staff) reads `insights` for 30
  days: on time (`prepHonesty.onTimeShare`), accepted (`1 − rejected / offered`) and `foodRating`.
  Under 10 orders offered it says «بعد ما عندك طلبات كافية».

## p4 — dish photos the shop uploads

- A photo the shop uploads (`merchantAdmin.menuReplacePhoto`, and its own photo in setup) shows to
  customers at once and is stamped `catalog_items.photo_review_pending_at`. Driver's own photos (the
  library, the menu photo service) are not.
- `AdminMenuItem.photoReviewPending` (additive) drives «ينتظر المراجعة» on the dish.
- `item.photo_replaced` events from the shop carry `review: 'pending'`.
- For the Console: `CatalogService.photoReviewQueue(limit)` (oldest first) and
  `CatalogService.markPhotoReviewed(itemId)`.
- When the team takes a photo down (`catalog.photo_taken_down` on the store, see
  `docs/api/dish-photo-review.md`), `merchantAdmin.menu.get` adds `AdminMenuItem.photoTakenDown:
  { reason, at }` (additive; the latest take-down of the last 14 days, null once the dish has a photo
  again). The Merchant app says «نزّلنا صورة {dish} لأنها {reason}، صوّرها من جديد» on the dish screen,
  «نزّلنا صورتها» on its tile, and once on the board (per device, in a quiet moment) with «صوّرها».
  An unknown reason reads as «ما تناسب المنيو».

## m5 — a dish that ran out comes off the menu from the ticket

- `BoardLine.menuItemId` (additive, null for a free-text line).
- In the accept sheet's «شنو اللي خلص؟», the dishes ticked as out also come off the menu for the rest of
  the day («شيل {dish} من المنيو لباقي اليوم», on by default, the kitchen can untick it): after the
  partial accept goes to the customer, the app calls `merchantAdmin.menu.soldOutToday` for each, so it
  comes back by itself tomorrow. A practice order changes nothing on the menu.

## Left for other teams

- **Orders**: auto-accept uses `MerchantProfile.defaultPrepMin` (`ORDERS_RULES.defaultPrepMin` = 20 when
  the shop has none); a drinks shop from setup already gets 5 written, an older one does not.
- **Console**: the same-day photo review queue (a screen over `photoReviewQueue` / `markPhotoReviewed`
  behind an ops router).
- **Migration**: the two columns ride in `20261010260000_merchant_setup`.

## m4 — a dish that keeps running out is named in «الأرقام»

`merchantAdmin.insights` gains `soldOutHabits` (optional): each dish marked «خلص اليوم» (an
`item.sold_out` event with an `until`) on at least 3 Baghdad days of the window, most days first, top
3, with `usualMinute`, the median local time of its first sell-out each day. Turning a dish off by
hand (`until` null) is not running out. Owners and staff both see it; it has no money in it. The
merchant app shows it as the «يخلص قبل وقته» panel at the top of الأرقام, only when there is one.

## k4 / j6 — hot or cold, and colour by kind on the ticket

No server change. The board reads each line's name with the shared dish rules
(`@driver/ui/dishes`: `temperatureOf`, `motifForDish`), the same rules as the menu's glass display
and the customer's dish cards. Drinks wear a cardamom-olive edge and a «ساخن» / «بارد» mark, sweets a
rose edge and «حلو», the kitchen's food no edge (`apps/merchant/src/features/board/kind.ts`). An
order with both cold and hot things says once under its lines «البارد بكيس وحده، بعيد عن الساخن».

**The owner's own kind (Ali, 2026-10-09 "go ahead").** When the name reads wrong (e.g. «سحلب» reads as
food), the dish editor's «نوعه بتذكرة المطبخ» lets the owner pick أكل / مشروب ساخن / مشروب بارد / حلو,
or «تلقائي: …» to go back to the guess. It is saved as `kind:<value>` in the dish's `labels` column
(no migration; `kindOfLabels` / `withKind` in `@driver/contracts`), so a save that names only the
customer labels keeps the kind and the other way round. `merchantAdmin.menu` returns it as `kind`,
`menuUpsertItem` takes `kind` (null = back to the guess, absent = keep), and the board's lines carry it
as `BoardLine.kind`, which wins over the name for the edge, the mark, the bag note and the sugar button.
Customers never see it (their labels are `DISH_LABELS` only); the customer dish card still reads its
hot/cold from the name.

## k5 — the sugar choice

A drink's editor offers «أضف اختيار السكر»: a ready options group «السكر» (one pick required, all
free: بدون سكر، سكر خفيف، سكر عادي، سكر زيادة) that opens filled for the owner to save or edit. It is
a normal modifier group, so the customer app shows it with no change, and the ticket shows the
chosen sugar bold in the drink colour.
