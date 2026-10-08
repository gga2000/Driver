import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { BullMqQueueFactory } from './queue.js';

const url = process.env['REDIS_URL'];

/**
 * DRIVER_ROLE on real BullMQ: a `web` process enqueues but never runs a job; a `worker` process
 * sharing the same Redis runs it. This is what lets the launch layout put jobs on their own machine.
 */
describe.skipIf(!url)('web and worker processes on BullMQ (needs REDIS_URL)', () => {
  const prefix = `test-role-${Date.now()}`;
  const web = new BullMqQueueFactory(url, prefix, 'web');
  const worker = new BullMqQueueFactory(url, prefix, 'worker');
  const redis = url ? new Redis(url, { maxRetriesPerRequest: null }) : null;

  afterAll(async () => {
    await web.onModuleDestroy();
    await worker.onModuleDestroy();
    if (redis) {
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      redis.disconnect();
    }
  });

  it('runs a job queued by the web process on the worker process only', async () => {
    const ranOn: string[] = [];
    web.queue<{ n: number }>('roles').process(async () => {
      ranOn.push('web');
    });
    let done: () => void = () => undefined;
    const ran = new Promise<void>((resolve) => {
      done = resolve;
    });
    worker.queue<{ n: number }>('roles').process(async (job) => {
      ranOn.push(`worker:${job.data.n}`);
      done();
    });
    await web.queue<{ n: number }>('roles').add('tick', { n: 7 });
    await ran;
    // Give a (wrongly attached) web worker the chance to grab a second job too.
    await web.queue<{ n: number }>('roles').add('tick', { n: 8 });
    await new Promise((r) => setTimeout(r, 500));
    expect(ranOn.filter((r) => r === 'web')).toEqual([]);
    expect(ranOn).toContain('worker:7');
  });
});
