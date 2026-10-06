import { describe, expect, it } from 'vitest';
import type { JobReceipt } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { disputePrefill, ratePct, receiptRef, receiptRows, receiptTitle } from './receipt-logic';

const t = createT('ar-IQ');

function receipt(over: Partial<JobReceipt> = {}): JobReceipt {
  return {
    key: 't_ride',
    tripId: 't_ride',
    orderId: 'ord_1',
    ticket: '1284',
    at: new Date('2026-10-05T16:40:00Z'),
    lines: [
      { type: 'fare', label_ar: 'أجرة', label_en: 'Fare', amountIqd: 5000, memo: null, reason: { code: 'fare', params: {} } },
      { type: 'delivery_fee', label_ar: 'أجرة التوصيل', label_en: 'Delivery', amountIqd: 250, memo: 'night', reason: { code: 'night', params: { time: '11:00' } } },
      { type: 'delivery_fee', label_ar: 'أجرة التوصيل', label_en: 'Delivery', amountIqd: 250, memo: 'weather', reason: { code: 'rain', params: {} } },
      { type: 'commission_accrued', label_ar: 'عمولة', label_en: 'Commission', amountIqd: -600, memo: null, reason: { code: 'take', params: { rate: 12 } } },
    ],
    grossIqd: 5500,
    takeIqd: 600,
    takeRate: 0.12,
    tipsIqd: 0,
    netIqd: 4900,
    cash: null,
    queryOpen: false,
    ...over,
  };
}

describe('why was I paid this (S-7)', () => {
  it('each line carries the same reason sentence the customer saw, the take shows its rate', () => {
    const rows = receiptRows(receipt(), t);
    expect(rows.map((r) => r.reason)).toEqual([
      'أجرة المشوار حسب المسافة والمنطقة',
      'بعد الساعة 11:00 ليلاً',
      'الجو مطر، الدليفري يستاهل',
      `المنصة تاخذ ${ratePct(0.12)} من الأجرة، الباقي كله إلك`,
    ]);
    expect(rows[3]).toMatchObject({ take: true, label: `عمولة المنصة ${ratePct(0.12)}`, amountIqd: -600 });
    // Memo-named pay keeps its partner name (night → إضافة الليل).
    expect(rows[1]!.label).toBe(t('partner.pay_night'));
  });

  it('the ticket number reads "#1284" in one piece; without an order, the short reference', () => {
    expect(receiptRef(receipt())).toBe('⁦#1284⁩');
    expect(receiptRef(receipt({ ticket: null, key: 'trip_abc9z' }))).toBe('⁦BC9Z⁩');
    // A ride is a مشوار, a delivery a طلب.
    expect(receiptTitle(receipt(), t)).toBe('مشوار ⁦#1284⁩');
    expect(disputePrefill(receipt(), t)).toBe('عندي اعتراض على أجرة المشوار ⁦#1284⁩: ');
    const food = receipt({ lines: receipt().lines.filter((l) => l.type !== 'fare') });
    expect(receiptTitle(food, t)).toBe('طلب ⁦#1284⁩');
    expect(disputePrefill(food, t)).toBe('عندي اعتراض على أجرة الطلب ⁦#1284⁩: ');
  });
});
