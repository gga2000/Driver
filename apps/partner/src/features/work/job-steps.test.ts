import { describe, expect, it } from 'vitest';
import type { PartnerJobStop } from '@driver/contracts';
import { doorHint, railStage, spokenDigits, stepKey, stepReplies, stepSpeech, waitClock } from './job-steps';

const t = ((key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join('|')})` : key)) as never;

function stop(over: Partial<PartnerJobStop> = {}): PartnerJobStop {
  return {
    stopId: 's1',
    seq: 1,
    type: 'pickup',
    state: 'pending',
    zoneId: 'z',
    pin: null,
    label: 'مطعم خالد',
    orderId: 'o1',
    note: null,
    collectIqd: 0,
    arrivedAt: null,
    completedAt: null,
    landmark: null,
    ...over,
  };
}

describe('railStage (j1)', () => {
  it('walks pickup → at pickup → drop-off → at the door', () => {
    expect(railStage(stop())).toBe(0);
    expect(railStage(stop({ state: 'arrived' }))).toBe(1);
    expect(railStage(stop({ type: 'dropoff' }))).toBe(2);
    expect(railStage(stop({ type: 'dropoff', state: 'arrived' }))).toBe(3);
    expect(railStage(null)).toBe(3);
  });
  it('keys one moment per stop and state', () => {
    expect(stepKey(stop())).toBe('s1:pending');
    expect(stepKey(null)).toBe('none');
  });
});

describe('doorHint (j2)', () => {
  const door = { placeNote: 'الطابق الثاني', photos: [], firstVisit: false, doorConfirmed: false, entranceSet: false, landmark: 'الجامع الكبير' };
  it("puts the customer's own words first, then the place's note", () => {
    expect(doorHint(stop({ type: 'dropoff', note: 'باب أخضر', door, landmark: 'السوق' }))).toEqual({ note: 'باب أخضر', noteFromPlace: false, landmark: 'الجامع الكبير' });
    expect(doorHint(stop({ type: 'dropoff', note: '  ', door }))).toEqual({ note: 'الطابق الثاني', noteFromPlace: true, landmark: 'الجامع الكبير' });
  });
  it('falls back to the public landmark; a pickup has no note', () => {
    expect(doorHint(stop({ type: 'dropoff', landmark: 'السوق' })).landmark).toBe('السوق');
    expect(doorHint(stop({ note: 'x', landmark: 'السوق' }))).toEqual({ note: null, noteFromPlace: false, landmark: 'السوق' });
  });
});

describe('stepSpeech (j10)', () => {
  it('says where to go, with the landmark', () => {
    expect(stepSpeech(stop({ landmark: 'السوق' }), 'مطعم خالد', false, t, 'ar-IQ')).toBe('partner.say_go_pickup(مطعم خالد)، partner.say_near(السوق)');
  });
  it('reads the pickup code digit by digit at the counter', () => {
    expect(spokenDigits('4605')).toBe('4 6 0 5');
    expect(stepSpeech(stop({ state: 'arrived', pickupCode: '4605' }), 'مطعم خالد', false, t, 'ar-IQ')).toBe('partner.say_at_pickup(مطعم خالد)، partner.say_show_code(4 6 0 5)');
  });
  it('names the cash to take at the door', () => {
    expect(stepSpeech(stop({ type: 'dropoff', state: 'arrived', collectIqd: 12500 }), 'الزبون', false, t, 'ar-IQ')).toBe('partner.say_at_dropoff، partner.say_take_cash(12500)');
  });
  it('speaks the ride steps', () => {
    expect(stepSpeech(stop({ state: 'arrived' }), 'علي', true, t, 'en')).toBe('partner.say_at_rider');
    expect(stepSpeech(stop({ type: 'dropoff' }), 'الحي العسكري', true, t, 'ar-IQ')).toBe('partner.say_go_destination(الحي العسكري)');
    expect(stepSpeech(null, '', true, t, 'ar-IQ')).toBeNull();
  });
});

describe('waitClock (r6)', () => {
  it('counts from the arrival', () => {
    expect(waitClock(new Date(0), 187_400)).toEqual({ minutes: 3, text: '3:07' });
    expect(waitClock(new Date(10_000), 0)).toEqual({ minutes: 0, text: '0:00' });
    expect(waitClock(null, 1)).toBeNull();
  });
});

describe('stepReplies (r5, b11)', () => {
  const offered = ['courier_at_door', 'courier_cant_find', 'courier_on_the_way', 'courier_two_min'] as const;
  it('offers only what is true at the step, at most three', () => {
    expect(stepReplies(offered, 'customer_courier', false, 2)).toEqual(['courier_two_min', 'courier_on_the_way', 'courier_cant_find']);
    expect(stepReplies(offered, 'customer_courier', false, 3)).toEqual(['courier_at_door', 'courier_cant_find']);
    expect(stepReplies(offered, 'customer_courier', false, 0)).toEqual([]);
  });
  it('the kitchen thread and rides', () => {
    expect(stepReplies(['courier_at_restaurant', 'courier_how_long', 'courier_five_min'], 'merchant_courier', false, 1)).toEqual(['courier_at_restaurant', 'courier_how_long']);
    expect(stepReplies(['courier_cant_find', 'courier_outside', 'courier_two_min'], 'customer_courier', true, 1)).toEqual(['courier_outside', 'courier_cant_find']);
  });
  it("keeps the server's list when the step is unknown", () => {
    expect(stepReplies(offered, 'customer_courier', false, null)).toEqual(['courier_at_door', 'courier_cant_find', 'courier_on_the_way']);
  });
});
