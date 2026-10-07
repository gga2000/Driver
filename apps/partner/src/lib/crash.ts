import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createCrashReporter, installCrashHandlers } from '@driver/contracts/crash-report';

const dev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * Crash reports (docs/deploy/hosting.md, "Logs and errors"): off until `EXPO_PUBLIC_SENTRY_DSN` is
 * set at build time, then unhandled errors, unhandled promise rejections and the root error
 * boundary's crashes go to Sentry over plain fetch, scrubbed of phones, codes and tokens
 * (`@driver/contracts/crash-report`). No SDK, no native module: works in Expo Go and on the web.
 */
export const crashReporter = createCrashReporter({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || (dev ? 'development' : 'production'),
  release: process.env.EXPO_PUBLIC_APP_RELEASE || `iq.driver.partner@${Constants.expoConfig?.version ?? '0.0.0'}`,
  app: 'partner',
  os: Platform.OS,
});

/** Hooks the global handlers once (the root layout calls it at import, like `enforceRtl`). */
let started = false;
export function startCrashReports(): void {
  if (started) return;
  started = true;
  // Hermes' rejection tracker belongs to RN's LogBox in development.
  installCrashHandlers(crashReporter, { hermesRejections: !dev });
}
