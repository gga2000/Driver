import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIMER_SWEEP_GRACE_MS } from '../../shared/timers/index.js';
import { ordersHarness } from './test-harness.js';

/**
 * FLW-22 / OPS2-16: order and trip timers have a durable copy written with the order, the Redis job
 * is queued after commit (best effort), and the timer sweeper fires a copy whose job was lost.
 */
const MIN = 60_000;
const GRACE = TIMER_SWEEP_GRACE_MS;

describe('order timers survive Redis', () => {
  afterEach(() => vi.restoreAllMocks());

  it('placing writes the auto-reject copy with the order; its job runs and marks it fired', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    expect(h.timerStore.rows.map((r) => ({ queue: r.queue, name: r.name, status: r.status }))).toEqual([{ queue: 'orders.timers', name: 'merchant.autoReject', status: 'pending' }]);
    await h.advance(90_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
    expect(h.timerStore.rows[0]!.status).toBe('fired');
  });

  it('a lost auto-reject job still fires: the sweeper rejects the order once the grace is over', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.queue.close(); // Redis lost the job (restart, flush, a dropped job)
    await h.advance(90_000);
    expect((await h.orders.get(o.id)).state).toBe('placed');
    await h.advance(GRACE);
    expect((await h.sweeper.sweep()).fired).toBe(1);
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ auto: true, reason: 'merchant_timeout' });
  });

  it('places the order while Redis is down (every enqueue fails); the sweeper runs the timer later', async () => {
    const h = ordersHarness();
    vi.spyOn(h.queue, 'add').mockRejectedValue(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
    const o = await h.orders.place('c1', h.foodInput());
    expect(o.state).toBe('placed');
    expect(h.events.types(o.id)).toEqual(['order.placed', 'order.offered_to_merchant']);
    expect(h.queue.size).toBe(0);
    await h.advance(90_000 + GRACE);
    await h.sweeper.sweep();
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
  });

  it('a failing timer run is retried by the sweeper (not lost after one try)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.queue.close();
    const real = h.repo.find.bind(h.repo);
    let fail = true;
    vi.spyOn(h.repo, 'find').mockImplementation(async (...args) => {
      if (fail) {
        fail = false;
        throw new Error('canceling statement due to statement timeout');
      }
      return real(...args);
    });
    await h.advance(90_000 + GRACE);
    expect(await h.sweeper.sweep()).toMatchObject({ fired: 0, retried: 1 });
    await h.advance(5_000);
    expect(await h.sweeper.sweep()).toMatchObject({ fired: 1 });
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
  });

  it('a timer that runs twice (BullMQ and the sweeper) changes nothing the second time', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 10 });
    const t = await h.tripFor(o.id);
    // The jobs run without finding their copies, which stay pending, so the sweeper runs every one of them again.
    vi.spyOn(h.timerStore, 'take').mockResolvedValue('missing');
    await h.advance(20 * MIN);
    await h.advance(5 * MIN);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(1);
    expect(h.events.ofType('order.courier_released')).toHaveLength(1);
    await h.advance(GRACE);
    expect((await h.sweeper.sweep()).fired).toBeGreaterThanOrEqual(2);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(1);
    expect(h.events.ofType('order.courier_released')).toHaveLength(1);
    expect((await h.trips.get(t.id)).orders[0]!.reason).toBe('merchant_unresponsive');
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
  });

  it('a second auto-reject run finds the order already rejected and does nothing', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    vi.spyOn(h.timerStore, 'take').mockResolvedValue('missing');
    await h.advance(90_000);
    const rejected = h.events.ofType('order.rejected').length;
    await h.advance(GRACE);
    expect((await h.sweeper.sweep()).fired).toBe(1);
    expect(h.events.ofType('order.rejected')).toHaveLength(rejected);
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
  });
});

describe('trip timers survive Redis', () => {
  afterEach(() => vi.restoreAllMocks());

  async function atDoor() {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 10 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const dropoff = t.stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, dropoff.id, 'd1', { pin: dropoff.target! });
    return { h, t, dropoff };
  }

  it('the unreachable protocol still escalates and allows "فشل" when its jobs were lost', async () => {
    const { h, t, dropoff } = await atDoor();
    await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    await h.tripsQueue.close();
    await h.advance(5 * MIN + GRACE);
    expect(h.tripEvents.ofType('trip.unreachable_escalated')).toHaveLength(0);
    await h.sweeper.sweep();
    expect(h.tripEvents.ofType('trip.unreachable_escalated')).toHaveLength(1);
    expect(h.tripEvents.ofType('trip.unreachable_fail_allowed')).toHaveLength(1);
  });

  it('a double run of the unreachable timers announces each step once', async () => {
    const { h, t, dropoff } = await atDoor();
    await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    vi.spyOn(h.timerStore, 'take').mockResolvedValue('missing');
    await h.advance(5 * MIN);
    expect(h.tripEvents.ofType('trip.unreachable_escalated')).toHaveLength(1);
    expect(h.tripEvents.ofType('trip.unreachable_fail_allowed')).toHaveLength(1);
    await h.advance(GRACE);
    expect((await h.sweeper.sweep()).fired).toBeGreaterThanOrEqual(2);
    expect(h.tripEvents.ofType('trip.unreachable_escalated')).toHaveLength(1);
    expect(h.tripEvents.ofType('trip.unreachable_fail_allowed')).toHaveLength(1);
  });
});
