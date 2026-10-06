# Tracking fixes (J1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every piece of logic gets a failing test first.

**Goal:** The live order screen stops interrupting and contradicting itself. The notification ask moves off the map; "delivered" plays once; "almost there" lands about 2 minutes out and turns into «حيدر عند بابك» at the door; the unreachable panel shows where the courier stands and «أني نازل» buys 2 free minutes, once (J-D8, server-side); with no road route there is no straight line across the river; screen readers hear the status; the route line stops rebuilding its SVG path every frame. Two small bugs: the stale "at the restaurant" note after pickup (L-11) and the chat ticket number (L-12).

**Architecture:** One server change (the +2 min rule) in the trips module, reached through a new customer procedure `orders.comingOut`. Everything else is customer-app work: pure helpers with injected clocks in `features/track/*.ts` (tested with vitest), thin React wiring in the screens. The server's first "near" fix (`stop.courierNearAt`) becomes visible to the customer so the card and the push agree.

**Tech Stack:** Zod + tRPC contracts (`packages/contracts`), NestJS API (`apps/api`), Prisma (`packages/db`), Expo customer app (`apps/customer`), vitest.

Spec: `docs/specs/2026-10-05-customer-joy.md` §2 (J-D8) and §5.1 J1 "Tracking"; findings `docs/research/ui-ux-audit/2026-10-05-joy/3-live-moments.md` L-01, L-04, L-05, L-07, L-10, L-11, L-12, L-23, L-29.

**Before you start:** another session works on the maps program (tracking map, share page, routing, `packages/map`). Check `git log --oneline -20` before each task; skip anything already built. Keep `TrackMap.tsx` and `map/Overlay.tsx` edits small. Stage only the files each task names.

**Status at plan time (main `ce2e0ae`):** none of the J1b items is built. `NEAR_DROPOFF_M = 500` (spec says 300); `PrePromptGate` opens a modal over the map; `arrivalSeen` is component state; the unreachable "أني هنا جاي" only shows a toast; `RouteLine` rebuilds `d` on every frame.

---

## Decisions taken in this plan (inside the approved scope)

| Topic | Choice | Why |
|---|---|---|
| Near line | `NEAR_DROPOFF_M = 300` (straight line) | Maps spec c5 and joy spec say 300. The ETA ≤ 2 min trigger covers "2 minutes out" on longer roads. |
| Almost-there trigger | first of: server `courierNearAt` on my drop-off, ETA ≤ 2 min, or ≤ 300 m (client fallback) | L-05 / f3. |
| At the door | food, `trip.state = arrived_dropoff`, `dropsBeforeMine = 0` → card «{name} عند بابك», cash amount; minutes pill hidden | Matches the status line's existing at-door rule, so card and status never disagree. |
| Delivered once | plays on a live transition, or on opening within 10 min of delivery, and never again once seen (`driver.customer.arrival-seen.<orderId>` in storage) | L-04 / f2. Afterwards the sheet opens at detent 1 (the receipt) with a «قيّم طلبك» row. |
| «أني نازل» | `orders.comingOut` extends the fail time by 120 s, once per protocol run (a protocol runs for one stop); idempotent; the customer also sends the `customer_coming_out` quick reply | J-D8. `failAllowedAt` in every view moves, so the courier's timer moves too; `extendedAt` lets his screen say «الزبون نازل». |
| Off-road route | no line at all; a 60 px heading arrow from the courier toward the next stop | L-07 / f19. |
| Minutes range | when `etaBasis = estimated`: low = max(1, round(m × 0.8)), high = max(low + 2, round(m × 1.25)) | Maps spec c3 ("range when basis = estimated"). |
| Look-ahead | on the way (not close): frame the courier plus a point 40 % of the way to the door, instead of courier + door at opposite edges | L-07 (3), maps spec c4. Inside 400 m the existing courier + door framing stays. |
| Route redraw | the path `d` is rebuilt at most every 66 ms (≈ 15 fps) and only when the courier moved ≥ 1 px or the camera changed | L-29 / f21. |

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `apps/customer/src/features/track/timeline.ts` + `track.test.ts` | modify | L-11: prep note only while preparing |
| `apps/customer/app/chat/[orderId].tsx` | modify | L-12: pass the ticket number |
| `packages/contracts/src/trip.ts` | modify | `NEAR_DROPOFF_M = 300`; `UnreachableStatus.extendedAt`; `Stop.courierNearAt` |
| `packages/contracts/src/tracking.ts` | modify | `TrackStop.courierNearAt` |
| `packages/contracts/src/order.ts`, `routers/orders.ts` | modify | `ComingOutResult`, `orders.comingOut` |
| `packages/contracts/src/errors.ts` + i18n | modify | `unreachable_not_active` |
| `packages/db/prisma/schema.prisma` + migration | modify/create | `trips.unreachable_extended_at` |
| `apps/api/src/modules/trips/unreachable.ts` | modify | `UNREACHABLE_EXTEND_MS`, extension-aware `failAt`/`canFail`/`unreachableStatus` |
| `apps/api/src/modules/trips/trips.repository.ts` | modify | the new column (memory + Prisma) |
| `apps/api/src/modules/trips/trips.service.ts` + tests | modify | `extendUnreachable`, timers honour the extension, view exposes `courierNearAt` |
| `apps/api/src/modules/orders/orders.service.ts`, `orders.rpc.ts` + tests | modify | `comingOut` (who may, which trip) |
| `apps/api/src/modules/tracking/tracking.service.ts` | modify | `courierNearAt` on my stops |
| `apps/customer/src/features/track/moments.ts` + test | modify | `almostThere()` (near / door), `at_door` moment |
| `apps/customer/src/features/track/AlmostThere.tsx` | modify | door variant, live region |
| `apps/customer/src/features/track/arrival-logic.ts` + test | modify | `arrivalPlays()`, `ARRIVAL_REPLAY_MS`, `arrivalSeenKey()` |
| `apps/customer/src/features/notify/prompt.ts` + test, `PrePrompt.tsx` | modify | inline ask card (`PushAskCard`), `pushAskAllowed()` |
| `apps/customer/app/kitchen/[id].tsx` | modify | the card under the ring |
| `apps/customer/src/features/track/unreachable-logic.ts` + test | create | metres to the door, ring chip, labels |
| `apps/customer/src/features/track/Panels.tsx` | modify | spotlight panel, three actions |
| `apps/customer/src/features/track/eta-range.ts` + test | create | `minutesRange()` |
| `apps/customer/src/features/track/story.ts` + test | modify | look-ahead framing |
| `apps/customer/src/features/track/route-throttle.ts` + test | create | `shouldRedraw()` |
| `apps/customer/src/features/track/map/Overlay.tsx` | modify | throttled `RouteLine`, `HeadingArrow` |
| `apps/customer/src/features/track/TrackMap.tsx` | modify | arrow when off-road |
| `apps/customer/src/features/track/SheetParts.tsx` | modify | polite live region on the status line |
| `apps/customer/app/order/[id].tsx` | modify | wiring (no modal ask, arrival once, door card, coming out) |
| `apps/partner/src/features/work/JobPanels.tsx` | modify | «الزبون نازل» line when extended |
| `apps/customer/scripts/demo-api.mjs` | modify | `at_door` scenario; unreachable courier 40 m off the door |
| `packages/i18n/src/locales/ar-IQ.json`, `en.json` | modify | new copy |
| `docs/api/orders-coming-out.md` | create | procedure doc |

---

### Task 1: L-11 and L-12 (small bugs)

- [ ] **Step 1 (test first):** in `track.test.ts`, a picked-up order whose courier waited at the kitchen: the `preparing` step has no note and `picked_up` carries «… بالطريق إلك». Run `pnpm --filter @driver/customer exec vitest run src/features/track/track.test.ts` → FAIL.
- [ ] **Step 2:** in `deliveryTimeline`, compute `current` first and set `note: current === 'preparing' ? prepNote() : undefined`. Test → PASS.
- [ ] **Step 3:** `app/chat/[orderId].tsx` passes `orderNumber={orderTicketNumber(orderId)}` to `ChatScreen` (same helper as the order screen's chip).
- [ ] **Step 4:** typecheck customer; commit "Customer tracking: no stale kitchen note after pickup; chat shows the order's ticket number (L-11, L-12)".

### Task 2: Server — «أني نازل» adds 2 minutes, once (J-D8)

- [ ] **Step 1 (tests first):**
  - `unreachable` pure tests (in `trips.service.test.ts` or a new `unreachable.test.ts`): `failAt(start, null)` = start + 5 min; `failAt(start, extendedAt)` = start + 7 min; `canFail` for the driver at 5:30 is false once extended; the dispatcher's 3-minute rule is unchanged.
  - Service tests: `extendUnreachable` before the protocol → `unreachable_not_active`; first call moves `trip.unreachable.failAllowedAt` by 120 s and sets `extendedAt`, emits `trip.unreachable_extended`; a second call changes nothing (`extended: false`); the driver's `fail` at 5:30 → `unreachable_too_early`, at 7:00 → ok; completing the stop clears the extension; the `allowFail` job at 5:00 does not announce when extended, the extended job at 7:00 does.
  - Orders e2e: `comingOut` by a stranger → `forbidden`; by the orderer during unreachable → extends.
- [ ] **Step 2:** contracts: `UnreachableStatus.extendedAt: z.coerce.date().nullable().default(null)`; `ComingOutResult = { extended: boolean, failAllowedAt: Date | null }`; `OrdersPort.comingOut`; router `orders.comingOut` (protected, `OrderIdInput`); error `unreachable_not_active` with ar/en copy.
- [ ] **Step 3:** DB: `unreachableExtendedAt DateTime? @map("unreachable_extended_at")` on `Trip`; migration `20261006130000_unreachable_extension/migration.sql` (`ALTER TABLE "public"."trips" ADD COLUMN "unreachable_extended_at" TIMESTAMP(3);` — a column, not a table, so no `driver_harden`).
- [ ] **Step 4:** `unreachable.ts`: `UNREACHABLE_EXTEND_MS = 120_000`; `failAt(startedAt, extendedAt)`; `canFail(startedAt, now, role, extendedAt = null)`; `unreachableStatus` takes `extendedAt`. Repository: the field in `TripRecord`, row mapping, memory create. Service: `extendUnreachable(tripId, customerId)`; clear `unreachableExtendedAt` wherever `unreachableStartedAt` is cleared; schedule an `allowFail` job at the new time (job id suffixed `ext`); the timer handler only announces when `canFail` is true.
- [ ] **Step 5:** orders service `comingOut(actorId, {orderId})`: orderer or participant; the active trip's unreachable status must belong to this order's drop-off; calls `trips.extendUnreachable`. RPC + port wiring.
- [ ] **Step 6:** run the trips and orders tests, contracts tests, `pnpm --filter @driver/api typecheck`. Commit per layer if it helps ("Contracts…", "DB…", "API…").

### Task 3: f3 — almost there at ~2 minutes, at the door with the cash

- [ ] **Step 1 (tests first)** in `moments.test.ts`: `almostThere({phase, food, courier, door, nearAt, etaMs, now, atDoor})` → `'door'` when at the door; `'near'` when `nearAt` is set, or ETA ≤ 2 min, or ≤ 300 m; `null` otherwise, for rides, and before pickup. `momentsBetween` gives `at_door` once on the switch to the door. `isNear` at 290 m true, 350 m false.
- [ ] **Step 2:** `NEAR_DROPOFF_M = 300` (contracts; update the server geofence test distances and the doc comment). Expose `courierNearAt` on `Stop` (trips view) and `TrackStop` (tracking view, my stops only, default null).
- [ ] **Step 3:** `useTrackingMoments` returns `{ card: 'near' | 'door' | null, closeNear }`; door buzz `medium`, no new sound. `AlmostThereCard` gets `variant` and `name`: door title `track.door_title` «{name} عند بابك», body `track.door_cash` «جهّز {amount} دينار واطلع له» or `track.door_paid` «الطلب مدفوع، بس اطلع له»; `accessibilityLiveRegion="assertive"`. The order screen hides the minutes pill at the door.
- [ ] **Step 4:** pre-prompt point copy: «تنبيه لمن الدليفري يقرب من بابك» (no "بدقيقتين" promise; the push is at 300 m).
- [ ] **Step 5:** tests, typecheck, commit.

### Task 4: f2 — the delivered moment plays once

- [ ] **Step 1 (tests first)** in `arrival-logic.test.ts`: `arrivalPlays({ seen, liveTransition, deliveredAt, now })`: seen → false; live transition → true; opened 9 min after delivery → true; 11 min → false; no `deliveredAt` → false unless live. `arrivalSeenKey('ord_1')` matches `/^[\w.-]+$/`.
- [ ] **Step 2:** a `useArrivalOnce(view, phase)` hook in `Arrival.tsx`: reads the key, decides once per order, writes the key when the overlay shows. Order screen: overlay only when it plays; otherwise the sheet opens at detent 1 (keyed remount) with an «قيّم طلبك» row at the top of the body that opens `RatingPanel`.
- [ ] **Step 3:** tests, typecheck, commit.

### Task 5: f1 — the notification ask never covers the map

- [ ] **Step 1 (tests first)** in `prompt.test.ts`: `pushAskAllowed(permission, lastDismissedAt, now)` is the existing snooze rule (rename-free: keep `shouldShowPrePrompt`), plus `pushAskSurface({ ride, phase })` → `'kitchen'` never on `/order` for food; for rides `'ride_sheet'` only in `to_pickup`/`at_pickup`; `null` otherwise.
- [ ] **Step 2:** `PrePrompt.tsx` becomes `PushAskCard` (inline `Card` with bell icon, title, body, «إي، خبرني» primary, «لا هسة» ghost; ≥ 44 px; hidden while undetermined permission is loading; same storage key and week snooze). Copy: `notify.ask.food_title` «نخبرك أول ما المطعم يقبل؟», `notify.ask.body` «إشعار لكل خطوة، بدون إزعاج», `notify.ask.ride_title` «نخبرك لمن يوصل السايق؟», `notify.ask.yes` «إي، خبرني», `notify.ask.no` «لا هسة».
- [ ] **Step 3:** kitchen screen renders the card under the total; order screen drops `PrePromptGate` and renders the ride card at the top of the sheet body after the match (visible in the collapsed sheet area by placing it in the header `note` slot only while matched — keep it compact).
- [ ] **Step 4:** tests, typecheck, commit.

### Task 6: f18 — unreachable: where he stands, and «أني نازل»

- [ ] **Step 1 (tests first)** `unreachable-logic.test.ts`: `metresFromDoor(courier, door)` rounds to 5 m and is null without a fix; `standingLine` picks «{name} واقف هنا · {m} متر من بابك» vs «{name} واقف عند بابك» under 15 m; `secondsLeft(failAllowedAt, now)`.
- [ ] **Step 2:** `UnreachablePanel` (no dim, so the map stays visible): a spotlight ring around the courier (`TrackMap` prop `spotlight`), the 56 px timer chip beside the title, the standing line, primary «أني نازل» (calls `orders.comingOut`, then the `customer_coming_out` quick reply; shows «خبّرناه، عندك دقيقتين زيادة» when extended), «اتصل بدون ما يبين رقمك», «دزله لوكيشني» (chat location: the phone's fix, or the saved drop-off pin). Final-minute copy kept.
- [ ] **Step 3:** partner `JobPanels` shows «الزبون نازل · زدنا دقيقتين» when `extendedAt` is set.
- [ ] **Step 4:** demo: unreachable courier stands 40 m off the door. Tests, typecheck, commit.

### Task 7: f19 — honest map without a road route

- [ ] **Step 1 (tests first):** `eta-range.test.ts` (`minutesRange(8, 'estimated')` → `{low: 6, high: 10}`, `road` → single), `story.test.ts` look-ahead point on the way when far, unchanged inside 400 m.
- [ ] **Step 2:** `RouteLine` draws nothing when `onRoad` is false; new `HeadingArrow` (60 px, from the courier toward the next waypoint). Map pill uses `track.map_minutes_range` «{low}–{high} دقايق» / `…_many` «… دقيقة» when estimated.
- [ ] **Step 3:** tests, typecheck, commit.

### Task 8: f21 — live regions and route redraw

- [ ] **Step 1 (test first):** `route-throttle.test.ts`: `shouldRedraw(prev, next, now)` false within 66 ms, false when the head moved < 1 px and the camera is unchanged, true otherwise.
- [ ] **Step 2:** `RouteLine` computes `d` in a `useFrameCallback`/derived worklet guarded by `shouldRedraw` (keeps the last `d` otherwise). Status line `accessibilityLiveRegion="polite"`; door / almost-there cards `assertive`.
- [ ] **Step 3:** tests, typecheck, commit.

### Task 9: Docs, gate, screenshots

- [ ] `docs/api/orders-coming-out.md`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] Web export + demo API on a free port (3311): before/after at 390 × 844 for kitchen waiting (ask card), on the way (no modal; off-road arrow), near, at the door, unreachable, delivered reopened (calm receipt), chat header.
