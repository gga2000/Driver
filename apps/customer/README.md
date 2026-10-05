# Driver customer app (`@driver/customer`)

Expo SDK 52 + expo-router 4, React Native 0.76, RTL Iraqi Arabic first. UI comes only from
`@driver/ui` (components, icons, `ThemeProvider`); copy only from `@driver/i18n`.

```
app/
  _layout.tsx            providers (theme, toast, API), fonts, route guard, root <Stack>
  (auth)/                welcome → phone → otp → setup (name + first place, skippable)
  (tabs)/                index (الرئيسية) · orders (طلباتي) · wallet (المحفظة) · account (حسابي)
  search                 دوّر: recents, popular terms, kitchens + dishes (`catalog.search`)
  restaurants            كل المطاعم ("شوف الكل"): sort + filters, closed kitchens below (?preset=open|deals)
  places/                deliver-to picker (modal), add place, place editor (edit?id=, "موقعي هنا")
  profile/               name, safety (emergency contact) — modal
  household/             العائلة: approvals, members + limits, shared places; invite; member limit
  restaurant/[id] cart checkout kitchen/[id]   food ordering (M3)
  order/[id]             live order / ride screen: map, courier, sheet timeline, arrival + rating
  chat/[orderId]         in-order chat (?kind=customer_courier|customer_merchant): bubbles, quick replies, photo, location
  share/[token]          PUBLIC share-trip page (no sign-in; `PUBLIC_SEGMENTS` in lib/guard.ts)
  ride/                  تكسي / تكتك: index (وين رايح؟ search), pin (map pin adjust), choose (quotes → orders.place)
  rajaa/                 الرجعة: index (corridor + garage boards), departure/[id] (seat booking),
                         booking/[id] (10-min hold + pay), pass/[id] (boarding pass), demand, request
src/
  lib/                   api (tRPC + React Query), session, guard, money, phone, profile, i18n, fonts
  components/            Screen, TabBar, SectionHeader, OtpInput, PlaceholderScreen, Wordmark, QuoteCard
  features/<flow>/       a flow's components and query hooks (home, auth, places, account, food,
                         track, rajaa)
  fixtures/              isolated sample data where the API has no customer read yet (none today)
scripts/                 demo-api.mjs (in-memory API on :3200), web-shots.mjs (Playwright screenshots)

الرجعة demo: demo-api.mjs seeds departures on both corridors and sides plus demand posts, and adds
POST /demo/rajaa/claim, /demo/rajaa/offers and /demo/rajaa/topup (?personId=…). `SHOTS=rajaa`
limits web-shots.mjs to the rajaa-*.png set (board, blocked seat, hold, pass, demand, request, home).
```

## Guest browsing (audit C-18, Ali 2026-10-04)

- First launch shows welcome once; "يلا نبدي" opens home as a guest, "عندك حساب؟" goes to the phone.
  Guests browse home, search, the restaurant list, menus and the cart (`GUEST_SEGMENTS` in
  `lib/guard.ts`); orders, wallet and account show a "دخّل رقمك" card (`GuestGate`). The catalog reads
  are public on the API (rate-limited per IP for guests, `docs/api/guest-search-and-launch-interest.md`).
- The number is asked at "كمّل الطلب" (cart), at الرجعة / rides, and at "خبرني": `requireSignIn(path)`
  (`lib/guest.ts`) keeps `returnTo` in the device profile; a guest who opens a protected screen
  directly is stopped there too. After OTP (and setup for a new account) the guard replaces the auth
  screens with that path, so back from checkout is the cart again.
- OTP screen: after 30 s, "ما وصلك؟ دزلي على واتساب" (`requestOtp` with `channel: 'whatsapp'`) next to
  "دزلي رسالة ثانية".
- Home: the search bar opens `/search` (no mic until voice exists); coming-soon tiles (سوق، خطوط، طرود)
  open a sheet with "خبرني لمن تنفتح" (`notify.launchInterest`); favourites only from real orders.

## Phase 2: home, طلباتي, reorder, help, rating recovery, driver chip

- **Home (C-09)**: one-line header (greeting + deliver-to, bell), search, ONE service grid (أكل، تكسي،
  تكتك، الرجعة; سوق/خطوط/طرود in a quiet "قريباً" strip), then what's in progress (order/ride pill, a
  booked الرجعة seat) or else ONE card — "اطلب نفس الطلب" (last delivered meal, 30 days) or the
  الرجعة board (`features/home/context.ts`). Food: cuisine chips (→ `/search?q=`) and the kitchens open
  now as rows; the first is inside the first screen at 360×740. The dark "وين رايح؟" bar is gone from
  home (taxi/tuktuk are tiles).
- **طلباتي (C-15, C-44)**: `orders.history` (restaurant + dishes in one read, `docs/api/customer-history-driver-cards.md`);
  running orders pinned, then by Baghdad day; one-word status pills (`features/orders/history.ts`).
- **"اطلبه مرة ثانية"**: `features/orders/reorder.ts` rebuilds the cart from today's `catalog.menu`
  (prices from the server, nothing guessed: gone/sold-out/off-schedule dishes and lost required
  choices are left out and named; repriced dishes say was → now). A clean rebuild goes straight to
  the cart; otherwise `ReorderSheet` explains first (and says when the current cart is replaced).
- **Help (C-13)**: حسابي → مساعدة (`/help`): recent orders → `/help/[orderId]` "عندي مشكلة"
  (`orders.openDispute` inside the dispute window; running/closed/cancelled orders get the right
  pointer), WhatsApp (`EXPO_PUBLIC_SUPPORT_WHATSAPP`, placeholder default), 5 FAQs.
- **Rating (C-12)**: 1–3 on either score asks what went wrong (rating tags) and offers "افتح شكوى"
  (dispute first, then the rating — the API keeps a disputed order open). No tip chips: tips exist
  only at checkout.
- **Driver chip (C-19, C-20)**: `DriverChip` / `PlateChip` in `@driver/ui` — name (or a person glyph),
  "متحقق اليوم", model · colour, the plate in its own never-truncated chip. On the ride sheet (first
  for rides), the الرجعة board, seat sheet and boarding pass ("سايقك", `routes.driverCards`).
- Demo: `POST /demo/history?personId=…` adds three delivered orders (yesterday, 3 and 9 days ago)
  and runs حمص out at مشويات الحاج كريم so a reorder shows the explanation sheet. الرجعة demo
  drivers are named people now.

## Session and API

- `src/lib/session.ts` keeps the `identity.verifyOtp` token pair in **expo-secure-store** on native
  (`storage.native.ts`) and **localStorage** on web (`storage.ts`). `useSession()` /
  `useSignedIn()` read it; `session.signIn(tokens, personId)` / `session.signOut()` change it.
- Every request carries `Authorization: Bearer …`. The access token is refreshed 30 s before expiry,
  and a 401 triggers one `identity.refresh` + replay (`authRetryLink`). Refreshes are single-flight
  because the API rotates refresh tokens and revokes the session on reuse. A refused refresh signs
  out (the guard sends the person to `/welcome` and the query cache is cleared); a network failure
  keeps the session.
- API URL: `EXPO_PUBLIC_API_URL` (inlined at bundle time), default `http://localhost:3000/trpc`.

## Account (places, profile, wallet, household)

`features/account/` holds the M3 account surfaces: query hooks over `places.*`, `identity.me/updateProfile`,
`wallet.*` and `household.*`; `PlaceEditor` (label, name, `PinMap` schematic map or zone chips,
"موقعي الحالي" via expo-location, courier note, gate photo via expo-image-picker → signed PUT, household
sharing); `ApprovalCard`; and `sync.ts` (`useAccountSync`, mounted by the tabs layout), which mirrors
`places.mine` into the device profile store (home header, deliver-to picker and checkout keep reading
`useProfile().places`) and migrates device-only places and names to the server once. Photo URLs from
the dev storage are relative to the API origin (`photoUri`).

## Adding a flow

1. **Routes** — create your folder under `app/` (e.g. `app/restaurant/[id].tsx` replaces the stub,
   or `app/parcel/…`). Register a non-default header in the root `<Stack>` in `app/_layout.tsx` only
   if you need one. Pushed routes sit above the tabs; the guard already protects them.
2. **Queries** — put hooks in `src/features/<flow>/queries.ts`:

   ```ts
   import { useMutation, useQuery } from '@tanstack/react-query';
   import { useApi } from '@/lib/api';
   import { useSignedIn } from '@/lib/session';

   export function useOrder(orderId: string) {
     const api = useApi();
     const signedIn = useSignedIn();
     return useQuery({ ...api.orders.get.queryOptions({ orderId }), enabled: signedIn });
   }

   export function usePlaceOrder() {
     const api = useApi();
     return useMutation(api.orders.place.mutationOptions());
   }
   ```

   Protected queries pass `enabled: useSignedIn()` so nothing fires (and 401s) before sign-in;
   the public catalog reads (`catalog.*`) run for guests too.
   For one-off imperative calls use `useApiClient()` (`await client.orders.cancel.mutate(…)`).
   Show errors with `apiErrorMessage(err, t('error.network'), locale)` — the server's
   `message_ar` when present — and branch on `apiErrorCode(err)` (`otp_invalid`, `price_changed`…).
3. **Screens** — wrap in `<Screen>` (cream background, safe areas, 20 px gutter, centred column,
   optional pinned `footer`). Build from `@driver/ui`; strings via `const t = useT()`. Add new keys
   to **both** `packages/i18n/src/locales/ar-IQ.json` and `en.json` (parity is tested), follow the
   voice guide, then `pnpm --filter @driver/i18n build`.
4. **Money** — `iqd(amount)` → `12,500 دينار`; `amountParam(n)` for `{amount}` placeholders.
   Ranges and Latin runs inside Arabic go in an LTR isolate (`⁦…⁩`).
5. **No API yet?** — put sample data in `src/fixtures/<thing>.ts` behind a query hook with a
   `TODO(api)` note so swapping the
   queryFn is the only change later.
6. **Tests** — pure logic in `src/**/*.test.ts` (Vitest, plain Node: don't import react-native
   there).

## Web build and screenshots (offline)

```sh
pnpm build                                            # packages + apps/api/dist
cd apps/customer
EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3200/trpc EXPO_PUBLIC_DEV_TOOLS=1 \
  npx expo export --platform web --output-dir dist-web   # add --dev --no-minify for readable errors
PORT=3200 node scripts/demo-api.mjs &                 # in-memory API, dev OTPs, demo hooks: /demo/active-order,
                                                      # /demo/kitchen, /demo/seed, /demo/track, /demo/rajaa/*,
                                                      # /demo/account
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  node scripts/web-shots.mjs <out-dir>                # 390×844 @2x, every group: app-*, acct-*, food-*,
                                                      # track-*, rajaa-*  (SHOTS=food,track runs only those;
                                                      # DIST_DIR, DEMO_API)
```

The demo API seeds the four launch restaurants (`@driver/contracts/seeds`, the same data
`pnpm db:seed` writes) and plays the kitchen: `DEMO_KITCHEN_MS` (default 20000, 0 = never)
auto-accepts placed orders, `POST /demo/kitchen?orderId=…&action=accept|reject` decides one now,
`GET /demo/seed` lists the restaurants' org ids. `web-shots.mjs` also runs the food flow
(`food-*.png`: restaurant, item sheet, cart for two, checkout, waiting, rejection → carried cart);
`SHOTS=food` (or the older `ONLY=food`) runs only that group, `DIST_DIR` points at another export.

## Deals and wallet top-up

Merchant deals come from the server only (`docs/api/deals-and-topup.md`): `RestaurantCard.deals` are the
badges (`src/features/food/DealBadge.tsx`), `orders.quote` (`useOrderQuote`) gives the discount line,
per-line savings and the next deal to unlock; `orders.place` gets `discountIqd` back as an expectation and
answers `deal_changed` when the deal ended — checkout refetches and explains. `app/topup.tsx` is
"شحن المحفظة": amount → 6-digit code + QR (`src/lib/qr.ts`, a small byte-mode QR encoder drawn with
react-native-svg) → polls `wallet.topUpStatus` until an ops agent or courier confirms.

Demo hooks: `POST /demo/deals` (20 % off + free delivery over 15,000 on مطعم خالد, kitchen open around the
clock), `/demo/topup/request?personId=&amount=`, `/demo/ops-agent` (field ops `0770 555 0101`),
`/demo/topup/confirm?code=`. `SHOTS=deals,topup` writes `deals-*.png` and `topup-*.png`; the top-up group
also drives the Partner app's Ops mode, so export it against the same API and pass `PARTNER_DIST_DIR`.

## Food ordering (M3)

`src/features/food/`: `cart.ts` (pure cart: one merchant, merged lines, people, grouping,
carry-over, reconcile), `cart-store.ts` (persisted cart + saved people + the order waiting for the
kitchen), `modifiers.ts` (required/min/max), `checkout.ts` (quote request, totals, the
`orders.place` payload), `queries.ts` (`catalog.*`, `pricing.quote`, polling). The cart total is
`pricing.quote` split by `deliveryFeesOf` and sent as expectations, so it never changes at checkout.

`EXPO_PUBLIC_DEV_TOOLS=1` shows the OTP dev-code strip in a production export (it is always on
under `expo start`). Metro notes for this pnpm monorepo live in `metro.config.js` (hierarchical
lookup on, package exports on, React singletons pinned). `pnpm typecheck` uses
`tsconfig.typecheck.json`, which pins React 18 types.

## City taxi / tuktuk (`app/ride/*`, `src/features/ride/`)

- Entry: home's "وين رايح؟" bar (`WhereToBar`, with تكسي / تكتك shortcuts) and the تكسي service tile.
- `/ride`: pickup defaults to the selected deliver-to place; one search (`searchSpots`, Arabic-folded:
  ة/ه, أ/ا, گ/ك, Eastern digits, leading "ال") over saved places, recent destinations (device,
  `store.ts`), landmarks (`places.landmarks`: seeded garages + meeting points, `AZIZIYAH_LANDMARKS`,
  plus verified landmark places) and the 34 zones; or "حدد على الخريطة".
- `/ride/pin?field=pickup|dropoff`: the map moves under a fixed pin; the zone under it comes from
  `places.zoneFor`. Keep the bottom card a fixed height: resizing the map mid-drag cancels the drag.
- `/ride/choose`: `pricing.quote` for taxi and tuktuk × door / street at the minute (the request
  `orders.place` re-prices with, `rideQuoteRequest`), every component on "تفاصيل السعر", ride time,
  night/peak line from the quote (hours from `config.city`), tuktuk off for edge zones with "try
  anyway", door pickup price difference, cash / wallet (off when the balance is short), driver note.
  Requests with the quoted fare; `price_changed` re-quotes and says the new fare.
- `/order/[id]` for rides: tuktuk/taxi pill from `trip.vertical`, pickup pin + radar and an honest
  wave line + counter while searching (dispatch waves from `config.city`), free-cancel button, route
  card, free/paid wait counter at the pickup, "وصلت؟ خلّص المشوار" (`orders.confirmRideArrived`), one
  fare line with how it is paid, and a ride receipt on the arrival screen.
- Demo: `POST /demo/ride[?acceptMs=3000]` puts four taxis and three tuktuks online, cruising small
  loops around the centre while free (the choose screen's nearby vehicles), (the nearest offered
  driver accepts after `acceptMs`, 0 = hold), `/demo/ride/accept?orderId=` and
  `/demo/ride/advance?orderId=` (at pickup → on the trip → arrived, cash paid). `SHOTS=ride` writes
  `ride-*.png`.

## Live order screen (`app/order/[id].tsx`, `src/features/track/`)

- Reads `orders.track` (own order + trip summary + courier card, every 4 s while live) and
  `orders.courierPosition` (every 2 s, only between accept and complete); rates with `orders.rate`
  (`delivery`, `food`).
- Map: `map/BaseMap.web.tsx` is MapLibre GL with the `@driver/map` light style (lazy chunk; the SVG
  base if WebGL is missing); `map/BaseMap.tsx` (native) is the SVG zone base until
  `@maplibre/maplibre-react-native` ships in a dev-client build. The overlay (courier glide +
  bearing, shortening route, pins) runs on Reanimated worklets over either base, from one camera in
  shared values (`geo.ts`: 512-px Web Mercator, same as MapLibre).
- Pure logic with tests: `geo.ts` (projection, glide, bearing, route), `timeline.ts` (status →
  steps), `eta.ts` (live ETA, lateness, signal lost).
- Demo: `POST /demo/track?personId=…&scenario=preparing|on_the_way|near|unreachable|arrived|late|signal_lost|reassigning`
  and `POST /demo/track/advance?orderId=…`; `SHOTS=track node scripts/web-shots.mjs` writes `track-*.png`.
  `?sheet=1|2` opens the sheet at a detent.

## Chat, masked call, share-trip (`src/features/chat/`, `src/features/share/`)

- **Chat** — `chat.threads` (badges on the courier card's chat button and the "راسل المطعم" row,
  pushed by `live.order`), `chat.thread` (the open conversation, pushed by `live.chat`; the push
  notification still goes out from the API), `chat.send`
  (text ≤ 500, quick-reply key, photo via `places.photoUpload`, location), `chat.markRead` for what is
  on screen. Pending messages show at the bottom and retry with the same `clientId` (the server
  stores them once). Phone numbers typed into a message come back masked (`[رقم مخفي]` + a note).
  The courier card's quick-reply chips send straight into the thread. `logic.ts` is pure and tested.
- **Masked call** — `chat.requestCall` → `useMaskedCall`: dials the platform number; a development API
  returns the other party's real number and the toast says so. The web build only shows the toast.
- **Share-trip** — rides: the share button makes a signed link (`tracking.createShareLink`), the sheet
  shows how often it was opened and "وقّف المشاركة" (`tracking.revokeShareLink`). الرجعة boarding
  pass: the same link per booking. The public page `app/share/[token].tsx` reads `tracking.shared`
  (first name, car, plate, the car on the map inside the sharing window, ETA; never a phone or
  address). `EXPO_PUBLIC_SHARE_BASE_URL` sets the public origin (web: the page's own origin).
- Demo: `POST /demo/chat?personId=…&scenario=courier|merchant|ride` (a conversation already going, or a
  ride with a moving car and a share link → `{token, path}`), `POST /demo/chat/clock?minutes=31` (the
  chat module's clock, to show a closed thread; `0` resets). `SHOTS=chat` writes `chat-*.png`.

## Real time (`live.*`)

The order screen keeps `live.order` open (`useLiveOrder`): state changes, the courier's position
(≤ every 2 s) and chat badges arrive over SSE (`httpSubscriptionLink` + stream token, see
`docs/api/live.md`); the chat screen keeps `live.chat`. `src/lib/live.ts` reconnects with backoff,
re-reads on every reconnect and polls every 30 s while SSE does not get through (60-s safety refetch
while live). Native: `XhrEventSource` + the ReadableStream ponyfill from `@driver/contracts/live-client`.
