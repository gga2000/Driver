# Taxi/tuktuk safety: the night trip code, «وصل بالسلامة», «نسيت غرض», «السايق قريب» (2026-10-07)

Ride step 3 (Ali's yes on s1, s2, s7 and d3). "Night" everywhere is `isNightAt` in
`packages/contracts/src/vehicle-features.ts`: 21:00–05:59 Baghdad. Rules and Console views:
`packages/contracts/src/ride-safety-io.ts`.

## s1 «رمز المشوار» — a night ride starts only with the rider's code

- **When.** A ride whose pickup is at night (`scheduledFor`, or the placing time for a ride wanted now)
  gets 4 digits at placement (`orders.start_code`; `apps/api/src/modules/orders/start-code.ts`). Drawn
  with `crypto.randomInt`, never a guessable one (one digit repeated, or a straight run up or down:
  `isGuessableStartCode`). Day rides and every other order have none. The code is fixed for the order.
- **Who sees it.** Only the orderer and the rider: `orders.track` → `OrderTracking.trip.startCode`
  (`track` is only ever answered for the orderer or a participant). It shows from the search until the
  rider is in (the pickup completed or skipped), and never on a settled order. It is not on the `Order`
  view, the partner job, any event or any Console read.
- **Starting the ride.** `trips.completeStop` on a night ride's pickup carries `startCode` (4 digits).
  The partner job marks that stop `startCodeRequired: true` (never the code).
  - no code → `start_code_required` (nothing counted);
  - a wrong code → `start_code_wrong`; the stop's `start_code_wrong` count goes up (its own
    transaction, so the refusal does not roll it back) and `stop.start_code_wrong`
    `{ stopId, cityId, wrong, alerted }` is logged — never the code, typed or real;
  - the right code (constant-time compare) → the pickup completes as before, and `stop.completed`
    carries `startCodeChecked: true`.
  Other stops, day rides and replays of a done stop ignore `startCode`.
- **Ops alert.** At `START_CODE_RULES.wrongAlertAt` (5) wrong codes on one pickup the stop is stamped
  `start_code_alert_at` once. `trips.startCodeAlerts({ cityId })` (safety desk roles:
  `SAFETY_DESK_ROLES`) lists the stamped pickups of the last `alertShowMin` (60) minutes as
  `StartCodeAlert` — the driver's short name and masked number (one logged vault read for the staff
  member, purpose `ride_start_code_alert`), the wrong count, and `startedAt` once the rider got in with
  the right code. The Console shows them on the safety strip under the SOS banner
  (`apps/console/src/components/safety/sweep-strip.tsx`), with «افتح الطلب».
- **Simulator.** Riders read their code to the driver at the pickup; about one in four drivers mistypes
  once first. Invariant `night_ride_starts_with_the_code`: every completed pickup of a night ride matched
  the code, and every finished night ride has such a start.
- **Demo.** Customer: `POST /demo/ride/night?orderId=` gives a day ride a night code. Partner:
  `POST /demo/ride-safety?who=tuktuk&step=at_pickup` answers with the `startCode` to type.

## s2 «وصل بالسلامة» — the rider's trusted people, in the app

On `order.completed` for a ride that ended at night, when the rider (the order's `rider` participant,
else the orderer) turned «بلّغهم من أوصل» on (`SafetyPrefs.notifyOnArrival`, the same switch as الرجعة's),
each trusted contact whose number has an account gets the push `ride_safe_arrival`
(«مشوار {name} خلص بالسلامة الساعة {time}»; category `safety`). In-app push only: nothing goes to a
number without the app, and it never says where he went. The accounts come from
`IdentityService.trustedContactAccounts` (a logged vault read; only person ids leave identity).

## s7 «نسيت غرض بالسيارة؟» — the chat with the driver, again for 24 h

- `chat.lostItem({ orderId })` (the orderer or the rider) → `{ threadId, openUntil }`. Only on a ride
  completed by a driver, within `CHAT_LOST_ITEM_H` (24) hours of the trip's end, else
  `chat_lost_item_unavailable`; someone else is `chat_not_party`. It reopens the customer↔driver thread
  until the ride's end + 24 h (`chat_threads.lost_item_until`) and writes one line the server owns
  (`kind: 'system'`, «الراكب يدور على غرض نساه بالسيارة»), which pushes the driver like any message.
  Asking again keeps the same window and writes nothing new. The send rate limit applies.
- `chat.lostItems()` (driving roles) → the driver's reopened chats still open, newest ask first
  (`ChatLostItemThread`: `orderId`, `threadId`, `openUntil`, `askedAt`, `unread`). The partner home
  shows one strip per chat.
- Everything else is the chat as before (masking, quick replies, read receipts); after `openUntil` the
  thread is read-only again.

## d3 «السايق قريب، اطلع هسة»

While a ride's driver is on his way to the pickup (`accepted` / `en_route_to_pickup`), each position fix
within `RIDE_NEAR_RULES.checkWithinM` (1.5 km) asks tracking for the one ETA the rider's screen shows
(`liveEta`). The first time it is `etaSec` (60) seconds or less, the pickup's `courierNearAt` is stamped
and `stop.driver_near` `{ stopId, etaSec }` goes out: the push `ride_near` («السايق قريب» / «اطلع هسة،
يوصلك خلال دقيقة») to the orderer and the rider, and the live screen's toast. Once per ride; a routing
failure only skips that fix.
