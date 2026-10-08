import { describe, expect, it } from 'vitest';
import { weekRuns } from './week';

const noonToMidnight = [{ start: '12:00', end: '00:00' }];

describe('the week on المحل', () => {
  it('folds days with the same hours, Saturday first', () => {
    const days = Array.from({ length: 7 }, (_, dow) => ({ dow, shifts: dow === 5 ? [{ start: '13:15', end: '00:00' }] : noonToMidnight }));
    expect(weekRuns(days).map((r) => [r.from, r.to, r.shifts.length])).toEqual([
      [6, 4, 1],
      [5, 5, 1],
    ]);
  });

  it('keeps a closed day on its own line', () => {
    const days = Array.from({ length: 7 }, (_, dow) => ({ dow, shifts: dow === 2 ? [] : noonToMidnight }));
    expect(weekRuns(days).map((r) => [r.from, r.to])).toEqual([
      [6, 1],
      [2, 2],
      [3, 5],
    ]);
  });
});
