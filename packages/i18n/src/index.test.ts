import { describe, expect, it } from 'vitest';
import { createT, isRtl, locales, t } from './index.js';

describe('i18n', () => {
  it('defaults to Iraqi Arabic', () => {
    expect(t('home.where_to')).toBe('وين أوصلك؟');
    expect(t('home.order_now')).toBe('اطلب هسة');
  });
  it('interpolates params', () => {
    expect(t('trip.eta', { minutes: 12 })).toBe('يوصلك خلال 12 دقيقة');
    expect(t('trip.eta', { minutes: 12 }, 'en')).toBe('Arrives in 12 min');
  });
  it('leaves unknown placeholders visible rather than blank', () => {
    expect(t('trip.eta', {})).toBe('يوصلك خلال {minutes} دقيقة');
  });
  it('every Arabic key has an English counterpart and vice versa', () => {
    const ar = Object.keys(locales['ar-IQ']).sort();
    const en = Object.keys(locales.en).sort();
    expect(en).toEqual(ar);
    expect(ar.length).toBeGreaterThanOrEqual(30);
  });
  it('createT binds a locale', () => {
    const tEn = createT('en');
    expect(tEn('action.confirm')).toBe('Confirm');
  });
  it('isRtl recognises Arabic locales', () => {
    expect(isRtl('ar-IQ')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
