# Ride search: switch to the other vehicle (J-D7)

Decision J-D7 (Ali, 2026-10-05): when no taxi / tuktuk takes a ride within the city's free-cancel
time (`customerFreeCancelAfterSec`, 180 s in Aziziyah), the customer is offered the other vehicle at a
fresh server quote. They confirm it, keep searching, or cancel for free. Money stays on the server.

## `orders.rideSwitchQuote` (query, the orderer)

Input `{ orderId, doorPickup }` → `{ vertical, fareIqd, totalIqd, availableAt }`.

- `vertical`: the other one (taxi ⇄ tuktuk); `fareIqd` from `PricingService` for the same pickup and
  drop-off (the trip's own stops) at this minute, with the customer's door-pickup choice; `totalIqd`
  adds the ride's tip; `availableAt` = placed + free-cancel time.
- Refused with `ride_switch_unavailable` before `availableAt`, once a driver accepted, when the ride is
  no longer `placed`, or when it was booked for someone else (participants); `forbidden` for anyone
  but the orderer. A zone the other vehicle doesn't serve answers `order_type_not_supported` (the app
  then offers only "keep searching" and "cancel").

## `orders.switchRideVehicle` (mutation, the orderer)

Input `{ orderId, doorPickup, fareIqd, clientRequestId }` → the new ride `Order`.

- `fareIqd` must equal the server's quote at that moment (`price_changed` otherwise; nothing changes).
- In one unit of work: the searching ride is cancelled by the customer with reason `switched_vehicle`
  (free: no driver accepted), its trip is cancelled, and the new ride is placed through the normal
  `place` path (same payment method, tip, household and note for the driver; launch controls, cash
  caps and wallet cover apply). Dispatch starts a fresh search for the new vehicle.
- `clientRequestId` makes a retry answer with the ride it already placed.

The customer app shows the offer card on the live ride screen from `availableAt` (city config), with
«إي، دورلي {vehicle}» → this mutation → the new ride's live screen.
