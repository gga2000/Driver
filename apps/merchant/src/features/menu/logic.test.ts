import { describe, expect, it } from 'vitest';
import {
  checkImport,
  emptyRow,
  filterMenu,
  foldArabic,
  fromDraftGroups,
  parseServes,
  servesText,
  groupProblems,
  groupRule,
  itemStatus,
  moveInOrder,
  nextBaghdadMidnight,
  offStep,
  parseDelta,
  parsePrice,
  patchMenuItem,
  priceChange,
  sectionCounts,
  setMinMax,
  setRequired,
  sortOrderForNew,
  toDraftGroups,
  trayColumns,
  withAvailability,
  withSoldOutToday,
  type DraftGroup,
  type MenuItemLike,
} from './logic';

const NOW = Date.parse('2026-10-03T12:00:00Z'); // 15:00 Baghdad

function item(over: Partial<MenuItemLike> & { id: string; nameAr: string }): MenuItemLike {
  return { nameEn: null, description: null, priceIqd: 2500, categoryAr: null, sortOrder: 0, available: true, soldOutUntil: null, onSale: true, modifierGroups: [], ...over };
}

const MENU = {
  merchantOrgId: 'org_1',
  categories: [
    { nameAr: 'تكة', items: [item({ id: 'a', nameAr: 'لفة تكة', sortOrder: 0 }), item({ id: 'b', nameAr: 'صحن تكة دجاج', nameEn: 'Chicken tikka plate', sortOrder: 1 })] },
    { nameAr: 'باجة', items: [item({ id: 'c', nameAr: 'باجة رأس', description: 'ويا خبز تنّور', sortOrder: 100 })] },
    { nameAr: null, items: [item({ id: 'd', nameAr: 'ماي', sortOrder: 300 })] },
  ],
};

describe('menu search', () => {
  it('folds the spellings people mix up', () => {
    expect(foldArabic('تكّة دجاج')).toBe(foldArabic('تكه دجاج'));
    expect(foldArabic('أكلة')).toBe('اكله');
    expect(foldArabic('گص')).toBe('كص');
    expect(foldArabic('٣٥٠٠')).toBe('3500');
  });

  it('matches Arabic, English and description; drops empty sections only while searching', () => {
    expect(filterMenu(MENU.categories, 'تكه').map((c) => [c.nameAr, c.items.map((i) => i.id)])).toEqual([['تكة', ['a', 'b']]]);
    expect(filterMenu(MENU.categories, 'chicken').flatMap((c) => c.items.map((i) => i.id))).toEqual(['b']);
    expect(filterMenu(MENU.categories, 'تنور').flatMap((c) => c.items.map((i) => i.id))).toEqual(['c']);
    expect(filterMenu(MENU.categories, '  ').length).toBe(3);
  });
});

describe('item status', () => {
  it('on, sold out today (until midnight), off', () => {
    expect(itemStatus(item({ id: 'x', nameAr: 'x' }), NOW)).toBe('on');
    expect(itemStatus(item({ id: 'x', nameAr: 'x', soldOutUntil: new Date(NOW + 1000), onSale: false }), NOW)).toBe('sold_out_today');
    expect(itemStatus(item({ id: 'x', nameAr: 'x', soldOutUntil: new Date(NOW - 1000) }), NOW)).toBe('on');
    expect(itemStatus(item({ id: 'x', nameAr: 'x', available: false, onSale: false }), NOW)).toBe('off');
  });

  it('counts a section and applies optimistic toggles', () => {
    const sold = withSoldOutToday(item({ id: 'x', nameAr: 'x' }), NOW);
    expect(sold.soldOutUntil?.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    expect(nextBaghdadMidnight(Date.parse('2026-10-03T21:30:00Z'))).toBe(Date.parse('2026-10-04T21:00:00Z'));
    const back = withAvailability(sold, true);
    expect(back).toMatchObject({ available: true, soldOutUntil: null, onSale: true });
    const off = withAvailability(item({ id: 'y', nameAr: 'y' }), false);
    expect(sectionCounts([sold, off, item({ id: 'z', nameAr: 'z' })], NOW)).toEqual({ total: 3, on: 1, soldOutToday: 1, off: 1 });
    const patched = patchMenuItem(MENU, 'c', (i) => ({ ...i, priceIqd: 9500 }));
    expect(patched.categories[1]!.items[0]!.priceIqd).toBe(9500);
    expect(MENU.categories[1]!.items[0]!.priceIqd).toBe(2500);
  });
});

describe('prices', () => {
  it('reads what staff type and refuses what is not a price', () => {
    expect(parsePrice('3,500')).toBe(3500);
    expect(parsePrice('٣٥٠٠')).toBe(3500);
    expect(parsePrice('3500 دينار')).toBe(3500);
    expect(parsePrice('0')).toBeNull();
    expect(parsePrice('3.5')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('20000000')).toBeNull();
    expect(parseDelta('')).toBe(0);
    expect(parseDelta('500')).toBe(500);
    expect(parseDelta('x')).toBeNull();
    expect(offStep(3600)).toBe(true);
    expect(offStep(3750)).toBe(false);
  });

  it('describes a change for the history sheet', () => {
    expect(priceChange(0, 3000)).toEqual({ delta: 3000, direction: 'first' });
    expect(priceChange(3000, 3500)).toEqual({ delta: 500, direction: 'up' });
    expect(priceChange(3500, 3000)).toEqual({ delta: -500, direction: 'down' });
  });
});

describe('modifier groups', () => {
  const g: DraftGroup = { key: 'g', nameAr: 'الخبز', required: true, minSelect: 1, maxSelect: 1, modifiers: [{ key: 'm1', nameAr: 'صمون', price: '0', available: true }, { key: 'm2', nameAr: 'تنور', price: '250', available: true }] };

  it('flags what the customer screen could not honour', () => {
    expect(groupProblems(g)).toEqual([]);
    expect(groupProblems({ ...g, nameAr: ' ' })).toEqual(['name']);
    expect(groupProblems({ ...g, maxSelect: 3 })).toEqual(['max_over_options']);
    expect(groupProblems({ ...g, modifiers: [] })).toEqual(['no_options']);
    expect(groupProblems({ ...g, modifiers: [{ key: 'm', nameAr: 'x', price: 'abc', available: true }] })).toEqual(['option_price']);
    expect(groupProblems({ ...g, required: true, minSelect: 0 })).toEqual(['required_min']);
  });

  it('«يشبّع» as staff type it, and back (joy o3)', () => {
    expect(parseServes('')).toBeNull();
    expect(parseServes('3')).toEqual({ min: 3, max: 3 });
    expect(parseServes('2-3')).toEqual({ min: 2, max: 3 });
    expect(parseServes('٢–٣')).toEqual({ min: 2, max: 3 });
    expect(parseServes('3-2')).toBe('invalid');
    expect(parseServes('0')).toBe('invalid');
    expect(parseServes('كثير')).toBe('invalid');
    expect(servesText(2, 3)).toBe('2–3');
    expect(servesText(2, 2)).toBe('2');
    expect(servesText(null, null)).toBe('');
    const kilo: DraftGroup = { ...g, nameAr: 'الكمية', modifiers: [{ key: 'a', nameAr: 'نص كيلو', price: '0', available: true, serves: '2-3' }, { key: 'b', nameAr: 'كيلو', price: '11000', available: true, serves: 'x' }] };
    expect(groupProblems(kilo)).toEqual(['option_serves']);
    const api = fromDraftGroups([{ ...kilo, modifiers: [kilo.modifiers[0]!] }]);
    expect(api[0]!.modifiers[0]).toEqual({ nameAr: 'نص كيلو', priceIqd: 0, available: true, servesMin: 2, servesMax: 3 });
    expect(toDraftGroups(api)[0]!.modifiers[0]!.serves).toBe('2–3');
  });

  it('keeps required and min in step, and round-trips with the API shape', () => {
    expect(setRequired({ ...g, required: false, minSelect: 0 }, true)).toMatchObject({ required: true, minSelect: 1, maxSelect: 1 });
    expect(setRequired(g, false)).toMatchObject({ required: false, minSelect: 0 });
    expect(setMinMax(g, 2, 1)).toMatchObject({ minSelect: 1, maxSelect: 1, required: true });
    expect(setMinMax(g, 0, 2)).toMatchObject({ minSelect: 0, maxSelect: 2, required: false });
    const api = fromDraftGroups([g]);
    expect(api).toEqual([{ nameAr: 'الخبز', minSelect: 1, maxSelect: 1, required: true, modifiers: [{ nameAr: 'صمون', priceIqd: 0, available: true }, { nameAr: 'تنور', priceIqd: 250, available: true }] }]);
    expect(fromDraftGroups(toDraftGroups(api.map((x) => ({ ...x, modifiers: x.modifiers }))))).toEqual(api);
    expect(groupRule({ required: true, minSelect: 1, maxSelect: 1 })).toEqual({ kind: 'exactly', min: 1, max: 1 });
    expect(groupRule({ required: false, minSelect: 0, maxSelect: 3 })).toEqual({ kind: 'up_to', min: 0, max: 3 });
    expect(groupRule({ required: true, minSelect: 1, maxSelect: 3 })).toEqual({ kind: 'range', min: 1, max: 3 });
  });
});

describe('sections', () => {
  it('moves sections and places new items at the end of theirs', () => {
    expect(moveInOrder(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(sortOrderForNew(MENU.categories, 'تكة')).toBe(2);
    expect(sortOrderForNew(MENU.categories, 'سلطات')).toBe(400);
  });
});

describe('photo import', () => {
  it('skips blank rows, counts rows to fix, and trims the ready ones', () => {
    const rows = [
      { ...emptyRow('مشويات', 'up_1'), nameAr: ' كباب ', price: '5,000' },
      { ...emptyRow(), nameAr: 'شوربة', price: '' },
      emptyRow(),
      { ...emptyRow(), nameAr: 'بيبسي', price: '٧٥٠' },
    ];
    expect(checkImport(rows)).toEqual({
      ready: [
        { nameAr: 'كباب', priceIqd: 5000, categoryAr: 'مشويات', sourceUploadId: 'up_1' },
        { nameAr: 'بيبسي', priceIqd: 750, categoryAr: null, sourceUploadId: null },
      ],
      problems: 1,
      blank: 1,
    });
  });
});

describe('glass display columns', () => {
  it('fits two trays on a phone and four to six on a tablet', () => {
    expect(trayColumns(358, 10, false)).toBe(2);
    expect(trayColumns(0, 10, false)).toBe(2);
    expect(trayColumns(700, 14, true)).toBe(3);
    expect(trayColumns(960, 14, true)).toBe(5);
    expect(trayColumns(2000, 14, true)).toBe(6);
  });
});
