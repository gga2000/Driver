import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { useSyncExternalStore } from 'react';
import { APP_HEADER, appHeader, isUpdateRequiredError, type AppRouter } from '@driver/contracts';

/**
 * CORE-05 «حدّث التطبيق»: every call carries `x-driver-app: partner/<store version>`; once the server
 * answers `update_required`, this build is done talking to it. Every later call fails at once with
 * that same answer (no network, no retries), and the app shows the full-screen update page until it
 * is restarted on a new build. Free of React Native imports so it runs in plain Node tests.
 */

let refused: unknown = null;
const listeners = new Set<() => void>();

/** The header for this build, or nothing (web, or a build that can't say its version). */
export function appBuildHeaders(version: string | null): Record<string, string> {
  return version ? { [APP_HEADER]: appHeader('partner', version) } : {};
}

export function isUpdateRequired(): boolean {
  return refused !== null;
}

function markUpdateRequired(err: unknown): void {
  if (refused) return;
  refused = err;
  for (const l of listeners) l();
}

/** True once the server has said this build must be updated. */
export function useUpdateRequired(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isUpdateRequired,
    isUpdateRequired,
  );
}

/** Notices `update_required` on any call, and from then on answers every call with it locally. */
export function updateGateLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        if (refused) {
          observer.error(refused instanceof TRPCClientError ? refused : TRPCClientError.from(refused as Error));
          return;
        }
        const sub = next(op).subscribe({
          next: (v) => observer.next(v),
          complete: () => observer.complete(),
          error: (err) => {
            if (isUpdateRequiredError(err)) markUpdateRequired(err);
            observer.error(err);
          },
        });
        return () => sub.unsubscribe();
      });
}

/** Tests only. */
export function resetUpdateRequiredForTests(): void {
  refused = null;
}
