import { describe, expect, it } from 'vitest';
import type { OrderTracking } from '@driver/contracts';
import { laterBaghdadDay, lostItemUntil, rideNearAt, tripCodeOf } from './safety';

const T0 = new Date('2026-10-03T19:30:00Z');
const H = 3_600_000;
const PIN = { lat: 32.91, lng: 45.06 };

type Trip = NonNullable<OrderTracking['trip']>;

function view(type: 'ride' | 'food', trip: Partial<Trip> | null, withCourier = true): OrderTracking {
  return {
    order: { id: 'ord_1', type, state: 'matched' } as OrderTracking['order'],
    items: [],
    merchant: null,
    dropoff: null,
    trip: trip
      ? {
          id: 'trp_1',
          state: 'accepted',
          acceptedAt: T0,
          completedAt: null,
          stops: [
            { id: 's1', seq: 0, type: 'pickup', state: 'pending', mine: true, target: PIN, courierNearAt: null, arrivedAt: null, completedAt: null },
            { id: 's2', seq: 1, type: 'dropoff', state: 'pending', mine: true, target: PIN, courierNearAt: null, arrivedAt: null, completedAt: null },
          ],
          dropsBeforeMine: 0,
          unreachable: null,
          vertical: 'taxi',
          ...trip,
        }
      : null,
    courier: withCourier ? ({ firstName: 'حيدر' } as OrderTracking['courier']) : null,
    reassigning: false,
    promisedAt: null,
    pointsEarned: null,
    serverNow: T0,
  };
}

describe('the night trip code on the rider’s screen (s1)', () => {
  it('shows the server’s code until the rider is in', () => {
    const v = view('ride', { startCode: '4821' });
    for (const phase of ['searching', 'to_pickup', 'at_pickup'] as const) expect(tripCodeOf(v, phase)).toBe('4821');
    expect(tripCodeOf(v, 'on_the_way')).toBeNull();
    expect(tripCodeOf(v, 'done')).toBeNull();
  });
  it('nothing without a code, on food, or with a malformed one', () => {
    expect(tripCodeOf(view('ride', {}), 'to_pickup')).toBeNull();
    expect(tripCodeOf(view('food', { startCode: '4821' }), 'to_pickup')).toBeNull();
    expect(tripCodeOf(view('ride', { startCode: '48' }), 'to_pickup')).toBeNull();
    expect(tripCodeOf(undefined, 'to_pickup')).toBeNull();
  });
});

describe('«السايق قريب، اطلع هسة» (d3)', () => {
  it('reads the pickup’s stamp while he is on his way to me', () => {
    const near = view('ride', {});
    near.trip!.stops[0]!.courierNearAt = T0;
    expect(rideNearAt(near, 'to_pickup')).toEqual(T0);
    expect(rideNearAt(near, 'at_pickup')).toBeNull();
    expect(rideNearAt(view('ride', {}), 'to_pickup')).toBeNull();
  });
});

describe('«نسيت غرض بالسيارة؟» (s7)', () => {
  const done = (withCourier = true) => view('ride', { state: 'completed', completedAt: T0 }, withCourier);
  it('until the ride’s end + 24 h', () => {
    expect(lostItemUntil(done(), T0.getTime() + H)).toEqual(new Date(T0.getTime() + 24 * H));
    expect(lostItemUntil(done(), T0.getTime() + 24 * H)).toBeNull();
  });
  it('only on a finished ride with a driver', () => {
    expect(lostItemUntil(view('ride', {}), T0.getTime())).toBeNull();
    expect(lostItemUntil(done(false), T0.getTime())).toBeNull();
    expect(lostItemUntil(view('food', { state: 'completed', completedAt: T0 }), T0.getTime())).toBeNull();
  });
});

describe('laterBaghdadDay', () => {
  it('compares Baghdad calendar days (UTC+3)', () => {
    // 22:30 Baghdad on the 3rd vs 06:00 Baghdad on the 4th / 23:59 on the 3rd.
    expect(laterBaghdadDay(new Date('2026-10-04T03:00:00Z'), T0.getTime())).toBe(true);
    expect(laterBaghdadDay(new Date('2026-10-03T20:59:00Z'), T0.getTime())).toBe(false);
  });
});
