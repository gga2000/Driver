import { DEV_TOOLS } from './env';

/** Demo/screenshot web builds only: pretend to be this store build (`scripts/shots/30-update.mjs`). */
export const DEMO_BUILD_KEY = 'driver.partner.demo-build';

/**
 * The web build is not a store build and sends no version (the server never refuses it). Demo web
 * builds (`DEV_TOOLS`) may stand in for one, so the «حدّث التطبيق» page can be seen end to end.
 */
export function nativeBuildVersion(): string | null {
  if (!DEV_TOOLS) return null;
  try {
    return globalThis.localStorage?.getItem(DEMO_BUILD_KEY) ?? null;
  } catch {
    return null;
  }
}
