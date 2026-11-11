# Rider no-show (taxi/tuktuk) — `trips.riderNoShow`

Ali's rule (2026-10-30, closes audit RID-01 and question Q21):

- The driver's arrival must count for fees: within 150 m of the pickup (`arrivalCountsForFees`).
- He waits **5 free minutes** (`RIDE_NO_SHOW_FREE_WAIT_MIN`); after that the waiting card shows «الراكب ما إجه».
- Tapping it (and confirming) ends the ride as a rider no-show: the order becomes `customer_cancelled`
  with `cancellationReason = 'rider_no_show'` and the rider owes **1,000 دينار, all to the driver**
  (`CancellationRules.rideNoShowIqd`, same amount as price-sheet row 31, cancel after arrival).
- Money is the existing customer-cancel posting: the fee comes from the rider's wallet (it may go
  negative and is collected later, M-3). No new ledger code.
- The rider gets a push (`ride_rider_no_show`); the receipt shows the 1,000 line as «إلغاء».

Errors: `ride_no_show_too_early` (before 5 min), `ride_no_show_not_arrived` (arrival not within the
fee geofence), `trip_state_conflict` (not a ride, or not waiting at the pickup). A second tap returns
the same ended trip.
