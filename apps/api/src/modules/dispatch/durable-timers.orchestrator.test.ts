import { describe, expect, it } from 'vitest';
import { rideSearchStartsAt } from '@driver/contracts';
import { InMemoryTimerStore, TimerSweeper } from '../../shared/timers/index.js';
import { DISPATCH_QUEUE_NAME, DURABLE_TIMER_GRACE_MS } from './offer.orchestrator.js';
import { dispatchHarness, north } from './test-harness.js';

/**
 * NTF-05: a ride booked for later must not depend on one Redis job. Its far-ahead timers (the evening
 * offer, the deadline, the reminder, the T−30 search) are also kept in the durable timer table; when the
 * Redis job is lost the timer sweeper fires them a minute late, and when it ran on time they never run twice.
 */
const NOW = '2026-10-07T11:00:00Z';
const T = new Date('2026-10-08T02:00:00Z'); // Thursday 05:00 Baghdad
const SHOW = Date.parse('2026-10-08T01:30:00Z'); // T−30

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

const book = ({ h }: S) =>
  h.service.request({ tripId: 't1', orderId: 'o1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), startAt: rideSearchStartsAt(T), scheduledFor: T });

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
    const claimed = await s.timers.claimDue({ now: new Date(Date.parse(NOW) + 2 * 86_400_000), queues: [DISPATCH_QUEUE_NAME], limit: 50, leaseMs: 1, worker: 'test' });
    expect(claimed.map((t) => t.name).sort()).toEqual(['booked_deadline', 'booked_open', 'booked_remind', 'broadcast_start']);
    for (const t of claimed) expect(t.dueAt.getTime()).toBe(redis.get(t.jobId!)! + DURABLE_TIMER_GRACE_MS);
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
