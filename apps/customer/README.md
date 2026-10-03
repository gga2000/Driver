# Driver customer app (`@driver/customer`)

Expo SDK 52 + expo-router 4, React Native 0.76, RTL Iraqi Arabic first. UI comes only from
`@driver/ui` (components, icons, `ThemeProvider`); copy only from `@driver/i18n`.

```
app/
  _layout.tsx            providers (theme, toast, API), fonts, route guard, root <Stack>
  (auth)/                welcome → phone → otp → setup (name + first place, skippable)
  (tabs)/                index (الرئيسية) · orders (طلباتي) · wallet (المحفظة) · account (حسابي)
  places/                deliver-to picker (modal) + add place
  restaurant/[id] cart checkout order/[id] rajaa   ← STUBS, replaced by later milestones
src/
  lib/                   api (tRPC + React Query), session, guard, money, phone, profile, i18n, fonts
  components/            Screen, TabBar, SectionHeader, OtpInput, PlaceholderScreen, Wordmark, QuoteCard
  features/<flow>/       a flow's components and query hooks (home, auth, places)
  fixtures/              isolated sample data where the API has no customer read yet
scripts/                 demo-api.mjs (in-memory API on :3200), web-shots.mjs (Playwright screenshots)
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
PORT=3200 node scripts/demo-api.mjs &                 # in-memory API, dev OTPs, POST /demo/active-order
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  node scripts/web-shots.mjs <out-dir>                # 390×844 @2x: welcome, phone, otp, setup, home, orders, profile
```

`EXPO_PUBLIC_DEV_TOOLS=1` shows the OTP dev-code strip in a production export (it is always on
under `expo start`). Metro notes for this pnpm monorepo live in `metro.config.js` (hierarchical
lookup on, package exports on, React singletons pinned). `pnpm typecheck` uses
`tsconfig.typecheck.json`, which pins React 18 types.
