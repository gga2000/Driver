# «دوّرلي»: the shopper's receipt

The customer pays for the goods the shopper actually bought, plus the errand's fees. The shopper writes this down from the receipt at the shops, and the photo of the receipt is the proof.

## Procedures

`partner.errandReceipt({ tripId, stopId, totalIqd, photoUploadId })` → `{ receiptIqd, cashDueIqd, overCeiling }`.

It calls `OrdersService.recordErrandReceipt(courierId, { orderId, totalIqd, photoUploadId })`, which checks:

- The caller is the trip's courier (otherwise `forbidden`).
- The order is an errand, and its shops stop is `arrived`. Before the stop is arrived, or after it is completed, the call returns `order_state_conflict`.
- The photo is the courier's own stored upload, the same kind `places.photoUpload` returns (otherwise `upload_invalid`).
- `totalIqd` is a positive whole number of dinars (otherwise `invalid_input`).

When the checks pass, the server:

- Sets `receiptTotalIqd`, and sets `itemsTotalIqd` to the same amount.
- Recomputes the total on the server: receipt + delivery fee + service fee + tip. A cash order is rounded up to 250, as every cash order is.
- Updates the order conditionally on its state (`updateIf`), so a race can't apply the receipt twice.
- Means the door collects the new `cashDueIqd`, and the ledger's errand `actualCostIqd` reads the receipt.

A second entry before the pickup replaces the first. Every entry is an `order.errand_receipt` event carrying `receiptIqd`, `previousIqd`, `photoUploadId` and `overCeiling`.

Over the customer's list ceiling, the receipt still records. The event then also carries `ceilingIqd` and `dispatcherCard: true`. The Console inbox row for this is lane E's work.

## The pickup guard

Trips asks orders before it completes a pickup, through `TripsService.bindPickupGuard`, which orders binds at start-up.

- An errand order with no receipt is refused with `errand_receipt_missing`. Nothing is written.
- Trips passes only the stop's order. Orders decides from the order whether it's an errand.
- الرجعة and خطوط runs (`intercity` and `khat`) never ask the guard.
- A replayed tap on a completed stop returns early, before the guard is asked.

In the partner app, «اشتريت الليستة» stays tappable. Before a receipt is in, it says what's missing and points to «الوصل».

## When the receipt can't be sent from the shop

The shopper must never be stuck at a pickup. These are the ways out:

1. **No network.** The amount and the photo stay on the phone. «سجّل الوصل» sends them once the network is back, and the phone treats a queued receipt as recorded. The server guard still decides in the end, so the pickup completes once the upload lands.
2. **The shop had nothing.** The courier («مشكلة») or ops can cancel the trip at the shops with no receipt. The existing errand cancel path applies.
3. **The photo keeps failing.** The courier reports it through «مشكلة» and reads the amount out. Ops record the receipt for him with `orders.ops.recordErrandReceipt` ([staff-ops.md](staff-ops.md)). It runs the same rules as his own entry, the photo is optional, and it writes a Console audit row. The pickup then completes as usual.

**Open:** the Console button for `orders.ops.recordErrandReceipt` (lane E). The server side is in.

## In the simulator

`pnpm sim` plays «دوّرلي» runs on top of the order mix (3 % of `--orders`, cash, from their own seed stream). The in-process run opens errands in the city for its own app, since Aziziyah launches without them. The shopper buys the list, uploads the receipt photo and records the receipt, then completes the pickup. About one run in seven, the photo fails and ops record the receipt (`orders.ops.recordErrandReceipt`). The door collects the order's cash due.

The invariant `errand_paid_equals_receipt_plus_fees` checks each delivered errand:

- The total is receipt + delivery fee + service fee + tip, rounded up to 250 for cash.
- The order's goods and the ledger's `errand_cost_actual` both equal the receipt.
- The shopper who recorded it is credited the receipt, the delivery fee and the tip.

## Open with Ali

- The rule itself: the customer pays the receipt, and over the ceiling the shopper calls first and the receipt is never blocked.
- Wallet errands: the server allows them today. The customer app only sends cash.
