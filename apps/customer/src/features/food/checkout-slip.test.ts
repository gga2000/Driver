import { describe, expect, it } from 'vitest';
import { CHANGE_RULES, tenderOptions } from '@driver/contracts';
import type { CartLine } from './cart';
import { changeNote, priceChanges, quickSlots, slipDishes } from './checkout-slip';

const line = (key: string, name: string, basePriceIqd: number, qty = 1, extra = 0): CartLine => ({
  key,
  itemId: `i_${key}`,
  name,
  basePriceIqd,
  modifiers: extra ? [{ groupId: 'g', modifierId: 'm', name: 'جبن', priceIqd: extra }] : [],
  qty,
  note: null,
  personId: 'me',
});

describe('slipDishes', () => {
  it('lists every line at its menu price with who it is for', () => {
    const dishes = slipDishes({ lines: [line('a', 'وجبة كباب', 13_000), line('b', 'لفة تكة', 2_500, 1, 500), line('c', 'ببسي', 750, 2)] }, (l) => (l.key === 'b' ? 'سارة' : null));
    expect(dishes).toEqual([
      { key: 'a', name: 'وجبة كباب', qty: 1, who: null, amountIqd: 13_000 },
      { key: 'b', name: 'لفة تكة', qty: 1, who: 'سارة', amountIqd: 3_000 },
      { key: 'c', name: 'ببسي', qty: 2, who: null, amountIqd: 1_500 },
    ]);
  });
});

describe('changeNote (c5, the shared 25,000 cap)', () => {
  it('reads the cap from the shared change rules', () => {
    expect(CHANGE_RULES.maxIqd).toBe(25_000);
  });

  it('says exact when he pays the total', () => {
    expect(changeNote(17_500, 17_500)).toEqual({ kind: 'exact' });
  });

  it('says the courier brings the change on 20,000 for 17,500', () => {
    expect(changeNote(20_000, 17_500)).toEqual({ kind: 'change', changeIqd: 2_500 });
  });

  it('keeps 25,000 of change as change-or-credit (at the cap)', () => {
    expect(changeNote(50_000, 25_000)).toEqual({ kind: 'change', changeIqd: 25_000 });
  });

  it('says cash only when the change is above the cap (50,000 on 17,500)', () => {
    expect(changeNote(50_000, 17_500)).toEqual({ kind: 'cash_only', changeIqd: 32_500 });
  });

  it('matches the server chips for 17,500', () => {
    expect(tenderOptions(17_500)).toEqual([17_500, 20_000, 25_000, 50_000]);
  });
});

describe('priceChanges (c12)', () => {
  it('lists repriced and gone lines, old beside new, and skips unchanged ones', () => {
    const before = [line('a', 'وجبة كباب', 13_000), line('b', 'لفة تكة', 2_500, 2), line('c', 'ببسي', 750)];
    const after = [line('a', 'وجبة كباب', 13_000), line('b', 'لفة تكة', 3_000, 2)];
    expect(priceChanges(before, after)).toEqual([
      { key: 'b', name: 'لفة تكة', oldIqd: 5_000, newIqd: 6_000 },
      { key: 'c', name: 'ببسي', oldIqd: 750, newIqd: null },
    ]);
  });

  it('is empty when nothing moved', () => {
    const lines = [line('a', 'وجبة كباب', 13_000)];
    expect(priceChanges(lines, lines)).toEqual([]);
  });
});

describe('quickSlots (c9)', () => {
  it('takes the first two slots for the chips', () => {
    expect(quickSlots([1, 2, 3, 4])).toEqual([1, 2]);
    expect(quickSlots([1])).toEqual([1]);
    expect(quickSlots([], 2)).toEqual([]);
  });
});
