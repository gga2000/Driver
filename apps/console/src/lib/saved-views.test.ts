import { describe, expect, it } from 'vitest';
import { addView, MAX_VIEWS, parseViews, removeView, sameParams, trimParams } from './saved-views';

const D = { view: 'all', period: 'today', type: 'all', shop: '', sort: '' };

describe('saved order views (o5)', () => {
  it('keeps only what differs from the defaults', () => {
    expect(trimParams({ view: 'late', period: 'today', type: 'food', shop: '', extra: 'x' }, D)).toEqual({ view: 'late', type: 'food' });
    expect(sameParams({ view: 'late', period: 'today' }, { view: 'late', shop: '' }, D)).toBe(true);
    expect(sameParams({ view: 'late' }, { view: 'late', type: 'food' }, D)).toBe(false);
  });

  it('adds at the front, renames a twin instead of doubling it, and caps the list', () => {
    let list = addView([], 'المتأخرة', { view: 'late' }, D, 'a');
    list = addView(list, 'أكل', { type: 'food' }, D, 'b');
    expect(list.map((v) => v.id)).toEqual(['b', 'a']);
    list = addView(list, '  متأخرة هسة  ', { view: 'late', period: 'today' }, D, 'c');
    expect(list.map((v) => [v.id, v.name])).toEqual([
      ['b', 'أكل'],
      ['a', 'متأخرة هسة'],
    ]);
    expect(addView(list, '   ', { view: 'cancelled' }, D, 'd')).toHaveLength(2);
    for (let i = 0; i < 12; i++) list = addView(list, `v${i}`, { shop: `m${i}` }, D, `id${i}`);
    expect(list).toHaveLength(MAX_VIEWS);
    expect(list[0]!.id).toBe('id11');
    expect(removeView(list, 'id11').map((v) => v.id)).not.toContain('id11');
  });

  it('reads back whatever storage held without breaking', () => {
    expect(parseViews(null)).toEqual([]);
    expect(parseViews('x')).toEqual([]);
    expect(parseViews([{ id: 'a', name: 'ok', params: { view: 'late', n: 3 } }, { id: 1, name: 'bad' }, { id: 'b', name: ' ', params: {} }])).toEqual([{ id: 'a', name: 'ok', params: { view: 'late' } }]);
  });
});
