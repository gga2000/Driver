import { describe, expect, it } from 'vitest';
import { flattenHistory } from './history-list';

const keys = { coming: (c: string) => c, row: (r: string) => r };

describe('flattenHistory (speed m1)', () => {
  it('turns coming trips and day sections into labels and rows that open and close their cards', () => {
    const items = flattenHistory(['seat1'], [
      { id: 'running', running: true, day: null, rows: ['a'] },
      { id: '20370', running: false, day: { kind: 'today' }, rows: ['b', 'c'] },
    ], keys);
    expect(items.map((i) => [i.type, i.key, 'first' in i ? i.first : null, 'last' in i ? i.last : null])).toEqual([
      ['label', 'label:trips', true, null],
      ['coming', 'coming:seat1', true, true],
      ['label', 'label:running', false, null],
      ['row', 'row:a', true, true],
      ['label', 'label:20370', false, null],
      ['row', 'row:b', true, false],
      ['row', 'row:c', false, true],
    ]);
    expect(items[3]).toMatchObject({ tint: true });
    expect(items[5]).toMatchObject({ tint: false });
  });
  it('has nothing to draw for no orders', () => expect(flattenHistory([], [], keys)).toEqual([]));
});
