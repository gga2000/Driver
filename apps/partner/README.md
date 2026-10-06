# Driver Partner app (`@driver/partner`, درايفر بارتنر)

The app couriers, tuktuk/taxi drivers, intercity and khat drivers, fleet owners and field ops use.
Expo SDK 52 + expo-router 4, React Native 0.76, RTL Iraqi Arabic first, the light-cream brand.
UI only from `@driver/ui`; copy only from `@driver/i18n` (`partner.*` keys); the structure, libs and
scripts mirror `apps/customer` (the reference implementation).

```
app/
  _layout.tsx           providers (theme, toast, API), fonts, route guard + role gate, <OfferWatcher>, root <Stack>
  (auth)/               welcome (partner) → phone → otp
  not-partner.tsx       signed in without a driving/fleet/ops role: "حسابك مو مفعّل كشريك بعد"
  (tabs)/               index (الرئيسية: map, online switch) · earnings (الأرباح) · account (الحساب hub)
  offer.tsx             full-screen offer card (ring, named pay, batch banner, accept/decline)
  job.tsx               the job: one task + one advancing button, stops, contact, maps, handover, unreachable
  earnings/statement.tsx  scorecard.tsx  documents/index.tsx  checkin.tsx            ← wave 2 (driver account)
  intercity/index.tsx  khat/index.tsx  fleet/index.tsx  ops/index.tsx                ← wave-2 placeholders
src/
  lib/                  api (tRPC + React Query), session (+ storage), guard, i18n, money, phone, fonts,
                        haptics, location(.native), alert(.native) — copied from the customer app where shared
  components/           Screen, TabBar, OtpInput, Wordmark (with the شريك tag), PlaceholderScreen
  features/auth/        AuthHeader
  features/map/         DriverMap (own puck with radar pulse, job pins, dashed route) over the customer
                        app's base map (MapLibre on web, SVG zones on native) — geo.ts + base/*
  features/account/     driverAccount.* (wave 2): queries, logic (pure, tested), EarningsParts (hero with
                        count-up + chart, breakdown, cash cap card, job lines), HandoverSheet, ScoreParts,
                        DocumentParts (+ upload sheet), CheckInParts (animated liveness move), GateParts
                        (home banner + locked switch), photo (image-picker + signed upload), ModalSheet
  features/work/        queries (partner.*, dispatch.*, trips.*), logic (pure, tested), OnlineSwitch,
                        HomeParts (today pill, vehicle chip, cash bar, demand row, mode cards),
                        OfferParts (pay lines, prep pill, route nodes), JobPanels (handover/cash,
                        unreachable, done), usePresence (online/offline + 30 s heartbeat)
scripts/
  demo-api.mjs          in-memory API (the real apps/api build) on :3301; loads scripts/demo/*.mjs
  demo/                 seed + /demo/* hooks, one file per flow (10-core-people, 20-core-work)
  web-shots.mjs         Playwright harness; loads scripts/shots/*.mjs (SHOTS=<name> filter)
  shots/                shot lists, one file per flow (10-core)
  demo-check.mjs        over-the-wire smoke check of a running demo API
```

## How the app works

- **Session and API** — exactly the customer pattern (`src/lib/session.ts`, `api.tsx`, `api-links.ts`):
  token pair in expo-secure-store / localStorage (key `driver.partner.session`), proactive and on-401
  single-flight refresh, `EXPO_PUBLIC_API_URL` (default `http://localhost:3000/trpc`).
- **Role gate** — `identity.me` roles through `isPartner()` (`@driver/contracts`): drivers
  (courier, shopper, driver, intercity_driver, khat_driver), fleet owners and field ops get in;
  anyone else lands on `not-partner`. `src/lib/guard.ts` is pure and unit-tested.
- **Home** — `partner.status` (every 10 s): online, vehicle, tier, position, cash vs cap, today's
  earnings and job count, the demand hint and modes. Intercity drivers get a garage-board card,
  khat drivers a today's-run card, fleet/ops-only people a hub instead of the switch. Going online
  sends `partner.goOnline` with a GPS fix (fallback: last server position, then the town centre) and
  re-sends it every 30 s while the app is open (presence lives 90 s in the dispatch index).
- **Offer** — `<OfferWatcher>` keeps the driver's `live.partner` stream open (SSE, `docs/api/live.md`):
  `partner.currentOffer` is re-read the moment the server offers him a job, and it pushes
  `/offer` when one arrives (also while on a job: batch offers). The ring runs from the server's
  `expiresAt`/`ringSec`; heavy haptic + chime on arrival and at 5 s; `dispatch.offerSeen` after 3 s
  in the foreground; `dispatch.respond` answers (errors: `offer_taken`, `offer_expired`, `over_cap`).
- **Job** — `partner.activeJob` (every 4 s) gives the stops with the current one; the button runs
  `trips.arrive` → `trips.completeStop` per stop. At a food dropoff the handover panel asks for the
  photo and, for cash orders, confirms "استلمت ___ دينار" (`handover.cashCollectedIqd`). "الزبون ما
  يرد؟" starts `trips.startUnreachable`; the panel counts to 5:00 and then allows `trips.fail`.

## API used (and added)

`partner.*` lives in `packages/contracts/src/routers/partner.ts` (IO in `partner-io.ts`) and
`apps/api/src/modules/partner` (composes dispatch, trips, orders, orgs, pricing, ledger, identity's
role reader, the vehicle registry):

| Procedure | Roles | What |
|---|---|---|
| `partner.status` | partner roles | online, vehicle, tier, zone, position, cash vs cap, today, demand hint, active trip, open offer |
| `partner.goOnline` / `goOffline` | driving roles | presence in the dispatch geo index (`DispatchService.presence`); `goOnline` enforces the online gate (below) |
| `partner.currentOffer` | driving roles | open offer: zones, pins, ring, pay components, batch, kitchen state, cash to collect |
| `partner.activeJob` | driving roles | current trip: stops (merchant names, notes, cash per stop), current stop, unreachable, pay |

Pay components are named (`delivery`, `night`, `weather`, `batch_bonus` 70 %, `pickup_compensation`,
`fare` after the open take, `tip`, …) and labelled client-side with `partner.pay_<key>`.

## Driver account (wave 2)

- **الأرباح** (`app/(tabs)/earnings.tsx`) and **كشف الحساب** (`app/earnings/statement.tsx?period=&anchor=`):
  `driverAccount.earnings` by day / week / month with ‹ › to earlier periods; the net counts up on a dark
  hero with a per-hour / per-day chart (tap a bar), the change vs the previous period, the breakdown (pay,
  tips, bonuses, guarantee top-ups, our take), the cash cap card (cash in hand, owed vs the role/tier cap,
  green → orange → amber → red, next tier) and "سلّم الفلوس" → the daily code from `driverAccount.handoverCode`.
  Every job opens to every component (memo-named: night, rain, guarantee…) and the cash taken.
- **التقييم** (`app/scorecard.tsx`): from day 31 the index gauge, tier ladder with caps, nudges with the
  Sunday they would apply, each metric against target + Silver line; days 1–30 "تقييمك يبين بعد 30 يوم".
- **المستمسكات** (`app/documents/index.tsx`): rows most urgent first (expired, rejected + reason, missing,
  expiring + days left, under review, approved), upload sheet (camera / library, expiry month for licence,
  registration, insurance) → `places.photoUpload` + PUT → `driverAccount.uploadDocument`.
- **التسجيل اليومي** (`app/checkin.tsx`): `checkInChallenge` → animated move + 2-minute countdown → selfie
  (front camera; file picker on the web) → `submitCheckIn` → passed / one try left / locked.
- **Online gate**: `partner.status.gate` (`{canGoOnline, reasons[]}`, null for non-drivers) drives the home
  banner ("سوّي التسجيل اليومي", locked, expired document) and a locked switch that says why.
  `partner.goOnline` refuses with `online_checkin_required`, `checkin_locked` or `online_document_expired`
  (worst first) and takes an online driver out of the index on a lock-out or expired document; a missing
  check-in alone does not end a shift that crossed midnight (the 30 s heartbeat keeps going).

## Adding a flow (wave 2)

1. **Route** — the placeholder file already exists (`app/scorecard.tsx`, `app/khat/index.tsx`, …):
   replace its contents with the real screen. Add sibling routes in the same folder
   (`app/khat/stop/[id].tsx`) and, if they need a header title, one `<Stack.Screen>` line in
   `app/_layout.tsx`. The الأرباح tab is `app/(tabs)/earnings.tsx`; its detail routes live under
   `app/earnings/*` (not `app/earnings/index.tsx`, which would clash with the tab's `/earnings`).
2. **Queries** — `src/features/<flow>/queries.ts` with `useApi()` + React Query, `enabled:
   useSignedIn()`; errors via `apiErrorMessage(err, t('error.network'), locale)`.
3. **Copy** — keys under `partner.*` in **both** `packages/i18n/src/locales/ar-IQ.json` and
   `en.json` (parity is tested), voice guide rules (Iraqi dialect, Western digits, دينار after the
   amount, `amountParam(n, { sign: true })` for "+700" so the sign stays left of the digits), then
   `pnpm --filter @driver/i18n build`.
4. **Demo data** — add `scripts/demo/<NN>-<flow>.mjs`:

   ```js
   export default async function register(demo) {
     const { services, Accounts } = demo;           // identity, dispatch, trips, orders, orgs, catalog, ledger, vehicles
     const driver = demo.people.get('khat');         // personas from 10-core-people (courier, tuktuk, intercity, khat, customer, buyer)
     // …seed through the real services…
     demo.route('/demo/khat/run', async ({ res, query }) => demo.json(res, 200, { ok: true }));
   }
   ```

   Helpers: `demo.person({ key, phone, name, roles, vehicle })`, `demo.online(personId, at, vehicle)`,
   `demo.group(id, at, lines, refs)` + `services.ledger.recordAll(...)`, `demo.who(query)`,
   `demo.load('modules/<m>/index.js')` for any other API module. Routes must live under `/demo/`.
5. **Screenshots** — add `scripts/shots/<NN>-<flow>.mjs`:

   ```js
   export const name = 'khat';                       // files: khat-<shot>.png; SHOTS=khat runs only this
   export default async function run(s) {
     const p = await s.signIn('0770 111 0004');      // fresh browser context, real OTP flow
     await s.demoPost('/demo/khat/run?who=khat');
     await p.goto('/khat');
     await p.wait('khat-run');                       // testID
     await p.shot('run', { full: true });
     await p.close();
   }
   ```

6. **Tests** — pure logic in `src/**/*.test.ts` (Vitest in plain Node: no react-native imports).

## Web build, demo and screenshots

```sh
pnpm install && pnpm turbo run build --filter='./packages/*' && pnpm --filter @driver/api build
cd apps/partner
EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3301/trpc EXPO_PUBLIC_DEV_TOOLS=1 \
  npx expo export --platform web --output-dir dist-web
node scripts/demo-api.mjs &                           # :3301 (PORT=…); stop it with kill <pid>
node scripts/demo-check.mjs courier                   # optional smoke check over the wire
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  node scripts/web-shots.mjs <out-dir>                # SHOTS=core,… ; DIST_DIR, DEMO_API
```

The harness marks the "لا يفوتك طلب" notification pre-prompt as answered before the app loads (it
would otherwise open on home and swallow the first tap); `s.signIn(phone, { prePrompt: true })` keeps
it to shoot the prompt itself. Pages wait for "load", not "networkidle" (the live SSE stream never
idles). The app itself is unchanged.

Offer alert (UI/UX audit P-01): the offer screen loops `assets/sounds/offer-loop.wav` (expo-av, plays
with the ringer on silent) with a vibration pattern until he answers or it expires, plus a warning
haptic every second in the last 5 s; the web repeats a WebAudio doorbell. The screen stays on while
he is online or on a job (expo-keep-awake). "جرّب صوت الطلب" is in الحساب.

Personas (dev OTP shown on the OTP screen): courier `0770 111 0001` (bike, 14,000 · 6 طلبات today,
68,500 cash held ≈ 73 % of his cap, two months of history, scorecard day 65), tuktuk `0770 111 0002`
(rides with the take; licence expiring, registration rejected), intercity `0770 111 0003`, khat
`0770 111 0004`, customer-only `0770 111 0009`; wave-2 gate states: rookie `0770 111 0041` (no check-in
yet, month one), locked `0770 111 0042` (two failed check-ins), lapsed `0770 111 0043` (expired licence).
Everyone else is checked in for today. `POST /demo/account/fail-next-checkin?who=…` fails his next selfie.
Main photos (صورتك الرئيسية, `/photo`, docs/api/driver-photos.md): every driver has an approved drawn
portrait; courier's new one «تنتظر الموافقة», tuktuk's «مرفوضة» with a reason, rookie none.
`POST /demo/account/photo?who=…&decision=approve|reject` decides the waiting one; three خطوط children
(زينب، حسن، مريم) have their guardian's photo on the run rows. Shots: `SHOTS=photo`. Food dispatch runs suggest-only in the demo so the three orders
waiting at مشويات الحاج كريم keep the demand hint at "الطلب عالي بالمركز"; demo offers go out
through the dispatcher override, the tuktuk ride through the real wave-1 broadcast.

## Known gaps (wave 1)

- Background location and a real heartbeat endpoint: presence is refreshed by re-sending
  `partner.goOnline` every 30 s while the app is open.
- SOS is a stub button (decision 3 in docs/research/ui-ux-audit/README.md: built before launch).
  (Call and chat are live: see "Chat and masked calls" below.)
- Offers, the job, gate and cash are pushed over `live.partner`; queries keep a 60-s safety refetch
  (30-s polling when SSE does not get through). الرجعة, خطوط, fleet and ops screens still poll.
- The customer's first name is not on the job card (no vault read for drivers yet).

الرجعة garage mode and the child-safe خطوط run (Phase 3, 2026-10-05): `SHOTS=intercity` now walks
the seat map (walk-up sheet, a rider's PIN sheet, the late seat and its call, no-show, التفاصيل) and
`SHOTS=khat` the guardian call and the two-step "no child left in the car" sweep. Calls use the
development bridge in the demo API, so the toast shows the other party's real (demo) number.

## Known gaps (wave 2, driver account)

- Liveness is the API's stub: the app sends no SDK score (web/native), so any stored selfie passes; the
  real on-device SDK plugs into `submitCheckIn`'s `livenessScore`.
- The scorecard's cap tier (scoring) and the ledger's cap tier can differ until scoring writes tiers.
- "كلّم العمليات واتساب" on the locked screen is a stub toast (no ops WhatsApp number in config yet).
- Demo-only: the scorecard history (offer answers, past trips, ratings) is fed to `DriverAccountService`
  through wrapped reads in `scripts/demo/50-driver-account.mjs`; the in-memory API has no past.

## Follow-ups (2026-10-04)

- **Fleet invites (consent)** — `src/features/fleet/InviteParts.tsx`: a driver with a pending `fleet.myInvites` row sees a home
  banner and, on الحساب, the full card (owner's first name, fleet name, what the owner will see: earnings from the day he accepts,
  cash vs cap, documents, online / on a job — and not his customers); `fleet.respondInvite` accepts or declines. Members get
  "تشتغل ويا …" with a leave confirm. The owner's dashboard lists invites apart under "بانتظار موافقة السايق" ("دعوة مرسلة إلى
  0770 ••• 4567"), not counted, not assignable, not opened; adding a driver returns to the dashboard.
- **Wallet top-up on a job** — `app/job-topup.tsx` over `src/features/ops/TopUpDesk.tsx` (shared with `app/ops/topup.tsx`): the
  job screen shows "الزبون يريد يشحن محفظته" while a courier carries a live delivery (`canTopUpOnJob`); code pad →
  `partner.topUpLookup` → amount → `partner.confirmTopUp`, with the cash cap before / after and an over-cap warning.
- Demo: `0770 111 0056` (حيدر, invited, checked in), `0770 111 0052` (a member), the owner `0770 111 0005` (two invites waiting);
  `POST /demo/fleet/invite-reset`, `POST /demo/topup?who=courier&step=at_dropoff&amount=25000` (`scripts/demo/70-topup.mjs`).
  Shots: `SHOTS=followups` (`scripts/shots/70-followups.mjs`). Copy test: `src/lib/copy.test.ts` (partner.* voice + parity).

## Money moments and the emergency contact (Phase 3, 2026-10-05; audit S-3, S-4, S-7, S-8)

- **End of job** (`src/features/work/JobEnd.tsx`, in `DonePanel`): the check inside a ring with one
  segment per job today (`SegmentRing` in `@driver/ui`), "+1,000 دينار" counting up, then "اليوم … · …
  طلبات" from `partner.status.today` re-read after the job. Near/over the cap the settle card stays;
  otherwise the demand chip and the 4-s auto-return with "خليني هنا". No bonus line (no bonus is paid).
- **End of shift** (`app/shift.tsx`, `ShiftParts.tsx`, `shift-logic.ts`): holding the switch to go
  offline opens it with `?from=` = `partner.status.onlineSince`; `driverAccount.shiftSummary` gives net,
  per hour, jobs, time online, tips, best hour, the day, cash to hand over (+ the code), tomorrow's busy
  window and one scorecard nudge. "شارك يومك": `share-day.ts` draws the card on a canvas (Web Share with
  the file, else a PNG download); `share-day.native.ts` captures `ShareDayCard` (react-native-view-shot)
  and opens the share sheet (expo-sharing).
- **Pay receipt** (`app/earnings/receipt.tsx?key=&at=`, `ReceiptParts.tsx`, `receipt-logic.ts`): any job
  line opens it — every line with its reason, the take rate, cash collected → restaurant / company, the
  ticket number and Baghdad time. "عندي اعتراض" sends a message with the job attached
  (`driverAccount.payQuery` → a support ticket; one per job; the receipt then says it is with support).
- **Readiness row** (`ReadinessRow.tsx`, `readiness.ts`, `useReadiness.ts`, `lib/readiness-probe(.native).ts`)
  above the switch: GPS · النت · صوت الطلبات · البطارية; tap for the sheet with each fix.
- **رقم للطوارئ** (`app/emergency.tsx`, الحساب row): name, relation, number → `identity.updateProfile`
  (vault); the driver's SOS messages this contact.
- Native modules added (development build needed, Expo SDK 52 versions): `expo-battery`, `expo-sharing`,
  `react-native-view-shot`.
- «عندي اعتراض» answered (S-7 follow-up): when support replies to or resolves the driver's pay objection in the
  Console, he gets a push that opens the job's receipt, and the receipt shows «دا نراجعه» / «انحلت» with
  «ردّ الدعم: …». Demo: `POST /demo/pay-query?who=courier&step=open|reply|resolve` (`scripts/demo/55-pay-query.mjs`;
  answers the receipt `path`).
- Demo (`scripts/demo/80-money.mjs`): `POST /demo/money/shift?who=courier&hours=5` (online, shift started
  5 h ago), `POST /demo/money/settle?who=courier` (hands in his cash: the done screen counts down home);
  last week's city orders per hour are fed to the summary. Shots: `SHOTS=money` (`scripts/shots/90-money.mjs`).
- **Shift guarantee "ضمان الشفت"** (G-91, `guarantee-logic.ts`; shifts 06:00–15:00 «شفت النهار» and
  15:00–02:00 «شفت الليل», Baghdad time). Switched off for the city (`MoneyRules.guarantee.enabled: false`),
  so the app shows no guarantee line. To look at the lines anyway: `POST /demo/account/guarantee-pending`
  (`?who=courier` by default; `scripts/demo/50-driver-account.mjs`). **Demo only:** it switches the guarantee
  on inside this demo API (the city rule stays off) and gives him a finished, qualifying shift — the last
  one that ended, 3 jobs, 3,500 earned — so the earnings tab shows «ضمان الشفت: 6,500 دينار تنزل بحسابك يوم
  الأحد» (pull to refresh), and job end / the shift summary show guarantee lines from then on. Restart the
  demo API to switch it off again.

## Chat and masked calls (`src/features/chat/`, `app/chat/[orderId].tsx`)

The job screen's quick-contact row: **اتصال** (`chat.requestCall`: the kitchen while at the pickup of a
food job, the customer otherwise; a platform number in production, the real number only from a
development API), **الزبون** / **رسالة** and **المطعم** (`chat.threads` unread badges, every 5 s) open the
conversation: bubbles, the courier's quick replies (`QUICK_REPLIES` in contracts: "وصلت يم الباب"،
"ما دا ألگى البيت، دزلي لوكيشن"، "الطلب بالطريق"…), photo, location, read receipts, the closed banner
30 min after delivery. The screen is the customer app's, kept in step (`ChatScreen.tsx`); new
messages are pushed over `live.chat`. Demo: `POST /demo/chat?who=courier[&step=…]`
(`scripts/demo/60-chat.mjs`); shots: `SHOTS=partner-chat` (`scripts/shots/60-chat.mjs`).

## Cash at the door — "الخردة علينا" (Phase 3, partner S-2)

The job card shows the note the customer said at checkout ("الزبون يدفع بـ 25,000 · جهّز 11,000 خردة",
`PartnerJobStop.tenderIqd`). At the door (`HandoverPanel` in `src/features/work/JobPanels.tsx`, rules in
`cash-door.ts`): the amount to collect, "الزبون دفع:" note chips (his stated note first, the exact amount,
the notes above it, "غير" on the shared `AmountPad`), the live "رجّعله 11,000 دينار", and — with no change
on him — "ما عندي خردة · حطها رصيد بمحفظته": the whole note is recorded and the rest goes to the
customer's wallet (`handover.changeToWalletIqd`; cash orders, ≤ 25,000, in 250s; the server checks it,
`docs/api/cash-change-to-wallet.md`). The slide says "استلمت 25,000 دينار"; the done screen's cash bar
counts from what he owed before to the new amount and says what went to the customer's wallet. The map
shrinks to a strip while the helper is open. Cash rides use the same server path; the ride end screen
does not show the helper yet. Demo: `POST /demo/job?who=courier&step=to_dropoff|at_dropoff&tender=25000`;
shots: `SHOTS=cash` (`scripts/shots/90-cash-change.mjs`).

## The kitchen's pickup spot (maps program r7)

On a pickup still to do, the job card shows `PickupSpotCard` («مكان الاستلام»): the restaurant's note
(«الاستلام من الشباك اليسار») and up to 2 photos that open full screen (`PlacePhotos.tsx`, the strip and
viewer the customer's `DoorCard` uses too). It comes from `PartnerJobStop.pickupSpot`, which the API fills
only for the assigned courier during the job and drops once he picked up. Unlike the door photo it does not
open by itself on arrival, so the pickup code stays on screen at the counter. Demo: مطعم خالد has a drawn
takeaway window and a note (`scripts/demo/20-core-work.mjs`); `POST /demo/job?who=courier&step=to_pickup`.
