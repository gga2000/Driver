# Partner offer slip — extra fields (partner redesign o7, o10, o12)

`partner.currentOffer` carries three read-only hints for the order slip. None of them changes pay,
dispatch or any money rule; they only describe the offer.

| Field | Type | What it is |
|---|---|---|
| `pickup.landmark`, `dropoff.landmark` | `string \| null` | o7: the nearest public town landmark (garages and meeting points from `AZIZIYAH_LANDMARKS`) within 600 m of the stop, its Arabic name. The slip reads «يم …». Never a person's door: every driver in the wave sees the offer. |
| `climate` | `'ac' \| 'heating' \| null` | o12: a taxi ride offered to a car (car, SUV, van) during a hot or cold shift, the same shifts ride idea x1 routes by (`climateShiftAt`). The slip says «يوم حار · شغّل المكيّفة قبل لا يصعد». Null for other services and mild days. |
| `riderTrips` | `number \| null` | o10: how many rides the orderer finished before this one (`OrdersService.finishedRidesBefore`), a count only. Null for deliveries and for rides booked for someone else (the booker's history says nothing about the rider). The rider's name never appears on the offer. |

All three default to `null`, so older clients and fakes keep working.

Client side (`apps/partner/app/offer.tsx`): the slip in the service's colour, the money's named parts as
chips, «ثبّت حتى تقبل» (hold half a second; screen readers tap twice), «مو هسة» beside it, the time left
as a bar, the order read aloud (`features/offer/speak.ts`, on by default, switch on the account tab),
and its own sounds for an order, a nudge and a chat message.
