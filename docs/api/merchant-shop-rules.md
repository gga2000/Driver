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

## Left for other teams

- **Orders**: auto-accept uses `MerchantProfile.defaultPrepMin` (`ORDERS_RULES.defaultPrepMin` = 20 when
  the shop has none); a drinks shop from setup already gets 5 written, an older one does not.
- **Console**: the same-day photo review queue (a screen over `photoReviewQueue` / `markPhotoReviewed`
  behind an ops router).
- **Migration**: the two columns ride in `20261010260000_merchant_setup`.
