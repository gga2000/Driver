import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { OrderComplimentsService } from './compliments.js';
import { InMemoryOrderComplimentsRepository } from './compliments.repository.js';
import { ordersHarness } from './test-harness.js';

/**
 * «شنو عجبك بـ حيدر؟» (joy l4): kind words for the courier after a 4–5 rating — presets only, one set
 * per order, the orderer only, within a day of delivery; the courier is told (event) and can read them.
 */
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

async function setup() {
  const h = ordersHarness();
  const ev = createInMemoryEvents({ clock: h.clock });
  const repo = new InMemoryOrderComplimentsRepository();
  const compliments = new OrderComplimentsService(h.orders, h.trips, repo, ev.events, h.clock);
  const o = await h.orders.place('c1', h.foodInput());
  await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
  const t = await h.tripFor(o.id);
  await h.pickup(t.id);
  return {
    h,
    ev,
    compliments,
    o,
    t,
    deliver: async () => h.dropoff(t.id, { cashCollectedIqd: (await h.orders.get(o.id)).totalIqd }),
    rate: (delivery: number) => h.orders.rate('c1', { orderId: o.id, delivery, food: 5 }),
  };
}

describe('compliments — the offer', () => {
  it('shows after delivery and a 4–5 rating, with the food words', async () => {
    const s = await setup();
    expect(await s.compliments.options('c1', s.o.id)).toMatchObject({ offered: false, reason: 'not_delivered', keys: [] });
    await s.deliver();
    expect(await s.compliments.options('c1', s.o.id)).toMatchObject({ offered: false, reason: 'not_rated' });
    await s.rate(5);
    const offer = await s.compliments.options('c1', s.o.id);
    expect(offer).toMatchObject({ offered: true, reason: null, keys: ['fast', 'polite', 'hot_food', 'found_home'], sent: null });
    expect(offer.untilAt!.getTime() - (await s.h.orders.get(s.o.id)).deliveredAt!.getTime()).toBe(24 * 3_600_000);
  });

  it('not below 4 stars, not after a day, and only for the orderer', async () => {
    const low = await setup();
    await low.deliver();
    await low.rate(3);
    expect(await low.compliments.options('c1', low.o.id)).toMatchObject({ offered: false, reason: 'low_rating' });
    expect(await code(low.compliments.send('c1', { orderId: low.o.id, keys: ['fast'] }))).toBe('compliment_not_offered');

    const late = await setup();
    await late.deliver();
    await late.rate(5);
    late.h.clock.advance(24 * 3_600_000 + 60_000);
    expect(await late.compliments.options('c1', late.o.id)).toMatchObject({ offered: false, reason: 'window_closed' });
    expect(await code(late.compliments.send('c1', { orderId: late.o.id, keys: ['fast'] }))).toBe('compliment_not_offered');
    expect(await code(late.compliments.options('c2', late.o.id))).toBe('forbidden');
    expect(await code(late.compliments.send('c2', { orderId: late.o.id, keys: ['fast'] }))).toBe('forbidden');
  });
});

describe('compliments — sending', () => {
  it('stores the words once, tells the courier, and a replay returns the first set', async () => {
    const s = await setup();
    await s.deliver();
    await s.rate(5);
    const first = await s.compliments.send('c1', { orderId: s.o.id, keys: ['polite', 'hot_food', 'polite'] });
    expect(first.keys).toEqual(['polite', 'hot_food']);
    const again = await s.compliments.send('c1', { orderId: s.o.id, keys: ['fast'] });
    expect(again).toEqual(first);
    expect(await s.compliments.options('c1', s.o.id)).toMatchObject({ offered: true, sent: { keys: ['polite', 'hot_food'] } });
    const events = (await s.ev.events.forOrder(s.o.id)).filter((e) => e.type === 'order.complimented');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ customerId: 'c1', courierId: s.t.courierId, tripId: s.t.id, keys: ['polite', 'hot_food'] });
  });

  it('refuses words from another order type', async () => {
    const s = await setup();
    await s.deliver();
    await s.rate(5);
    expect(await code(s.compliments.send('c1', { orderId: s.o.id, keys: ['clean_car'] }))).toBe('compliment_invalid');
  });

  it('the courier reads them: counts, the latest with the ticket, and this shift', async () => {
    const s = await setup();
    await s.deliver();
    await s.rate(4);
    const at = s.h.clock.now();
    await s.compliments.send('c1', { orderId: s.o.id, keys: ['fast', 'polite'] });
    const view = await s.compliments.courierView(s.t.courierId!);
    expect(view.customers).toBe(1);
    expect(view.counts).toEqual([
      { key: 'fast', count: 1 },
      { key: 'polite', count: 1 },
    ]);
    expect(view.recent[0]).toMatchObject({ keys: ['fast', 'polite'], orderType: 'food' });
    expect(view.recent[0]!.ticket).toMatch(/^\d{4}$/);
    expect(await s.compliments.countsBetween(s.t.courierId!, new Date(at.getTime() - 60_000), new Date(at.getTime() + 60_000))).toHaveLength(2);
    expect(await s.compliments.countsBetween(s.t.courierId!, new Date(at.getTime() + 60_000), new Date(at.getTime() + 120_000))).toEqual([]);
    expect((await s.compliments.courierView('someone-else')).customers).toBe(0);
  });
});
