import { describe, expect, it } from 'vitest';
import { arrivalAt, boardDays, boardSpan, dayCounts, filterBoard, hourBars, partOf, partsAhead, wishWindow } from './board-filters';

// 2026-10-07 10:00 Baghdad (07:00 UTC).
const now = new Date('2026-10-07T07:00:00Z');
const at = (iso: string) => ({ departAt: new Date(iso) });

describe('board days and parts (s2, s5)', () => {
  const days = boardDays(now);

  it('today, tomorrow and the day after, from Baghdad midnight', () => {
    expect(days.map((d) => d.id)).toEqual(['today', 'tomorrow', 'after']);
    expect(days[0]!.start.toISOString()).toBe('2026-10-06T21:00:00.000Z');
    expect(days[2]!.end.toISOString()).toBe('2026-10-09T21:00:00.000Z');
    expect(boardSpan(now)).toEqual({ from: now, to: days[2]!.end });
  });

  it('a car at 1 in the morning belongs to the night before', () => {
    const late = at('2026-10-07T22:00:00Z'); // 01:00 Baghdad on the 8th
    expect(filterBoard([late], days[0]!, 'night')).toHaveLength(1);
    expect(filterBoard([late], days[1]!, null)).toHaveLength(0);
  });

  it('counts cars per day and filters by part', () => {
    const deps = [at('2026-10-07T08:00:00Z'), at('2026-10-07T13:00:00Z'), at('2026-10-08T05:00:00Z')];
    expect(dayCounts(deps, days)).toEqual({ today: 2, tomorrow: 1, after: 0 });
    expect(filterBoard(deps, days[0]!, 'morning')).toEqual([deps[0]]); // 11:00 Baghdad
    expect(filterBoard(deps, days[0]!, 'afternoon')).toEqual([deps[1]]); // 16:00
    expect(filterBoard(deps, days[0]!, 'noon')).toEqual([]);
  });

  it('between midnight and 4, cars still leaving tonight stay on today (and today\'s night)', () => {
    // 02:51 Baghdad on the 9th (23:51 UTC on the 8th): the Elantra +20 min, the GMC +50, the Tahoe at 04:15.
    const small = new Date('2026-10-08T23:51:00Z');
    const d = boardDays(small);
    expect(d[0]!.start.toISOString()).toBe('2026-10-08T21:00:00.000Z');
    const elantra = at('2026-10-09T00:11:00Z');
    const gmc = at('2026-10-09T00:41:00Z');
    const tahoe = at('2026-10-09T01:15:00Z');
    const tonight = at('2026-10-09T16:00:00Z'); // 19:00 Baghdad
    const deps = [elantra, gmc, tahoe, tonight];
    expect(filterBoard(deps, d[0]!, null)).toEqual(deps);
    expect(filterBoard(deps, d[0]!, 'night')).toEqual([elantra, gmc, tonight]);
    expect(filterBoard(deps, d[0]!, 'morning')).toEqual([tahoe]);
    expect(dayCounts(deps, d)).toEqual({ today: 4, tomorrow: 0, after: 0 });
    // The night before stays off tomorrow and the day after.
    expect(filterBoard([elantra], d[1]!, null)).toEqual([]);
  });

  it('parts already over are gone from today', () => {
    expect(partsAhead(days[0]!, now)).toEqual(['morning', 'noon', 'afternoon', 'night']);
    expect(partsAhead(days[0]!, new Date('2026-10-07T13:00:00Z'))).toEqual(['afternoon', 'night']);
  });

  it('names the part of a time', () => {
    expect(partOf(new Date('2026-10-07T05:00:00Z'))).toBe('morning');
    expect(partOf(new Date('2026-10-07T10:30:00Z'))).toBe('noon');
    expect(partOf(new Date('2026-10-07T13:00:00Z'))).toBe('afternoon');
    expect(partOf(new Date('2026-10-07T22:00:00Z'))).toBe('night');
  });
});

describe('the day chart and arrival (x3, s6)', () => {
  it('one bar per hour from 4 in the morning', () => {
    const day = boardDays(now)[0]!;
    const bars = hourBars([at('2026-10-07T04:10:00Z'), at('2026-10-07T04:50:00Z'), at('2026-10-07T12:00:00Z')], day);
    expect(bars).toHaveLength(24);
    expect(bars[3]).toBe(2); // 07:00 Baghdad
    expect(bars[11]).toBe(1); // 15:00
  });

  it('arrival is the leave time plus the trip', () => {
    expect(arrivalAt(at('2026-10-07T04:00:00Z'), 95).toISOString()).toBe('2026-10-07T05:35:00.000Z');
  });
});

describe('one-tap «نبّهني» (s7)', () => {
  const days = boardDays(now);
  it('a part still ahead starts now and keeps its end', () => {
    expect(wishWindow(days[0]!, 'morning', now)).toEqual({ start: now, end: new Date('2026-10-07T09:00:00Z') });
  });
  it('a whole day is at most 12 hours from its start', () => {
    const w = wishWindow(days[1]!, null, now)!;
    expect(w.start.toISOString()).toBe('2026-10-08T01:00:00.000Z');
    expect(w.end.getTime() - w.start.getTime()).toBe(12 * 3600_000);
  });
  it('nothing when the part is over', () => {
    expect(wishWindow(days[0]!, 'morning', new Date('2026-10-07T09:00:00Z'))).toBeNull();
  });
});
