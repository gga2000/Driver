import { describe, expect, it } from 'vitest';
import type { OrderHistoryRow } from '@driver/contracts';
import { canOrderAgain, drawsAsFood, receiptStamp, rowDish, rowOpens, rowWord } from './orders-v2';

type Row = Parameters<typeof canOrderAgain>[0] & Pick<OrderHistoryRow, 'items'>;
const row = (o: Partial<OrderHistoryRow['order']>, items: OrderHistoryRow['items'] = []): Row =>
  ({ order: { id: 'o1', type: 'food', state: 'delivered', merchantOrgId: 'm1', ordererId: 'p1', ...o }, items }) as unknown as Row;

describe('drawsAsFood (rides keep their own rows)', () => {
  it('draws kitchen orders only', () => {
    expect(drawsAsFood(row({ type: 'food' }))).toBe(true);
    expect(drawsAsFood(row({ type: 'grocery_catalog' }))).toBe(true);
    expect(drawsAsFood(row({ type: 'ride' }))).toBe(false);
    expect(drawsAsFood(row({ type: 'seat' }))).toBe(false);
    expect(drawsAsFood(row({ type: 'parcel' }))).toBe(false);
  });
});

describe('rowDish (o1)', () => {
  it('pictures the first dish, as the live screen does', () => {
    expect(rowDish(row({}, [{ lineId: 'l1', catalogItemId: 'i1', name: 'كباب', qty: 2 }, { lineId: 'l2', catalogItemId: 'i2', name: 'لبن', qty: 1 }]))).toEqual({ id: 'l1', name: 'كباب' });
  });

  it('falls back to the order when it has no dishes', () => {
    expect(rowDish(row({ id: 'o9' }))).toEqual({ id: 'o9', name: '' });
  });
});

describe('canOrderAgain (o3)', () => {
  it('offers it on a delivered kitchen order he placed', () => {
    expect(canOrderAgain(row({}), 'p1')).toBe(true);
    expect(canOrderAgain(row({ state: 'closed' }), 'p1')).toBe(true);
  });

  it('not on one someone else placed, one still cooking, or one that never came', () => {
    expect(canOrderAgain(row({ ordererId: 'p2' }), 'p1')).toBe(false);
    expect(canOrderAgain(row({ state: 'preparing' }), 'p1')).toBe(false);
    expect(canOrderAgain(row({ state: 'customer_cancelled' }), 'p1')).toBe(false);
    expect(canOrderAgain(row({ state: 'merchant_rejected' }), 'p1')).toBe(false);
  });
});

describe('rowWord, rowOpens and receiptStamp (o1, o7)', () => {
  it('says nothing on an order that arrived, and opens its receipt', () => {
    expect(rowWord({ type: 'food', state: 'delivered' })).toBeNull();
    expect(rowWord({ type: 'food', state: 'closed' })).toBeNull();
    expect(rowOpens({ state: 'delivered' })).toBe('receipt');
    expect(receiptStamp({ type: 'food', state: 'delivered' })).toBeNull();
  });

  it('names what happened when it did not arrive', () => {
    expect(rowWord({ type: 'food', state: 'customer_cancelled' })).toBe('cancelled');
    expect(receiptStamp({ type: 'food', state: 'merchant_rejected' })).toBe('rejected');
    expect(receiptStamp({ type: 'food', state: 'refunded' })).toBe('refunded');
    expect(receiptStamp({ type: 'food', state: 'disputed' })).toBe('disputed');
    expect(receiptStamp({ type: 'food', state: 'failed' })).toBe('failed');
  });

  it('opens a running order on its live screen', () => {
    expect(rowOpens({ state: 'preparing' })).toBe('live');
    expect(rowWord({ type: 'food', state: 'picked_up' })).toBe('on_the_way');
  });
});
