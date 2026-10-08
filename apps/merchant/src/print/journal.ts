import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';
import type { LineSnap } from './kitchen';

/**
 * What this device has printed (print redesign i13, i14): per order, how many kitchen tickets, when
 * the first one came out, and the dishes it showed — so a second press of «اطبع» says «نسخة ثانية»
 * and a later change prints only what changed. Device-local for now: the server-side print count
 * (so every tablet agrees) is a follow-up. Small on purpose (the native key store is for small values):
 * only the most recent orders are kept.
 */
export interface PrintRecord {
  count: number;
  firstAt: number;
  lines: LineSnap[];
}

const KEY = 'driver.merchant.printlog';
export const JOURNAL_KEEP = 12;

type Packed = [string, number, number, [string, string, number, 0 | 1][]];

function pack(id: string, r: PrintRecord): Packed {
  return [id, r.count, r.firstAt, r.lines.map((l) => [l.id, l.name.slice(0, 40), l.qty, l.on ? 1 : 0])];
}

function unpack(p: unknown): [string, PrintRecord] | null {
  if (!Array.isArray(p) || typeof p[0] !== 'string' || typeof p[1] !== 'number' || typeof p[2] !== 'number' || !Array.isArray(p[3])) return null;
  const lines: LineSnap[] = [];
  for (const l of p[3] as unknown[]) {
    if (Array.isArray(l) && typeof l[0] === 'string' && typeof l[1] === 'string' && typeof l[2] === 'number') lines.push({ id: l[0], name: l[1], qty: l[2], on: l[3] === 1 });
  }
  return [p[0], { count: p[1], firstAt: p[2], lines }];
}

export function createPrintJournal(store: KeyValueStorage) {
  const map = new Map<string, PrintRecord>();
  let loading: Promise<void> | null = null;
  const persist = () => {
    const recent = [...map.entries()].slice(-JOURNAL_KEEP);
    void store.setItem(KEY, JSON.stringify(recent.map(([id, r]) => pack(id, r)))).catch(() => {});
  };
  return {
    load(): Promise<void> {
      loading ??= (async () => {
        try {
          const raw = await store.getItem(KEY);
          const list = raw ? (JSON.parse(raw) as unknown) : [];
          if (Array.isArray(list)) for (const p of list) {
            const e = unpack(p);
            if (e && !map.has(e[0])) map.set(e[0], e[1]);
          }
        } catch {
          /* a broken log only means the next print is not marked as a copy */
        }
      })();
      return loading;
    },
    get: (orderId: string): PrintRecord | null => map.get(orderId) ?? null,
    /** A kitchen ticket came out: count it and remember what it showed. */
    printed(orderId: string, lines: LineSnap[], at: number): PrintRecord {
      const was = map.get(orderId);
      const next: PrintRecord = { count: (was?.count ?? 0) + 1, firstAt: was?.firstAt ?? at, lines };
      map.delete(orderId);
      map.set(orderId, next);
      while (map.size > JOURNAL_KEEP) map.delete(map.keys().next().value as string);
      persist();
      return next;
    },
    /** A change ticket came out: the dishes it now shows are the new baseline (not a copy). */
    changed(orderId: string, lines: LineSnap[]) {
      const was = map.get(orderId);
      if (!was) return;
      map.set(orderId, { ...was, lines });
      persist();
    },
  };
}

export type PrintJournal = ReturnType<typeof createPrintJournal>;

export const printJournal = createPrintJournal(platformStorage);
