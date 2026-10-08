# Taxis linked to a الرجعة seat — x2, x3, x4 (+ n10, n9) (2026-10-07)

Three taxi ideas Ali voted yes on, built server-first with drop-in customer cards. Nothing here changes
a price, a fee, a no-show rule or the routes (الرجعة) module: every taxi is an ordinary ride, priced by
the server when it is booked, and the routes module is only read.

| Idea | What the rider gets |
|---|---|
| **x2** «تكسي يلحگك على سيارة الرجعة» | After booking a seat on a car leaving an Aziziyah garage: a taxi from home (or another saved place) timed so he is at the garage 10 minutes before the car's time — a ride booked for later, or a ride now when it is that close. |
| **x3** «نخبر سايق الرجعة إذا تأخر التكسي» | When that taxi (ours) would bring him after the car's time, he and the الرجعة driver are told, with the minutes. |
| **x4 / n10** «تكسي ينتظرك بالكراج» | On a trip back to Aziziyah he arms a taxi; when the car is about 10 minutes from the Aziziyah garage the server books it (garage → home), so the driver is there when he gets down. Disarming is free. |

## Rules (named constants, `GARAGE_TAXI_RULES` in `packages/contracts/src/garage-taxi-io.ts`)

| Field | Value | Meaning |
|---|---|---|
| `bufferMin` | 10 | x2: he is at the garage this many minutes before the car's announced time |
| `nowPickupMin` | 7 | x2: a driver's usual minutes to reach him, for the «ride now» fallback |
| `lateTellMin` | 3 | x3: told once the taxi would bring him at least this late |
| `lateRetellStepMin` | 5 | x3: told again only when the lateness grew by this much |
| `placeAtEtaMin` | 10 | x4: the ride is booked when the car's live minutes to the garage come down to this |
| `freshFixMin` | 5 | x4: a car position older than this is not live (ETA falls back to departure + corridor time) |
| `arrivedGraceMin` | 15 | x4: car arrived this long ago and the ride still not booked → the arm is dropped |
| `tickMs` | 60,000 | the server looks at linked and armed taxis once a minute (`GarageTaxiJob`) |

### x2 — the pickup time
`garagePickupPlan(departAt, rideMin, now)`: pickup = car's time − `bufferMin` − the learned ride minutes
(`EtaService.minutes`, the same one ETA the ride screens show), rounded **down** to the 5-minute grid of
rides booked for later (so he can be a little more than 10 minutes early — the card says by how much).
When that pickup is closer than a ride can be booked ahead (20 min, `rideScheduleProblem`), a ride now
is offered if `now + nowPickupMin + rideMin` still reaches the garage by the car's time; otherwise
«ما يلحگ» (too late). Booking goes through `orders.place` (taxi, `scheduledFor` when later, the fare the
card showed must equal the server's → `price_changed`), with the client's `clientRequestId`. Cancel is
the ordinary ride cancel (free until a driver accepts / before the search starts).

Offered only for: his own seat, `booked` (not yet boarded), on a car leaving an **Aziziyah** garage, pickup at
the garage (not a door pickup), the car not yet gone, and at least one saved place (else «احفظ بيتك»).

### x3 — late notice
Each tick, for every placed taxi-to-garage: expected arrival = for a matched ride the driver's ETA to
the pickup + the ride (`TrackingService.liveEta`); for a ride still searching, now + the ride. When
`garageLateMin(expected, departAt) ≥ 3` and `shouldTellLate` (first time, or grew by 5), one event
`garage_taxi.late` (idempotency `garage_taxi.late:<link id>:<minutes>`). The link closes when he boards,
the seat or car is gone, or the ride ends/is cancelled. **No seat is held and no no-show rule changes**
(see «What the routes module would need» below).

### x4 — armed taxi home
`arm` stores the arm (seat, place, payment). Each tick: follows a seat moved to another car; drops on a
cancelled trip (`trip_cancelled`) or `arrivedGraceMin` after arrival (`missed`); when the car's ETA ≤
`placeAtEtaMin` it places a ride garage → place via `orders.place`, **priced by the server at that
moment** (retry key `gtaxi_<arm id>`, so a second look never books twice). A refusal (e.g.
`new_customer_cash_cap`) → `failed`, with the card offering «اطلب تكسي» / «جرّب مرة ثانية». The card
shows today's estimate (server fare garage → place) with «السعر ينحسب وكت ما نطلبه».
Which garage: inbound departures carry no arrival garage, so the server uses the **nearest non-draft
Aziziyah garage to the car's last position** (else the first one).

## Procedures (`garageTaxi.*`, all `protectedProcedure`, the rider's own seat only)

| Procedure | Input | Output |
|---|---|---|
| `toGarage` (query) | `{bookingId, from?: {placeId} \| {pin}}` | `ToGaragePlan` — `status: offer \| booked \| unavailable` (+ `unavailable`: `not_from_aziziyah`, `not_booked`, `door_pickup`, `car_left`, `too_late`, `no_place`), garage, departAt, places, fromPlaceId/fromName, mode `later \| now`, pickupAt, arriveAt, rideMin, bufferMin, fareIqd, totalIqd, paymentMethod, order |
| `bookToGarage` | `{bookingId, from?, fareIqd, paymentMethod?, clientRequestId}` | `ToGaragePlan` (`booked`) |
| `forOrder` (query) | `{orderId}` | `GarageTaxiLink \| null` — orderId, bookingId, garage, departAt, expectedAt, lateMin, driverTold, toldMin |
| `arrival` (query) | `{bookingId}` | `GarageArmView` — `status: off \| armed \| placed \| dropped \| failed \| unavailable` (+ `not_to_aziziyah`, `not_booked`, `arrived`, `no_place`), garage, places, toPlaceId, toName, estimateIqd, paymentMethod, carEtaMin, placeAtEtaMin, orderId, placedAt, failCode |
| `arm` | `{bookingId, to: {placeId}, paymentMethod?}` | `GarageArmView` (re-arming changes the place) |
| `disarm` | `{bookingId}` | `GarageArmView` (`off`) |

## Events and notifications
Outbox events (`GARAGE_TAXI_EVENTS`): `garage_taxi.late` `{bookingId, departureId, orderId, riderId,
driverId, lateMin, expectedAt, departAt, garageId, seats}`, `garage_taxi.placed`, `garage_taxi.dropped`,
`garage_taxi.failed`. Notify templates (`packages/contracts/src/notify-io.ts`, push, quiet hours send):

| Template | To | Deep link |
|---|---|---|
| `garage_taxi_late` | rider | `driver://order/{orderId}` |
| `rajaa_rider_taxi_late` | الرجعة driver (with the seat names) | `driver-partner://intercity/departure/{departureId}` |
| `garage_taxi_placed` | rider | `driver://order/{orderId}` |
| `garage_taxi_dropped` | rider | `driver://rajaa/pass/{bookingId}` |
| `garage_taxi_failed` | rider | `driver://ride` |

## Storage
Table `public.garage_taxis` (Prisma model `GarageTaxi`, migration `20261008101500_garage_taxis`, ends
with the `driver_harden` line): one row per (seat, kind `to_garage | from_garage`), state
`armed | placed | disarmed | dropped | failed | closed`, the order id, place id or pin (x2 only), zone,
payment, times (departAt, pickupAt, expectedAt, placedAt, closedAt), lateMin/toldMin/toldAt, failCode,
dropReason. No names or phones (those stay in `identity_vault`). Module: `apps/api/src/modules/garage-taxi/`.

## Customer components (drop-in, not placed on any screen yet)
All in `apps/customer/src/features/ride/`, built from `@driver/ui` and tokens, with loading, error (with
retry), offline (keeps the last answer, buttons off) and hidden states; taps ≥ 44 px; copy `gtaxi.*`.

| Component | Path | Props | Where it belongs |
|---|---|---|---|
| `GarageTaxiCard` | `GarageTaxiCard.tsx` | `bookingId: string` (a `routes.myBookings` id), `testID?` (default `garage-taxi-card`) | the الرجعة pass / booking confirmation of a seat **leaving** Aziziyah |
| `GarageTaxiCardView` | `GarageTaxiCard.tsx` | `state: ToGarageCardState, now: number, busy?, onPlace(id), onBook(), onRetry(), onSeeRide(orderId, later), onAddPlace(), testID?` | the pure view (preview, tests) |
| `ArmedRideCard` | `ArmedRideCard.tsx` | `bookingId: string`, `testID?` (default `armed-ride-card`) | the الرجعة pass of a seat **coming back** to Aziziyah (before and during the trip) |
| `ArmedRideCardView` | `ArmedRideCard.tsx` | `state: ArmCardState, placeId: string \| null, busy?, onPlace(id), onArm(), onDisarm(), onRetry(), onSeeTaxi(orderId), onOrderSelf(), onAddPlace(), testID?` | the pure view |
| `GarageLateNotice` | `GarageLateNotice.tsx` | `orderId: string`, `testID?` (default `garage-late-notice`) | **placed** on `app/order/[id].tsx` for a ride (searching → on the way); renders nothing for any other ride or while on time |
| `GarageLateNoticeView` | `GarageLateNotice.tsx` | `link: GarageTaxiLink \| null, testID?` | the pure view |

Helpers: `garage-taxi.ts` (`toGarageCardState`, `armCardState`, `hasPlan`, `hasView`, `lateNoticeShown`,
poll intervals), `garage-taxi-queries.ts` (`useToGaragePlan`, `useBookToGarage`, `useGarageLate`,
`useGarageArm`, `useArmGarageTaxi`), `GarageTaxiParts.tsx` (`TaxiCardShell`, `TaxiCardWaiting`,
`PlaceChoice`, `payLabel`, `garageLabel`).

Placing the two cards on the الرجعة screens is left to the thread that owns `app/rajaa/**` /
`features/rajaa/**`: `<GarageTaxiCard bookingId={b.id} />` and `<ArmedRideCard bookingId={b.id} />` —
each hides itself for a seat it does not apply to, so both can be dropped on every pass.

## n9 «Baghdad mode» — the next car back, on a card (2026-10-07)
Ali's yes: «When your phone is in Baghdad, home leads with a live card for the next car back to
Aziziyah.» Built as a drop-in card; placing it at the top of home is left to the thread that owns
`app/(tabs)/index.tsx` / `features/home/**`: `<BaghdadModeCard />` (it renders nothing unless it applies).

**When it shows.** Signed in, location **already allowed** (the card never asks: expo-location
`getForegroundPermissionsAsync`, then the last known fix, else one quick balanced fix — on the web the
browser's permission state), and that position is in a far city of the الرجعة network. "In Baghdad" is
`awayCityAt(point, network.garages)` in `packages/contracts/src/away-city.ts`: within the city's radius of
one of its garages (`AWAY_CITY_RADIUS_KM`: Baghdad 20 km around النهضة, Kut 10 km; Aziziyah's garages
never count, and سلمان باك on the road home is outside). The network is `routes.network`; nothing new
on the server. Anywhere else, without permission or signed out: nothing is rendered (no empty space).

**What it shows.** The city's corridor home (`aziziyah_baghdad` / `aziziyah_kut`), read with
`routes.board` (`direction: 'to_aziziyah'`, to 36 h ahead on the hour, re-read every 30 s) and his
`routes.myBookings`:
- **His seat first**: a live seat (held, booked or checked in) on a car back on that corridor within the
  next 12 h → «مقعدك راجع للعزيزية»: when it leaves, from which garage, his seat(s), «شوف تذكرتك» (the
  pass) — or for a hold «ماسكينه إلك» with until when and «كمّل الحجز» — and under it
  `<ArmedRideCard bookingId=…/>` (n10: a taxi waiting at the Aziziyah garage). The switch is not shown
  under a hold (it applies to a booked seat).
- **Else the next car**: the earliest bookable car with a free seat leaving within 12 h — «تطلع 7:05 م»
  with «بعد 25 دقيقة», «من كراج النهضة», seats left (pill) and «5,000 دينار للمقعد» (the seat price the
  server gives, untouched), «احجز مقعد» → `/rajaa/departure/[id]` (the existing seat booking screen),
  and a quiet line for the one after («اللي بعدها 8:15 م · باقي مقعدين»).
- **Else** «ماكو سيارة راجعة هسة» with the first car announced later (up to 36 h: «أول سيارة معلنة
  باچر 7:00 ص من كراج النهضة», and «احجز مقعد» on it), or, when none is announced, «أريد أرجع» →
  `/rajaa/demand` for that corridor (drivers see how many wait).
- Loading (skeleton), error with «حاول مرة ثانية», offline (no data yet), and offline with data (the
  last cars stay, buttons off, a quiet line). Full cars are skipped; the pill says «إنت ببغداد» / «إنت
  بالكوت». Copy `bmode.*`.

| Component | Path | Props |
|---|---|---|
| `BaghdadModeCard` | `features/ride/BaghdadModeCard.tsx` | `testID?` (default `baghdad-mode-card`; the n10 card under the seat gets `<testID>-armed`) |
| `BaghdadModeCardView` | `features/ride/BaghdadModeCard.tsx` | `state: BaghdadModeState, now: number, onBook(car), onSeeSeat(seat), onWantBack(corridorId), onRetry(), armed?(bookingId) → ReactNode, testID?` |

Helpers: `baghdad-mode.ts` (`baghdadModeState`, `carsBack`, `seatBack`, `corridorBack`, `boardUntil`,
`BAGHDAD_MODE_TODAY_H` 12, `BAGHDAD_MODE_AHEAD_H` 36, `BAGHDAD_MODE_POLL_MS` 30 s; tests in
`baghdad-mode.test.ts`), `baghdad-mode-queries.ts` (`useBaghdadMode`), `phone-position.ts`
(`grantedPosition`, `useGrantedPosition`). Nothing in `apps/api/src/modules/routes/**`, `app/rajaa/**`
or `features/rajaa/**` changed; the card only imports read hooks and helpers from `features/rajaa`.

## Demo, preview and screenshots
- Demo hook: `POST /demo/rajaa-taxi?personId=…` (`apps/customer/scripts/demo-api.mjs`) saves home and
  الدائرة, books a seat out of Gate 1 in ~95 min (x2), a seat out of Gate 2 in 25 min with the taxi to it
  taken by a driver 12 km away (x3, told), and three Kut → Aziziyah trips on the road: one far out
  (offer), one far out and armed, one 3 km out and armed (booked at once). Returns the ids and what the
  server made of them. It also announces two cars from النهضة back to Aziziyah (~35 and ~95 min,
  `baghdadDepartureIds`) for n9; `&baghdadSeat=1` instead only books him a seat on a new car back from
  Baghdad in ~50 min (`{baghdadBookingId}`).
- Dev preview (only with `EXPO_PUBLIC_DEV_TOOLS`): `/ride/garage-preview` — every card in every state on
  sample data; `?out=&ret=&armed=&placed=&late=` adds the live cards for those ids; every n9 state is there too, and
  `?n9=1` adds the live n9 card (shown only with the browser's position allowed and in Baghdad/Kut).
- Shots: `SHOTS=rajaa-taxi node apps/customer/scripts/web-shots.mjs <out>` → `rajaa-taxi-*` (each card
  state, the live cards, the late notice on the live ride screen), and `rajaa-taxi-n9-*`: each n9 state,
  then live with the position faked to Baghdad — the next car (`-live-next`) and, after `baghdadSeat=1`,
  his seat with the n10 switch (`-live-booked`); it checks the card stays away without the permission
  and in Aziziyah.

## What the routes module would need (owned by another thread, #8)
Nothing was changed in `apps/api/src/modules/routes/**`. To actually **hold the seat** for a rider whose
taxi (ours) is late, the routes module would have to:
1. Subscribe to `garage_taxi.late` (`bookingId`, `lateMin`, `expectedAt`, `departAt`) and record a
   rider-side waiver on that booking — e.g. extend his cash/no-show grace and the late meter start to
   `expectedAt`, capped (a cap Ali decides) — inside `noShowVerdict` / `departBlockers` / the garage
   meter. That is a money / no-show rule change, so it needs Ali's yes first.
2. Show it to the الرجعة driver in garage mode («راكبك جاي بتكسينا، متأخر 6 دقايق») next to the seat.
3. Optionally carry an **arrival garage** on inbound departures, so x4 does not have to guess the
   nearest Aziziyah garage from the car's last position.
4. Optionally emit a `departure.position` (or near-arrival) event, so x4 can react on the car's own
   updates instead of the once-a-minute look.
