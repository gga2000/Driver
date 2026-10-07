# A ride «بعدين» and «نفس مشوار البارحة؟» (step 4, c10 + o4, 2026-10-07)

Builds on the rides booked for later of J7d (`ride-habits.md`). Shared rules:
`packages/contracts/src/ride-habits-io.ts` (`RIDE_HABIT_RULES.schedule` and `.sameRide`, pure and tested).
Migration: `20261007233000_step4_ride_later_same_ride` (`notify_preferences.same_ride`, the
`ride_footprints` table — ids, points and times only; names stay in the vault). **No money rule
changes**: the fare is the server's quote for the ride's time, cancelling follows the existing rules.

## c10 — booking a ride for later

`orders.place` with `type: 'ride'` and `scheduledFor` (unchanged procedure, its rules tightened):

| Rule | Value | Where |
|---|---|---|
| Window | 20 minutes – 7 days ahead | `schedule.minLeadMin`, `maxAheadDays` |
| Slots | on the 5-minute grid, else `ride_schedule_invalid` (`off_grid`); the app offers quarters | `schedule.gridMin`, `rideScheduleProblem` |
| Price | `pricing.quote(..., at: scheduledFor)` — the time-of-day rules of that time; the fare sent must match | orders service |
| Search | the dispatch request waits («مجدول») until **15 minutes before**, then the normal broadcast | `schedule.searchLeadMin`, `rideSearchStartsAt` |
| Reminder | a push **30 minutes before** — only when booked at least 30 minutes before that | `schedule.reminderLeadMin`, `reminderMinGapMin`, `rideReminderAt` |
| Cancel | free while no driver accepted (state `placed`), as for any ride; nothing new | `orders.cancel` |

**Reminder.** Placing the ride enqueues the order timer `order.rideReminder` (BullMQ delayed job, id
`order|<id>|rideReminder`, payload `{orderId, refMs}`). When it fires and the order is still a `placed`
ride with the same `scheduledFor`, the server emits `order.ride_reminder`
`{customerId, scheduledFor, searchAt}`; notify sends the template `ride_booked_reminder`:

- «مشوارك 7:00 ص» / «نبدي ندوّر سايق 6:45 ص. ما تحتاجه؟ ألغيه ببلاش قبل ما يقبل سايق.»
- category `order_updates` (the «حالة طلباتي ورحلاتي» switch silences it); sent even in quiet hours (he
  asked for that time); opens `driver://ride/booked/{orderId}`.

**Restart.** Both waits live in Redis (BullMQ): the dispatch request's `startAt` timer and the order's
reminder timer. An API restart loses neither; a cancelled ride's reminder finds the order cancelled and
sends nothing.

**Customer app.**
- Choose screen «وكتها»: «هسة / بعدين». «بعدين» opens a sheet: the day (اليوم, باچر, then the
  weekday names, 7 days), the hour in large tiles grouped الصبح · الظهر والعصر · المسا والليل · بعد نص
  الليل, and the quarter next to «خليها باچر 7:15 ص». A picker day runs 5:00–4:59, so «باچر 1:00» is the
  night after tomorrow's evening; between midnight and 5:00 the first day is «الليلة».
- The chosen time stays in a summary row («محجوز لـ باچر 7:15 ص», «غيّر الوكت»), with the reminder and
  search hint; the button reads «احجز لـ باچر 7:15 ص · 3,000 دينار» (the server's quote for that time).
- «مشوارك محجوز» shows «نذكّرك بإشعار 6:45 ص.»; `/order/[id]` sends a booked ride there until its search.
- طلباتي: booked rides sit in «رحلاتك الجاية» by time (with the الرجعة seats), each with «ألغي» and a
  one-step confirm («الإلغاء ببلاش لأن بعد ما قبل سايق.»).

## o4 — «نفس مشوار البارحة؟»

**Footprints.** Every ride placed leaves a footprint (`ride-habits:footprints` subscriber on
`order.placed`): order id, rider, vehicle, door pickup, both ends (zone, pin, saved place id) and the
wanted time (`scheduledFor`, else placement). Redelivery changes nothing (keyed by order id).

**The habit** (`sameRideHabits`, pure):

| Rule | Value |
|---|---|
| Same ride | both ends within **200 m**, the same way round, the time within **±20 minutes** |
| Days | **3 of the last 4 working days** (Sunday–Thursday; Friday and Saturday never count and never get the push), including the last working day; one ride a day counts |
| Rides | only finished ones (delivered) |
| Its time | the median of those rides' times, rounded to 5 minutes; vehicle, door choice and ends from the latest |

**The push.** `SameRideJob` looks every 5 minutes on working days (`rideHabits.sameRideDue`). A habit
whose time is **10 to 3 minutes away** gets one `same_ride.due` event — idempotency key
`same_ride.due:<person>:<date>`, so **at most one a day**, also across restarts and several API
instances. Nothing is sent when:

- he has a ride on — matched, searching, or booked within 60 minutes of that time;
- he already took (or booked) that ride today;
- one of his active regular trips covers it (r5 asks him itself).

Notify sends `same_ride_offer` («نفس مشوار البارحة؟») or, on a Sunday after the weekend,
`same_ride_after_weekend` («نفس مشوار الخميس؟»), body «البيت ← الدائرة · 7:30 ص. اطلبه بدگة وحدة.»
(his saved place names, else the zone names). Category `same_ride`, switch «نفس مشوار البارحة» in
notification settings (`NotifyPreferences.sameRide`, on by default); not promotional (it is his own
ride); sent in quiet hours like the reminder (he rides at that time).

**The link.** `driver://ride/again?from=<lat,lng,zone[,placeId]>&to=…&v=taxi|tuktuk&door=1|0`
(`encodeRideEnd` / `decodeRideEnd`). The customer app's `/ride/again` fills the booking — each end as
his saved place, a recent trip or a landmark when within 60 m, else a pin named by its zone — and opens
choose with «نفس مشوارك المعتاد. غيّر اللي تريده واطلب.» and a fresh quote. Nothing is requested
until he taps. A link that does not parse opens «وين رايح؟».

## Simulator

About 10 % of the rides that are not cancelled are booked 30–90 minutes ahead (on the 5-minute grid,
quoted for that time). Invariant `booked_ride_waits_for_its_search`: no driver is offered a booked ride
before its search starts (15 minutes before its time).

## Tests

`packages/contracts/src/ride-habits-io.test.ts` (window, grid, reminder time, habits, push window,
link), `apps/api/src/modules/orders/scheduled-ride.test.ts` (grid, reminder timer),
`apps/api/src/modules/notify/ride-later.notify.test.ts` (texts, quiet hours, switches),
`apps/api/src/modules/ride-habits/ride-habits.service.test.ts` and `footprints.subscriber.test.ts`
(the job's rules), `apps/customer/src/features/ride-habits/logic.test.ts` (the picker) and
`features/ride/logic.test.ts` (`spotForEnd`).

## Demo

Customer: `POST /demo/ride-habits?personId=…` (home and work saved, a ride booked for tomorrow) and
`POST /demo/same-ride?personId=…` → `{deepLink}` (the link the push carries for البيت ← الدائرة).
`SHOTS=later` in `apps/customer/scripts/web-shots.mjs`.
