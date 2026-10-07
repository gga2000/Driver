# Ride habits: rides booked for later, regular trips, favourite drivers, «عشاك يوصل وياك» (joy J7d, 2026-10-07)

Plan: `docs/superpowers/plans/2026-10-07-j7d-ride-habits.md`. Migration: `20261007220000_j7d_ride_habits`
(`favourite_drivers`, `regular_trips`, `regular_trip_occurrences`, `orders.preferred_driver_id`,
`notify_preferences.regular_trips`; ids only — names and photos are read from the vault when shown).
Module: `apps/api/src/modules/ride-habits`. Shared rules: `packages/contracts/src/ride-habits-io.ts`
(`RIDE_HABIT_RULES` and the pure functions, tested). **No money rule changes**: every fare and seat price is
the server's at booking, cancellation fees as before, nothing extra for asking for a favourite.

## Rides booked for later (needed by r5 and l9)

`orders.place` with `type: 'ride'` takes `scheduledFor`:

| Rule | Value |
|---|---|
| How far ahead | 20 minutes – 7 days, on the 5-minute grid (step 4), else `ride_schedule_invalid` |
| Price | the server's quote for that time (`serverFees(..., at: scheduledFor)`); the fare sent must match (`price_changed`) |
| Reminder | a push half an hour before (step 4, c10) — see `ride-later-same-ride.md` |
| Search | dispatch builds the trip at placement and holds the request («مجدول» on the board) until **30 minutes before** when no driver confirmed it the evening before (below), then the smart broadcast as for any ride |
| Cancel | free while no driver accepted (state `placed`), as for any ride |

`Order.scheduledFor` is set; the customer app shows such a ride on «مشوارك محجوز» (`/ride/booked/[id]`)
until the search starts, then on the live screen.

## Evening-before booked rides (edge-case review #28, 2026-10-07)

Plan: `docs/superpowers/plans/2026-10-07-evening-before-rides.md`. No migration: the pre-assignment lives on
dispatch's request (Redis JSON, `DispatchRequest.booked`). Pure rules: `packages/contracts/src/booked-rides.ts`
(`bookedRideWindow`) and `apps/api/src/modules/dispatch/booked.ts` (the state machine).

| Rule | Value (Aziziyah, `DispatchConfig.bookedRides` on taxi and tuktuk) |
|---|---|
| Which rides | a ride on a later day: offered from **18:00 the evening before** (or at booking), confirmed by **22:00** that evening (`confirmByHour`, city config). A same-day ride booked **3 h ahead or more**: offered at once (never before 08:00), confirmed **90 min before**, never after 22:00. Drivers need at least 30 min to answer, else no pre-assignment |
| Who sees it | online drivers whose vehicle, roles, tuktuk edge rule, order cap and cash cap fit (normal dispatch's checks). With a favourite: **he alone for the first hour** (at most half the window), then everyone; his «مو إلي» opens it at once. Pushes: the favourite; then the 10 best-placed fitting drivers (held through quiet hours) |
| Confirm | first confirm wins (`SET NX dispatch:booked:<trip>`; the deadline takes the same lock). Jobs one driver holds are at least 60 min apart (`booked_job_clash`) |
| The confirmed driver | reminded at **T−60** (sent even at night); «طالع هسة» from T−60; at **T−30** the trip is his if he is online, free and has cap room (`dispatch.assigned`, policy `booked`), else **released** (`no_show`) and the search starts at once |
| Release («ما أگدر أجي») | before the deadline: back on offer for the others (never him again); after it: the T−30 search |
| Fallback | the J7d search at **T−30** (was T−15): the favourite's minute first unless he dropped it, then the waves |
| Pickup compensation | `MoneyRules.bookedRideFallback` on every offer of that search: **`enabled: false`, 0 — Ali hasn't set the amount (open decision)**, nothing is shown or paid |
| Customer | `rideHabits.bookedRide({orderId})` → `confirmed` (first name + approved photo, logged read `booked_ride_driver`) · `looking` (`confirmBy`) · `later` (`searchAt`). Booked screen and home card: «سايقك محجوز: حسين» / «ندوّرلك سايق، نأكدلك قبل الساعة 10 بالليل» / «نبدي ندوّرلك 4:30 ص…». Pushes `booked_ride_confirmed`, `booked_ride_unconfirmed` (at the deadline), `booked_ride_released`: held through quiet hours |
| Partner | `partner.bookedJobs`, `partner.answerBookedJob({tripId, answer: confirm \| pass \| release \| start})`; «مشاوير باچر» (`/booked`) and its home card. Time, zones, km, pay — never a door or a name. Pushes `partner_booked_favourite` / `partner_booked_offer` (held in quiet hours), `partner_booked_reminder` and `partner_booked_cancelled` (any hour) |

Events (trip aggregate, `orderId` in the payload): `dispatch.booked_offered`, `…_opened`, `…_passed`,
`…_confirmed`, `…_unconfirmed`, `…_reminder`, `…_released` (`reason: driver | no_show | refused`, `reopened`),
`…_cancelled`.

Open: the compensation amount; whether a rider cancelling a driver-confirmed ride late should pay or the driver
be compensated (today it stays free until the driver sets off — unchanged money rule).

## Favourite first (l9)

`PlaceOrderInput.favouriteId` — one of the rider's favourites (the favourite's own id from
`rideHabits.favourites`), on a ride booked for later only:

| Case | Answer |
|---|---|
| on a ride for now, or any other order | `favourite_needs_schedule` |
| not one of his favourites | `favourite_not_found` |

The order stores `preferred_driver_id` (`Order.preferredDriverId`) and `order.placed` carries
`ride.preferDriverId`. When the search starts dispatch offers the job **to him alone for 60 seconds**
(offer policy `favourite`, wave 0, `dispatch.wave_sent` with `favourite: true`) — only when he is online,
idle, fits the vehicle and has cap room, like anyone. He accepts → assigned; he declines → the normal
waves start at once; the minute rings out → the normal waves start with their usual 60 s re-broadcast and
180 s free-cancel clocks. He is not asked again in waves 1–3. On-demand rides never carry a
`favouriteId`; since ride step 3 (s4) dispatch itself asks the nearest favourite within 2 km first on
any taxi/tuktuk ride — see `docs/api/ride-offered-drivers.md`. Avoiding a driver («ما أريده مرة
ثانية») removes him from the favourites, and making him a favourite again lifts the avoid.

Partner: `PartnerOffer.favourite: boolean` → «الزبون طلبك إنت» on the offer. Nothing else about who
favourited him is ever shown (no list, no count, no name).

## Procedures (`rideHabits.*`, signed in, always the caller's own)

| Procedure | Input | Output |
|---|---|---|
| `favourites` | — | `FavouriteDriverView[]` — id, driverId, first name, approved photo (signed), kinds (`taxi`/`tuktuk`/`intercity`), J5b's public rating (`rating`, `ratingCount`), trips together this year |
| `favourite` | `{orderId \| bookingId, on}` | the list. Adding needs his own **finished** ride or الرجعة trip rated **4–5** (`favourite_needs_good_rating`), at most 20 (`favourite_limit`); someone else's trip → `not_found` |
| `unfavourite` | `{favouriteId}` | the list (`favourite_not_found`) |
| `avoid` / `avoided` / `unavoid` | `{orderId}` / — / `{avoidId}` | the avoid list (ride step 3, s5) — `docs/api/ride-offered-drivers.md` |
| `recentGood` | — | the driver of his last trip rated 4–5 in the last 24 h who isn't a favourite yet, or null |
| `regular.list` | — | `RegularTripView[]` with `next` (the next day to ask about or decided) and `booked` (days booked and still ahead) |
| `regular.save` | `SaveRegularTripInput` (+`id` to edit) | the trip. At most 10 (`regular_trip_limit`); a morning ask needs a trip from 09:00 |
| `regular.remove` | `{id}` | `{ok}` |
| `regular.occurrence` | `{id, date}` | `OccurrenceView`: the day's state and, while open, the server's fare for that time (rides) or that day's cars from 60 min before to 120 after (الرجعة; the favourite's first). A date that isn't one of its days → `invalid_input` |
| `regular.confirm` | `{id, date, fareIqd? \| departureId? \| waitForCar?, clientRequestId}` | the view, booked: a ride for later through `orders.place` (with the favourite), a seat held and booked on the chosen car (a plain seat before the front one, his usual payment), or «أريد أرجع» for the window. Too close (< 20 min) → `occurrence_closed`; a repeat answers with what the first booked |
| `regular.skip` | `{id, date}` | «مو هالمرة» for that day |
| `dinnerChance` | — | his ride in progress to one of his saved places, or his booked / checked-in seat **to Aziziyah**, arriving within 150 min, with the arrival time; else null |
| `dinnerTime` | `{source, merchantOrgId}` | `{arriveAt, deliverAt, kitchenReadyAt, lateByMin, place}` (`dinner_not_available` when the trip is no longer on) |

### Regular trips

A ride between two places (zone, pin, saved-place link, the words he knows it by), taxi or tuktuk, door
pickup or not; or a الرجعة (corridor, direction, garage, travelling as). Days (Baghdad, 0 = Sunday), a time,
cash or wallet, an optional favourite, active or paused. Each day is asked about:

- `evening`: 20:00 the day before; `morning`: 08:00 that day (only for trips from 09:00).
- `RegularTripJob` looks every 5 minutes and emits `regular_trip.due` once per trip and day
  (`regular_trip.due:<trip>:<date>`), for days whose ask time has come, undecided and ≥ 20 min away.
- Notify sends `regular_trip_reminder` («تأكد رحلتك؟ · البيت ← الدائرة · 7:30 ص») to
  `driver://regular/<id>?date=<date>`: category `regular_trip` with its own switch `regularTrips` (on by
  default — saving the trip is the opt-in), deferred through quiet hours (23:00–08:00) and held on quiet
  days like the dish-pot push, never in the weekly offer cap. The app also shows the day asking on the ride
  and الرجعة tabs and in «رحلاتي الثابتة», so a held push loses nothing.
- **Nothing is booked without «أكدها».**

### «عشاك يوصل وياك» (r6)

Arrival: a ride's live ETA (`TrackingService.liveEta` from the car's last fix; before pickup, the ETA to
the pickup + pickup → drop-off); a الرجعة's `departedAt` (else the announced time) + the corridor's
`travelMin` + the nearest Aziziyah garage → home. The delivery time is `max(arrival, now + prep + busy +
the scheduled lead)`, rounded up to 5 minutes (`dinnerDeliverAt`); `lateByMin` says how long after him when
the kitchen can't make it. The app sends `deliverAt` as an ordinary pre-order's `scheduledFor` — same
checkout, same server checks; the kitchen hears of it at `deliverAt − prep − lead` like any pre-order. The
time is fixed at placement (a later ride delay doesn't move it).

## Apps

- Customer: «وكتها» on the choose screen («هسة / بعدين»; «بعدين» opens the day + time picker of step 4 —
  `ride-later-same-ride.md`) and «سايقك المفضل» chips; «مشوارك محجوز» (`/ride/booked/[id]`) and its home card; «رحلاتي الثابتة»
  (`/regular`, `/regular/edit`, `/regular/[id]?date=`); «سواقي المفضلين» (`/drivers`); «خليه سايقك
  المفضل؟» on the ride tab; the heart on a rated الرجعة pass; «سايقك» on his cars on the board; the dinner
  card on home and on the الرجعة pass, the restaurants banner and checkout's «وياك · 8:05» / «بعد وصولك ·
  8:05» slot; the «رحلاتي الثابتة» switch in notifications.
- Partner: «الزبون طلبك إنت» on the offer.

## Demo

Review #28: customer `POST /demo/booked-ride?personId=…[&state=looking|confirmed]` (tomorrow 7:30; `confirmed`
opens the evening offer now and a demo taxi driver confirms), `SHOTS=booked`. Partner `POST /demo/booked?who=tuktuk[&mine=1]`
(three tuktuk rides for tomorrow opened now, 9:30 asking for him; `mine=1`: he took 7:00), `SHOTS=booked`.

Customer (`apps/customer/scripts/demo-api.mjs`): `POST /demo/ride-habits?personId=…` (two taxi rides
finished and rated 5 today — حسين kept, مصطفى offered; a الرجعة from Kut with جاسم rated 5 and kept, his next
car to Kut in ~75 min; two regular trips asking now; the work trip's next day booked with حسين asked first)
and `POST /demo/dinner?personId=…[&kind=rajaa]`. `SHOTS=trips` in `scripts/web-shots.mjs` (step 4: `SHOTS=later`).
Partner: `POST /demo/offer?who=tuktuk&kind=favourite`, `SHOTS=favourite`.
