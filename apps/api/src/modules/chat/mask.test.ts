import { describe, expect, it } from 'vitest';
import { MASKED_PHONE, maskIraqiPhones } from './mask.js';

describe('maskIraqiPhones', () => {
  it.each([
    ['07701234567', 'plain national'],
    ['0770 123 4567', 'spaced'],
    ['0770-123-4567', 'dashed'],
    ['0770.123.4567', 'dotted'],
    ['+9647701234567', 'E.164'],
    ['+964 770 123 4567', 'spaced E.164'],
    ['009647701234567', '00 prefix'],
    ['9647801234567', 'country code without plus'],
    ['7501234567', 'bare national number'],
    ['٠٧٧٠١٢٣٤٥٦٧', 'Arabic-Indic digits'],
    ['۰۷۷۰ ۱۲۳ ۴۵۶۷', 'Persian digits, spaced'],
  ])('masks %s (%s)', (phone) => {
    const r = maskIraqiPhones(`رقمي ${phone} اتصل بيه`);
    expect(r.masked).toBe(true);
    expect(r.text).toBe(`رقمي ${MASKED_PHONE} اتصل بيه`);
  });

  it('masks every number in a message and keeps the rest', () => {
    const r = maskIraqiPhones('اتصل على 07701234567 أو 07811112222، الباب الأزرق');
    expect(r.text).toBe(`اتصل على ${MASKED_PHONE} أو ${MASKED_PHONE}، الباب الأزرق`);
  });

  it.each([
    ['الحساب 12,500 دينار', 'an amount'],
    ['طلب رقم 123456', 'an order number'],
    ['077012345', 'too short'],
    ['077012345678901', 'part of a longer digit run'],
    ['06601234567', 'not a mobile prefix'],
    ['الساعة 7:30 بالبوابة 2', 'a time'],
  ])('leaves %s alone (%s)', (text) => {
    expect(maskIraqiPhones(text)).toEqual({ text, masked: false });
  });
});
