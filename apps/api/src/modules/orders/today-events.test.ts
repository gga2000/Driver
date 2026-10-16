import { describe, expect, it } from 'vitest';
import { decodeDomainEvent, type Actor } from '@driver/contracts';
import { ledgerHarness } from '../ledger/test-harness.js';
import { OrdersStaffJob } from './orders.staff.job.js';
import { STUCK_BOARD } from './orders.staff.js';
import { staffHarness } from './staff-harness.js';

const MIN = 60_000;
const ops: Actor = { personId: 'ops_1', roles: ['dispatcher'] } as unknown as Actor;
const make = () => staffHarness({}, { ledger: ledgerHarness() });

describe('order.rated (Console "Today" list)', () => {
  it('the first scored rating emits it once, with the delivery score as stars', async () => {
    const h = make();
    const { order } = await h.delivered();
    await h.orders.rate('c1', { orderId: order.id, delivery: 4, food: 2 });
    await h.orders.rate('c1', { orderId: order.id, delivery: 1 });
    const rated = h.events.ofType('order.rated');
    expect(rated).toHaveLength(1);
    expect(decodeDomainEvent('order.rated', rated[0]!.payload)).toEqual({ orderId: order.id, stars: 4, cityId: 'aziziyah', food: 2, delivery: 4, orderType: 'food' });
    expect(rated[0]!).toMatchObject({ actorId: 'c1', orderId: order.id, aggregate: { name: 'order', id: order.id } });
  });

  it('food-only rating: stars is the food score; a tap with no scores emits nothing', async () => {
    const h = make();
    const a = (await h.delivered()).order;
    await h.orders.rate('c1', { orderId: a.id, food: 5 });
    expect(decodeDomainEvent('order.rated', h.events.last('order.rated')!.payload)).toEqual({ orderId: a.id, stars: 5, cityId: 'aziziyah', food: 5, orderType: 'food' });
    // A row written before these fields still reads.
    expect(decodeDomainEvent('order.rated', { orderId: a.id, stars: 5, cityId: 'aziziyah' })).toEqual({ orderId: a.id, stars: 5, cityId: 'aziziyah' });
    const b = (await h.delivered()).order;
    await h.orders.rate('c1', { orderId: b.id });
    expect(h.events.ofType('order.rated').map((e) => e.orderId)).toEqual([a.id]);
  });

  it("a refused rating (someone else's order) emits nothing", async () => {
    const h = make();
    const { order } = await h.delivered();
    await expect(h.orders.rate('c2', { orderId: order.id, delivery: 5 })).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.events.ofType('order.rated')).toHaveLength(0);
  });
});

describe('order.stuck / order.unstuck (the stuck list, seen by the W3 watchdog)', () => {
  it('enters once when the kitchen does not answer, leaves once when staff cancel it, by that staff member', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    h.clock.advance(2 * MIN);
    expect(await h.staff.watchStuck()).toBe(0);
    h.clock.advance(4 * MIN);
    expect(await h.staff.watchStuck()).toBe(1);
    expect(await h.staff.watchStuck()).toBe(0);
    const stuck = h.events.ofType('order.stuck');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.aggregate).toEqual(STUCK_BOARD);
    const placed = (await h.repo.find(o.id))!.order;
    expect(decodeDomainEvent('order.stuck', stuck[0]!.payload)).toEqual({ orderId: o.id, cityId: 'aziziyah', reason: 'merchant_no_answer', since: placed.merchantOfferedAt ?? placed.placedAt });

    await h.staff.cancel(ops, { orderId: o.id, reason: 'المطعم ما يرد', onBehalfOfCustomer: false });
    expect(await h.staff.watchStuck()).toBe(1);
    expect(await h.staff.watchStuck()).toBe(0);
    const unstuck = h.events.ofType('order.unstuck');
    expect(unstuck).toHaveLength(1);
    expect(decodeDomainEvent('order.unstuck', unstuck[0]!.payload)).toEqual({ orderId: o.id, cityId: 'aziziyah', by: 'ops_1' });
  });

  it('leaves when the kitchen finally answers (by the merchant)', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    h.clock.advance(6 * MIN);
    expect(await h.staff.watchStuck()).toBe(1);
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    expect(await h.staff.watchStuck()).toBe(1);
    expect(h.events.last('order.unstuck')!.payload).toMatchObject({ orderId: o.id, by: 'm1' });
    expect(await h.staff.watchStuck()).toBe(0);
  });

  it('only for the city asked; the job runs it with the money sweep', async () => {
    const h = make();
    await h.orders.place('c1', h.foodInput());
    h.clock.advance(6 * MIN);
    expect(await h.staff.watchStuck('baghdad')).toBe(0);
    expect(await new OrdersStaffJob(h.staff).tick()).toBe(1);
    expect(h.events.ofType('order.stuck')).toHaveLength(1);
  });
});
