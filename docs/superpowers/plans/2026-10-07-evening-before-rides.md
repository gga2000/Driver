# Evening-before booked rides — implementation plan

> **For agentic workers:** implement task by task, TDD for logic, commit after every task (plain-English
> message ending in the Co-Authored-By line).

**Goal:** close J7d's deviation. Edge-case review #28, adopted in `docs/specs/2026-10-03-edge-case-decisions.md`
("evening-before scheduled rides"): *scheduled rides are offered the evening before as pre-assigned jobs; the
driver confirms by 22:00; fallback broadcast at T−30 with pickup compensation; customer told at booking whether
a driver is confirmed.*

**What exists (J7d, `docs/api/ride-habits.md`):** rides booked 20 min – 7 days ahead (`scheduledFor`); dispatch
holds the request (`scheduled`, «مجدول») and starts the smart broadcast 15 min before (`broadcast_start`); a
favourite gets the first 60 s alone. Dispatch state is JSON in Redis (`DispatchRequest`), so new fields need no
migration.

## Decisions

1. **Which rides are pre-assigned** (pure `bookedRideWindow` in contracts, city config
   `DispatchConfig.bookedRides` on taxi and tuktuk):
   - *Tomorrow and later:* offered from **18:00 the evening before** (`offerFromHour`), or at booking if later;
     confirm by **22:00 that evening** (`confirmByHour`, city config). Needs at least **30 minutes** to answer
     (`minOfferWindowMin`): booked after 21:30 the evening before → no pre-assignment.
   - *Same day:* only when booked **at least 3 hours ahead** (`sameDayMinLeadMin`); offered at once, confirm
     by **90 minutes before** (`sameDayConfirmLeadMin`) and never after 22:00 that day; same 30-minute floor.
   - Everything else (booked late, too close): no pre-assignment, the search starts at T−30.
   - Nothing is ever offered for confirmation after 22:00 (no driver is asked at night).
2. **Who sees it:** online drivers whose vehicle, roles, tuktuk edge rule, order cap and cash cap fit the job —
   the same checks as normal dispatch (`fits`, shared with `candidates`). A ride with a favourite: **he alone
   for the first 60 minutes** (`favouriteFirstMin`, at most half the window), then everyone. «مو إلي» from the
   favourite opens it to everyone at once. Pushes: the favourite when it opens to him; up to 10 fitting online
   drivers (`notifyDrivers`, ranked like dispatch) when it opens to all; both held through quiet hours.
3. **Confirm:** first confirm wins (`SET NX` on `dispatch:booked:<trip>`). A driver may hold booked jobs at
   least 60 minutes apart (`minGapMin`, `booked_job_clash`). The partner view shows time, pickup and drop-off
   **zones**, the trip km and his pay — like an offer, never a door or a name.
4. **The confirmed driver:** reminded at **T−60** (`reminderLeadMin`, push, sent even in quiet hours: he
   committed); may tap «طالع هسة» from T−60 (online, free, cap room → the trip is his, `dispatch.assigned`
   policy `booked`). At **T−30** dispatch starts it for him if he is online, free and has cap room; otherwise
   it is **released** (`no_show`) and the fallback search starts at once.
5. **Release:** «ما أگدر أجي» before 22:00 (the confirm deadline) → back on offer for the others (he can't take
   it again); after it → released, fallback at T−30 (or at once when already past T−30).
6. **Fallback at T−30** (`RIDE_HABIT_RULES.schedule.searchLeadMin` 15 → **30** for every booked ride with no
   confirmed driver): the J7d search (favourite's minute first unless he is the one who released, then the
   waves). **Pickup compensation** on every offer of that search = `MoneyRules.bookedRideFallback`
   (`enabled: false`, `pickupCompensationIqd: 0`): **Ali hasn't set the amount, nothing is paid**. Open decision.
7. **State machine** (pure `dispatch/booked.ts`): `waiting → offered → confirmed → reminded → started`;
   `offered → unconfirmed` at the deadline; `confirmed|reminded → offered` (released before the deadline) or
   `→ released` (after it, or no-show at T−30); any → `cancelled`. Never two confirmed drivers; never started
   twice; the T−30 timer either starts the confirmed driver or begins one search, never both.
8. **Customer told:** `rideHabits.bookedRide({orderId})` → `confirmed` (first name, approved photo — logged
   vault read, purpose `booked_ride_driver`), `looking` (confirm-by time) or `later` (search time). Booked
   screen and home card: «سايقك محجوز: حسين» / «ندوّرلك سايق، نأكدلك قبل 10 بالليل» / «نبدي ندوّرلك سايق
   4:30 الصبح». Pushes `booked_ride_confirmed`, `booked_ride_unconfirmed` (at the deadline),
   `booked_ride_released`: order updates, held through quiet hours.
9. **Driver told:** `partner_booked_offer` (held in quiet hours), `partner_booked_reminder` and
   `partner_booked_cancelled` (the customer cancelled a job he holds; sent any time).

## API

| Procedure | Who | Input | Output |
|---|---|---|---|
| `partner.bookedJobs` | driving roles | — | `PartnerBookedJobs` (`online`, `mine`, `open`) |
| `partner.answerBookedJob` | driving roles | `{tripId, answer: confirm \| pass \| release \| start}` | `PartnerBookedJobs` |
| `rideHabits.bookedRide` | signed in | `{orderId}` | `BookedRideStatus` |

Events (trip aggregate, `orderId` set): `dispatch.booked_offered`, `dispatch.booked_opened`,
`dispatch.booked_passed`, `dispatch.booked_confirmed`, `dispatch.booked_unconfirmed`,
`dispatch.booked_reminder`, `dispatch.booked_released`, `dispatch.booked_cancelled`; the start is the usual
`dispatch.assigned` (policy `booked`).

## File map

| Area | Files |
|---|---|
| Contracts | `booked-rides.ts` (+test), `city-config.ts` (`bookedRides`), `ledger-rules.ts` (`bookedRideFallback`), `ride-habits-io.ts` (lead 30, `BookedRideStatus`), `partner-io.ts`, routers `partner.ts` / `ride-habits.ts`, `notify-io.ts`, `errors.ts` |
| API | `dispatch/booked.ts` (+test), `offer.orchestrator.ts`, `dispatch.store.ts`, `dispatch.service.ts`, `booked.orchestrator.test.ts`; `partner` (service, ports, module); `ride-habits` (service, ports, module); `notify.subscribers.ts`; `config/cities/aziziyah.ts` |
| Customer | `app/ride/booked/[id].tsx`, `features/ride-habits/{Cards,queries,logic}.ts(x)`, demo hook, shots |
| Partner | `app/booked.tsx`, home card, `features/work/booked-logic.ts` (+test), queries, demo hook, shots |
| Copy | `packages/i18n/src/locales/{ar-IQ,en}.json` |
| Docs | `docs/api/ride-habits.md`, J7d plan's deviation note, READMEs |

No migration: dispatch state is Redis JSON; nothing new is stored in Postgres.

## Tasks

1. Contracts: window rule, config, money rule, views, router, templates, errors, copy. Tests for the window.
2. Dispatch: pure state machine + tests; orchestrator (timers `booked_open`, `booked_fav_end`,
   `booked_deadline`, `booked_remind`; T−30 `broadcast_start` starts or releases); service methods; tests for
   offered → confirmed → reminded → started, unconfirmed → fallback T−30, released → fallback, no-show,
   favourite-first, clash, first-confirm-wins, cancel.
3. Partner service (`bookedJobs`, `answerBookedJob`) + tests; ride-habits `bookedRide` + test; notify mapping +
   tests.
4. Customer screen + home card; partner «مشاوير باچر» screen + home card. Loading, empty, error, offline.
5. Demo hooks, shots at 390 and 360, docs.
