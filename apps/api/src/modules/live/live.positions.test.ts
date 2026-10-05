import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Trip } from '@driver/contracts';
import { InMemoryLiveBus } from './live.bus.js';
import { PositionFanout } from './live.positions.js';

const at = new Date('2026-10-04T09:00:00Z');
const stop = (id: string, orderId: string, type: 'pickup' | 'dropoff', state = 'pending') =>
  ({ id, orderId, type, state }) as unknown as Trip['stops'][number];
function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    cityId: 'aziziyah',
    courierId: 'd1',
    state: 'en_route_to_pickup',
    acceptedAt: at,
    stops: [
      stop('s1', 'o1', 'pickup'),
      stop('s2', 'o1', 'dropoff'),
      stop('s3', 'o2', 'pickup'),
      stop('s4', 'o2', 'dropoff'),
    ],
    ...over,
  } as unknown as Trip;
}

const report = (n: number, tripIds = ['t1']) => ({
  driverId: 'd1',
  pin: { lat: n, lng: 45.07 },
  at,
  bearing: null,
  speedKmh: 20,
  tripIds,
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('courier positions on the live channel', () => {
  it('throttles to one fix per 2 s per driver; the newest fix of a burst goes out when the window ends', async () => {
    vi.useFakeTimers({ now: at });
    const bus = new InMemoryLiveBus(true);
    const t = trip();
    const p = new PositionFanout(bus, { get: async () => t }, () => Date.now());
    p.report(report(1));
    p.report(report(2));
    p.report(report(3));
    await flush();
    const sent = () =>
      bus.published
        .filter((x) => x.channel === 'order:o1')
        .map((x) => (x.event as { pin: { lat: number } }).pin.lat);
    expect(sent()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sent()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(2);
    await flush();
    expect(sent()).toEqual([1, 3]);
    // Two orders on the trip: each gets it; the city board gets a pin.
    expect(bus.published.filter((x) => x.channel === 'order:o2')).toHaveLength(2);
    expect(
      bus.published.filter((x) => x.channel === 'city:aziziyah' && x.event.type === 'driver_pin'),
    ).toHaveLength(2);
    p.close();
  });

  it('only inside the sharing window: not before accept, not after this customer’s drop-off, not in a hidden trip state', async () => {
    const bus = new InMemoryLiveBus(true);
    let t = trip({ acceptedAt: null });
    let now = 0;
    const p = new PositionFanout(bus, { get: async () => t }, () => (now += 10_000));
    p.report(report(1));
    await flush();
    expect(bus.published.filter((x) => x.event.type === 'position')).toEqual([]);

    t = trip({
      stops: [
        stop('s1', 'o1', 'pickup', 'completed'),
        stop('s2', 'o1', 'dropoff', 'completed'),
        stop('s3', 'o2', 'pickup', 'completed'),
        stop('s4', 'o2', 'dropoff'),
      ],
    });
    p.report(report(2));
    await flush();
    expect(bus.published.filter((x) => x.event.type === 'position').map((x) => x.channel)).toEqual([
      'order:o2',
    ]);

    t = trip({ state: 'completed' });
    const before = bus.published.length;
    p.report(report(3));
    await flush();
    expect(bus.published.slice(before).filter((x) => x.event.type === 'position')).toEqual([]);
  });

  it('a trip that is not his publishes nothing; an idle driver is a city-less pin', async () => {
    const bus = new InMemoryLiveBus(true);
    let now = 0;
    const p = new PositionFanout(
      bus,
      { get: async () => trip({ courierId: 'someone_else' }) },
      () => (now += 10_000),
    );
    p.report(report(1));
    await flush();
    expect(bus.published).toEqual([]);
    p.report(report(2, []));
    await flush();
    expect(bus.published.map((x) => [x.channel, x.event.type])).toEqual([['city:*', 'driver_pin']]);
  });

  it('carries each order’s ETA; a failing ETA never holds the position back', async () => {
    const bus = new InMemoryLiveBus(true);
    const t = trip();
    const eta = new Date('2026-10-04T09:12:00Z');
    const p = new PositionFanout(bus, { get: async () => t }, () => at.getTime(), 2_000, async (orderId) => {
      if (orderId === 'o2') throw new Error('no route');
      return { at: eta, basis: 'road' };
    });
    p.report(report(1));
    await flush();
    const ev = (channel: string) => bus.published.find((x) => x.channel === channel)?.event as Record<string, unknown> | undefined;
    expect(ev('order:o1')).toMatchObject({ type: 'position', etaAt: eta, etaBasis: 'road' });
    expect(ev('order:o2')).toMatchObject({ type: 'position' });
    expect(ev('order:o2')).not.toHaveProperty('etaAt');
    p.close();
  });
});
