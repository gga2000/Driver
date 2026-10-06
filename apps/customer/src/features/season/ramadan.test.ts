import { describe, expect, it } from 'vitest';
import type { PublicSeason, TimetableTimes } from '@driver/contracts';
import { LOUD_SEASON } from '@/lib/season';
import { createMemoryStorage } from '@/lib/storage';
import { iftarLeadMinutes, ramadanLine, seasonCard, timesFor, withIftarSlot } from './ramadan';
import { TIMETABLE_PREF_KEY, TimetablePref } from './timetable-pref';

/** Baghdad wall clock → instant. */
const at = (local: string) => new Date(`${local}:00+03:00`);
const sunni: TimetableTimes = { iftarAt: at('2027-02-08T17:39'), suhoorUntil: at('2027-02-09T05:25'), slotAt: at('2027-02-08T17:29') };
const shia: TimetableTimes = { iftarAt: at('2027-02-08T17:54'), suhoorUntil: at('2027-02-09T05:25'), slotAt: at('2027-02-08T17:44') };
const RAMADAN: PublicSeason = {
  ...LOUD_SEASON,
  kind: 'ramadan',
  homeCard: { kind: 'ramadan', text_ar: null },
  ramadan: { day: '2027-02-08', timetable: null, iftarAt: null, suhoorUntil: null, timetables: { sunni, shia } },
};

describe('Ramadan card', () => {
  it('never assumes a timetable: without a pick the card asks', () => {
    expect(timesFor(RAMADAN.ramadan, null)).toBeNull();
    expect(seasonCard(RAMADAN, null, at('2027-02-08T12:00'))).toEqual({ kind: 'ramadan', title: null, accent: true, line: 'pick' });
  });

  it('counts down to iftar on the picked timetable, rounding up', () => {
    expect(seasonCard(RAMADAN, 'shia', at('2027-02-08T12:00'))).toMatchObject({ line: { kind: 'iftar', minutes: 354 } });
    expect(ramadanLine(sunni, new Date(at('2027-02-08T17:38').getTime() + 30_000))).toMatchObject({ kind: 'iftar', minutes: 1 });
  });

  it('before dawn and after iftar it says until when suhoor runs; on the last evening nothing more', () => {
    const night: TimetableTimes = { ...sunni, suhoorUntil: at('2027-02-08T05:26') };
    expect(ramadanLine(night, at('2027-02-08T03:00'))).toEqual({ kind: 'suhoor', at: at('2027-02-08T05:26') });
    expect(ramadanLine(sunni, at('2027-02-08T19:00'))).toEqual({ kind: 'suhoor', at: at('2027-02-09T05:25') });
    expect(ramadanLine({ ...sunni, suhoorUntil: null }, at('2027-02-08T19:00'))).toEqual({ kind: 'none' });
  });

  it('Eid greets without naming a day; a special Friday needs ops words; quiet days carry no accent', () => {
    expect(seasonCard({ ...LOUD_SEASON, kind: 'eid', homeCard: { kind: 'eid', text_ar: null } }, null, at('2027-03-10T10:00'))).toEqual({ kind: 'eid', title: null, accent: true });
    expect(seasonCard({ ...LOUD_SEASON, homeCard: { kind: 'friday_special', text_ar: null } }, null, at('2026-10-09T10:00'))).toBeNull();
    expect(seasonCard({ ...RAMADAN, kind: 'quiet', quiet: true, accent: false }, 'sunni', at('2027-02-27T12:00'))).toMatchObject({ kind: 'ramadan', accent: false });
    expect(seasonCard(LOUD_SEASON, 'sunni', at('2027-02-08T12:00'))).toBeNull();
  });
});

describe('checkout iftar slot', () => {
  const half = [at('2027-02-08T13:00'), at('2027-02-08T13:30'), at('2027-02-08T17:30')];

  it('adds the server slot in time order when far enough ahead; none without a pick', () => {
    expect(withIftarSlot(half, sunni, at('2027-02-08T12:10'), 45).map((s) => [s.at.toISOString(), s.iftar])).toEqual([
      [at('2027-02-08T13:00').toISOString(), false],
      [at('2027-02-08T13:30').toISOString(), false],
      [at('2027-02-08T17:29').toISOString(), true],
      [at('2027-02-08T17:30').toISOString(), false],
    ]);
    expect(withIftarSlot(half, null, at('2027-02-08T12:10'), 45).some((s) => s.iftar)).toBe(false);
  });

  it('too close to the adhan: no iftar slot; a half-hour slot at the same minute turns into it', () => {
    expect(withIftarSlot(half, sunni, at('2027-02-08T16:50'), 45).some((s) => s.iftar)).toBe(false);
    const same = withIftarSlot([at('2027-02-08T17:29')], sunni, at('2027-02-08T12:00'), 45);
    expect(same).toEqual([{ at: at('2027-02-08T17:29'), iftar: true }]);
  });

  it('says how long before the adhan it arrives', () => {
    expect(iftarLeadMinutes(sunni)).toBe(10);
  });
});

describe('timetable pick', () => {
  it('starts unpicked and remembers the pick', async () => {
    const store = createMemoryStorage();
    const pref = new TimetablePref(store);
    await pref.load();
    expect(pref.current).toBeNull();
    const heard: Array<string | null> = [];
    pref.subscribe((v) => heard.push(v));
    await pref.set('shia');
    expect(heard).toEqual(['shia']);
    expect(store.dump()[TIMETABLE_PREF_KEY]).toBe('shia');
    const again = new TimetablePref(store);
    await again.load();
    expect(again.current).toBe('shia');
  });
});
