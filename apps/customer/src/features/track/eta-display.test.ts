import { describe, expect, it } from 'vitest';
import { ETA_BOX_SHOWS_RANGE, etaBoxContent } from './eta-display';

const now = Date.parse('2026-10-07T15:00:00Z');
const at = (min: number) => new Date(now + min * 60_000);

describe('the ETA box (joy J5b)', () => {
  it('shows one time until Ali decides on the range (open question)', () => {
    expect(ETA_BOX_SHOWS_RANGE).toBe(false);
    expect(etaBoxContent({ eta: at(14), now, showRange: false })).toEqual({ kind: 'time', minutes: 14 });
  });
  it('a time already reached still says one minute, never zero or negative', () => {
    expect(etaBoxContent({ eta: at(-3), now, showRange: false })).toEqual({ kind: 'time', minutes: 1 });
  });
  it('the range option: the same honest spread as the map pill', () => {
    expect(etaBoxContent({ eta: at(15), now, showRange: true })).toEqual({ kind: 'range', minutes: 15, low: 12, high: 19 });
    expect(etaBoxContent({ eta: at(2), now, showRange: true })).toEqual({ kind: 'range', minutes: 2, low: 2, high: 4 });
  });
});
