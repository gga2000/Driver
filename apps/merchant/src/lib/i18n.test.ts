import { describe, expect, it } from 'vitest';
import { locales } from '@driver/i18n';
import { LOCAL, placeholders, translate } from './i18n-core';

const ar = LOCAL['ar-IQ'];
const en = LOCAL.en;

describe('merchant copy (voice guide)', () => {
  it('ar and en have the same keys and the same placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const k of Object.keys(ar)) expect(placeholders(en[k]!), k).toEqual(placeholders(ar[k]!));
  });

  it('every key is merchant.* and none shadows a shared key', () => {
    const shared = new Set(Object.keys(locales['ar-IQ']));
    for (const k of Object.keys(ar)) {
      expect(k.startsWith('merchant.'), k).toBe(true);
      expect(shared.has(k), `${k} already exists in @driver/i18n`).toBe(false);
    }
  });

  it('Western digits, no emojis, no MSA particles or honorifics in Arabic', () => {
    const banned = ['يرجى', 'قم ب', 'سوف', 'لقد', 'لا يوجد', 'الآن', 'عزيزي', 'د.ع', 'حسناً'];
    for (const [k, v] of Object.entries(ar)) {
      expect(v, k).not.toMatch(/[٠-٩]/);
      expect(v, k).not.toMatch(/\p{Extended_Pictographic}/u);
      for (const b of banned) expect(v.includes(b), `${k}: ${b}`).toBe(false);
    }
  });

  it('exclamation marks only on the new-order alert', () => {
    const loud = Object.entries(ar).filter(([, v]) => v.includes('!')).map(([k]) => k);
    expect(loud.sort()).toEqual(['merchant.board.alert_count', 'merchant.board.alert_new']);
  });

  it('translates local keys, falls back to shared ones, keeps unknown params visible', () => {
    expect(translate('merchant.nav.orders', undefined, 'ar-IQ')).toBe('الطلبات');
    expect(translate('merchant.nav.orders', undefined, 'en')).toBe('Orders');
    expect(translate('merchant.accept', undefined, 'ar-IQ')).toBe('اقبل');
    expect(translate('merchant.courier.on_the_way', { minutes: 4 }, 'ar-IQ')).toBe('الدليفري بالطريق · 4 د');
    expect(translate('merchant.card.since', {}, 'ar-IQ')).toBe('من {minutes} د');
  });
});
