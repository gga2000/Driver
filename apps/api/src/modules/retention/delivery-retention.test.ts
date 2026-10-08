import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { createInMemoryEvents } from '../events/index.js';
import { NotifyService } from '../notify/index.js';
import { InMemoryNotifyRepository, type NewDelivery } from '../notify/notify.repository.js';
import { DeliveryRetention, NOTIFY_DELIVERY_KEEP_DAYS, SUBSCRIBER_DELIVERY_KEEP_DAYS } from './delivery-retention.js';

const START = '2026-10-03T09:00:00Z';

function harness() {
  const clock = new FakeClock(START);
  const queue: NonNullable<NonNullable<Parameters<typeof createInMemoryEvents>[0]>['queue']> = new InMemoryQueue('outbox', () => clock.now());
  const ev = createInMemoryEvents({ clock, queue, contradictions: false });
  const notifyRepo = new InMemoryNotifyRepository();
  const notify = new NotifyService(undefined, undefined, notifyRepo, clock);
  return { clock, ev, notifyRepo, notify, retention: new DeliveryRetention(ev.events, notify, clock, 'all') };
}

const message = (key: string, status: NewDelivery['status']): NewDelivery => ({
  dedupeKey: key,
  eventId: `ev_${key}`,
  template: 'order_accepted',
  personId: 'c1',
  orderId: 'o1',
  channel: 'push',
  status,
  reason: null,
  twin: false,
  payload: { params: {}, app: 'customer', title: null, body: null },
  notBefore: null,
});

describe('DeliveryRetention', () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops a published event's subscriber records after a week and keeps those a retry still needs", async () => {
    const h = harness();
    const okRuns: string[] = [];
    let locked = true;
    h.ev.events.subscribe('test:ok', '*', async (e) => void okRuns.push(e.orderId!));
    h.ev.events.subscribe('test:fails_o2', '*', async (e) => {
      if (locked && e.orderId === 'o2') throw new Error('kitchen row locked');
    });
    await h.ev.events.emit(undefined, { type: 'order.placed', actorId: 'c1', occurredAt: h.clock.now(), orderId: 'o1' }, { name: 'order', id: 'o1' });
    await h.ev.events.emit(undefined, { type: 'order.placed', actorId: 'c1', occurredAt: h.clock.now(), orderId: 'o2' }, { name: 'order', id: 'o2' });
    await h.ev.publisher.drainOnce();
    expect(await h.ev.events.outboxStats()).toEqual({ pending: 1, published: 1, failed: 0 });
    expect(h.ev.repo.allDeliveries()).toHaveLength(4);

    h.clock.advanceMinutes(SUBSCRIBER_DELIVERY_KEEP_DAYS * 1440 - 1);
    expect(await h.retention.tick()).toEqual({ subscriber: 0, notify: 0 });
    h.clock.advanceMinutes(2);
    expect(await h.retention.tick()).toEqual({ subscriber: 2, notify: 0 });
    const left = h.ev.repo.allDeliveries();
    expect(left.map((d) => d.subscriber).sort()).toEqual(['test:fails_o2', 'test:ok']);
    const [o2] = await h.ev.repo.outbox({ status: 'pending' });
    expect(left.every((d) => d.outboxId === o2!.id)).toBe(true);

    // The retry that still has to run skips the subscriber that already succeeded.
    locked = false;
    await h.ev.publisher.drainOnce();
    expect(await h.ev.events.outboxStats()).toEqual({ pending: 0, published: 2, failed: 0 });
    expect(okRuns).toEqual(['o1', 'o2']);
  });

  it('drops settled message records after 60 days; queued and deferred ones stay', async () => {
    const h = harness();
    await h.notifyRepo.insertDeliveries([message('a', 'sent'), message('b', 'failed'), message('c', 'deferred'), message('d', 'queued')], h.clock.now());
    h.clock.advanceMinutes(30 * 1440);
    await h.notifyRepo.insertDeliveries([message('e', 'read')], h.clock.now());

    h.clock.advanceMinutes(30 * 1440 - 1);
    expect((await h.retention.tick()).notify).toBe(0);
    h.clock.advanceMinutes(2);
    expect(NOTIFY_DELIVERY_KEEP_DAYS).toBe(60);
    expect((await h.retention.tick()).notify).toBe(2);
    expect([...h.notifyRepo.deliveries.values()].map((r) => r.dedupeKey).sort()).toEqual(['c', 'd', 'e']);
  });

  it('runs only where jobs run (DRIVER_ROLE web leaves it to the worker)', () => {
    const h = harness();
    const spy = vi.spyOn(globalThis, 'setInterval');
    new DeliveryRetention(h.ev.events, h.notify, h.clock, 'web').onModuleInit();
    expect(spy).not.toHaveBeenCalled();
    const worker = new DeliveryRetention(h.ev.events, h.notify, h.clock, 'worker');
    worker.onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });
});
