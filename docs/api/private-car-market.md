# Private car market (Baghdad/Kut ideas y1, y2, y4, y5, y6; Ali 2026-10-07)

The request board (`routes.requestBoard.*`) for a whole car to anywhere: the rider posts, drivers
offer, the rider picks one and a 20 % deposit is held (unchanged money rules).

## What the rider asks for (y1)
`requestBoard.post` takes `details` (`RequestDetails`, defaults to one way):

| field | meaning |
|---|---|
| `trip` | `one_way` · `wait_return` (the driver waits, same day) · `two_days` (back another day) |
| `waitHours` | `wait_return` only, 1–12 |
| `returnAt` | `two_days` only, more than 1 h after `when` and within 7 days |
| `bigBags` | suitcases that need the boot, 0–7 |
| `carKind` | `saloon` · `suv` · `van`, or null for any |
| `ac` | the rider wants AC |

`requestDetailsProblem` checks it on the server (and the form). Stored in `ride_requests.details`;
rows from before read as one way.

## «N سواق شافوا طلبك» (y4)
`requestBoard.seen({postId})` (drivers): the partner app calls it when a driver opens a request.
Counted once per driver while the request is open; an offer counts too. Stored as ids in
`ride_requests.seen_driver_ids`. Only the rider's view has `seenBy`; a driver's view says 0.

## Offer cards (y5)
Each offer's `driver` (rider's view only) now also carries `stats` (the same record as on his seat
departures: rating, trips, on-time share, badges, rides with you; null before his first departure)
and `privateTrips` (completed requests where his offer was picked).

## Sorting (y6, in the app)
«الأنسب»: the car has what was asked (AC, car kind, boot for big bags, from the driver's latest
run), then a good rating (4.5+; a new driver next, a lower rating last), then price. «الأرخص»,
«الأعلى تقييم». The winner of each is named on its card (with two offers or more).

Not built yet: «أحدث سيارة» (no car year is recorded), an offer time bar (offers do not expire),
the fair-price guide (y3, needs Ali's numbers), car photos (y7), chat before picking (y9, y10).
