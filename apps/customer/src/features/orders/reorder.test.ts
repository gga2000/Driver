import { describe, expect, it } from 'vitest';
import type { MenuCategory, MenuItem, Order, OrderLine } from '@driver/contracts';
import { ME } from '@/features/food/cart';
import { buildReorderCart, itemsSummary, reorderIsClean } from './reorder';

const bread = { id: 'g_bread', name: 'الخبز', required: true, min: 1, max: 1, variant: false, modifiers: [
  { id: 'm_samoon', name: 'صمون', priceIqd: 0, available: true },
  { id: 'm_tannour', name: 'تنور', priceIqd: 250, available: true },
] };
const extras = { id: 'g_extra', name: 'إضافات', required: false, min: 0, max: 3, variant: false, modifiers: [
  { id: 'm_cheese', name: 'جبن', priceIqd: 500, available: false },
  { id: 'm_onion', name: 'بصل', priceIqd: 0, available: true },
] };

function item(id: string, name: string, priceIqd: number, over: Partial<MenuItem> = {}): MenuItem {
  return { id, name, description: null, priceIqd, photoUrl: null, available: true, unavailableReason: null, prepTimeMin: 10, pointsEligible: true, modifierGroups: [], ...over } as MenuItem;
}

const categories: MenuCategory[] = [
  {
    id: 'c1',
    name: 'لفات',
    items: [
      item('tikka', 'لفة تكة', 2500, { modifierGroups: [bread, extras] as MenuItem['modifierGroups'] }),
      item('liver', 'لفة كبد', 1750),
      item('hummus', 'حمص', 2000, { available: false, unavailableReason: 'sold_out' }),
      item('tea', 'چاي', 500, { available: false, unavailableReason: 'schedule' }),
    ],
  },
];
const restaurant = { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: null, minOrderIqd: 5000, open: true, opensAt: null };

function line(id: string, catalogItemId: string | null, qty: number, unitPriceIqd: number, over: Partial<OrderLine> = {}): OrderLine {
  return { id, catalogItemId, freeText: null, qty, unitPriceIqd, modifiers: [], participantId: null, note: null, pointsEligible: true, availability: 'available', ...over };
}

const order = (lines: OrderLine[], participants: Order['participants'] = []) => ({ lines, participants });

describe('buildReorderCart (اطلبه مرة ثانية)', () => {
  it('rebuilds the same dishes, choices, notes and quantities at today\'s menu prices', () => {
    const r = buildReorderCart({
      order: order([
        line('l1', 'tikka', 2, 2500, { modifiers: [{ groupId: 'g_bread', modifierId: 'm_tannour', priceIqd: 250 }, { groupId: 'g_extra', modifierId: 'm_onion', priceIqd: 0 }], note: 'بدون طماطة' }),
        line('l2', 'liver', 1, 1500),
      ]),
      items: [],
      menu: { restaurant, categories },
    });
    expect(r.cart.merchant).toMatchObject({ id: 'org_1', name: 'مطعم خالد', minOrderIqd: 5000 });
    expect(r.cart.lines.map((l) => [l.itemId, l.qty, l.basePriceIqd, l.modifiers.map((m) => m.modifierId), l.note, l.personId])).toEqual([
      ['tikka', 2, 2500, ['m_tannour', 'm_onion'], 'بدون طماطة', ME],
      ['liver', 1, 1750, [], null, ME],
    ]);
    expect(r.added).toEqual(['لفة تكة', 'لفة كبد']);
    // The liver wrap went up from 1,500 to 1,750: said, never silent.
    expect(r.repriced).toEqual([{ name: 'لفة كبد', wasIqd: 1500, nowIqd: 1750 }]);
    expect(r.missing).toEqual([]);
    expect(reorderIsClean(r)).toBe(false);
  });

  it('leaves out what left the menu, ran out or is off-schedule, and says which and why', () => {
    const r = buildReorderCart({
      order: order([line('l1', 'liver', 1, 1750), line('l2', 'hummus', 2, 2000), line('l3', 'tea', 1, 500), line('l4', 'gone_item', 1, 3000), line('l5', 'liver', 1, 1750, { availability: 'removed' })]),
      items: [{ lineId: 'l4', name: 'دولمة' }],
      menu: { restaurant, categories },
    });
    expect(r.cart.lines.map((l) => [l.itemId, l.qty])).toEqual([['liver', 1]]);
    expect(r.missing).toEqual([
      { name: 'حمص', qty: 2, reason: 'sold_out' },
      { name: 'چاي', qty: 1, reason: 'schedule' },
      { name: 'دولمة', qty: 1, reason: 'gone' },
    ]);
    expect(r.repriced).toEqual([]);
  });

  it('drops an optional extra that is gone, but never guesses a required choice', () => {
    const extraGone = buildReorderCart({
      order: order([line('l1', 'tikka', 1, 2500, { modifiers: [{ groupId: 'g_bread', modifierId: 'm_samoon', priceIqd: 0 }, { groupId: 'g_extra', modifierId: 'm_cheese', priceIqd: 500 }] })]),
      items: [],
      menu: { restaurant, categories },
    });
    expect(extraGone.cart.lines[0]!.modifiers.map((m) => m.modifierId)).toEqual(['m_samoon']);
    expect(extraGone.droppedExtras).toEqual([{ dish: 'لفة تكة', extra: 'جبن' }]);
    // 3,000 with cheese then, 2,500 without it now.
    expect(extraGone.repriced).toEqual([{ name: 'لفة تكة', wasIqd: 3000, nowIqd: 2500 }]);

    const breadGone = buildReorderCart({
      order: order([line('l1', 'tikka', 1, 2500, { modifiers: [{ groupId: 'g_bread', modifierId: 'm_old_bread', priceIqd: 0 }] })]),
      items: [],
      menu: { restaurant, categories },
    });
    expect(breadGone.cart.lines).toEqual([]);
    expect(breadGone.cart.merchant).toBeNull();
    expect(breadGone.missing).toEqual([{ name: 'لفة تكة', qty: 1, reason: 'choice_gone' }]);
    expect(breadGone.droppedExtras).toEqual([]);
  });

  it('keeps who each dish was for: a saved person by name (with his phone), else a new one', () => {
    const participants = [
      { id: 'pa', role: 'diner' as const, personId: null, phoneOnly: true, label: 'سارة', note: null },
      { id: 'pb', role: 'diner' as const, personId: null, phoneOnly: true, label: 'منار', note: null },
    ];
    const r = buildReorderCart({
      order: order([line('l1', 'liver', 1, 1750, { participantId: 'pa' }), line('l2', 'liver', 1, 1750, { participantId: 'pb' }), line('l3', 'liver', 1, 1750)], participants),
      items: [],
      menu: { restaurant, categories },
      savedPeople: [{ id: 'pp_sara', name: 'سارة', phone: '+9647701234567' }],
    });
    expect(r.cart.lines.map((l) => l.personId)).toEqual(['pp_sara', 'pp_re_pb', ME]);
    expect(r.cart.people).toEqual([
      { id: 'pp_sara', name: 'سارة', phone: '+9647701234567' },
      { id: 'pp_re_pb', name: 'منار', phone: null },
    ]);
  });

  it('is clean only when everything came back as it was and the kitchen is open', () => {
    const same = { order: order([line('l1', 'liver', 3, 1750)]), items: [], menu: { restaurant, categories } };
    expect(reorderIsClean(buildReorderCart(same))).toBe(true);
    const closed = buildReorderCart({ ...same, menu: { restaurant: { ...restaurant, open: false, opensAt: '7:00' }, categories } });
    expect(closed).toMatchObject({ closed: true, opensAt: '7:00' });
    expect(closed.cart.lines).toHaveLength(1);
    expect(reorderIsClean(closed)).toBe(false);
  });
});

describe('itemsSummary', () => {
  it('names up to three dishes with their counts, then an ellipsis', () => {
    expect(itemsSummary([{ name: 'حمص', qty: 1 }])).toBe('حمص');
    expect(itemsSummary([{ name: 'تمن وبامية', qty: 2 }, { name: 'حمص', qty: 1 }])).toBe('2× تمن وبامية، حمص');
    expect(itemsSummary([{ name: 'أ', qty: 1 }, { name: 'ب', qty: 1 }, { name: 'ج', qty: 1 }, { name: 'د', qty: 1 }])).toBe('أ، ب، ج…');
  });
});
