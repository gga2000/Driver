# Partner & Merchant apps — wave 2 API

Date: 2026-10-03. Backend for the second wave of the Partner and Merchant apps (spec
`docs/specs/2026-10-03-partner-and-merchant-apps.md`). Five new tRPC keys; the `partner` and `merchant`
keys (presence / offers / active job, order board / busy / printer) belong to the wave-1 shells.

Conventions (same as every router):

- All procedures need a session (`Authorization: Bearer`). The role column is the coarse gate in the
  router; org scoping and owner-only checks happen in the API and answer `FORBIDDEN`.
- Errors carry `{code, message_ar, message_en, retryHint}`. New codes are listed per key.
- Dates are `Date` on the wire (superjson). Money is integer IQD. "Local" means Baghdad (UTC+3); weeks
  start Sunday.
- **Photos**: upload first with `places.photoUpload({contentType, sizeBytes})` → signed `PUT`, then pass
  the `uploadId`. The upload must be the caller's and stored, else `upload_invalid`.

Contracts: `packages/contracts/src/{driver-account,khat,fleet,ops,merchant-admin}-io.ts`, routers in
`packages/contracts/src/routers/`. API modules: `apps/api/src/modules/{driver-account,khat,fleet,ops,promotions,merchant-admin}`.

## `driverAccount.*` — a driving person's own account

Roles: driving roles (`courier`, `shopper`, `driver`, `intercity_driver`, `khat_driver`). Reads that take
`driverId` other than the caller's are back office only (`finance`, `admin`, `dispatcher`, `support`,
`field_ops`); fleet owners use `fleet.driverEarnings`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `earnings` | query | `{period: 'day'\|'week'\|'month' = 'day', anchor?: Date, driverId?}` | `EarningsView`: `{from, to, totals {grossIqd, takeIqd, tipsIqd, bonusesIqd, guaranteeTopUpsIqd, penaltiesIqd, netIqd, jobs}, jobs[] {key, tripId, orderId, at, components[] {type, label_ar, label_en, amountIqd (signed), memo}, netIqd, cashCollectedIqd}, cash {collectedIqd, toMerchantsIqd, settledIqd, heldIqd, owedIqd}, cap {role, tier, capIqd, owedIqd, remainingIqd, fill 0–1, overCap, byTier {bronze, silver, gold}}, payoutDueIqd}` |
| `scorecard` | query | `{driverId?}` | `ScorecardView`: `{dayNumber, visibleFrom, visible, observation, learningMessage_ar, index\|null, tier\|null, completedTrips, windowDays: 14, metrics[] {key: acceptance\|completion\|on_time\|rating\|cash_return, label_ar, value, display, samples, fullAt, zeroAt, silverLine, score, weight, belowSilver}, nudges[] {key, message_ar, message_en}, consequencesFrom\|null}` — days 1–30: `visible=false`, metrics `[]`, index `null` for the driver (back office still sees them); from day 31 nudges for components under the Silver line and `consequencesFrom` = next Sunday |
| `documents` | query | `{driverId?}` | `{driverId, documents[] DriverDocumentView, missing[] kind, blocksOnline}` |
| `uploadDocument` | mutation | `{kind, uploadId, expiresAt?}` — kinds `national_id_front`, `national_id_back`, `licence`, `vehicle_registration`, `insurance`, `photo` | `DriverDocumentView {id, kind, kind_ar, status, status_ar, expiresAt, daysToExpiry, submittedAt, reviewedAt, rejectReason}`; status `pending → approved\|rejected`, derived `expiring` (≤ 30 days) / `expired`. A new upload of a kind supersedes the old one |
| `reviewDocument` | mutation | `{documentId, decision: 'approve'\|'reject', reason? (required to reject), expiresAt?}` — roles `field_ops`, `support`, `admin` | `DriverDocumentView` |
| `checkInChallenge` | mutation | — | `{challengeId, gesture: blink\|turn_left\|turn_right\|smile\|nod, gesture_ar, expiresAt (2 min)}` |
| `submitCheckIn` | mutation | `{challengeId, uploadId (selfie), livenessScore? 0–1}` | `CheckInStatus & {checkInId, result: passed\|failed, reason}` |
| `checkInStatus` | query | — | `{localDate, required, verifiedToday, verifiedAt, failuresToday, lockedOut, badge_ar ("متحقق اليوم ✓")}` |
| `onlineGate` | query | — | `{canGoOnline, reasons[] {code: checkin_required\|checkin_locked\|document_expired, message_ar}, checkIn}` |
| `handoverCode` | query | — | `{code: 4 digits, validUntil}` — read out to field ops for `ops.recordCashReceipt`; rotates at local midnight |
| `shiftSummary` | query | `{from?: Date (partner.status.onlineSince), to?: Date}` — clamped: `to` ≤ now, window ≤ 24 h, `from` defaults to Baghdad midnight | `{from, to, onlineMinutes, jobs, netIqd, tipsIqd, perHourIqd\|null (net × 60 ÷ exact online minutes, to the nearest 50, shown as «تقريباً … لكل ساعة شغل»; null under 30 min online), bestHour {from, to, netIqd, jobs}\|null (Baghdad clock hour), day {netIqd, jobs}, cash {heldIqd, owedIqd, capIqd, overCap}, tomorrow {from, to, orders}\|null (busiest 2 h from the city's orders on the same weekday last week; null under 4 orders), nudge {key, message_ar, message_en}\|null (one, from day 31)}` — Partner audit S-4 |
| `jobReceipt` | query | `{key, at}` (an `EarningsJobLine`) | `{key, tripId, orderId, ticket ("1284")\|null, at, lines[] (EarningsComponent & reason {code, params}\|null), grossIqd, takeIqd, takeRate 0–1\|null, tipsIqd, netIqd, cash {collectedIqd (the whole note: price, rounding change, change to wallet), toMerchantIqd (paid at pickup), keptIqd (his net pay for the job, netted at hand-over), toCompanyIqd (the rest); the three add up to collectedIqd}\|null, queryOpen}` — reason codes `delivery_full`, `night` {time}, `rain`, `peak`, `door_pickup`, `wait` {amount} (the customer's `quote.reason.*` sentences) and `fare`, `take` {rate}, `tip`, `batch`, `compensation`, `guarantee`, `incentive`, `penalty` (`partner.receipt_reason_*`). His own jobs only (`not_found`) — Partner audit S-7 |
| `payQuery` | mutation | `{key, at, message (3–1000)}` | `{ticketId, openedAt, alreadyOpen}` — "عندي اعتراض": a support ticket (`complaint`, `in_app`, no customer) with the order (when real), the trip and the receipt in its note; one per driver and job (`support.openDriverPayQuery`, source key `driver_pay:<driver>:<job>`) |

Notes: earnings come from `ledger.driverLedger` (every line named via `ledger.line.<type>`); guarantee
top-ups are `driver_incentive` lines whose memo starts with `guarantee`. Two failed check-ins in a local
day lock the driver out and emit `driver.checkin_locked` (ops alert). Document photos and selfies are
written as refs to the identity vault (`person_identities.document_refs` / `selfie_refs`); the public
tables keep status and expiry only. **Partner shell:** call `driverAccount.onlineGate` before going
online; server-side, `DriverAccountService.onlineGateFor(personId)` is exported for the `partner`
presence path to enforce it.

Errors: `document_not_found`, `checkin_challenge_invalid`, `checkin_locked`, `upload_invalid`, `forbidden`.

## `routes.driver` — الرجعة garage mode additions (partner S-5, 2026-10-05)

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `checkIn` | mutation | `{departureId, pin, bookingId?}` — with `bookingId` (the PIN typed on that rider's seat) only that booking can match; another rider's PIN is `pin_invalid`. Every PIN typed is logged (see "Seat PIN safeguards" below) | `DriverDepartureView` |
| `callRider` | mutation | `{departureId, bookingId}` | `CallSession` (as `chat.requestCall`) — masked call to a booked or boarded rider on his own live run; event `departure.rider_call_requested` (ids only); `not_departure_driver`, `booking_not_found`, `departure_state_conflict`, `call_unavailable` |

The bridge is the chat module's, now in `apps/api/src/shared/call-bridge.ts` (`callBridgeFor`).

### Seat PIN safeguards (Ali, 2026-10-06)

The seat PIN stays on the rider's lock-screen boarding pass, so every PIN a driver types at a
departure is recorded and misuse reaches ops:

```
driver types a PIN (routes.driver.checkIn, with or without the seat's bookingId)
   └─ one intercity_pin_attempts row in the same write (append-only, ids only, never the PIN):
        driver, departure, target booking (the seat; null on the plain PIN pad), the booking the
        PIN belongs to on this car (if any), result, refused-on-this-seat count, alert, time
        ├─ checked_in ──────────► the rider boards (as before)
        ├─ other_booking ───────► pin_invalid + alert cross_use        (always)
        ├─ wrong_pin / not_boardable ► pin_invalid; at the 3rd refusal on one seat
        │                              (PIN_ATTEMPT_RULES.wrongOnSeatAlertAt) alert wrong_repeated, once
        └─ an alert is also seat.pin_alert on the departure's log (ids and seat ids only)
              └─ Console strip under the SOS banner, with the خطوط sweep rows (routes.ops.pinAlerts,
                 polled 5 s) for PIN_ATTEMPT_RULES.alertShowMin (60) minutes; the log stays
```

A refused PIN is committed before `pin_invalid` goes back (the driver's app is unchanged). The plain
PIN pad has its own count. Another driver's PIN typing on a car that is not his is refused before
anything is read (`not_departure_driver`) and not logged.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `routes.ops.pinAlerts` | query (dispatcher, support, admin) | `{cityId}` | `PinAlertView[]` `{alertId, kind: cross_use\|wrong_repeated, cityId, departureId, garageNameAr, corridorNameAr, departAt, driver {personId, displayName, phoneMasked}, targetBookingId, targetSeatIds, matchedBookingId, matchedSeatIds, refusedOnSeat, raisedAt, attempts[] PinAttemptView}` — cross-use first in the Console. The drivers' cards are one logged vault read (`intercity_pin_alert`); riders' names are never read |
| `routes.ops.pinAttempts` | query (dispatcher, support, admin) | `{departureId}` | `PinAttemptView[]` `{attemptId, at, driverId, targetBookingId, targetSeatIds, matchedBookingId, matchedSeatIds, result: checked_in\|wrong_pin\|other_booking\|not_boardable, alert}`, oldest first |
| `routes.ops.callPinAlertDriver` | mutation (dispatcher, support, admin) | `{alertId}` | `{mode, dial, expiresAt}` (as `khat.callSweepDriver`) — masked call to the car's driver; event `departure.pin_alert_call_requested` (no numbers); `not_found`, `call_unavailable` |

Table `intercity_pin_attempts` (UPDATE/DELETE rejected by the `reject_mutation` trigger), migration
`20261006161000_intercity_pin_attempts`. Console: `PinAlertRow` in `components/safety/sweep-strip.tsx`
("حيدر ك. كتب رمز راكب «ورا يسار» على مقعد «قدام»", the car, "شوف الرموز اللي انكتبت (3)" unfolds
the history, "اتصل ب…"). Console demo: `POST /demo/pin-alert[?kind=wrong]`. Not built: a dispatcher
"handled" button (the row leaves after an hour), and a PIN of a rider on another car (only this car's
bookings are matched).

## `khat.*` — خطوط driver side

Role: `khat_driver`. A run is a Trip of vertical `khat`; each stop carries one child's opaque `childRef`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `todayRun` | query | `{date?}` | `{localDate, trips[] KhatRunTrip}`; `KhatRunTrip = {tripId, state, stops[] {stopId, seq, type, state, zoneKey, windowStart, windowEnd, child {childRef, firstName}\|null, tappedInAt, tappedOutAt, absent}, childrenTotal, onBoard, delivered, absent}` |
| `tapIn` | mutation | `{tripId, stopId, pin?, occurredAt?, deviceUptimeMs?, idempotencyKey?}` (pickup stop) | `KhatRunTrip` — arrives the stop if still pending, then completes it with the child's tap |
| `tapOut` | mutation | same (dropoff stop) | `KhatRunTrip`; `khat.child_tapped_out` with `notifyGuardian: true` is the guardian's "arrived" push |
| `reportAbsence` | mutation | `{tripId, childRef, reason: guardian_notice\|not_at_stop\|sick\|other, note?}` | `{absenceId, tripId, childRef, reason, skippedStopIds, reportedAt}` — skips the child's unfinished stops, emits `khat.absence_reported`; repeating returns the first report |
| `substituteOffers` | query | `{cityId}` | `[{offerId, tripId, expiresInSec, stopsCount, childrenCount, firstWindowStart, zones, compensationIqd}]` — this driver's open offers on khat dispatch cards (substitute auction) |
| `acceptSubstitute` | mutation | `{offerId}` | `{outcome: assigned\|declined, tripId}` (goes through `dispatch.respond`) |
| `confirmEmptyCar` | mutation | `{tripId}` | `KhatRunTrip` with `emptyCarCheckedAt` — the end-of-run sweep "تأكدت، السيارة فاضية" (partner S-6, 2026-10-05). Every child stop must be settled (`khat_run_not_finished`); logged once per run as the trip event `khat.empty_car_confirmed` `{tripId, driverId, childrenTotal, delivered, absent, lastDropAt, secondsAfterLastDrop}`; repeating returns the first time |
| `callGuardian` | mutation | `{tripId, childRef}` | `CallSession` (as `chat.requestCall`) — masked call to the child's guardian for the run's own driver; vault read logged (`khat_guardian_call`), event `khat.guardian_call_requested` (no numbers); `call_unavailable` without a bridge |
| `sweepAlerts` | query (dispatcher, support, admin) | `{cityId}` | `KhatSweepAlert[]` `{alertId, tripId, cityId, driver {personId, displayName, phoneMasked}, childrenTotal, lastDropAt, lastDropZone, runEndedAt, raisedAt, confirmedAt, confirmedLateMin, closedAt, closedById, closeReason, closeNote}` — open alerts of the last 12 h first, then the ones confirmed late in the last 30 min; alerts a dispatcher closed are left out. The drivers' cards are one logged vault read (`khat_sweep_alert`) for the staff member; never a child's name |
| `callSweepDriver` | mutation (dispatcher, support, admin) | `{alertId}` | `{mode, dial, expiresAt}` (as `safety.requestCall`) — masked call to the run's driver; event `khat.sweep_call_requested` on the run (no numbers); `not_found`, `call_unavailable` |
| `closeSweepAlert` | mutation (dispatcher, support, admin) | `{alertId, reason: driver_called_empty\|guardian_called\|other, note?}` | `KhatSweepAlert` — "سكّر التنبيه" (Ali, 2026-10-06): reasons «اتصلت بالسايق، السيارة فاضية», «اتصلت بالأهل», «غيرها» (a note of 2–300 characters is required for `other`, optional otherwise). Sets `closedAt`/`closedById`/`closeReason`/`closeNote` once (conditional update), writes the audit entry `khat.sweep_close` (subject `khat_sweep_alert`) and the run event `khat.sweep_alert_closed` `{alertId, tripId, closedById, reason, hasNote}` in the same unit of work. Idempotent: a second close returns the first; an alert the driver already confirmed is returned unchanged (`closedAt` null, nothing audited). A later driver confirm still sets `confirmedAt`. `not_found` |

`KhatRunTrip.emptyCarCheckedAt` (date or null) is read back from that event. `todayRun` keeps a run
that completed with its last drop-off on the list until its car is checked (2026-10-06), so the sweep
is still there after an app restart.

### The late sweep (Ali, 2026-10-06)

```
last child stop settles (tap-out, or the rest absent)
   └─ khat.timers job at +KHAT_RULES.sweepAlertAfterMin (5; env KHAT_SWEEP_ALERT_AFTER_MIN)
        ├─ car checked by then ─► nothing
        └─ not checked ─► khat_sweep_alerts row (one per run) + khat.sweep_missed
                            ├─ notify ─► push khat_sweep_reminder to the driver
                            │           "نسيت تتأكد إن السيارة فاضية؟ / باوع عالمقاعد الخلفية"
                            ├─ khat:sweep-page ─► khat_sweep_dispatch_alert to every live dispatcher
                            │           and admin (push + WhatsApp, SMS twin after 60 s), as SOS pages
                            │           "خط #4821: ما تأكد إن السيارة فاضية من 5 دقايق"
                            └─ Console strip under the SOS banner (khat.sweepAlerts, polled 5 s)
driver's late "تأكدت" ─► confirmed_at set once + khat.sweep_alert_cleared {lateMin}
                         ─► the row says "تأكد متأخر {n} دقيقة" (minutes from the last drop), 30 min
dispatcher's "سكّر التنبيه" + reason ─► closed_at / closed_by_id / close_reason / close_note set once,
                         audit khat.sweep_close + khat.sweep_alert_closed; the row leaves the strip
```

The timer is armed by `tapOut` / `reportAbsence` and by the outbox subscriber `khat:sweep-timer`
(`khat.child_tapped_out`, `khat.absence_reported`), one job id per run end; the check re-reads the
run, so a redelivery or a second instance changes nothing (unique `trip_id`). The queue is BullMQ
with `REDIS_URL` (survives restarts), otherwise in process (polled once a second). Runs where no
child ever got in are left alone. Table `khat_sweep_alerts`, migration `20261006150000_khat_sweep_alerts`.
Console demo: `POST /demo/khat-sweep[?late=1]`.

**The dispatchers' page (Ali, 2026-10-06).** The outbox subscriber `khat:sweep-page` answers
`khat.sweep_missed` the way SOS pages the desk: identity's roster of live dispatchers and admins
(`SAFETY_PAGED_ROLES`, shared with SOS; frozen accounts and the driver himself left out) each get the
template `khat_sweep_dispatch_alert` (category safety, push + WhatsApp, the usual 60-s SMS twin, sent in
quiet hours; no escalation). Params: the driver's short name (a logged vault read, `system:khat` /
`khat_sweep_page`), the run's `#ticket`, the minutes since the run ended in their natural form via
`t()`, and the Console link (`CONSOLE_BASE_URL` + `/safety`). Never a child's name. Once per alert: the
event is once per run and notify dedupes event + person; nothing is sent when the driver confirmed, or
a dispatcher closed it, before the outbox got there.

**Closing an alert (Ali, 2026-10-06).** `closeSweepAlert` above; the Console row has «سكّر التنبيه»
next to the call button (a dialog with the three reasons and the note). Columns `closed_at`,
`closed_by_id` (staff person id, no names), `close_reason`, `close_note`; migration
`20261006180000_khat_sweep_alert_close`. Open alerts nobody closes still leave the strip after
`sweepOpenShowHours` (12); the record stays.

Children's names: first name only, read through identity for the run's own driver (`childCardsForRun`, which also carries the guardian's photo of the child — see docs/api/driver-photos.md),
every read a `VaultAccessLog` row with purpose `khat_today_run`. Errors: `khat_not_child_stop`,
`khat_child_not_on_trip`, `khat_child_absent`, `khat_child_not_tapped_in` (tap-out before tap-in), `stop_state_conflict` (absence after tap-in), `forbidden`.

## `fleet.*` — fleet owner dashboard

Role: `fleet_owner` scoped to the fleet org. `fleetOrgId` may be omitted when the caller owns exactly one.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `overview` | query | `{fleetOrgId?}` | `{fleetOrgId, totals {vehicles, drivers, online, onJob, todayEarningsIqd, weekEarningsIqd, owedIqd}, vehicles[], drivers[], expiringDocuments[] {driverId, kind, status, expiresAt, daysToExpiry}, days[7] {date (local YYYY-MM-DD, Sunday first), earningsIqd, jobs}}` |
| `vehicles` | query | `{fleetOrgId?}` | `[{vehicleId, plate, vehicleClass, activeDriverId, active, seats, model, colour, features, featuresConfirmed}]` (the last four: ride step 3, `docs/api/vehicle-features.md`) |
| `drivers` | query | `{fleetOrgId?}` | `[{driverId, name, phoneMasked, state: offline\|online\|on_job\|over_cap, vehicleId, tier, todayEarningsIqd, weekEarningsIqd, owedIqd, cashHeldIqd, capIqd, documents (worst status)}]` |
| `driverEarnings` | query | `{fleetOrgId?, driverId, period = 'week', anchor?}` | `EarningsView` (as `driverAccount.earnings`) |
| `assignDriver` | mutation | `{fleetOrgId?, vehicleId, driverId \| null}` | `FleetVehicle` (a driver leaves his other vehicle) |
| `addVehicle` | mutation | `{fleetOrgId?, plate, vehicleClass, seats? (0–14; default by class: bike 0, tuktuk 3, car 4, suv 6, van 7), model? (2–40), colour? (VehicleColour)}` | `FleetVehicle` (seats stored as the vehicle's seat map) |
| `addDriver` | mutation | `{fleetOrgId?, phone, vehicleId?}` | `FleetDriver` with `pending: true` (person found or created by phone; the driving role still comes from ops review). `vehicleId` (f5, additive): the car picked on the same screen waits on the invite (`plannedVehicleId` on the pending row, column `fleet_drivers.planned_vehicle_id`) and is assigned when he accepts, if it is still the fleet's, active and free; `vehicle_not_found` otherwise at invite time |
| `myInvites` | query | — (driving roles) | `[{fleetOrgId, invitedAt, invitedByName (owner's first name), fleetName (additive), accepted, plannedVehicle (f5, additive: `{plate, vehicleClass, model, colour}` on a pending invite with a car, else null)}]` — the driver's own fleet links |
| `respondInvite` | mutation | `{fleetOrgId, accept}` (driving roles) | his links after: `accept` joins (and takes the planned car if still free, event `fleet.vehicle_assigned`), `false` declines or leaves (his vehicle there is unassigned); either answer clears the planned car |
| `myVehicle` | query | — (driving roles) | `FleetVehicle \| null` — the vehicle he is the active driver of (any fleet, or his own) |
| `setMyVehicleFeatures` | mutation | `{features: VehicleFeature[]}` (driving roles) | `FleetVehicle` — «مميزات سيارتك», see `docs/api/vehicle-features.md` |

**Consent (review 2026-10-04):** a link is pending until the driver accepts it. A pending row is the bare
`driverId` with `pending: true` — no name, phone, money, documents or live state, no vault read — and it
cannot be assigned a vehicle or read through `driverEarnings` (`driver_not_in_fleet`). Additive (follow-ups 2026-10-04): a pending row
carries `phoneHint` ("0770 ••• 4567", the number the owner typed, kept on his own `fleet.driver_added` event — still no vault
read) and `invitedAt`; the Partner app shows them under "بانتظار موافقة السايق" and the driver's invite card on home / الحساب. Once accepted,
earnings shown to the owner start at the moment he joined. Names are vault reads logged with purpose
`fleet_view`. Errors: `fleet_not_found` (also: no such link for `respondInvite`), `fleet_ambiguous`,
`vehicle_not_found`, `vehicle_plate_taken`, `driver_not_in_fleet`.

## `ops.*` — field ops mode

Roles: `field_ops`, `admin`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `addLandmarkPhoto` | mutation | `{target {kind: place\|meeting_point\|landmark, id}, uploadId, caption?, localNames[] (≤ 5)}` | `{photoId, target, state: 'proposed', addedAt}` (`landmark.proposed`; Console approves) |
| `recordCashReceipt` | mutation | `{courierId, amountIqd, code (courier's handover code), note?, idempotencyKey?}` | `{receiptId, courierId, amountIqd, reference (D-XXXX-XXXX), receivedAt, courierOwedIqd, courierCapRemainingIqd}` — posts ledger `driver_settlement` (channel `ops_round`) in the same unit of work; emits `ops.cash_received` (WhatsApp receipt) |
| `merchantOnboarding` | mutation | `{cityId, name, type: restaurant\|grocer, contact {name, phone}, location {zoneKey, pin?}, menuPhotoUploadIds[], shopPhotoUploadId?, notes?, settlementMode? (nightly_courier\|on_demand\|daily_zaincash\|weekly_bulk)}` | `{onboardingId, merchantOrgId, state: 'draft', menuPhotos, taskId, createdAt}` — owner phone/name go to the vault |
| `myTasks` | query | `{cityId?}` | `[{taskId, kind: cash_collection\|merchant_followup\|landmark_photo\|document_check, title_ar, refId, amountIqd, dueAt, state, computed}]` — computed `cash:<driverId>` tasks for couriers owing ≥ 50 % of their cap (or over it) |
| `completeTask` | mutation | `{taskId, note?}` | `OpsTask` (stored tasks only) |
| `cashHolders` | query | `{cityId?}` | `[{courierId, name, phoneMasked, heldIqd, owedIqd, capIqd, tier, overCap}]` — couriers holding customers' cash, over-cap then most owed first; names are vault reads (purpose `ops_cash_round`) |
| `landmarks` | query | `{cityId = 'aziziyah', zoneKey?}` | `[{placeId, name, zoneKey, pin, photos}]` — landmark places (fewest photos first); `photos` counts the place's photos plus ops proposals still pending. A new landmark is proposed with `addLandmarkPhoto` target `{kind: 'landmark', id: 'new:<zoneKey>'}` and its name first in `localNames` |

Errors: `handover_code_invalid`, `handover_code_locked` (5 wrong codes for the courier today), `cash_receipt_exceeds_held`, `task_not_found`, `upload_invalid`.

## `merchantAdmin.*` — Merchant app wave 2

Roles: `merchant_owner` / `merchant_staff` **scoped to `merchantOrgId`** (every input carries it).
Owner-only (staff get `FORBIDDEN`): `money.*`, `staff.*`, `deals.project`, `deals.propose`, `deals.setActive`.

| Procedure | Kind | Input | Output |
|---|---|---|---|
| `myMerchants` | query | — | `[{merchantOrgId, role}]` |
| `menu.get` | query | `{merchantOrgId}` | `{merchantOrgId, categories[] {nameAr\|null, items[] AdminMenuItem}}`; `AdminMenuItem = {id, nameAr, nameEn, description, priceIqd, photoUrl (signed), categoryAr, sortOrder, prepTimeMin, available, soldOutUntil, onSale, modifierGroups[]}` |
| `menu.setAvailability` | mutation | `{merchantOrgId, itemId, available}` | `AdminMenuItem` (turning on also ends "sold out today") |
| `menu.soldOutToday` | mutation | `{merchantOrgId, itemId}` | `AdminMenuItem` with `soldOutUntil` = next local midnight; customers see it unavailable until then, then it is back by itself |
| `menu.updatePrice` | mutation | `{merchantOrgId, itemId, priceIqd}` | `{item, history[] {oldPriceIqd, newPriceIqd, changedBy, at}}` (newest first) |
| `menu.priceHistory` | query | `{merchantOrgId, itemId}` | `PriceChange[]` |
| `menu.replacePhoto` | mutation | `{merchantOrgId, itemId, uploadId}` | `AdminMenuItem` |
| `menu.upsertItem` | mutation | `{merchantOrgId, itemId?, nameAr, nameEn?, description?, priceIqd, categoryAr?, sortOrder?, prepTimeMin?, available?}` | `AdminMenuItem` (new items get a first price-history row) |
| `menu.upsertCategory` | mutation | `{merchantOrgId, nameAr, renameFrom?, itemIds?}` | `AdminMenu` (sections are item `categoryAr`; `itemIds` places items in order) |
| `menu.reorderCategories` | mutation | `{merchantOrgId, order[] (section names)}` | `AdminMenu` — named sections in that order, others after them, the unnamed one last; items keep their order inside (sort orders become section × 100 + position, so the customer menu follows) |
| `menu.setModifiers` | mutation | `{merchantOrgId, itemId, groups[] {nameAr, nameEn?, minSelect, maxSelect, required, modifiers[] {nameAr, nameEn?, priceIqd, available}}}` | `AdminMenuItem` (replaces all groups) |
| `menu.importFromPhotos` | mutation | `{merchantOrgId, uploadIds[]}` | `MenuImportJob {jobId, state: 'draft', photoUploadIds, photoUrls (signed, same order), items: [], ocr: 'stub', …}` |
| `menu.importJob` | query | `{merchantOrgId, jobId}` | `MenuImportJob` |
| `menu.applyImport` | mutation | `{merchantOrgId, jobId, items[] {nameAr, priceIqd, categoryAr?, description?, sourceUploadId?}}` | `MenuImportJob` (`applied`, items created) |
| `deals.list` | query | `{merchantOrgId}` | `DealView[]` |
| `deals.project` | query | same input as `deals.propose` | `{projected {ordersPerWeek, costPerOrderIqd, weeklyCostIqd, totalCostIqd, basisOrders}, basisDays: 28, requiresApproval}` — owner only; the draft's projected cost before submitting (validated like `propose`, nothing stored) |
| `deals.propose` | mutation | `{merchantOrgId, type: percent\|fixed\|free_delivery\|bogo, value, nameAr, itemIds[], schedule {startsAt, endsAt, days[] 0–6, hours? {start, end}}, budgetCapIqd?, minOrderIqd}` | `DealView {dealId, …, projected {ordersPerWeek, costPerOrderIqd, weeklyCostIqd, totalCostIqd, basisOrders}, state: pending_approval\|approved\|rejected\|paused\|ended, state_ar, active, funder: 'merchant'}` — projection from the last 28 days of orders, server-side; city config `merchantDeals.requirePlatformApproval` (Aziziyah: true) |
| `deals.setActive` | mutation | `{merchantOrgId, dealId, active}` | `DealView` |
| `deals.review` | mutation | `{dealId, approve, reason?}` — roles `admin`, `support` | `DealView` |
| `money.today` | query | `{merchantOrgId}` | `{localDate, orders, salesIqd, commissionIqd, commissionByTier[] {tier, pct, baseIqd, commissionIqd, orders}, dealsIqd, netIqd, cashHeldByCouriersIqd, holders[] {courierId, amountIqd}, payableBalanceIqd, settlementMode, overExposure}` |
| `money.cash` | query | `{merchantOrgId}` | `MerchantCashAccount {balanceIqd, exposureCapIqd, overExposure, mode, holders[] {courierId, name (first name), amountIqd}, heldByPlatformIqd, request {reference, reason, requestedAt, amountIqd, state: requested\|on_the_way\|handed_over, channel, courierId, courierName, assignedAt, targetBy, handover} \| null, handovers[] {handoverId, at, courierId, courierName, amountIqd, balanceAfterIqd, confirmedBy: pin\|tablet}, lastSettledAt}` — the "اطلب فلوسك" timeline follows `merchant.settlement_requested` → `merchant.settlement_assigned` (same reference) → the courier's next hand-over (14 days of hand-overs, latest request within 24 h) |
| `money.statement` | query | `{merchantOrgId, weekOf?}` | `{from, to, openingIqd, closingIqd, lines[] {orderId, at, payment, itemsIqd, commissionTier, commissionIqd, feesIqd, netIqd}, settlements[] {at, kind: courier_handover\|payout, amountIqd, reference}, totals}` |
| `money.disputes` | query | `{merchantOrgId}` | `[{orderId, kind, note, openedAt, evidence {acceptedAt, readyAt, pickedUpAt, deliveredAt, promisedReadyAt, lines[] {name, qty, participant}, itemsIqd}, defaultOutcome {code, text_ar, merchantImpactIqd}, response\|null}]` (last 30 days) |
| `money.respondDispute` | mutation | `{merchantOrgId, orderId, decision: accept_default\|contest, note?, evidenceUploadIds[] ≤ 5}` | `MerchantDispute` (re-answering replaces; emits `merchant.dispute_responded`) |
| `insights` | query | `{merchantOrgId, days = 30}` | `{prepHonesty {samples, quotedAvgMin, actualAvgMin, onTimeShare}, rejection {offered, rejected, rate}, itemRatings[] {itemId, nameAr, avg, count, reviews[] {score, note, at}}, peakHours[24]}` |
| `staff.list` | query | `{merchantOrgId}` | `[{personId, name, phoneMasked, role, you}]` (vault reads logged, purpose `merchant_staff_view`) |
| `staff.invite` | mutation | `{merchantOrgId, phone, role = 'merchant_staff'}` | `StaffMember` (grants the role scoped to the org) |
| `staff.setRole` | mutation | `{merchantOrgId, personId, role}` | `StaffMember` |
| `staff.remove` | mutation | `{merchantOrgId, personId}` | `{removed}` (also cancels a waiting invite) |
| `staff.resendInvite` | mutation | `{merchantOrgId, personId}` | `StaffMember` — a waiting invite goes out again (`merchant.staff_invite_sent` on stream `merchant_staff/<org>`, also emitted by `invite`); within 10 min of the last send it is a no-op; `staff_invite_not_pending` once he signed in |
| `activity.today` | query | `{merchantOrgId, date?: YYYY-MM-DD}` (Baghdad day, default today) | `{merchantOrgId, localDate, entries[] {at, kind, orderId, orderNumber, dishName, until, who {personId, name, you}\|null, reason}}` newest first, ≤ 200. **Owner only** (staff `FORBIDDEN` on the server). «مين سوّى شنو» (2026-10-08) |
| `activity.order` | query | `{merchantOrgId, orderId}` | `{orderId, entries[]}` oldest first (the order sheet's who-line). **Owner only**; another store's order `NOT_FOUND` |

Additive fields (Merchant app wave 2): statement lines carry `commissionPct`, `discountIqd`, `discountFunder`
(platform promos today: they don't lower the merchant's net); disputes carry `respondBy` (opened + 48 h, then
the default outcome stands), `evidence.photos` and `response.photoUrls` (signed); insights carry
`rejection.trend[]` (7-day buckets), `peakGrid[7][24]` (weekday × hour), `bestSellers[]` (by sales) and
`orders`, and a rated order's food score goes to its main dish (largest line) only (review 2026-10-04 #10:
for `merchant_staff`, `bestSellers[].salesIqd` is null and the list is ranked by quantity; prep honesty,
rejections, ratings and peaks are unchanged); staff rows carry
`pending` (given the role and not signed in or refreshed since; review 2026-10-04: a pending row has `name: null`, so inviting a phone is not a name lookup). `merchant.paid_by_courier` events carry `confirmedBy`.
`orders`, and a rated order's food score goes to its main dish (largest line) only; staff rows carry
`pending` (given the role and not signed in or refreshed since; review 2026-10-04: a pending row has `name: null`, so inviting a phone is not a name lookup), and pending rows carry `phoneHint` ("0780 ••• 3344"), `invitedAt`, `inviteSentAt`, `resendAfter` (follow-ups 2026-10-04). `merchant.paid_by_courier` events carry `confirmedBy`.

«مين سوّى شنو» (`activity.*`, 2026-10-08): `kind` is `accept`, `auto_accept`, `partial`, `reject`, `auto_reject`
(timed out; `reason: merchant_timeout`), `ready`, `extend` («+5 د»), `hand_over`, `sold_out` (`until` when «خلص اليوم»),
`back_on`. Read from `order.accepted`/`order.auto_accepted`/`order.partial_proposed`/`order.rejected`/`order.ready`/
`order.prep_extended`/`order.handed_over` on the day's orders (indexed `order_id`) and `item.sold_out`/`item.restocked`
on `org/<merchantOrgId>` (indexed aggregate + `occurred_at`). Left out: the customer approving a partial order
(`order.accepted` with `partial: true`) and a «جاهز» implied by the courier's pickup (`implied: true`), so neither a
customer's nor a courier's id is ever named. `who` is null for what the system did; otherwise the name comes from one
batched vault read per call (purpose `merchant_activity_view`, logged), name only (no phone); a deleted person or a
missing name has `name: null` (the app shows «موظف سابق»). Board and order payloads never carry actor ids.

Errors: `menu_item_not_found`, `import_job_not_found`, `import_state_conflict`, `deal_not_found`,
`deal_invalid`, `deal_state_conflict`, `dispute_not_found`, `dispute_response_closed` (after `respondBy`), `staff_last_owner`, `staff_invite_not_pending`, `upload_invalid`.

## `merchant.hours` / `merchant.setHours` — opening hours (follow-ups 2026-10-04)

| Procedure | Roles | Input | Output |
|---|---|---|---|
| `merchant.hours` | owner or staff of the store | `{merchantOrgId}` | `StoreHoursView {source: store\|catalog\|none, days[7] {dow, shifts[] {start, end}}, holidays[] {from, to, note}, pauses[] {dow, start, end, reason}, now, today, state {open, reason: hours\|holiday\|pause\|closed\|null, closesAt, opensAt {date, dow, time}}, canEdit, updatedAt}` |
| `merchant.setHours` | owner (staff `FORBIDDEN`) | `{merchantOrgId, days[7], holidays[] ≤ 20}` | `StoreHoursView` |

Rules (`@driver/contracts` `store-hours.ts`, shared with the app): local "HH:MM" (Baghdad); up to 3 shifts a day; an end not after its
start runs past midnight; shifts ≥ 30 min and never overlapping (across midnight and Saturday → Sunday too); at least one open day
(closing every day is the early-close switch); closures in order and ≤ 31 days; past closures are dropped. Error `store_hours_invalid`.
Stored on `orgs.opening_hours` / `holiday_closures` / `hours_updated_at` (migration `20261004200000_merchant_opening_hours`; NULL =
the catalog's seeded hours) and mirrored onto the storefront's `hours`, which the customer card's open/closed reads. A holiday makes
`MerchantProfile.closed` (and additive `holiday`) true for the day, so `orders.place` refuses like an early close and the card reads
closed by hours. `merchant.storeStatus` carries an additive `schedule {inHours, holiday, closesAt, opensAt}`; `open` keeps its meaning
(switch + pause), the board explains "برّا وقت الدوام" separately. Event `merchant.hours_set`.

## `merchant.pickupSpot` / `merchant.setPickupSpot` — where couriers collect (maps program r7, 2026-10-06)

| Procedure | Roles | Input | Output |
|---|---|---|---|
| `merchant.pickupSpot` | owner or staff of the store | `{merchantOrgId}` | `PickupSpotView {merchantOrgId, note, photos[] {id, url}, canEdit, updatedAt}` |
| `merchant.setPickupSpot` | owner (staff `FORBIDDEN`) | `{merchantOrgId, note ≤ 140 chars \| null, photoIds[] ≤ 2, no repeats}` | `PickupSpotView` |

`PICKUP_SPOT_RULES` (`@driver/contracts`): 2 photos, 140-character note. `setPickupSpot` replaces the spot: ids already on it stay,
new ids must be the caller's own stored uploads (`places.photoUpload` ticket + PUT; else `upload_invalid`), photos left out are
deleted from storage. No note and no photos clears it (`updatedAt: null`). URLs are signed, short-lived links (never public).
Stored on `orgs.pickup_note` / `pickup_photo_refs` / `pickup_updated_at` (migration `20261006191000_pickup_spot`). Event
`merchant.pickup_spot_set {photos, note}`.

Courier side: `partner.activeJob` stops carry an additive `pickupSpot {note, photos[] {id, url}} | null` on a pickup not yet
completed or skipped — only for the assigned courier from accepting until an hour after the trip (`courierMaySeePlaceDetails`, the
customer's door rule). Gone once he picked up.

### `ops.pickupSpots.*` — set from the Console (Ali 2026-10-07)

| Procedure | Roles | Input | Output |
|---|---|---|---|
| `ops.pickupSpots.stores` | `PICKUP_SPOT_CONSOLE_ROLES` (field_ops, admin; support `FORBIDDEN`) | `{cityId}` | `PickupStoreRow[] {merchantOrgId, name, type, note, photos (count), updatedAt, shopPhoto, dishes, dishesNoPhoto}` by name (k6: `shopPhoto` = the storefront has a photo; `dishesNoPhoto` = menu items with neither the kitchen's photo nor a library one) |
| `ops.pickupSpots.get` | same | `{merchantOrgId}` | `ConsolePickupSpotView` = `PickupSpotView` (canEdit true) + `storeName`, `consoleEdit {at, byName} \| null` |
| `ops.pickupSpots.set` | same | `SetPickupSpotInput` (the owner's input) | `ConsolePickupSpotView` |

Console › المطاعم (`/stores`, `/stores/[id]`). `set` goes through `MerchantService.consoleSetPickupSpot`: the owner's rules
unchanged (new photos must be the caller's own `places.photoUpload`, dropped photos deleted, empty clears) and the same
`merchant.pickup_spot_set` event with `by: 'console'`; then a `console_audit_log` row (`store.pickup_spot_set`, subject
`store:<orgId>`). `consoleEdit` is that row while it is newer than the owner's last save. Unknown org or a household →
`org_not_found`. Draft rules shared by both apps: `pickupDraft` (`@driver/contracts`).

`merchant.customerZones` («منين زبائنك») is owner only since 2026-10-07 (staff `FORBIDDEN`, the money screens' check);
`merchant.deliveryArea` stays owner and staff.

## UI/UX audit Phase 1 — missed orders and "+5 د" (2026-10-04)

| Procedure | Roles | Input | Output |
|---|---|---|---|
| `merchant.board` (additive) | owner or staff of the store | `{merchantOrgId}` | adds `missed {today, orders[] {orderId, number, reason: merchant_timeout\|partial_timeout, placedAt, missedAt, itemCount, totalIqd, scored}}` and per card `prepExtended` |
| `orders.merchant.extendPrep` | staff of the order's store | `{orderId}` | `Order` (with `prepExtendedAt`) |

- **Missed orders (M-01).** Today's (Baghdad day) orders that left without the kitchen's answer: nobody accepted
  in 90 s (`merchant_rejected` / `merchant_timeout`, counted in `today`) or the customer let a partial accept lapse
  (`platform_cancelled` / `partial_timeout`, listed, not counted). `scored: false` when the miss fell inside a pause
  window. Newest first, at most 10 listed (`MISSED_LIST_MAX`). Read from the orders the store already has; nothing new
  is stored. The app keeps them in a strip until "تمام" (seen ids per device).
- **"+5 د" (M-12, approved by Ali).** Once per order (`MERCHANT_PREP_EXTENSION`), while `merchant_accepted` or
  `preparing`: `promisedReadyAt` += 5 min, `orders.prep_extended_at` set (migration `20261005120500_order_prep_extension`),
  the overdue / courier-release checks are re-armed on the new promise, event `order.prep_extended {merchantOrgId,
  minutes, from, promisedReadyAt}`. The live fan-out re-reads the customer's tracking (new ETA) and the board; notify
  sends push `order_prep_extended` ("المطعم زاد 5 دقايق") to the customer. Errors: `prep_already_extended` (second
  time), `order_state_conflict` (not accepted, or already ready), `forbidden`.
- One-tap accept is the app calling `orders.merchant.accept` with the store's usual prep time
  (`storeStatus.defaultPrepMinutes`); busy mode still adds its 10 minutes on the server.

## Persistence

Migration `packages/db/prisma/migrations/20261004000000_partner_merchant_wave2`: tables `driver_documents`,
`driver_check_ins`, `khat_absences`, `fleet_drivers`, `landmark_photos`, `ops_cash_receipts`,
`merchant_onboardings`, `ops_tasks`, `catalog_price_changes`, `menu_import_jobs`,
`merchant_dispute_responses`; columns `catalog_items.sold_out_until`, `promotions.proposal_state`,
`promotions.projected_cost_iqd`. Every new repository has a Prisma and an in-memory twin (Prisma when
`DATABASE_URL` is set); `apps/api/src/wave2.integration.test.ts` round-trips all of them.

## Known gaps / TODO

- **Orgs are still in memory** (`OrgsService`). `ops.merchantOnboarding` creates the draft org there; the
  onboarding row persists, the org does not survive a restart. Fleet vehicles (`vehicles.owner_org_id`)
  and merchant deals (`promotions.merchant_org_id`) reference `orgs` rows, so with a database those orgs
  must exist as rows (seeded / Console). New wave-2 tables deliberately have no foreign keys to `orgs`.
- ~~Deals are not redeemed at checkout yet.~~ Done 2026-10-04: see `docs/api/deals-and-topup.md`
  (best live deal applied server-side, spend reserved atomically against the cap, commission on items
  after the deal, `money.today.dealsIqd` real).
- **Menu photos** replaced by merchants are stored as `upload:<id>` in `catalog_items.photo_url`; the
  admin view signs them, the customer catalog (`catalog.*`) does not yet.
- **Liveness and face match are stubs** (device SDK score, default 1); OCR for menu import is a stub
  (empty draft, staff type the rows).
- **Online gate enforcement**: `partner.goOnline` calls `DriverAccountService.onlineGateFor` and refuses with
  `online_checkin_required` / `checkin_locked` / `online_document_expired`; `partner.status.gate` carries
  the reasons. A refused heartbeat takes an online driver out of the index (lock-out, expired document).
  Nothing pushes a driver offline the moment `driver.checkin_locked` fires or a document expires: it
  happens at his next heartbeat (≤ 30 s while the app is open).
- **Registered vehicle and roles** (review 2026-10-04 #20): `partner.goOnline` puts him online on his
  registered vehicle (`vehicles.active_driver_id`: the courier-card registry, else the fleet registry;
  nothing registered = a bike). A `vehicleClass` different from it is refused (`vehicle_not_registered`).
  Presence carries what he may be offered — his roles on that vehicle: `courier` → food, grocery, errand,
  parcel; `shopper` → grocery, errand; `driver` → taxi (car/SUV) or tuktuk rides (tuktuk); `khat_driver` →
  khat; `intercity_driver` → intercity — and dispatch skips candidates whose list lacks the job's
  vertical. A driving role with nothing to serve on his vehicle is refused the same way.
- **Small heartbeat answer** (perf o4): `partner.goOnline` takes an optional `knownVersion` (the
  `version` of the status the app holds; `""` when it holds none). Sent → the answer is
  `{ changed: false, version }` while his work state (gate, roles, vehicle, presence zone/tier/since,
  cash and cap, trips, ringing offer, climate question) still has that version — the status is not
  built — else `{ changed: true, version, status }`. Left out → the full `PartnerStatus`, as before, so
  older apps keep working. His position, the city's demand hint and today's earnings are not in the
  version: the app keeps the position it sent, and `partner.status` (re-read on live events and by its
  poll) brings the rest.
- **Lighter heartbeat** (speed x2): the app's own reads (`partner.goOnline`, `partner.status`) keep his
  cash-limit role and tier for 5 minutes (`KEPT_LIMIT_MS`; the tier reads his whole event history),
  while his cash and earnings are read on every beat, so what he holds is never stale. Dispatch's
  over-cap check and the money desk always work the limit out fresh. His ringing offer is found from
  his own open offers (one indexed read of `dispatch_offers` by driver and state) instead of reading
  the offers of every live trip in the city. Seeded town: the small beat 14 → 13 statements with the
  two event-history reads gone; the full status 15 → 13; the offer lookup stays at one read however
  busy the board is (before: one per live trip).
- Shift-guarantee top-ups are shown when the ledger has them (`driver_incentive`, memo `guarantee…`);
  no job posts them yet. Courier-waiting charges to merchants are not ledger lines yet.
- The khat run is read from the driver's khat trips; spawning a day's trips from a khat `Route` /
  `Subscription` (`khat.day_run_spawned`) is not built.
- Drift: no Prisma schema engine was available here, so `prisma migrate diff` was not run; the
  migration was applied to a fresh PostGIS database together with all earlier ones, seeded, and checked
  column-by-column (types, nullability, defaults, index names) against `schema.prisma`. CI's drift step
  is the authority.
