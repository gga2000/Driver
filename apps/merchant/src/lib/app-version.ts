import type { TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { APP_HEADER, appHeader, isUpdateRequiredError, type AppRouter } from '@driver/contracts';
import type { LiveSubscriptionHandlers } from '@driver/contracts/live-client';

/**
 * CORE-05 in the merchant app (docs/api/app-version.md "Apps"): every call carries
 * `x-driver-app: merchant/<store version>`, and once the server answers `update_required` the whole
 * app turns into the «حدّث التطبيق» screen (UpdateRequired) until it restarts: no retries, no live
 * stream. Pure (no react-native imports) so it runs in plain Node tests.
 */

/** Play listing of this app (iq.driver.merchant: never changes). */
export const STORE_URL = 'market://details?id=iq.driver.merchant';
export const STORE_WEB_URL = 'https://play.google.com/store/apps/details?id=iq.driver.merchant';

const DEMO_BUILD = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/**
 * The build this app reports. Native: the store version baked into the binary. Web sends nothing,
 * except a dev-tools web export opened with `?demoBuild=0.0.1` (screenshots of the update screen
 * against a demo API started with a minimum above it).
 */
export function resolveBuild(opts: { os: string; nativeVersion: string | null; devTools: boolean; search: string }): string | null {
  if (opts.os !== 'web') return opts.nativeVersion || null;
  if (!opts.devTools) return null;
  const demo = new URLSearchParams(opts.search).get('demoBuild');
  return demo && DEMO_BUILD.test(demo) ? demo : null;
}

/** The header on every tRPC call and the live stream; empty when there is no build to report. */
export function appBuildHeaders(build: string | null): Record<string, string> {
  return build ? { [APP_HEADER]: appHeader('merchant', build) } : {};
}

// ───────────────────────── the app-wide switch ─────────────────────────

let required = false;
const listeners = new Set<() => void>();

/** Once set it stays set: only a restart on a new build clears it. */
export function markUpdateRequired(): void {
  if (required) return;
  required = true;
  for (const l of [...listeners]) l();
}

export function isUpdateRequired(): boolean {
  return required;
}

export function subscribeUpdateRequired(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Tests only. */
export function resetUpdateRequiredForTests(): void {
  required = false;
}

/** Marks the app when any call (query, mutation, imperative, the stream token) is refused as too old. */
export function updateRequiredLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) =>
        next(op).subscribe({
          next: (v) => observer.next(v),
          complete: () => observer.complete(),
          error: (err) => {
            if (isUpdateRequiredError(err)) markUpdateRequired();
            observer.error(err);
          },
        }),
      );
}

/** React Query retry: twice at most, never a 401 (the auth link already retried) nor an old build. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (isUpdateRequiredError(err) || isUpdateRequired()) return false;
  const status = (err as { data?: { httpStatus?: unknown } } | null)?.data?.httpStatus;
  return failureCount < 2 && status !== 401;
}

/**
 * The live channel's handlers with the update stop in front: `update_required` marks the app and
 * calls `stop` (the reconnect loop ends) instead of reaching the connection's backoff.
 */
export function stopLiveOnUpdateRequired(handlers: LiveSubscriptionHandlers, stop: () => void): LiveSubscriptionHandlers {
  return {
    ...handlers,
    onError: (err: unknown) => {
      if (isUpdateRequiredError(err)) {
        markUpdateRequired();
        stop();
        return;
      }
      handlers.onError(err);
    },
  };
}
