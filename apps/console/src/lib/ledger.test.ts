import { describe, expect, it } from 'vitest';
import { balanceWords, capUsage, groupByDay, isHandover, lineSide, memoWords, newestFirst, sumLines } from './ledger';
import { dayKey } from './periods';

describe('cash vs cap bar', () => {
  it('fills to the share of the cap', () => {
    expect(capUsage(50_000, 100_000)).toEqual({ percent: 50, barPercent: 50, over: false, warn: false });
  });
  it('warns from 80 %', () => {
    expect(capUsage(80_000, 100_000).warn).toBe(true);
  });
  it('turns red over the cap and clamps the bar', () => {
    expect(capUsage(125_000, 100_000)).toEqual({ percent: 125, barPercent: 100, over: true, warn: false });
  });
  it('trusts the API flag when given', () => {
    expect(capUsage(10_000, 100_000, true).over).toBe(true);
  });
  it('treats negative owed (platform owes him) as empty', () => {
    expect(capUsage(-5_000, 100_000).barPercent).toBe(0);
    expect(capUsage(0, 0)).toMatchObject({ percent: 0, over: false });
  });
});

describe('statement helpers', () => {
  it('sums in and out', () => {
    expect(sumLines([{ amountIqd: 1000 }, { amountIqd: -250 }, { amountIqd: 500 }])).toEqual({ inIqd: 1500, outIqd: 250, netIqd: 1250 });
  });
  it('orders newest first', () => {
    const lines = [
      { id: 'a', occurredAt: new Date('2026-10-01T10:00:00Z') },
      { id: 'b', occurredAt: new Date('2026-10-03T10:00:00Z') },
      { id: 'c', occurredAt: new Date('2026-10-02T10:00:00Z') },
    ];
    expect(newestFirst(lines).map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('the statement in words (K-16)', () => {
  it('says balances as بيده / له / عليه, never with a sign', () => {
    expect(balanceWords('cash', -48_400)).toEqual({ key: 'holds', amountIqd: 48_400 });
    expect(balanceWords('cash', 2_000)).toEqual({ key: 'owed_to', amountIqd: 2_000 });
    expect(balanceWords('earnings', 5_400)).toEqual({ key: 'owed_to', amountIqd: 5_400 });
    expect(balanceWords('earnings', -300)).toEqual({ key: 'owes', amountIqd: 300 });
    expect(balanceWords('cash', 0).key).toBe('square');
  });

  it('puts cash into his hands under استلم and out of them under سلّم; marks hand-overs', () => {
    expect(lineSide('cash', -12_500)).toBe('in');
    expect(lineSide('cash', 20_000)).toBe('out');
    expect(lineSide('earnings', 750)).toBe('in');
    expect(lineSide('earnings', -180)).toBe('out');
    expect(isHandover({ type: 'driver_settlement' })).toBe(true);
    expect(isHandover({ type: 'merchant_paid_by_courier' })).toBe(true);
    expect(isHandover({ type: 'cash_collected' })).toBe(false);
  });

  it('groups newest-first lines under their Baghdad day', () => {
    const lines = [{ occurredAt: new Date('2026-10-04T19:00:00Z') }, { occurredAt: new Date('2026-10-04T20:59:00Z') }, { occurredAt: new Date('2026-10-04T21:30:00Z') }].reverse();
    expect(groupByDay(lines, dayKey).map((g) => [g.key, g.lines.length])).toEqual([
      ['2026-10-05', 1],
      ['2026-10-04', 2],
    ]);
  });

  it('turns the round reference into words and hides machine keys', () => {
    expect(memoWords('ops_round:D-118')).toBe('جولة الاستلام D-118');
    expect(memoWords('handover-demo-1')).toBeNull();
    expect(memoWords('سلّمها بيد أبو علي')).toBe('سلّمها بيد أبو علي');
    expect(memoWords(null)).toBeNull();
  });
});
