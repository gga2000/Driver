# Driver customer app (`@driver/customer`)

Expo SDK 52 + expo-router 4, React Native 0.76, RTL Iraqi Arabic first. UI comes only from
`@driver/ui` (components, icons, `ThemeProvider`); copy only from `@driver/i18n`.

```
app/
  _layout.tsx            providers (theme, toast, API), fonts, route guard, root <Stack>
  (auth)/                welcome → phone → otp → setup (name + first place, skippable)
  (tabs)/                index (الرئيسية) · orders (طلباتي) · wallet (المحفظة) · account (حسابي)
  places/                deliver-to picker (modal), add place, place editor (edit?id=, "موقعي هنا")
  profile/               name, safety (emergency contact) — modal
  household/             العائلة: approvals, members + limits, shared places; invite; member limit
  restaurant/[id] cart checkout kitchen/[id]   food ordering (M3)
  order/[id]             live order / ride screen: map, courier, sheet timeline, arrival + rating
  rajaa/                 الرجعة: index (corridor + garage boards), departure/[id] (seat booking),
                         booking/[id] (10-min hold + pay), pass/[id] (boarding pass), demand, request
src/
  lib/                   api (tRPC + React Query), session, guard, money, phone, profile, i18n, fonts
  components/            Screen, TabBar, SectionHeader, OtpInput, PlaceholderScreen, Wordmark, QuoteCard
  features/<flow>/       a flow's components and query hooks (home, auth, places, account, food,
                         track, rajaa)
  fixtures/              isolated sample data where the API has no customer read yet
scripts/                 demo-api.mjs (in-memory API on :3200), web-shots.mjs (Playwright screenshots)

الرجعة demo: demo-api.mjs seeds departures on both corridors and sides plus demand posts, and adds
POST /demo/rajaa/claim, /demo/rajaa/offers and /demo/rajaa/topup (?personId=…). `SHOTS=rajaa`
limits web-shots.mjs to the rajaa-*.png set (board, blocked seat, hold, pass, demand, request, home).
```

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

   Protected queries pass `enabled: useSignedIn()` so nothing fires (and 401s) before sign-in.
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
   `TODO(api)` note (see `fixtures/restaurants.ts` + `features/home/queries.ts`) so swapping the
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
- Demo: `POST /demo/track?personId=…&scenario=preparing|on_the_way|unreachable|arrived|late|signal_lost|reassigning`
  and `POST /demo/track/advance?orderId=…`; `SHOTS=track node scripts/web-shots.mjs` writes `track-*.png`.
  `?sheet=1|2` opens the sheet at a detent.
