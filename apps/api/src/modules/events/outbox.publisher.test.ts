import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { createInMemoryEvents } from './in-memory.js';
import type { OutboxTick } from './outbox.publisher.js';
import { OUTBOX_LEASE_MS } from './timestamps.js';

const START = '2026-10-03T09:00:00Z';

function queued() {
  const clock = new FakeClock(START);
  const queue = new InMemoryQueue<OutboxTick>('outbox', () => clock.now());
  return { ...createInMemoryEvents({ clock, queue, contradictions: false }), clock, queue };
}

function synced() {
  const clock = new FakeClock(START);
  return { ...createInMemoryEvents({ clock, contradictions: false }), clock };
}

const order = (id: string, type = 'order.placed') => ({ type, actorId: 'c1', occurredAt: new Date(START), orderId: id });

describe('OutboxPublisher — sync mode (no Redis)', () => {
  it('drains after commit, before UnitOfWork.run returns, and never before', async () => {
    const h = synced();
    const seen: string[] = [];
    h.events.subscribe('test:seen', '*', async (e) => {
      seen.push(e.type);
    });
    await h.uow.run(async (tx) => {
      await h.events.emit(tx, order('o1'), { name: 'order', id: 'o1' });
      await h.events.emit(tx, order('o1', 'order.accepted'), { name: 'order', id: 'o1' });
      expect(seen).toEqual([]); // nothing publishes inline
    });
    expect(seen).toEqual(['order.placed', 'order.accepted']);
    expect(await h.events.outboxStats()).toEqual({ pending: 0, published: 2, failed: 0 });
  });

  it('events a subscriber emits are delivered in the same drain (re-entrant pokes do not deadlock)', async () => {
    const h = synced();
    const seen: string[] = [];
    h.events.subscribe('test:chain', ['order.placed'], async (e, ctx) => {
      await h.events.emit(ctx.tx, { type: 'order.offered_to_merchant', actorId: 'system', occurredAt: h.clock.now(), orderId: e.orderId }, { name: 'order', id: e.orderId! });
    });
    h.events.subscribe('test:seen', '*', async (e) => {
      seen.push(e.type);
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    expect(seen).toEqual(['order.placed', 'order.offered_to_merchant']);
  });

  it('drain() waits for a drain already running (the interval or another commit) instead of returning at once', async () => {
    const h = synced();
    const seen: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    h.events.subscribe('test:slow', ['order.placed'], async (e) => {
      seen.push(e.orderId!);
      await gate;
    });
    const first = h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' }); // its drain holds at o1
    while (!seen.includes('o1')) await new Promise((r) => setTimeout(r, 0));
    let returned = false;
    const drained = h.events.drain().then(() => (returned = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(returned).toBe(false);
    open();
    await drained;
    await first;
    expect(await h.events.pendingOutbox()).toBe(0);
  });

  it('rows with no subscriber are published', async () => {
    const h = synced();
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    expect((await h.repo.outbox())[0]).toMatchObject({ status: 'published', publishedAt: new Date(START) });
  });
});

describe('OutboxPublisher — graceful shutdown', () => {
  it('shutdown() delivers rows still pending (the tick never ran) and stops the interval', async () => {
    const h = queued();
    const seen: string[] = [];
    h.events.subscribe('test:seen', '*', async (e) => {
      seen.push(e.orderId!);
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    await h.events.emit(undefined, order('o2'), { name: 'order', id: 'o2' });
    expect(await h.events.pendingOutbox()).toBe(2);
    expect(await h.events.publisher.shutdown()).toBe(2);
    expect(seen).toEqual(['o1', 'o2']);
    expect(await h.events.pendingOutbox()).toBe(0);
    expect(await h.events.publisher.shutdown()).toBe(0); // idempotent
  });
});

describe('OutboxPublisher — queue mode (BullMQ contract on InMemoryQueue)', () => {
  it('a commit pokes one `tick` job; the worker drains it; later pokes enqueue again', async () => {
    const h = queued();
    const seen: string[] = [];
    h.events.subscribe('test:seen', '*', async (e) => {
      seen.push(e.orderId!);
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    await h.events.emit(undefined, order('o2'), { name: 'order', id: 'o2' });
    expect(h.queue.pending().map((j) => j.id)).toEqual(['tick']); // one waiting tick, however many pokes
    expect(seen).toEqual([]);
    expect(await h.events.pendingOutbox()).toBe(2);

    expect(await h.queue.drain()).toBe(1);
    expect(seen).toEqual(['o1', 'o2']);
    expect(await h.events.pendingOutbox()).toBe(0);

    await h.events.emit(undefined, order('o3'), { name: 'order', id: 'o3' });
    expect(h.queue.size).toBe(1); // the finished tick released its jobId
    await h.queue.drain();
    expect(seen).toEqual(['o1', 'o2', 'o3']);
  });

  it('a poke that cannot reach Redis leaves rows pending; the next tick drains them — nothing lost', async () => {
    const h = queued();
    const seen: string[] = [];
    h.events.subscribe('test:seen', '*', async (e) => {
      seen.push(e.orderId!);
    });
    const add = h.queue.add.bind(h.queue);
    h.queue.add = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    };
    for (const id of ['o1', 'o2', 'o3']) await h.events.emit(undefined, order(id), { name: 'order', id });
    expect(await h.events.pendingOutbox()).toBe(3); // pending climbs while Redis is down
    h.queue.add = add; // Redis is back: the interval's next poke gets through
    await h.publisher.poke();
    await h.queue.drain();
    expect(seen).toEqual(['o1', 'o2', 'o3']);
    expect(await h.events.outboxStats()).toEqual({ pending: 0, published: 3, failed: 0 });
  });
});

describe('retry, backoff, failure', () => {
  it('a throwing subscriber is retried after 2^attempts s and the row publishes once it succeeds', async () => {
    const h = queued();
    let calls = 0;
    h.events.subscribe('test:flaky', '*', async () => {
      calls += 1;
      if (calls <= 2) throw new Error(`flaky ${calls}`);
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });

    expect(await h.publisher.drainOnce()).toEqual({ claimed: 1, published: 0, retried: 1, failed: 0 });
    let [row] = await h.repo.outbox();
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'test:flaky: flaky 1' });
    expect(row!.nextAttemptAt).toEqual(new Date('2026-10-03T09:00:02Z'));

    h.clock.advanceSeconds(1);
    expect((await h.publisher.drainOnce()).claimed).toBe(0); // not due yet
    h.clock.advanceSeconds(1);
    expect((await h.publisher.drainOnce()).retried).toBe(1);
    [row] = await h.repo.outbox();
    expect(row).toMatchObject({ attempts: 2, lastError: 'test:flaky: flaky 2' });
    expect(row!.nextAttemptAt).toEqual(new Date('2026-10-03T09:00:06Z')); // +4 s

    h.clock.advanceSeconds(4);
    expect((await h.publisher.drainOnce()).published).toBe(1);
    [row] = await h.repo.outbox();
    expect(row).toMatchObject({ status: 'published', attempts: 2, lastError: undefined });
    expect(calls).toBe(3);
  });

  it('after 10 failed attempts the row is `failed` with the last error and is not claimed again', async () => {
    const h = queued();
    h.events.subscribe('test:broken', '*', async () => {
      throw new Error('payload does not parse');
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    const delays: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await h.publisher.drainOnce();
      expect(r.claimed).toBe(1);
      const [row] = await h.repo.outbox();
      if (row!.status === 'pending') {
        delays.push((row!.nextAttemptAt.getTime() - h.clock.now().getTime()) / 1000);
        h.clock.set(row!.nextAttemptAt);
      }
    }
    expect(delays).toEqual([2, 4, 8, 16, 32, 64, 128, 256, 512]);
    const [row] = await h.repo.outbox();
    expect(row).toMatchObject({ status: 'failed', attempts: 10, lastError: 'test:broken: payload does not parse' });
    h.clock.advanceMinutes(60);
    expect((await h.publisher.drainOnce()).claimed).toBe(0);
    expect(await h.events.outboxStats()).toEqual({ pending: 0, published: 0, failed: 1 });
  });
});

describe('per-subscriber dedupe (subscriber_deliveries)', () => {
  it('on retry only the subscriber that failed runs again', async () => {
    const h = queued();
    const calls = { steady: 0, flaky: 0 };
    h.events.subscribe('test:steady', '*', async () => {
      calls.steady += 1;
    });
    h.events.subscribe('test:flaky', '*', async () => {
      calls.flaky += 1;
      if (calls.flaky === 1) throw new Error('once');
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    await h.publisher.drainOnce();
    h.clock.advanceSeconds(2);
    await h.publisher.drainOnce();
    expect(calls).toEqual({ steady: 1, flaky: 2 });
    const deliveries = h.repo.allDeliveries().sort((a, b) => a.subscriber.localeCompare(b.subscriber));
    expect(deliveries.map((d) => [d.subscriber, d.attempts, d.deliveredAt !== null, d.lastError])).toEqual([
      ['test:flaky', 2, true, null],
      ['test:steady', 1, true, null],
    ]);
  });

  it('a row redelivered after a crash (still pending although every effect committed) is skipped by every subscriber', async () => {
    const h = queued();
    let calls = 0;
    h.events.subscribe('test:once', '*', async () => {
      calls += 1;
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    await h.publisher.drainOnce();
    const [row] = await h.repo.outbox();
    // The worker died before marking it: still pending, with the claim's lease on it.
    await h.repo.updateOutbox(row!.id, { status: 'pending', nextAttemptAt: new Date(h.clock.now().getTime() + OUTBOX_LEASE_MS) });
    h.clock.advance(OUTBOX_LEASE_MS);
    await h.publisher.drainOnce();
    expect(calls).toBe(1);
    expect((await h.repo.outbox())[0]!.status).toBe('published');
  });

  it('after half the lease a batch starts no new row and hands the rest back, due at once', async () => {
    const clock = new FakeClock(START);
    const queue = new InMemoryQueue<OutboxTick>('outbox', () => clock.now());
    const h = createInMemoryEvents({ clock, queue, contradictions: false, publisher: { leaseMs: 40 } });
    const seen: string[] = [];
    h.events.subscribe('test:slow', '*', async (e) => {
      seen.push(e.orderId ?? '');
      await new Promise((r) => setTimeout(r, 30)); // real time: the lease is measured on the wall clock
    });
    for (const id of ['o1', 'o2', 'o3']) await h.events.emit(undefined, order(id), { name: 'order', id });
    expect(await h.publisher.drainOnce()).toMatchObject({ claimed: 3, published: 1 });
    const waiting = (await h.repo.outbox({ status: 'pending' })).map((r) => r.nextAttemptAt.getTime());
    expect(waiting).toEqual([clock.now().getTime(), clock.now().getTime()]); // handed back, not left leased
    await h.publisher.drainUntilIdle();
    expect(seen).toEqual(['o1', 'o2', 'o3']);
  });

  it('rows a dead drain claimed wait out the lease, then come back by themselves', async () => {
    const h = queued();
    let calls = 0;
    h.events.subscribe('test:count', '*', async () => {
      calls += 1;
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    // A drain claims the row and dies before delivering anything.
    await h.repo.claimDue(h.clock.now(), 10, async () => undefined);
    expect((await h.publisher.drainOnce()).claimed).toBe(0); // another drain skips the claimed row
    h.clock.advance(OUTBOX_LEASE_MS - 1);
    expect((await h.publisher.drainOnce()).claimed).toBe(0);
    h.clock.advance(1);
    expect(await h.publisher.drainOnce()).toMatchObject({ claimed: 1, published: 1 });
    expect(calls).toBe(1);
  });

  it('a handler that throws commits neither its effects nor a delivery record', async () => {
    const h = queued();
    h.events.subscribe('test:emits-then-throws', '*', async (e, ctx) => {
      if (e.type !== 'order.placed') return;
      await h.events.emit(ctx.tx, order('o1', 'order.side_effect'), { name: 'order', id: 'o1' });
      throw new Error('after the write');
    });
    await h.events.emit(undefined, order('o1'), { name: 'order', id: 'o1' });
    await h.publisher.drainOnce();
    expect((await h.events.forOrder('o1')).map((e) => e.type)).toEqual(['order.placed']);
    expect(h.repo.allDeliveries()[0]).toMatchObject({ deliveredAt: null, attempts: 1, lastError: 'after the write' });
  });
});

describe('concurrent drains', () => {
  it('two (or five) drains running at once never deliver a row twice', async () => {
    const h = queued();
    const delivered = new Map<string, number>();
    h.events.subscribe('test:slow', '*', async (e) => {
      await new Promise((r) => setTimeout(r, 1)); // yield so the drains interleave
      delivered.set(e.id, (delivered.get(e.id) ?? 0) + 1);
    });
    for (let i = 0; i < 60; i++) await h.events.emit(undefined, order(`o${i}`), { name: 'order', id: `o${i}` });

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => h.publisher.drainOnce(20)));
    expect(results.reduce((n, r) => n + r.claimed, 0)).toBe(60);
    expect(results.filter((r) => r.claimed > 0).length).toBeGreaterThanOrEqual(3); // they really ran side by side
    expect(delivered.size).toBe(60);
    expect([...delivered.values()].every((n) => n === 1)).toBe(true);
    expect(await h.events.outboxStats()).toEqual({ pending: 0, published: 60, failed: 0 });
  });

  it('batches are claimed oldest first, 200 at a time by default', async () => {
    const h = queued();
    const order_: string[] = [];
    h.events.subscribe('test:order', '*', async (e) => {
      order_.push(e.orderId!);
    });
    for (let i = 0; i < 205; i++) await h.events.emit(undefined, order(`o${i}`), { name: 'order', id: `o${i}` });
    expect((await h.publisher.drainOnce()).claimed).toBe(200);
    expect((await h.publisher.drainOnce()).claimed).toBe(5);
    expect(order_).toEqual(Array.from({ length: 205 }, (_, i) => `o${i}`));
  });
});
