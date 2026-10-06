import { describe, expect, it } from 'vitest';
import type { CatalogToday } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { activeSpot, countPhrase, LOOP_MS, SPOT_MS, SPOTS, spotCaption, todayLine } from './today';

const t = createT('ar-IQ');
const today = (patch: Partial<CatalogToday> = {}): CatalogToday => ({
  openRestaurants: 4,
  rajaaCarsToday: 6,
  tuktukFromIqd: 2000,
  baghdadGarage: { id: 'mp_garage_bab1', name_ar: 'كراج البوابة 1', name_en: 'Gate 1 garage' },
  latePromiseMin: 20,
  ...patch,
});

describe('welcome map of home (audit d-6)', () => {
  it('six spots, each inside the drawing, visited in one 6 s loop', () => {
    expect(SPOTS).toHaveLength(6);
    for (const s of SPOTS) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(1);
    }
    expect(LOOP_MS).toBe(6000);
    expect([0, SPOT_MS - 1, SPOT_MS, 5 * SPOT_MS, LOOP_MS, LOOP_MS + SPOT_MS].map(activeSpot)).toEqual([0, 0, 1, 5, 0, 1]);
  });

  it('captions take the price and the garage from the server, and say it plainly without them', () => {
    expect(spotCaption('food', today(), t)).toBe('أكل من مطاعم العزيزية');
    expect(spotCaption('tuktuk', today(), t)).toBe('تكتك بـ 2,000 دينار');
    expect(spotCaption('seat', today(), t)).toBe('مقعد لبغداد من كراج البوابة 1');
    expect(spotCaption('tuktuk', today({ tuktukFromIqd: null }), t)).toBe(t('welcome_map.tuktuk_plain'));
    expect(spotCaption('seat', undefined, t)).toBe(t('welcome_map.seat_plain'));
  });

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
});
