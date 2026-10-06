import { describe, expect, it } from 'vitest';
import { t } from '@driver/i18n';
import { cardFileName, cardHint, firstNameOnly, mealOf, shareCardModel } from './share-card';

const baghdad = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 7, h - 3, m));
const say = (c: { key: Parameters<typeof t>[0]; params?: Record<string, string | number> } | null) => (c ? t(c.key, c.params) : null);

describe('share card (joy l5)', () => {
  it('names the meal on the Baghdad clock', () => {
    expect(mealOf(baghdad(8))).toBe('breakfast');
    expect(mealOf(baghdad(13, 30))).toBe('lunch');
    expect(mealOf(baghdad(21))).toBe('dinner');
    expect(mealOf(baghdad(2))).toBe('dinner');
  });

  it('food: the dish drawing, «بالعافية», the kitchen, and the name only when chosen', () => {
    const plain = shareCardModel({ kind: 'food', dishName: 'كباب لحم', merchant: 'مطعم خالد' }, { at: baghdad(13), name: 'علي حسن', includeName: false });
    expect(plain.art).toEqual({ dish: 'kebab' });
    expect(say(plain.head)).toBe('بالعافية');
    expect(say(plain.sub)).toBe('غدانا من مطعم خالد');
    const named = shareCardModel({ kind: 'food', dishName: 'كباب لحم', merchant: 'مطعم خالد' }, { at: baghdad(21), name: 'علي حسن', includeName: true });
    expect(say(named.sub)).toBe('عشا علي من مطعم خالد');
  });

  it('never a price, a number or an address on any card', () => {
    const cards = [
      shareCardModel({ kind: 'food', dishName: null, merchant: 'مطعم خالد' }, { at: baghdad(13), name: 'علي', includeName: true }),
      shareCardModel({ kind: 'ride', vehicle: 'tuktuk' }, { at: baghdad(13), name: 'علي', includeName: true }),
      shareCardModel({ kind: 'rajaa', toCity: 'بغداد' }, { at: baghdad(13), name: null, includeName: true }),
    ];
    for (const c of cards) for (const line of [say(c.head), say(c.sub), say(c.brand)]) expect(line ?? '').not.toMatch(/\d|دينار/);
  });

  it('rides and الرجعة: the arrival scene with its vehicle', () => {
    const ride = shareCardModel({ kind: 'ride', vehicle: 'car' }, { at: baghdad(13), name: 'زينب', includeName: true });
    expect(ride.art).toEqual({ scene: 'safe_arrival', vehicle: 'car' });
    expect(say(ride.head)).toBe('زينب: وصلنا بالسلامة');
    expect(say(ride.sub)).toBe('بتكسي من درايفر');
    const rajaa = shareCardModel({ kind: 'rajaa', toCity: 'العزيزية' }, { at: baghdad(13), name: 'علي', includeName: false });
    expect(rajaa.art).toEqual({ scene: 'safe_arrival', vehicle: 'minibus' });
    expect(say(rajaa.sub)).toBe('وصلنا العزيزية');
    expect(shareCardModel({ kind: 'rajaa', toCity: null }, { at: baghdad(13), name: null, includeName: false }).sub).toBeNull();
  });

  it('first names only, and file names carry no name', () => {
    expect(firstNameOnly('  علي حسن كاظم ')).toBe('علي');
    expect(firstNameOnly('')).toBeNull();
    expect(cardFileName('food', 'ord_ABC-123456789')).toBe('driver-food-23456789.png');
    expect(cardHint('food')).toBe('sharecard.hint');
    expect(cardHint('rajaa')).toBe('sharecard.hint_trip');
  });
});
