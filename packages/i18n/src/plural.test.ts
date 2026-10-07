import { describe, expect, it } from 'vitest';
import { pluralCategory, pluralFamilies, pluralKey, pluralKeyIn, tp } from './plural.js';
import { asCount, countParamOf, locales, resolvePlural, t } from './translate.js';

describe('pluralCategory (CLDR Arabic)', () => {
  it.each([
    [0, 'zero'],
    [1, 'one'],
    [2, 'two'],
    [3, 'few'],
    [10, 'few'],
    [11, 'many'],
    [99, 'many'],
    [100, 'other'],
    [102, 'other'],
    [103, 'few'],
    [111, 'many'],
  ] as const)('%i → %s', (n, c) => expect(pluralCategory(n)).toBe(c));
});

describe('pluralKeyIn fallback chain', () => {
  const has = (keys: string[]) => (k: string) => keys.includes(k);
  it('two falls back to few, other to many, and the base when nothing matches', () => {
    expect(pluralKeyIn('x', 2, has(['x_one', 'x_few', 'x_many']))).toBe('x_few');
    expect(pluralKeyIn('x', 100, has(['x_one', 'x_few', 'x_many']))).toBe('x_many');
    expect(pluralKeyIn('x', 7, has([]))).toBe('x');
  });
});

describe('counted phrases read as Iraqis say them (audit S-17)', () => {
  it('t() picks the form from the counted param, with no change at the call site', () => {
    expect(t('list.count', { n: 1 })).toBe('محل واحد');
    expect(t('list.count', { n: 2 })).toBe('محلين');
    expect(t('list.count', { n: 5 })).toBe('5 محلات');
    expect(t('list.count', { n: 14 })).toBe('14 محل');
    expect(t('partner.jobs_today', { n: 2 })).toBe('طلبين اليوم');
    expect(t('intercity.seats_left', { n: 3 })).toBe('باقي 3 مقاعد');
    expect(t('intercity.seats_left', { n: 1 })).toBe('باقي مقعد واحد');
  });
  it('the count is the placeholder before the counted noun, even when another param comes first', () => {
    expect(t('restaurant.rating', { rating: '4.7', count: 2 })).toBe('4.7 (تقييمين)');
    expect(t('partner.kh_sub_line', { children: 'علي', stops: 4, time: '7:00 ص' })).toBe('علي · 4 محطات · من الساعة 7:00 ص');
  });
  it('formatted numbers count too ("1,500", isolated runs)', () => {
    expect(asCount('1,500')).toBe(1500);
    expect(asCount('⁦12⁩')).toBe(12);
    expect(asCount('—')).toBeNull();
    expect(t('points.balance', { n: '2,500' })).toBe('2,500 نقطة');
  });
  it('English keeps singular for one', () => {
    expect(t('list.count', { n: 1 }, 'en')).toBe('1 shop');
    expect(t('list.count', { n: 4 }, 'en')).toBe('4 shops');
  });
  it('tp and pluralKey address a family by its base', () => {
    expect(pluralKey('time.hours', 2)).toBe('time.hours_two');
    expect(tp('time.hours', 11)).toBe('11 ساعة');
  });
  it('a key without `_one` and `_few` siblings is never touched', () => {
    expect(resolvePlural('x', '{n} طلب', { n: 2 }, (k) => k === 'x_two')).toBe('x');
  });
  it('countParamOf finds the counted placeholder', () => {
    expect(countParamOf('{rating} ({count} تقييم)')).toBe('count');
    expect(countParamOf('{route} · {date}')).toBeNull();
  });
});

describe('plural families in the shared table', () => {
  it('every plural form has its English twin', () => {
    const ar = locales['ar-IQ'] as Record<string, string>;
    const en = locales.en as Record<string, string>;
    for (const [base, forms] of pluralFamilies(ar)) {
      for (const f of forms) expect(en[`${base}_${f}`], `${base}_${f} in en.json`).toBeTruthy();
    }
  });
});
