import { describe, expect, it } from 'vitest';
import type { PublicSeason } from '@driver/contracts';
import { cueAllowed, LOUD_SEASON, SeasonState } from './season';

const QUIET: PublicSeason = { quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: '2026-11-13', kind: 'quiet', accent: false, ramadan: null, homeCard: null };
const at = (iso: string) => new Date(iso);
const times = { iftarAt: at('2027-02-08T14:39:00Z'), suhoorUntil: at('2027-02-09T02:25:00Z'), slotAt: at('2027-02-08T14:29:00Z') };
const RAMADAN: PublicSeason = { ...LOUD_SEASON, kind: 'ramadan', homeCard: { kind: 'ramadan', text_ar: null }, ramadan: { day: '2027-02-08', timetable: null, iftarAt: null, suhoorUntil: null, timetables: { sunni: times, shia: { ...times, iftarAt: at('2027-02-08T14:54:00Z') } } } };

describe('season', () => {
  it('starts as an ordinary day and tells listeners only when something changes', () => {
    const s = new SeasonState();
    expect(s.current).toEqual(LOUD_SEASON);
    let calls = 0;
    const off = s.subscribe(() => {
      calls += 1;
    });
    s.set({ ...LOUD_SEASON });
    expect(calls).toBe(0);
    s.set(QUIET);
    expect(s.current.quiet).toBe(true);
    expect(calls).toBe(1);
    off();
    s.set(LOUD_SEASON);
    expect(calls).toBe(1);
  });

  it('a new answer with the same Ramadan times (fresh Date objects) changes nothing; different times do', () => {
    const s = new SeasonState();
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.set(RAMADAN);
    s.set(structuredClone(RAMADAN));
    expect(calls).toBe(1);
    s.set({ ...RAMADAN, ramadan: { ...RAMADAN.ramadan!, timetables: { ...RAMADAN.ramadan!.timetables, shia: { ...times, iftarAt: at('2027-02-08T14:57:00Z') } } } });
    expect(calls).toBe(2);
  });

  it('a moment sound needs the in-app switch on and a day that is not quiet', () => {
    expect(cueAllowed(true, LOUD_SEASON)).toBe(true);
    expect(cueAllowed(false, LOUD_SEASON)).toBe(false);
    expect(cueAllowed(true, QUIET)).toBe(false);
  });
});
