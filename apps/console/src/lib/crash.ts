import { createCrashReporter, installCrashHandlers } from '@driver/contracts/crash-report';
import pkg from '../../package.json';

/**
 * Console crash reports (docs/deploy/hosting.md, "Logs and errors"): off until
 * `NEXT_PUBLIC_SENTRY_DSN` is set at build time, then the page-level and global error boundaries
 * and the window's unhandled errors and rejections go to Sentry over plain fetch, scrubbed of phones,
 * codes and tokens (`@driver/contracts/crash-report`). No SDK.
 */
export const crashReporter = createCrashReporter({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  release: process.env.NEXT_PUBLIC_APP_RELEASE || `driver-console@${pkg.version}`,
  app: 'console',
  os: 'web',
});

let started = false;
/** The window's `error` / `unhandledrejection` listeners, once per page (browser only). */
export function startCrashReports(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  installCrashHandlers(crashReporter, { target: window });
}
