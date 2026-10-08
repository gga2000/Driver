import * as Application from 'expo-application';

/**
 * The store version baked into this build (`1.0.3`), sent as `x-driver-app` on every call so the
 * server can ask an old build to update (CORE-05, `docs/api/app-version.md`). Not the OTA update's
 * version: an OTA update can't fix a build the server refuses.
 */
export function nativeBuildVersion(): string | null {
  return Application.nativeApplicationVersion ?? null;
}
