import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BullMqQueueFactory } from './queue.js';

const url = process.env['REDIS_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A TCP hop in front of Redis that can drop every connection and accept-and-close new ones (a Redis restart, seen from the client). */
async function blipProxy(target: URL) {
  let up = true;
  const open = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (!up) return void client.destroy();
    const redis = net.connect(Number(target.port || 6379), target.hostname);
    for (const s of [client, redis]) open.add(s);
    const end = () => {
      for (const s of [client, redis]) {
        s.destroy();
        open.delete(s);
      }
    };
    client.pipe(redis).pipe(client);
    for (const s of [client, redis]) s.on('error', end).on('close', end);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const auth = target.username || target.password ? `${target.username}:${target.password}@` : '';
  return {
    url: `redis://${auth}127.0.0.1:${(server.address() as net.AddressInfo).port}${target.pathname}`,
    down: () => {
      up = false;
      for (const s of open) s.destroy();
    },
    up: () => (up = true),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

describe.skipIf(!url)('BullMQ queues on a real Redis (needs REDIS_URL)', () => {
  const prefix = `test-queue-${Date.now()}`;
  const factories: BullMqQueueFactory[] = [];
  const children: ChildProcess[] = [];
  const redis = url ? new Redis(url, { maxRetriesPerRequest: null }) : null;
  const make = (role: 'web' | 'worker', at = url) => {
    const f = new BullMqQueueFactory(at, prefix, role);
    factories.push(f);
    return f;
  };

  afterAll(async () => {
    for (const c of children) c.kill('SIGKILL');
    for (const f of factories) await f.onModuleDestroy();
    if (redis) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.del(...keys);
      redis.disconnect();
    }
  });

  it('a worker under load rides out a Redis restart: its event loop stays free and a job due after it still runs', async () => {
    const proxy = await blipProxy(new URL(url!));
    const blipPrefix = `${prefix}-blip`;
    const child = spawn(process.execPath, ['--import', '@swc-node/register/esm-register', join(here, 'queue-blip.child.ts')], {
      cwd: join(here, '../..'),
      env: { ...process.env, REDIS_URL: proxy.url, BLIP_PREFIX: blipPrefix, BLIP_QUEUES: '4' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    children.push(child);
    let lastBeat = 0;
    let longestGap = 0;
    const ran = new Set<string>();
    let buf = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        if (line === 'beat') {
          const now = Date.now();
          if (lastBeat) longestGap = Math.max(longestGap, now - lastBeat);
          lastBeat = now;
        } else if (line.startsWith('ran ')) ran.add(line.slice(4));
      }
    });
    const producer = new BullMqQueueFactory(url, blipPrefix, 'web');
    factories.push(producer);
    const queues = [0, 1, 2, 3].map((k) => producer.queue<{ n: number }>(`busy${k}`));
    let n = 0;
    const load = setInterval(() => {
      for (let k = 0; k < 8; k++) {
        n += 1;
        void queues[n % 4]!.add('busy', { n }, { jobId: `busy.${n}`, delayMs: (n % 3) * 300 }).catch(() => undefined);
      }
    }, 50);
    try {
      const deadline = Date.now() + 30_000;
      while (ran.size < 20 && Date.now() < deadline) await sleep(100);
      expect(ran.size).toBeGreaterThanOrEqual(20);

      proxy.down();
      await queues[0]!.add('after', { n: 0 }, { jobId: 'after.1', delayMs: 8_000 });
      await sleep(6_000);
      proxy.up();

      const until = Date.now() + 20_000;
      while (!ran.has('after.1') && Date.now() < until) await sleep(100);
      expect(ran.has('after.1')).toBe(true);
      expect(Date.now() - lastBeat).toBeLessThan(1_000);
      expect(longestGap).toBeLessThan(2_000);
    } finally {
      clearInterval(load);
      child.kill('SIGKILL');
      await proxy.close();
    }
  });

  it('a job that throws runs 3 times by default, then is logged as an error with its queue, name and id', async () => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warns = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const f = make('worker');
      let runs = 0;
      const q = f.queue<{ orderId: string }>('failing');
      q.process(async () => {
        runs += 1;
        throw new Error('simulated DB timeout');
      });
      await q.add('autoReject', { orderId: 'ord_1' }, { jobId: 'order.ord_1.autoReject', backoffMs: 50 });
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !errors.mock.calls.some((c) => String(c[0]).includes('order.ord_1.autoReject'))) await sleep(50);
      expect(runs).toBe(3);
      const line = errors.mock.calls.map((c) => String(c[0])).find((m) => m.includes('order.ord_1.autoReject'));
      expect(line).toBe('job failing/autoReject (order.ord_1.autoReject) failed after 3 attempt(s): simulated DB timeout');
      expect(warns.mock.calls.filter((c) => String(c[0]).includes('retrying'))).toHaveLength(2);
    } finally {
      errors.mockRestore();
      warns.mockRestore();
    }
  });

  it('reports how late the oldest due job is on the queues this process works', async () => {
    const f = make('worker');
    const q = f.queue<{ n: number }>('stuck');
    let release = () => undefined as void;
    // The first job holds the worker, so the next one waits.
    q.process((job) => (job.name === 'hold' ? new Promise<void>((r) => (release = r)) : Promise.resolve()));
    await q.add('hold', { n: 1 }, { jobId: 'stuck.1' });
    await q.add('wait', { n: 2 }, { jobId: 'stuck.2' });
    await sleep(300);
    try {
      expect(await f.oldestOverdueJobMs(Date.now() + 600_000)).toBeGreaterThanOrEqual(599_000);
      expect(await make('web').oldestOverdueJobMs()).toBe(0); // a web process works no queue
    } finally {
      release();
    }
  });

  it('health reads Redis as unavailable when it is full (a write fails) although PING still answers', async () => {
    const f = make('web');
    expect(await f.status()).toBe('ok');
    const [, max] = (await redis!.config('GET', 'maxmemory')) as [string, string];
    const [, policy] = (await redis!.config('GET', 'maxmemory-policy')) as [string, string];
    try {
      await redis!.config('SET', 'maxmemory-policy', 'noeviction');
      await redis!.config('SET', 'maxmemory', '1');
      expect(await redis!.ping()).toBe('PONG');
      expect(await f.status()).toBe('unavailable');
    } finally {
      await redis!.config('SET', 'maxmemory', max);
      await redis!.config('SET', 'maxmemory-policy', policy);
    }
    expect(await f.status()).toBe('ok');
  });
});
