import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIBRARY } from './library-data';
import { libraryMatches, normaliseAr, type LibraryDishLike } from './library';

const LIB: LibraryDishLike[] = [
  { slug: 'tikka', nameAr: 'تكة', words: ['تكة', 'تكه'], section: 'grill' },
  { slug: 'chicken', nameAr: 'دجاج مشوي', words: ['دجاج', 'فروج'], section: 'grill' },
  { slug: 'kebab', nameAr: 'كباب', words: ['كباب'], section: 'grill' },
  { slug: 'zinger', nameAr: 'زنگر', words: ['زنگر', 'زنجر', 'زنكر'], section: 'fast' },
  { slug: 'tea', nameAr: 'چاي', words: ['چاي', 'شاي'], section: 'drinks' },
  { slug: 'salad', nameAr: 'زلاطة', words: ['زلاطة', 'سلطة'], section: 'breakfast' },
];

describe('dish photo library', () => {
  it('reads Iraqi spellings the same way', () => {
    expect(normaliseAr('الزنگر')).toBe(normaliseAr('زنكر'));
    expect(normaliseAr('چاي')).toBe(normaliseAr('جاي'));
    expect(normaliseAr('تكة')).toBe(normaliseAr('تكه'));
  });

  it('puts the dish named first at the top, and finds every dish the name mentions', () => {
    expect(libraryMatches(LIB, 'لفة تكة دجاج').map((d) => d.slug)).toEqual(['tikka', 'chicken']);
    expect(libraryMatches(LIB, 'وجبة زنجر').map((d) => d.slug)).toEqual(['zinger']);
    expect(libraryMatches(LIB, 'استكان شاي').map((d) => d.slug)).toEqual(['tea']);
  });

  it('falls back to the section name, and to nothing when no word fits', () => {
    expect(libraryMatches(LIB, 'صحن الشيف', 'سلطات').map((d) => d.slug)).toEqual([]);
    expect(libraryMatches(LIB, 'صحن اليوم', 'السلطة').map((d) => d.slug)).toEqual(['salad']);
    expect(libraryMatches(LIB, 'مشروب غازي')).toEqual([]);
  });
});

describe('library photos on the API', () => {
  it('every photo is a file the API serves (`apps/api/media/food`), with a name its route accepts', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../../api/media/food');
    const paths = LIBRARY.flatMap((d) => d.photos);
    expect(paths.length).toBe(95);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) {
      const name = p.replace('/media/food/', '');
      expect(p).toBe(`/media/food/${name}`);
      expect(name).toMatch(/^lib-[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/);
      expect(existsSync(join(dir, name)), name).toBe(true);
    }
  });
});
