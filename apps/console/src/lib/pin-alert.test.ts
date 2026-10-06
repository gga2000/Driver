import { describe, expect, it } from 'vitest';
import type { PinAlertView, PinAttemptView } from '@driver/contracts';
import { pinAlertDetail, pinAlertOrder, pinAlertTitle, pinAttemptLine } from './pin-alert';

const at = (min: number) => new Date(Date.UTC(2026, 9, 6, 17, 0) + min * 60_000); // 8:00 م Baghdad

const attempt = (id: string, min: number, over: Partial<PinAttemptView> = {}): PinAttemptView => ({
  attemptId: id,
  at: at(min),
  driverId: 'd1',
  targetBookingId: 'bk_a',
  targetSeatIds: ['front'],
  matchedBookingId: null,
  matchedSeatIds: [],
  result: 'wrong_pin',
  alert: null,
  ...over,
});

const alert = (id: string, over: Partial<PinAlertView> = {}): PinAlertView => ({
  alertId: id,
  kind: 'cross_use',
  cityId: 'aziziyah',
  departureId: 'dep_1',
  garageNameAr: 'كراج البوابة 1',
  corridorNameAr: 'العزيزية ⇄ بغداد',
  departAt: at(30),
  driver: { personId: 'd1', displayName: 'حيدر ك.', phoneMasked: '0770 ••• ••01' },
  targetBookingId: 'bk_a',
  targetSeatIds: ['front'],
  matchedBookingId: 'bk_b',
  matchedSeatIds: ['back_left', 'back_middle'],
  refusedOnSeat: 1,
  raisedAt: at(12),
  attempts: [],
  ...over,
});

describe('الرجعة PIN alerts on the strip', () => {
  it('says whose PIN went on which seat, or how many wrong ones, in seats and never the PIN', () => {
    expect(pinAlertTitle(alert('a'))).toBe('حيدر ك. كتب رمز راكب «ورا يسار، ورا نص» على مقعد «قدام»');
    expect(pinAlertTitle(alert('b', { kind: 'wrong_repeated', matchedBookingId: null, matchedSeatIds: [], refusedOnSeat: 3 }))).toBe('حيدر ك. كتب رمز غلط 3 مرات على مقعد «قدام»');
    expect(pinAlertTitle(alert('c', { kind: 'wrong_repeated', targetBookingId: null, targetSeatIds: [], refusedOnSeat: 3 }))).toBe('حيدر ك. كتب رمز غلط 3 مرات');
    expect(pinAlertTitle(alert('d', { driver: { personId: 'd1', displayName: null, phoneMasked: null } }))).toMatch(/^سايق كتب/);
  });

  it('names the car, says it was refused and how long ago', () => {
    expect(pinAlertDetail(alert('a'), at(14).getTime())).toBe('الرجعة · كراج البوابة 1 · العزيزية ⇄ بغداد · تطلع 8:30 م · انرفض وما صعد أحد · قبل 2 د');
  });

  it('reads each attempt in the history', () => {
    expect(pinAttemptLine(attempt('1', 5, { result: 'other_booking', matchedBookingId: 'bk_b', matchedSeatIds: ['back_left'] }))).toBe('8:05 م · على مقعد «قدام» · رمز راكب «ورا يسار»، انرفض');
    expect(pinAttemptLine(attempt('2', 6))).toBe('8:06 م · على مقعد «قدام» · رمز ما يطابق أحد');
    expect(pinAttemptLine(attempt('3', 7, { targetBookingId: null, targetSeatIds: [], result: 'checked_in', matchedBookingId: 'bk_b', matchedSeatIds: ['back_left'] }))).toBe('8:07 م · بلوحة الرمز · صح، صعد راكب «ورا يسار»');
    expect(pinAttemptLine(attempt('4', 8, { result: 'not_boardable', matchedBookingId: 'bk_a', matchedSeatIds: ['front'] }))).toBe('8:08 م · على مقعد «قدام» · رمز راكب «قدام» بس ما يصعد هسة');
  });

  it('cross-use rows come first, newest first, then repeated wrong PINs', () => {
    const rows = [alert('w', { kind: 'wrong_repeated', raisedAt: at(20) }), alert('x', { raisedAt: at(1) }), alert('y', { raisedAt: at(9) })];
    expect(pinAlertOrder(rows).map((r) => r.alertId)).toEqual(['y', 'x', 'w']);
  });
});
