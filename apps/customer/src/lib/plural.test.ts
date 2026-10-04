import { describe, expect, it } from 'vitest';
import { t } from '@driver/i18n';
import { arPlural, countKey } from './plural';

describe('Arabic count forms', () => {
  it('picks one / two / few / many', () => {
    expect([1, 2, 3, 10, 11, 0, 103, 111].map(arPlural)).toEqual(['one', 'two', 'few', 'few', 'many', 'many', 'few', 'many']);
  });

  it('reads naturally with the locale keys', () => {
    const say = (n: number) => t(countKey('list.count', n), { n });
    expect(say(1)).toBe('مطعم واحد');
    expect(say(2)).toBe('مطعمين');
    expect(say(4)).toBe('4 مطاعم');
    expect(say(12)).toBe('12 مطعم');
    expect(t(countKey('search.results_count', 6), { n: 6 })).toBe('6 نتائج');
  });
});
