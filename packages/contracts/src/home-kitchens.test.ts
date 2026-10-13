import { describe, expect, it } from 'vitest';
import { homeLocalDay, isReserveSlot, kitchenMonogram, nextReserveSlot, readyLeft, reserveSlots, slotKey, type HomeSale, type ReserveRule } from './home-kitchens.js';

/** Saturday 2026-10-03 12:00 Baghdad (UTC+3). */
const NOON_SAT = new Date('2026-10-03T09:00:00Z');
const z = (iso: string) => new Date(iso);

/** Cooked Saturdays and Mondays at 13:00 and 18:00, booked 4 hours ahead, 5 plates a time. */
const RULE: ReserveRule = { aheadMin: 240, days: [6, 1], times: ['18:00', '13:00', '18:00'], maxPerSlot: 5 };

describe('reserveSlots (أكل بيت reservations)', () => {
  it('lists her days over the next week at her times (sorted, once each), past the booking lead', () => {
    const days = reserveSlots(RULE, NOON_SAT);
    // Today 13:00 is only 1 h away (< 4 h): gone; 18:00 stays. Monday and next Saturday (day 7) have both.
    expect(days.map((d) => [d.day, d.dow, d.slots.map((s) => s.at.toISOString())])).toEqual([
      ['2026-10-03', 6, ['2026-10-03T15:00:00.000Z']],
      ['2026-10-05', 1, ['2026-10-05T10:00:00.000Z', '2026-10-05T15:00:00.000Z']],
      ['2026-10-10', 6, ['2026-10-10T10:00:00.000Z', '2026-10-10T15:00:00.000Z']],
    ]);
    for (const d of days) for (const s of d.slots) expect(s.left).toBe(5);
  });

  it('counts the plates booked per time; a full time stays with 0 left, never below', () => {
    const booked = new Map([
      [slotKey(z('2026-10-03T15:00:00Z')), 5],
      [slotKey(z('2026-10-05T10:00:00Z')), 2],
      [slotKey(z('2026-10-05T15:00:00Z')), 9],
    ]);
    const [sat, mon] = reserveSlots(RULE, NOON_SAT, booked);
    expect(sat!.slots).toEqual([{ at: z('2026-10-03T15:00:00Z'), left: 0 }]);
    expect(mon!.slots.map((s) => s.left)).toEqual([3, 0]);
  });

  it('a day with no time left after the lead is left out', () => {
    // Only 13:00, booked a day ahead: today's is too soon, so the list starts on Monday.
    const days = reserveSlots({ aheadMin: 1440, days: [6, 1], times: ['13:00'], maxPerSlot: 3 }, NOON_SAT);
    expect(days.map((d) => d.day)).toEqual(['2026-10-05', '2026-10-10']);
  });

  it('just after local midnight (21:30Z) the week starts on the new local day', () => {
    // Saturday 21:30Z = Sunday 00:30 Baghdad.
    const days = reserveSlots({ aheadMin: 0, days: [0], times: ['09:00'], maxPerSlot: 2 }, z('2026-10-03T21:30:00Z'));
    expect(days[0]).toEqual({ day: '2026-10-04', dow: 0, slots: [{ at: z('2026-10-04T06:00:00Z'), left: 2 }] });
    expect(days.map((d) => d.day)).toEqual(['2026-10-04', '2026-10-11']);
  });
});

describe('isReserveSlot / nextReserveSlot', () => {
  it('only her own bookable times pass (to the minute)', () => {
    expect(isReserveSlot(RULE, NOON_SAT, z('2026-10-05T10:00:00Z'))).toBe(true);
    expect(isReserveSlot(RULE, NOON_SAT, z('2026-10-05T10:00:40Z'))).toBe(true);
    expect(isReserveSlot(RULE, NOON_SAT, z('2026-10-03T10:00:00Z'))).toBe(false); // today 13:00: inside the 4 h lead
    expect(isReserveSlot(RULE, NOON_SAT, z('2026-10-04T10:00:00Z'))).toBe(false); // Sunday: not her day
    expect(isReserveSlot(RULE, NOON_SAT, z('2026-10-05T10:30:00Z'))).toBe(false); // 13:30: not her time
    expect(isReserveSlot(RULE, NOON_SAT, z('2026-10-12T10:00:00Z'))).toBe(false); // past the 7-day window
  });

  it('the next time is the first with a plate free; null when the week is full', () => {
    expect(nextReserveSlot(RULE, NOON_SAT)).toEqual({ at: z('2026-10-03T15:00:00Z'), left: 5 });
    const tonightFull = new Map([[slotKey(z('2026-10-03T15:00:00Z')), 5]]);
    expect(nextReserveSlot(RULE, NOON_SAT, tonightFull)).toEqual({ at: z('2026-10-05T10:00:00Z'), left: 5 });
    const one: ReserveRule = { aheadMin: 0, days: [6], times: ['13:00'], maxPerSlot: 1 };
    const all = new Map([
      [slotKey(z('2026-10-03T10:00:00Z')), 1],
      [slotKey(z('2026-10-10T10:00:00Z')), 1],
    ]);
    expect(nextReserveSlot(one, NOON_SAT, all)).toBeNull();
  });
});

describe('readyLeft (plates still free today)', () => {
  const sale = (patch: Partial<Extract<HomeSale, { mode: 'ready' }>> = {}): Extract<HomeSale, { mode: 'ready' }> => ({ mode: 'ready', cooked: 10, cookedOn: '2026-10-03', setAt: null, ...patch });

  it('her stock less what was ordered since the start of her day', () => {
    const sold = [
      { at: z('2026-10-03T08:00:00Z'), qty: 2 },
      { at: z('2026-10-02T20:00:00Z'), qty: 3 }, // yesterday (23:00 local): not today's plates
    ];
    expect(readyLeft(sale(), 6, NOON_SAT, sold)).toBe(4);
    expect(readyLeft(sale(), 6, NOON_SAT)).toBe(6);
  });

  it('counts only what was ordered after she last said how many are left', () => {
    const sold = [
      { at: z('2026-10-03T08:00:00Z'), qty: 2 },
      { at: z('2026-10-03T08:45:00Z'), qty: 1 },
    ];
    expect(readyLeft(sale({ setAt: '2026-10-03T08:30:00Z' }), 6, NOON_SAT, sold)).toBe(5);
    // A setAt from yesterday falls back to the start of today.
    expect(readyLeft(sale({ setAt: '2026-10-02T12:00:00Z' }), 6, NOON_SAT, sold)).toBe(3);
  });

  it('nothing on a day she did not cook, with no stock, or when oversold', () => {
    expect(readyLeft(sale({ cookedOn: '2026-10-02' }), 6, NOON_SAT)).toBe(0);
    expect(readyLeft(sale({ cookedOn: null }), 6, NOON_SAT)).toBe(0);
    expect(readyLeft(sale(), null, NOON_SAT)).toBe(0);
    expect(readyLeft(sale(), 2, NOON_SAT, [{ at: z('2026-10-03T08:00:00Z'), qty: 3 }])).toBe(0);
  });

  it('cooked "today" ends at local midnight, not UTC midnight', () => {
    // 21:30Z on the 3rd is already the 4th in Aziziyah: the 3rd's plates are gone.
    expect(readyLeft(sale(), 6, z('2026-10-03T20:59:00Z'))).toBe(6);
    expect(readyLeft(sale(), 6, z('2026-10-03T21:30:00Z'))).toBe(0);
  });
});

describe('homeLocalDay', () => {
  it('turns at 21:00Z (local midnight, UTC+3)', () => {
    expect(homeLocalDay(z('2026-10-03T20:59:59Z'))).toBe('2026-10-03');
    expect(homeLocalDay(z('2026-10-03T21:00:00Z'))).toBe('2026-10-04');
    expect(homeLocalDay(z('2026-10-03T21:00:00Z'), 0)).toBe('2026-10-03');
  });
});

describe('kitchenMonogram', () => {
  it('the first letter of the last word, skipping «ال»', () => {
    expect(kitchenMonogram('مطبخ أم حسين')).toBe('ح');
    expect(kitchenMonogram('مطبخ البيت')).toBe('ب');
    expect(kitchenMonogram('  أكلات   سعاد  ')).toBe('س');
    // «ال» alone is a word, not a prefix.
    expect(kitchenMonogram('ال')).toBe('ا');
  });

  it('an empty name gets a dot', () => {
    expect(kitchenMonogram('')).toBe('·');
    expect(kitchenMonogram('   ')).toBe('·');
  });
});
