# Three apps review — customer, partner, merchant (2026-10-04)

Senior product + QA pass over `apps/customer`, `apps/partner`, `apps/merchant`, driven end to end
against ONE in-memory API (`scripts/e2e/three-apps.mjs`, port 3340) instead of each app's own
`demo-api.mjs`. Goal: find what breaks for a real user, especially cross-app flows that only work
because a demo script injects data or plays a part.

## How to reproduce

```sh
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 PRISMA_SCHEMA_ENGINE_BINARY=/bin/true
pnpm install && pnpm turbo run build --filter='./packages/*' && pnpm --filter @driver/api build
node scripts/e2e/three-apps.mjs                 # FLOWS=food,rajaa,ride; KEEP=1 keeps :3340 up

# screenshots of the same order in each app at every step (390×844 phones, 1280×800 kitchen tablet)
for a in customer partner merchant; do (cd apps/$a && EXPO_OFFLINE=1 CI=1 \
  EXPO_PUBLIC_API_URL=http://127.0.0.1:3340/trpc EXPO_PUBLIC_DEV_TOOLS=1 \
  npx expo export --platform web --output-dir dist-e2e); done
SHOTS_DIR=/tmp/shots PLAYWRIGHT_MODULE=…/playwright/index.mjs CHROMIUM_PATH=…/chrome \
  node scripts/e2e/three-apps.mjs                 # writes <step>-<app>.png
```

The script seeds only what onboarding and ops would (the launch restaurants, open all day so it runs
at any hour; people; roles; the couriers' registered vehicles). Every step after that is the tRPC
procedure the app's button calls, signed in as the person who taps it (customer, kitchen staff,
owner, courier, intercity driver, tuktuk driver — including the courier's daily selfie check-in
through `driverAccount.checkInChallenge` → `places.photoUpload` → `submitCheckIn`). After each
step it reads what each app reads (`orders.track` / `orders.courierPosition`, `merchant.board` /
`ledger.merchantBalance`, `partner.status` / `currentOffer` / `activeJob`,
`routes.myBookings` / `boardingPass`, `routes.driver.departure` / `riders`) and asserts they agree.

## End-to-end results (after the fixes below)

| Flow | Checks | What is walked |
|---|---|---|
| Food, cash, two people | 44/44 | home rail → menu → quote → `orders.place` (orderer + أحمد with a line note) → board "new", grouped by person, cash to collect → accept 15 min → board "preparing", courier "searching", customer promised time → kitchen marks ready early → offer reaches the courier now (named pay, cash 7,750) → accept → board "حيدر بالطريق · N د" from his live position, customer courier card + map position → arrive kitchen ("الدليفري وصل") → pickup (order leaves the board, customer "on the way") → at the door ("استلم 7,750 دينار") → delivered with cash → merchant cash balance 0 → 5,280 (net of 12 %) with حيدر listed as holder → partner cash held 0 → 7,750, today 1,250 from 1 job → rating |
| الرجعة seat | 17/17 | driver announces from كراج النهضة → customer board → hold front seat → book cash → PIN → driver sees the booking and first name علي → garage geofence check-in → uploaded run selfie → wrong PIN refused → right PIN → customer "checked in" → half-empty car may not leave early → walk-ups fill it → departed → boarding pass shows the live car |
| Tuktuk ride | 11/11 | driver checks in, online → quote → `orders.place` type ride → broadcast offer with cash to collect → accept → customer "matched, عباس" → arrive / pick up / arrive / complete with cash → customer "completed" → partner cash held rises → rating |

Before the fixes: food stopped at "the courier gets the offer" (the order waited for the timed
start even though the kitchen said ready), the ride never produced an offer at all, and the
courier's position never reached the customer or the kitchen outside the demo.

Screenshots (39): `scratchpad/shots/e2e/` — `1-placed … 8-delivered` (food, all three apps),
`r1 … r4` (الرجعة, customer + partner), `t0 … t4` (ride, customer + partner).

## Findings

Severity: **S1** a real user cannot finish the flow · **S2** wrong/misleading data or a broken
cross-app state · **S3** UX/copy/accessibility polish.

### Cross-app flows that only worked in the demo

| # | Sev | App | Screen / area | What | Fixed? / how |
|---|-----|-----|---------------|------|--------------|
| 1 | S1 | API → partner, customer | Rides | `orders.place` with `type: 'ride'` created no trip and no dispatch request; only `demo-api` scripts and the simulator built ride trips by hand (`trips.createForOrders` + `dispatch.request`, neither callable by a customer). A real ride never reached a driver. | **Fixed.** `dispatch:ride-request` subscriber on `order.placed` (rides) builds the trip and starts the taxi/tuktuk policy; `order.placed` carries the ride's vertical, pickup, drop-off, quote id (additive payload). Demo scripts, simulator and smoke test reuse the subscriber's trip. |
| 2 | S1 | customer | Home services row | There is no way to book a taxi/tuktuk (also grocery, خطوط, parcel): the tiles show a "soon" toast. Flow 3 is only reachable through the API. | Not fixed (a feature, not a bug); the API side now works end to end, so a ride request screen only needs `pricing.quote` + `orders.place`. |
| 3 | S1 | partner → customer, merchant | Job (positions) | The Partner app never called `trips.reportPosition`; the customer's live map (`orders.courierPosition`), the kitchen's "الدليفري جاي بعد N د" and the stop geofences read the trip trail that only the demo's mover script fed. Outside the demo the customer saw no courier and the board no minutes. | **Fixed.** `useJobPositions` (mounted app-wide while `partner.status.activeTripId` is set) reports a real GPS fix every 5 s; no fix → nothing sent. |
| 4 | S2 | API → partner | Dispatch, food | Marking an order ready before the promised time did not start the courier search; auto-assign waited for `readyAt − ETA − 2 min` (≈ 10 min of food on the counter for a 15-min prep marked ready at 1 min). | **Fixed.** `dispatch:order-ready` on `order.ready` → `OfferOrchestrator.readyNow` starts the first pass now (unit test). |
| 5 | S2 | partner | Job → "وصلت" | Arrival sent the town-centre fallback pin when there was no GPS fix, so every web/desktop arrival was flagged outside the geofence. | **Fixed.** Only a real fix is sent; otherwise the server uses his last reported position. |
| 6 | S2 | partner | الرجعة departure → selfie | The run selfie was never uploaded: the app sent a made-up `device:<time>` ref (TODO). Ops could not see who drove; walk-ups counted on a fake selfie. | **Fixed.** Photo → `places.photoUpload` + PUT → upload id as `selfieRef`. |
| 7 | S2 | customer ↔ merchant | Live order, طلباتي | The customer saw "طلب #1" (id suffix) while the kitchen calls out "#1284" — a customer phoning the restaurant cannot be matched. | **Fixed.** `orderTicketNumber` in `@driver/contracts`, used by the API board, merchant money views and both customer screens. |
| 8 | S2 | customer ↔ merchant | Live order status | With the food ready and حيدر on his way, the board said "حيدر بالطريق" but the customer read "جاهز وينتظر الدليفري"; at the door the customer still read "طلبك بالطريق إلك". | **Fixed.** `phaseOf`: ready + courier → "الدليفري رايح للمطعم" / at the kitchen; `statusLine`: "الدليفري عند بابك" when he is at my door (tests). |
| 9 | S2 | API → customer | الرجعة boarding pass | A car that filled up and left before its time kept the rider's pass on "السيارة المباشرة تبين قبل الحركة بنص ساعة" — no live car while already on the road. | **Fixed.** `boardingOpen` is also true once the departure is boarding/departed/arrived (e2e check). |
| 10 | S2 | API | `orders.place` | Accepts an order while the restaurant is closed by its opening hours (`catalog.restaurants` says `open: false, closedReason: 'hours'`); the app disables adding, but a cart carried over from before closing still checks out. | Not fixed — orders module is being changed by the deals/checkout work. Needs `openNow(profile.hours)` next to the pause/closed checks. |
| 11 | S3 | API | `orders.place` | Restaurant minimum order (`minOrderIqd`) is only enforced in the customer cart; the server took a 2,500 order from مطعم خالد (min 5,000). | Not fixed (same module); document for the orders owner. |
| 12 | S2 | partner / API | الرجعة announce | A departure announced less than 30 min ahead hits the T−30 low-fill check at once and is `cancelled_low_fill` unless it already has 3 seats (walk-ups count only after the selfie). The announce form allows 5 min ahead and only shows the generic rule. A driver announcing on arrival at the garage loses his car within a second. | Open — owned by the backend الرجعة low-fill timing fix (rule change in `routes`); the form copy follows whatever rule lands, so the app was not changed here (follow-ups 2026-10-04). |
| 13 | S3 | API | `depart_blocked` copy | One message ("كل راكب محجوز لازم يسجّل حضور…") for every blocker, including "too early and not full". The app shows the blockers first, so only API clients see it. | Not fixed; would need a separate code. |
| 14 | S2 | partner | Offer (cash ride) | The offer card hid the cash row for rides; on a cash ride the driver saw "3,150 دينار" (his share) and nothing about collecting 3,500. | **Fixed.** Cash/prepaid row shows for rides too when there is cash to collect. |
| 15 | S3 | customer | Ride live screen | Tuktuk ride labelled "تكسي"; destination pin said "بيتك"; arrival showed the door-photo card. | **Fixed.** Vehicle chip from the driver's vehicle (تكتك), "وجهتك" pin, no door card on rides. |
| 16 | S3 | partner | Job card | The customer is "الزبون" everywhere (no first-name read for drivers); the handover photo stays on the device so the customer's arrival shows a placeholder "صورة الباب". | Still open (follow-ups 2026-10-04): both need a cross-app change — a logged vault read of the customer's first name on `partner.activeJob`, and the photo upload + a signed read on the customer's live order. |
| 17 | S3 | partner | Job → اتصال / رسالة | Stubs (toast). | **Fixed** by the chat/masked-call work (`chat.*`, partner README "Chat and masked calls"). |
| 18 | S3 | partner | Home map puck | The puck follows `partner.status.position` (presence), refreshed by the 30 s heartbeat, so it lags the trip trail by up to 30 s. | Not fixed (acceptable). |

### Demo-only data still on screens

| # | Sev | App | Screen | What | Fixed? |
|---|-----|-----|--------|------|--------|
| 19 | S3 | customer | Home "community deal" card | `FIXTURE_COMMUNITY_DEAL` from `fixtures/restaurants.ts`. | No — deals work owns it. |
| 20 | S3 | partner | Scorecard | History (offer answers, ratings, past trips) is injected by `scripts/demo/50-driver-account.mjs` wrapping service reads; a new driver sees a real but empty card. | No (documented in the partner README). |
| 21 | S3 | merchant | Insights / money statement | Five weeks of مطعم خالد history come from `scripts/demo/lib/khalid-history.mjs`; with the e2e API (real orders only) "today" and the cash card are real and correct (6,000 sales, −720 commission, 5,280 to the kitchen, حيدر holding it). | n/a — the reads are real. |

### UX quality

| # | Sev | App | Screen / area | What | Fixed? / how |
|---|-----|-----|---------------|------|--------------|
| 22 | S2 | customer | Live map | Zone labels in Eastern digits ("شارع ٣٠") — the MapLibre/SVG labels read the seed's `name_ar` raw (partner normalised, customer did not). | **Fixed** at the source: `@driver/map` zone GeoJSON labels in Western digits (test). |
| 23 | S3 | customer, partner | الرجعة garages | "كراج البوابة ١ / ٢" came from the API's intercity config in Eastern digits. | **Fixed** in `intercity.config.ts` (+ test). The DB seed (`packages/db/prisma/seed-data.ts`) and `@driver/map` garages still carry ١/٢ — left for the DB-persistence work. |
| 24 | S3 | partner | Home | Today pill "1,250 · طلب واحد" and cash bar "7,750 من سقف 75,000" without دينار; cash-owed line in earnings; ops "عليه … من سقف …". | **Fixed** (copy + test). |
| 25 | S3 | customer | Boarding pass | Payment line "حجز كاش · 12,000" without دينار. | **Fixed** (`iqd()`). |
| 26 | S3 | customer, partner | Price deltas | "+500"-style deltas on modifier chips, meeting-point / door fees and the street hand-over saving have no currency. | **Partner fixed** (follow-ups 2026-10-04): the batch-offer bonus and the الرجعة front-seat premium read "+700 دينار" (copy test). Customer chips still open (customer app). |
| 27 | S3 | partner | Home | No error state: a failed first `partner.status` showed skeletons forever; a failed refresh while online showed nothing although offers can no longer arrive. | **Fixed.** Retry empty state; "النت مقطوع. ما توصلك طلبات لحد ما يرجع" strip over stale data. |
| 28 | S3 | all | Copy | MSA/off-glossary words: "تم تسجيل حضورك", "تم التسليم", "المندوب" ×3 (voice guide: الدليفري). | **Fixed** (سجّلنا حضورك، سلّمت، الدليفري). |
| 29 | S3 | all | Hard-coded colours | Literal hex/rgba outside `@driver/design-tokens`: scrims, shadows, white strokes, earnings hero, new-order banner glow, ops onboarding overlays, switch thumbs, gate icon. | **Fixed** (theme roles / palette). Left on purpose: illustration art (`FoodArt`, check-in face `CheckInParts`, tier medals `ScoreParts`, the earnings chart's up/down tints). |
| 30 | S3 | all | Tap targets | 11 pressables under 44 px (photo remove 28, route link 28, landmark camera 36, announce chip 36, board banner buttons 36–40, store header switches 40, menu chips 40). | **Fixed** with `hitSlop` (layout unchanged); banner buttons got `accessibilityRole`. |
| 31 | S3 | all | Eastern digits / English leaks | Scan of `ar-IQ.json`, merchant `locales/ar.json` and app code: no Eastern digits in copy; Latin only in accepted words (SUV, English, the phone mask). | n/a |
| 32 | S3 | customer | Live map at the door | Courier and home on the same point zoom the camera to max: a blank beige map. | Not fixed (camera min-span in `TrackMap`). |

Counts: **S1 3** (2 fixed), **S2 12** (9 fixed), **S3 17** (10 fixed).

## Follow-ups (2026-10-04) — Partner and Merchant

Built on top of the review (and on the backend review's client follow-ups #2 and #6):

| # | Sev | App | What | Status |
|---|-----|-----|------|--------|
| F1 | S2 | partner ↔ API | Fleet consent had no driver side: an owner's invite (`fleet.addDriver`) could never be accepted from the app, and the owner's dashboard counted pending rows as offline drivers with no name. | **Fixed.** Home banner + full card on الحساب: owner's first name, fleet name (`FleetInvite.fleetName`, additive), what he will see (earnings from the day he accepts, cash vs cap, documents, live status) and what not; accept / decline (`fleet.respondInvite`); members see "تشتغل ويا …" with a leave flow. Owner: "بانتظار موافقة السايق" section with "دعوة مرسلة إلى 0770 ••• 4567" (`FleetDriver.phoneHint`, kept on the owner's own invite event — no vault read before consent), pending rows not counted, not assignable, not opened. |
| F2 | S2 | partner | Courier wallet top-up had API only. | **Fixed.** "الزبون يريد يشحن محفظته" on the job screen while a courier carries a live delivery (`canTopUpOnJob`): code pad → `partner.topUpLookup` → amount → `partner.confirmTopUp`; his cash cap before and after (over-cap warning), the receipt. Ops and courier share one `TopUpDesk`. |
| F3 | S3 | merchant ↔ API | Pending staff rows read "بعده ما كتب اسمه" with the vault mask; no resend. | **Fixed.** "دعوة مرسلة إلى 0780 ••• 3344" + when it went out; resend (`merchantAdmin.staff.resendInvite`, additive, once per 10 min, `merchant.staff_invite_sent` outbox event) and cancel (remove) with a confirm. |
| F4 | S2 | merchant ↔ API | الدوام was open/close only; weekly hours lived in the catalog seed, nobody could change them, no holidays. | **Fixed.** `merchant.hours` / `merchant.setHours` (owner edits; staff read): split shifts (≤ 3 a day), shifts past midnight, the Friday-prayer pause shown, dated closures; validated by `storeHoursProblems` in `@driver/contracts` (client and server). Persisted on `orgs` (migration `20261004200000_merchant_opening_hours`) and mirrored to the storefront so customer cards follow; a holiday closes the store for `orders.place` and shows on the card as closed by hours. The board says "برّا وقت الدوام … يفتح اليوم 12 الظهر" (`storeStatus.schedule`, additive). |
| F5 | S3 | merchant demo | `scripts/demo/money.mjs` crashed on boot (an answer after the 48-h dispute window is now refused) and `staff.mjs` showed signed-in members as pending. | **Fixed** (demo data only). |

Screenshots: `scratchpad/shots/followups/` (partner `followups-*`, merchant `{tablet,phone}-followups-*`).


## Changed

- API: `dispatch/events.subscribers.ts` (ride request, order ready), `offer.orchestrator.ts`
  (`readyNow`), `ports.ts` / `trips.adapter.ts` (live trip lookup, ride trip), `orders.service.ts`
  (one additive field on `order.placed`), `routes/routes.rpc.ts` (boarding open), routes config
  garage names; simulator + smoke test + partner demo scripts reuse the ride trip.
- Contracts: `orderTicketNumber`. Map: Western-digit zone labels. i18n: 4 new keys, 10 copy fixes.
- Customer: ticket number, live status phases, ride chip/pin/arrival, boarding pass amount, tokens.
- Partner: `useJobPositions`, honest arrival pin, intercity selfie upload, cash row on ride offers,
  home error/connection states, amounts with دينار, tokens, tap targets.
- Merchant: ticket number shared, tokens, tap targets.
- `scripts/e2e/three-apps.mjs` + `scripts/e2e/shots.mjs`.
