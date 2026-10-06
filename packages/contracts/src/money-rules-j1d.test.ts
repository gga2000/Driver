import { describe, expect, it } from 'vitest';
import { dealLinePrice, menuDealOf, percentDealSaving, type DealBadge } from './deals.js';
import { AZIZIYAH_MONEY_RULES } from './ledger-rules.js';
import { POINT_VALUE_IQD, pointsRedemption, redeemablePoints } from './points-redemption.js';
import { SMALL_ORDER_FEE_IQD, smallOrderFeeIqd } from './small-order.js';

describe('small-order fee (J-D6)', () => {
  it('below the restaurant minimum the order carries the fixed fee', () => {
    expect(SMALL_ORDER_FEE_IQD).toBe(AZIZIYAH_MONEY_RULES.smallOrder.feeIqd);
    expect(SMALL_ORDER_FEE_IQD).toBe(500);
    expect(smallOrderFeeIqd(3_000, 5_000)).toBe(500);
    expect(smallOrderFeeIqd(4_999, 5_000)).toBe(500);
  });

  it('at or above the minimum, without a minimum or with an empty basket: no fee', () => {
    expect(smallOrderFeeIqd(5_000, 5_000)).toBe(0);
    expect(smallOrderFeeIqd(12_000, 5_000)).toBe(0);
    expect(smallOrderFeeIqd(3_000, 0)).toBe(0);
    expect(smallOrderFeeIqd(0, 5_000)).toBe(0);
  });

  it('the amount is the city money rule, not a literal', () => {
    expect(smallOrderFeeIqd(1_000, 5_000, { smallOrder: { belowIqd: 0, feeIqd: 750 } })).toBe(750);
  });
});

describe('points redemption (J-D10: delivery first, then the service fee)', () => {
  const fees = { serviceFeeIqd: 500, deliveryFeeIqd: 1_000 };

  it('100 points are worth 1,000 دينار', () => {
    expect(POINT_VALUE_IQD).toBe(10);
  });

  it('comes off the delivery fee first', () => {
    expect(pointsRedemption(60, fees)).toEqual({ points: 60, againstDelivery: 600, againstService: 0, valueIqd: 600 });
    expect(pointsRedemption(100, fees)).toEqual({ points: 100, againstDelivery: 1_000, againstService: 0, valueIqd: 1_000 });
  });

  it('then the service fee, and never more than both fees', () => {
    expect(pointsRedemption(120, fees)).toEqual({ points: 120, againstDelivery: 1_000, againstService: 200, valueIqd: 1_200 });
    expect(pointsRedemption(1_000, fees)).toEqual({ points: 150, againstDelivery: 1_000, againstService: 500, valueIqd: 1_500 });
  });

  it('with free delivery only the service fee is left', () => {
    expect(pointsRedemption(80, { serviceFeeIqd: 500, deliveryFeeIqd: 0 })).toEqual({ points: 50, againstDelivery: 0, againstService: 500, valueIqd: 500 });
  });

  it('no points, negative or fractional input: nothing', () => {
    expect(pointsRedemption(0, fees).valueIqd).toBe(0);
    expect(pointsRedemption(-5, fees).points).toBe(0);
    expect(pointsRedemption(10.7, fees).points).toBe(10);
  });

  it('redeemable: the balance, capped by the fees and by what is left of the price', () => {
    expect(redeemablePoints({ availablePoints: 400, ...fees, priceIqd: 16_500 })).toBe(150);
    expect(redeemablePoints({ availablePoints: 40, ...fees, priceIqd: 16_500 })).toBe(40);
    expect(redeemablePoints({ availablePoints: 400, ...fees, priceIqd: 905 })).toBe(90);
    expect(redeemablePoints({ availablePoints: 0, ...fees, priceIqd: 16_500 })).toBe(0);
    expect(redeemablePoints({ availablePoints: -3, ...fees, priceIqd: 16_500 })).toBe(0);
  });
});

describe('deal price on the menu (f10)', () => {
  const pct: Pick<DealBadge, 'dealId' | 'type' | 'value' | 'minOrderIqd' | 'itemIds'> = { dealId: 'd1', type: 'percent', value: 20, minOrderIqd: 0, itemIds: [] };

  it('percent saving is the deal engine rule (floor)', () => {
    expect(percentDealSaving(2_500, 20)).toBe(500);
    expect(percentDealSaving(2_750, 15)).toBe(412);
    expect(percentDealSaving(0, 20)).toBe(0);
  });

  it('a percent deal with no minimum that covers the dish gives its deal price', () => {
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [pct])).toEqual({ dealId: 'd1', percent: 20, priceIqd: 2_000 });
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, itemIds: ['wrap'] }])).toEqual({ dealId: 'd1', percent: 20, priceIqd: 2_000 });
  });

  it('not on the dish: a deal with a minimum, other dishes, other deal types, a free dish', () => {
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, minOrderIqd: 10_000 }])).toBeNull();
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, itemIds: ['tikka'] }])).toBeNull();
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, type: 'free_delivery', value: 0 }])).toBeNull();
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [{ ...pct, type: 'fixed', value: 1_000 }])).toBeNull();
    expect(menuDealOf({ id: 'wrap', priceIqd: 0 }, [pct])).toBeNull();
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [])).toBeNull();
  });

  it('the largest percent wins; the first one on a tie', () => {
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [pct, { ...pct, dealId: 'd2', value: 25 }])?.dealId).toBe('d2');
    expect(menuDealOf({ id: 'wrap', priceIqd: 2_500 }, [pct, { ...pct, dealId: 'd2' }])?.dealId).toBe('d1');
  });

  it('the sheet line price under the deal', () => {
    expect(dealLinePrice(5_000, { percent: 20 })).toBe(4_000);
    expect(dealLinePrice(5_500, { percent: 15 })).toBe(4_675);
    expect(dealLinePrice(5_000, null)).toBe(5_000);
    expect(dealLinePrice(5_000, undefined)).toBe(5_000);
  });
});
