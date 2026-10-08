/**
 * A (re)connect's resync skips what was fetched in the last few seconds: opening the live order screen
 * fetches tracking and then the stream's `hello` arrives, and re-reading it at once only loaded it twice.
 * The slow safety poll still covers anything that changed in that short gap.
 */
export const RESYNC_FRESH_MS = 5_000;

/** True when a resync should re-read this query: never loaded, or older than `RESYNC_FRESH_MS`. */
export function needsResync(dataUpdatedAt: number, now: number): boolean {
  return dataUpdatedAt === 0 || now - dataUpdatedAt >= RESYNC_FRESH_MS;
}
