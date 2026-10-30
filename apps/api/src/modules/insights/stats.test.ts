import { describe, expect, it } from 'vitest';
import { LATE_PROMISE_MEMO, type LedgerEvent } from '@driver/contracts';
import { decodeRoad, savedOffBills, simplifyRoad, statsMonths, STATS_MAX_MONTHS, TRIP_PATH_MAX_POINTS, tripMap, type StatsBooking, type StatsOrder, type StatsRide } from './stats.js';

const day = (iso: string) => new Date(iso);
const FROM = day('2026-08-31T21:00:00Z');
const TO = day('2026-09-30T21:00:00Z');

let seq = 0;
const ev = (e: Partial<LedgerEvent> & Pick<LedgerEvent, 'type' | 'amount'>): LedgerEvent =>
  ({ id: `ev_${++seq}`, kind: 'money', fromAccount: 'platform', toAccount: 'customer:me', occurredAt: day('2026-09-10T10:00:00Z'), memo: null, postingGroupId: null, orderId: null, tripId: null, ...e }) as LedgerEvent;

describe('savedOffBills («وفّرت», option ①)', () => {
  it('counts only what came off his bills, split by memo; what we paid back stays on its own line', () => {
    const events = [
      ev({ type: 'promo_funded', amount: 1_000, memo: 'deal:khalid' }),
      ev({ type: 'promo_funded', amount: 2_000, memo: 'promo:WELCOME' }),
      ev({ type: 'promo_funded', amount: 500, memo: 'points:o1' }),
      ev({ type: 'promo_funded', amount: 3_000, memo: 'return_bundle' }),
      ev({ type: 'credit_issued', amount: 1_500, memo: LATE_PROMISE_MEMO }),
      ev({ type: 'late_penalty_rider_credit', amount: 500 }),
      ev({ type: 'cancellation_fee', amount: 1_000 }),
    ];
    expect(savedOffBills('customer:me', events, FROM, TO)).toEqual({ totalIqd: 6_500, dealsIqd: 1_000, promosIqd: 2_000, pointsIqd: 500, returnTripIqd: 3_000, madeGoodIqd: 3_000 });
  });

  it('never counts kept change, a top-up, another account or a line outside the range', () => {
    const events = [
      ev({ type: 'cash_change_to_wallet', amount: 750 }),
      ev({ type: 'credit_issued', amount: 25_000, memo: 'topup:agent' }),
      ev({ type: 'promo_funded', amount: 1_000, toAccount: 'customer:other' }),
      ev({ type: 'promo_funded', amount: 2_000, occurredAt: day('2026-10-02T10:00:00Z') }),
    ];
    expect(savedOffBills('customer:me', events, FROM, TO)).toEqual({ totalIqd: 0, dealsIqd: 0, promosIqd: 0, pointsIqd: 0, returnTripIqd: 0, madeGoodIqd: 0 });
  });
});

describe('statsMonths', () => {
  it('oldest first, and at most two years of columns', () => {
    expect(statsMonths('2026-07', '2026-09')).toEqual(['2026-07', '2026-08', '2026-09']);
    const long = statsMonths('2020-01', '2026-09');
    expect(long).toHaveLength(STATS_MAX_MONTHS);
    expect(long.at(-1)).toBe('2026-09');
  });
});

describe('tripMap («خريطتك»)', () => {
  const HOME = { lat: 32.91, lng: 45.06 };
  const KITCHEN = { lat: 32.905, lng: 45.07 };
  const order = (id: string, type: StatsOrder['type'], merchantOrgId: string | null = null): StatsOrder => ({
    id,
    type,
    state: 'closed',
    merchantOrgId,
    placedAt: day('2026-09-10T10:00:00Z'),
    deliveredAt: day('2026-09-10T10:40:00Z'),
    scheduledFor: null,
    promisedReadyAt: null,
    promisedRideMin: null,
    lines: [],
  });
  const ride = (vertical: string, from: StatsRide['from'], to: StatsRide['to']): StatsRide => ({ vertical, driverId: 'd1', acceptedAt: null, pickupArrivedAt: null, dropoffPlaceId: null, from, to });
  const booking = (patch: Partial<StatsBooking> = {}): StatsBooking => ({
    state: 'completed',
    completedAt: day('2026-09-12T10:00:00Z'),
    cityId: 'baghdad',
    frontSeat: false,
    lapChildren: 0,
    returnDiscountIqd: 0,
    garage: { lat: 32.915, lng: 45.04 },
    farCity: { lat: 33.31, lng: 44.36 },
    ...patch,
  });

  it('groups meals per kitchen and repeat trips into one trace; points within ~100 m are the same place', () => {
    const trips = new Map<string, StatsRide>([
      ['m1', ride('food', KITCHEN, HOME)],
      ['m2', ride('food', { lat: 32.9051, lng: 45.0701 }, { lat: 32.9101, lng: 45.0599 })],
      ['m3', ride('food', KITCHEN, null)],
      ['r1', ride('tuktuk', HOME, KITCHEN)],
      ['r2', ride('taxi', HOME, KITCHEN)],
    ]);
    const map = tripMap(HOME, [order('m1', 'food', 'khalid'), order('m2', 'food', 'khalid'), order('m3', 'food', 'khalid')], [order('r1', 'ride'), order('r2', 'ride')], trips, [], FROM, TO);
    expect(map.home).toEqual(HOME);
    expect(map.kitchens).toEqual([{ ...KITCHEN, count: 3 }]);
    expect(map.traces).toEqual([
      { service: 'food', from: KITCHEN, to: HOME, count: 2 },
      { service: 'tuktuk', from: HOME, to: KITCHEN, count: 1 },
      { service: 'taxi', from: HOME, to: KITCHEN, count: 1 },
    ]);
  });

  it('skips trips with unknown ends and الرجعة bookings not completed inside the period', () => {
    const trips = new Map<string, StatsRide>([['r1', ride('taxi', HOME, null)]]);
    const bookings = [booking(), booking(), booking({ state: 'cancelled' }), booking({ completedAt: day('2026-10-05T10:00:00Z') }), booking({ farCity: null })];
    const map = tripMap(null, [order('m1', 'food', 'khalid')], [order('r1', 'ride')], trips, bookings, FROM, TO);
    expect(map.kitchens).toEqual([]);
    expect(map.traces).toEqual([{ service: 'rajaa', from: { lat: 32.915, lng: 45.04 }, to: { lat: 33.31, lng: 44.36 }, count: 2 }]);
  });
});

/** Encodes points as a precision-6 polyline (what the router sends). */
function encode(points: ReadonlyArray<{ lat: number; lng: number }>): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const [lat, lng] = [Math.round(p.lat * 1e6), Math.round(p.lng * 1e6)];
    put(lat - pLat);
    put(lng - pLng);
    [pLat, pLng] = [lat, lng];
  }
  return out;
}

describe('road shapes for «خريطتك» (look A)', () => {
  it('decodes the router\'s polyline; junk or a single point is no road', () => {
    const road = [
      { lat: 32.905, lng: 45.07 },
      { lat: 32.9071, lng: 45.0655 },
      { lat: 32.91, lng: 45.06 },
    ];
    expect(decodeRoad(encode(road))).toEqual(road);
    expect(decodeRoad(encode([road[0]!]))).toBeNull();
    expect(decodeRoad('_')).toBeNull();
  });

  it('drops bends under 10 m, keeps real corners and both ends, and never sends more than 80 points', () => {
    const corner = [
      { lat: 32.9, lng: 45.06 },
      { lat: 32.90002, lng: 45.0625 }, // ~2 m off the straight line
      { lat: 32.9, lng: 45.065 },
      { lat: 32.905, lng: 45.065 }, // a real corner
    ];
    expect(simplifyRoad(corner)).toEqual([corner[0], corner[2], corner[3]]);
    const zigzag = Array.from({ length: 500 }, (_, i) => ({ lat: 32.9 + (i % 2) * 0.001, lng: 45.0 + i * 0.001 }));
    const simple = simplifyRoad(zigzag);
    expect(simple.length).toBeLessThanOrEqual(TRIP_PATH_MAX_POINTS);
    expect(simple[0]).toEqual(zigzag[0]);
    expect(simple.at(-1)).toEqual(zigzag.at(-1));
  });
});
