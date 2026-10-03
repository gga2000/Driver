# Driver Merchant app (`@driver/merchant`) — "درايفر للمطاعم"

Expo SDK 52 + expo-router 4, React Native 0.76, RTL Iraqi Arabic first, phone **and** tablet. Same stack
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
                     queries (board poll, actions, heartbeat), logic (+ tests)
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
  badges from `chat.threads` (5 s); the conversation polls `chat.thread` every 3 s (realtime later).
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
`POST /demo/board/fresh` puts 3 fresh ones on the board; `/demo/board/printer?state=…` and
`/demo/board/store?open=1&busy=0` reset the switches.

## Native notes

- Sound: web plays a WebAudio chime (unlocked by the first tap — the board offers "شغّل صوت الطلبات");
  native vibrates until a sound module ships (`alert-sound.native.ts`, TODO(native-sound)).
- Printing: `print/printer.native.ts` documents the Bluetooth ESC/POS plan (BLE module in a dev-client
  build, Arabic rasterised to 576 px, status reported with `merchant.setPrinterStatus`).
