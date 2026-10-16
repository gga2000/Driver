import { describe, expect, it } from 'vitest';
import type { CatalogToday } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { countPhrase, nowLine, todayLine } from './today';

const t = createT('ar-IQ');
const today = (patch: Partial<CatalogToday> = {}): CatalogToday => ({
  openRestaurants: 4,
  rajaaCarsToday: 6,
  tuktukFromIqd: 2000,
  baghdadGarage: { id: 'mp_garage_bab1', name_ar: 'كراج البوابة 1', name_en: 'Gate 1 garage' },
  latePromiseMin: 20,
  ...patch,
});

describe('welcome live lines (catalog.today)', () => {
  it('the live proof line counts in Iraqi and leaves out what is zero', () => {
    expect(todayLine(today(), t)).toBe('اليوم: 4 مطاعم مفتوحة · 6 سيارات للرجعة');
    expect(todayLine(today({ rajaaCarsToday: 0 }), t)).toBe('اليوم: 4 مطاعم مفتوحة');
    expect(todayLine(today({ openRestaurants: 0, rajaaCarsToday: 0 }), t)).toBeNull();
    expect(todayLine(undefined, t)).toBeNull();
    expect(countPhrase(1, 'restaurants', t)).toBe('مطعم واحد مفتوح');
    expect(countPhrase(2, 'cars', t)).toBe('سيارتين للرجعة');
    expect(countPhrase(12, 'restaurants', t)).toBe('12 مطعم مفتوح');
    expect(todayLine(today(), t)).not.toContain('!');
  });

  it('the pill on the welcome photo says how many kitchens are open now, and nothing when none is', () => {
    expect(nowLine(today(), t)).toBe('هسة 4 مطاعم مفتوحة');
    expect(nowLine(today({ openRestaurants: 1 }), t)).toBe('هسة مطعم واحد مفتوح');
    expect(nowLine(today({ openRestaurants: 0 }), t)).toBeNull();
    expect(nowLine(undefined, t)).toBeNull();
  });
});
