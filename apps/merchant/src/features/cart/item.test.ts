import type { AdminMenuItem } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { draftOf, draftProblems, emptyDraft, emptyRow, startsAt, toSave, type CartDraft, type DraftRow } from './item';

const NAMES = { sizes: 'الحجم', extras: 'إضافات' };

const row = (name: string, price: string): DraftRow => ({ ...emptyRow(), name, price });
const draft = (over: Partial<CartDraft>): CartDraft => ({ ...emptyDraft(), name: 'لفة كباب', ...over });

function item(over: Partial<AdminMenuItem>): AdminMenuItem {
  return {
    id: 'i1',
    nameAr: 'لفة كباب',
    nameEn: null,
    description: null,
    priceIqd: 1_500,
    photoUrl: null,
    categoryAr: null,
    sortOrder: 0,
    prepTimeMin: 5,
    available: true,
    soldOutUntil: null,
    onSale: true,
    modifierGroups: [],
    ...over,
  };
}

/** Turns what toSave returns into the menu item the server would send back. */
function saved(d: CartDraft): AdminMenuItem {
  const s = toSave(d, NAMES);
  return item({
    nameAr: s.nameAr,
    description: s.description,
    priceIqd: s.priceIqd,
    modifierGroups: s.groups.map((g, gi) => ({ id: `g${gi}`, nameEn: null, ...g, modifiers: g.modifiers.map((m, mi) => ({ id: `m${gi}${mi}`, nameEn: null, ...m })) })),
  });
}

describe('cart dish → menu item', () => {
  it('prices sizes from the cheapest one, as a required pick-one group', () => {
    const s = toSave(draft({ sizes: [row('نص', '1500'), row('كامل', '2,500')] }), NAMES);
    expect(s.priceIqd).toBe(1_500);
    expect(s.groups).toEqual([
      {
        nameAr: 'الحجم',
        minSelect: 1,
        maxSelect: 1,
        required: true,
        modifiers: [
          { nameAr: 'نص', priceIqd: 0, available: true },
          { nameAr: 'كامل', priceIqd: 1_000, available: true },
        ],
      },
    ]);
  });

  it('cheapest size first or last: the base is still the cheapest', () => {
    const s = toSave(draft({ sizes: [row('كامل', '2500'), row('نص', '1500')] }), NAMES);
    expect(s.priceIqd).toBe(1_500);
    expect(s.groups[0]!.modifiers.map((m) => m.priceIqd)).toEqual([1_000, 0]);
  });

  it('extras are an optional pick-any group up to how many there are; an empty price adds nothing', () => {
    const s = toSave(draft({ price: '1500', extras: [row('بيض', '500'), row('حار', ''), row('جبن', '750')] }), NAMES);
    expect(s.priceIqd).toBe(1_500);
    expect(s.groups).toEqual([
      {
        nameAr: 'إضافات',
        minSelect: 0,
        maxSelect: 3,
        required: false,
        modifiers: [
          { nameAr: 'بيض', priceIqd: 500, available: true },
          { nameAr: 'حار', priceIqd: 0, available: true },
          { nameAr: 'جبن', priceIqd: 750, available: true },
        ],
      },
    ]);
  });

  it('a plain dish has no groups; the about line is trimmed or null', () => {
    expect(toSave(draft({ price: '1000', about: '  ' }), NAMES)).toEqual({ nameAr: 'لفة كباب', description: null, priceIqd: 1_000, groups: [] });
    expect(toSave(draft({ name: ' شاي ', price: '250', about: ' بالهيل ' }), NAMES)).toMatchObject({ nameAr: 'شاي', description: 'بالهيل' });
  });

  it('empty rows are ignored', () => {
    const s = toSave(draft({ price: '1000', sizes: [emptyRow()], extras: [emptyRow(), row('بيض', '500'), row('  ', ' ')] }), NAMES);
    expect(s.priceIqd).toBe(1_000);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]!.modifiers.map((m) => m.nameAr)).toEqual(['بيض']);
  });
});

describe('draftProblems', () => {
  it('a good dish has none', () => {
    expect(draftProblems(draft({ price: '1500' }))).toEqual([]);
    expect(draftProblems(draft({ sizes: [row('نص', '1500'), row('كامل', '2500')], extras: [row('بيض', '500'), row('حار', '')] }))).toEqual([]);
  });

  it('needs a name and a price', () => {
    expect(draftProblems(emptyDraft())).toEqual(['name', 'price']);
    expect(draftProblems(draft({ price: 'abc' }))).toEqual(['price']);
    expect(draftProblems(draft({ price: '0' }))).toEqual(['price']);
  });

  it('a single size is a problem (sizes need two)', () => {
    expect(draftProblems(draft({ sizes: [row('كامل', '2500')] }))).toEqual(['sizes']);
  });

  it('empty rows are ignored', () => {
    expect(draftProblems(draft({ price: '1500', sizes: [emptyRow(), emptyRow()], extras: [emptyRow()] }))).toEqual([]);
    expect(draftProblems(draft({ sizes: [row('نص', '1500'), emptyRow(), row('كامل', '2500')] }))).toEqual([]);
  });

  it('a size row needs a name and a real price; sizes replace the dish price', () => {
    expect(draftProblems(draft({ sizes: [row('نص', '1500'), row('', '2500')] }))).toEqual(['size_row']);
    expect(draftProblems(draft({ sizes: [row('نص', '1500'), row('كامل', '')] }))).toEqual(['size_row']);
  });

  it('an extra needs a name; its price may be empty but not nonsense', () => {
    expect(draftProblems(draft({ price: '1500', extras: [row('', '500')] }))).toEqual(['extra_row']);
    expect(draftProblems(draft({ price: '1500', extras: [row('بيض', 'x')] }))).toEqual(['extra_row']);
    expect(draftProblems(draft({ price: '1500', extras: [row('حار', '0')] }))).toEqual([]);
  });
});

describe('draftOf', () => {
  it('round-trips a dish with sizes and extras', () => {
    const d = draft({ about: 'على الفحم', sizes: [row('نص', '1500'), row('كامل', '2500')], extras: [row('بيض', '500'), row('حار', '')] });
    const back = draftOf(saved(d));
    expect(back.name).toBe('لفة كباب');
    expect(back.about).toBe('على الفحم');
    expect(back.price).toBe('1500');
    expect(back.sizes.map((r) => [r.name, r.price])).toEqual([
      ['نص', '1500'],
      ['كامل', '2500'],
    ]);
    expect(back.extras.map((r) => [r.name, r.price])).toEqual([
      ['بيض', '500'],
      ['حار', ''],
    ]);
    expect(draftProblems(back)).toEqual([]);
    expect(toSave(back, NAMES)).toEqual(toSave(d, NAMES));
  });

  it('round-trips a plain dish', () => {
    const d = draft({ price: '750' });
    const back = draftOf(saved(d));
    expect(back).toMatchObject({ name: 'لفة كباب', about: '', price: '750', sizes: [], extras: [] });
    expect(toSave(back, NAMES)).toEqual(toSave(d, NAMES));
  });

  it('gives every row its own key', () => {
    const back = draftOf(saved(draft({ sizes: [row('نص', '1500'), row('كامل', '2500')], extras: [row('بيض', '500')] })));
    const keys = [...back.sizes, ...back.extras].map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('startsAt', () => {
  it('«من» for a dish with sizes, the plain price otherwise', () => {
    expect(startsAt(saved(draft({ sizes: [row('نص', '1500'), row('كامل', '2500')] })))).toEqual({ from: true, priceIqd: 1_500 });
    expect(startsAt(saved(draft({ price: '1500', extras: [row('بيض', '500')] })))).toEqual({ from: false, priceIqd: 1_500 });
  });
});

describe('saving an edited dish keeps what the editor does not show', () => {
  const groups: AdminMenuItem['modifierGroups'] = [
    { id: 'g1', nameAr: 'الحجم', nameEn: null, minSelect: 1, maxSelect: 1, required: true, modifiers: [
      { id: 'm1', nameAr: 'نص', nameEn: null, priceIqd: 0, available: true },
      { id: 'm2', nameAr: 'كامل', nameEn: null, priceIqd: 1000, available: false },
    ] },
    { id: 'g2', nameAr: 'إضافات', nameEn: null, minSelect: 0, maxSelect: 2, required: false, modifiers: [
      { id: 'm3', nameAr: 'بيض', nameEn: null, priceIqd: 500, available: false },
      { id: 'm4', nameAr: 'حار', nameEn: null, priceIqd: 0, available: true },
    ] },
    { id: 'g3', nameAr: 'الصمون', nameEn: 'Bread', minSelect: 0, maxSelect: 1, required: false, modifiers: [
      { id: 'm5', nameAr: 'صمون حجري', nameEn: null, priceIqd: 250, available: true },
    ] },
  ];
  const prev = item({ priceIqd: 1500, modifierGroups: groups });

  it('an option switched off stays off; a new one starts on', () => {
    const d = draftOf(prev);
    d.extras.push(row('صمونة زيادة', '250'));
    const out = toSave(d, NAMES, prev);
    expect(out.groups[0]!.modifiers.map((m) => [m.nameAr, m.available])).toEqual([['نص', true], ['كامل', false]]);
    expect(out.groups[1]!.modifiers.map((m) => [m.nameAr, m.available])).toEqual([['بيض', false], ['حار', true], ['صمونة زيادة', true]]);
  });

  it('a third group set up on the full menu is saved back as it was', () => {
    const out = toSave(draftOf(prev), NAMES, prev);
    expect(out.groups).toHaveLength(3);
    expect(out.groups[2]).toMatchObject({ nameAr: 'الصمون', nameEn: 'Bread', maxSelect: 1, modifiers: [{ nameAr: 'صمون حجري', priceIqd: 250, available: true }] });
  });

  it('a new dish has every option on', () => {
    const out = toSave(draft({ sizes: [row('نص', '1500'), row('كامل', '2500')] }), NAMES);
    expect(out.groups[0]!.modifiers.every((m) => m.available)).toBe(true);
  });
});
