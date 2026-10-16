import { describe, expect, it } from 'vitest';
import type { RajaaDriverStats } from '@driver/contracts';
import { createT } from '@driver/i18n';
import type { TFn } from '@/lib/i18n';
import { badgeCopy, compactRecord, monthYear, peopleSay, percentLabel, ratingValue, recordFacts, rodeBefore } from './driver-record';

const t = createT('ar-IQ') as TFn;
const base: RajaaDriverStats = { trips: 0, ratingAvg: null, ratingCount: 0, onTimeShare: null, topTags: [], badges: [], ridesWithYou: 0 };

describe('a الرجعة driver\'s record in Iraqi Arabic (x12–x17)', () => {
  it('rating reads with one decimal, percentages keep the sign after the number', () => {
    expect(ratingValue(5)).toBe('5.0');
    expect(ratingValue(4.86)).toBe('4.9');
    expect(percentLabel(0.947)).toBe('95%');
  });

  it('the board tile: «سايق جديد» before a first trip, trips with the counted forms, the rating apart for its star', () => {
    expect(compactRecord(t, base)).toEqual({ rating: null, text: 'سايق جديد' });
    expect(compactRecord(t, { ...base, trips: 1 }).text).toBe('سفرة وحدة');
    expect(compactRecord(t, { ...base, trips: 2 }).text).toBe('سفرتين');
    expect(compactRecord(t, { ...base, trips: 7, ratingAvg: 4.8, ratingCount: 5 })).toEqual({ rating: '4.8', text: '7 سفرات' });
    expect(compactRecord(t, { ...base, trips: 120 }).text).toBe('120 سفرة');
  });

  it('the strip: «جديد» under the rating minimum; on-time only once it can be judged', () => {
    expect(recordFacts(t, { ...base, trips: 2, ratingCount: 2 }).map((i) => [i.value, i.label])).toEqual([
      ['جديد', 'تقييماته قليلة بعد'],
      ['2', 'سفراته ويانا'],
    ]);
    const full = recordFacts(t, { ...base, trips: 40, ratingAvg: 4.9, ratingCount: 32, onTimeShare: 0.95 });
    expect(full.map((i) => i.value)).toEqual(['4.9', '40', '95%']);
    expect(full[0]).toMatchObject({ icon: 'star', label: '32 تقييم', accessibilityLabel: 'تقييمه 4.9 من 5، من 32 راكب' });
  });

  it('what riders say, «سافرت وياه قبل» and the badges\' rules in words', () => {
    expect(peopleSay(t, base)).toBeNull();
    expect(peopleSay(t, { ...base, topTags: ['on_time', 'clean_car'] })).toBe('الركاب يگولون: على الوقت، سيارة نظيفة');
    expect(rodeBefore(t, 0)).toBeNull();
    expect(rodeBefore(t, 1)).toBe('سافرت وياه قبل');
    expect(rodeBefore(t, 3)).toBe('سافرت وياه 3 مرات');
    expect(badgeCopy(t, 'top_driver').body).toBe('تقييمه 4.8 وفوق من 20 راكب وأكثر، ويوصل الكراج على الوقت 9 من 10');
    expect(badgeCopy(t, 'family_trusted').title).toBe('العوائل ترتاحله');
  });

  it('a review month in Baghdad', () => {
    expect(monthYear(t, new Date('2026-09-30T21:00:00Z'))).toBe('تشرين الأول 2026');
  });
});
