import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { InMemoryPromotionsRepository } from './promotions.repository.js';
import { projectDeal, PromotionsService, type OrderSample } from './promotions.service.js';

const NOW = new Date('2026-10-03T12:00:00Z'); // Saturday 15:00 Baghdad
const DAY = 86_400_000;

function sample(daysAgo: number, over: Partial<OrderSample> = {}): OrderSample {
  return {
    placedAt: new Date(NOW.getTime() - daysAgo * DAY),
    state: 'closed',
    itemsTotalIqd: 10000,
    deliveryFeeIqd: 1000,
    lines: [
      { catalogItemId: 'wrap', qty: 2, unitPriceIqd: 3000 },
      { catalogItemId: 'cola', qty: 1, unitPriceIqd: 4000 },
    ],
    ...over,
  };
}

const twoWeeks = { startsAt: NOW, endsAt: new Date(NOW.getTime() + 14 * DAY), days: [] as number[] };

describe('projectDeal', () => {
  const orders = [1, 2, 3, 4, 8, 15, 22, 27].map((d) => sample(d)).concat([sample(5, { state: 'merchant_rejected' }), sample(40)]);

  it('counts only the last 28 days of taken orders, per week, over the deal weeks', () => {
    const p = projectDeal(orders, { type: 'free_delivery', value: 0, itemIds: [], schedule: twoWeeks, minOrderIqd: 0 }, NOW);
    expect(p).toEqual({ ordersPerWeek: 2, costPerOrderIqd: 1000, weeklyCostIqd: 2000, totalCostIqd: 4000, basisOrders: 8 });
  });

  it('percent on covered items, fixed capped at the covered value, bogo = cheapest covered unit', () => {
    expect(projectDeal(orders, { type: 'percent', value: 10, itemIds: ['wrap'], schedule: twoWeeks, minOrderIqd: 0 }, NOW).costPerOrderIqd).toBe(600);
    expect(projectDeal(orders, { type: 'fixed', value: 5000, itemIds: ['cola'], schedule: twoWeeks, minOrderIqd: 0 }, NOW).costPerOrderIqd).toBe(4000);
    expect(projectDeal(orders, { type: 'bogo', value: 0, itemIds: ['wrap'], schedule: twoWeeks, minOrderIqd: 0 }, NOW).costPerOrderIqd).toBe(3000);
  });

  it('applies schedule days, hours, minimum order and the budget cap', () => {
    const sameDow = projectDeal(orders, { type: 'free_delivery', value: 0, itemIds: [], schedule: { ...twoWeeks, days: [6] }, minOrderIqd: 0 }, NOW);
    expect(sameDow.basisOrders).toBe(8);
    expect(sameDow.ordersPerWeek).toBe(0); // none of the samples fell on a Saturday
    const evening = projectDeal(orders, { type: 'free_delivery', value: 0, itemIds: [], schedule: { ...twoWeeks, hours: { start: '18:00', end: '23:00' } }, minOrderIqd: 0 }, NOW);
    expect(evening.ordersPerWeek).toBe(0); // samples are at 15:00 Baghdad
    expect(projectDeal(orders, { type: 'free_delivery', value: 0, itemIds: [], schedule: twoWeeks, minOrderIqd: 20000 }, NOW).ordersPerWeek).toBe(0);
    expect(projectDeal(orders, { type: 'free_delivery', value: 0, itemIds: [], schedule: twoWeeks, minOrderIqd: 0, budgetCapIqd: 2500 }, NOW).totalCostIqd).toBe(2500);
  });
});

describe('PromotionsService.validate / propose', () => {
  const rules = { maxPercent: 50, maxDays: 60 };
  function svc() {
    const clock = new FakeClock(NOW);
    const ev = createInMemoryEvents({ clock });
    return new PromotionsService(new InMemoryPromotionsRepository(), ev.events, ev.uow, clock);
  }

  it('refuses bad values and schedules', () => {
    const s = svc();
    const ok = { type: 'percent' as const, value: 20, itemIds: [], schedule: twoWeeks, minOrderIqd: 0 };
    expect(() => s.validate(ok, rules)).not.toThrow();
    for (const bad of [
      { ...ok, value: 0 },
      { ...ok, value: 60 },
      { ...ok, type: 'fixed' as const, value: 1100 },
      { ...ok, type: 'bogo' as const },
      { ...ok, schedule: { ...twoWeeks, endsAt: NOW } },
      { ...ok, schedule: { ...twoWeeks, endsAt: new Date(NOW.getTime() + 90 * DAY) } },
    ]) {
      expect(() => s.validate(bad, rules)).toThrow(expect.objectContaining({ code: 'deal_invalid' }));
    }
  });

  it('self-serve when the city switch is off: approved and running at once', async () => {
    const s = svc();
    const projection = { ordersPerWeek: 0, costPerOrderIqd: 0, weeklyCostIqd: 0, totalCostIqd: 0, basisOrders: 0 };
    const d = await s.propose({ type: 'free_delivery', value: 0, itemIds: [], schedule: twoWeeks, minOrderIqd: 0, cityId: 'aziziyah', merchantOrgId: 'm1', ownerId: 'p1', nameAr: 'توصيل مجاني', projection, requireApproval: false });
    expect(d).toMatchObject({ state: 'approved', active: true, value: 0 });
    await expect(s.setActive('m2', d.dealId, false, 'p1')).rejects.toMatchObject({ code: 'deal_not_found' });
  });
});
