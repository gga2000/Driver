import { afterAll, describe, expect, it } from 'vitest';
import { Queue as BullQueue } from 'bullmq';
import { Redis } from 'ioredis';
import { BullMqQueueFactory } from '../../shared/queue.js';
import { NIGHTLY_QUEUE } from './nightly.job.js';
import { ledgerHarness } from './test-harness.js';

const url = process.env['REDIS_URL'];

/**
 * The 02:00 close on real BullMQ. Before the fix the job id was `ledger-nightly:<day>` and BullMQ
 * refused it ("Custom Id cannot contain :"); the module caught the error and logged a warning, so
 * the close was silently never scheduled.
 */
describe.skipIf(!url)('nightly close on BullMQ (needs REDIS_URL)', () => {
  const prefix = `test-nightly-${Date.now()}`;
  const factory = new BullMqQueueFactory(url, prefix);
  const redis = url ? new Redis(url, { maxRetriesPerRequest: null }) : null;

  afterAll(async () => {
    await factory.onModuleDestroy();
    if (redis) {
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      redis.disconnect();
    }
  });

  it('schedules tomorrow 02:00 Baghdad as a delayed job with a BullMQ-legal id', async () => {
    const h = ledgerHarness({ start: '2026-10-03T12:00:00Z' });
    const queue = factory.queue<{ day: string }>(NIGHTLY_QUEUE);
    const at = await h.nightly.schedule(queue);
    expect(at.toISOString()).toBe('2026-10-03T23:00:00.000Z');
    const bull = new BullQueue(NIGHTLY_QUEUE, { connection: redis!, prefix });
    const job = await bull.getJob('ledger-nightly.2026-10-04');
    expect(job?.data).toEqual({ day: '2026-10-04' });
    expect(await job?.isDelayed()).toBe(true);
    await bull.close();
  });
});
