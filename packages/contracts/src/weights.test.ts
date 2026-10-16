import { describe, expect, it } from 'vitest';
import { kiloPriceOf, weightOf, weightOptions } from './weights.js';

const g = (variant: boolean, names: Array<[string, number]>) => ({
  id: 'g1',
  variant,
  modifiers: names.map(([name, priceIqd], i) => ({ id: `m${i}`, name, priceIqd, available: true })),
});

describe('weights (s1, m2)', () => {
  it('reads the Iraqi ways of saying a weight', () => {
    expect(weightOf('ربع كيلو')).toBe('quarter');
    expect(weightOf('نص كيلو')).toBe('half');
    expect(weightOf('نصف كيلو')).toBe('half');
    expect(weightOf('كيلو')).toBe('kilo');
    expect(weightOf('1 كيلو')).toBe('kilo');
    expect(weightOf('كيلو واحد')).toBe('kilo');
    expect(weightOf('٢ كيلو')).toBeNull();
    expect(weightOf('نص دجاجة')).toBeNull();
    expect(weightOf('كبير')).toBeNull();
  });

  it('finds the weight variant and prices each weight in full', () => {
    const item = { priceIqd: 5000, modifierGroups: [g(true, [['ربع كيلو', 0], ['نص كيلو', 5000], ['كيلو', 15000]])] };
    expect(weightOptions(item)?.map((w) => [w.step, w.priceIqd])).toEqual([
      ['quarter', 5000],
      ['half', 10000],
      ['kilo', 20000],
    ]);
    expect(kiloPriceOf(item)).toBe(20000);
  });

  it('ignores sizes, flavours and groups that are not variants', () => {
    expect(weightOptions({ priceIqd: 2500, modifierGroups: [g(true, [['وسط', 0], ['كبير', 500]])] })).toBeNull();
    expect(weightOptions({ priceIqd: 2500, modifierGroups: [g(false, [['ربع كيلو', 0], ['كيلو', 9000]])] })).toBeNull();
    expect(kiloPriceOf({ priceIqd: 3000, modifierGroups: [g(true, [['ربع كيلو', 0], ['نص كيلو', 3000]])] })).toBeNull();
  });
});
