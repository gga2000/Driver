# Customer reads: order history and الرجعة driver cards (UI/UX Phase 2)

Two additive reads and one rule widening for the customer app (audit C-13, C-15, C-12, C-19).
Nothing here moves money.

## `orders.history` (query, signed in)

The customer's orders, newest first, at most `ORDER_HISTORY_LIMIT` (50): as orderer or participant,
the same set `orders.mine` returns. Each row is `OrderHistoryRow`:

| Field | What |
|---|---|
| `order` | the full `Order` (lines, totals, state, rating) |
| `merchantName` | the restaurant's name; null for rides, الرجعة seats and orders without a merchant |
| `items[]` | `{lineId, catalogItemId, name, qty}` for the live lines (removed ones left out), names from the menu, free text otherwise |
| `dropoffZoneKey` | rides, errands, parcels: the zone the trip went to; null otherwise |

Served by `TrackingService.history` (it already owns the merchant and item-name ports): names are
looked up once per merchant, not once per order. Used by طلباتي, the home "اطلب نفس الطلب" card,
the help section and "اطلبه مرة ثانية" (which rebuilds the cart from `catalog.menu` as it is now:
the server prices it again at the quote and at placement).

## `routes.driverCards` (query, signed in)

Input `{ departureIds: string[] }` (1–30). Output `RajaaDriverCard[]`:
`{departureId, driverId, firstName, verifiedTodayAt, photoUrl}`.

- **First name only**, read from the identity vault with purpose `intercity_driver_card` and the
  rider as accessor (every read logged). Never a phone or full name.
- `verifiedTodayAt`: the run's selfie check-in when it happened today (Baghdad day).
- `photoUrl`: always null for now — there is no public driver portrait (selfies stay in the
  vault). The app draws the driver's initial.
- **Who may read**: a departure still on the board (`scheduled`, `boarding`), or one the rider
  holds a live or completed seat on. Any other id is left out of the answer (no error).

## `orders.rate` on a disputed order

`orders.rate` now also stores a rating on an order under dispute, without closing it (before it
returned `order_state_conflict`). The low-rating flow opens the complaint first
(`orders.openDispute`), then sends the stars and reasons, so the case stays with support.
Closed orders already took a late rating; nothing else changed.
