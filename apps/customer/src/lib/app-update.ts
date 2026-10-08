import { useSyncExternalStore } from 'react';
import { APP_HEADER, appHeader, isUpdateRequiredError } from '@driver/contracts';

/**
 * CORE-05 (docs/api/app-version.md "Apps"): every call says which build is calling
 * (`x-driver-app: customer/1.0.3`, the store version baked into the binary), and once the server
 * answers `update_required` the app shows one «حدّث التطبيق» screen and stops calling.
 */

/** Where «حدّث التطبيق» sends the customer (Play; the app id never changes). */
export const STORE_URL = 'market://details?id=iq.driver.customer';

/**
 * The build header for one call: native builds only (the web build sends nothing, so it is never
 * turned away), and nothing when the binary has no version (a dev client without one).
 */
export function appBuildHeaders(os: string, nativeVersion: string | null | undefined): Record<string, string> {
  if (os === 'web' || !nativeVersion) return {};
  return { [APP_HEADER]: appHeader('customer', nativeVersion) };
}

let required = false;
const listeners = new Set<() => void>();

/** Latched for the life of this process: only a new build (a restart on it) clears it. */
export const appUpdate = {
  /** Called on every API error; flags the app once the server said this build is too old. */
  noteError(err: unknown): void {
    if (required || !isUpdateRequiredError(err)) return;
    required = true;
    listeners.forEach((l) => l());
  },
  isRequired: (): boolean => required,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Tests only. */
  reset(): void {
    required = false;
  },
};

export function useUpdateRequired(): boolean {
  return useSyncExternalStore(appUpdate.subscribe, appUpdate.isRequired, appUpdate.isRequired);
}
