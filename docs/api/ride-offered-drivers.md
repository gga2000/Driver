# The drivers of my ride: who it was sent to, «نبّهه», the driver's profile, «ما أريده مرة ثانية», favourites first, «عوائل», the weather (ride step 3, 2026-10-07)

Taxi/tuktuk redesign step 3, the dispatch side (spec items n3 n4 n5 n6 s4 s5 s6). The customer screens
are built separately; this page is what the API gives them and how dispatch changed.

## Privacy and who may ask

Only the ride's **orderer** or one of its **riders** may call any of these (`forbidden` otherwise; a food
order or an unknown id is `not_found`). Drivers are shown by **first name and approved main photo only**
(vault reads logged with purpose `courier_card`; the avoid list reads with `avoided_driver`) — never a
position, a phone or a last name. Minutes to the pickup are computed on the server from his last fix on
the one ETA; the fix itself never leaves the server.

## n3 · `dispatch.myRideOffers({ orderId })` → `MyRideOffers { offers, at }`

Only while the ride is searching (dispatch statuses searching / rebroadcast / awaiting or needing a
dispatcher, nobody assigned); otherwise `ride_not_searching` (CONFLICT — the app closes the list).

One `RideOfferCard` per driver, from his latest offer (a wave, then the re-broadcast):

| Field | Meaning |
|---|---|
| `offerId` | the offer to nudge or open the profile of |
| `firstName`, `photoUrl` | vault first name, signed approved photo (null while none is approved) |
| `rating`, `ratingCount` | the public courier rating (J5b, `publicCourierRating`) |
| `tripCount` | his completed trips |
| `vehicleClass`, `vehicleModel`, `vehicleColour` | his active car (class defaults to car for taxi, tuktuk for tuktuk) |
| `features` | car tags **confirmed** at the car check only, display order |
| `minutesAway` | minutes to the pickup (≥ 1) while the offer is open, null after |
| `state` | `sent` → `seen` (he opened it) → `declined` / `expired` (rang out, withdrawn or timed out) |
| `nudgedAt` | when the rider nudged him (any of his offers on this ride) |
| `favourite` | he is one of the caller's favourites |

Accepted offers are not listed (the ride is no longer searching). Order: open offers nearest first
(unknown minutes last, then first sent), then the closed ones newest first. Name, photo, rating and car
are cached per ride × driver × reader, so polling doesn't repeat vault reads.

**Live:** every `dispatch.*` event on a taxi/tuktuk trip invalidates `dispatch.myRideOffers` on each of the
trip's `order:<id>` channels (`LiveKey 'dispatch.myRideOffers'`; all three apps' live maps know it).

## n4 · `dispatch.nudgeOffer({ orderId, offerId })` → `{ nudgedAt }`

The waiting rider taps «نبّهه» on a driver who holds an open offer of his ride.
- Only while searching (`ride_not_searching`), only an offer of this ride whose state is `sent`/`seen` and
  not past its ring (`nudge_offer_closed`).
- **Once per driver per ride** (`NUDGE_RULES.perDriver = 1`, counted over all his offers on the ride):
  a second nudge is `nudge_already` (TOO_MANY_REQUESTS).
- The offer row gets `dispatch_offers.nudged_at` (compare-and-set while null and open), and dispatch emits
  `dispatch.offer_nudged` `{ offerId, driverId, wave, pass }` with the rider as actor.
- The driver: push template **`ride_nudge`** (partner app, `orders` channel, works through quiet hours)
  «راكب ينتظرك» / «الراكب نبّهك، يستناك تقبل»; live `partner.currentOffer` re-reads and
  `PartnerOffer.nudgedAt` is set. The partner offer card shows a «راكب ينتظرك» strip under the
  favourite strip and plays **one soft chime** when the nudge lands on an open card (web: a quieter,
  falling two-tone at gain 0.12 plus a short tap; phone: a short vibration while the offer loop rings,
  else one doorbell at 30 % volume). An offer that opens already nudged just shows the strip.

## n5 · `tracking.driverProfile({ orderId, offerId? })` → `DriverProfile`

- With `offerId`: a driver this searching ride was offered to (`ride_not_searching` once it stops).
- Without: the driver assigned to (or who drove) this ride, any time — the only case with `plate`.

Fields: `firstName`, `photoUrl`, `rating`, `ratingCount`, `tripCount`, `onTimePct`, `memberSince`,
`vehicleClass`, `vehicleModel`, `vehicleColour`, `plate`, `features`, `compliments` (the top
`DRIVER_PROFILE_RULES.compliments = 4`, most said first, from `OrderComplimentsService.courierView`).

- `onTimePct` (`scoring/reliability.ts` `onTimePercent`): over his completed trips of the last year (at
  most 200): a stop with a window (خطوط) counts by its window; a ride counts its first pickup reached
  within the minutes he was offered (the accepted offer's distance at the town speed) + 3 min grace.
  Trips with no promise are left out; null under `DRIVER_PROFILE_RULES.onTimeMinTrips = 20`.
- `memberSince`: his oldest live, unfrozen driving role (courier, driver, intercity, خطوط)
  (`IdentityService.driverSinceOf`); nullable — a driver whose roles were all revoked shows none.

## s5 · the avoid list «ما أريده مرة ثانية» (`rideHabits.*`)

| Procedure | Input | Output |
|---|---|---|
| `avoid` | `{ orderId }` — his ride with a driver (assigned now or finished) | the list. Idempotent; the driver stops being a favourite |
| `avoided` | — | `AvoidedDriverView[]` `{ id, firstName, photoUrl, since }` |
| `unavoid` | `{ avoidId }` | the list (`avoid_not_found`) |

Table `avoided_drivers` (`person_id`, `driver_id`, unique together). Making someone a favourite again
lifts the avoid. **Dispatch:** when a ride starts searching the request stores the rider's avoided drivers
(`DispatchRequest.avoidDriverIds`); they are never in a wave, a re-broadcast or a favourite wave, and a
dispatcher's manual assignment refuses them even when forced (`override_invalid`). Avoiding never tells
the driver anything.

## s4 · favourite first, automatically

On any taxi/tuktuk ride with no explicit `favouriteId`, if one of the rider's favourites (not avoided)
is online, free and fits within **2 km** of the pickup (`RIDE_HABIT_RULES.favourite.autoFirstKm`), the
top-ranked of them (the usual ranker, distance-led) gets the ride **alone first** — the same favourite wave 0 as a booked favourite
(`FAVOURITE_OFFER_POLICY`, `dispatch.wave_sent` with `favourite: true, auto: true, radiusKm`). Declines
or rings out → the normal waves, without him.

## s6 · «عوائل» — `PlaceOrderInput.familyPreferred` (rides)

`familyPreferred: true` on a taxi/tuktuk `orders.place` is stored (`orders.family_preferred`, echoed as
`Order.familyPreferred`, carried over by `orders.switchRideVehicle`) and travels with `order.placed`.
The **first wave** then goes only to drivers who fit — the `family` tag confirmed at the car check, a
driver for **90 days** and a rating of **4.7** or more (`FAMILY_PREFERENCE_RULES`, `familyFit`) — when any
are online; otherwise (and from wave 2 on) the normal ranking. A preference, never a promise: the price
does not change.

## n6 · the weather

`climateAt` (contracts `vehicle-features.ts`): hot on summer afternoons (May–Sep, 10:00–19:59), cold all
winter (Dec–Feb) and on Nov/Mar nights. On hot (cold) times, ride candidates with the **confirmed** `ac`
(`heating`) tag move ahead of the rest, each group in its usual rank order (`preferFirst`). Food and
other verticals are unaffected.
Step 4 (x1, docs/api/climate-check.md): a taxi ride's first two waves now go **only** to those cars,
and a driver who said «لا» to «المكيّفة شغالة اليوم؟» is not one of them for the rest of his shift.

## Vehicle facts (`dispatch/vehicle-facts.ts`, token `VEHICLE_FACTS`)

`factsOf(driverIds)` → `{ vehicleClass, model, colour, confirmedFeatures, tripCount }` per driver;
`confirmedFeatures(driverIds)` for ranking. Prisma reads the active vehicle (`vehicles.model`, `colour`,
`features_confirmed`) and counts completed trips; the in-memory one (demo, tests) has `register(driverId,
car)`. The four vehicle columns are in `schema.prisma` here **without a migration**: the vehicle-details
worker's migration adds them (until it lands, CI's drift check reports them).

## Migration

`20261008010000_ride_step3_offered_drivers`: `dispatch_offers.nudged_at`, `orders.family_preferred`,
table `avoided_drivers` (ends with the `driver_harden` lock-down).

## Demo (customer `demo-api.mjs`)

- `POST /demo/ride?acceptMs=0` — demo drivers hold every offer, so the rider can watch the list; each
  opens his offer after 1.5 s (`seen`). Cars carry a model, colour and confirmed tags.
- A nudged demo driver accepts `nudgeAcceptMs` after the nudge (default 4000, `DEMO_RIDE_NUDGE_ACCEPT_MS`;
  `&nudgeAcceptMs=0` never).
- `POST /demo/ride/nudges?orderId=…` → `{ searching, offers: [{ offerId, driverId, name, state, nudgedAt }] }`.
