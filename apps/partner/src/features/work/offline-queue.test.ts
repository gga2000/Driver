import { describe, expect, it, vi } from 'vitest';
import type { PartnerJob } from '@driver/contracts';
import { isNetworkError } from '@driver/contracts/net-client';
import { applyQueued, createActionQueue, MAX_QUEUED, stampTap, toInput, type QueuedAction, type QueueStore } from './offline-queue';

const netDown = () => Object.assign(new TypeError('Failed to fetch'), {});
const refused = (code = 'stop_state_conflict') => ({ message: code, data: { httpStatus: 409, code } });

function memoryStore(initial: string | null = null): QueueStore & { value: string | null } {
  const s = {
    value: initial,
    load: async () => s.value,
    save: async (v: string | null) => {
      s.value = v;
    },
  };
  return s;
}

let clockNow = Date.UTC(2026, 9, 4, 9, 0, 0);
const clock = { now: () => clockNow, uptime: () => 12_345.6 };
const tap = (kind: 'arrive' | 'complete', stopId: string, tripId = 'trip_1') =>
  stampTap(kind === 'arrive' ? { kind, tripId, stopId } : { kind, tripId, stopId, handover: { cashCollectedIqd: 12_500, recipientConfirmed: true } }, clock);

describe('stamps', () => {
  it('carry the device time of the tap, monotonic uptime and a unique key', () => {
    const a = tap('arrive', 's1');
    clockNow += 60_000;
    const b = tap('arrive', 's1');
    expect(a.occurredAt).toBe('2026-10-04T09:00:00.000Z');
    expect(a.deviceUptimeMs).toBe(12_346);
    expect(a.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    // The replay input revives the tap's own time, not the replay's.
    const input = toInput(a);
    expect(input.occurredAt).toEqual(new Date('2026-10-04T09:00:00.000Z'));
    expect(input).toMatchObject({ tripId: 'trip_1', stopId: 's1', deviceUptimeMs: 12_346, idempotencyKey: a.idempotencyKey });
  });
});

describe('offline queue', () => {
  it('replays strictly in tap order, one at a time', async () => {
    const order: string[] = [];
    let active = 0;
    const sender = {
      send: vi.fn(async (a: QueuedAction) => {
        active += 1;
        expect(active).toBe(1);
        await new Promise((r) => setTimeout(r, 1));
        order.push(`${a.kind}:${a.stopId}`);
        active -= 1;
      }),
    };
    const store = memoryStore();
    const q = createActionQueue({ store, sender, isNetworkError });
    for (const a of [tap('arrive', 'pickup'), tap('complete', 'pickup'), tap('arrive', 'dropoff'), tap('complete', 'dropoff')]) await q.enqueue(a);
    const [r1, r2] = await Promise.all([q.flush(), q.flush()]);
    expect(r1).toBe(r2); // single-flight
    expect(order).toEqual(['arrive:pickup', 'complete:pickup', 'arrive:dropoff', 'complete:dropoff']);
    expect(q.items()).toEqual([]);
    expect(store.value).toBeNull();
  });

  it('stops at the first network failure and keeps that tap and the rest, in order', async () => {
    let down = false;
    const sender = {
      send: vi.fn(async (a: QueuedAction) => {
        if (a.kind === 'complete') down = true;
        if (down) throw netDown();
      }),
    };
    const q = createActionQueue({ store: memoryStore(), sender, isNetworkError });
    const taps = [tap('arrive', 's1'), tap('complete', 's1'), tap('arrive', 's2')];
    for (const a of taps) await q.enqueue(a);
    const res = await q.flush();
    expect(res.stalled).toBe(true);
    expect(res.sent.map((a) => a.idempotencyKey)).toEqual([taps[0]!.idempotencyKey]);
    expect(q.items().map((a) => a.idempotencyKey)).toEqual([taps[1]!.idempotencyKey, taps[2]!.idempotencyKey]);
    // Back online: the same taps go, same keys and device times.
    down = false;
    sender.send.mockImplementation(async () => undefined);
    await q.flush();
    expect(sender.send.mock.calls.slice(-2).map(([a]) => a.idempotencyKey)).toEqual([taps[1]!.idempotencyKey, taps[2]!.idempotencyKey]);
    expect(sender.send.mock.calls.slice(-2).map(([a]) => a.occurredAt)).toEqual([taps[1]!.occurredAt, taps[2]!.occurredAt]);
  });

  it('a refused tap is dropped with the later taps of the same stop; the rest still goes', async () => {
    const sender = {
      send: vi.fn(async (a: QueuedAction) => {
        if (a.stopId === 's1' && a.kind === 'arrive') throw refused();
      }),
    };
    const q = createActionQueue({ store: memoryStore(), sender, isNetworkError });
    for (const a of [tap('arrive', 's1'), tap('complete', 's1'), tap('arrive', 's2')]) await q.enqueue(a);
    const res = await q.flush();
    expect(res.rejected.map((r) => `${r.action.kind}:${r.action.stopId}`)).toEqual(['arrive:s1', 'complete:s1']);
    expect(res.sent.map((a) => `${a.kind}:${a.stopId}`)).toEqual(['arrive:s2']);
    expect(q.items()).toEqual([]);
  });

  it('survives a restart: persisted, hydrated in order, duplicates ignored', async () => {
    const store = memoryStore();
    const sender = { send: vi.fn(async () => undefined) };
    const first = createActionQueue({ store, sender, isNetworkError });
    const a = tap('arrive', 's1');
    const b = tap('complete', 's1');
    await first.enqueue(a);
    await first.enqueue(b);
    await first.enqueue(a);
    const second = createActionQueue({ store, sender, isNetworkError });
    await second.hydrate();
    expect(second.items().map((x) => x.idempotencyKey)).toEqual([a.idempotencyKey, b.idempotencyKey]);
    // A corrupt store is reset, never a crash.
    const broken = memoryStore('{nope');
    const third = createActionQueue({ store: broken, sender, isNetworkError });
    await third.hydrate();
    expect(third.items()).toEqual([]);
    expect(broken.value).toBeNull();
  });

  it('caps the backlog', async () => {
    const q = createActionQueue({ store: memoryStore(), sender: { send: async () => undefined }, isNetworkError });
    for (let i = 0; i < MAX_QUEUED + 5; i++) await q.enqueue(tap('arrive', `s${i}`));
    expect(q.items()).toHaveLength(MAX_QUEUED);
  });
});

describe('the job with waiting taps applied', () => {
  const job: PartnerJob = {
    tripId: 'trip_1',
    vertical: 'food',
    state: 'accepted',
    acceptedAt: new Date(),
    currentStopId: 'p1',
    unreachable: null,
    merchant: null,
    pay: { totalIqd: 3_000 } as PartnerJob['pay'],
    stops: [
      { stopId: 'p1', seq: 1, type: 'pickup', state: 'pending', zoneId: 'centre', pin: null, label: 'مطعم خالد', orderId: 'o1', note: null, collectIqd: 0, arrivedAt: null, completedAt: null },
      { stopId: 'd1', seq: 2, type: 'dropoff', state: 'pending', zoneId: 'street_30', pin: null, label: null, orderId: 'o1', note: null, collectIqd: 12_500, arrivedAt: null, completedAt: null },
    ],
  };

  it('moves the task forward locally and marks the saved stops', () => {
    const { job: view, saved, allDone } = applyQueued(job, [tap('arrive', 'p1'), tap('complete', 'p1'), tap('arrive', 'd1')]);
    expect(view.stops.map((s) => s.state)).toEqual(['completed', 'arrived']);
    expect(view.currentStopId).toBe('d1');
    expect([...saved]).toEqual(['p1', 'd1']);
    expect(allDone).toBe(false);
  });

  it('all stops saved → done; other trips and stale taps are ignored', () => {
    const done = applyQueued(job, [tap('arrive', 'p1'), tap('complete', 'p1'), tap('arrive', 'd1'), tap('complete', 'd1')]);
    expect(done.allDone).toBe(true);
    expect(done.job.currentStopId).toBeNull();
    const other = applyQueued(job, [tap('arrive', 'p1', 'trip_2')]);
    expect(other.job).toBe(job);
    const serverAhead = applyQueued({ ...job, stops: job.stops.map((s, i) => (i === 0 ? { ...s, state: 'completed' as const } : s)), currentStopId: 'd1' }, [tap('arrive', 'p1')]);
    expect(serverAhead.saved.size).toBe(0);
  });
});
