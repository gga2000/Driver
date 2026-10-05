import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { DuplicateClientRequest, InMemoryOrdersRepository } from './orders.repository.js';
import { ordersHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const KEY = 'chk_k8Hq2mZx01';

describe('orders.place — no duplicate orders (clientRequestId)', () => {
  it('a retry with the same key answers with the order already placed: same view, nothing twice', async () => {
    const h = ordersHarness();
    const first = await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    const again = await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    expect(again).toEqual(first);
    expect(first.clientRequestId).toBe(KEY);
    expect(h.repo.orders.size).toBe(1);
    // One placed event, one offer to the kitchen, one acceptance timer.
    expect(h.events.types(first.id)).toEqual(['order.placed', 'order.offered_to_merchant']);
  });

  it('two simultaneous calls with one key place one order and both get it', async () => {
    const h = ordersHarness();
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => h.orders.place('c1', h.foodInput({ clientRequestId: KEY }))));
    expect(h.repo.orders.size).toBe(1);
    expect(b!.id).toBe(a!.id);
    expect(c!.id).toBe(a!.id);
    expect(h.events.ofType('order.placed')).toHaveLength(1);
  });

  it('another instance winning the race (the unique index refuses the insert) still answers with its order', async () => {
    const h = ordersHarness();
    const winner = await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    // This instance looked before the other one committed: every pre-check reads nothing.
    const real = h.repo.findByClientRequest.bind(h.repo);
    let blind = 3;
    h.repo.findByClientRequest = async (...args) => (blind-- > 0 ? null : real(...args));
    const loser = await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    expect(blind).toBeLessThan(0);
    expect(loser).toEqual(winner);
    expect(h.repo.orders.size).toBe(1);
  });

  it('a merchant deal is reserved once, however often the checkout retries', async () => {
    const h = ordersHarness();
    const d = await h.promotions.addDeal({ type: 'percent', value: 15 });
    const q = await h.orders.quote('c1', h.foodInput());
    await Promise.all([h.orders.place('c1', h.foodInput({ discountIqd: q.discountIqd, clientRequestId: KEY })), h.orders.place('c1', h.foodInput({ discountIqd: q.discountIqd, clientRequestId: KEY }))]);
    await h.orders.place('c1', h.foodInput({ discountIqd: q.discountIqd, clientRequestId: KEY }));
    expect(h.repo.orders.size).toBe(1);
    expect(await h.promotions.spent(d.id)).toBe(2250);
  });

  it('keys are per orderer and per attempt: other keys, other people and no key all place new orders', async () => {
    const h = ordersHarness();
    h.cashRisk.prior.set('c2', 3);
    const a = await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    const b = await h.orders.place('c1', h.foodInput({ clientRequestId: 'chk_other_attempt' }));
    const c = await h.orders.place('c2', h.foodInput({ clientRequestId: KEY }));
    const d = await h.orders.place('c1', h.foodInput());
    const e = await h.orders.place('c1', h.foodInput());
    expect(new Set([a.id, b.id, c.id, d.id, e.id]).size).toBe(5);
    expect(d.clientRequestId).toBeNull();
  });

  it('a failed attempt places nothing, so the retry with the same key can still succeed', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput({ clientRequestId: KEY, deliveryFeeIqd: 1 })))).toBe('price_changed');
    expect(h.repo.orders.size).toBe(0);
    const o = await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    expect(o.state).toBe('placed');
  });

  it('a key re-used for a different order is a client bug, refused (not a silent replay)', async () => {
    const h = ordersHarness();
    h.merchants.add('rest_2', { location: { zoneKey: 'centre' } });
    await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    expect(await code(h.orders.place('c1', h.foodInput({ merchantOrgId: 'rest_2', clientRequestId: KEY })))).toBe('invalid_input');
  });

  it('refuses malformed keys', async () => {
    const h = ordersHarness();
    for (const k of ['short', 'has space in it', 'x'.repeat(65), 'مفتاح_عربي_طويل']) expect(await code(h.orders.place('c1', h.foodInput({ clientRequestId: k })))).not.toBe('ok');
    expect(h.repo.orders.size).toBe(0);
  });

  it('keeps the kitchen and courier notes apart (M-09)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput({ note: 'بدون بصل', courierNote: '  دگ الجرس مرتين  ' }));
    expect(o).toMatchObject({ note: 'بدون بصل', courierNote: 'دگ الجرس مرتين' });
    expect((await h.orders.place('c1', h.foodInput({ courierNote: '   ' }))).courierNote).toBeNull();
  });
});

describe('InMemoryOrdersRepository — the (orderer, key) unique index', () => {
  it('refuses a second insert with the same key and finds the first', async () => {
    const repo = new InMemoryOrdersRepository();
    const h = ordersHarness();
    const placed = await h.orders.place('c1', h.foodInput({ clientRequestId: KEY }));
    // A placed order's record as a new-order input (create assigns its own id and state).
    const order = (await h.repo.find(placed.id))!.order as unknown as Parameters<InMemoryOrdersRepository['create']>[0];
    const first = await repo.create(order, [], []);
    await expect(repo.create(order, [], [])).rejects.toBeInstanceOf(DuplicateClientRequest);
    expect((await repo.findByClientRequest('c1', KEY))?.order.id).toBe(first.order.id);
    expect(await repo.findByClientRequest('c2', KEY)).toBeNull();
    // No key: no constraint.
    await repo.create({ ...order, clientRequestId: null }, [], []);
    await repo.create({ ...order, clientRequestId: null }, [], []);
    expect(repo.orders.size).toBe(3);
  });
});
