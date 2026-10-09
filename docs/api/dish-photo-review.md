# Dish photo review — the same-day look (p4)

Ali, 2026-10-08: a dish photo the shop uploads itself goes on the menu at once, and Driver's team
looks at it the same day. The catalog side (the `photo_review_pending_at` stamp, the queue, clearing
it) is in `docs/api/merchant-shop-rules.md` § p4. This page is the Console's side.

## Procedures (`ops.dishPhotos.*`)

Roles: `support`, `field_ops`, `admin` (`DISH_PHOTO_REVIEW_ROLES`).

| Procedure | Input | Output |
|---|---|---|
| `queue` (query) | `{ cityId }` | `DishPhotoRow[]`: the city's photos still waiting, oldest first (at most 200) |
| `keep` (mutation) | `{ merchantOrgId, itemId, pendingSince }` | `{ itemId, outcome: 'kept' \| 'changed' \| 'gone' }` |
| `takeDown` (mutation) | `{ merchantOrgId, itemId, pendingSince, reason }` | `{ itemId, outcome: 'taken_down' \| 'changed' \| 'gone' }` |

`DishPhotoRow`: `itemId`, `merchantOrgId`, `storeName`, `dishName`, `priceIqd`, `photoUrl` (a signed
link that expires; null when it can't be signed), `pendingSince`.

`keep` («تمام») leaves the photo on the menu and takes the dish off the queue. Staff send back the
`pendingSince` of the tile they looked at:

- `kept`: cleared, with a `console_audit_log` row (`store.dish_photo_kept`, subject the store, the
  dish id in `detail`).
- `changed`: the shop put up a newer photo since, so nothing is cleared; the tile comes back with the
  new photo.
- `gone`: someone already looked, or the dish isn't this store's. Nothing is written.

`takeDown` («انزّلها») takes the photo off the menu: the dish shows no photo until the shop puts up
another. `reason` is `blurry`, `wrong_dish`, `people` or `other`. The same version rule applies, and
the catalog's clear is conditional on the stamp (`CatalogService.takeDownShopPhoto`), so a new upload
racing the tap is never taken down unseen. On `taken_down`, in one transaction:

- the store's event `catalog.photo_taken_down` (aggregate `org`), payload
  `{ merchantOrgId, itemId, reason, at }`. The Merchant app reads it to tell the owner why;
- a `console_audit_log` row `store.dish_photo_taken_down` with the reason.

A shop upload never carries a library photo (`photoLibrary` is null on it), so after a take-down
the dish has no photo at all, not «صورة توضيحية».

## Console

Console › الموافقات, «صور المحلات اليوم»: one tile per photo (photo, dish, price, store, how long it
has been up), tap the photo to see it full size, «تمام» to keep it, «انزّلها» to pick a reason and
take it down. Past 8 hours (`DISH_PHOTO_RULES.lateAfterHours`) the tile turns warm.

## Left for the merchant thread

The owner's side of a take-down: «نزّلنا صورة {dish} لأنها {reason}، صوّرها من جديد» on the dish
with a «صوّرها» button, and a one-time notice on the board, read from `catalog.photo_taken_down`.
