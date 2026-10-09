import type { BoardLine, BoardOrder } from '@driver/contracts';
import type { TKey } from '@/lib/i18n-core';

type T = (key: TKey, params?: Record<string, string | number>) => string;

/**
 * The test ticket («اطبع وصل تجربة») and the screenshot order: the approved mock-up's order — two
 * people, «بدون بصل», a pistachio allergy on the كنافة, an order note, 9 dishes, 23,500 دينار cash with
 * a 2,000 delivery fee — so a shop owner's first print shows every part of the ticket and the slip.
 */
export function sampleOrder(t: T, now: Date = new Date(), patch: Partial<BoardOrder> = {}): BoardOrder {
  const line = (lineId: string, name: string, qty: number, unit: number, modifiers: string[] = [], note: string | null = null): BoardLine => ({
    lineId,
    name,
    qty,
    modifiers,
    note,
    unitPriceIqd: unit,
    totalIqd: unit * qty,
    availability: 'available',
  });
  const w = (k: string) => t(`merchant.sample.${k}` as TKey);
  return {
    id: 'test-ticket',
    number: '4821',
    column: 'preparing',
    state: 'preparing',
    type: 'food',
    placedAt: new Date(now.getTime() - 60_000),
    offeredAt: now,
    acceptBy: null,
    acceptedAt: now,
    promisedReadyAt: new Date(now.getTime() + 14 * 60_000),
    readyAt: null,
    scheduledFor: null,
    prepMinutes: 15,
    paymentMethod: 'cash',
    itemsTotalIqd: 21500,
    totalIqd: 23500,
    collectCashIqd: 23500,
    itemCount: 9,
    groups: [
      {
        key: 'orderer',
        kind: 'orderer',
        label: null,
        note: null,
        itemCount: 6,
        lines: [
          line('s1', w('tikka'), 2, 2500, [w('bread'), w('hot')], w('no_onion')),
          line('s2', w('kebab'), 1, 7000, [w('rice'), w('salad'), w('tomato')]),
          line('s3', w('pepsi'), 3, 1000),
        ],
      },
      {
        key: 'p1',
        kind: 'participant',
        label: w('person'),
        note: null,
        itemCount: 3,
        lines: [line('s4', w('soup'), 1, 1500), line('s5', w('knafeh'), 2, 2000, [], w('allergy'))],
      },
    ],
    note: w('note'),
    partial: null,
    courier: { state: 'none', firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null },
    late: false,
    catering: false,
    bill: { itemsIqd: 21500, deliveryFeeIqd: 2000, serviceFeeIqd: 0, smallOrderFeeIqd: 0, discountIqd: 0, pointsIqd: 0, changeIqd: 0, totalIqd: 23500 },
    ...patch,
  };
}

/** A café order for cup labels: نسكافيه with milk and light sugar, two lemon teas. */
export function sampleCafeOrder(t: T, now: Date = new Date()): BoardOrder {
  const w = (k: string) => t(`merchant.sample.${k}` as TKey);
  const base = sampleOrder(t, now);
  return {
    ...base,
    id: 'test-cafe',
    number: '1170',
    itemCount: 3,
    itemsTotalIqd: 4500,
    totalIqd: 5500,
    collectCashIqd: 0,
    paymentMethod: 'wallet',
    note: null,
    groups: [
      {
        key: 'orderer',
        kind: 'orderer',
        label: null,
        note: null,
        itemCount: 3,
        lines: [
          { lineId: 'c1', name: w('nescafe'), qty: 1, modifiers: [w('milk')], note: w('light_sugar'), unitPriceIqd: 2000, totalIqd: 2000, availability: 'available' },
          { lineId: 'c2', name: w('lemon_tea'), qty: 2, modifiers: [], note: null, unitPriceIqd: 1250, totalIqd: 2500, availability: 'available' },
        ],
      },
    ],
    bill: { itemsIqd: 4500, deliveryFeeIqd: 1000, serviceFeeIqd: 0, smallOrderFeeIqd: 0, discountIqd: 0, pointsIqd: 0, changeIqd: 0, totalIqd: 5500 },
  };
}
