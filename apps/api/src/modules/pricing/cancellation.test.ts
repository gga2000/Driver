import { describe, expect, it } from 'vitest';
import { cancellationFee, type OrderCancellationSubject, type TripCancellationSubject } from './cancellation.js';

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
