import { describe, expect, it } from 'vitest';
import { ICON_NAMES, ICONS, iconShapes, type IconName } from './paths';

const SERVICE: IconName[] = ['food', 'taxi', 'tuktuk-fringe', 'rajaa', 'woman', 'family'];

/** Every number a shape uses (path coordinates, circle and rect values). */
function numbers(name: IconName): number[] {
  return iconShapes(name).flatMap((s) => ('d' in s ? (s.d.match(/-?\d*\.?\d+/g) ?? []).map(Number) : 'circle' in s ? [...s.circle] : [...s.rect]));
}

describe('service glyphs (joy S2-09)', () => {
  it('are in the set', () => {
    for (const n of SERVICE) expect(ICON_NAMES).toContain(n);
  });
  it('stay on the 24 px grid', () => {
    for (const n of SERVICE) for (const v of numbers(n)) expect(Math.abs(v), n).toBeLessThanOrEqual(24);
  });
  it('leave the glyphs the Partner app draws untouched', () => {
    expect(ICONS.tuktuk[0]).toEqual({ d: 'M4.5 16V8.5A2.5 2.5 0 0 1 7 6h7l3.6 5H20a.5.5 0 0 1 .5.5V16' });
    expect(ICONS.garage).toEqual([{ d: 'M3 21V9l9-5 9 5v12' }, { d: 'M7 21v-8.5h10V21' }, { d: 'M7 16.5h10' }]);
    expect(ICONS.bag).toEqual([{ d: 'M5 8h14l-1 12.5H6L5 8z' }, { d: 'M9 8V6.5a3 3 0 0 1 6 0V8' }]);
  });
});
