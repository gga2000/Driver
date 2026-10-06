import { describe, expect, it } from 'vitest';
import { closedArt } from './closed-art';

const at = (h: number) => new Date(2026, 9, 6, h, 30);

describe('closed kitchen art (J4)', () => {
  it('the night market only in the evening and at night', () => {
    expect(closedArt('hours', at(22))).toBe('night');
    expect(closedArt('hours', at(19))).toBe('night');
    expect(closedArt('hours', at(3))).toBe('night');
    expect(closedArt('hours', at(10))).toBe('clock');
    expect(closedArt(null, at(18))).toBe('clock');
  });

  it('a paused kitchen keeps the clock, night or day', () => {
    expect(closedArt('paused', at(23))).toBe('clock');
  });
});
