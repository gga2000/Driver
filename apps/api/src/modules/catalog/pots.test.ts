import { describe, expect, it } from 'vitest';
import { daysBefore, potDay, potShowing, potSuggestions } from './pots.js';

/** 2026-10-08 is a Thursday; 12:00 Baghdad = 09:00 UTC. */
const noon = new Date('2026-10-08T09:00:00Z');

describe('potDay / daysBefore', () => {
  it('reads the Baghdad date (21:30 UTC is already tomorrow there)', () => {
    expect(potDay(new Date('2026-10-07T21:30:00Z'))).toBe('2026-10-08');
    expect(potDay(noon)).toBe('2026-10-08');
  });
  it('steps back across a month', () => {
    expect(daysBefore('2026-10-03', 7)).toBe('2026-09-26');
  });
});

describe('potShowing', () => {
  it('shows today until its time, then not', () => {
    expect(potShowing({ localDate: '2026-10-08', until: '16:00' }, noon)).toBe(true);
    expect(potShowing({ localDate: '2026-10-08', until: '12:00' }, noon)).toBe(false);
    expect(potShowing({ localDate: '2026-10-08', until: null }, noon)).toBe(true);
  });
  it('never shows yesterday’s pot', () => {
    expect(potShowing({ localDate: '2026-10-07', until: null }, noon)).toBe(false);
  });
});

describe('potSuggestions', () => {
  const pots = [
    { localDate: '2026-10-01', itemId: 'bamia' },
    { localDate: '2026-10-05', itemId: 'fasoulia' },
    { localDate: '2026-10-06', itemId: 'dolma' },
    { localDate: '2026-10-07', itemId: 'fasoulia' },
  ];
  it('offers last week’s same day first, then the rest newest first, each once', () => {
    expect(potSuggestions(pots, '2026-10-08', () => true)).toEqual({ lastWeek: 'bamia', recent: ['fasoulia', 'dolma'] });
  });
  it('drops dishes no longer on sale', () => {
    expect(potSuggestions(pots, '2026-10-08', (id) => id !== 'bamia' && id !== 'dolma')).toEqual({ lastWeek: null, recent: ['fasoulia'] });
  });
  it('does not suggest what is already today’s pot', () => {
    expect(potSuggestions([...pots, { localDate: '2026-10-08', itemId: 'bamia' }], '2026-10-08', () => true)).toEqual({ lastWeek: null, recent: ['fasoulia', 'dolma'] });
  });
});
