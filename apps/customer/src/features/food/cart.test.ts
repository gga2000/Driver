import { describe, expect, it } from 'vitest';
import type { MenuCategory, MenuItem } from '@driver/contracts';
import { createMemoryStorage } from '@/lib/storage';
import {
  EMPTY_CART,
  ME,
  addLine,
  carryOver,
  groupByPerson,
  itemCount,
  itemsTotal,
  lineTotal,
  matchDish,
  minOrderShortfall,
  reconcile,
  removeLine,
  setQty,
  type CartMerchant,
  type CartState,
  type NewCartLine,
} from './cart';
import { createCartStore } from './cart-store';

const KHALID: CartMerchant = { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: { zoneKey: 'street_30' }, minOrderIqd: 5000 };
const SHAM: CartMerchant = { id: 'org_3', name: 'مأكولات الشام', cityId: 'aziziyah', pickup: { zoneKey: 'nakheel_street' }, minOrderIqd: 4000 };
const SARA = { id: 'pp_sara', name: 'سارة', phone: '+9647701234567' };

const kebabWrap = (patch: Partial<NewCartLine> = {}): NewCartLine => ({
  itemId: 'org_1_kebab_wrap',
  name: 'لفة كباب',
  basePriceIqd: 2000,
  modifiers: [{ groupId: 'g_bread', modifierId: 'm_tannour', name: 'خبز تنور', priceIqd: 0 }],
  qty: 1,
  note: null,
  personId: ME,
  ...patch,
});

function add(cart: CartState, merchant: CartMerchant, line: NewCartLine, opts = {}): CartState {
  const r = addLine(cart, merchant, line, opts);
  if (!r.ok) throw new Error('unexpected other_merchant');
  return r.cart;
}

describe('cart: quantities and merging', () => {
  it('merges identical lines, keeps different choices, people or notes apart', () => {
    let cart = add(EMPTY_CART, KHALID, kebabWrap());
    cart = add(cart, KHALID, kebabWrap({ qty: 2 }));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.qty).toBe(3);
    cart = add(cart, KHALID, kebabWrap({ note: 'بدون بصل' }));
    cart = add(cart, KHALID, kebabWrap({ modifiers: [{ groupId: 'g_extras', modifierId: 'm_cheese', name: 'جبن', priceIqd: 500 }] }));
    cart = add(cart, KHALID, kebabWrap({ personId: SARA.id }), { person: SARA });
    expect(cart.lines).toHaveLength(4);
    expect(itemCount(cart)).toBe(6);
    expect(itemsTotal(cart)).toBe(3 * 2000 + 2000 + 2500 + 2000);
    expect(cart.people).toEqual([SARA]);
  });

  it('setQty changes, 0 removes; removing the last line empties the cart and drops unused people', () => {
    let cart = add(EMPTY_CART, KHALID, kebabWrap({ personId: SARA.id }), { person: SARA });
    const key = cart.lines[0]!.key;
    cart = setQty(cart, key, 4);
    expect(lineTotal(cart.lines[0]!)).toBe(8000);
    cart = setQty(cart, key, 0);
    expect(cart).toEqual(EMPTY_CART);
    cart = add(EMPTY_CART, KHALID, kebabWrap());
    cart = add(cart, KHALID, kebabWrap({ personId: SARA.id }), { person: SARA });
    cart = removeLine(cart, cart.lines[1]!.key);
    expect(cart.people).toEqual([]);
    expect(setQty(cart, cart.lines[0]!.key, 500).lines[0]!.qty).toBe(99);
  });

  it('minimum order shortfall', () => {
    const cart = add(EMPTY_CART, KHALID, kebabWrap());
    expect(minOrderShortfall(cart)).toBe(3000);
    expect(minOrderShortfall(add(cart, KHALID, kebabWrap({ qty: 2 })))).toBe(0);
    expect(minOrderShortfall(EMPTY_CART)).toBe(0);
  });
});

describe('cart: one merchant per order', () => {
  it('refuses another kitchen until the person agrees to a new cart', () => {
    const cart = add(EMPTY_CART, KHALID, kebabWrap());
    const shawarma: NewCartLine = { itemId: 'org_3_chicken_shawarma', name: 'شاورما دجاج', basePriceIqd: 2000, modifiers: [], qty: 1, note: null, personId: ME };
    const refused = addLine(cart, SHAM, shawarma);
    expect(refused).toEqual({ ok: false, reason: 'other_merchant', current: KHALID });
    const replaced = addLine(cart, SHAM, shawarma, { replace: true });
    expect(replaced.ok && replaced.cart.merchant?.id).toBe('org_3');
    expect(replaced.ok && replaced.cart.lines.map((l) => l.name)).toEqual(['شاورما دجاج']);
  });
});

describe('cart: grouping by person', () => {
  it('flat with one person; grouped (me first) when more than one person is tagged', () => {
    let cart = add(EMPTY_CART, KHALID, kebabWrap());
    expect(groupByPerson(cart).grouped).toBe(false);
    const ali = { id: 'pp_ali', name: 'علي', phone: null };
    cart = add(cart, KHALID, kebabWrap({ personId: SARA.id, qty: 2 }), { person: SARA });
    cart = add(cart, KHALID, kebabWrap({ personId: ali.id }), { person: ali });
    cart = add(cart, KHALID, { ...kebabWrap(), itemId: 'org_1_pepsi', name: 'بيبسي', basePriceIqd: 750, modifiers: [] });
    const g = groupByPerson(cart);
    expect(g.grouped).toBe(true);
    expect(g.groups.map((x) => [x.person?.name ?? 'me', x.lines.length, x.subtotalIqd])).toEqual([
      ['me', 2, 2750],
      ['سارة', 1, 4000],
      ['علي', 1, 2000],
    ]);
  });

  it('only other people (no own lines) still groups by them', () => {
    let cart = add(EMPTY_CART, KHALID, kebabWrap({ personId: SARA.id }), { person: SARA });
    expect(groupByPerson(cart).grouped).toBe(false);
    cart = add(cart, KHALID, kebabWrap({ personId: 'pp_x' }), { person: { id: 'pp_x', name: 'زهراء', phone: null } });
    expect(groupByPerson(cart).groups.map((x) => x.person?.name)).toEqual(['سارة', 'زهراء']);
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

describe('carry-over to another kitchen (rejection fallback)', () => {
  const kareemMenu: MenuCategory[] = [
    {
      id: 'cat_1',
      name: 'مشويات',
      items: [
        item('k_kebab', 'كباب عراقي', 13000, {
          modifierGroups: [{ id: 'kg', name: 'الكمية', required: true, min: 1, max: 1, variant: true, modifiers: [{ id: 'kg_half', name: 'نص كيلو', priceIqd: 0, available: true }, { id: 'kg_kilo', name: 'كيلو', priceIqd: 12000, available: true }] }],
        }),
        item('k_pepsi', 'بيبسي', 750),
        item('k_salad', 'سلطة عربية', 1500, { available: false, unavailableReason: 'sold_out' }),
      ],
    },
  ];
  const KAREEM: CartMerchant = { id: 'org_2', name: 'مشويات الحاج كريم', cityId: 'aziziyah', pickup: { zoneKey: 'centre' }, minOrderIqd: 7000 };

  it('moves same-named dishes with their choices, person and note; drops what is missing or sold out', () => {
    let cart = add(EMPTY_CART, KHALID, { itemId: 'org_1_kebab_kilo', name: 'كباب بالكيلو', basePriceIqd: 12000, modifiers: [{ groupId: 'x', modifierId: 'y', name: 'كيلو', priceIqd: 11000 }], qty: 1, note: 'زيادة بصل', personId: SARA.id }, { person: SARA });
    cart = add(cart, KHALID, { itemId: 'org_1_pepsi', name: 'بيبسي', basePriceIqd: 750, modifiers: [], qty: 3, note: null, personId: ME });
    cart = add(cart, KHALID, { itemId: 'org_1_salad', name: 'سلطة عربية', basePriceIqd: 1000, modifiers: [], qty: 1, note: null, personId: ME });
    cart = add(cart, KHALID, { itemId: 'org_1_liver', name: 'لفة كبد', basePriceIqd: 1500, modifiers: [], qty: 1, note: null, personId: ME });

    const res = carryOver(cart, KAREEM, kareemMenu);
    expect(res.dropped.sort()).toEqual(['سلطة عربية', 'لفة كبد'].sort());
    expect(res.moved).toEqual(['كباب عراقي', 'بيبسي']);
    expect(res.cart.merchant).toEqual(KAREEM);
    const kebab = res.cart.lines.find((l) => l.itemId === 'k_kebab')!;
    expect(kebab).toMatchObject({ basePriceIqd: 13000, qty: 1, note: 'زيادة بصل', personId: SARA.id });
    expect(kebab.modifiers).toEqual([{ groupId: 'kg', modifierId: 'kg_kilo', name: 'كيلو', priceIqd: 12000 }]);
    expect(res.cart.people).toEqual([SARA]);
    expect(res.cart.lines.find((l) => l.itemId === 'k_pepsi')?.qty).toBe(3);
  });

  it('a required choice with no same-named option drops the line instead of guessing', () => {
    const cart = add(EMPTY_CART, KHALID, { itemId: 'org_1_kebab_kilo', name: 'كباب عراقي', basePriceIqd: 12000, modifiers: [], qty: 1, note: null, personId: ME });
    expect(carryOver(cart, KAREEM, kareemMenu)).toMatchObject({ moved: [], dropped: ['كباب عراقي'], cart: EMPTY_CART });
  });

  it('matches dishes by folded name and shared words', () => {
    const items = kareemMenu[0]!.items;
    expect(matchDish('كباب', items)?.id).toBe('k_kebab');
    expect(matchDish('بيبسى', items)?.id).toBe('k_pepsi');
    expect(matchDish('شاورما', items)).toBeNull();
  });
});

describe('reconcile against the current menu (price_changed / unavailable)', () => {
  it('reprices lines, removes gone or sold-out dishes and options', () => {
    let cart = add(EMPTY_CART, KHALID, { itemId: 'a', name: 'لفة تكة', basePriceIqd: 2500, modifiers: [{ groupId: 'g', modifierId: 'm', name: 'جبن', priceIqd: 500 }], qty: 2, note: null, personId: ME });
    cart = add(cart, KHALID, { itemId: 'b', name: 'صحن فلافل', basePriceIqd: 3000, modifiers: [], qty: 1, note: null, personId: ME });
    cart = add(cart, KHALID, { itemId: 'c', name: 'شنينة', basePriceIqd: 750, modifiers: [], qty: 1, note: null, personId: ME });
    const menu: MenuCategory[] = [
      {
        id: 'cat',
        name: 'x',
        items: [
          item('a', 'لفة تكة', 2750, { modifierGroups: [{ id: 'g', name: 'إضافات', required: false, min: 0, max: 3, variant: false, modifiers: [{ id: 'm', name: 'جبن', priceIqd: 500, available: true }] }] }),
          item('b', 'صحن فلافل', 3000, { available: false, unavailableReason: 'sold_out' }),
        ],
      },
    ];
    const r = reconcile(cart, menu);
    expect(r.removed.sort()).toEqual(['شنينة', 'صحن فلافل'].sort());
    expect(r.repriced).toEqual(['لفة تكة']);
    expect(itemsTotal(r.cart)).toBe(2 * 3250);
  });
});

describe('cart store (persisted)', () => {
  it('persists the cart and the saved people, and restores them on load', async () => {
    const storage = createMemoryStorage();
    const a = createCartStore(storage);
    await a.load();
    const sara = a.addPerson('سارة', '+9647701234567');
    a.add(KHALID, kebabWrap({ personId: sara.id }));
    a.add(KHALID, kebabWrap());
    expect(a.getSnapshot().cart.people.map((p) => p.name)).toEqual(['سارة']);
    expect(a.add(SHAM, kebabWrap()).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 0));

    const b = createCartStore(storage);
    await b.load();
    expect(b.getSnapshot().cart.lines).toHaveLength(2);
    expect(b.getSnapshot().people.map((p) => p.name)).toEqual(['سارة']);

    b.markPlaced('ord_1');
    expect(b.getSnapshot().cart).toEqual(EMPTY_CART);
    expect(b.getSnapshot().placed?.cart.lines).toHaveLength(2);
    b.settlePlaced('ord_1');
    expect(b.getSnapshot().placed).toBeNull();
  });

  it('undo puts a removed line back with its key', async () => {
    const s = createCartStore(createMemoryStorage());
    await s.load();
    s.add(KHALID, kebabWrap({ qty: 2 }));
    const key = s.getSnapshot().cart.lines[0]!.key;
    const removed = s.remove(key)!;
    expect(s.getSnapshot().cart).toEqual(EMPTY_CART);
    s.restore(removed);
    expect(s.getSnapshot().cart.merchant).toEqual(KHALID);
    expect(s.getSnapshot().cart.lines.map((l) => [l.key === key, l.qty])).toEqual([[true, 2]]);
  });
});
