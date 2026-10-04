import { describe, expect, it } from 'vitest';
import type { LiveBusEvent } from '@driver/contracts';
import { fanout, type FanoutInput, type FanoutLookups } from './live.fanout.js';

const look: FanoutLookups = {
  order: async (id) =>
    id === 'o_gone' ? null : { cityId: 'aziziyah', merchantOrgId: id === 'o_ride' ? null : 'm1' },
  courierOf: async (id) => (id === 'o1' ? 'courier_a' : null),
  trip: async (id) =>
    id === 't1' ? { cityId: 'aziziyah', courierId: 'courier_a', orderIds: ['o1', 'o2'] } : null,
};

const ev = (over: Partial<FanoutInput> & Pick<FanoutInput, 'type'>): FanoutInput => ({
  aggregate: 'order',
  aggregateId: 'o1',
  payload: {},
  ...over,
});
const on = (pubs: Array<{ channel: string; event: LiveBusEvent }>, channel: string) =>
  pubs.filter((p) => p.channel === channel).map((p) => p.event);

describe('live fan-out: outbox event → compact events per channel', () => {
  it('order moved: state patch + track invalidation to the customer, board to the kitchen, job to the courier, board to the city', async () => {
    const pubs = await fanout(
      ev({ type: 'order.ready', orderId: 'o1', payload: { from: 'preparing', to: 'ready' } }),
      look,
    );
    expect(on(pubs, 'order:o1')).toEqual([
      { type: 'order_state', orderId: 'o1', state: 'ready', cause: 'order.ready' },
      {
        type: 'invalidate',
        keys: ['orders.track', 'orders.mine'],
        cause: 'order.ready',
        orderId: 'o1',
      },
    ]);
    expect(on(pubs, 'merchant:m1')).toEqual([
      { type: 'invalidate', keys: ['merchant.board'], cause: 'order.ready', orderId: 'o1' },
    ]);
    expect(on(pubs, 'driver:courier_a')).toEqual([
      { type: 'invalidate', keys: ['partner.activeJob'], cause: 'order.ready', orderId: 'o1' },
    ]);
    expect(on(pubs, 'city:aziziyah')).toEqual([
      {
        type: 'invalidate',
        keys: ['orders.listActive', 'console.rightNow'],
        cause: 'order.ready',
        orderId: 'o1',
      },
    ]);
  });

  it('a new order for the kitchen rings (new_order) before the board re-read; auto-accept kitchens do not ring', async () => {
    const pubs = await fanout(
      ev({
        type: 'order.offered_to_merchant',
        orderId: 'o2',
        aggregateId: 'o2',
        payload: { merchantOrgId: 'm1', autoAccept: false },
      }),
      look,
    );
    expect(on(pubs, 'merchant:m1')).toEqual([
      { type: 'new_order', orderId: 'o2', merchantOrgId: 'm1' },
      {
        type: 'invalidate',
        keys: ['merchant.board'],
        cause: 'order.offered_to_merchant',
        orderId: 'o2',
      },
    ]);
    const auto = await fanout(
      ev({
        type: 'order.offered_to_merchant',
        orderId: 'o2',
        aggregateId: 'o2',
        payload: { autoAccept: true },
      }),
      look,
    );
    expect(on(auto, 'merchant:m1').some((e) => e.type === 'new_order')).toBe(false);
  });

  it('trip moved: every order on it (customers and kitchens), the courier (job + cash), the city; no order_state from a trip state', async () => {
    const pubs = await fanout(
      {
        type: 'stop.completed',
        aggregate: 'trip',
        aggregateId: 't1',
        tripId: 't1',
        orderId: 'o1',
        payload: { to: 'completed' },
      },
      look,
    );
    expect(on(pubs, 'driver:courier_a')).toEqual([
      {
        type: 'invalidate',
        keys: ['partner.activeJob', 'partner.status'],
        cause: 'stop.completed',
        tripId: 't1',
      },
    ]);
    for (const o of ['o1', 'o2'])
      expect(on(pubs, `order:${o}`)).toEqual([
        expect.objectContaining({
          type: 'invalidate',
          keys: expect.arrayContaining(['orders.track', 'orders.courierPosition']),
        }),
      ]);
    expect(pubs.some((p) => p.event.type === 'order_state')).toBe(false);
    expect(on(pubs, 'merchant:m1')).toHaveLength(1);
    expect(on(pubs, 'city:aziziyah')[0]).toMatchObject({
      keys: expect.arrayContaining(['trips.board', 'dispatch.board', 'orders.listActive']),
    });
  });

  it('dispatch: the offered driver hears his offer; the city board updates', async () => {
    const pubs = await fanout(
      {
        type: 'dispatch.offer_sent',
        aggregate: 'trip',
        aggregateId: 't9',
        tripId: 't9',
        payload: { cityId: 'aziziyah', driverId: 'courier_b' },
      },
      look,
    );
    expect(on(pubs, 'driver:courier_b')).toEqual([
      {
        type: 'invalidate',
        keys: ['partner.currentOffer', 'partner.activeJob'],
        cause: 'dispatch.offer_sent',
        tripId: 't9',
      },
    ]);
    expect(on(pubs, 'city:aziziyah')[0]).toMatchObject({
      keys: expect.arrayContaining(['dispatch.board']),
    });
    expect(on(pubs, 'driver:courier_a')).toEqual([]);
  });

  it('chat: the thread gets the message, badges update for the order and every recipient; kitchen threads reach the store', async () => {
    const payload = {
      threadId: 'th1',
      orderId: 'o1',
      kind: 'customer_merchant',
      seq: 4,
      recipientIds: ['staff_1'],
    };
    const pubs = await fanout(
      {
        type: 'chat.message_sent',
        aggregate: 'chat_thread',
        aggregateId: 'th1',
        orderId: 'o1',
        payload,
      },
      look,
    );
    expect(on(pubs, 'chat:o1:customer_merchant')).toEqual([
      { type: 'chat', orderId: 'o1', kind: 'customer_merchant', threadId: 'th1', seq: 4 },
    ]);
    expect(on(pubs, 'order:o1')[0]).toMatchObject({ keys: ['chat.threads'] });
    expect(on(pubs, 'driver:staff_1')[0]).toMatchObject({ keys: ['chat.threads'] });
    expect(on(pubs, 'merchant:m1')[0]).toMatchObject({ keys: ['chat.threads'] });
  });

  it('store status and a person’s own state', async () => {
    const store = await fanout(
      { type: 'merchant.busy_on', aggregate: 'merchant', aggregateId: 'm7', payload: {} },
      look,
    );
    expect(on(store, 'merchant:m7')[0]).toMatchObject({
      keys: ['merchant.storeStatus', 'merchant.board'],
    });
    const person = await fanout(
      { type: 'role.revoked', aggregate: 'person', aggregateId: 'courier_a', payload: {} },
      look,
    );
    expect(on(person, 'driver:courier_a')[0]).toMatchObject({ keys: ['partner.status'] });
  });

  it('unknown orders and trips publish nothing for them', async () => {
    expect(
      await fanout(
        ev({
          type: 'order.cancelled',
          orderId: 'o_gone',
          aggregateId: 'o_gone',
          payload: { to: 'customer_cancelled' },
        }),
        look,
      ),
    ).toEqual([]);
  });
});
