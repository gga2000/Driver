# Area groups (`ops.zones.setTier`, `ops.zones.tierFares`)

Ali, 2026-10-20: "I should be able to edit which are centre, near and far."

Each area belongs to a group: المركز (centre), قريب (near), متوسط (mid), بعيد (far) or الأطراف (edge).
When no exact area-to-area price is set, the group pair prices the trip (`tierFares` in the city
config). So moving an area changes delivery, taxi and tuktuk prices to and from it.

## Procedures

| Procedure | Who | What |
|---|---|---|
| `ops.zones.setTier({ cityId, key, tier })` | `ZONE_TIER_ROLES` (admin only: it changes prices) | Moves an area to `centre`, `near`, `mid` or `far`. Audited (`zone.tier_set`, both groups in `detail`) and evented. The same group again does nothing. |
| `ops.zones.tierFares({ cityId })` | `ZONE_READ_ROLES` | For each group, what delivery, taxi and tuktuk cost from the centre today, so the Console shows the fee before saving. |

Errors: `zone_unknown`; `zone_tier_edge_fixed` (edge areas are set with dispatch, which asks drivers to opt in there, so they are not moved here).

## When prices move

- On the machine that saved it: from the next quote.
- On the other API machines: within 60 s (`TIER_SYNC_MS`; every machine reloads the groups into its pricing config).
- A quote already shown or an order already placed keeps its own amount.
- An area added in the Console now prices by its group, instead of the default fare.

## Console

Zones page, ✎ next to an area: the dialog has «المجموعة» with the four groups and the fees from the
centre under each; a change says which way it moves and that prices change from the next order.
While drawing, a dragged corner snaps to a drawn neighbour's corner (14 px) or edge (10 px); holding
Alt (⌥) drags free.

## Dry run: `ops.zones.pinCheck` (admin only, read-only)

Ali, 2026-10-27: before pricing follows the drawn outlines, show what would change. `pinCheck` takes the
most recent delivered orders' drop-off pins (up to 2,000, coordinates only), places each by the built-in
circles and by the drawn outlines (an outline that holds the pin wins, otherwise the circle rule), and
returns counts: pins looked at, how many change area, dearer / cheaper, average delivery-fee change (town
centre → area, by group) and the biggest "from → to" moves. It writes nothing, returns no pin or customer,
and moves no fee. The Console shows it as «شنو يتغير لو الأسعار تتبع الحدود؟» on the map page, for admins.
Switching real pricing and dispatch to the outlines is a separate, fee-affecting step that waits for Ali.
