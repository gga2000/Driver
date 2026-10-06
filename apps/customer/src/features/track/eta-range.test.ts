import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { mapMinutesLabel, minutesRange } from './eta-range';

const t = createT('ar-IQ');

describe('minutes on the map (f19, maps c3)', () => {
  it('one number when routed on real roads; a range when it is a straight-line estimate', () => {
    expect(minutesRange(8, 'road')).toEqual({ low: 8, high: 8 });
    expect(minutesRange(8, null)).toEqual({ low: 8, high: 8 });
    expect(minutesRange(8, 'estimated')).toEqual({ low: 6, high: 10 });
    expect(minutesRange(1, 'estimated')).toEqual({ low: 1, high: 3 });
    expect(minutesRange(20, 'estimated')).toEqual({ low: 16, high: 25 });
  });
  it('labels: the single pill as before, a range in an isolated left-to-right run', () => {
    expect(mapMinutesLabel(t, 8, 'road')).toBe('8 دقايق');
    expect(mapMinutesLabel(t, 2, 'road')).toBe('دقيقتين');
    expect(mapMinutesLabel(t, 14, 'road')).toBe('14 دقيقة');
    expect(mapMinutesLabel(t, 8, 'estimated')).toBe('\u20676–10\u2069 دقايق');
    expect(mapMinutesLabel(t, 20, 'estimated')).toBe('\u206716–25\u2069 دقيقة');
  });
});
