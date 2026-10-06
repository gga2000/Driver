# Driver Merchant app (`@driver/merchant`) — "درايفر للمطاعم"

Expo SDK 57 + expo-router 57, React Native 0.86, RTL Iraqi Arabic first, phone **and** tablet. Same stack
and conventions as `apps/customer` (the reference implementation): UI only from `@driver/ui`,
session/API/guard in `src/lib`, pure logic unit-tested with Vitest.

```
app/
  _layout.tsx        providers, fonts, prefs + session hydrate, route guard, the shell
                     (rail ≥ 900 px / bottom tabs on a phone), MerchantRuntime, receipt preview
  (auth)/            welcome → phone → otp
  not-activated      signed in, but no merchant role on any store (friendly gate + call Driver)
  stores             store picker (more than one store, and "بدّل المحل")
  index              الطلبات — the orders board (src/features/board)
  menu/index         المنيو        ← wave 2 (placeholder now)
  money/index        الفلوس        ← wave 2 (placeholder now; owners only)
  insights           الإحصائيات    ← wave 2 (placeholder now)
  more               المزيد: staff, deals, printer, hours (open/close, busy, weekly hours, holidays), settings, switch store, sign out
  deals/index        العروض        ← wave 2 (placeholder now)
  staff/index        الموظفين      ← wave 2 (placeholder now; owners only)
  printer, hours, settings
src/
  lib/               api, session, storage, guard (+ store pick, sections), prefs (store, locale,
                     sound, auto-print), i18n (+ i18n-core), time, money, phone, layout, alert-sound
  components/        Page, ModalSheet (bottom sheet on phone / dialog on tablet), Shell (NavRail,
                     BottomBar), MIcon (kitchen icons on the @driver/ui grid), EntryTile,
                     PlaceholderScreen, OtpInput, Wordmark
  features/board/    Board, OrderCard, AcceptSheet, RejectSheet, OrderDetailSheet, Banners, alarm,
                     queries (live board stream, actions, heartbeat), logic (+ tests)
  features/store/    StoreHeader (open/closed, busy, printer, cash), StoreSheets (close, busy,
                     اطلب فلوسك), queries (myStores, storeStatus, switches, balance)
  features/print/    runtime (printer driver, print an order, printer sync), ReceiptPreview
  features/runtime/  MerchantRuntime: heartbeat, app-wide new-order alarm, printer status
  print/             receipt model (80 mm, grouped by person) + html; printer.ts (web preview),
                     printer.native.ts (Bluetooth ESC/POS stub behind the same interface)
locales/             ar.json + en.json — this app's `merchant.*` copy (native/ar.json: app name)
scripts/             demo-api.mjs (+ demo/*.mjs sections), web-shots.mjs (+ shots/*.mjs lists)
```

## API

- `merchant.myStores` → stores the person works at (`owner` / `staff`); empty → not-activated gate.
- `merchant.board({ merchantOrgId })` → active orders in columns `new` / `preparing` / `ready`, items
  grouped by person (orderer first, then each tagged participant with their label and note), modifiers
  by name, line notes, cash to collect, courier state (`searching` / `on_the_way` + minutes / `arrived`),
  accept deadline (90 s), partial-accept proposal, lateness. Polled every 5 s with server `now`
  (card timers use the server clock).
- `merchant.storeStatus` / `setOpen` (early close needs a reason) / `setBusy` (+10 min on every prep
  time until now + 60 min; orders and the customer storefront honour it) / `setPrinterStatus`.
- Chat (`src/features/chat/`, `app/chat/[orderId].tsx?kind=merchant_courier|customer_merchant&number=…`):
  the order detail's "التواصل" row — راسل الدليفري / اتصل بالدليفري (masked) / راسل الزبون, unread
  badges from `chat.threads` (pushed by `live.merchantBoard`); the conversation by `live.chat`.
  Any staff member reads for the kitchen (one read receipt per store). Demo `POST /demo/chat/fresh`
  (`scripts/demo/chat.mjs`), shots `SHOTS=merchant-chat`.
- Order actions stay on `orders.merchant.accept` (with `prepMinutes` and `unavailableLineIds` for a
  partial accept) / `reject` / `ready` / `heartbeat` (every 30 s, app-wide).
- Money: `ledger.merchantBalance` (live cash balance) and `ledger.requestSettlement` ("اطلب فلوسك").
  Owners only in the UI (spec: roles gate money views).
- Wave 2 (`src/features/{money,insights,staff}`): `merchantAdmin.money.today` / `cash` / `statement` /
  `disputes` / `respondDispute`, `merchantAdmin.insights`, `merchantAdmin.staff.*`. Staff who reach
  `/money` or `/staff` see `OwnerOnly`. Demo: `scripts/demo/{insights,money,staff}.mjs` share five weeks of
  مطعم خالد history (`scripts/demo/lib/khalid-history.mjs`); `/demo/money/request` + `/demo/money/handover`
  (PIN 4821) walk "اطلب فلوسك" to the hand-over, `/demo/staff/reset` restores the team.

## Opening hours and staff invites (follow-ups 2026-10-04)

- **الدوام** (`app/hours.tsx`, `src/features/hours/`): besides open/close and busy mode, the weekly schedule from `merchant.hours` —
  per day open/closed, up to three shifts (tap a shift: start/end hour grid in kitchen order and minutes; "نفس الأوقات لكل الأيام"),
  shifts past midnight, the Friday-prayer pause under Friday, holiday closures (two-month calendar, range + reason). Owners edit and
  save (`merchant.setHours`; problems shown before saving), staff read. The board shows "برّا وقت الدوام … يفتح …" / the holiday
  from `storeStatus.schedule`. Demo `POST /demo/hours/reset` (`scripts/demo/hours.mjs`).
- **مكان الاستلام** (`app/pickup-spot.tsx`, `src/features/pickup/`, maps program r7): المزيد → «مكان الاستلام». Up to 2 photos
  (library, camera on a phone) and a 140-character note of where couriers collect orders; a picked photo uploads at once
  (`places.photoUpload`), «احفظ» sends `merchant.setPickupSpot`. Owners edit, staff read. The courier sees it on the pickup stop of
  his job until he picks up. Demo: Khalid starts with a drawn takeaway window; `POST /demo/pickup/reset` | `/demo/pickup/clear`
  (`scripts/demo/pickup.mjs`).
- **منطقة التوصيل** (`app/delivery-area.tsx`, `src/features/area/`, maps program r5): المزيد → «منطقة التوصيل». The town's zones
  as a plain SVG map (`ZoneMap`, no tiles) coloured by the delivery fee a customer there pays for this store's food
  (`merchant.deliveryArea`, the server's checkout quote; read-only), a legend in دينار, paused zones dashed, and a list of every
  zone. Owner and staff. **منين زبائنك** (r6) is a panel on الإحصائيات (`merchant.customerZones`): delivered orders per area
  for the chosen range, zones under 5 orders folded into «مناطق ثانية» (spec D7). Owner only (Ali 2026-10-07): the API refuses
  staff like the money screens, and staff don't see the panel. Demo: Khalid's history carries drop-off zones.
- **تصوير المنيو** (`app/menu-photos.tsx`, `src/features/menu-photos/`, maps program k3): المزيد → «تصوير المنيو». The owner asks
  Driver's field team to photograph the whole menu or picked dishes, with a note («الأفضل الصبح قبل الزحمة»), then follows it on
  four steps (طلبنا · موعد التصوير · تصوّرت · خلص) and «ألغي الطلب» until the photos are handed over. Then each dish shows today's
  photo next to the new one with «قبول» / «رفض»: accepted becomes the dish's photo (the same catalog photo as the item editor),
  rejected is deleted. `merchantAdmin.menuPhotos.*`; owners act, staff read; push «صور المنيو جاهزة» opens the screen. Demo: the
  shoot is handed over with 3 drawn plates; `POST /demo/menu-photos/reset` | `/demo/menu-photos/scheduled` | `/demo/menu-photos/clear`
  (`scripts/demo/menu-photos.mjs`).
- **قدر اليوم** (`app/pot.tsx`, `src/features/pot/`, joy h2): a row on top of المنيو and an المزيد tile. One tap posts
  last week's same-day dish («نفسها اليوم»); otherwise pick from the dishes cooked lately or the menu (on sale only, with how many
  follow each), an optional 60-character note and «لحد». `merchantAdmin.pot.set` / `clear`; owner and staff. Followers get one push.
- **قصة مطعمك** (`app/story.tsx`, joy h5): 1–3 lines and the year opened, «اعرضها للزباين» (the owner's consent) and a preview;
  `merchantAdmin.story.set`, owner only, staff read. Demo (`scripts/demo/pot.mjs`): Khalid has last week's pot, two recent ones,
  four followers and a shown story; `POST /demo/pot/reset` | `/demo/pot/clear` | `/demo/story/clear`.
- **Staff invites** (`app/staff/index.tsx`, `StaffSheets`): a waiting invite reads "دعوة مرسلة إلى 0780 ••• 3344" and when it went
  out; its sheet resends (`merchantAdmin.staff.resendInvite`, once per 10 min) or cancels it.
- Shots: `SHOTS=followups` (`scripts/shots/followups.mjs`).

## Copy

App strings live in `locales/ar.json` and `locales/en.json` under `merchant.*`; shared strings
(`onboarding.*`, `action.*`, the older `merchant.accept` …) still come from `@driver/i18n`. `useT()`
reads the local table first. `src/lib/i18n.test.ts` checks key and placeholder parity, that no local
key shadows a shared one, Western digits only, no emojis, no MSA particles, and that exclamation marks
appear only on the new-order alert. Wrap Latin/number runs that start a string (`+10`, references) in
an LTR isolate `⁦…⁩`.

## Layout

`useLayout().wide` (≥ 900 px) switches: right-side rail (start side in RTL) + board columns side by side
+ centred dialogs; otherwise bottom tabs on section roots + segmented board + bottom sheets. Every
non-board screen uses `<Page title back? >` (centred column, 760 px max on a tablet).

## Adding a flow (wave 2)

1. **Route** — replace the placeholder file's contents (`app/menu/index.tsx`, `app/money/index.tsx`,
   `app/insights.tsx`, `app/deals/index.tsx`, `app/staff/index.tsx`). Deeper screens go next to it
   (`app/menu/item.tsx`); add the folder to `SECTION_OF` in `src/lib/guard.ts` only for a new
   top-level folder. Section roots get the phone tab bar automatically; deeper screens use
   `<Page back>`.
2. **Queries** — `src/features/<flow>/queries.ts` with `useApi()` + React Query, `enabled:
   useSignedIn() && !!storeId`; the store comes from `useCurrentStore()` (`store`, `canSeeMoney`).
   Errors: `apiErrorMessage(err, t('merchant.common.error'), locale)`.
3. **Copy** — add `merchant.<flow>.*` keys to both locale files (voice guide; tests enforce parity).
4. **Demo data** — add `scripts/demo/<flow>.mjs` exporting `async function register(ctx)`: seed what
   the screen needs through `ctx.services` (orgs, catalog, orders, identity, trips, dispatch, ledger)
   and add hooks with `ctx.route('/demo/<flow>/…', handler)`. Don't edit `demo-api.mjs`.
5. **Screenshots** — add `scripts/shots/<flow>.mjs` exporting `{ name, viewports, run(h) }`; use
   `h.signIn('0770 123 4567')` (Khalid's owner), `h.byTestId`, `h.shot('<name>')`, `h.demoPost`.
   `SHOTS=<flow> VIEWPORTS=tablet node scripts/web-shots.mjs <out>` runs just yours.
6. **Tests** — pure logic in `src/**/*.test.ts` (plain Node: no react-native imports).

## Demo and screenshots (offline)

```sh
pnpm build                                            # packages + apps/api/dist
cd apps/merchant
EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3302/trpc EXPO_PUBLIC_DEV_TOOLS=1 \
  npx expo export --platform web --output-dir dist-web
PORT=3302 node scripts/demo-api.mjs &                 # in-memory API on :3302 (dev OTPs)
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  node scripts/web-shots.mjs <out-dir>                # tablet 1280×800 + phone 390×844
```

Demo people: `0770 123 4567` owner of مطعم خالد (straight to the board), `0770 999 0000` staff at two
stores (picker), `0770 555 0000` no store (gate). The board section seeds 3 new orders (a group order
for 3 people with notes, a cash one, a prepaid one), 2 preparing, 2 ready, 87,500 دينار cash balance
and a disconnected printer. New orders auto-reject after 90 s as in production:
`POST /demo/board/fresh` puts 3 fresh ones on the board; `POST /demo/board/missed?count=2` adds orders
that just timed out (the "طلبات فاتتك" strip, the "فاتك اليوم" chip and the busy/close nudge);
`/demo/board/printer?state=…` and `/demo/board/store?open=1&busy=0` reset the switches;
`POST /demo/board/rush?count=10` replaces the new column with a rush (offers spread over the last
minute, one group order with an allergy and a courier note). Shots: `SHOTS=rush`. The board opens
behind the "يلا نبدأ الشغل" gate: `web-shots.mjs` taps "ابدأ الشغل" after sign-in (`signIn(phone, {
keepGate: true })` keeps it for a shot).

## Native notes

- Alarm (UI/UX audit S-01, M-02, M-04): the ladder in `features/board/ladder.ts` — a chime every 4 s,
  every 2 s in the last 30 s (ring and card turn red), a continuous tone and "باقي 10 ثواني على #…" in
  the last 10 s. "سكّت 30 ثانية" is a snooze, never a silence (it rings again at 20 s left). Web:
  WebAudio, unlocked by "ابدأ الشغل" (or any tap). Native: `alert-sound.native.ts` plays the bundled
  `assets/sounds/new-order*.wav` through expo-audio with `playsInSilentMode`, plus vibration patterns;
  `scripts/dev/make-alert-sounds.mjs` regenerates the tones. "جرّب الصوت" is in الإعدادات.
- Screen on: expo-keep-awake while the app is open on a store (native); the Screen Wake Lock API from
  "ابدأ الشغل" on the web (a chip asks to keep the screen on where the browser has no such API).
- Printing: `print/printer.native.ts` documents the Bluetooth ESC/POS plan (BLE module in a dev-client
  build, Arabic rasterised to 576 px, status reported with `merchant.setPrinterStatus`).

## Kitchen rush (UI/UX audit phase 2: M-05, M-06, M-09, M-10, M-11, M-13)

- جديد is in answer order: least time left first (`byTimeLeft`). One "new" number everywhere — the
  column, the rail/tab badge, the banner ("3 طلبات تنتظر · 1 مسكّت") and the off-board pill (`newCount`,
  `newOrderSummary`).
- Tablet, three or more waiting (`isRush`): `RushQueue` chips (number, mini ring, dish count) over the
  column, all visible at once; tickets go compact except the one being read (tap a chip or a compact
  ticket to open it). Four or more and busy off: "N طلبات تنتظر. تشغّل وضع الزحمة؟".
- Phone: the header is one 56-pt row (store, open, "…" for busy, printer, cash, switch store); the
  `StickyAcceptBar` above the tabs answers the next order when it is long or a group order, or when
  several wait (`stickyAcceptTarget`).
- Notes (M-09): the card shows the kitchen note only; the detail sheet shows it first and the courier's
  note after the items. Any kitchen note that mentions an allergy puts a red "حساسية" pill on the card,
  its queue chip and the detail sheet (`hasAllergy`, display only).
- The detail sheet carries the 90-s ring for a new order (M-11). Best sellers rank and scale by one
  measure, with "بالعدد / بالفلوس" for owners (M-13, `bestSellerRows`).

## Signature moments (UI/UX audit phase 3: S-M4, S-M5, S-M6, M-17)

- **The courier at the pass** (`features/board/PassCard.tsx`, `pass.ts`): when a ready order's courier is
  at the counter the card turns green edge to edge — "حيدر وصل · سلّمه #7046", his plate (`PlateChip`),
  the cash he collects, the items — and amber after 3 minutes ("حيدر ينتظر من 4 دقايق"). The ready column
  puts waiting couriers first. "سلّمته" calls `orders.merchant.handOver` (records `handed_over_at` and
  `order.handed_over` on the order's history; idempotent; no state or money change) and the card says
  "سلّمته #7046 · 10:14 م" until his app confirms the pickup. On a phone a green strip shows the courier
  at the pass from any tab ("شوفه").
- **Money in one line** (`MoneyLine` in `StoreHeader`, `moneyPill` in `features/money/logic.ts`): the
  server's `merchantAdmin.money.cash.headline` — "إلك 87,500 دينار · توصلك الليلة ويا الدليفري" with "اطلب
  فلوسك", "عليك 4,250 دينار عمولة · تنخصم من الجاية", "فلوسك جاية قبل 9:40 م". Tablet header; the "…" menu
  on a phone; the Money hero's sub-line. The weekly statement has the bridge row (M-17): "رصيد أول الأسبوع
  + الصافي − اللي استلمته (+ تعديلات) = رصيد آخر الأسبوع"; "اللي استلمته" opens its lines.
- **End of day** (`features/day/`): `merchantAdmin.daySummary` — at close, or from 00:30 to 05:00 for the
  day before — puts "اليوم · 42 طلب · فاتك 0 · وقتك مضبوط 91% · الصافي 512,000 دينار" and one advice line
  on the board. A missed order counts as not on time in "وقتك مضبوط"; the net is left out while none of
  the day's orders has been delivered yet (money is booked at delivery). "شارك على واتساب": the share sheet on a phone (the server's text, Iraqi plurals); on the
  web a 1080×1080 image of the card (Web Share with the file where the browser can, else a download).
  "تمام" hides it for that store and day on this device. Staff see it without the net.
- Demo (`scripts/demo/signature.mjs`): `POST /demo/signature/at-pass?waited=4` (a ready order whose
  courier حيدر, plate واسط 45671, waited `waited` minutes; returns its `number`),
  `/demo/signature/balance?kind=owed|owe` (87,500 owed or "عليك 4,250"), `/demo/signature/day-summary`
  (closes the store for the day). Shots: `SHOTS=signature`.

## Real time (`live.merchantBoard`)

`MerchantRuntime` keeps the selected store's `live.merchantBoard` stream open (SSE, stream token in
connection params, `docs/api/live.md`). A `new_order` event rings the alarm at once (`alarm.ringNow`,
before the board is re-read); order, courier and store changes re-read the board. The board keeps a
60-s safety refetch while live and polls every 30 s when SSE does not get through.
