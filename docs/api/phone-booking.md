# «حجز بالتلفون» — a ride booked by phone from the Console (2026-10-07)

Taxi/tuktuk step 4, idea v4. Someone without the app calls the support number; support books a taxi or
tuktuk for them from the Console on their number. The caller hears of the driver by SMS. The ride is an
**ordinary cash ride of the caller's person**: same server quote, dispatch, Partner offer and cancellation
rules as one booked in the app. Nothing about money changes.

## Who
`PHONE_BOOKING_ROLES` = `support`, `dispatcher`, `admin` (checked live on every call). Field ops and the
apps cannot call these procedures.

## Procedures (`phoneBookings.*`, `packages/contracts/src/routers/phone-booking.ts`)
- `caller({ phone })` → `{ known, name, phoneRides }`. The number staff typed (`0770 123 4567`, `+964…`,
  Arabic digits; anything else is `phone_invalid`). `name` is the vault's name, staff-short («علي ح.»,
  «أبو حسين»), null when the number has none; `phoneRides` counts earlier phone bookings for it. One
  logged vault read (`phone_booking_caller`).
- `quote({ cityId, pickupId, dropoffId })` → `{ pickup, dropoff, options[], quotedAt }`. Both places are
  landmarks from `places.landmarks` (garages, meeting points, approved landmark places); the server reads
  their pins and zones (`phone_booking_place_unknown` otherwise, and the two must differ). `options` is
  taxi then tuktuk, each `{ vertical, fareIqd, totalIqd, rideMin }`: `fareIqd` is `serverFees` (the quote
  `orders.place` locks), `totalIqd` the cash the caller hands over, `rideMin` the learned town minutes
  pickup → drop-off. A vehicle the city does not price for those zones is left out.
- `book({ cityId, phone, name, pickupId, dropoffId, vertical, fareIqd, note?, clientRequestId })` →
  `PhoneBookingRow`.
  1. `identity.ensurePersonByPhone(phone, staff, 'phone_booking', { name })`: the number's person, created
     pseudonymously in the vault when new. The name heard on the phone fills an **empty** vault name only;
     a name the person gave themselves (or an earlier call's) is never overwritten.
  2. `orders.place(person, { type: 'ride', rideVertical, fareIqd, options: { doorPickup: false },
     paymentMethod: 'cash', pickup, dropoff, note, clientRequestId })`. A fare that moved is
     `price_changed` (quote again and tell the caller); the new-customer cash cap and every other rule
     apply as in the app. `clientRequestId` makes a double click (or a retry) the same ride.
  3. One `phone_bookings` row (order, person, staff, vertical, landmark ids and names) and one Console
     audit row in the same unit of work: action `ride.phone_booked`, subject `order`, actor the staff
     member, summary «حجز تكسي بالتلفون من … لـ… (#1234)». A retry writes neither again.
- `today({ cityId })` → the city's phone bookings of today (Baghdad day), newest first. Each row:
  `ticket` («#1234»), `callerName`, `phoneHint` («0771 ••• 4321»), vertical, landmark names, `totalIqd`,
  `status` (`searching`, `driver_coming`, `driver_arrived`, `on_trip`, `done`, `cancelled`) and `since`,
  `driver` (`firstName`, `vehicleLabel`, `plate`) once someone took it, `bookedByName`, `cancellable`
  (searching, coming or waiting) and the note. Caller names, number hints and driver first names are
  logged vault reads (`phone_booking_list`), kept 10 minutes per staff member so the 10-second refresh
  does not write a log row per poll.
- `cancelPreview({ orderId })` → the app's `CancellationFee` for that ride now (free in the first minute
  after a driver takes it, then 500 to the driver, never after pickup).
- `cancel({ orderId })` → the row, cancelled. The caller asked on the phone, so it is the customer's own
  cancel (`orders.cancel` as the caller, reason `customer_request`) with the same fee, plus an audit row
  `ride.phone_cancelled` under the staff member. A second click does nothing.
  Both are `phone_booking_not_found` for an order not booked by phone.

## The caller's SMS (`phone-booking:sms`, outbox subscriber on `order.matched` and `stop.arrived`)
Only for orders with a `phone_bookings` row. Templates `phone_ride_matched` and `phone_driver_arrived`
(`NOTIFY_TEMPLATES`): category `order_updates`, channel `sms` first (no app, no WhatsApp), sent at once at
any hour, logged in `notify.log` like every message. Their text is the template's own `sms.*` key
(new `sms` field on a template definition); the provider prefixes «درايفر: ».

- A driver takes it: «درايفر: عباس جاي ياخذك: كيا سيراتو · فضي، لوحة 23456 واسط. يوصلك بعد 3 دقايق.
  تابعه: https://driver.iq/share/…». First name from the vault (`phone_booking_sms`; «السايق» without
  one), the car from the vehicle registry (label and plate; just «تكسي»/«تكتك» without one), minutes from
  the driver's last position (trip trail, else his online position) to the pickup by the learned ETA
  («يوصلك قريب» when unknown), and the caller's own live trip link (`SHARE_LINK_BASE_URL`); without a
  link the same text ends after the minutes.
- He is at the pickup: «درايفر: عباس وصل وينتظرك: كيا سيراتو · فضي، لوحة 23456 واسط. الأجرة 4,000 دينار كاش.»

The ordinary `ride_matched` / `driver_arrived` pushes still go to the person (skipped while they have no
app). The SMS follows the person's SMS preference (`smsFallback`, on by default).

## Partner app and history
Nothing new: the offer and trip are an ordinary ride, and «اتصل بالراكب» (`chat.requestCall`) reaches the
caller's number like any rider's (the orderer's vault number). If the caller later signs in with that
number, `orders.history` shows the rides because they are his orders.

## Storage
`phone_bookings` (`public`, migration `20261007233000_phone_bookings`): ids, the vertical and the landmark
names only — the number and the name stay in `identity_vault`. Prisma with `DATABASE_URL`, in memory
otherwise.

## Console
«حجز بالتلفون» (`/phone`, service group, jump key `b`; support, dispatchers and admins): the form (number
with the known/new caller line, name, منين/لوين from the landmarks list, taxi/tuktuk with the server's
price and what to say to the caller, a note for the driver), «احجز», and today's list refreshing every 10
seconds with the driver, plate and a cancel that shows the fee first.

## Demo
`apps/console/scripts/demo-api.mjs` seeds four of today's phone bookings (searching, a taxi driver on his
way with car and plate, finished, cancelled; `DEMO_PHONE=0` seeds none). `POST /demo/phone-accept` has a
demo driver take the oldest one still searching (offered from the dispatch board, accepted as in the
Partner app), so the row and the caller's SMS (`[DevSms]` in the log, `notify.log` on the order) can be
watched. Screenshots: `apps/console/scripts/phone-shots.mjs` (`PHONE_SHOTS=list` for the seeded list).
