import { describe, expect, it } from 'vitest';
import { fromDraftGroups, toDraftGroups, type MenuGroupLike } from './logic';
import { applyTiers, draftTiersOf, dropTiers, tierProblems, tiersOf, tierTemplate } from './tiers';

const extras: MenuGroupLike = { nameAr: 'إضافات', minSelect: 0, maxSelect: 2, required: false, modifiers: [{ nameAr: 'قشطة زيادة', priceIqd: 1000, available: true }] };

describe('sold by weight or size (k2 / k3)', () => {
  it('turns full prices into the cheapest price plus a required choice', () => {
    const out = applyTiers(
      'weight',
      [
        { name: 'كيلو', priceIqd: 16000 },
        { name: 'ربع', priceIqd: 4000 },
        { name: 'نص', priceIqd: 8000 },
      ],
      toDraftGroups([extras]),
    );
    expect(out.priceIqd).toBe(4000);
    const saved = fromDraftGroups(out.groups);
    expect(saved[0]).toEqual({
      nameAr: 'الوزن',
      minSelect: 1,
      maxSelect: 1,
      required: true,
      modifiers: [
        { nameAr: 'ربع', priceIqd: 0, available: true },
        { nameAr: 'نص', priceIqd: 4000, available: true },
        { nameAr: 'كيلو', priceIqd: 12000, available: true },
      ],
    });
    expect(saved[1]?.nameAr).toBe('إضافات');
  });

  it('reads the full prices back from a saved dish', () => {
    const groups: MenuGroupLike[] = [
      { nameAr: 'الحجم', minSelect: 1, maxSelect: 1, required: true, modifiers: [{ nameAr: 'كبير', priceIqd: 1500, available: true }, { nameAr: 'صغير', priceIqd: 0, available: true }, { nameAr: 'وسط', priceIqd: 750, available: true }] },
      extras,
    ];
    expect(tiersOf({ priceIqd: 2500, modifierGroups: groups })).toEqual({
      kind: 'size',
      tiers: [
        { name: 'صغير', priceIqd: 2500 },
        { name: 'وسط', priceIqd: 3250 },
        { name: 'كبير', priceIqd: 4000 },
      ],
    });
  });

  it('ignores groups that only look like it', () => {
    const optional: MenuGroupLike = { nameAr: 'الحجم', minSelect: 0, maxSelect: 1, required: false, modifiers: [{ nameAr: 'كبير', priceIqd: 500, available: true }, { nameAr: 'صغير', priceIqd: 0, available: true }] };
    expect(tiersOf({ priceIqd: 2000, modifierGroups: [optional] })).toBeNull();
    expect(tiersOf({ priceIqd: 2000, modifierGroups: [extras] })).toBeNull();
  });

  it('replaces an earlier weight group and can go back to one price', () => {
    const first = applyTiers('weight', [{ name: 'ربع', priceIqd: 3000 }, { name: 'كيلو', priceIqd: 11000 }], toDraftGroups([extras]));
    const second = applyTiers('size', [{ name: 'صغير', priceIqd: 1000 }, { name: 'كبير', priceIqd: 2000 }], first.groups);
    expect(second.groups.map((g) => g.nameAr)).toEqual(['الحجم', 'إضافات']);
    expect(draftTiersOf(second.priceIqd, second.groups)?.tiers.map((t) => t.priceIqd)).toEqual([1000, 2000]);
    expect(dropTiers(second.groups).map((g) => g.nameAr)).toEqual(['إضافات']);
  });

  it('needs two named weights with different names', () => {
    expect(tierProblems([{ name: 'ربع', priceIqd: 4000 }])).toEqual(['too_few']);
    expect(tierProblems([{ name: 'ربع', priceIqd: 4000 }, { name: ' ', priceIqd: 8000 }])).toEqual(['name']);
    expect(tierProblems([{ name: 'ربع', priceIqd: 4000 }, { name: 'ربع', priceIqd: 8000 }])).toEqual(['same_name']);
    expect(tierProblems([{ name: 'ربع', priceIqd: 4000 }, { name: 'نص', priceIqd: 8000 }])).toEqual([]);
  });

  it('starts from the three usual names', () => {
    expect(tierTemplate('weight').map((r) => r.name)).toEqual(['ربع', 'نص', 'كيلو']);
    expect(tierTemplate('size').map((r) => r.name)).toEqual(['صغير', 'وسط', 'كبير']);
  });
});
