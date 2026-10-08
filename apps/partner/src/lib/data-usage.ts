import { useEffect, useSyncExternalStore } from 'react';
import { storage, type KeyValueStorage } from './storage';

/**
 * How much internet the app used (partner redesign l6: «يشتغل على 3G ويبيّن كم نت صرف بالشفت»).
 * Every API call and every live-stream message adds its size here, counted in quarter-hour slots on
 * this phone, so a shift's use is the slots since he went online and the day's since midnight; photo
 * and voice uploads add their size too. It is an estimate: headers are a fixed guess per call, and the
 * pictures he sees (loaded by the image library) and the phone's other apps are not in it. Nothing is
 * sent anywhere.
 *
 * The background location task can run in its own JS context, so saving reads what is stored, adds
 * only what this context counted since its last save, and writes that back: neither overwrites the other.
 */

export const DATA_USAGE_KEY = 'driver.partner.data-usage';
/** A quarter of an hour: fine enough that a shift's first slot holds little from before it. */
export const SLOT_MS = 15 * 60_000;
/** Kept a day and a bit: today since midnight, and a long shift that crossed it. */
export const KEEP_MS = 26 * 3_600_000;
/** Request line, headers (the bearer token is most of it) and the response's headers, per call. */
export const HEADERS_BYTES = 900;

/** slot index (ms / SLOT_MS) → bytes. */
export type Slots = Map<number, number>;

/** Compact, to stay small in the phone's secure store: `slot:bytes` pairs in base 36, comma-joined. */
export function encodeSlots(slots: Slots): string {
  return [...slots]
    .filter(([, b]) => b > 0)
    .map(([s, b]) => `${s.toString(36)}:${Math.round(b).toString(36)}`)
    .join(',');
}

export function decodeSlots(v: string | null): Slots {
  const out: Slots = new Map();
  if (!v) return out;
  for (const pair of v.split(',')) {
    const [s, b] = pair.split(':');
    const slot = parseInt(s ?? '', 36);
    const bytes = parseInt(b ?? '', 36);
    if (Number.isFinite(slot) && Number.isFinite(bytes) && bytes > 0) out.set(slot, (out.get(slot) ?? 0) + bytes);
  }
  return out;
}

export function addTo(slots: Slots, bytes: number, at: number): void {
  if (!(bytes > 0)) return;
  const slot = Math.floor(at / SLOT_MS);
  slots.set(slot, (slots.get(slot) ?? 0) + bytes);
}

/** Drops slots older than KEEP_MS. */
export function prune(slots: Slots, now: number): void {
  const oldest = Math.floor((now - KEEP_MS) / SLOT_MS);
  for (const s of slots.keys()) if (s < oldest) slots.delete(s);
}

/** Bytes used from `from` until now: every slot that overlaps it (the first slot may hold a little from before). */
export function usedSince(slots: Slots, from: number): number {
  const first = Math.floor(from / SLOT_MS);
  let sum = 0;
  for (const [s, b] of slots) if (s >= first) sum += b;
  return sum;
}

/** What a call costs on the wire: its URL and body up, its body down, and the headers both ways. */
export function requestBytes(url: string, body: unknown, responseBytes: number): number {
  const up = typeof body === 'string' ? body.length : 0;
  return HEADERS_BYTES + url.length + up + Math.max(0, responseBytes);
}

// ── the counter on this phone ──

let saved: Slots = new Map();
/** Counted in this JS context and not yet saved. */
let pending: Slots = new Map();
let loaded = false;
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let backing: KeyValueStorage = storage;
let version = 0;
const listeners = new Set<() => void>();
const SAVE_AFTER_MS = 20_000;

function emit() {
  version += 1;
  for (const l of listeners) l();
}

function load(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= backing
    .getItem(DATA_USAGE_KEY)
    .catch(() => null)
    .then((v) => {
      saved = decodeSlots(v);
      loaded = true;
      emit();
    });
  return loading;
}

/** Saves what this context counted onto what is stored now (another context may have saved meanwhile). */
export async function flushDataUsage(now: number = Date.now()): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (pending.size === 0) return;
  const adding = pending;
  pending = new Map();
  const stored = decodeSlots(await backing.getItem(DATA_USAGE_KEY).catch(() => null));
  for (const [s, b] of adding) stored.set(s, (stored.get(s) ?? 0) + b);
  prune(stored, now);
  saved = stored;
  loaded = true;
  await backing.setItem(DATA_USAGE_KEY, encodeSlots(stored)).catch(() => undefined);
  emit();
}

/** Adds bytes the app just sent or received. Cheap: saved together every few seconds. */
export function countData(bytes: number, now: number = Date.now()): void {
  if (!(bytes > 0)) return;
  addTo(pending, bytes, now);
  timer ??= setTimeout(() => void flushDataUsage(), SAVE_AFTER_MS);
}

/** Bytes per hour from `from` until `now`, oldest first, at most `max` hours (the latest ones). */
export function hourlyFrom(slots: Slots, from: number, now: number, max = 12): number[] {
  const hours = Math.max(1, Math.ceil((now - from) / 3_600_000));
  const out = new Array<number>(hours).fill(0);
  const first = Math.floor(from / SLOT_MS);
  for (const [s, b] of slots) {
    if (s < first) continue;
    const i = Math.min(hours - 1, Math.floor((s * SLOT_MS - first * SLOT_MS) / 3_600_000));
    out[i] = (out[i] ?? 0) + b;
  }
  return out.slice(-max);
}

/** Per hour since `from` (ms), saved and not yet saved, for the card's little bars. */
export function dataHourlySince(from: number, now: number = Date.now(), max = 12): number[] {
  const a = hourlyFrom(saved, from, now, max);
  const b = hourlyFrom(pending, from, now, max);
  return a.map((x, i) => x + (b[i] ?? 0));
}

/** Bytes used since `from` (ms), saved and not yet saved. */
export function dataUsedSince(from: number): number {
  return usedSince(saved, from) + usedSince(pending, from);
}

/** Tests: a fresh counter on its own storage. */
export function resetDataUsageForTests(store: KeyValueStorage): void {
  if (timer) clearTimeout(timer);
  timer = null;
  saved = new Map();
  pending = new Map();
  loaded = false;
  loading = null;
  backing = store;
  version = 0;
}

/**
 * Bytes used since `from` (null until read), refreshed while the screen is open: it re-reads every
 * half minute so a shift's number keeps up without re-rendering on every call.
 */
export function useDataUsedSince(from: Date | null): number | null {
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
  useEffect(() => {
    void load();
    const id = setInterval(emit, 30_000);
    return () => clearInterval(id);
  }, []);
  void v;
  if (!loaded || !from) return null;
  return dataUsedSince(from.getTime());
}

// ── counting the app's traffic ──

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as { url?: string }).url ?? '';
}

/** Wraps a fetch so each call is counted (the response's length, or its text when it has none). */
export function countingFetch(inner: FetchFn): FetchFn {
  return async (input, init) => {
    const url = urlOf(input);
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (err) {
      // Failed on the way: the request may still have gone out.
      countData(requestBytes(url, init?.body, 0));
      throw err;
    }
    const header = res.headers?.get?.('content-length');
    const length = header ? Number(header) : NaN;
    if (Number.isFinite(length) && length >= 0) countData(requestBytes(url, init?.body, length));
    else
      void res
        .clone()
        .text()
        .then(
          (text) => countData(requestBytes(url, init?.body, text.length)),
          () => countData(requestBytes(url, init?.body, 0)),
        );
    return res;
  };
}

interface EventSourceLike {
  addEventListener(type: string, listener: (e: { data?: unknown }) => void): void;
}
type EventSourceCtor = new (url: string, init?: { withCredentials?: boolean }) => EventSourceLike;

/** SSE frame overhead on top of each message's data (`event:`, `data:`, `id:` lines). */
const SSE_FRAME_BYTES = 40;

/** An EventSource that counts its connect and every message and keep-alive it receives. */
export function countingEventSource<T extends EventSourceCtor>(Inner: T): T {
  const Counted = class extends (Inner as EventSourceCtor) {
    constructor(url: string, init?: { withCredentials?: boolean }) {
      super(url, init);
      countData(HEADERS_BYTES + url.length);
      const add = (e: { data?: unknown }) => countData(SSE_FRAME_BYTES + (typeof e.data === 'string' ? e.data.length : 0));
      for (const type of ['message', 'ping', 'connected']) this.addEventListener(type, add);
    }
  };
  return Counted as unknown as T;
}

/** «حوالي 3.4 ميغا»: tenths of a megabyte, never below 0.1. */
export function megabytes(bytes: number): number {
  return Math.max(0.1, Math.round(bytes / 100_000) / 10);
}

/** A shift this long or longer says how far a 1 GB pack goes (a short one would promise too much). */
const PACK_AFTER_MS = 60 * 60_000;

/** How many shifts like this one a 1 GB pack covers, or null when the shift is too short to say. */
export function packsFor(bytes: number, shiftMs: number): number | null {
  if (shiftMs < PACK_AFTER_MS || bytes < 100_000) return null;
  return Math.max(1, Math.floor(1_000_000_000 / bytes));
}
