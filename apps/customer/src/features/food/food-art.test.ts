import { describe, expect, it } from 'vitest';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { ART_LOOKS, artOf, dishArt, motifForDish, sameDrawing } from './food-art';

describe('food drawings per dish (b3, UI/UX audit F-01 / S2-07)', () => {
  it('drinks: water is a bottle, laban and شنينة a glass, soft drinks a can, tea an istikan', () => {
    expect(motifForDish('ماي صحي')).toBe('water');
    expect(motifForDish('شنينة')).toBe('laban');
    expect(motifForDish('لبن')).toBe('laban');
    expect(motifForDish('بيبسي')).toBe('can');
    expect(motifForDish('سفن أب')).toBe('can');
    expect(motifForDish('عصير برتقال')).toBe('juice');
    expect(motifForDish('چاي')).toBe('tea');
  });

  it('dishes: by name, not by kitchen', () => {
    expect(motifForDish('لفة كباب')).toBe('wrap');
    expect(motifForDish('لفة كبد')).toBe('wrap');
    expect(motifForDish('وجبة كبد')).toBe('liver');
    expect(motifForDish('وجبة تكة')).toBe('tikka');
    expect(motifForDish('وجبة كباب')).toBe('kebab');
    expect(motifForDish('نص دجاجة مشوية')).toBe('chicken');
    expect(motifForDish('تمن ومرق')).toBe('rice');
    expect(motifForDish('شوربة عدس')).toBe('soup');
    expect(motifForDish('سلطة خضرة')).toBe('salad');
    expect(motifForDish('طرشي')).toBe('pickles');
    expect(motifForDish('كنافة')).toBe('sweet');
    expect(motifForDish('شاورما لحم')).toBe('shawarma');
    expect(motifForDish('فلافل')).toBe('falafel');
    expect(motifForDish('صمون حجري')).toBe('bread');
  });

  it('an unknown name falls back to its menu section, then a plate', () => {
    expect(motifForDish('صنف جديد', 'مشروبات')).toBe('can');
    expect(motifForDish('صنف جديد', 'حلويات')).toBe('sweet');
    expect(motifForDish('صنف جديد')).toBe('plate');
  });

  it('the look is deterministic per dish id', () => {
    expect(artOf({ id: 'org_1_kebab_wrap', name: 'لفة كباب' })).toEqual(artOf({ id: 'org_1_kebab_wrap', name: 'لفة كباب' }));
    expect(artOf({ id: 'x', name: 'لفة كباب' }).look).toBeGreaterThanOrEqual(0);
    expect(artOf({ id: 'x', name: 'لفة كباب' }).look).toBeLessThan(ART_LOOKS);
  });

  it('adjacent rows never share a drawing, on every launch menu', () => {
    for (const r of AZIZIYAH_RESTAURANTS) {
      const rows = r.categories.flatMap((c) => c.items.map((i) => ({ id: `${r.key}_${i.key}`, name: i.nameAr, category: c.nameAr })));
      const art = dishArt(rows);
      expect(art).toHaveLength(rows.length);
      for (let i = 1; i < art.length; i++) expect(sameDrawing(art[i - 1]!, art[i]!), `${r.key} row ${i}`).toBe(false);
    }
  });

  it('a kebab menu is no longer nine identical plates', () => {
    const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
    const motifs = new Set(khalid.categories.flatMap((c) => c.items.map((i) => motifForDish(i.nameAr, c.nameAr))));
    expect(motifs.size).toBeGreaterThanOrEqual(8);
  });
});
