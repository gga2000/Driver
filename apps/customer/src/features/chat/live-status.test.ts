import { describe, expect, it } from 'vitest';
import type { Order, OrderTracking } from '@driver/contracts';
import { chatLive, orderQuickReplies } from './live-status';

const KITCHEN = { lat: 32.9095, lng: 45.0635 };
const HOME = { lat: 32.887, lng: 45.0765 };
const T0 = new Date('2026-10-03T09:00:00Z');

function view(o: Partial<Order>, trip: Partial<NonNullable<OrderTracking['trip']>> | null): OrderTracking {
  return {
    order: { id: 'ord_1', type: 'food', state: 'picked_up', placedAt: T0, pickedUpAt: T0, deliveredAt: null, ...o } as Order,
    items: [],
    merchant: { id: 'rest_1', name: 'مطعم خالد', pin: KITCHEN },
    dropoff: { zoneKey: 'zakur', pin: HOME },
    trip: trip
      ? ({
          id: 'trp_1',
          state: 'in_transit',
          acceptedAt: T0,
          completedAt: null,
          stops: [
            { id: 's1', seq: 0, type: 'pickup', state: 'completed', mine: true, target: KITCHEN, courierNearAt: null, arrivedAt: null, completedAt: T0 },
            { id: 's2', seq: 1, type: 'dropoff', state: 'pending', mine: true, target: HOME, courierNearAt: null, arrivedAt: null, completedAt: null },
          ],
          dropsBeforeMine: 0,
          unreachable: null,
          ...trip,
        } as NonNullable<OrderTracking['trip']>)
      : null,
    courier: null,
    reassigning: false,
    promisedAt: null,
    pointsEarned: null,
    serverNow: T0,
  };
}

describe('chatLive (joy l7)', () => {
  it('says how many minutes while the order is on its way', () => {
    const live = chatLive(view({}, {}), { lat: 32.895, lng: 45.07 }, T0);
    expect(live?.kind).toBe('on_the_way');
    expect(live && live.kind === 'on_the_way' ? live.minutes : 0).toBeGreaterThanOrEqual(1);
  });
  it('says «عند بابك» once he pressed وصلت at my door', () => {
    expect(chatLive(view({}, { state: 'arrived_dropoff' }), null, T0)).toEqual({ kind: 'at_door' });
  });
  it('says nothing before he leaves the kitchen or after delivery', () => {
    expect(chatLive(view({ state: 'preparing', pickedUpAt: null }, { state: 'accepted' }), null, T0)).toBeNull();
    expect(chatLive(view({ state: 'delivered', deliveredAt: T0 }, { state: 'completed' }), null, T0)).toBeNull();
    expect(chatLive(null, null, T0)).toBeNull();
  });
});

describe('orderQuickReplies', () => {
  const keys = ['customer_wait_minute', 'customer_other_gate', 'customer_coming_out', 'customer_ring_bell'] as const;
  it('at the door, «طالع هسة» first', () => {
    expect(orderQuickReplies(keys, { kind: 'at_door' })[0]).toBe('customer_coming_out');
  });
  it('on the way, «تعال للباب الثاني» first', () => {
    expect(orderQuickReplies(keys, { kind: 'on_the_way', minutes: 4 })[0]).toBe('customer_other_gate');
  });
  it('keeps the server list as is otherwise, never adding a key', () => {
    expect(orderQuickReplies(keys, null)).toEqual([...keys]);
    expect(orderQuickReplies(['customer_how_long'], { kind: 'at_door' })).toEqual(['customer_how_long']);
  });
});
