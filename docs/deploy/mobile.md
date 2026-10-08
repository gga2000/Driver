# Mobile apps: EAS builds, Google Play first, iOS ready

Three Expo apps, each with its own store listing:

| App | Folder | Android package / iOS bundle id | Store name | EAS slug |
| --- | --- | --- | --- | --- |
| Customer | `apps/customer` | `iq.driver.customer` | درايفر | `driver-customer` |
| Partner (couriers, drivers, fleet, field ops) | `apps/partner` | `iq.driver.partner` | درايفر بارتنر | `driver-partner` |
| Merchant (restaurants, shops) | `apps/merchant` | `iq.driver.merchant` | درايفر للمطاعم | `driver-merchant` |

**Identifiers.** We keep the `iq.driver.*` ids already in each `app.json` rather than switching to
`com.driver.app` / `com.driver.partner` / `com.driver.merchant`: they were consistent across the three
apps and both platforms, and short generic `com.driver.*` names are very likely already taken on Google
Play (package names are global and permanent). An id never needs to match a domain you own. Once the
first build is uploaded to Play, the package name **can never change** — decide before step 4 below.
(The slugs were Arabic, which EAS does not accept; they are now ASCII. The visible app names are
unchanged.)

## Expo SDK

All three apps are on **Expo SDK 57** (React Native 0.86, React 19.2, expo-router 57, Reanimated 4.5 with
react-native-worklets), new architecture only. They moved from SDK 52 one major at a time on 2026-10-06
(J2, `docs/superpowers/plans/2026-10-06-j2-expo-upgrade.md`). Rules for the next upgrade:

- Keep the three apps on the same SDK. In each app: `npx expo install expo@^<N>.0.0`, then
  `npx expo install --fix`; never type versions by hand. The repo pins exact versions, so replace any
  `~`/`^` that `expo install` writes with the installed version, and keep `packages/ui`'s peer and dev
  versions equal to the apps'.
- `expo install` rewrites `app.json` in long form when it adds a config plugin: keep the compact style
  and only add the plugin line.
- `npx expo-doctor` must pass in every app (it did, 21/21, on SDK 57).
- Sounds use **expo-audio** (expo-av is gone since SDK 55), never with background playback. The
  customer and partner apps record voice notes (microphone only while the button is held,
  `recordAudioAndroid: true`); the merchant app asks for no microphone.
- The **partner** app is the only one with background location: `expo-location` with
  `isAndroidBackgroundLocationEnabled` and `isAndroidForegroundServiceEnabled` (a foreground-service
  notification «درايفر بارتنر شغّال» while a shift or a job is on), driven by `expo-task-manager`. Play
  asks to justify both: see "Background location on Google Play" below.
- `expo prebuild` now clears `android/` and `ios/` by default; they are generated, never committed.
- The store Expo Go app runs only the newest SDK; real testing is on a development build (`expo run:android` / `expo run:ios`, or the EAS `preview` build below).

## Files

- `apps/<app>/eas.json` — build profiles:
  - **preview**: an installable **APK** for testers (`distribution: internal`), no store needed — you
    can share it today, before the Play account exists. OTA channel `preview`.
  - **production**: an **AAB** for Google Play (and an App Store build for iOS), build number
    incremented by EAS on every build, OTA channel `production`.
  - `submit.production.android`: upload to the Play **internal testing** track as a draft. The launch
    plan releases through the **closed testing** track instead (G0-3): promote each upload from
    internal to closed in the Play Console, or switch the profile's `track` to `alpha` (closed) once
    the apps exist.
- `apps/<app>/app.json` — `runtimeVersion: { policy: "fingerprint" }` and `updates` for EAS Update;
  `expo-updates` is a dependency of all three apps.

## Versions and build numbers

| What | Where | Rule |
| --- | --- | --- |
| `version` (what users see, e.g. 1.0.0) | `app.json` | bump by hand for a store release: 1.0.1 fixes, 1.1.0 features |
| Android `versionCode` / iOS `buildNumber` | kept by EAS (`appVersionSource: remote`, `autoIncrement`) | never edit; every production build gets the next number |
| `runtimeVersion` | computed (fingerprint of the native code) | decides which OTA updates a binary may take |

Set `version` to `1.0.0` in each `app.json` before the first store build.

## Over-the-air updates (EAS Update)

JavaScript-only changes (screens, text, logic) can reach installed apps without a store review:

```bash
node scripts/deploy/eas-update.mjs customer production "Fix checkout text"
```

Always publish through `scripts/deploy/eas-update.mjs` (app: `customer`, `partner` or `merchant`;
channel: `preview` or `production`), **never a bare `eas update`**: the script ties the EAS environment
to the channel, so the update takes the server address set on expo.dev (never one typed on this
computer), and the app refuses the bundle if that address is missing or not https. A bare
`eas update` skips that check. `EXPO_PUBLIC_API_URL` (and `EXPO_PUBLIC_SHARE_BASE_URL` for the
customer app) must be set in **each** expo.dev environment, preview and production (step 3 below).

The **fingerprint** runtime policy makes this safe: when a change touches native code (a new native
library, a permission, an SDK upgrade) the fingerprint changes, old binaries no longer match, and they
simply do not take the update — that change needs a new store build. Apps check for an update on
launch and apply it on the next launch (`checkAutomatically: ON_LOAD`, no blocking wait).
Roll back a bad update: `eas update:republish --channel production` with the previous group, or
`eas update:roll-back-to-embedded` (runbook).

## Launch plan for Google Play (G0-2, G0-3)

- **One account: the organisation's** (decision D-25, recommended answer). An app id
  (`iq.driver.customer/partner/merchant`) created in a Play account can only be transferred, never
  created again, so **nothing is created in any Play account before D-28** (Mon 9 Nov), when the
  organisation account is verified (company registration → certificate → D-U-N-S → Play account).
- **Until then, every test build is an EAS internal-distribution APK** (`eas build --platform android
  --profile preview`), sent to phones on WhatsApp. Play's "internal app sharing" is not used: it needs
  the app created in an account.
- **D-28**: the three apps created in the organisation account. **D-27**: the first closed-track
  release of each app, the partner app's with the background-location declaration. **D-21**: closed
  track live (12+ testers) and the declaration accepted. Until it is accepted, couriers keep the APK.

### Native modules in the first partner development build

A development or preview build carries the native code; JavaScript reaches it later over the air, but a
new native module needs a new build (its fingerprint changes). The first partner build must already
contain everything the launch partner app uses natively:

| Module | Why |
| --- | --- |
| `expo-location` + `expo-task-manager` | location while a shift or job is on, also with the app closed (foreground service) |
| `expo-notifications` | job offers with their own sound (`offer.wav`, channel `offers`) |
| `expo-audio` | the offer sound and voice notes |
| `expo-image-picker` | delivery photo, documents, daily check-in selfie |
| `expo-brightness@57.0.2` | added by the partner app in PR #15: install it before that build |
| `expo-secure-store`, `expo-sharing`, `expo-updates` | sign-in tokens, sharing, over-the-air updates |

Check with `npx expo-doctor` in `apps/partner` before building; after PR #15 is merged, `package.json`
is the full list.

### Background location on Google Play (G0-2)

Play reviews apps that use location in the background and a foreground service of type `location`.
The partner app's first closed-track release (D-27) goes with the **Location permissions** declaration
in Play Console → App content. Prepared by D-35 (Mon 2 Nov):

1. **The in-app explanation** (prominent disclosure), shown before Android's own permission screen:
   «خلّي موقعك شغّال حتى لو سدّيت التطبيق» — «حتى توصلك طلبات وانت مسدّ التطبيق، ويشوف الزبون وين صرت،
   نحتاج موقعك طول ما انت شغّال أو عندك طلب. أول ما تطفي الشغل نوقف. بالشاشة الجاية اختار «السماح طوال
   الوقت».» (`partner.bg_location_disclosure_*`). It exists in the app.
2. **A short video** (30 s or less, on a real phone after the partner phones arrive, G0-1): sign in as
   a courier → turn work on → the explanation → Android's "Allow all the time" → the foreground
   notification → a job offer arriving with the app in the background → turn work off and the
   notification goes. Upload it unlisted (YouTube) and paste the link in the form.
3. **The form text** (Play asks in English):
   - *Core feature that uses location in the background:* "Couriers and drivers receive delivery and
     ride jobs near them, and customers follow their order on a live map. While a courier or driver
     has turned work on, or has a job in progress, the app shares their location even when it is
     closed, so offers reach them and the customer's map stays right. Location stops when they turn
     work off."
   - *Why foreground-only location is not enough:* "Couriers keep the app in the background while
     riding and using maps, so job offers and the customer's live tracking would stop."
   - *Foreground service type `location`:* the same feature; the notification is visible for as long
     as location is shared.
4. **Data safety**: precise location is collected (required for partners, used for the app's function:
   offers, the customer's live map, the trip record); fill the form from the privacy policy, so the two
   say the same.

The customer and merchant apps use no background location and need no declaration.

## When the Google Play account exists — step by step

You need: an Expo account (free, <https://expo.dev/signup>), the Google Play Console account ($25 once),
Node 22 + pnpm and the repository on a computer.

1. `npm install -g eas-cli` and `eas login`.
2. In each app folder (`cd apps/customer`, then partner, merchant): `eas init` — it creates the project
   on expo.dev and writes its id into `app.json` (commit that). Then `eas update:configure` (adds the
   update URL to `app.json`; commit).
3. Set the build-time values on expo.dev → project → **Environment variables**, environment
   **production** (and **preview**):
   - `EXPO_PUBLIC_API_URL` = `https://driver-api.fly.dev/trpc` (later your domain)
   - `EXPO_PUBLIC_SHARE_BASE_URL` = the customer web address (customer app only)
   - `EXPO_PUBLIC_SENTRY_DSN` = that app's Sentry DSN (optional; crash reports stay off without it —
     [hosting.md](hosting.md) "Logs and errors")
4. First build: `eas build --platform android --profile production`. EAS asks to generate the Android
   signing key — say **yes** (EAS stores it; download a copy from expo.dev → Credentials and keep it in
   your password manager). Wait ~15 minutes; download the `.aab`.
5. Play Console → **Create app** (name, Arabic default language, app, free) → **Testing → Internal
   testing** → create a release → **upload the .aab by hand** (Google requires the very first upload
   to be manual) → add testers' emails → roll out. Fill in the store listing, content rating, data
   safety (location, phone number, photos) and the privacy policy URL as Play asks.
6. Automate later uploads: Play Console → Setup → API access → create a **service account** with
   release permissions, download its JSON key, save it as
   `apps/<app>/google-play-service-account.json` (git-ignored, never commit). Then
   `eas submit --platform android --profile production --latest` uploads to internal testing as a
   draft; promote to closed / open testing / production in the Play Console.
7. Repeat 4–6 for partner and merchant.

New personal Play accounts must run a **closed test with at least 12 testers for 14 days** before they
can publish to production; start that early (couriers and restaurant staff are perfect testers). The
launch plan uses the organisation account (above), which has no such wait; the closed track with 12+
testers is still the launch's own rehearsal (D-21).

Before the Play account: `eas build --platform android --profile preview` gives an APK link you can
send to testers on WhatsApp (they allow "install unknown apps" once).

## iOS (ready, when you have an Apple developer account, $99/year)

`eas build --platform ios --profile production` (EAS creates certificates and profiles for you), then
`eas submit --platform ios --profile production` (EAS asks for the App Store Connect app once). Bundle
ids are in `app.json`; nothing else to change.

## Cost

EAS **Free** plan: 30 builds a month (low-priority queue) and updates for 1,000 monthly users — enough
for launch. Starter ($19/month) when builds queue too long or users pass 1,000.
