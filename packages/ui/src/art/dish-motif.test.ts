import { describe, expect, it } from 'vitest';
import { DISH_LOOKS } from './dishes';
import { dishLook, motifForDish, temperatureOf } from './dish-motif';

describe('dish motif (the merchant tray shows the customer’s picture)', () => {
  it('reads the dish from its name, then its section', () => {
    expect(motifForDish('بقلاوة فستق')).toBe('baklava');
    expect(motifForDish('ليمون بالنعناع')).toBe('lemonade');
    expect(motifForDish('لفة كبد')).toBe('wrap');
    expect(motifForDish('طبق البيت', 'شوربة')).toBe('soup');
    expect(motifForDish('طبق البيت')).toBe('plate');
  });

  it('marks drinks hot or cold, and nothing else', () => {
    expect(temperatureOf('چاي أبو الهيل')).toBe('hot');
    expect(temperatureOf('عصير رمان')).toBe('cold');
    expect(temperatureOf('آيس لاتيه')).toBe('cold');
    expect(temperatureOf('آيس كريم مستكة')).toBeNull();
    expect(temperatureOf('تكة')).toBeNull();
  });

  it('gives each dish a stable look', () => {
    expect(dishLook('item-1')).toBe(dishLook('item-1'));
    expect(dishLook('item-1')).toBeGreaterThanOrEqual(0);
    expect(dishLook('item-1')).toBeLessThan(DISH_LOOKS);
  });
});
