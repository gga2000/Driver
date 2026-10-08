import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addTo,
  countData,
  countingEventSource,
  countingFetch,
  DATA_USAGE_KEY,
  dataUsedSince,
  decodeSlots,
  encodeSlots,
  hourlyFrom,
  flushDataUsage,
  HEADERS_BYTES,
  KEEP_MS,
  megabytes,
  packsFor,
  prune,
  resetDataUsageForTests,
  SLOT_MS,
  usedSince,
  type Slots,
} from './data-usage';
import { createMemoryStorage } from './storage';

const T0 = Date.UTC(2026, 9, 8, 6, 0);

afterEach(() => vi.useRealTimers());

describe('slots', () => {
  it('round-trips compactly and drops empty slots', () => {
    const slots: Slots = new Map();
    addTo(slots, 1_234, T0);
    addTo(slots, 66, T0 + 60_000);
    addTo(slots, 5_000, T0 + SLOT_MS);
    addTo(slots, 0, T0 + 2 * SLOT_MS);
    const text = encodeSlots(slots);
    expect(decodeSlots(text)).toEqual(slots);
    expect([...decodeSlots(text).values()]).toEqual([1_300, 5_000]);
    // A day of busy slots stays well inside the secure store's ~2 KB.
    const day: Slots = new Map();
    for (let i = 0; i < KEEP_MS / SLOT_MS; i++) addTo(day, 9_999_999, T0 + i * SLOT_MS);
    expect(encodeSlots(day).length).toBeLessThan(1_400);
  });

  it('ignores garbage', () => {
    expect(decodeSlots('zz:,:1,abc:-5,ok')).toEqual(new Map());
    expect(decodeSlots(null).size).toBe(0);
  });

  it('counts from the slot the shift started in, and forgets after a day and a bit', () => {
    const slots: Slots = new Map();
    addTo(slots, 100, T0 - SLOT_MS);
    addTo(slots, 200, T0 + 5 * 60_000);
    addTo(slots, 300, T0 + 3 * SLOT_MS);
    expect(usedSince(slots, T0 + 10 * 60_000)).toBe(500);
    prune(slots, T0 + KEEP_MS + 1);
    expect(usedSince(slots, 0)).toBe(500);
  });
});

describe('the counter', () => {
  it('saves onto what another context saved meanwhile, never over it', async () => {
    const store = createMemoryStorage();
    resetDataUsageForTests(store);
    countData(1_000, T0);
    // The background task saved its own count while this one was waiting.
    await store.setItem(DATA_USAGE_KEY, encodeSlots(new Map([[Math.floor(T0 / SLOT_MS), 500]])));
    expect(dataUsedSince(T0)).toBe(1_000);
    await flushDataUsage(T0);
    expect(decodeSlots(await store.getItem(DATA_USAGE_KEY)).get(Math.floor(T0 / SLOT_MS))).toBe(1_500);
    expect(dataUsedSince(T0)).toBe(1_500);
    // Nothing new: saving again adds nothing.
    await flushDataUsage(T0);
    expect(dataUsedSince(T0)).toBe(1_500);
  });

  it('counts a call by its length, or by its text when it has none', async () => {
    resetDataUsageForTests(createMemoryStorage());
    const withLength = countingFetch(async () => new Response('x'.repeat(10), { headers: { 'content-length': '4000' } }));
    await withLength('https://api/trpc/a', { method: 'POST', body: '{"a":1}' });
    expect(dataUsedSince(0)).toBe(HEADERS_BYTES + 'https://api/trpc/a'.length + 7 + 4000);
    const chunked = countingFetch(async () => new Response('y'.repeat(250)));
    const res = await chunked('https://api/b');
    expect(await res.text()).toHaveLength(250);
    await vi.waitFor(() => expect(dataUsedSince(0)).toBe(HEADERS_BYTES * 2 + 18 + 7 + 4000 + 13 + 250));
  });

  it('counts a failed call that may have gone out, and still throws', async () => {
    resetDataUsageForTests(createMemoryStorage());
    const failing = countingFetch(async () => {
      throw new Error('network');
    });
    await expect(failing('u')).rejects.toThrow('network');
    expect(dataUsedSince(0)).toBe(HEADERS_BYTES + 1);
  });

  it('counts a live stream: its connect and each message and keep-alive', () => {
    resetDataUsageForTests(createMemoryStorage());
    class Fake {
      listeners = new Map<string, ((e: { data?: unknown }) => void)[]>();
      constructor(readonly url: string) {}
      addEventListener(type: string, l: (e: { data?: unknown }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
      }
      fire(type: string, data?: string) {
        for (const l of this.listeners.get(type) ?? []) l({ data });
      }
    }
    const Counted = countingEventSource(Fake);
    const es = new Counted('https://api/live');
    expect(es).toBeInstanceOf(Fake);
    const connect = HEADERS_BYTES + 'https://api/live'.length;
    expect(dataUsedSince(0)).toBe(connect);
    es.fire('message', '{"x":1}');
    es.fire('ping');
    es.fire('open');
    expect(dataUsedSince(0)).toBe(connect + 40 + 7 + 40);
  });
});

describe('what he reads', () => {
  it('says megabytes to a tenth, never 0', () => {
    expect(megabytes(0)).toBe(0.1);
    expect(megabytes(3_420_000)).toBe(3.4);
  });

  it('says how far a 1 GB pack goes only after an hour online', () => {
    expect(packsFor(20_000_000, 30 * 60_000)).toBeNull();
    expect(packsFor(20_000_000, 8 * 3_600_000)).toBe(50);
    expect(packsFor(50_000, 8 * 3_600_000)).toBeNull();
  });
});

describe('the bars', () => {
  it('splits a shift into hours, oldest first, keeping the latest ones', () => {
    const slots: Slots = new Map();
    addTo(slots, 100, T0 + 10 * 60_000);
    addTo(slots, 200, T0 + 50 * 60_000);
    addTo(slots, 300, T0 + 2 * 3_600_000 + 1);
    addTo(slots, 999, T0 - SLOT_MS);
    expect(hourlyFrom(slots, T0, T0 + 2.5 * 3_600_000)).toEqual([300, 0, 300]);
    expect(hourlyFrom(slots, T0, T0 + 2.5 * 3_600_000, 2)).toEqual([0, 300]);
    expect(hourlyFrom(slots, T0, T0 + 60_000)).toEqual([300 + 300]);
  });
});
