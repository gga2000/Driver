import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { transformer, type AppRouter } from '@driver/contracts';
import { isAuthError, type SessionStore } from './session';

/**
 * tRPC links and error helpers, free of React Native imports so they run in plain Node tests.
 */

/**
 * Queries go as GET with their input in the URL; proxies refuse URLs past about 8 KB, and a big basket
 * with Arabic notes (each letter 6 characters once encoded) gets there (audit FOOD-18). Above this many
 * encoded characters of input a query is sent as POST instead; smaller batches are split to stay under.
 */
export const URL_RULES = { maxUrlLength: 6_000, maxGetInputLength: 4_000 } as const;

/** True when this query's input is too long for a URL (it then goes as POST). */
export function inputTooLongForUrl(op: { type: string; input: unknown }, limit: number = URL_RULES.maxGetInputLength): boolean {
  if (op.type !== 'query' || op.input === undefined) return false;
  return encodeURIComponent(JSON.stringify(transformer.serialize(op.input))).length > limit;
}

/** True for errors the server answered with 401 (expired/invalid token). */
export function isUnauthorized(err: unknown): boolean {
  return isAuthError(err);
}

/**
 * On a 401, refresh the session once (single-flight inside the store) and replay the operation;
 * the replay picks up the new token because the batch link reads headers per request.
 * `identity.refresh` itself is never retried (that would loop on a revoked refresh token).
 */
export function authRetryLink(store: SessionStore): TRPCLink<AppRouter> {
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
              const canRetry = !retried && op.path !== 'identity.refresh' && isUnauthorized(err) && store.getSnapshot().session !== null;
              if (!canRetry) {
                observer.error(err);
                return;
              }
              retried = true;
              void store.refresh().then((ok) => {
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

/**
 * Iraqi-Arabic message for any API error: the server's envelope (`message_ar`) when present,
 * otherwise the network message. `fallback` is the copy for "no response at all".
 */
export function apiErrorMessage(err: unknown, fallback: string, locale: 'ar-IQ' | 'en' = 'ar-IQ'): string {
  if (err instanceof TRPCClientError) {
    const data = err.data as { message_ar?: string; message_en?: string } | undefined;
    const msg = locale === 'en' ? data?.message_en : data?.message_ar;
    if (msg) return msg;
  }
  return fallback;
}

/** Stable error code from the envelope (`otp_invalid`, `rate_limited`…), if any. */
export function apiErrorCode(err: unknown): string | null {
  if (err instanceof TRPCClientError) {
    const code = (err.data as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** `retryAfterSec` from rate-limit errors. */
export function apiRetryAfter(err: unknown): number | null {
  if (err instanceof TRPCClientError) {
    const s = (err.data as { retryAfterSec?: unknown } | undefined)?.retryAfterSec;
    return typeof s === 'number' ? s : null;
  }
  return null;
}
