import { describe, expect, it } from 'vitest';
import type { HomeSlot, MenuCategory, MenuItem, RestaurantCard } from '@driver/contracts';
import { aheadCopy, dayChip, dayLeft, filterKitchens, firstOpenSlot, platesOf, splitMenu } from './format';

const kitchen = (id: string, home: { readyCount: number; reserveCount: number }, tags: string[] = []) => ({ id, tags, home: { monogram: 'ح', ...home } }) as unknown as RestaurantCard;
const item = (id: string, mode?: 'ready' | 'reserve') => ({ id, home: mode ? { mode } : undefined }) as unknown as MenuItem;
const slot = (at: string, left: number): HomeSlot => ({ at: new Date(at), left });

describe('أكل بيت, the customer screens', () => {
  it('filters kitchens by plates ready now, reservations, or sweets', () => {
    const list = [kitchen('a', { readyCount: 2, reserveCount: 0 }), kitchen('b', { readyCount: 0, reserveCount: 3 }), kitchen('c', { readyCount: 0, reserveCount: 0 }, ['sweets'])];
    expect(filterKitchens(list, 'all').map((k) => k.id)).toEqual(['a', 'b', 'c']);
    expect(filterKitchens(list, 'ready').map((k) => k.id)).toEqual(['a']);
    expect(filterKitchens(list, 'reserve').map((k) => k.id)).toEqual(['b']);
    expect(filterKitchens(list, 'sweets').map((k) => k.id)).toEqual(['c']);
  });

  it('says how far ahead to book in whole hours or days', () => {
    expect(aheadCopy(0)).toBeNull();
    expect(aheadCopy(60)).toEqual({ key: 'home_food.ahead_hour' });
    expect(aheadCopy(120)).toEqual({ key: 'home_food.ahead_2hours' });
    expect(aheadCopy(240)).toEqual({ key: 'home_food.ahead_hours', params: { n: 4 } });
    expect(aheadCopy(1440)).toEqual({ key: 'home_food.ahead_day' });
    expect(aheadCopy(2880)).toEqual({ key: 'home_food.ahead_2days' });
  });

  it('labels day chips اليوم, باچر, then the weekday, over the date', () => {
    const now = new Date('2026-10-12T09:00:00Z'); // Monday in Iraq
    expect(dayChip({ day: '2026-10-12', dow: 1 }, now)).toEqual({ label: { key: 'time.today' }, date: 12 });
    expect(dayChip({ day: '2026-10-13', dow: 2 }, now)).toEqual({ label: { key: 'time.tomorrow' }, date: 13 });
    expect(dayChip({ day: '2026-10-15', dow: 4 }, now)).toEqual({ label: { key: 'home_food.dow_4' }, date: 15 });
  });

  it('a day is full when no time has a plate left; the first free time is picked', () => {
    const day = [slot('2026-10-13T10:00:00Z', 0), slot('2026-10-13T16:00:00Z', 2)];
    expect(dayLeft(day)).toBe(2);
    expect(firstOpenSlot(day)?.left).toBe(2);
    const full = [slot('2026-10-13T10:00:00Z', 0)];
    expect(dayLeft(full)).toBe(0);
    expect(firstOpenSlot(full)).toBe(full[0]);
    expect(firstOpenSlot([])).toBeNull();
  });

  it('splits the menu into ready and reservation dishes in menu order', () => {
    const cats = [{ items: [item('a', 'ready'), item('b', 'reserve')] }, { items: [item('c'), item('d', 'reserve')] }] as unknown as MenuCategory[];
    const { ready, reserve } = splitMenu(cats);
    expect(ready.map((i) => i.id)).toEqual(['a', 'c']);
    expect(reserve.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('draws plates as dots up to ten, a count above', () => {
    expect(platesOf({ mode: 'ready', cooked: 6, left: 4 } as never)).toEqual({ total: 6, left: 4, dots: true });
    expect(platesOf({ mode: 'ready', cooked: null, left: 3 } as never)).toEqual({ total: 3, left: 3, dots: true });
    expect(platesOf({ mode: 'ready', cooked: 20, left: 12 } as never)).toEqual({ total: 20, left: 12, dots: false });
  });
});
