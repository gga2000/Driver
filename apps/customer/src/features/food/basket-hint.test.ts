import { describe, expect, it } from 'vitest';
import type { MenuItem } from '@driver/contracts';
import { basketGap, basketUpsell, pickHint, type BasketHintInput } from './basket-hint';
import { ME, type CartState } from './cart';
import { minOrderProgress } from './min-order';

const base: BasketHintInput = { progress: null, minOrderIqd: 5000, smallOrderFeeIqd: 500, nextDeal: null, applied: null, pointsEarn: null, grouped: false };

describe('pickHint: one strip at a time (b3)', () => {
  it('the minimum comes first, with the server fee that lets it go now', () => {
    const progress = minOrderProgress(3750, 5000);
    const h = pickHint({ ...base, progress, nextDeal: { missingIqd: 1250, label: 'كل لفة بـ 2,500' }, pointsEarn: 25 });
    expect(h).toEqual({ kind: 'min', progress: { doneIqd: 3750, shortIqd: 1250, ratio: 0.75 }, minOrderIqd: 5000, feeIqd: 500 });
  });
  it('then a deal not yet applied', () => {
    expect(pickHint({ ...base, nextDeal: { missingIqd: 1250, label: 'توصيل مجاني' }, pointsEarn: 25 })).toEqual({ kind: 'deal_unlock', missingIqd: 1250, label: 'توصيل مجاني' });
  });
  it('a deal already applied wins over unlocking another: deals never stack', () => {
    expect(pickHint({ ...base, nextDeal: { missingIqd: 1250, label: 'توصيل مجاني' }, applied: { label: 'كل لفة بـ 2,500', savingIqd: 500 } })).toEqual({
      kind: 'deal_applied',
      label: 'كل لفة بـ 2,500',
      savingIqd: 500,
    });
  });
  it('then points, and nothing when there is nothing to say', () => {
    expect(pickHint({ ...base, pointsEarn: 25, grouped: true })).toEqual({ kind: 'points', points: 25, grouped: true });
    expect(pickHint(base)).toBeNull();
    expect(pickHint({ ...base, pointsEarn: 0, applied: { label: null, savingIqd: 0 } })).toBeNull();
  });
});

const item = (id: string, name: string, priceIqd: number, patch: Partial<MenuItem> = {}): MenuItem => ({
  id,
  name,
  description: null,
  priceIqd,
  photoUrl: null,
  available: true,
  unavailableReason: null,
  prepTimeMin: 10,
  pointsEligible: true,
  modifierGroups: [],
  ...patch,
});

const menu = [
  { name: 'مشويات', items: [item('kebab', 'وجبة كباب', 13000), item('tikka', 'لفة تكة', 3000), item('wings', 'جوانح', 4500)] },
  { name: 'مقبلات', items: [item('hummus', 'حمص', 1500), item('salad', 'سلطة', 1250), item('soup', 'شوربة عدس', 2000)] },
  { name: 'مشروبات', items: [item('pepsi', 'ببسي', 750), item('laban', 'لبن', 1000)] },
];
const cart: CartState = {
  merchant: { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: { zoneKey: 'street_30' }, minOrderIqd: 5000 },
  lines: [{ key: 'l1', itemId: 'tikka', name: 'لفة تكة', basePriceIqd: 3000, modifiers: [], qty: 1, note: null, personId: ME }],
  people: [],
};

describe('basketUpsell: only when it helps (b6)', () => {
  it('shows nothing when there is no gap', () => {
    expect(basketUpsell(menu, cart, 0)).toEqual([]);
    expect(basketGap(pickHint({ ...base, pointsEarn: 25 }))).toBe(0);
  });
  it('only dishes that close the gap in one add, closest first, at most three, never one already in the basket', () => {
    const ids = basketUpsell(menu, cart, 1250).map((i) => i.id);
    expect(ids).toEqual(['salad', 'hummus', 'soup']);
    expect(ids).not.toContain('tikka');
  });
  it('skips dishes that need a choice before adding', () => {
    const withChoice = [{ name: 'مقبلات', items: [item('fattoush', 'فتوش', 2000, { modifierGroups: [{ id: 'g', name: 'الحجم', required: true, variant: true, min: 1, max: 1, modifiers: [] }] })] }];
    expect(basketUpsell(withChoice, cart, 1000)).toEqual([]);
  });
  it('takes the gap from the hint: the minimum, else a deal not yet applied', () => {
    expect(basketGap(pickHint({ ...base, progress: minOrderProgress(3000, 5000) }))).toBe(2000);
    expect(basketGap(pickHint({ ...base, nextDeal: { missingIqd: 1250, label: 'x' } }))).toBe(1250);
  });
});
