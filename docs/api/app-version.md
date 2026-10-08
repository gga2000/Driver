# Minimum app version (CORE-05)

Once the apps are in the stores, some fixes can't be shipped without a new build: native code, a
server change old builds can't handle, or a safety fix. The server can then turn away builds older
than a minimum, and the app shows «أكو نسخة جديدة لازم تحدّثها حتى تكمّل» with a button to the store.

## Server (built)

- `MIN_APP_VERSIONS=customer:1.0.3,partner:1.0.0,merchant:1.0.0` (Fly env). Unset means nobody is
  turned away. A malformed entry stops boot, so a typo never shuts everyone out or lets everyone in.
- Every call through `publicProcedure` from a build older than its app's minimum fails with
  `update_required` (HTTP 412, `retryHint: never`). The Arabic and English words come from
  `error.update_required`.
- `health.*` always answers, so the app can tell "update needed" from "no network".
- Calls without the header are never refused: the web apps, the Console, and builds made before the
  header existed. The first store builds must therefore send it, or they can never be made to update.
- Changing the minimum is an env change: `fly secrets set MIN_APP_VERSIONS=… --config
  deploy/fly/api.toml` (machines restart; no deploy).
- **Raising the partner minimum**: do it off-peak, after the Console shows no active jobs on old
  builds. A refused build can't send heartbeats, so the courier drops out of dispatch within 90 s
  (`PRESENCE_TTL_SEC`; at most one offer lands meanwhile and times out), but a courier in the middle of
  a job can't finish it in the app: ops finish any leftover job through the Console's staff actions.

## Apps (to wire, one change per app; owners: customer = lane C, partner, merchant)

1. Send the header on every tRPC call (and the live stream), in `src/lib/api.tsx`:

   ```ts
   import * as Application from 'expo-application'; // add expo-application (SDK 57 line) to the app
   import { APP_HEADER, appHeader } from '@driver/contracts';
   // native only; the web build sends nothing. The store version baked into the binary.
   const build = Platform.OS === 'web' ? null : Application.nativeApplicationVersion;
   headers: () => ({ ...(build ? { [APP_HEADER]: appHeader('customer', build) } : {}) /* plus the existing ones */ })
   ```

2. When any call fails with `isUpdateRequiredError(err)` (from `@driver/contracts`), show one
   full-screen «حدّث التطبيق» screen with the store button (Play: `market://details?id=iq.driver.customer`),
   and stop retrying. The screen needs no network. It stays until the app restarts on a new build.

The version is the native build's version (what the store shows), not the OTA update. That is why it
comes from `expo-application`: `expo-constants`' `expoConfig.version` follows the OTA manifest. An OTA update can't fix a build the server refuses, so the minimum only goes up with a store
release.
