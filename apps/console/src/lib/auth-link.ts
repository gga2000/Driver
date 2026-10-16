import type { TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '@driver/contracts';

export interface AuthRetryDeps {
  /** True for a 401 (expired or revoked token). */
  isAuthError(err: unknown): boolean;
  /** Is anyone signed in (no point refreshing a signed-out tab)? */
  hasSession(): boolean;
  /** Single-flight refresh; true when a fresh token is stored. */
  refresh(): Promise<boolean>;
}

/**
 * CON-01: on a 401, renew the session once and replay the call; the replay picks up the new token
 * because the batch link reads its headers per request. `identity.refresh` itself is never retried
 * (a revoked refresh token would loop), and a second 401 after a refresh goes to the caller.
 */
export function authRetryLink(deps: AuthRetryDeps): TRPCLink<AppRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        let sub: { unsubscribe(): void } | null = null;
        let retried = false;
        let closed = false;
        const run = () => {
          sub = next(op).subscribe({
            next: (v) => observer.next(v),
            complete: () => observer.complete(),
            error: (err) => {
              const canRetry = !retried && op.type !== 'subscription' && op.path !== 'identity.refresh' && deps.isAuthError(err) && deps.hasSession();
              if (!canRetry) {
                observer.error(err);
                return;
              }
              retried = true;
              void deps.refresh().then((ok) => {
                if (closed) return;
                if (ok) run();
                else observer.error(err);
              });
            },
          });
        };
        run();
        return () => {
          closed = true;
          sub?.unsubscribe();
        };
      });
}
