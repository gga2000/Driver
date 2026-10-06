import { describe, expect, it } from 'vitest';
import type { WalletLine } from '@driver/contracts';
import { lineHref, moneyIn, walletDays } from './wallet-lines';

const NOW = new Date('2026-10-06T12:00:00Z'); // 15:00 Baghdad
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const line = (id: string, over: Partial<WalletLine>): WalletLine =>
  ({ id, occurredAt: NOW, book: 'money', kind: 'food', title_ar: '', title_en: '', detail_ar: null, detail_en: null, amount: -1000, unit: 'iqd', method: 'cash', ...over }) as WalletLine;

describe('walletDays', () => {
  const lines = [
    line('food', { occurredAt: h(-1), orderId: 'ord_1' }),
    line('seat', { occurredAt: h(-2), kind: 'seat', bookingId: 'bk_1' }),
    line('late', { occurredAt: h(-26), kind: 'late_credit', amount: 1000, orderId: 'ord_0' }),
    line('pts', { occurredAt: h(-26), book: 'points', kind: 'points', unit: 'points', amount: 15 }),
    line('top', { occurredAt: h(-80), kind: 'topup', amount: 25_000, topUpId: 'tu_1' }),
  ];
  it('groups by Baghdad day, newest first', () => {
    expect(walletDays(lines, 'all', NOW).map((d) => [d.day.kind, d.lines.map((l) => l.id)])).toEqual([
      ['today', ['food', 'seat']],
      ['yesterday', ['late', 'pts']],
      ['date', ['top']],
    ]);
  });
  it('filters by what a line was; a credit follows its order', () => {
    expect(walletDays(lines, 'food', NOW).flatMap((d) => d.lines.map((l) => l.id))).toEqual(['food', 'late']);
    expect(walletDays(lines, 'rajaa', NOW).flatMap((d) => d.lines.map((l) => l.id))).toEqual(['seat']);
    expect(walletDays(lines, 'points', NOW).flatMap((d) => d.lines.map((l) => l.id))).toEqual(['pts']);
    expect(walletDays(lines, 'topup', NOW).flatMap((d) => d.lines.map((l) => l.id))).toEqual(['top']);
    expect(walletDays(lines, 'rides', NOW)).toEqual([]);
  });
});

describe('lineHref', () => {
  it('opens the pass, the order or the receipt', () => {
    expect(lineHref({ bookingId: 'bk_1', orderId: undefined })).toBe('/rajaa/pass/bk_1');
    expect(lineHref({ orderId: 'ord_1' })).toBe('/order/ord_1');
    expect(lineHref({ topUpId: 'tu_1' })).toBe('/topup?id=tu_1');
    expect(lineHref({})).toBeNull();
  });
});

describe('moneyIn', () => {
  const top = line('t2', { kind: 'topup', amount: 25_000, occurredAt: h(-0.5) });
  it('shows the newest top-up of the last day once', () => {
    expect(moneyIn([top, line('t1', { kind: 'topup', amount: 10_000, occurredAt: h(-5) })], null, NOW)?.id).toBe('t2');
    expect(moneyIn([top], 't2', NOW)).toBeNull();
  });
  it('never celebrates an old top-up', () => {
    expect(moneyIn([line('old', { kind: 'topup', amount: 5_000, occurredAt: h(-30) })], null, NOW)).toBeNull();
  });
});
