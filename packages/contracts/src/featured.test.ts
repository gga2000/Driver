import { describe, expect, it } from 'vitest';
import { featuredDay, featuredFirst } from './featured.js';

const k = (id: string, open = true, featured = false) => ({ id, open, featured });

describe('featuredFirst', () => {
  const noon = new Date('2026-10-12T09:00:00Z');
  it('moves the one open featured kitchen to the top, the rest keep their order', () => {
    expect(featuredFirst([k('a'), k('b'), k('c', true, true), k('d')], noon).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('never lifts a closed or paused featured kitchen', () => {
    expect(featuredFirst([k('a'), k('b', false, true)], noon).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('leaves a list with nothing featured as it is', () => {
    expect(featuredFirst([k('b'), k('a')], noon).map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('turns the seat over at Baghdad midnight among several featured kitchens', () => {
    const list = [k('a'), k('x', true, true), k('y', true, true)];
    const lateNight = new Date('2026-10-12T20:59:00Z'); // 23:59 in Baghdad
    const pastMidnight = new Date('2026-10-12T21:00:00Z'); // 00:00 the next day
    expect(featuredDay(pastMidnight)).toBe(featuredDay(lateNight) + 1);
    const tops = [featuredFirst(list, lateNight)[0]!.id, featuredFirst(list, pastMidnight)[0]!.id];
    expect(new Set(tops)).toEqual(new Set(['x', 'y']));
    expect(featuredFirst(list, noon)[0]!.id).toBe(featuredFirst(list, lateNight)[0]!.id);
  });
});
