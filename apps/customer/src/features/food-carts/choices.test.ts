import type { CartDish, CartDishGroup } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { addPick, chosen, needed, pickKey, picksOk, priceFrom, setQty, single, startPicks, toggle, unitPrice } from './choices';

const opt = (id: string, priceIqd: number, available = true) => ({ id, nameAr: id, priceIqd, available });

const SIZE: CartDishGroup = { id: 'size', nameAr: 'الحجم', minSelect: 1, maxSelect: 1, required: true, options: [opt('half', 0), opt('full', 1_000)] };
const EXTRAS: CartDishGroup = { id: 'extras', nameAr: 'إضافات', minSelect: 0, maxSelect: 2, required: false, options: [opt('egg', 500), opt('hot', 0), opt('cheese', 750)] };
const SAUCE: CartDishGroup = { id: 'sauce', nameAr: 'الصوص', minSelect: 0, maxSelect: 1, required: false, options: [opt('garlic', 0), opt('chili', 0)] };

function dish(groups: CartDishGroup[], over: Partial<CartDish> = {}): CartDish {
  return { itemId: 'laffa', nameAr: 'لفة', priceIqd: 1_500, available: true, photoUrl: null, description: null, groups, ...over };
}

describe('group kinds', () => {
  it('a size is pick-one and needed; extras are pick-any and optional', () => {
    expect(single(SIZE)).toBe(true);
    expect(needed(SIZE)).toBe(1);
    expect(single(EXTRAS)).toBe(false);
    expect(needed(EXTRAS)).toBe(0);
    expect(needed({ ...EXTRAS, minSelect: 2 })).toBe(2);
  });
});

describe('startPicks', () => {
  it('a required size starts on its first option on sale, extras start empty', () => {
    expect(startPicks(dish([SIZE, EXTRAS, SAUCE]))).toEqual({ size: ['half'], extras: [], sauce: [] });
  });

  it('skips a size that is off sale', () => {
    const d = dish([{ ...SIZE, options: [opt('half', 0, false), opt('full', 1_000)] }]);
    expect(startPicks(d)).toEqual({ size: ['full'] });
  });

  it('leaves a size empty when nothing is on sale', () => {
    const d = dish([{ ...SIZE, options: [opt('half', 0, false)] }]);
    expect(startPicks(d)).toEqual({ size: [] });
    expect(picksOk(d, startPicks(d))).toBe(false);
  });

  it('a plain dish has no picks and is fine as it is', () => {
    const d = dish([]);
    expect(startPicks(d)).toEqual({});
    expect(picksOk(d, {})).toBe(true);
  });
});

describe('toggle', () => {
  const d = dish([SIZE, EXTRAS, SAUCE]);

  it('a one-pick size swaps and can not be emptied', () => {
    let p = startPicks(d);
    p = toggle(d, p, 'size', 'full');
    expect(p.size).toEqual(['full']);
    p = toggle(d, p, 'size', 'full');
    expect(p.size).toEqual(['full']);
  });

  it('an optional one-pick group can be cleared by tapping again', () => {
    let p = startPicks(d);
    p = toggle(d, p, 'sauce', 'garlic');
    expect(p.sauce).toEqual(['garlic']);
    p = toggle(d, p, 'sauce', 'chili');
    expect(p.sauce).toEqual(['chili']);
    p = toggle(d, p, 'sauce', 'chili');
    expect(p.sauce).toEqual([]);
  });

  it('an any-pick group adds and removes, up to its max', () => {
    let p = startPicks(d);
    p = toggle(d, p, 'extras', 'egg');
    p = toggle(d, p, 'extras', 'hot');
    expect(p.extras).toEqual(['egg', 'hot']);
    const full = toggle(d, p, 'extras', 'cheese');
    expect(full).toBe(p);
    p = toggle(d, p, 'extras', 'egg');
    expect(p.extras).toEqual(['hot']);
  });

  it('an unknown group changes nothing', () => {
    const p = startPicks(d);
    expect(toggle(d, p, 'nope', 'x')).toBe(p);
  });

  it('does not change the picks it was given', () => {
    const p = startPicks(d);
    toggle(d, p, 'extras', 'egg');
    expect(p.extras).toEqual([]);
  });
});

describe('picksOk', () => {
  const d = dish([SIZE, EXTRAS]);
  it('needs the size and stays within the extras max', () => {
    expect(picksOk(d, { size: ['half'], extras: [] })).toBe(true);
    expect(picksOk(d, { size: [], extras: [] })).toBe(false);
    expect(picksOk(d, { extras: ['egg'] })).toBe(false);
    expect(picksOk(d, { size: ['half'], extras: ['egg', 'hot', 'cheese'] })).toBe(false);
    expect(picksOk(d, { size: ['half', 'full'] })).toBe(false);
  });
});

describe('chosen, unitPrice and pickKey', () => {
  const d = dish([SIZE, EXTRAS]);

  it('lists the picks in the dish order, whatever order they were tapped', () => {
    const c = chosen(d, { extras: ['hot', 'egg'], size: ['full'] });
    expect(c).toEqual([
      { groupId: 'size', optionId: 'full', nameAr: 'full', priceIqd: 1_000 },
      { groupId: 'extras', optionId: 'egg', nameAr: 'egg', priceIqd: 500 },
      { groupId: 'extras', optionId: 'hot', nameAr: 'hot', priceIqd: 0 },
    ]);
  });

  it('prices one dish with its size and extras', () => {
    expect(unitPrice(d, chosen(d, { size: ['full'], extras: ['egg'] }))).toBe(3_000);
    expect(unitPrice(d, chosen(d, { size: ['half'], extras: [] }))).toBe(1_500);
    expect(unitPrice(d, [])).toBe(1_500);
  });

  it('the key is the dish and its picks, in order', () => {
    expect(pickKey(d, chosen(d, { size: ['full'], extras: ['egg'] }))).toBe('laffa|full,egg');
    expect(pickKey(d, [])).toBe('laffa|');
    expect(pickKey(d, chosen(d, { extras: ['hot', 'egg'], size: ['half'] }))).toBe(pickKey(d, chosen(d, { size: ['half'], extras: ['egg', 'hot'] })));
  });
});

describe('addPick and setQty', () => {
  const d = dish([SIZE, EXTRAS]);
  const half = chosen(d, { size: ['half'] });
  const fullEgg = chosen(d, { size: ['full'], extras: ['egg'] });

  it('the same picks count up; different picks are their own line', () => {
    let list = addPick([], d, half);
    list = addPick(list, d, half, 2);
    list = addPick(list, d, fullEgg);
    expect(list.map((p) => [p.key, p.qty])).toEqual([
      ['laffa|half', 3],
      ['laffa|full,egg', 1],
    ]);
  });

  it('caps one line at 20', () => {
    let list = addPick([], d, half, 19);
    list = addPick(list, d, half, 5);
    expect(list[0]!.qty).toBe(20);
  });

  it('setQty changes one line and removes it at zero', () => {
    let list = addPick(addPick([], d, half), d, fullEgg);
    list = setQty(list, 'laffa|half', 4);
    expect(list.map((p) => p.qty)).toEqual([4, 1]);
    list = setQty(list, 'laffa|half', 0);
    expect(list.map((p) => p.key)).toEqual(['laffa|full,egg']);
    expect(setQty(list, 'laffa|full,egg', -1)).toEqual([]);
  });
});

describe('priceFrom', () => {
  it('«من» the smallest size when sizes change the price', () => {
    expect(priceFrom(dish([SIZE, EXTRAS]))).toEqual({ from: true, priceIqd: 1_500 });
  });

  it('starts at the cheapest size on sale', () => {
    const d = dish([{ ...SIZE, options: [opt('half', 0, false), opt('full', 1_000), opt('big', 2_000)] }]);
    expect(priceFrom(d)).toEqual({ from: true, priceIqd: 2_500 });
  });

  it('extras alone never make it «من»', () => {
    expect(priceFrom(dish([EXTRAS]))).toEqual({ from: false, priceIqd: 1_500 });
    expect(priceFrom(dish([]))).toEqual({ from: false, priceIqd: 1_500 });
  });

  it('sizes that all cost the same are not «من»', () => {
    expect(priceFrom(dish([{ ...SIZE, options: [opt('a', 0), opt('b', 0)] }]))).toEqual({ from: false, priceIqd: 1_500 });
  });

  it('a dearer size that is sold out does not make it «من»', () => {
    const size: CartDishGroup = { ...SIZE, options: [opt('half', 0), opt('full', 1_000, false)] };
    expect(priceFrom(dish([size]))).toEqual({ from: false, priceIqd: 1_500 });
  });
});
