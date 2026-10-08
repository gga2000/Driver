import { useSyncExternalStore } from 'react';
import type { BoardOrder } from '@driver/contracts';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * Offline «صار جاهز» (counter step 6, y6): a tap with no net is kept on this device and sent the
 * moment the net is back; the card moves to «جاهز» at once with «ينبعث أول ما يرجع النت». Accept and
 * reject still need the net (the customer and the money hang on them). Kept in storage, so a tablet
 * that restarts while offline still sends it.
 */

export interface QueuedReady {
  orderId: string;
  at: number;
}

const KEY = 'driver.merchant.ready-queue';

export function parseQueue(raw: string | null): QueuedReady[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is QueuedReady => typeof x?.orderId === 'string' && typeof x?.at === 'number') : [];
  } catch {
    return [];
  }
}

/** The board as the kitchen sees it: a cooking order marked ready offline already reads as ready. */
export function withQueuedReady(orders: readonly BoardOrder[], queue: readonly QueuedReady[]): BoardOrder[] {
  if (queue.length === 0) return orders as BoardOrder[];
  const at = new Map(queue.map((q) => [q.orderId, q.at]));
  return orders.map((o) => {
    const t = at.get(o.id);
    return t !== undefined && o.column === 'preparing' ? { ...o, column: 'ready', state: 'ready', readyAt: new Date(t), late: false } : o;
  });
}

/**
 * What to do with a queued tap after trying to send it: drop it once the server answered (sent, or
 * refused because the order moved on: cancelled, already ready), keep it while there's no answer.
 */
export function keepAfterSend(err: unknown): boolean {
  if (err === null) return false;
  const status = (err as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
  return status === undefined || status >= 500;
}

export function createReadyQueue(store: KeyValueStorage) {
  let queue: QueuedReady[] = [];
  let loaded: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const save = (next: QueuedReady[]) => {
    queue = next;
    for (const l of listeners) l();
    void store.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };
  const remove = (orderId: string) => {
    if (queue.some((q) => q.orderId === orderId)) save(queue.filter((q) => q.orderId !== orderId));
  };
  return {
    load(): Promise<void> {
      loaded ??= store
        .getItem(KEY)
        .then((raw) => {
          const stored = parseQueue(raw);
          if (stored.length > 0) save([...stored, ...queue.filter((q) => !stored.some((s) => s.orderId === q.orderId))]);
        })
        .catch(() => {});
      return loaded;
    },
    add(orderId: string, now = Date.now()) {
      if (queue.some((q) => q.orderId === orderId)) return;
      save([...queue, { orderId, at: now }]);
    },
    remove,
    /** Sends every kept tap, one at a time; the ones with no answer stay for the next try. */
    async flush(send: (orderId: string) => Promise<unknown>): Promise<number> {
      let sent = 0;
      for (const q of [...queue]) {
        let err: unknown = null;
        try {
          await send(q.orderId);
          sent += 1;
        } catch (e) {
          err = e ?? new Error('failed');
        }
        if (!keepAfterSend(err)) remove(q.orderId);
        else break;
      }
      return sent;
    },
    snapshot: () => queue,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export const readyQueue = createReadyQueue(platformStorage);

export function useReadyQueue(): readonly QueuedReady[] {
  return useSyncExternalStore(readyQueue.subscribe, readyQueue.snapshot, readyQueue.snapshot);
}
