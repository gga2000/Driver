import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import type { SupportService } from '../support/index.js';
import { PINS, tripsHarness } from '../trips/test-harness.js';
import { TRAIL_PURGE_BATCH, TrailRetention } from './trail-retention.js';

const DAY_MS = 86_400_000;

describe('TrailRetention (decision D6)', () => {
  it('deletes trail points older than 30 days, keeping trips with an open incident', async () => {
    const h = tripsHarness('2026-09-01T09:00:00Z');
    const kept = await h.acceptedTrip();
    await h.trips.reportPosition('d1', { tripId: kept.id, pin: PINS.kitchen, at: h.clock.now() });
    await h.trips.reportPosition('d9', { pin: PINS.home, at: h.clock.now() });
    const now = new FakeClock(new Date(h.clock.now().getTime() + 31 * DAY_MS).toISOString());
    await h.trips.reportPosition('d9', { pin: PINS.home, at: now.now() });
    const support = { openIncidentTripIds: async () => [kept.id] } as unknown as SupportService;
    const retention = new TrailRetention(h.trips, support, now);
    expect(await retention.tick()).toBe(1);
    expect(h.repo.trail.map((p) => p.tripId ?? p.driverId)).toEqual([kept.id, 'd9']);
    expect(await h.trips.lastPosition(kept.id)).not.toBeNull();
    expect(await retention.tick()).toBe(0);
  });

  it('keeps deleting in batches until nothing old is left', async () => {
    const h = tripsHarness('2026-09-01T09:00:00Z');
    for (let i = 0; i < TRAIL_PURGE_BATCH + 3; i++) {
      h.clock.advance(1);
      await h.trips.reportPosition('d9', { pin: PINS.home, at: h.clock.now() });
    }
    const later = new FakeClock(new Date(h.clock.now().getTime() + 31 * DAY_MS).toISOString());
    const support = { openIncidentTripIds: async () => [] } as unknown as SupportService;
    expect(await new TrailRetention(h.trips, support, later).tick()).toBe(TRAIL_PURGE_BATCH + 3);
    expect(h.repo.trail).toHaveLength(0);
  });
});
