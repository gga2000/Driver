import { describe, expect, it } from 'vitest';
import { basePrepMin, etaRange, foldArabic, minutesUntilLocal, nextOpening, nextOpeningIn, openState, pinOf, prepRange, twelveHour } from './storefront.js';

const TZ = 'Asia/Baghdad';
const every = (start: string, end: string) => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start, end }));

describe('storefront helpers', () => {
  it('formats local times on the 12-hour clock', () => {
    expect(twelveHour('05:00')).toBe('5:00');
    expect(twelveHour('13:15')).toBe('1:15');
    expect(twelveHour('00:00')).toBe('12:00');
    expect(twelveHour('12:30')).toBe('12:30');
  });

  it('open state: inside hours, across midnight, before opening, and the next opening time', () => {
    // Saturday 23:30 Baghdad; 11:00–00:30 wraps past midnight.
    const late = new Date('2026-10-03T20:30:00Z');
    expect(openState(late, every('11:00', '00:30'), [], TZ)).toEqual({ open: true, closedReason: null, opensAt: null });
    // Sunday 00:15 is still Saturday's window.
    expect(openState(new Date('2026-10-03T21:15:00Z'), every('11:00', '00:30'), [], TZ).open).toBe(true);
    // Sunday 01:00: closed until 11:00.
    expect(openState(new Date('2026-10-03T22:00:00Z'), every('11:00', '00:30'), [], TZ)).toEqual({ open: false, closedReason: 'hours', opensAt: '11:00' });
    // No hours on file = always open.
    expect(openState(late, [], [], TZ).open).toBe(true);
    // Only a Monday window: from Saturday evening the next opening is Monday's start.
    expect(nextOpening(late, [{ dow: 1, start: '08:30', end: '12:00' }], TZ)).toBe('8:30');
  });

  it('minutes to the next opening (f12: the first kitchen to open at night)', () => {
    // Sunday 01:00 Baghdad, 11:00–00:30 daily: 10 hours.
    expect(nextOpeningIn(new Date('2026-10-03T22:00:00Z'), every('11:00', '00:30'), TZ)).toBe(600);
    // Saturday 23:30, a Monday-only 08:30 window: 33 h.
    expect(nextOpeningIn(new Date('2026-10-03T20:30:00Z'), [{ dow: 1, start: '08:30', end: '12:00' }], TZ)).toBe(33 * 60);
    expect(nextOpeningIn(new Date('2026-10-03T20:30:00Z'), [], TZ)).toBeNull();
    // A pause ending at 13:15 seen at 12:00 local; an end already past today is tomorrow's.
    expect(minutesUntilLocal(new Date('2026-10-03T09:00:00Z'), '13:15', TZ)).toBe(75);
    expect(minutesUntilLocal(new Date('2026-10-03T09:00:00Z'), '11:00', TZ)).toBe(23 * 60);
  });

  it('prep: storefront figure, else the median item, plus the busy buffer', () => {
    expect(basePrepMin(25, [])).toBe(25);
    expect(basePrepMin(null, [{ prepTimeMin: 5 }, { prepTimeMin: 30 }, { prepTimeMin: 12 }])).toBe(12);
    expect(basePrepMin(null, [])).toBe(20);
    expect(prepRange(20, false)).toEqual({ min: 20, max: 30 });
    expect(prepRange(20, true)).toEqual({ min: 30, max: 40 });
  });

  it('a point without a pin uses its zone centre; ETA rounds the low end up to 5', () => {
    expect(pinOf({ zoneKey: 'centre', pin: { lat: 1, lng: 2 } })).toEqual({ lat: 1, lng: 2 });
    expect(pinOf({ zoneKey: 'centre' })).toEqual({ lat: 32.905, lng: 45.06 });
    expect(pinOf({ zoneKey: 'nowhere' })).toBeNull();
    expect(etaRange({ min: 20, max: 30 }, 7)).toEqual({ min: 30, max: 40 });
    expect(etaRange({ min: 20, max: 30 }, null)).toBeNull();
  });

  it('folds Arabic spelling variants for search', () => {
    expect(foldArabic('مشكّل')).toBe(foldArabic('مشكل'));
    expect(foldArabic('أكلة')).toBe('اكله');
    expect(foldArabic('چاي')).toBe(foldArabic('جاي'));
  });
});
