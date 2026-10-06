import { useEffect, useSyncExternalStore } from 'react';
import { session } from '@/lib/session';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * «عزيمة» (joy g1): who a gift order goes to, kept on this phone only — the name and number the
 * sender typed and his card line never go to the server. The kitchen screen and the live order
 * screen read it to send the heads-up on WhatsApp or SMS. The latest `GIFT_KEEP` gifts are kept.
 */
export interface GiftRecord {
  name: string;
  /** E.164, as checkout normalised it. */
  phone: string;
  card: string | null;
  /** I paid from my wallet («عازمك»); false = they pay cash at the door. */
  paidByMe: boolean;
}

export const GIFT_KEEP = 10;
const KEY = 'driver.gifts';

type Entry = GiftRecord & { orderId: string };

function isEntry(x: unknown): x is Entry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e['orderId'] === 'string' && typeof e['name'] === 'string' && typeof e['phone'] === 'string' && (e['card'] === null || typeof e['card'] === 'string') && typeof e['paidByMe'] === 'boolean';
}

export function createGiftStore(store: KeyValueStorage) {
  let entries: readonly Entry[] = [];
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: readonly Entry[]) => {
    entries = next;
    for (const l of listeners) l();
    // A failed write only means the heads-up button is gone after a restart.
    void store.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  };
  return {
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot: () => entries,
    load(): Promise<void> {
      loading ??= (async () => {
        try {
          const raw = await store.getItem(KEY);
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          entries = Array.isArray(parsed) ? parsed.filter(isEntry).slice(-GIFT_KEEP) : [];
        } catch {
          entries = [];
        }
        for (const l of listeners) l();
      })();
      return loading;
    },
    remember(orderId: string, gift: GiftRecord) {
      emit([...entries.filter((e) => e.orderId !== orderId), { orderId, ...gift }].slice(-GIFT_KEEP));
    },
    get(orderId: string): GiftRecord | null {
      const e = entries.find((x) => x.orderId === orderId);
      if (!e) return null;
      const { orderId: _id, ...gift } = e;
      void _id;
      return gift;
    },
    reset() {
      emit([]);
    },
  };
}

export const giftStore = createGiftStore(platformStorage);
session.onSignOut(() => giftStore.reset());

/** The gift record of an order on this phone (null when it isn't one I sent from here). */
export function useGift(orderId: string | null | undefined): GiftRecord | null {
  useEffect(() => {
    void giftStore.load();
  }, []);
  const all = useSyncExternalStore(giftStore.subscribe, giftStore.getSnapshot, giftStore.getSnapshot);
  if (!orderId) return null;
  const e = all.find((x) => x.orderId === orderId);
  return e ? { name: e.name, phone: e.phone, card: e.card, paidByMe: e.paidByMe } : null;
}
