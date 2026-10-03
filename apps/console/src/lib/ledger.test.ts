import { describe, expect, it } from 'vitest';
import { capUsage, newestFirst, sumLines } from './ledger';

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
