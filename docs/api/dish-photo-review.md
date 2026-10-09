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

`DishPhotoRow`: `itemId`, `merchantOrgId`, `storeName`, `dishName`, `priceIqd`, `photoUrl` (a signed
link that expires; null when it can't be signed), `pendingSince`.

`keep` («تمام») leaves the photo on the menu and takes the dish off the queue. Staff send back the
`pendingSince` of the tile they looked at:

- `kept`: cleared, with a `console_audit_log` row (`store.dish_photo_kept`, subject the store, the
  dish id in `detail`).
- `changed`: the shop put up a newer photo since, so nothing is cleared; the tile comes back with the
  new photo.
- `gone`: someone already looked, or the dish isn't this store's. Nothing is written.

## Console

Console › الموافقات, «صور المحلات اليوم»: one tile per photo (photo, dish, price, store, how long it
has been up), tap the photo to see it full size, «تمام» to keep it. Past 8 hours
(`DISH_PHOTO_RULES.lateAfterHours`) the tile turns warm.

## Not built yet

Taking a bad photo down needs a catalog method (`photoUrl` → null, only while still pending) and a
line for the owner in the Merchant app. Both are asked of the merchant thread; «انزّلها» comes once
the method is on main.
