import { describe, expect, it } from 'vitest';
import type { MenuCategory, MenuItem, MenuModifierGroup } from '@driver/contracts';
import { guestTray, mealTray, roleOf, shares, swapLine, versionsOf } from './tray';

let n = 0;
function item(name: string, priceIqd: number, extra: Partial<MenuItem> = {}): MenuItem {
  n += 1;
  return { id: `i${n}`, name, description: null, priceIqd, photoUrl: null, available: true, unavailableReason: null, prepTimeMin: 5, pointsEligible: true, modifierGroups: [], ...extra };
}

const weight = (half: number, kilo: number): MenuModifierGroup => ({
  id: `w${n}`,
  name: 'الكمية',
  required: true,
  min: 1,
  max: 1,
  variant: true,
  modifiers: [
    { id: `q${n}`, name: 'ربع كيلو', priceIqd: 0, available: true, serves: { min: 2, max: 3 } },
    { id: `h${n}`, name: 'نص كيلو', priceIqd: half, available: true, serves: { min: 4, max: 6 } },
    { id: `k${n}`, name: 'كيلو', priceIqd: kilo, available: true, serves: { min: 8, max: 12 } },
  ],
});

const flavours: MenuModifierGroup = { id: 'fl', name: 'النكهات', required: true, min: 1, max: 2, variant: false, modifiers: [{ id: 'f1', name: 'قيمر', priceIqd: 0, available: true }] };

const SWEETS: MenuCategory[] = [
  { id: 'c1', name: 'كنافة', items: [item('كنافة نابلسية', 3000)] },
  {
    id: 'c2',
    name: 'بالكيلو',
    items: [item('بقلاوة', 5000, { modifierGroups: [weight(5000, 15000)] }), item('زلابية', 2000, { modifierGroups: [weight(2000, 6000)] }), item('كليچة مشكلة', 3000, { modifierGroups: [weight(3000, 9000)] })],
  },
  { id: 'c3', name: 'آيس كريم', items: [item('كون آيس كريم', 1500, { modifierGroups: [flavours] })] },
];

const GRILL: MenuCategory[] = [
  {
    id: 'm',
    name: 'مشويات',
    items: [
      item('كباب', 6000),
      item('تكة دجاج', 6000),
      item('كباب بالكيلو', 16000, { modifierGroups: [{ id: 'kk', name: 'الكمية', required: true, min: 1, max: 1, variant: true, modifiers: [{ id: 'kh', name: 'نص كيلو', priceIqd: 0, available: true, serves: { min: 2, max: 3 } }, { id: 'kf', name: 'كيلو', priceIqd: 14000, available: true, serves: { min: 4, max: 5 } }] }] }),
    ],
  },
  { id: 'r', name: 'أكلات بيت', items: [item('تمن ومرق', 5000), item('دولمة', 7000, { serves: { min: 2, max: 2 } })] },
  { id: 's', name: 'مقبلات', items: [item('سلطة عربية', 1500), item('خبز تنور', 1000)] },
  { id: 'd', name: 'مشروبات', items: [item('بيبسي', 750), item('لبن', 1000)] },
];

describe('tray roles and versions', () => {
  it('reads what a dish is for from its name and section', () => {
    expect(roleOf({ name: 'بيبسي' }, 'مشروبات')).toBe('drink');
    expect(roleOf({ name: 'سلطة عربية' }, 'مقبلات')).toBe('side');
    expect(roleOf({ name: 'بقلاوة' }, 'بالكيلو')).toBe('sweet');
    expect(roleOf({ name: 'كباب' }, 'مشويات')).toBe('main');
  });

  it('never makes a choice for the person: a dish that asks for flavours is left out', () => {
    expect(versionsOf(SWEETS[2]!.items[0]!, 'sweet')).toEqual([]);
    expect(versionsOf(SWEETS[1]!.items[0]!, 'sweet').map((v) => [v.label, v.priceIqd, v.serves])).toEqual([
      ['ربع كيلو', 5000, 2],
      ['نص كيلو', 10000, 5],
      ['كيلو', 20000, 10],
    ]);
  });

  it('shares people as evenly as it can', () => {
    expect(shares(8, 3)).toEqual([3, 3, 2]);
    expect(shares(2, 3)).toEqual([1, 1]);
  });
});

describe('«ضيوف جايين؟» (s2)', () => {
  it('eight guests: two sweets by weight, each in the weight that fits its four', () => {
    const tray = guestTray(SWEETS, 8)!;
    expect(tray.lines.map((l) => [l.item.name, l.version.label, l.qty])).toEqual([
      ['بقلاوة', 'نص كيلو', 1],
      ['زلابية', 'نص كيلو', 1],
    ]);
    expect(tray.totalIqd).toBe(10000 + 4000);
    expect(tray.serves).toBeGreaterThanOrEqual(8);
  });

  it('twenty guests: three kinds, kilos where a half is too little', () => {
    const tray = guestTray(SWEETS, 20)!;
    expect(tray.lines).toHaveLength(3);
    expect(tray.lines.every((l) => l.version.label === 'كيلو')).toBe(true);
    expect(tray.serves).toBeGreaterThanOrEqual(20);
  });

  it('a swap keeps the share and picks another sweet not on the tray', () => {
    const tray = guestTray(SWEETS, 8)!;
    const swapped = swapLine(tray, 1, SWEETS);
    expect(swapped.lines[1]!.item.name).toBe('كليچة مشكلة');
    expect(swapped.lines[1]!.version.label).toBe('نص كيلو');
  });

  it('no sweets on the menu, no tray', () => {
    expect(guestTray(GRILL.slice(2), 6)).toBeNull();
  });
});

describe('«اختارلي» (k10)', () => {
  it('four people: different mains sharing them, a side for every three and a drink each', () => {
    const tray = mealTray(GRILL, { people: 4, budget: null, mood: null })!;
    const mains = tray.lines.filter((l) => l.role === 'main');
    expect(mains.map((l) => l.item.name)).toEqual(['كباب', 'تكة دجاج']);
    expect(tray.serves).toBe(4);
    expect(tray.lines.filter((l) => l.role === 'side').reduce((s, l) => s + l.qty, 0)).toBe(2);
    expect(tray.lines.filter((l) => l.role === 'drink').reduce((s, l) => s + l.qty, 0)).toBe(4);
  });

  it('the mood decides the mains; a mood nobody cooks falls back to the whole menu and says so', () => {
    const home = mealTray(GRILL, { people: 2, budget: null, mood: 'home' })!;
    expect(home.lines.filter((l) => l.role === 'main').map((l) => l.item.name)).toEqual(['تمن ومرق', 'دولمة']);
    const quick = mealTray(GRILL, { people: 2, budget: null, mood: 'quick' })!;
    expect(quick.moodIgnored).toBe(true);
  });

  it('keeps each serving under the budget and stops adding extras past it', () => {
    const tray = mealTray(GRILL, { people: 3, budget: 7000, mood: 'home' })!;
    expect(tray.lines.filter((l) => l.role === 'main').every((l) => l.version.priceIqd / l.version.serves <= 7000)).toBe(true);
    expect(tray.totalIqd).toBeLessThanOrEqual(7000 * 3);
    const tight = mealTray(GRILL, { people: 2, budget: 4000, mood: 'grill' })!;
    // The cheapest grill serving is 6,000 a head: nothing fits 4,000, so the tray says so.
    expect(tight.overBudget).toBe(true);
  });
});
