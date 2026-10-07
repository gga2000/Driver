import { describe, expect, it } from 'vitest';
import { t } from '@driver/i18n';
import { backFact, foodFact, rideFact, soonNames, tripsFact } from './service-facts';

const read = (f: ReturnType<typeof foodFact>) => (f ? t(f.key, f.params) : null);
const on = { online: true, signedIn: true, loading: false, error: false };

describe('home service facts (Date & Saffron): only what the server knows now', () => {
  it('food counts the kitchens open now, else names when the first one opens', () => {
    expect(read(foodFact({ loading: false, openCount: 7, firstOpensAt: null }))).toBe('7 فاتحين هسة');
    expect(read(foodFact({ loading: false, openCount: 1, firstOpensAt: null }))).toBe('واحد فاتح هسة');
    expect(read(foodFact({ loading: false, openCount: 2, firstOpensAt: null }))).toBe('اثنين فاتحين هسة');
    expect(read(foodFact({ loading: false, openCount: 0, firstOpensAt: '7:00' }))).toBe('يفتحون الساعة 7:00');
    expect(read(foodFact({ loading: false, openCount: 0, firstOpensAt: null }))).toBe('مسدودين هسة');
    expect(foodFact({ loading: true, openCount: 0, firstOpensAt: null })).toBeNull();
  });
  it('taxi and tuktuk show the nearest free one with natural minutes, else what the vehicle is for', () => {
    expect(read(rideFact('taxi', { ...on, nearestMinutes: 3 }))).toBe('أقرب سايق 3 دقايق');
    expect(read(rideFact('tuktuk', { ...on, nearestMinutes: 2 }))).toBe('أقرب تكتك دقيقتين');
    expect(read(rideFact('taxi', { ...on, nearestMinutes: 12 }))).toBe('أقرب سايق 12 دقيقة');
    expect(read(rideFact('tuktuk', { ...on, nearestMinutes: null }))).toBe(t('ride.vehicle_tuktuk_hint'));
    expect(read(rideFact('taxi', { ...on, signedIn: false, nearestMinutes: null }))).toBe(t('ride.vehicle_taxi_hint'));
    expect(rideFact('taxi', { ...on, loading: true, nearestMinutes: null })).toBeNull();
  });
  it('every ride tile says it needs the internet while offline; food keeps its last copy', () => {
    const off = { ...on, online: false };
    expect(read(rideFact('taxi', { ...off, nearestMinutes: 3 }))).toBe('تحتاج نت');
    expect(read(tripsFact({ ...off, nextAt: '12:15' }))).toBe('تحتاج نت');
    expect(read(backFact({ ...off, nextAt: '12:15' }))).toBe('تحتاج نت');
  });
  it('Baghdad/Kut shows the next car leaving Aziziyah; الرجعة the next car back', () => {
    expect(read(tripsFact({ ...on, nextAt: '12:15' }))).toBe('أقرب سيارة 12:15');
    expect(read(tripsFact({ ...on, nextAt: null }))).toBe('ماكو سيارة هسة');
    expect(read(tripsFact({ ...on, signedIn: false, nextAt: null }))).toBe('مقاعد من كراجات العزيزية');
    expect(read(backFact({ ...on, nextAt: '4:25' }))).toBe('أقربها 4:25');
    expect(read(backFact({ ...on, nextAt: null }))).toBe('للعزيزية');
    expect(read(backFact({ ...on, signedIn: false, nextAt: null }))).toBe('للعزيزية');
    expect(tripsFact({ ...on, loading: true, nextAt: null })).toBeNull();
  });
  it('the coming-soon names read as one phrase', () => {
    expect(soonNames(['سوق', 'خطوط', 'طرود'], t)).toBe('سوق، خطوط وطرود');
    expect(soonNames(['سوق', 'طرود'], t)).toBe('سوق وطرود');
    expect(soonNames(['سوق'], t)).toBe('سوق');
  });
});
