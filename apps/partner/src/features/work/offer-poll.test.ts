import { LIVE_RULES } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { OFFER_POLL_DOWN_MS, offerPollMs, workPollMs } from './offer-poll';

describe('offer poll (speed audit, day one)', () => {
  it('stays slow while the stream is live', () => {
    expect(offerPollMs('live')).toBe(LIVE_RULES.safetyPollMs);
  });

  it('looks every 5 s while the stream is down, leaving most of a 15 s food offer to answer', () => {
    for (const m of ['connecting', 'fallback', 'stopped'] as const) expect(offerPollMs(m)).toBe(OFFER_POLL_DOWN_MS);
    expect(15_000 - OFFER_POLL_DOWN_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('l2: low-data mode slows only the safety refetch while live, never the poll that replaces a dead stream', () => {
    const lite = (ms: number) => ms * 3;
    expect(offerPollMs('live', lite)).toBe(LIVE_RULES.safetyPollMs * 3);
    expect(workPollMs('live', lite)).toBe(LIVE_RULES.safetyPollMs * 3);
    expect(workPollMs('live')).toBe(LIVE_RULES.safetyPollMs);
    for (const m of ['connecting', 'fallback', 'stopped'] as const) {
      expect(offerPollMs(m, lite)).toBe(OFFER_POLL_DOWN_MS);
      expect(workPollMs(m, lite)).toBe(LIVE_RULES.fallbackPollMs);
    }
  });
});
