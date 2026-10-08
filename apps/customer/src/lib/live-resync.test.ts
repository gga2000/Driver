import { describe, expect, it } from 'vitest';
import { needsResync, RESYNC_FRESH_MS } from './live-resync';

describe('needsResync', () => {
  const now = 1_000_000;
  it('re-reads a query that never loaded', () => expect(needsResync(0, now)).toBe(true));
  it('keeps data fetched just before the stream said hello', () => expect(needsResync(now - 1_200, now)).toBe(false));
  it('re-reads data older than the fresh window', () => expect(needsResync(now - RESYNC_FRESH_MS, now)).toBe(true));
});
