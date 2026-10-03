import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { translate, type TKey } from '@/lib/i18n-core';
import { iqd } from '@/lib/money';
import { buildReceipt, toPlainText } from './receipt';
import { receiptHtml } from './receipt-html';

const t = (key: TKey, params?: Record<string, string | number>) => translate(key, params, 'ar-IQ');

const order: BoardOrder = {
  id: 'ord_1',
  number: '4821',
  column: 'new',
  state: 'placed',
  type: 'food',
  placedAt: new Date('2026-10-03T16:42:00Z'),
  offeredAt: new Date('2026-10-03T16:42:00Z'),
  acceptBy: new Date('2026-10-03T16:43:30Z'),
  acceptedAt: null,
  promisedReadyAt: new Date('2026-10-03T17:07:00Z'),
  readyAt: null,
  scheduledFor: null,
  prepMinutes: null,
  paymentMethod: 'cash',
  itemsTotalIqd: 24500,
  totalIqd: 26000,
  collectCashIqd: 26000,
  itemCount: 5,
  note: 'دگ الجرس مرتين',
  partial: null,
  catering: false,
  late: false,
  courier: { state: 'none', firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null },
  groups: [
    {
      key: 'orderer',
      kind: 'orderer',
      label: null,
      note: null,
      itemCount: 2,
      lines: [{ lineId: 'l1', name: 'لفة تكة', qty: 2, modifiers: ['صمون', 'حار'], note: 'بدون بصل', unitPriceIqd: 2500, totalIqd: 5000, availability: 'available' }],
    },
    {
      key: 'p1',
      kind: 'participant',
      label: 'أبو حسين',
      note: 'حار هواي',
      itemCount: 3,
      lines: [
        { lineId: 'l2', name: 'وجبة كباب', qty: 1, modifiers: [], note: null, unitPriceIqd: 7000, totalIqd: 7000, availability: 'available' },
        { lineId: 'l3', name: 'شنينة', qty: 2, modifiers: [], note: null, unitPriceIqd: 750, totalIqd: 1500, availability: 'unavailable' },
      ],
    },
  ],
};

describe('kitchen ticket (80 mm)', () => {
  const r = buildReceipt(order, { storeName: 'مطعم خالد', t, money: (n) => iqd(n) });

  it('store, big number, times in Baghdad 12-hour, cash to collect', () => {
    expect(r.lines.slice(0, 4)).toEqual([
      { kind: 'title', text: 'مطعم خالد' },
      { kind: 'number', text: 'طلب #4821' },
      { kind: 'meta', text: 'انطلب 7:42  ·  جاهز 8:07' },
      { kind: 'payment', text: 'كاش: الدليفري يستلم 26,000 دينار', cash: true },
    ]);
  });

  it('groups items by person with notes, marks items that are out, ends with the order note and total', () => {
    const people = r.lines.filter((l) => l.kind === 'person');
    expect(people).toEqual([
      { kind: 'person', text: 'صاحب الطلب', note: null },
      { kind: 'person', text: 'لـ أبو حسين', note: 'حار هواي' },
    ]);
    expect(r.lines.find((l) => l.kind === 'item' && l.name === 'شنينة')).toMatchObject({ removed: true });
    expect(r.lines.at(-4)).toEqual({ kind: 'note', text: 'ملاحظة الطلب: دگ الجرس مرتين' });
    expect(r.lines.at(-1)).toEqual({ kind: 'footer', text: 'درايفر' });
    expect(r.lines.at(-2)).toEqual({ kind: 'total', label: 'مجموع الأصناف', value: '24,500 دينار' });
  });

  it('a single person gets no header; prepaid says so', () => {
    const solo = buildReceipt({ ...order, paymentMethod: 'prepaid', collectCashIqd: 0, groups: [order.groups[0]!] }, { storeName: 'x', t, money: (n) => iqd(n) });
    expect(solo.lines.some((l) => l.kind === 'person')).toBe(false);
    expect(solo.lines.find((l) => l.kind === 'payment')).toEqual({ kind: 'payment', text: 'مدفوع بالتطبيق', cash: false });
  });

  it('plain text fits 48 columns and keeps notes bold', () => {
    const text = toPlainText(r);
    for (const row of text.split('\n')) expect([...row].length).toBeLessThanOrEqual(48);
    expect(text).toContain('**بدون بصل**');
    expect(text).toContain('2 × لفة تكة');
  });

  it('html is RTL, escaped and sized for 80 mm', () => {
    const html = receiptHtml(buildReceipt({ ...order, note: '<b>x</b>' }, { storeName: 'مطعم خالد', t, money: (n) => iqd(n) }));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('size: 80mm');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
