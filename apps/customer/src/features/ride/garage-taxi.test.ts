import { describe, expect, it } from 'vitest';
import type { GarageArmView, GarageTaxiLink, ToGaragePlan } from '@driver/contracts';
import { armCardState, lateNoticeShown, toGarageCardState } from './garage-taxi';

const GARAGE = { id: 'mp_garage_bab1', nameAr: 'كراج البوابة 1', nameEn: 'Gate 1 garage' };

function plan(over: Partial<ToGaragePlan> = {}): ToGaragePlan {
  return {
    bookingId: 'bk',
    status: 'offer',
    unavailable: null,
    garage: GARAGE,
    departAt: new Date('2026-10-08T06:30:00Z'),
    places: [],
    fromPlaceId: 'pl_home',
    fromName: 'البيت',
    mode: 'later',
    pickupAt: new Date('2026-10-08T06:05:00Z'),
    arriveAt: new Date('2026-10-08T06:18:00Z'),
    rideMin: 13,
    bufferMin: 10,
    fareIqd: 3000,
    totalIqd: 3000,
    paymentMethod: 'cash',
    order: null,
    ...over,
  };
}

function arm(over: Partial<GarageArmView> = {}): GarageArmView {
  return { bookingId: 'bk', status: 'off', unavailable: null, garage: GARAGE, places: [], toPlaceId: 'pl_home', toName: 'البيت', estimateIqd: 3000, paymentMethod: 'cash', carEtaMin: 40, placeAtEtaMin: 10, orderId: null, placedAt: null, failCode: null, ...over };
}

describe('the x2 card (taxi to the الرجعة car)', () => {
  it('loading, offline and the error before any data', () => {
    expect(toGarageCardState({ data: undefined, isError: false }, true)).toEqual({ kind: 'loading' });
    expect(toGarageCardState({ data: undefined, isError: true }, true)).toEqual({ kind: 'error' });
    expect(toGarageCardState({ data: undefined, isError: true }, false)).toEqual({ kind: 'offline' });
  });

  it('the offer, the booked ride, «احفظ بيتك» and «ما يلحگ»; offline keeps the last answer', () => {
    expect(toGarageCardState({ data: plan(), isError: false }, true)).toMatchObject({ kind: 'offer', offline: false });
    expect(toGarageCardState({ data: plan(), isError: true }, false)).toMatchObject({ kind: 'offer', offline: true });
    expect(toGarageCardState({ data: plan({ status: 'booked' }), isError: false }, true).kind).toBe('booked');
    expect(toGarageCardState({ data: plan({ status: 'unavailable', unavailable: 'no_place' }), isError: false }, true).kind).toBe('no_place');
    expect(toGarageCardState({ data: plan({ status: 'unavailable', unavailable: 'too_late' }), isError: false }, true).kind).toBe('too_late');
  });

  it('hides for a seat the idea does not apply to', () => {
    for (const why of ['not_from_aziziyah', 'not_booked', 'door_pickup', 'car_left'] as const)
      expect(toGarageCardState({ data: plan({ status: 'unavailable', unavailable: why }), isError: false }, true)).toEqual({ kind: 'hidden' });
  });
});

describe('the x4 card (a taxi waiting at the garage)', () => {
  it('follows the server’s status; hides when not offered, asks for a place without one', () => {
    expect(armCardState({ data: undefined, isError: false }, false)).toEqual({ kind: 'offline' });
    for (const status of ['off', 'armed', 'placed', 'dropped', 'failed'] as const) expect(armCardState({ data: arm({ status }), isError: false }, true).kind).toBe(status);
    expect(armCardState({ data: arm({ status: 'unavailable', unavailable: 'arrived' }), isError: false }, true)).toEqual({ kind: 'hidden' });
    expect(armCardState({ data: arm({ status: 'unavailable', unavailable: 'no_place' }), isError: false }, true).kind).toBe('no_place');
  });
});

describe('the x3 notice on the live ride', () => {
  const link = (lateMin: number): GarageTaxiLink => ({ orderId: 'o', bookingId: 'bk', garage: GARAGE, departAt: new Date(), expectedAt: new Date(), lateMin, driverTold: lateMin >= 3, toldMin: lateMin >= 3 ? lateMin : null });
  it('shows from 3 minutes late, never for an ordinary ride', () => {
    expect(lateNoticeShown(null)).toBe(false);
    expect(lateNoticeShown(link(2))).toBe(false);
    expect(lateNoticeShown(link(3))).toBe(true);
  });
});
