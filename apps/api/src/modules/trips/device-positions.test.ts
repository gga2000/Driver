import { describe, expect, it } from 'vitest';
import { offsetNorth } from './geofence.js';
import type { PositionReport } from './trips.service.js';
import { PINS, tripsHarness } from './test-harness.js';

const secondsAgo = (now: Date, s: number) => new Date(now.getTime() - s * 1000);

describe('TripsService — the device path (maps program SP4a)', () => {
  it('refuses fake, inaccurate and out-of-order fixes; stores late replays as trail only', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    const seen: PositionReport[] = [];
    h.trips.onPositionReported((r) => seen.push(r));
    const now = h.clock.now();
    const out = await h.trips.reportDevicePositions('d1', [
      { pin: offsetNorth(PINS.kitchen, 400), at: secondsAgo(now, 30), accuracyM: 12 },
      { pin: offsetNorth(PINS.kitchen, 300), at: secondsAgo(now, 300), accuracyM: 10 },
      { pin: offsetNorth(PINS.kitchen, 200), at: secondsAgo(now, 20), mocked: true },
      { pin: offsetNorth(PINS.kitchen, 100), at: secondsAgo(now, 10), accuracyM: 90 },
      { pin: offsetNorth(PINS.kitchen, 40), at: now, accuracyM: 8 },
    ]);
    expect(out.rejected).toEqual([
      { index: 2, reason: 'mocked' },
      { index: 3, reason: 'inaccurate' },
    ]);
    expect(out.armed).toEqual([{ tripId: t.id, stopId: t.stops[0]!.id, distanceM: 40 }]);
    expect(h.repo.trail.map((p) => p.at.getTime())).toEqual([secondsAgo(now, 300).getTime(), secondsAgo(now, 30).getTime(), now.getTime()]);
    expect(seen.map((r) => r.at.getTime())).toEqual([secondsAgo(now, 30).getTime(), now.getTime()]);
    expect((await h.trips.reportDevicePositions('d1', [{ pin: PINS.kitchen, at: secondsAgo(now, 5) }])).rejected).toEqual([{ index: 0, reason: 'out_of_order' }]);
  });

  it('flags fake GPS at once and jumps at the fifth, as one event each per day', async () => {
    const h = tripsHarness();
    await h.trips.reportDevicePositions('d1', [{ pin: PINS.kitchen, at: h.clock.now(), mocked: true }]);
    await h.trips.reportDevicePositions('d1', [{ pin: PINS.kitchen, at: h.clock.now(), mocked: true }]);
    for (let i = 1; i <= 6; i++) {
      h.clock.advanceSeconds(5);
      await h.trips.reportDevicePositions('d1', [{ pin: offsetNorth(PINS.kitchen, i % 2 === 0 ? 0 : 2_000), at: h.clock.now() }]);
    }
    expect(h.events.ofType('driver.position_suspect').map((e) => e.payload['reason'])).toEqual(['mocked', 'jump']);
  });

  it('the internal path (simulator, demo seeds) is not judged', async () => {
    const h = tripsHarness();
    await h.trips.reportPosition('d1', { pin: PINS.kitchen, at: h.clock.now() });
    await h.trips.reportPosition('d1', { pin: offsetNorth(PINS.kitchen, 5_000), at: h.clock.now() });
    expect(h.repo.trail).toHaveLength(2);
    expect(h.events.ofType('driver.position_suspect')).toHaveLength(0);
  });
});
