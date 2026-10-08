import { describe, expect, it } from 'vitest';
import { rideSearchStartsAt } from '@driver/contracts';
import { InMemoryTimerStore, TimerSweeper } from '../../shared/timers/index.js';
import { DISPATCH_QUEUE_NAME, DURABLE_TIMER_GRACE_MS } from './offer.orchestrator.js';
import { dispatchHarness, north } from './test-harness.js';

/**
 * NTF-05: a ride booked for later must not depend on one Redis job. Every dispatch timer due 5 minutes
 * or more ahead (the evening offer, the favourite's window, the deadline, the reminder, the T−30
 * search, a garage departure's low-fill check, a scheduled auto-assign start) is also kept in the
 * durable timer table; when the
 * Redis job is lost the timer sweeper fires them a minute late, and when it ran on time they never run twice.
 */
const NOW = '2026-10-07T11:00:00Z';
const T = new Date('2026-10-08T02:00:00Z'); // Thursday 05:00 Baghdad
const SHOW = Date.parse('2026-10-08T01:30:00Z'); // T−30
const FAV_END = Date.parse('2026-10-07T16:00:00Z'); // the favourite's hour ends (19:00 Baghdad)

function setup() {
  const h = dispatchHarness(NOW);
  const timers = new InMemoryTimerStore();
  const sweeper = new TimerSweeper(timers, h.clock, 'all', { enabled: false, intervalMs: 5_000, batch: 50, leaseMs: 60_000 });
  h.orchestrator.bindDurableTimers(timers, sweeper);
  return { h, timers, sweeper };
}

type S = ReturnType<typeof setup>;

async function fleet({ h }: S) {
  for (const [id, km] of [['d1', 0.2], ['d2', 0.5]] as const) {
    await h.online(id, km);
    h.keepAlive.add(id);
  }
}

const book = ({ h }: S, extra: Record<string, unknown> = {}) =>
  h.service.request({ tripId: 't1', orderId: 'o1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), startAt: rideSearchStartsAt(T), scheduledFor: T, ...extra });

/** Minute steps: heartbeats, the Redis queue (unless it was lost) and a timer sweep each minute. */
async function runTo({ h, sweeper }: S, at: number, opts: { redis?: boolean } = {}) {
  let fired = 0;
  while (h.clock.now().getTime() < at) {
    h.clock.advanceSeconds(Math.min(60, (at - h.clock.now().getTime()) / 1000));
    await h.heartbeatAll([...h.keepAlive]);
    if (opts.redis !== false) await h.queue.drain();
    fired += (await sweeper.sweep()).fired;
  }
  return fired;
}

describe('durable dispatch timers (NTF-05)', () => {
  it('keeps only the far-ahead timers of a booked ride, each a minute after its Redis job', async () => {
    const s = setup();
    await fleet(s);
    await book(s);
    const redis = new Map(s.h.queue.pending().map((j) => [j.id, j.readyAt.getTime()]));
    const kept = s.timers.rows.filter((t) => t.queue === DISPATCH_QUEUE_NAME && t.status === 'pending');
    expect(kept.map((t) => t.name).sort()).toEqual(['booked_deadline', 'booked_open', 'booked_remind', 'broadcast_start']);
    for (const t of kept) expect(t.dueAt.getTime()).toBe(redis.get(t.jobId!)! + DURABLE_TIMER_GRACE_MS);
    expect(kept[0]?.data).toMatchObject({ durable: true, cityId: 'aziziyah', vertical: 'taxi', orderId: 'o1' });
  });

  it('Redis lost overnight: the T−30 search still starts, about a minute late', async () => {
    const s = setup();
    await fleet(s);
    await book(s);
    await s.h.queue.close(); // a restart with a wiped Redis: every delayed job is gone
    await runTo(s, SHOW + 30_000, { redis: false });
    expect((await s.h.service.getRequest('t1'))?.status).toBe('scheduled'); // not yet: the copy waits its minute
    await runTo(s, SHOW + 2 * 60_000, { redis: false });
    expect((await s.h.service.getRequest('t1'))?.status).not.toBe('scheduled');
    expect(s.h.trips.offers.map((o) => o.tripId)).toContain('t1');
    expect(s.h.events.ofType('dispatch.booked_unconfirmed')).toHaveLength(1); // the 22:00 deadline ran too
  });

  it("a favourite driver's window: if its job is lost, the ride still opens to everyone, a minute late", async () => {
    const s = setup();
    await fleet(s);
    await s.h.online('fav', 2.5);
    s.h.keepAlive.add('fav');
    await book(s, { preferDriverIds: ['fav'] });
    expect(s.timers.rows.map((t) => t.name)).toContain('booked_fav_end');
    await s.h.queue.close();
    await runTo(s, FAV_END + 30_000, { redis: false });
    expect((await s.h.service.getRequest('t1'))?.booked?.openedAt).toBeNull(); // still only the favourite's
    await runTo(s, FAV_END + 2 * 60_000, { redis: false });
    expect((await s.h.service.getRequest('t1'))?.booked?.openedAt).not.toBeNull();
    expect(s.h.events.ofType('dispatch.booked_opened')).toHaveLength(1);
  });

  it('Redis wiped with the request in it: the next durable timer tells a dispatcher (one event)', async () => {
    const s = setup();
    await fleet(s);
    await book(s);
    await s.h.queue.close();
    (s.h.store as unknown as { requests: Map<string, unknown> }).requests.clear(); // requests live in Redis too
    await runTo(s, SHOW + 2 * 60_000, { redis: false });
    // Every durable timer of the ride finds it gone; one key, so the event store keeps one event.
    const lost = s.h.events.ofType('dispatch.needs_dispatcher');
    expect(lost.length).toBeGreaterThan(0);
    expect(new Set(lost.map((e) => e.idempotencyKey)).size).toBe(1);
    expect(lost[0]?.idempotencyKey).toMatch(/^dispatch\.request_lost\.t1\.\d+$/);
    expect(lost[0]?.payload).toMatchObject({ reason: 'request_lost', cityId: 'aziziyah', vertical: 'taxi', orderId: 'o1', timer: 'booked_open' });
  });

  it('booked 3 days ahead and cancelled: its record expires, and no timer cries "lost" for it', async () => {
    const s = setup();
    await fleet(s);
    const later = new Date(T.getTime() + 2 * 86_400_000);
    await s.h.service.request({ tripId: 't1', orderId: 'o1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), startAt: rideSearchStartsAt(later), scheduledFor: later });
    expect(s.timers.rows.filter((t) => t.status === 'pending').length).toBeGreaterThan(0);
    await s.h.service.cancel('t1', 'rider');
    expect(s.timers.rows.filter((t) => t.status === 'pending')).toEqual([]); // settled with the request
    (s.h.store as unknown as { requests: Map<string, unknown> }).requests.clear(); // the retired record's day is over
    await runTo(s, later.getTime() + 60_000);
    expect(s.h.events.ofType('dispatch.needs_dispatcher')).toEqual([]);
  });

  it('a garage departure two hours ahead: its low-fill check is kept too, and runs once', async () => {
    const s = setup();
    s.h.departures.seats.set('dep1', 2);
    await s.h.service.request({ tripId: 'dep-trip', cityId: 'aziziyah', vertical: 'intercity', zoneId: 'centre', departureId: 'dep1', departureAt: new Date(Date.parse(NOW) + 2 * 3600_000) });
    await s.h.queue.close();
    await runTo(s, Date.parse(NOW) + 92 * 60_000, { redis: false });
    expect(s.h.departures.cancelled).toEqual(['dep1']);
    expect(s.h.events.ofType('dispatch.low_fill_cancelled')).toHaveLength(1);
  });

  it('Redis on time: every durable copy is marked fired and the sweeper runs none of them', async () => {
    const s = setup();
    await fleet(s);
    await book(s);
    const fired = await runTo(s, SHOW + 10 * 60_000);
    expect(fired).toBe(0);
    expect((await s.h.service.getRequest('t1'))?.status).not.toBe('scheduled');
    expect((await s.timers.stats(s.h.clock.now())).pending).toBe(0);
  });
});
