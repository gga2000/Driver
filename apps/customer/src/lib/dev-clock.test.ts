import { describe, expect, it } from 'vitest';
import { appNow, parseDevNow } from './dev-clock';

const real = new Date('2026-10-06T10:00:00Z'); // 13:00 Baghdad

describe('dev clock (?now=, screenshots only)', () => {
  it('reads a Baghdad wall-clock time as today', () => {
    expect(parseDevNow('07:30', real)?.toISOString()).toBe('2026-10-06T04:30:00.000Z');
    expect(parseDevNow('23:15', real)?.toISOString()).toBe('2026-10-06T20:15:00.000Z');
  });
  it('takes the Baghdad date, not the UTC one, near midnight', () => {
    expect(parseDevNow('01:00', new Date('2026-10-06T22:00:00Z'))?.toISOString()).toBe('2026-10-06T22:00:00.000Z');
  });
  it('reads a full date', () => {
    expect(parseDevNow('2026-10-09T13:00:00+03:00', real)?.toISOString()).toBe('2026-10-09T10:00:00.000Z');
  });
  it('ignores what it cannot read', () => {
    expect(parseDevNow('25:00', real)).toBeNull();
    expect(parseDevNow('soon', real)).toBeNull();
    expect(parseDevNow(null, real)).toBeNull();
  });
  it('is the real clock when nothing was asked (tests run without a window)', () => {
    expect(appNow(real.getTime()).getTime()).toBe(real.getTime());
  });
});
