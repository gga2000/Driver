import { describe, expect, it } from 'vitest';
import { carryModifierPicks, foldDishName, matchDish, similarKitchens } from './carry-over.js';

describe('carry-over (one rule for the app and the API, joy o15)', () => {
  it('folds names and matches the same dish across kitchens', () => {
    expect(foldDishName('كبّة  (حلب)')).toBe('كبه');
    const menu = [{ name: 'لفة كباب' }, { name: 'شاورما دجاج' }, { name: 'كباب عراقي' }];
    expect(matchDish('لفه كباب', menu)?.name).toBe('لفة كباب');
    expect(matchDish('عراقي كباب', menu)?.name).toBe('كباب عراقي');
    expect(matchDish('دولمة', menu)).toBeNull();
  });
  it('carries choices by name; a required one that cannot be filled stops the dish', () => {
    const groups = [
      { id: 'bread', min: 1, max: 1, modifiers: [{ name: 'صمون', available: true }, { name: 'تنور', available: true }] },
      { id: 'extra', min: 0, max: 2, modifiers: [{ name: 'جبن', available: false }, { name: 'طرشي', available: true }] },
    ];
    expect(carryModifierPicks(['تنور', 'جبن', 'طرشي'], groups)?.map((p) => `${p.groupId}:${p.modifier.name}`)).toEqual(['bread:تنور', 'extra:طرشي']);
    expect(carryModifierPicks(['صاج'], groups)).toBeNull();
  });
  it('suggests open kitchens sharing the most tags, never the one that said no', () => {
    const card = (id: string, tags: string[], open = true) => ({ id, tags, open, pickup: {}, etaMinMinutes: 30, prepMinMinutes: 20, rating: null });
    const out = similarKitchens({ id: 'a', tags: ['grill', 'kebab'] }, [card('a', ['grill']), card('b', ['shawarma']), card('c', ['grill', 'kebab']), card('d', ['grill'], false)]);
    expect(out.map((c) => c.id)).toEqual(['c', 'b']);
  });
});
