import { describe, expect, it } from 'vitest';
import type { RamadanToday, TimetableTimes } from '@driver/contracts';
import { daypart } from './daypart';
import { homeTimes, iftarOrderOpen, ramadanDay, ramadanPhase } from './ramadan-day';

/** Baghdad wall clock → instant. */
const at = (local: string) => new Date(`${local}:00+03:00`);
const sunni: TimetableTimes = { iftarAt: at('2027-02-08T17:39'), suhoorUntil: at('2027-02-09T05:25'), slotAt: at('2027-02-08T17:29') };
const shia: TimetableTimes = { iftarAt: at('2027-02-08T17:54'), suhoorUntil: at('2027-02-09T05:25'), slotAt: at('2027-02-08T17:44') };
const TODAY: RamadanToday = { day: '2027-02-08', timetable: null, iftarAt: null, suhoorUntil: null, timetables: { sunni, shia } };
const dayAt = (local: string, pick: 'sunni' | 'shia' | null = 'sunni', ramadan: RamadanToday | null = TODAY) => {
  const now = at(local);
  return ramadanDay(ramadan, pick, now, daypart(now).hour);
};

describe('home through a Ramadan day (home roast 4)', () => {
  it('follows the fast: iftar food in the day, the last 3 hours, sweets after iftar, suhoor at night', () => {
    expect(dayAt('2027-02-08T13:00')?.phase).toBe('fast');
    expect(dayAt('2027-02-08T14:38')?.phase).toBe('fast');
    expect(dayAt('2027-02-08T14:39')?.phase).toBe('iftar_soon');
    expect(dayAt('2027-02-08T17:38')?.phase).toBe('iftar_soon');
    expect(dayAt('2027-02-08T17:40')?.phase).toBe('after_iftar');
    expect(dayAt('2027-02-08T22:59')?.phase).toBe('after_iftar');
    expect(dayAt('2027-02-08T23:00')?.phase).toBe('suhoor');
    expect(dayAt('2027-02-09T02:30')?.phase).toBe('suhoor');
  });

  it('nothing on an ordinary day or once the last evening’s fast is broken', () => {
    expect(dayAt('2027-02-08T13:00', 'sunni', null)).toBeNull();
    const lastDay: RamadanToday = { ...TODAY, timetables: { sunni: { ...sunni, suhoorUntil: null }, shia: { ...shia, suhoorUntil: null } } };
    expect(dayAt('2027-02-08T13:00', 'sunni', lastDay)?.phase).toBe('fast');
    expect(dayAt('2027-02-08T19:00', 'sunni', lastDay)).toBeNull();
    expect(ramadanPhase(null, 13)).toBeNull();
  });

  it('before a timetable is picked it goes by the later adhan, so no sweets while anyone is still fasting', () => {
    expect(homeTimes(TODAY, null)).toBe(shia);
    expect(homeTimes(TODAY, 'sunni')).toBe(sunni);
    expect(dayAt('2027-02-08T17:45', null)?.phase).toBe('iftar_soon');
    expect(dayAt('2027-02-08T17:45', 'sunni')?.phase).toBe('after_iftar');
  });

  it('the dish button orders for iftar only with a picked timetable, while checkout still offers the slot', () => {
    const open = (local: string, pick: 'sunni' | 'shia' | null = 'sunni') => iftarOrderOpen(dayAt(local, pick), pick, at(local));
    expect(open('2027-02-08T13:00')).toBe(true);
    expect(open('2027-02-08T16:44')).toBe(true);
    expect(open('2027-02-08T16:45')).toBe(false);
    expect(open('2027-02-08T13:00', null)).toBe(false);
    expect(open('2027-02-08T20:00')).toBe(false);
    expect(iftarOrderOpen(null, 'sunni', at('2027-02-08T13:00'))).toBe(false);
  });
});
