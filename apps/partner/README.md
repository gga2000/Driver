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
  earnings/statement.tsx  scorecard.tsx  documents/index.tsx  checkin.tsx            ← wave-2 placeholders
  intercity/index.tsx  khat/index.tsx  fleet/index.tsx  ops/index.tsx                ← wave-2 placeholders
src/
  lib/                  api (tRPC + React Query), session (+ storage), guard, i18n, money, phone, fonts,
                        haptics, location(.native), alert(.native) — copied from the customer app where shared
  components/           Screen, TabBar, OtpInput, Wordmark (with the شريك tag), PlaceholderScreen
  features/auth/        AuthHeader
  features/map/         DriverMap (own puck with radar pulse, job pins, dashed route) over the customer
                        app's base map (MapLibre on web, SVG zones on native) — geo.ts + base/*
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
- **Offer** — `<OfferWatcher>` polls `partner.currentOffer` every 2 s while online and pushes
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
| `partner.goOnline` / `goOffline` | driving roles | presence in the dispatch geo index (`DispatchService.presence`) |
| `partner.currentOffer` | driving roles | open offer: zones, pins, ring, pay components, batch, kitchen state, cash to collect |
| `partner.activeJob` | driving roles | current trip: stops (merchant names, notes, cash per stop), current stop, unreachable, pay |

Pay components are named (`delivery`, `night`, `weather`, `batch_bonus` 70 %, `pickup_compensation`,
`fare` after the open take, `tip`, …) and labelled client-side with `partner.pay_<key>`.

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

Personas (dev OTP shown on the OTP screen): courier `0770 111 0001` (bike, 12,500 · 6 طلبات today,
45,000 cash held), tuktuk `0770 111 0002`, intercity `0770 111 0003`, khat `0770 111 0004`,
customer-only `0770 111 0009`. Food dispatch runs suggest-only in the demo so the three orders
waiting at مشويات الحاج كريم keep the demand hint at "الطلب عالي بالمركز"; demo offers go out
through the dispatcher override, the tuktuk ride through the real wave-1 broadcast.

## Known gaps (wave 1)

- Background location and a real heartbeat endpoint: presence is refreshed by re-sending
  `partner.goOnline` every 30 s while the app is open.
- Offer sound on native (expo-av not yet a dependency: `src/lib/alert.native.ts`); call/chat are
  stubs (toast); SOS is a stub button.
- The handover photo stays on the device (upload + `handover.photoUrl` in wave 2).
- Realtime push for offers is polling (2 s) until the realtime channel ships.
- The customer's first name is not on the job card (no vault read for drivers yet).
