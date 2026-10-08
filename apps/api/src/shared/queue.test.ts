import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.js';
import { BullMqQueueFactory, bullJobOptions, InMemoryQueue, InMemoryQueueFactory, jobKey } from './queue.js';

describe('InMemoryQueue', () => {
  it('runs jobs in order on drain', async () => {
    const q = new InMemoryQueue<string>('t');
    const ran: string[] = [];
    q.process(async (j) => {
      ran.push(j.data);
    });
    await q.add('a', 'one');
    await q.add('a', 'two');
    expect(q.size).toBe(2);
    expect(await q.drain()).toBe(2);
    expect(ran).toEqual(['one', 'two']);
    expect(q.size).toBe(0);
  });

  it('honours delays against the clock', async () => {
    const clock = new FakeClock();
    const q = new InMemoryQueue<string>('timers', () => clock.now());
    const ran: string[] = [];
    q.process(async (j) => {
      ran.push(j.data);
    });
    await q.add('offer.timeout', 'x', { delayMs: 15_000 });
    expect(await q.drain()).toBe(0);
    clock.advanceSeconds(14);
    expect(await q.drain()).toBe(0);
    clock.advanceSeconds(1);
    expect(await q.drain()).toBe(1);
    expect(ran).toEqual(['x']);
  });

  it('dedupes by jobId', async () => {
    const q = new InMemoryQueue<string>('t');
    await q.add('poke', 'a', { jobId: 'outbox-poke' });
    await q.add('poke', 'b', { jobId: 'outbox-poke' });
    expect(q.size).toBe(1);
  });

  it('a transient job releases its jobId when it finishes, so the same id can be enqueued again', async () => {
    const q = new InMemoryQueue<string>('outbox');
    const ran: string[] = [];
    q.process(async (j) => {
      ran.push(j.data);
    });
    await q.add('tick', 'a', { jobId: 'tick', transient: true });
    await q.add('tick', 'b', { jobId: 'tick', transient: true });
    expect(q.size).toBe(1);
    await q.drain();
    await q.add('tick', 'c', { jobId: 'tick', transient: true });
    await q.drain();
    expect(ran).toEqual(['a', 'c']);
    // non-transient ids stay taken (BullMQ keeps finished jobs)
    await q.add('timer', 'x', { jobId: 'once' });
    await q.drain();
    await q.add('timer', 'y', { jobId: 'once' });
    expect(q.size).toBe(0);
  });

  it('rejects custom ids BullMQ rejects ("Custom Id cannot contain :"), so a bad id fails in unit tests, not in production', async () => {
    const q = new InMemoryQueue<string>('t');
    await expect(q.add('nightly', 'x', { jobId: 'ledger-nightly:2026-10-04' })).rejects.toThrow('Custom Id cannot contain :');
    await expect(q.add('t', 'x', { jobId: 'order:o1:autoReject:1700000000000' })).rejects.toThrow('Custom Id cannot contain :');
    expect(q.size).toBe(0);
    await q.add('t', 'x', { jobId: jobKey('order', 'o1', 'autoReject', 1700000000000) });
    expect(q.pending().map((j) => j.id)).toEqual(['order.o1.autoReject.1700000000000']);
  });

  it('retries a failing job while attempts remain, then throws', async () => {
    const q = new InMemoryQueue<string>('t');
    let calls = 0;
    q.process(async () => {
      calls += 1;
      throw new Error('nope');
    });
    await q.add('j', 'x', { attempts: 2 });
    await expect(q.drain()).rejects.toThrow('nope');
    expect(calls).toBe(2);
  });

  it('factory returns the same queue per name and drains all', async () => {
    const f = new InMemoryQueueFactory();
    const a = f.queue<number>('a');
    expect(f.queue('a')).toBe(a);
    let sum = 0;
    a.process(async (j) => {
      sum += j.data;
    });
    f.queue<number>('b').process(async (j) => {
      sum += j.data * 10;
    });
    await a.add('n', 1);
    await f.queue<number>('b').add('n', 2);
    expect(await f.drainAll()).toBe(2);
    expect(sum).toBe(21);
  });
});

describe('BullMqQueueFactory', () => {
  it('reports unavailable without REDIS_URL and never throws', async () => {
    const f = new BullMqQueueFactory(undefined);
    expect(f.configured).toBe(false);
    expect(await f.status()).toBe('unavailable');
    expect(() => f.queue('x')).toThrow(/REDIS_URL/);
  });
});

describe('BullMQ job options (speed audit z4)', () => {
  it('keeps at most 500 failed jobs per queue, for at most a day; transient pokes keep nothing', () => {
    expect(bullJobOptions({ jobId: 'order.o1.autoReject', delayMs: 1000 })).toMatchObject({ removeOnComplete: 1000, removeOnFail: { count: 500, age: 86_400 }, attempts: 1, delay: 1000, jobId: 'order.o1.autoReject' });
    expect(bullJobOptions({ transient: true })).toMatchObject({ removeOnComplete: true, removeOnFail: true });
  });
});
