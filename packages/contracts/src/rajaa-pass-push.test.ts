import { describe, expect, it } from 'vitest';
import { decodeRajaaPassPush, encodeRajaaPassPush, RAJAA_PASS_PUSH_KIND, rajaaPassPhaseFor, type RajaaPassPush } from './rajaa-pass-push.js';

const push: RajaaPassPush = {
  kind: RAJAA_PASS_PUSH_KIND,
  bookingId: 'bk_1',
  phase: 'boarding',
  departAt: new Date('2026-10-06T15:30:00Z'),
  stop: 'كراج النهضة',
  pickupKind: 'garage',
  toCity: 'العزيزية',
  seatIds: ['back_left', 'back_middle'],
  pin: '5481',
  carKm: 1.04,
  fareIqd: 20_000,
  sentAt: new Date('2026-10-06T15:05:00Z'),
};

describe('الرجعة lock-screen pass push (customer d-8 follow-up)', () => {
  it('round-trips through flat string data', () => {
    const data = encodeRajaaPassPush(push);
    expect(Object.values(data).every((v) => typeof v === 'string')).toBe(true);
    expect(data).toMatchObject({ phase: 'boarding', seatIds: 'back_left,back_middle', carKm: '1.0', fareIqd: '20000' });
    expect(decodeRajaaPassPush({ ...data, deliveryId: 'nd_1', template: 'rajaa_pass_update' })).toEqual({ ...push, carKm: 1 });
    expect(decodeRajaaPassPush(encodeRajaaPassPush({ ...push, phase: 'on_road', carKm: null }))).toMatchObject({ phase: 'on_road', carKm: null });
  });

  it('ignores other pushes and malformed data', () => {
    expect(decodeRajaaPassPush({ kind: 'rajaa_pass', bookingId: 'bk_1' })).toBeNull();
    expect(decodeRajaaPassPush(null)).toBeNull();
    expect(decodeRajaaPassPush({ ...encodeRajaaPassPush(push), phase: 'flying' })).toBeNull();
    expect(decodeRajaaPassPush({ ...encodeRajaaPassPush(push), departAt: 'soon' })).toBeNull();
  });

  it('maps each boarding event to the card it means for a booking in that state', () => {
    expect(rajaaPassPhaseFor('departure.boarding', 'booked')).toBe('boarding');
    expect(rajaaPassPhaseFor('departure.boarding', 'checked_in')).toBeNull();
    expect(rajaaPassPhaseFor('departure.driver_left_garage', 'booked')).toBe('boarding');
    expect(rajaaPassPhaseFor('seat.checked_in', 'checked_in')).toBe('on_board');
    expect(rajaaPassPhaseFor('departure.departed', 'checked_in')).toBe('on_road');
    expect(rajaaPassPhaseFor('departure.departed', 'no_show')).toBeNull();
    expect(rajaaPassPhaseFor('departure.arrived', 'completed')).toBe('arrived');
    for (const e of ['seat.cancelled', 'seat.moved', 'seat.no_show', 'departure.cancelled']) expect(rajaaPassPhaseFor(e, 'cancelled')).toBe('gone');
    expect(rajaaPassPhaseFor('seat.booked', 'booked')).toBeNull();
  });
});
