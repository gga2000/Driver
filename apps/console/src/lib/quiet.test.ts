import { describe, expect, it } from 'vitest';
import { baghdadInstant, baghdadToday, quietRange, seasonSwitchesOn } from './quiet';

describe('quiet days helpers', () => {
  it('today follows Baghdad midnight, not UTC', () => {
    expect(baghdadToday(new Date('2026-11-12T20:59:00Z'))).toBe('2026-11-12');
    expect(baghdadToday(new Date('2026-11-12T21:00:00Z'))).toBe('2026-11-13');
  });

  it('a range reads as day/month, one date when it is one day', () => {
    expect(quietRange('2026-11-13', '2026-11-13')).toBe('13/11');
    expect(quietRange('2027-06-06', '2027-06-18')).toBe('\u20676/6 – 18/6\u2069');
  });

  it('a Baghdad wall-clock time on a day is the right instant (UTC+3)', () => {
    expect(baghdadInstant('2027-02-08', '17:39').toISOString()).toBe('2027-02-08T14:39:00.000Z');
    expect(baghdadInstant('2027-02-08', '01:30').toISOString()).toBe('2027-02-07T22:30:00.000Z');
  });

  it('names the switches a season keeps on; a quiet day keeps none', () => {
    expect(seasonSwitchesOn({ celebrations: true, sounds: false, promos: true, accent: true, homeCard: true })).toEqual(['celebrations', 'promos', 'accent', 'card']);
    expect(seasonSwitchesOn({ celebrations: false, sounds: false, promos: false, accent: false, homeCard: false })).toEqual([]);
  });
});
