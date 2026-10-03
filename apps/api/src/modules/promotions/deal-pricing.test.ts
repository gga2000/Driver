import { describe, expect, it } from 'vitest';
import { dealLabel } from '@driver/contracts';
import { bestDeal, dealBadge, dealIsLive, evaluateDeal, nextDeal, type Basket } from './deal-pricing.js';
import type { DealRecord } from './promotions.repository.js';

const NOW = new Date('2026-10-03T16:00:00Z'); // Saturday 19:00 Baghdad
const DAY = 86_400_000;

function deal(over: Partial<DealRecord> & Pick<DealRecord, 'type'>): DealRecord {
  return {
    id: 'deal_1',
    cityId: 'aziziyah',
    merchantOrgId: 'm1',
    ownerId: 'o1',
    nameAr: 'عرض',
    value: 0,
    itemIds: [],
    schedule: { startsAt: new Date(NOW.getTime() - DAY), endsAt: new Date(NOW.getTime() + DAY), days: [] },
    minOrderIqd: 0,
    budgetCapIqd: null,
    spentIqd: 0,
    projection: { ordersPerWeek: 0, costPerOrderIqd: 0, weeklyCostIqd: 0, totalCostIqd: 0, basisOrders: 0 },
    proposalState: 'approved',
    active: true,
    approvedAt: NOW,
    createdAt: new Date(NOW.getTime() - DAY),
    ...over,
  };
}

// 2 × kebab 5,000 + 1 × tikka 5,000 with a 500 egg extra (line 5,500) + a free-text request (0).
const basket: Basket = {
  lines: [
    { catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000, lineIqd: 10000 },
    { catalogItemId: 'tikka', qty: 1, unitPriceIqd: 5000, lineIqd: 5500 },
    { catalogItemId: null, qty: 1, unitPriceIqd: 0, lineIqd: 0 },
  ],
  itemsTotalIqd: 15500,
  deliveryFeeIqd: 1000,
};

describe('evaluateDeal — what one deal takes off a basket', () => {
  it('percent off the whole menu: per line, modifiers included, free-text requests never covered', () => {
    expect(evaluateDeal(deal({ type: 'percent', value: 20 }), basket)).toMatchObject({ target: 'items', amountIqd: 3100, lineSavingsIqd: [2000, 1100, 0] });
  });

  it('percent and fixed on selected dishes only', () => {
    expect(evaluateDeal(deal({ type: 'percent', value: 10, itemIds: ['tikka'] }), basket)).toMatchObject({ amountIqd: 550, lineSavingsIqd: [0, 550, 0] });
    expect(evaluateDeal(deal({ type: 'fixed', value: 3000, itemIds: ['kebab', 'tikka'] }), basket)).toMatchObject({ amountIqd: 3000, lineSavingsIqd: [1935, 1065, 0] });
    // A fixed amount never exceeds what it covers.
    expect(evaluateDeal(deal({ type: 'fixed', value: 9000, itemIds: ['tikka'] }), basket)).toMatchObject({ amountIqd: 5500 });
    expect(evaluateDeal(deal({ type: 'fixed', value: 1000, itemIds: ['falafel'] }), basket)).toBeNull();
  });

  it('BOGO: every second covered unit free at its menu price (the cheaper of each pair)', () => {
    expect(evaluateDeal(deal({ type: 'bogo', itemIds: ['kebab'] }), basket)).toMatchObject({ amountIqd: 5000, lineSavingsIqd: [5000, 0, 0] });
    // Three covered units: one free; four: two free.
    const three = evaluateDeal(deal({ type: 'bogo', itemIds: ['kebab', 'tikka'] }), basket)!;
    expect(three.amountIqd).toBe(5000);
    expect(evaluateDeal(deal({ type: 'bogo', itemIds: ['tikka'] }), basket)).toBeNull();
  });

  it('free delivery takes the delivery fee; nothing when delivery is already free', () => {
    expect(evaluateDeal(deal({ type: 'free_delivery' }), basket)).toMatchObject({ target: 'delivery', amountIqd: 1000, lineSavingsIqd: [0, 0, 0] });
    expect(evaluateDeal(deal({ type: 'free_delivery' }), { ...basket, deliveryFeeIqd: 0 })).toBeNull();
  });

  it('minimum order on the items and the budget cap (a deal never pays past its cap)', () => {
    expect(evaluateDeal(deal({ type: 'free_delivery', minOrderIqd: 15000 }), basket)).not.toBeNull();
    expect(evaluateDeal(deal({ type: 'free_delivery', minOrderIqd: 16000 }), basket)).toBeNull();
    expect(evaluateDeal(deal({ type: 'percent', value: 20, budgetCapIqd: 10000, spentIqd: 6900 }), basket)?.amountIqd).toBe(3100);
    expect(evaluateDeal(deal({ type: 'percent', value: 20, budgetCapIqd: 10000, spentIqd: 6901 }), basket)).toBeNull();
  });
});

describe('dealIsLive — approval, switch, schedule window, local days and hours', () => {
  it('needs approval, the merchant switch on and the schedule window', () => {
    expect(dealIsLive(deal({ type: 'percent', value: 10 }), NOW)).toBe(true);
    expect(dealIsLive(deal({ type: 'percent', value: 10, proposalState: 'pending_approval' }), NOW)).toBe(false);
    expect(dealIsLive(deal({ type: 'percent', value: 10, active: false }), NOW)).toBe(false);
    expect(dealIsLive(deal({ type: 'percent', value: 10, schedule: { startsAt: new Date(NOW.getTime() + 1), endsAt: new Date(NOW.getTime() + DAY), days: [] } }), NOW)).toBe(false);
    expect(dealIsLive(deal({ type: 'percent', value: 10, schedule: { startsAt: new Date(NOW.getTime() - DAY), endsAt: NOW, days: [] } }), NOW)).toBe(false);
  });

  it('days and hours are Baghdad local (19:00 Saturday here)', () => {
    const s = { startsAt: new Date(NOW.getTime() - DAY), endsAt: new Date(NOW.getTime() + DAY) };
    expect(dealIsLive(deal({ type: 'percent', value: 10, schedule: { ...s, days: [6] } }), NOW)).toBe(true);
    expect(dealIsLive(deal({ type: 'percent', value: 10, schedule: { ...s, days: [5] } }), NOW)).toBe(false);
    expect(dealIsLive(deal({ type: 'percent', value: 10, schedule: { ...s, days: [], hours: { start: '18:00', end: '23:00' } } }), NOW)).toBe(true);
    expect(dealIsLive(deal({ type: 'percent', value: 10, schedule: { ...s, days: [], hours: { start: '12:00', end: '16:00' } } }), NOW)).toBe(false);
    // A window past midnight.
    expect(dealIsLive(deal({ type: 'percent', value: 10, schedule: { ...s, days: [], hours: { start: '18:30', end: '02:00' } } }), NOW)).toBe(true);
  });
});

describe('bestDeal / nextDeal / badges', () => {
  it('one deal per order: the largest saving wins, ties to the older deal; dead deals never count', () => {
    const pct = deal({ id: 'pct', type: 'percent', value: 10 }); // 1,550
    const fd = deal({ id: 'fd', type: 'free_delivery' }); // 1,000
    const big = deal({ id: 'big', type: 'fixed', value: 5000, active: false });
    expect(bestDeal([fd, pct, big], basket, NOW)?.dealId).toBe('pct');
    const twin = deal({ id: 'twin', type: 'percent', value: 10, createdAt: NOW });
    expect(bestDeal([twin, pct], basket, NOW)?.dealId).toBe('pct');
    expect(bestDeal([], basket, NOW)).toBeNull();
  });

  it('nextDeal: the smallest unmet minimum, for the cart nudge', () => {
    const d1 = deal({ id: 'a', type: 'free_delivery', minOrderIqd: 20000 });
    const d2 = deal({ id: 'b', type: 'percent', value: 10, minOrderIqd: 30000 });
    expect(nextDeal([d1, d2], basket, NOW)).toMatchObject({ deal: { id: 'a' }, missingIqd: 4500 });
  });

  it('badge labels read as the merchant app promises', () => {
    expect(dealLabel({ type: 'percent', value: 20, minOrderIqd: 0, itemIds: [] })).toBe('خصم 20% على كل المنيو');
    expect(dealLabel({ type: 'free_delivery', value: 0, minOrderIqd: 15000, itemIds: [] })).toBe('توصيل مجاني فوق 15,000 دينار');
    expect(dealLabel({ type: 'fixed', value: 2000, minOrderIqd: 10000, itemIds: ['x'] })).toBe('خصم 2,000 دينار على أصناف مختارة فوق 10,000 دينار');
    expect(dealLabel({ type: 'free_delivery', value: 0, minOrderIqd: 15000, itemIds: [] }, 'en')).toBe('Free delivery over 15,000 IQD');
    expect(dealBadge(deal({ type: 'percent', value: 20, budgetCapIqd: 5000, spentIqd: 5000 }), NOW)).toBeNull();
    expect(dealBadge(deal({ type: 'percent', value: 20 }), NOW)).toMatchObject({ label_ar: 'خصم 20% على كل المنيو', minOrderIqd: 0 });
  });
});
