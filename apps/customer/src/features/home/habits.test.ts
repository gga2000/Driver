import { describe, expect, it } from 'vitest';
import type { TodayPot, Usual } from '@driver/contracts';
import { formatClock } from '@driver/i18n';
import { homeContext } from './context';
import { fridayAhead, fridayDay, fridaySlot, fridayTitleKey, potUntilAt, timesKey, usualNow, usualReason, visiblePots } from './habits';

/** Baghdad wall clock → instant. 2026-10-08 is a Thursday, 2026-10-09 a Friday. */
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+03:00`);
const clock = (d: Date) => formatClock(d, { period: false });

function usual(over: Partial<Usual> & { merchantOrgId?: string } = {}): Usual {
  const { merchantOrgId = 'kareem', ...rest } = over;
  return {
    kind: 'weekday',
    weekday: 5,
    band: 'lunch',
    times: 3,
    atMinute: 13 * 60 + 30,
    row: { order: { id: 'o1', merchantOrgId }, merchantName: 'مشويات الحاج كريم', items: [], dropoffZoneKey: null },
    ...rest,
  } as Usual;
}

const daily = (start: string, end: string) => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start, end }));
const PRAYER = [{ dow: 5, start: '11:45', end: '13:15' }];

describe('usualNow', () => {
  it('a weekday usual on its day and band; a band usual on any day; weekday first', () => {
    const fri = usual();
    const dinner = usual({ kind: 'band', weekday: null, band: 'evening', atMinute: 20 * 60 });
    expect(usualNow([dinner, fri], at('2026-10-09 13:00'))).toBe(fri);
    expect(usualNow([dinner, fri], at('2026-10-08 13:00'))).toBeNull(); // Thursday lunch: no usual
    expect(usualNow([dinner, fri], at('2026-10-08 20:00'))).toBe(dinner);
    expect(usualNow([], at('2026-10-08 20:00'))).toBeNull();
  });
});

describe('fridayDay', () => {
  it('Thursday from 16:00 → tomorrow; Friday 04:00–10:59 → today; otherwise none', () => {
    expect(fridayDay(at('2026-10-08 15:59'))).toBeNull();
    expect(fridayDay(at('2026-10-08 16:00'))).toBe(1);
    expect(fridayDay(at('2026-10-08 23:30'))).toBe(1);
    expect(fridayDay(at('2026-10-09 02:00'))).toBeNull();
    expect(fridayDay(at('2026-10-09 08:00'))).toBe(0);
    expect(fridayDay(at('2026-10-09 11:00'))).toBeNull();
    expect(fridayDay(at('2026-10-10 09:00'))).toBeNull();
  });
});

describe('fridaySlot', () => {
  it('the half hour of the usual time, inside the hours', () => {
    expect(clock(fridaySlot(at('2026-10-08 20:00'), 1, 14 * 60, daily('11:00', '23:00'), PRAYER)!.at)).toBe('2:00');
  });
  it('a usual time inside Friday prayer moves to the first slot after it, and says so', () => {
    const s = fridaySlot(at('2026-10-08 20:00'), 1, 12 * 60 + 30, daily('11:00', '23:00'), PRAYER)!;
    expect(clock(s.at)).toBe('1:30');
    expect(s.movedForPrayer).toBe(true);
  });
  it('none when the kitchen is closed all Friday', () => {
    expect(fridaySlot(at('2026-10-08 20:00'), 1, 13 * 60, [{ dow: 4, start: '11:00', end: '23:00' }], PRAYER)).toBeNull();
  });
});

describe('fridayAhead', () => {
  const kitchen = () => ({ hours: daily('11:00', '23:00'), pauses: PRAYER });
  it('Thursday evening with a Friday usual: tomorrow, at its slot', () => {
    const a = fridayAhead([usual()], at('2026-10-08 20:00'), kitchen)!;
    expect(a.day).toBe(1);
    expect(clock(a.slot.at)).toBe('1:30');
  });
  it('nothing without a Friday usual, outside the window, or when the kitchen is unknown', () => {
    expect(fridayAhead([usual({ weekday: 4 })], at('2026-10-08 20:00'), kitchen)).toBeNull();
    expect(fridayAhead([usual()], at('2026-10-08 12:00'), kitchen)).toBeNull();
    expect(fridayAhead([usual()], at('2026-10-08 20:00'), () => null)).toBeNull();
  });
  it('Friday morning: a breakfast usual already past is not offered; lunch is', () => {
    const breakfast = usual({ band: 'morning', atMinute: 8 * 60 });
    const lunch = usual({ times: 2 });
    expect(fridayAhead([breakfast], at('2026-10-09 09:00'), () => ({ hours: daily('05:00', '23:00'), pauses: PRAYER }))).toBeNull();
    expect(fridayAhead([breakfast, lunch], at('2026-10-09 09:00'), kitchen)?.usual).toBe(lunch);
  });
});

describe('copy helpers', () => {
  it('natural counts: مرتين, 3–10 مرات, 11+ مرة', () => {
    expect(timesKey(2)).toBe('usual.times_two');
    expect(timesKey(3)).toBe('usual.times_few');
    expect(timesKey(10)).toBe('usual.times_few');
    expect(timesKey(11)).toBe('usual.times_many');
  });
  it('a usual says why: the weekday, or the time of day', () => {
    expect(usualReason(usual())).toEqual({ key: 'usual.reason', times: 'usual.times_few', when: 'usual.day_5' });
    expect(usualReason(usual({ kind: 'band', weekday: null, band: 'evening', times: 2 }))).toEqual({ key: 'usual.reason', times: 'usual.times_two', when: 'usual.band_evening' });
  });
  it('the Friday question by meal and day', () => {
    expect(fridayTitleKey(1, 'lunch')).toBe('friday.title_tomorrow_lunch');
    expect(fridayTitleKey(0, 'morning')).toBe('friday.title_today_breakfast');
    expect(fridayTitleKey(1, 'late')).toBe('friday.title_tomorrow_dinner');
  });
  it('a pot’s «لحد» time is today on the city clock', () => {
    expect(clock(potUntilAt('16:00', at('2026-10-08 12:00')))).toBe('4:00');
  });
});

describe('visiblePots', () => {
  const pot = (open: boolean, id: string): TodayPot => ({ merchantOrgId: id, restaurantName: id, restaurantOpen: open, opensAt: null, dish: { id, name: id, priceIqd: 1000, photoUrl: null }, note: null, until: null, followed: false });
  it('open kitchens only, in the server’s order, at most six', () => {
    expect(visiblePots([pot(true, 'a'), pot(false, 'b'), pot(true, 'c')]).map((p) => p.merchantOrgId)).toEqual(['a', 'c']);
    expect(visiblePots(undefined)).toEqual([]);
    expect(visiblePots(Array.from({ length: 9 }, (_, i) => pot(true, `k${i}`)))).toHaveLength(6);
  });
});

describe('homeContext with habits (joy s3)', () => {
  it('Friday card, then the usual, then the last order — never over what is live', () => {
    expect(homeContext({ active: false, rajaaTrip: false, reorder: true, friday: true, usual: true })).toEqual(['friday']);
    expect(homeContext({ active: false, rajaaTrip: false, reorder: true, usual: true })).toEqual(['usual']);
    expect(homeContext({ active: true, rajaaTrip: false, reorder: true, friday: true, usual: true })).toEqual(['active']);
  });
});
