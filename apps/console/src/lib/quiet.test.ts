import { describe, expect, it } from 'vitest';
import { baghdadToday, quietRange } from './quiet';

describe('quiet days helpers', () => {
  it('today follows Baghdad midnight, not UTC', () => {
    expect(baghdadToday(new Date('2026-11-12T20:59:00Z'))).toBe('2026-11-12');
    expect(baghdadToday(new Date('2026-11-12T21:00:00Z'))).toBe('2026-11-13');
  });

  it('a range reads as day/month, one date when it is one day', () => {
    expect(quietRange('2026-11-13', '2026-11-13')).toBe('13/11');
    expect(quietRange('2027-06-06', '2027-06-18')).toBe('6/6 – 18/6');
  });
});
