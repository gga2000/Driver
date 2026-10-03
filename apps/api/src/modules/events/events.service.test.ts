import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { createInMemoryEvents } from './in-memory.js';
import type { OutboxTick } from './outbox.publisher.js';
import type { PublishedEvent } from './events.types.js';

const START = '2026-10-03T09:00:00Z';

/** Queue mode with a hand-driven in-memory queue: nothing is delivered until the test drains. */
function quiet() {
  const clock = new FakeClock(START);
  const queue = new InMemoryQueue<OutboxTick>('outbox', () => clock.now());
  return { ...createInMemoryEvents({ clock, queue, contradictions: false }), clock, queue };
}

class FakeDetachments {
  readonly at = new Map<string, Date>();
  async detachedAt(tripId: string, orderId: string): Promise<Date | null> {
    return this.at.get(`${tripId}/${orderId}`) ?? null;
  }
}

describe('EventsService.emit — transactional write', () => {
  it('writes the event and one pending outbox row in the caller’s transaction, stamped with server time', async () => {
    const h = quiet();
    h.clock.advanceSeconds(5);
    const ev = await h.uow.run((tx) =>
      h.events.emit(
        tx,
        { type: 'stop.arrived', actorId: 'd1', occurredAt: new Date('2026-10-03T09:00:03Z'), tripId: 'trp_1', orderId: 'ord_1', deviceUptimeMs: 42_000, payload: { stopId: 's1' } },
        { name: 'trip', id: 'trp_1' },
      ),
    );
    expect(ev).toMatchObject({ type: 'stop.arrived', tripId: 'trp_1', orderId: 'ord_1', deviceUptimeMs: 42_000, aggregate: 'trip', aggregateId: 'trp_1', flagged: false, quarantined: false, skewMs: -2000 });
    expect(ev.recordedAt).toEqual(new Date('2026-10-03T09:00:05Z'));
    expect(ev.payload).toEqual({ stopId: 's1' }); // orderId / deviceUptimeMs are top-level, never folded in
    const rows = await h.repo.outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId: ev.id, aggregate: 'trip', aggregateId: 'trp_1', type: 'stop.arrived', status: 'pending', attempts: 0 });
    expect(rows[0]!.event).toEqual(ev);
    expect(await h.events.pendingOutbox()).toBe(1);
  });

  it('rollback leaves no event and no outbox row', async () => {
    const h = quiet();
    await expect(
      h.uow.run(async (tx) => {
        await h.events.emit(tx, { type: 'order.placed', actorId: 'c1', occurredAt: h.clock.now(), orderId: 'ord_1' }, { name: 'order', id: 'ord_1' });
        // visible inside its own transaction…
        expect(await h.repo.find({ orderId: 'ord_1' }, tx)).toHaveLength(1);
        // …but not to anyone else before commit
        expect(await h.events.forOrder('ord_1')).toHaveLength(0);
        throw new Error('aggregate write failed');
      }),
    ).rejects.toThrow('aggregate write failed');
    expect(await h.events.forOrder('ord_1')).toEqual([]);
    expect(await h.repo.outbox()).toEqual([]);
    expect(await h.events.outboxStats()).toEqual({ pending: 0, published: 0, failed: 0 });
    expect(h.queue.size).toBe(0); // and nobody was poked
  });

  it('emits without a tx open a transaction of their own', async () => {
    const h = quiet();
    await h.events.emit(undefined, { type: 'org.created', actorId: 'p1', occurredAt: h.clock.now() }, { name: 'org', id: 'org_1' });
    expect(await h.events.forActor('p1')).toHaveLength(1);
  });

  it('idempotency key: the second emit returns the first event and writes nothing (same tx, later tx)', async () => {
    const h = quiet();
    const e = { type: 'stop.completed', actorId: 'd1', occurredAt: h.clock.now(), tripId: 'trp_1', idempotencyKey: 'dev-1:op-7' };
    const [a, b] = await h.uow.run(async (tx) => [await h.events.emit(tx, e, { name: 'trip', id: 'trp_1' }), await h.events.emit(tx, e, { name: 'trip', id: 'trp_1' })]);
    const c = await h.uow.run((tx) => h.events.emit(tx, { ...e, payload: { different: true } }, { name: 'trip', id: 'trp_1' }));
    expect(b!.id).toBe(a!.id);
    expect(c.id).toBe(a!.id);
    expect(c.payload).toEqual({});
    expect(await h.repo.outbox()).toHaveLength(1);
    expect(await h.events.forTrip('trp_1')).toHaveLength(1);
  });

  it('idempotency key across two concurrent transactions: only the first commit lands (ON CONFLICT DO NOTHING)', async () => {
    const h = quiet();
    const e = { type: 'cash.collected', actorId: 'd1', occurredAt: h.clock.now(), idempotencyKey: 'k-1' };
    await Promise.all([
      h.uow.run((tx) => h.events.emit(tx, e, { name: 'order', id: 'o1' })),
      h.uow.run((tx) => h.events.emit(tx, e, { name: 'order', id: 'o1' })),
    ]);
    expect(await h.repo.outbox()).toHaveLength(1);
  });

  it('forActor / forTrip / forOrder read in recording order', async () => {
    const h = quiet();
    await h.uow.run(async (tx) => {
      await h.events.emit(tx, { type: 'trip.created', actorId: 'system', occurredAt: h.clock.now(), tripId: 't1' }, { name: 'trip', id: 't1' });
      await h.events.emit(tx, { type: 'trip.accepted', actorId: 'd1', occurredAt: h.clock.now(), tripId: 't1', orderId: 'o1' }, { name: 'trip', id: 't1' });
      await h.events.emit(tx, { type: 'order.accepted', actorId: 'm1', occurredAt: h.clock.now(), orderId: 'o1' }, { name: 'order', id: 'o1' });
    });
    expect((await h.events.forTrip('t1')).map((e) => e.type)).toEqual(['trip.created', 'trip.accepted']);
    expect((await h.events.forOrder('o1')).map((e) => e.type)).toEqual(['trip.accepted', 'order.accepted']);
    expect((await h.events.forActor('d1')).map((e) => e.type)).toEqual(['trip.accepted']);
  });
});

describe('device skew flags', () => {
  it.each([
    [+61_000, true, 'device_ahead'],
    [+59_000, false, undefined],
    [-5 * 60_000, true, 'device_skew'],
    [-8 * 86_400_000, true, 'device_stale'],
  ] as const)('occurredAt %i ms from receipt → flagged %s', async (delta, flagged, reason) => {
    const h = quiet();
    const ev = await h.events.emit(undefined, { type: 'stop.arrived', actorId: 'd1', occurredAt: new Date(h.clock.now().getTime() + delta), tripId: 't1' }, { name: 'trip', id: 't1' });
    expect(ev.flagged).toBe(flagged);
    expect(ev.flagReason).toBe(reason);
    expect(ev.recordedAt).toEqual(h.clock.now()); // evidence is bound to server receipt time
  });
});

describe('late-replay quarantine (edge-case §10)', () => {
  function setup() {
    const clock = new FakeClock(START);
    const detach = new FakeDetachments();
    const h = createInMemoryEvents({ clock, tripOrders: detach, contradictions: false });
    const ledger: string[] = [];
    const support: string[] = [];
    h.events.subscribe('ledger:stop.completed', ['stop.completed'], async (e) => {
      ledger.push(e.id);
    });
    h.events.subscribe('support:quarantine', '*', async (e) => {
      if (e.quarantined) support.push(e.id);
    }, { quarantined: true });
    return { ...h, clock, detach, ledger, support };
  }

  it('a device replay for a detached (trip, order) is stored quarantined as late_replay and never reaches settlement', async () => {
    const h = setup();
    h.detach.at.set('t1/o1', new Date('2026-10-03T09:05:00Z'));
    h.clock.set('2026-10-03T09:10:00Z'); // phone reconnects after the order moved to another trip
    const replay = await h.events.emit(
      undefined,
      { type: 'stop.completed', actorId: 'd1', occurredAt: new Date('2026-10-03T09:02:00Z'), tripId: 't1', orderId: 'o1', deviceUptimeMs: 3_600_000, idempotencyKey: 'd1:replay-1' },
      { name: 'trip', id: 't1' },
    );
    expect(replay).toMatchObject({ quarantined: true, quarantineReason: 'late_replay', type: 'stop.completed' });
    expect(h.ledger).toEqual([]);
    expect(h.support).toEqual([replay.id]);
    // kept, published (to support), visible in the trip's evidence
    expect((await h.repo.outbox({ eventId: replay.id }))[0]!.status).toBe('published');
    expect((await h.events.forTrip('t1')).map((e) => e.quarantined)).toEqual([true]);
  });

  it('the same event while the order is attached settles normally', async () => {
    const h = setup();
    const ev = await h.events.emit(undefined, { type: 'stop.completed', actorId: 'd1', occurredAt: h.clock.now(), tripId: 't1', orderId: 'o1', deviceUptimeMs: 1 }, { name: 'trip', id: 't1' });
    expect(ev.quarantined).toBe(false);
    expect(h.ledger).toEqual([ev.id]);
  });

  it('the server’s own detach event and later order events for the pair are not quarantined', async () => {
    const h = setup();
    h.detach.at.set('t1/o1', h.clock.now());
    const detachEvent = await h.events.emit(undefined, { type: 'trip.order_detached', actorId: 'system', occurredAt: h.clock.now(), tripId: 't1', orderId: 'o1' }, { name: 'trip', id: 't1' });
    h.clock.advanceSeconds(30);
    const followUp = await h.events.emit(undefined, { type: 'order.rematch_needed', actorId: 'system', occurredAt: h.clock.now(), tripId: 't1', orderId: 'o1' }, { name: 'order', id: 'o1' });
    expect([detachEvent.quarantined, followUp.quarantined]).toEqual([false, false]);
  });

  it('events without both a trip and an order are never looked up', async () => {
    const h = setup();
    h.detach.at.set('t1/o1', new Date('2026-10-03T08:00:00Z'));
    const ev = await h.events.emit(undefined, { type: 'stop.arrived', actorId: 'd1', occurredAt: h.clock.now(), tripId: 't1', deviceUptimeMs: 9 }, { name: 'trip', id: 't1' });
    expect(ev.quarantined).toBe(false);
  });
});

describe('subscribers see the stored event', () => {
  it('top-level ids, device uptime and the outbox id reach the handler', async () => {
    const clock = new FakeClock(START);
    const h = createInMemoryEvents({ clock, contradictions: false });
    const got: PublishedEvent[] = [];
    h.events.subscribe('test:all', '*', async (e) => {
      got.push(e);
    });
    await h.events.emit(undefined, { type: 'stop.arrived', actorId: 'd1', occurredAt: clock.now(), tripId: 't1', orderId: 'o1', deviceUptimeMs: 7, location: { lat: 32.91, lng: 45.06 } }, { name: 'trip', id: 't1' });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ tripId: 't1', orderId: 'o1', deviceUptimeMs: 7, location: { lat: 32.91, lng: 45.06 }, aggregate: 'trip' });
    expect(got[0]!.outboxId).toMatch(/^ob_/);
  });
});
