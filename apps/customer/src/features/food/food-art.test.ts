import { describe, expect, it } from 'vitest';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { ART_LOOKS, artOf, dishArt, kitchenLook, motifForCuisine, motifForDish, motifForKitchen, sameDrawing } from './food-art';

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
    expect(motifForDish('وجبة كباب')).toBe('plate');
    expect(motifForDish('كباب عراقي')).toBe('kebab');
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

  it('J4: the Iraqi dishes with their own drawing', () => {
    expect(motifForDish('باچة')).toBe('pacha');
    expect(motifForDish('تشريب باچة')).toBe('pacha');
    expect(motifForDish('دولمة')).toBe('dolma');
    expect(motifForDish('مسگوف')).toBe('fish');
    expect(motifForDish('سمچ مسكوف')).toBe('fish');
    expect(motifForDish('كبة حلب')).toBe('kubba');
    expect(motifForDish('تمن وبامية')).toBe('okra');
    expect(motifForDish('تمن وفاصوليا')).toBe('beans');
    expect(motifForDish('تمن وقيمة')).toBe('rice');
    expect(motifForDish('حمص')).toBe('hummus');
    expect(motifForDish('كباب بالكيلو')).toBe('tray');
    expect(motifForDish('مشكّل خالد')).toBe('tray');
    expect(motifForDish('لفة فلافل')).toBe('falafel');
    expect(motifForDish('طماطة مشوية')).toBe('salad');
    expect(motifForDish('شيش طاووق')).toBe('chicken');
    expect(motifForDish('كاهي وقيمر')).toBe('bread');
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

describe('kitchen looks', () => {
  it('are stable per kitchen and vary across the launch kitchens', () => {
    expect(kitchenLook('k1')).toBe(kitchenLook('k1'));
    const looks = new Set(AZIZIYAH_RESTAURANTS.map((r) => kitchenLook(r.key)));
    for (const l of looks) expect(l).toBeLessThan(ART_LOOKS);
    expect(looks.size).toBeGreaterThan(1);
  });
});

describe('cuisine words get a dish circle (joy b6)', () => {
  it('draws the dish the word names', () => {
    expect(motifForCuisine('كباب')).toBe('kebab');
    expect(motifForCuisine('تكة')).toBe('tikka');
    expect(motifForCuisine('كبد')).toBe('liver');
    expect(motifForCuisine('تمن ومرق')).toBe('rice');
    expect(motifForCuisine('شاورما')).toBe('shawarma');
    expect(motifForCuisine('مناقيش')).toBe('bread');
    expect(motifForCuisine('فلافل')).toBe('falafel');
  });
  it('knows the kitchen words a dish name would not use', () => {
    expect(motifForCuisine('فطور')).toBe('tea');
    expect(motifForCuisine('حلويات')).toBe('sweet');
    expect(motifForCuisine('مشويات')).toBe('kebab');
    expect(motifForCuisine('معجنات')).toBe('bread');
  });
  it('falls back to a plate for a word it does not know', () => {
    expect(motifForCuisine('برغر')).toBe('plate');
  });
});

describe('food doors pictures (bugs b3, b4)', () => {
  it('coffee is a cup, not the tea glass; ice cream is a cone, not the sweets tray', () => {
    expect(motifForDish('قهوة عربية')).toBe('coffee');
    expect(motifForDish('لاتيه مثلج')).toBe('coffee');
    expect(motifForDish('چاي كرك')).toBe('tea');
    expect(motifForDish('كوب آيس كريم قيمر')).toBe('icecream');
    expect(motifForDish('دوندرمة بالفستق')).toBe('icecream');
    expect(motifForDish('كليچة تمر')).toBe('sweet');
    expect(motifForDish('موز بالحليب')).toBe('juice');
    expect(motifForDish('شي جديد', 'قهوة')).toBe('coffee');
  });
  it('a shop is drawn by what it is, never the rice fallback', () => {
    expect(motifForKitchen(['coffee', 'cake'], 'قهوة · چاي · كيك')).toBe('coffee');
    expect(motifForKitchen(['juice'], 'عصير طازج')).toBe('juice');
    expect(motifForKitchen(['sweets', 'kunafa', 'ice_cream'], 'كنافة · بقلاوة')).toBe('sweet');
    expect(motifForKitchen(['ice_cream'], 'آيس كريم')).toBe('icecream');
    expect(motifForKitchen(['burger'])).toBe('plate');
  });
  it('the two grill kitchens no longer share a picture', () => {
    expect(motifForKitchen(['grill', 'kebab', 'tikka', 'liver', 'sandwiches'], 'كباب · تكة · كبد')).toBe('kebab');
    expect(motifForKitchen(['grill', 'kebab', 'tikka', 'chicken', 'rice'], 'مشويات · دجاج · تمن ومرق')).toBe('tray');
    expect(motifForKitchen(['shawarma', 'falafel'], 'شاورما · فلافل · مناقيش')).toBe('shawarma');
    expect(motifForKitchen(['breakfast', 'pacha', 'rice', 'stew'], 'باچة · ريوگ · تمن ومرق')).toBe('pacha');
    expect(motifForKitchen(['grill'])).toBe('kebab');
  });
});
