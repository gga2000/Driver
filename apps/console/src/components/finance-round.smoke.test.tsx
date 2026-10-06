import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FinanceDeskView } from '@driver/contracts';
import { roundProgress } from '@/lib/round';
import { CourierRow, RoundProgressBar } from './finance-round';

type Round = FinanceDeskView['round'];
const at = new Date('2026-10-06T20:00:00Z'); // 23:00 Baghdad
const took = new Date('2026-10-06T19:35:00Z'); // 22:35

/**
 * K1a (S-K5): the round as the desk answers it on an evening clock, before and after «استلمت» (the
 * same numbers `cash-round.e2e.test.ts` gets from the API at 22:30): the line and the bar move, and a
 * courier taken to zero stays on his stop marked collected.
 */
const before: Round = {
  at,
  from: new Date('2026-10-06T15:00:00Z'),
  totalIqd: 70_000,
  collectedIqd: 0,
  targetIqd: 70_000,
  stops: [
    {
      seq: 1,
      zoneKey: 'zakur',
      zone_ar: 'زاكور',
      totalIqd: 70_000,
      collectedIqd: 0,
      couriers: [
        { driverId: 'saif', name: 'سيف', heldIqd: 40_000, overCap: false, collected: null },
        { driverId: 'ahmed', name: 'أحمد', heldIqd: 30_000, overCap: false, collected: null },
      ],
    },
  ],
};
const after: Round = {
  ...before,
  totalIqd: 20_000,
  collectedIqd: 50_000,
  targetIqd: 70_000,
  stops: [
    {
      ...before.stops[0]!,
      totalIqd: 20_000,
      collectedIqd: 50_000,
      couriers: [
        { driverId: 'ahmed', name: 'أحمد', heldIqd: 20_000, overCap: false, collected: { amountIqd: 10_000, at: took, reference: 'D-AAAA-0002' } },
        { driverId: 'saif', name: 'سيف', heldIqd: 0, overCap: false, collected: { amountIqd: 40_000, at: took, reference: 'D-AAAA-0001' } },
      ],
    },
  ],
};

describe('the 23:00 round line and couriers (K1a)', () => {
  it('the line and the bar move after «استلمت»', () => {
    const b = renderToString(<RoundProgressBar progress={roundProgress(before)} />);
    expect(b).toContain('جمعنا 0 من 70,000 دينار');
    expect(b).toContain('aria-valuenow="0"');
    expect(b).toContain('باقي 70,000 دينار عند 2 دليفري');
    const a = renderToString(<RoundProgressBar progress={roundProgress(after)} />);
    expect(a).toContain('جمعنا 50,000 من 70,000 دينار');
    expect(a).toContain('aria-valuenow="71"');
    expect(a).toContain('width:71%');
    expect(a).toContain('باقي 20,000 دينار عند 1 دليفري');
  });

  it('a collected courier stays on his stop, marked collected; a partial one still has «استلمت»', () => {
    const [ahmed, saif] = after.stops[0]!.couriers;
    const done = renderToString(<CourierRow c={saif!} canCollect onCollect={() => undefined} />);
    expect(done).toContain('سيف');
    expect(done).toContain('استلمت 40,000 دينار · 10:35 م');
    expect(done).not.toContain('collect-saif');
    const partial = renderToString(<CourierRow c={ahmed!} canCollect onCollect={() => undefined} />);
    expect(partial).toContain('استلمت 10,000 دينار · 10:35 م');
    expect(partial).toContain('data-testid="collect-ahmed"');
  });
});
