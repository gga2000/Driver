import { describe, expect, it } from 'vitest';
import { locales, voiceProblems } from '@driver/i18n';
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

  it('follows the shared glossary (audit S-09): دليفري, دقيقة in full, no banned word', () => {
    expect(voiceProblems(ar).map((p) => `${p.key}: ${p.problem}`)).toEqual([]);
  });

  it('counted phrases agree with the number (audit S-17: "2 صنف" → "صنفين")', () => {
    const items = (count: number) => translate('merchant.card.items', { count }, 'ar-IQ');
    expect([1, 2, 5, 11, 100].map(items)).toEqual(['صنف واحد', 'صنفين', '5 أصناف', '11 صنف', '100 صنف']);
    const alert = (count: number) => translate('merchant.board.alert_count', { count }, 'ar-IQ');
    expect([2, 4, 12].map(alert)).toEqual(['طلبين جداد', '4 طلبات جديدة', '12 طلب جديد']);
    expect(translate('merchant.card.items', { count: 1 }, 'en')).toBe('1 item');
    expect(translate('merchant.card.items', { count: 3 }, 'en')).toBe('3 items');
  });

  it('exclamation marks only on the new-order alert', () => {
    const loud = Object.entries(ar).filter(([, v]) => v.includes('!')).map(([k]) => k);
    expect(loud.sort()).toEqual(['merchant.board.alert_new']);
  });

  it('translates local keys, falls back to shared ones, keeps unknown params visible', () => {
    expect(translate('merchant.nav.orders', undefined, 'ar-IQ')).toBe('الطلبات');
    expect(translate('merchant.nav.orders', undefined, 'en')).toBe('Orders');
    expect(translate('merchant.accept', undefined, 'ar-IQ')).toBe('اقبل');
    expect(translate('merchant.courier.on_the_way', { minutes: 4 }, 'ar-IQ')).toBe('الدليفري بالطريق · 4 دقيقة');
    expect(translate('merchant.card.since', {}, 'ar-IQ')).toBe('من {minutes} دقيقة');
  });
});
