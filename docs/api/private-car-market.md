# Private car market (Baghdad/Kut ideas y1, y2, y4, y5, y6; Ali 2026-10-07)

The request board (`routes.requestBoard.*`) for a whole car to anywhere: the rider posts, drivers
offer, the rider picks one and a 20 % deposit is held (unchanged money rules).

## What the rider asks for (y1)
`requestBoard.post` takes `details` (`RequestDetails`, defaults to one way):

| field | meaning |
|---|---|
| `trip` | `one_way` · `wait_return` (the driver waits, same day) · `two_days` (back another day) · `fetch` (brings someone else, below) |
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
Once the request is no longer open, only a driver who offered on it may read it; anyone else gets
`request_not_found`. `seen` writes only the seen list, in one conditional update
(`markRequestSeen`: open and not yet counted), under the routes writer lock, so it can never put a
picked request back to «open»; `routes.integration.test.ts` races it against a pick from a second writer.

## Offer cards (y5)
Each offer's `driver` (rider's view only) now also carries `stats` (the same record as on his seat
departures: rating, trips, on-time share, badges, rides with you; null before his first departure)
and `privateTrips` (completed requests where his offer was picked).

## Sorting (y6, in the app)
«الأنسب»: the car has what was asked (AC, car kind, boot for big bags, from the driver's latest
run), then a good rating (4.5+; a new driver next, a lower rating last), then price. «الأرخص»,
«الأعلى تقييم». The winner of each is named on its card (with two offers or more).

Not built yet: «أحدث سيارة» (no car year is recorded), an offer time bar (offers do not expire),
the fair-price guide (y3, needs Ali's numbers), car photos (y7), chat before picking (y9, y10, step 4).

## The waiting clock (w1–w4, Ali 2026-10-08)
A `wait_return` offer carries its waiting terms (`wait`: included hours and the driver's own price
per extra hour). Once the rider has picked it, the picked driver runs the clock:
`requestBoard.waitStart({postId})` when he starts waiting (once), `requestBoard.waitEnd({postId})`
when the rider is back (completing the trip also ends it). Both apps read the same `waitClock`
(`waitClockOf`: start, end, included hours, extra-hour price, free minutes, whether extra hours are
charged), so the rider and the driver see one clock; the apps warn 10 minutes before the included
hours end.

Extra hours (`extraWaitHours`): none within the included hours and the first 15 free minutes after
them, then each started hour at the driver's own price (Ali: "do what is best and fair"). This is a
money rule, `MoneyRules.requestWaitExtra`, and it is **off**: the clock shows the count, the server
charges nothing until Ali switches it on.

## «جيب واحد»: fetching someone else (k1, k2, k4, Ali 2026-10-08)
The fourth trip kind, `fetch`: the car picks up another person (from the airport, a hospital) and
brings them home or anywhere the rider names. `requestBoard.post` then needs `rider`
(`RequestRiderInput`), and `rider` is refused on every other trip kind:

| `from` | who |
|---|---|
| `typed` | a name and phone the rider types (the person is found, or created pseudonymously) |
| `trusted` | one of the rider's trusted people, by position |
| `household` | a member of a household both belong to |

Resolved like a taxi booked for someone else (`docs/api/ride-for-someone.md`): never the rider
himself (`ride_rider_is_you`), unknown people refused (`ride_rider_unknown`). The request keeps only
the person id (`ride_requests.fetch_person_id`); the name the rider gave lives in
`identity_vault.participant_identities` under `request:<id>`. Views carry `rider: {name}` only for
the rider and the picked driver, and every read is logged (`request_rider_name`,
`partner_request_rider`). The usual-price line for a fetch trip uses the pickup place, not the drop-off.

`requestBoard.callPerson({postId})` (the picked driver, matched or arrived) opens a call to the
fetched person, or the rider on other trips; while calls are not live the app says so.

Not built yet: the message to the fetched person and their own pickup pin (k3), waiting on the
messaging template (lane D).
