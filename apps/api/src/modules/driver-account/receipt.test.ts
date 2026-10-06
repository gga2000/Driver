import { describe, expect, it } from 'vitest';
import { orderTicketNumber, type DriverLedgerView, type StatementLine } from '@driver/contracts';
import { composeReceipt, reasonOf, receiptNote } from './receipt.js';

const CTX = { nightFrom: '11:00', waitAmountIqd: 250 };
const AT = new Date('2026-10-05T16:40:00Z');

let seq = 0;
function line(type: StatementLine['type'], amountIqd: number, over: Partial<StatementLine> = {}): StatementLine {
  return { id: `l${++seq}`, occurredAt: AT, type, label_ar: type, label_en: type, accountId: 'driver:d1', counterparty: 'x', amountIqd, balanceAfterIqd: 0, ...over };
}

function view(earnings: StatementLine[], cash: StatementLine[] = []): DriverLedgerView {
  const st = (lines: StatementLine[]) => ({ accountId: 'a', from: null, to: null, openingIqd: 0, closingIqd: 0, inIqd: 0, outIqd: 0, lines });
  return { driverId: 'd1', role: 'courier', tier: 'bronze', earningsBalanceIqd: 0, cashBalanceIqd: 0, owedIqd: 0, capIqd: 75_000, capRemainingIqd: 75_000, overCap: false, payoutDueIqd: 0, earnings: st(earnings), cash: st(cash) };
}

describe('why was I paid this (Partner S-7)', () => {
  it('names the reason of every line, reusing the quote sentences', () => {
    expect(reasonOf({ type: 'delivery_fee', memo: null, amountIqd: 1500 }, CTX, null)).toEqual({ code: 'delivery_full', params: {} });
    expect(reasonOf({ type: 'delivery_fee', memo: 'night', amountIqd: 250 }, CTX, null)).toEqual({ code: 'night', params: { time: '11:00' } });
    expect(reasonOf({ type: 'delivery_fee', memo: 'weather', amountIqd: 250 }, CTX, null)?.code).toBe('rain');
    expect(reasonOf({ type: 'fare', memo: null, amountIqd: 3000 }, CTX, 0.1)?.code).toBe('fare');
    expect(reasonOf({ type: 'commission_accrued', memo: null, amountIqd: -300 }, CTX, 0.1)).toEqual({ code: 'take', params: { rate: 10 } });
    expect(reasonOf({ type: 'tip', memo: null, amountIqd: 1000 }, CTX, null)?.code).toBe('tip');
    expect(reasonOf({ type: 'driver_incentive', memo: 'guarantee:2026-10-05:evening', amountIqd: 2000 }, CTX, null)?.code).toBe('guarantee');
    expect(reasonOf({ type: 'driver_incentive', memo: 'rebroadcast_compensation', amountIqd: 500 }, CTX, null)?.code).toBe('compensation');
    expect(reasonOf({ type: 'late_penalty_driver', memo: null, amountIqd: -500 }, CTX, null)?.code).toBe('penalty');
    expect(reasonOf({ type: 'delivery_fee', memo: 'wait', amountIqd: 500 }, CTX, null)).toEqual({ code: 'wait', params: { amount: 250 } });
  });

  it('a ride: fare then the take as a rate, cash all to the company, the ticket number', () => {
    const v = view(
      [line('commission_accrued', -300, { orderId: 'ord_ride' }), line('fare', 3000, { orderId: 'ord_ride' }), line('fare', 2000, { orderId: 'other' })],
      [line('cash_collected', -3000, { orderId: 'ord_ride' })],
    );
    const r = composeReceipt(v, 'ord_ride', CTX)!;
    expect(r.lines.map((l) => l.type)).toEqual(['fare', 'commission_accrued']);
    expect(r).toMatchObject({ grossIqd: 3000, takeIqd: 300, takeRate: 0.1, netIqd: 2700, tipsIqd: 0, ticket: orderTicketNumber('ord_ride'), orderId: 'ord_ride', queryOpen: false });
    expect(r.cash).toEqual({ collectedIqd: 3000, toMerchantIqd: 0, toCompanyIqd: 3000 });
    expect(r.ticket).toMatch(/^\d{4}$/);
  });

  it('a cash food delivery: the restaurant got its share at pickup, the rest goes to the company', () => {
    const v = view(
      [line('tip', 1000, { tripId: 't1', orderId: 'o1' }), line('delivery_fee', 1500, { tripId: 't1', orderId: 'o1' }), line('delivery_fee', 250, { tripId: 't1', orderId: 'o1', memo: 'night' })],
      [line('cash_collected', -18_000, { tripId: 't1', orderId: 'o1' }), line('merchant_paid_by_courier', 15_000, { tripId: 't1', orderId: 'o1' })],
    );
    const r = composeReceipt(v, 't1', CTX, { queryOpen: true })!;
    expect(r.lines.map((l) => [l.type, l.reason?.code])).toEqual([
      ['delivery_fee', 'delivery_full'],
      ['delivery_fee', 'night'],
      ['tip', 'tip'],
    ]);
    expect(r).toMatchObject({ takeRate: null, takeIqd: 0, netIqd: 2750, tipsIqd: 1000, tripId: 't1', queryOpen: true });
    expect(r.cash).toEqual({ collectedIqd: 18_000, toMerchantIqd: 15_000, toCompanyIqd: 3000 });
    expect(receiptNote(r)).toContain('الصافي 2,750 دينار');
  });

  it('settlements are not pay, and an unknown key has no receipt', () => {
    const v = view([line('driver_payout', -5000, { orderId: 'o1' }), line('delivery_fee', 1000, { orderId: 'o1' })]);
    expect(composeReceipt(v, 'o1', CTX)!.lines.map((l) => l.type)).toEqual(['delivery_fee']);
    expect(composeReceipt(v, 'nope', CTX)).toBeNull();
  });
});
