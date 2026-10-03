import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { CONTRADICTION_ACTOR } from './contradiction.detector.js';
import { createInMemoryEvents } from './in-memory.js';

const T = (hhmm: string) => new Date(`2026-10-03T${hhmm}:00Z`);

function setup() {
  const clock = new FakeClock(T('10:00'));
  const h = createInMemoryEvents({ clock });
  const trip = { name: 'trip', id: 't1' };
  return { ...h, clock, trip };
}

describe('contradiction detector (domain §6: offline contradictions open a dispute, never rewrite)', () => {
  it('an offline "delivered" older than the dispatcher’s cancel opens dispute.opened referencing both', async () => {
    const h = setup();
    await h.events.emit(undefined, { type: 'trip.accepted', actorId: 'd1', occurredAt: h.clock.now(), tripId: 't1' }, h.trip);
    h.clock.set(T('10:05'));
    const cancel = await h.events.emit(undefined, { type: 'trip.platform_cancelled', actorId: 'dispatcher_1', occurredAt: h.clock.now(), tripId: 't1' }, h.trip);
    h.clock.set(T('10:10')); // the courier's phone comes back online and replays
    const replay = await h.events.emit(
      undefined,
      { type: 'stop.completed', actorId: 'd1', occurredAt: T('10:02'), tripId: 't1', orderId: 'o1', deviceUptimeMs: 7_200_000, idempotencyKey: 'd1:op-9' },
      h.trip,
    );

    const disputes = (await h.events.forTrip('t1')).filter((e) => e.type === 'dispute.opened');
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({
      actorId: CONTRADICTION_ACTOR,
      tripId: 't1',
      orderId: 'o1',
      aggregate: 'dispute',
      payload: { reason: 'offline_contradiction', eventId: replay.id, eventType: 'stop.completed', contradictsEventId: cancel.id, contradictsType: 'trip.platform_cancelled' },
    });
    // nothing rewritten: both events stand as recorded
    expect((await h.events.forTrip('t1')).filter((e) => e.type !== 'dispute.opened').map((e) => e.type)).toEqual(['trip.accepted', 'trip.platform_cancelled', 'stop.completed']);
  });

  it('a redelivered replay does not open a second dispute', async () => {
    const h = setup();
    h.clock.set(T('10:05'));
    await h.events.emit(undefined, { type: 'trip.platform_cancelled', actorId: 'dispatcher_1', occurredAt: h.clock.now(), tripId: 't1' }, h.trip);
    h.clock.set(T('10:10'));
    const replay = await h.events.emit(undefined, { type: 'stop.completed', actorId: 'd1', occurredAt: T('10:02'), tripId: 't1', deviceUptimeMs: 1 }, h.trip);
    const [row] = await h.repo.outbox({ eventId: replay.id });
    await h.repo.updateOutbox(row!.id, { status: 'pending' });
    await h.repo.markDelivered(row!.id, 'test:other', h.clock.now()); // unrelated
    // the detector's delivery is recorded, so this is skipped; even if it were not, the dispute's idempotency key holds
    await h.events.drain();
    await h.detector.check({ ...replay, outboxId: row!.id }, undefined as never);
    expect((await h.events.forTrip('t1')).filter((e) => e.type === 'dispute.opened')).toHaveLength(1);
  });

  it('the driver’s own later events, online events and events after the last change are not contradictions', async () => {
    const h = setup();
    // the driver's own state changes (incl. server-derived ones in his name) never contradict his replays
    h.clock.set(T('10:05'));
    await h.events.emit(undefined, { type: 'trip.progressed', actorId: 'd1', occurredAt: h.clock.now(), tripId: 't1' }, h.trip);
    h.clock.set(T('10:10'));
    await h.events.emit(undefined, { type: 'stop.completed', actorId: 'd1', occurredAt: T('10:02'), tripId: 't1', deviceUptimeMs: 1 }, h.trip);
    // a dispatcher change after which an online event arrives in order
    await h.events.emit(undefined, { type: 'trip.reassigned', actorId: 'dispatcher_1', occurredAt: h.clock.now(), tripId: 't1' }, h.trip);
    h.clock.set(T('10:11'));
    await h.events.emit(undefined, { type: 'trip.accepted', actorId: 'd2', occurredAt: h.clock.now(), tripId: 't1' }, h.trip);
    // a device event that happened after the dispatcher's change
    await h.events.emit(undefined, { type: 'stop.arrived', actorId: 'd2', occurredAt: T('10:10'), tripId: 't1', deviceUptimeMs: 5 }, h.trip);
    expect((await h.events.forTrip('t1')).filter((e) => e.type === 'dispute.opened')).toEqual([]);
  });

  it('order aggregates are watched too; other aggregates are not', async () => {
    const h = setup();
    h.clock.set(T('10:05'));
    await h.events.emit(undefined, { type: 'order.cancelled', actorId: 'c1', occurredAt: h.clock.now(), orderId: 'o1' }, { name: 'order', id: 'o1' });
    await h.events.emit(undefined, { type: 'person.verified', actorId: 'p1', occurredAt: h.clock.now() }, { name: 'person', id: 'p1' });
    h.clock.set(T('10:10'));
    await h.events.emit(undefined, { type: 'order.ready', actorId: 'merchant_1', occurredAt: T('10:03'), orderId: 'o1', deviceUptimeMs: 1 }, { name: 'order', id: 'o1' });
    await h.events.emit(undefined, { type: 'person.reverified', actorId: 'admin', occurredAt: T('10:01'), deviceUptimeMs: 1 }, { name: 'person', id: 'p1' });
    const disputes = (await h.events.forOrder('o1')).filter((e) => e.type === 'dispute.opened');
    expect(disputes).toHaveLength(1);
    expect(disputes[0]!.payload).toMatchObject({ aggregate: 'order', eventType: 'order.ready', contradictsType: 'order.cancelled' });
    expect((await h.events.forActor(CONTRADICTION_ACTOR))).toHaveLength(1);
  });
});
