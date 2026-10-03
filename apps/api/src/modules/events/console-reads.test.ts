import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { createInMemoryEvents } from './in-memory.js';
import type { OutboxTick } from './outbox.publisher.js';

/** Queue mode: nothing drains until the test says so, so rows stay pending. */
function quiet() {
  const clock = new FakeClock('2026-10-03T09:00:00Z');
  const queue = new InMemoryQueue<OutboxTick>('outbox', () => clock.now());
  return { ...createInMemoryEvents({ clock, queue, contradictions: false }), clock };
}

describe('EventsService Console reads', () => {
  it('recentFailedOutbox: newest failed rows first, with attempts and last error, capped', async () => {
    const h = quiet();
    for (let i = 1; i <= 4; i += 1) {
      h.clock.advanceSeconds(1);
      await h.events.emit(undefined, { type: `t.${i}`, actorId: 'a', occurredAt: h.clock.now(), orderId: `ord_${i}` }, { name: 'order', id: `ord_${i}` });
    }
    const rows = await h.repo.outbox();
    await h.repo.updateOutbox(rows[0]!.id, { status: 'failed', attempts: 10, lastError: 'subscriber ledger: boom' });
    await h.repo.updateOutbox(rows[2]!.id, { status: 'failed', attempts: 10, lastError: 'timeout' });

    const failed = await h.events.recentFailedOutbox();
    expect(failed.map((f) => f.type)).toEqual(['t.3', 't.1']);
    expect(failed[0]).toMatchObject({ aggregate: 'order', aggregateId: 'ord_3', attempts: 10, lastError: 'timeout', eventId: rows[2]!.eventId });
    expect(failed[0]!.createdAt).toBeInstanceOf(Date);
    expect(await h.events.recentFailedOutbox(1)).toHaveLength(1);
    expect(await h.events.outboxStats()).toEqual({ pending: 2, published: 0, failed: 2 });
  });

  it('forOrder / forTrip keep quarantined late replays in the log, marked', async () => {
    const h = quiet();
    const detached = new Date('2026-10-03T09:00:00Z');
    h.events.useTripOrderLookup({ detachedAt: async () => detached });
    h.clock.advanceSeconds(30);
    await h.events.emit(undefined, { type: 'stop.completed', actorId: 'd1', occurredAt: new Date('2026-10-03T09:00:10Z'), tripId: 'trp_1', orderId: 'ord_1', deviceUptimeMs: 5_000 }, { name: 'trip', id: 'trp_1' });
    const [e] = await h.events.forOrder('ord_1');
    expect(e).toMatchObject({ type: 'stop.completed', quarantined: true, quarantineReason: 'late_replay' });
    expect((await h.events.forTrip('trp_1')).map((x) => x.id)).toEqual([e!.id]);
    expect(await h.events.forOrder('nope')).toEqual([]);
  });
});
