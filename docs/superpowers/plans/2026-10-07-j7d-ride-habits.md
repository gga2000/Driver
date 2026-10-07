# J7d — Ride habits: regular trips, «عشاك يوصل وياك», favourite drivers — implementation plan

> **For agentic workers:** implement task by task, TDD for logic, commit after every task (plain-English
> message ending in the Co-Authored-By line). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the rides people take every week become one tap (r5: a saved regular trip asks the evening
before or that morning, and only «أكدها» books it), dinner waits for nobody (r6: while the ride home or
the الرجعة back to Aziziyah is on, one card orders food that reaches the door about when they do), and
the driver people trust is the one they get (l9: «سايقي المفضل» after a good ride; scheduled rides and
الرجعة seats ask for him; he gets the job first for a minute, then dispatch carries on as always).

**Spec:** `docs/specs/2026-10-05-customer-joy.md` §5.7 (r5, r6, l9), §6 rules, §8 testing. Ideas:
`docs/research/ui-ux-audit/2026-10-05-joy/4-rajaa-wallet-account.md` S-3 («رحلتك الثابتة», «سايقك
المعتاد»), `6-delight-strategy.md` E11 / bet 5 («عشاك يوصل وياك») and D6 / bet 8 («أسطتي»: scheduled
rides and seats only, favourites first for a short window, on-demand dispatch unchanged). Rules decided
earlier: edge-case decisions line 36 ("evening-before scheduled rides"), review #28.

**What exists today (read before building):**
- Rides are on-demand only. `PlaceOrderInput.scheduledFor` is accepted and the fare is priced at it
  (`orders.service.ts` `price()` → `serverFees(..., at: scheduledFor ?? now)`), but
  `dispatch:ride-request` (`dispatch/events.subscribers.ts` `onRidePlaced`) starts the smart broadcast at
  once. Nothing in the customer app schedules a ride.
- Dispatch can already offer one named driver first (`pre_assigned` → `offerRouteDriver`, `override`)
  and filter candidates to a list (`CandidateFilter.only`). `DispatchRequest` is JSON in Redis (new
  optional fields need no migration).
- الرجعة lives in `modules/routes`: departures are announced by drivers (no dispatch), a seat is
  `holdSeat` → `bookSeat` (server price from the departure), «أريد أرجع» (`postDemand`) turns into a hold
  when a matching car is announced. `DepartureCard.driverId` is already on the board. Arrival has no ETA
  beyond `departedAt + corridor.travelMin` (share links).
- Ratings: rides `orders.rate` (`delivery` stars), الرجعة `routes.rateBooking` (`stars`). The ride's
  driver is `trips.courierOf(orderId)`; the customer's views carry no driver id for rides.
- Driver photo: `IdentityService.mainPhotoRefs(ids, accessor, purpose)` + the blob store's signed
  `readUrl` (logged vault read, purpose of the caller). The driver-photos module is not touched.
- Notify: categories with preferences, quiet hours 23:00–08:00 (`QUIET_HOURS`), quiet days via
  `promoHold` for `PROMOTIONAL_CATEGORIES`, dedupe on `eventId:template:person`. Jobs follow
  `insights/month-card.job.ts` (interval tick, injected clock, idempotent event).
- Food pre-orders: `scheduledFor` → the kitchen is offered at T − prep − busy − 10 min
  (`scheduleOffer`); checkout injects server slots (`withIftarSlot`).

## Decisions

1. **Scheduled rides (needed by r5 and l9).** `orders.place` accepts a ride with `scheduledFor` from 20
   minutes to 7 days ahead (`ride_schedule_invalid` otherwise); the fare is the server's quote at that
   time (unchanged code). The trip is built at placement; dispatch holds it (`status: 'scheduled'`, the
   board's «مجدول») and starts the smart broadcast **15 minutes before** (`broadcast_start` timer). Free
   to cancel until a driver accepts (the existing ride rule: state `placed` is free). Customer app: a
   «وكتها» row on the choose screen (هسة / اليوم / باچر, 15-minute times) and «رحلتك محجوزة» screen
   (`/ride/booked/[id]`) until the search starts; then the order opens the normal live screen.
   **Deviation:** the evening-before pre-assignment (review #28: a driver confirms by 22:00, fallback
   broadcast at T−30) is not built in this slice: no driver holds a job for hours here; the favourite
   gets the first minute of the search instead. Open question for Ali.
2. **Favourite first, then normal dispatch (l9).** A scheduled ride may carry `favouriteId` (one of the
   rider's favourites; `favourite_not_found` otherwise; refused on a ride booked for now:
   `favourite_needs_schedule`). The order stores `preferred_driver_id`. When the search starts,
   dispatch offers the job to that driver alone for **60 seconds** (offer policy `favourite`, only when
   he is online, idle, eligible and has cap room — the same filter as everyone else); he declines, lets
   it ring out, or isn't available → the ordinary waves start at once with their usual timers. On-demand
   rides never carry a favourite. The driver sees «الزبون طلبك إنت» on that offer and nothing else: no
   list, no count, no name of who favourited him.
3. **Favourites.** `favourite_drivers` (person, driver, kinds ⊂ taxi/tuktuk/intercity), at most 20. A
   rider may favourite a driver only from **his own finished ride or الرجعة trip rated 4–5 stars**
   (`favourite_needs_good_rating`): `rideHabits.favourite({ orderId | bookingId, on })`. Views give the
   driver's first name, approved main photo (signed, logged read with purpose `favourite_driver`),
   vehicle kind and how many trips together — never a phone. Where: «سواقي المفضلين» page (account),
   the ride tab's «خليه سايقك المفضل؟» card after a good rating (24 h), the الرجعة pass after rating,
   the choose screen's driver chips (scheduled only), the الرجعة board's «سايقك» badge on his cars (first among a
   regular trip's cars of the day; the board keeps its time order). The rating panel itself (track screen, J5b's area) is not touched.
4. **Regular trips (r5).** `regular_trips`: kind `ride` (pickup/drop-off points with labels, taxi or
   tuktuk, door pickup, cash or wallet, optional favourite) or `rajaa` (corridor, direction, garage,
   travelling as, cash or wallet, optional favourite); days of the week (Baghdad), a time, and when to
   ask: `evening` (20:00 the day before) or `morning` (08:00 that day, only for trips at 09:00 or
   later); at most 10 per person, pausable. **Nothing is booked without «أكدها».**
   - The job (`RegularTripJob`, every 5 minutes) emits `regular_trip.due` for each occurrence whose ask
     time has come and whose trip is still ≥ 20 minutes away, keyed
     `regular_trip.due:<tripId>:<date>` (once ever). Notify sends `regular_trip_reminder` — new category
     `regular_trip` with its own switch (default on: saving the trip is the opt-in), deferred in quiet
     hours and held on quiet days like the dish-pot push, never counted in the offer cap. The app also
     shows the waiting occurrence on the ride tab, the الرجعة board and the regular-trips page, so a
     held push loses nothing.
   - `regular_trip_occurrences` (trip, Baghdad date, state `confirmed | skipped`, order / booking /
     demand id) — unique per trip and date.
   - **Confirm (ride):** the server quotes the fare at the occurrence time; the screen shows it; «أكدها
     · 4,000 دينار» places a scheduled ride through `orders.place` (same checks, the fare must match →
     `price_changed`), with the trip's favourite.
   - **Confirm (الرجعة):** the server lists that day's departures in the corridor and direction from 60
     minutes before to 120 after the usual time (the favourite's first); «أكدها» holds and books one
     seat on the chosen car in one call (server price, the rider's usual payment; wallet checks as
     today). No car announced yet → «نحجزلك أول ما تنعلن سيارة» posts «أريد أرجع» for that window (the
     existing demand flow turns it into a hold the rider pays).
   - Too late (< 20 min) → «فاتت» with «اطلب هسة» (the normal ride flow, prefilled).
5. **«عشاك يوصل وياك» (r6).** `rideHabits.dinnerChance` finds the caller's ride in progress to one of his
   saved places (taxi/tuktuk) or his booked/checked-in الرجعة seat **to Aziziyah** arriving within 150
   minutes, with the arrival time: ride = the live ETA (`TrackingService.liveEta` from the last fix;
   before pickup, ETA to the pickup + pickup → drop-off), الرجعة = `departedAt` (else `departAt`) +
   corridor `travelMin` + garage → home. `rideHabits.dinnerTime({ source, merchantOrgId })` returns the
   delivery time the server picks: `max(arrival, now + prep + busy + max(10, kitchen → door))`, rounded
   up to 5 minutes, and the kitchen-ready time and «بعد وصولك بـ N دقايق» when the kitchen can't make
   it. Home and the الرجعة pass show «عشاك يوصل وياك»; tapping it remembers the trip and opens the
   restaurants; checkout offers «وياك · 8:05» as a slot (preselected, deliver-to = that place), and the
   order is an ordinary scheduled food order (`scheduledFor`) — same checkout, same server checks.
   The time is fixed at placement (a later ride delay does not move it — open question).
6. **Money:** no rule changes. Fares and seat prices are the server's at booking; cancellation fees as
   today; no fee for asking for a favourite.

## API

| Procedure | Who | Input | Output |
|---|---|---|---|
| `rideHabits.favourites` | signed in | — | `FavouriteDriverView[]` |
| `rideHabits.favourite` | signed in | `{orderId \| bookingId, on}` | `FavouriteDriverView[]` |
| `rideHabits.unfavourite` | signed in | `{favouriteId}` | `FavouriteDriverView[]` |
| `rideHabits.recentGood` | signed in | — | `RecentDriverView \| null` (last 24 h, rated 4–5, not yet favourite) |
| `rideHabits.regular.list` | signed in | — | `RegularTripView[]` (each with its next occurrence) |
| `rideHabits.regular.save` | signed in | `SaveRegularTripInput` (id to edit) | `RegularTripView` |
| `rideHabits.regular.remove` | signed in | `{id}` | `{ok}` |
| `rideHabits.regular.occurrence` | signed in | `{id, date}` | `OccurrenceView` (fare quote / departures / state) |
| `rideHabits.regular.confirm` | signed in | `{id, date, fareIqd?, departureId?, clientRequestId}` | `OccurrenceView` |
| `rideHabits.regular.skip` | signed in | `{id, date}` | `OccurrenceView` |
| `rideHabits.dinnerChance` | signed in | — | `DinnerChance \| null` |
| `rideHabits.dinnerTime` | signed in | `{source, merchantOrgId}` | `DinnerTime` |
| `orders.place` (rides) | — | + `scheduledFor`, `favouriteId` | as today |

## File map

| Area | Files |
|---|---|
| Contracts | `ride-habits-io.ts` (+test: rules, `occurrencesBetween`, `askAt`, `nextOccurrence`, `dinnerDeliverAt`, `rideScheduleProblem`), `routers/ride-habits.ts`, `router.ts`, `trpc.ts`, `order.ts` (`favouriteId`, ride `scheduledFor` doc), `partner-io.ts` (`favourite`), `notify-io.ts` (`regular_trip` category, `regularTrips` switch, `regular_trip_reminder`), `errors.ts`, `domain-events.ts` |
| DB | `schema.prisma`; migration `20261007220000_j7d_ride_habits` (3 tables + `orders.preferred_driver_id`, ends with `driver_harden`) |
| API | `modules/dispatch` (scheduled start, favourite window, `index.ts` types), `modules/orders` (ride schedule check, favourite port, event payload), new `modules/ride-habits` (favourites, regular trips, job, dinner, rpc, module), `modules/notify` (mapping), `modules/partner` (offer `favourite`), `trpc` wiring, `app.module.ts` |
| Customer | `src/features/ride-habits/*` (logic + tests, queries, cards), `app/regular/{index,edit,[id]}.tsx`, `app/drivers.tsx`, `app/ride/booked/[id].tsx`, `app/ride/{index,choose}.tsx`, `app/rajaa/index.tsx` + `features/rajaa/DepartureTile.tsx`, `app/rajaa/pass/[id].tsx`, `app/(tabs)/{index,account,orders}.tsx`, `features/home/queries.ts`, `app/checkout.tsx`, `features/notify` (deep links), `scripts/demo-api.mjs`, `scripts/web-shots.mjs`, README |
| Partner | `app/offer.tsx` («الزبون طلبك إنت»), `scripts/demo/*`, `scripts/shots/*`, README |
| Copy | `packages/i18n/src/locales/{ar-IQ,en}.json` |
| Docs | `docs/api/ride-habits.md` |

---

### Task 1 — contracts and pure rules
- [ ] Tests `ride-habits-io.test.ts`: occurrences in a Baghdad week (days, time, DST-free +03:00);
  `askAt` evening (20:00 day before) / morning (08:00 same day; refused for trips before 09:00);
  `nextOccurrence` skips decided dates and ones < 20 min away; `rideScheduleProblem` (19 min → too soon,
  20 min ok, 7 days ok, 7 days + 1 min too far); `dinnerDeliverAt` (arrival wins; kitchen wins with
  late minutes; rounding up to 5).
- [ ] Schemas and views, router, errors, notify template/category/switch, `PartnerOffer.favourite`,
  `PlaceOrderInput.favouriteId`. Commit.

### Task 2 — database
- [ ] Prisma models `FavouriteDriver`, `RegularTrip`, `RegularTripOccurrence`, `Order.preferredDriverId`;
  migration `20261007220000_j7d_ride_habits` ending with `driver_harden`. Commit.

### Task 3 — dispatch: scheduled start and the favourite's minute
- [ ] Tests (orchestrator): a ride with `startAt` in the future is `scheduled`, nothing offered, the
  timer starts the waves; with `preferDriverIds` the favourite alone gets a 60 s offer (policy
  `favourite`, wave 0); accept → assigned; decline → wave 1 at once; ring-out → wave 1; favourite
  offline/busy → wave 1 at once; cancel while scheduled → nothing offered later; subscriber passes
  `scheduledFor − 15 min` and the preferred driver from `order.placed`.
- [ ] `DispatchJob.startAt/preferDriverIds`, `DispatchRequest` fields, timers `broadcast_start` and
  `favourite_end`, `onRidePlaced`. Commit.

### Task 4 — orders: scheduled rides and the favourite
- [ ] Tests: ride `scheduledFor` too soon / too far → `ride_schedule_invalid`; priced at its time;
  `favouriteId` without schedule → `favourite_needs_schedule`; someone else's → `favourite_not_found`;
  stored `preferredDriverId` and on `order.placed`.
- [ ] `OrdersService.bindFavourites`, repository column. Commit.

### Task 5 — favourites (ride-habits module)
- [ ] Tests: favourite from a completed ride rated ≥ 4 (kinds from the trip vertical); rated 3 or not
  rated → `favourite_needs_good_rating`; someone else's order → `not_found`; from a completed الرجعة
  booking rated ≥ 4; un-favourite; cap 20; views (first name, photo URL via logged read, trips together);
  `recentGood` (24 h, ≥ 4, not yet favourite); `driverFor` resolution for orders. Commit.

### Task 6 — regular trips
- [ ] Tests: save validation (ride needs both points; الرجعة needs corridor+direction; morning before
  09:00 refused; 10 max); list with next occurrence; occurrence ride view = server quote at that time;
  confirm ride → scheduled order with favourite, occurrence `confirmed`, repeat → same order; fare moved →
  `price_changed`; too late → `occurrence_closed`; skip; الرجعة occurrence lists departures (favourite
  first); confirm → booked seat; none → demand posted; job emits once per occurrence at its ask time and
  never for paused trips or decided dates. Commit.

### Task 7 — «عشاك يوصل وياك» on the server
- [ ] Tests: chance for an in-transit ride to a saved place (live ETA), none for a ride to a pin, none
  for food; الرجعة to Aziziyah booked → departAt + travel + garage→home; from Aziziyah → none; beyond
  150 min → none; `dinnerTime` for a kitchen: arrival wins, or the kitchen with late minutes. Commit.

### Task 8 — notify + partner
- [ ] Tests: `regular_trip.due` → `regular_trip_reminder` (deep link `driver://regular/{id}?date=`),
  quiet hours deferred, quiet day suppressed, switch off suppressed; partner offer `favourite: true` for
  a favourite offer. Partner offer card chip. Commit.

### Task 9 — customer app
- [ ] Logic tests (`features/ride-habits/logic.test.ts`): schedule time options (15-min steps, ≥ 20
  min), `isBookedRide`, occurrence card copy choice, days label («الأحد–الخميس», «كل خميس»), favourite
  chips for a vertical, dinner line minutes.
- [ ] Screens and cards as in the file map, each with loading, empty, error and offline states. Commit
  per screen group.

### Task 10 — demo, docs, shots
- [ ] Customer demo: `POST /demo/ride-habits?personId=…` (a finished ride with عباس rated 5 and a
  الرجعة trip with حيدر rated 5 → favourites; a regular work trip Sun–Thu 7:30 with a reminder due and a
  Thursday Kut الرجعة; a booked ride for tomorrow), `POST /demo/dinner?personId=…` (a ride home in
  progress), README. Partner demo: `POST /demo/favourite-offer?who=tuktuk|courier…` (a favourite ride
  offer ringing). `docs/api/ride-habits.md`. Shots `SHOTS=ride-habits` at 390 and 360. Commit.

---

## As built (2026-10-07)

- All ten tasks done; `docs/api/ride-habits.md` describes the result.
- Added after J5b landed on main: favourites carry J5b's public driver rating (`publicCourierRating` of
  the same delivery scores the live driver card uses).
- Added from the screenshots: `RegularTripView.booked` (days booked and still ahead), so a ride booked from a
  regular trip shows its route on any phone; checkout says «بعد وصولك · 4:55» instead of «وياك» when the
  kitchen can't make his arrival; the الرجعة tiles resolve the driver's photo URL (they showed initials).
- Deviations: no evening-before pre-assignment of booked rides (decision 1); the الرجعة board keeps its time
  order (the favourite's car is badged, and first only in a regular trip's day).
