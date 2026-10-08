# One town read for the customer lists (speed x1)

The home list (`catalog.restaurants`), `catalog.picks`, `catalog.cravings`, `catalog.search`,
`catalog.pots`, `catalog.today` and `catalog.carryOver` all start from every kitchen of the town: its
storefront, menu, merchant settings (location, pause windows, busy, closed, holiday) and live deals.
Before this, each of those reads asked the database for all of it again, one kitchen at a time: about
60 statements per call with the launch kitchens, and on a full evening 1 in 8 home lists failed.

Now the API keeps one **town snapshot** per city (`CatalogRpc.town`):

- **Reused for 30 seconds** (`TOWN_SNAPSHOT_MS`) by every list on that API machine. Reads that arrive
  while it is being built share the one build.
- **Rebuilt at once** when, on the same machine, a menu or storefront changes (price, sold out today,
  on/off, photo, sections, modifiers, imported menu, hours, story: `CatalogService.changeStamp`) or a
  merchant's settings change (closed or opened by hand, busy, location, holidays, a tablet back online
  after 2 minutes or more without a heartbeat: `OrgsService.merchantChangeStamp`). Another machine sees
  the change within the 30 seconds.
- A snapshot built within 2 seconds of a change lives only 2 seconds, so a change that was still being
  saved while it was read is picked up right after.
- A snapshot lives no longer than the earliest quick-pause reopening («يرجع بعد») it holds, so that
  kitchen opens on the minute.
- A build that fails is not kept; the next read tries again.

What is **still worked out on every read**, from the snapshot: the opening state from the hours and
pause windows (so a kitchen opens on the minute), the ride minutes and ETA to this door, the delivery
and service fee preview, the ice-cream 3 km reach, the in-memory busy flag and the launch kill switches
(controls' own 2-second cache).

What is **never served from it**: `catalog.menu` (the kitchen page) reads live, and `orders.quote` /
`orders.place` price every line and check the open state themselves, so a stale card can never change
what the customer is charged: at worst checkout says `price_changed` or that the kitchen is closed.

Things that can lag up to 30 seconds on the lists: a deal starting or ending, the l4 "15 orders
waiting" busy mark, a tablet going offline (h5 pause), a change saved on another API machine, and a
busy mode running out by itself.

Measured on the seeded town (`catalog.restaurants` / `catalog.picks`, Postgres statements per call):
59 → 1 (the session check) between rebuilds; one rebuild per town per 30 seconds reads what one call
used to.
