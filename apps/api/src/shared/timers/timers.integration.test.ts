import { afterAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../clock.js';
import { PrismaService } from '../db/prisma.service.js';
import { UnitOfWork } from '../db/unit-of-work.js';
import { PrismaTimerStore } from './timer.store.prisma.js';
import { TimerSweeper, type TimerSweeperOptions } from './timer.sweeper.js';

/**
 * Durable timers on a real Postgres (plan W4 "Done means": `timers.integration.test.ts`). A due timer
 * fires from the sweeper with no Redis at all; two workers sweeping at once fire each timer exactly
 * once; a rolled-back transaction leaves no timer. Needs DATABASE_URL with the migrations deployed.
 */
const url = process.env['DATABASE_URL'];
const OPTS: TimerSweeperOptions = { enabled: true, intervalMs: 5_000, batch: 25, leaseMs: 60_000 };

describe.skipIf(!url)('durable timers on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const store = new PrismaTimerStore(prisma);
  const tag = `it_${Date.now().toString(36)}`;
  const q = (name: string) => `${tag}.${name}`;

  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."scheduled_timers" WHERE "queue" LIKE ${`${tag}.%`}`;
    await prisma.onModuleDestroy();
  });

  const rows = (queue: string) => prisma.prisma.scheduledTimer.findMany({ where: { queue }, orderBy: { dueAt: 'asc' } });

  it('writes the timer with the caller: a rollback leaves none, a commit leaves exactly one', async () => {
    const clock = new FakeClock(new Date());
    const queue = q('tx');
    await expect(
      uow.run(async (tx) => {
        await store.schedule({ queue, name: 'order.autoReject', jobId: 'order.o1.autoReject', data: { orderId: 'o1' }, dueAt: clock.now() }, tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await rows(queue)).toEqual([]);

    await uow.run((tx) => store.schedule({ queue, name: 'order.autoReject', jobId: 'order.o1.autoReject', data: { orderId: 'o1' }, dueAt: clock.now() }, tx));
    expect(await uow.run((tx) => store.schedule({ queue, name: 'order.autoReject', jobId: 'order.o1.autoReject', data: { orderId: 'other' }, dueAt: clock.now() }, tx))).toBe(false);
    const [row, ...more] = await rows(queue);
    expect(more).toEqual([]);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, data: { orderId: 'o1' } });
  });

  it('fires a due timer from the sweeper alone (no Redis anywhere), then re-arms it on a new schedule', async () => {
    const clock = new FakeClock(new Date());
    const queue = q('fire');
    const sweeper = new TimerSweeper(store, clock, 'worker', OPTS);
    const ran: unknown[] = [];
    sweeper.register(queue, async (job) => {
      ran.push(job.data);
    });
    await store.schedule({ queue, name: 't', jobId: 'j1', data: { n: 1 }, dueAt: new Date(clock.now().getTime() + 30_000) });
    expect((await sweeper.sweep()).fired).toBe(0);
    clock.advanceSeconds(31);
    expect((await sweeper.sweep()).fired).toBe(1);
    expect(ran).toEqual([{ n: 1 }]);
    expect((await rows(queue))[0]).toMatchObject({ status: 'fired', attempts: 1, claimedUntil: null });

    expect(await store.schedule({ queue, name: 't', jobId: 'j1', data: { n: 2 }, dueAt: clock.now() })).toBe(true);
    expect((await rows(queue))[0]).toMatchObject({ status: 'pending', attempts: 0, firedAt: null, data: { n: 2 } });
    await store.markFired(queue, 'j1', clock.now());
    expect((await sweeper.sweep()).fired).toBe(0);
  });

  it("settles a finished ride's pending timers by job-id prefix, in the caller's transaction, and no one else's", async () => {
    const clock = new FakeClock(new Date());
    const queue = q('settle');
    const due = new Date(clock.now().getTime() + 3_600_000);
    for (const jobId of ['t1.booked_open.1.0', 't1.broadcast_start.1.0', 't10.broadcast_start.1.0']) await store.schedule({ queue, name: 'x', jobId, data: {}, dueAt: due });
    await expect(
      uow.run(async (tx) => {
        await store.settlePending(queue, 't1.', clock.now(), tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await rows(queue)).every((r) => r.status === 'pending')).toBe(true);
    expect(await uow.run((tx) => store.settlePending(queue, 't1.', clock.now(), tx))).toBe(2);
    const byJob = Object.fromEntries((await rows(queue)).map((r) => [r.jobId, r.status]));
    expect(byJob).toEqual({ 't1.booked_open.1.0': 'fired', 't1.broadcast_start.1.0': 'fired', 't10.broadcast_start.1.0': 'pending' });
  });

  it('fires each of 200 timers exactly once with two workers sweeping at the same time', async () => {
    const clock = new FakeClock(new Date());
    const queue = q('race');
    const counts = new Map<string, number>();
    const handler = async (job: { id: string }) => {
      counts.set(job.id, (counts.get(job.id) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 1));
    };
    const a = new TimerSweeper(store, clock, 'worker', OPTS);
    // A second client: its own connections, as a second worker machine would have.
    const other = new PrismaService(url);
    const b = new TimerSweeper(new PrismaTimerStore(other), clock, 'worker', OPTS);
    a.register(queue, handler);
    b.register(queue, handler);
    for (let i = 0; i < 200; i++) await store.schedule({ queue, name: 't', jobId: `j${i}`, data: { i }, dueAt: clock.now() });
    clock.advanceSeconds(1);
    const [ra, rb] = await Promise.all([a.sweep(), b.sweep()]);
    expect(ra.fired + rb.fired).toBe(200);
    expect(ra.fired).toBeGreaterThan(0);
    expect(rb.fired).toBeGreaterThan(0);
    expect(counts.size).toBe(200);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    expect((await rows(queue)).every((r) => r.status === 'fired')).toBe(true);
    await other.onModuleDestroy();
  });

  it('retries with backoff, fails for good after max attempts, and reports it in the stats', async () => {
    const clock = new FakeClock(new Date());
    const queue = q('fail');
    const sweeper = new TimerSweeper(store, clock, 'worker', OPTS);
    (sweeper as unknown as { logger: { warn: () => void; error: () => void } }).logger.warn = () => undefined;
    (sweeper as unknown as { logger: { warn: () => void; error: () => void } }).logger.error = () => undefined;
    sweeper.register(queue, async () => {
      throw new Error('kitchen row locked');
    });
    await store.schedule({ queue, name: 't', jobId: 'f', data: null, dueAt: clock.now(), maxAttempts: 2 });
    expect(await sweeper.sweep()).toMatchObject({ retried: 1 });
    expect((await rows(queue))[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'kitchen row locked' });
    clock.advanceSeconds(5);
    expect(await sweeper.sweep()).toMatchObject({ failed: 1 });
    expect((await rows(queue))[0]).toMatchObject({ status: 'failed', attempts: 2 });
    expect((await store.stats(clock.now())).failed).toBeGreaterThanOrEqual(1);
  });

  it('measures how late the oldest due timer is', async () => {
    const clock = new FakeClock(new Date());
    const queue = q('stats');
    await store.schedule({ queue, name: 't', jobId: 's', data: null, dueAt: clock.now() });
    clock.advanceSeconds(42);
    const stats = await store.stats(clock.now());
    expect(stats.overdue).toBeGreaterThanOrEqual(1);
    expect(stats.oldestOverdueMs).toBeGreaterThanOrEqual(42_000);
  });
});
