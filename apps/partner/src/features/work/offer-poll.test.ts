import { LIVE_RULES } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { OFFER_POLL_DOWN_MS, offerPollMs } from './offer-poll';

describe('offer poll (speed audit, day one)', () => {
  it('stays slow while the stream is live', () => {
    expect(offerPollMs('live')).toBe(LIVE_RULES.safetyPollMs);
  });

  it('looks every 5 s while the stream is down, leaving most of a 15 s food offer to answer', () => {
    for (const m of ['connecting', 'fallback', 'stopped'] as const) expect(offerPollMs(m)).toBe(OFFER_POLL_DOWN_MS);
    expect(15_000 - OFFER_POLL_DOWN_MS).toBeGreaterThanOrEqual(10_000);
  });
});
