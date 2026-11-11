import { describe, expect, it } from 'vitest';
import { arrivalCountsForFees, cancellationFee, FEE_ARRIVAL_RADIUS_M, riderNoShowAt, riderNoShowFee, type OrderCancellationSubject, type TripCancellationSubject } from './cancellation.js';

const T0 = new Date('2026-10-03T12:00:00Z');
const sec = (s: number) => new Date(T0.getTime() + s * 1000);

const food = (patch: Partial<OrderCancellationSubject> = {}): OrderCancellationSubject => ({
  kind: 'order',
  type: 'food',
  state: 'placed',
  itemsTotalIqd: 15000,
  deliveryFeeIqd: 1000,
  totalIqd: 16500,
  scheduledFor: null,
  merchantOfferedAt: T0,
  courierEnRoute: false,
  courierAssigned: false,
  receiptTotalIqd: null,
  ...patch,
});

const ride = (patch: Partial<TripCancellationSubject> = {}): TripCancellationSubject => ({
  kind: 'trip',
  state: 'offered',
  by: 'customer',
  acceptedAt: null,
  arrivedPickupAt: null,
  fareIqd: 3000,
  ...patch,
});

const splitsOf = (f: ReturnType<typeof cancellationFee>) => Object.fromEntries(f.splits.map((s) => [s.to, s.amountIqd]));

describe('cancellationFee — food (spec §4, edge-case A.12/A.15)', () => {
  it('free until the merchant accepts', () => {
    const f = cancellationFee(food(), T0);
    expect(f).toMatchObject({ allowed: true, free: true, amountIqd: 0 });
    expect(f.reason_ar.length).toBeGreaterThan(3);
  });

  it('scheduled order is free until it has been offered to the merchant', () => {
    expect(cancellationFee(food({ state: 'merchant_accepted', scheduledFor: sec(3600), merchantOfferedAt: null }), T0).free).toBe(true);
  });

  it('500 to the merchant after acceptance', () => {
    const f = cancellationFee(food({ state: 'merchant_accepted' }), T0);
    expect(f.amountIqd).toBe(500);
    expect(splitsOf(f)).toEqual({ merchant: 500 });
    expect(f.payer).toBe('customer');
    expect(f.label_ar).toBeTruthy();
  });

  it('food cost once preparing, plus 500 to a courier already on the way', () => {
    expect(cancellationFee(food({ state: 'preparing' }), T0).amountIqd).toBe(15000);
    const f = cancellationFee(food({ state: 'ready', courierEnRoute: true }), T0);
    expect(f.amountIqd).toBe(15500);
    expect(splitsOf(f)).toEqual({ merchant: 15000, courier: 500 });
  });

  it('never exceeds the order total', () => {
    const f = cancellationFee(food({ state: 'preparing', itemsTotalIqd: 15000, totalIqd: 15250, courierEnRoute: true }), T0);
    expect(f.amountIqd).toBe(15250);
    expect(f.splits.reduce((a, s) => a + s.amountIqd, 0)).toBe(15250);
  });

  it('no cancel after pickup: it becomes a dispute', () => {
    const f = cancellationFee(food({ state: 'picked_up' }), T0);
    expect(f.allowed).toBe(false);
  });

  it('errands: free before a courier, 500 before purchase, receipt + fee after purchase', () => {
    const errand = (p: Partial<OrderCancellationSubject>) => food({ type: 'errand', itemsTotalIqd: 0, totalIqd: 1500, deliveryFeeIqd: 1500, ...p });
    expect(cancellationFee(errand({}), T0).free).toBe(true);
    expect(cancellationFee(errand({ courierAssigned: true }), T0).amountIqd).toBe(500);
    expect(cancellationFee(errand({ courierAssigned: true, receiptTotalIqd: 8750 }), T0).amountIqd).toBe(10250);
  });
});

describe('cancellationFee — rides (spec §4)', () => {
  it('customer: free before accept and for 60 s after', () => {
    expect(cancellationFee(ride(), T0).free).toBe(true);
    expect(cancellationFee(ride({ state: 'en_route_to_pickup', acceptedAt: T0 }), sec(60)).free).toBe(true);
  });

  it('customer: 500 to the driver after 60 s, 1,000 after arrival', () => {
    const late = cancellationFee(ride({ state: 'en_route_to_pickup', acceptedAt: T0 }), sec(61));
    expect(late.amountIqd).toBe(500);
    expect(splitsOf(late)).toEqual({ driver: 500 });
    const arrived = cancellationFee(ride({ state: 'arrived_pickup', acceptedAt: T0, arrivedPickupAt: sec(30) }), sec(40));
    expect(arrived.amountIqd).toBe(1000);
  });

  it('customer: a "وصلت" tapped outside the pickup geofence is not an arrival (no arrival time = the en-route rule)', () => {
    const far = cancellationFee(ride({ state: 'arrived_pickup', acceptedAt: T0, arrivedPickupAt: null }), sec(61));
    expect(far).toMatchObject({ amountIqd: 500, reason_ar: 'السايق تحرك عليك' });
    expect(cancellationFee(ride({ state: 'arrived_pickup', acceptedAt: T0, arrivedPickupAt: null }), sec(30)).free).toBe(true);
  });

  it('customer cannot cancel mid-ride (completes instead)', () => {
    expect(cancellationFee(ride({ state: 'in_transit', acceptedAt: T0, arrivedPickupAt: sec(1) }), sec(300)).allowed).toBe(false);
  });

  it('driver: scoring hit after accept; after arrival also 500 credit to the customer', () => {
    const before = cancellationFee(ride({ by: 'driver', state: 'accepted', acceptedAt: T0 }), sec(5));
    expect(before).toMatchObject({ free: true, scoringHit: true });
    const after = cancellationFee(ride({ by: 'driver', state: 'arrived_pickup', acceptedAt: T0, arrivedPickupAt: sec(10) }), sec(20));
    expect(after).toMatchObject({ amountIqd: 500, payer: 'driver', scoringHit: true });
    expect(splitsOf(after)).toEqual({ customer: 500 });
  });

  it('no fee exceeds the fare', () => {
    expect(cancellationFee(ride({ state: 'arrived_pickup', acceptedAt: T0, arrivedPickupAt: T0, fareIqd: 750 }), sec(10)).amountIqd).toBe(750);
  });

  it('fees are multiples of the rounding step', () => {
    const f = cancellationFee(food({ state: 'preparing', itemsTotalIqd: 15100, totalIqd: 20000 }), T0);
    expect(f.amountIqd % 250).toBe(0);
  });
});

describe('arrivalCountsForFees — the fee-only arrival radius', () => {
  const at = new Date('2026-10-03T09:00:00Z');
  const tap = (arrivalDistanceM: number | null, arrivalAccuracyM: number | null = null) => ({ arrivedAt: at, arrivedOutsideGeofence: arrivalDistanceM !== null && arrivalDistanceM > 60, arrivalDistanceM, arrivalAccuracyM });
  it('defaults to 150 m', () => expect(FEE_ARRIVAL_RADIUS_M).toBe(150));
  it('counts a tap inside the 60 m geofence, or with nothing to compare', () => {
    expect(arrivalCountsForFees(tap(20))).toBe(true);
    expect(arrivalCountsForFees(tap(null))).toBe(true);
  });
  it('counts a 90 m and a 150 m tap, not a 151 m or a 400 m one', () => {
    expect(arrivalCountsForFees(tap(90))).toBe(true);
    expect(arrivalCountsForFees(tap(150))).toBe(true);
    expect(arrivalCountsForFees(tap(151))).toBe(false);
    expect(arrivalCountsForFees(tap(400))).toBe(false);
  });
  it('counts a 100 m tap with a 50 m accuracy; a huge accuracy never stretches it past 60 + 90 m', () => {
    expect(arrivalCountsForFees(tap(100, 50))).toBe(true);
    expect(arrivalCountsForFees(tap(400, 1000))).toBe(false);
  });
  it('no tap is no arrival', () => expect(arrivalCountsForFees({ ...tap(10), arrivedAt: null })).toBe(false));
});

describe('riderNoShowFee — «الراكب ما إجه» (Ali 2026-10-30)', () => {
  it('opens 5 minutes after the counted arrival: 1,000 from the rider to the driver', () => {
    expect(riderNoShowAt(T0)).toEqual(sec(300));
    expect(riderNoShowFee({ arrivedPickupAt: T0, fareIqd: 4000 }, sec(299))).toMatchObject({ allowed: false });
    expect(riderNoShowFee({ arrivedPickupAt: T0, fareIqd: 4000 }, sec(300))).toMatchObject({ allowed: true, free: false, payer: 'customer', amountIqd: 1000, splits: [{ to: 'driver', amountIqd: 1000 }], label_ar: 'الراكب ما إجه' });
  });
  it('never without an arrival near the rider, and never above the fare', () => {
    expect(riderNoShowFee({ arrivedPickupAt: null, fareIqd: 4000 }, sec(3600))).toMatchObject({ allowed: false, amountIqd: 0 });
    expect(riderNoShowFee({ arrivedPickupAt: T0, fareIqd: 750 }, sec(600)).amountIqd).toBe(750);
  });
});
