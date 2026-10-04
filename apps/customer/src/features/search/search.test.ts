import { describe, expect, it } from 'vitest';
import { foldArabic, searchScore } from '@driver/contracts';
import { MAX_RECENTS, popularTerms, pushRecent } from './logic';

describe('Arabic search folding (shared with the API)', () => {
  it('folds taa marbuta, alef forms, alef maqsura and Iraqi letters', () => {
    expect(foldArabic('تكة')).toBe(foldArabic('تكه'));
    expect(foldArabic('أربيل')).toBe(foldArabic('اربيل'));
    expect(foldArabic('إسطنبول')).toBe(foldArabic('اسطنبول'));
    expect(foldArabic('عراقى')).toBe(foldArabic('عراقي'));
    expect(foldArabic('ريوگ')).toBe(foldArabic('ريوك'));
    expect(foldArabic('چاي')).toBe(foldArabic('جاي'));
    expect(foldArabic('پيتزا')).toBe(foldArabic('بيتزا'));
  });

  it('drops a leading "ال" from words longer than three letters, keeps short words', () => {
    expect(foldArabic('الشاورما')).toBe('شاورما');
    expect(foldArabic('مطعم الحاج')).toBe('مطعم حاج');
    expect(foldArabic('الف')).toBe('الف');
  });

  it('turns Eastern digits Western and drops tashkeel, tatweel and punctuation', () => {
    expect(foldArabic('خبز تنور (٤ أرغفة)')).toBe('خبز تنور 4 ارغفه');
    expect(foldArabic('شارع ۳۰')).toBe('شارع 30');
    expect(foldArabic('مشكّـل')).toBe('مشكل');
    expect(foldArabic('  كباب ،  تكة!! ')).toBe('كباب تكه');
  });

  it('scores exact, word-start and inside matches; every word has to match', () => {
    expect(searchScore('تكه', 'تكة')).toBe(3);
    expect(searchScore('شاور', 'صحن شاورما دجاج')).toBe(2);
    expect(searchScore('ورما', 'شاورما')).toBe(1);
    expect(searchScore('شاورما لحم', 'شاورما دجاج')).toBe(0);
    expect(searchScore('', 'شاورما')).toBe(0);
  });
});

describe('search recents', () => {
  it('puts the newest first and replaces the same words spelled another way', () => {
    let r: string[] = [];
    r = pushRecent(r, 'كباب');
    r = pushRecent(r, ' التكة ');
    r = pushRecent(r, 'كباب');
    r = pushRecent(r, 'تكه');
    expect(r).toEqual(['تكه', 'كباب']);
  });

  it('ignores empty queries and keeps at most a few', () => {
    expect(pushRecent(['كباب'], '  ؟ ')).toEqual(['كباب']);
    let r: string[] = [];
    for (let i = 0; i < 12; i++) r = pushRecent(r, `صنف ${i}`);
    expect(r).toHaveLength(MAX_RECENTS);
    expect(r[0]).toBe('صنف 11');
  });
});

describe('popular terms from the live catalog', () => {
  it('splits cuisine lines, counts kitchens, keeps the menu spelling', () => {
    const lines = ['كباب · تكة · كبد', 'مشويات · دجاج · تمن ومرق', 'شاورما · فلافل · مناقيش', 'باچة · ريوگ · تمن ومرق'];
    const terms = popularTerms(lines, 5);
    expect(terms[0]).toBe('تمن ومرق');
    expect(terms).toHaveLength(5);
    expect(terms).toContain('كباب');
    expect(popularTerms([])).toEqual([]);
  });
});
