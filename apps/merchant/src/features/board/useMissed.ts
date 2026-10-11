import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { storage } from '@/lib/storage';
import { CANCELLED_SEEN_KEY } from './cancelled';
import { addSeen, MISSED_SEEN_KEY, parseSeen } from './missed';

type SeenHook = () => { seen: ReadonlySet<string>; markSeen: (ids: readonly string[]) => void };

/** A per-device set of acknowledged order ids under `key` ("تمام"), kept across reloads. */
function seenStore(key: string): SeenHook {
  let seen: ReadonlySet<string> = new Set();
  let loaded = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  async function load() {
    if (loaded) return;
    loaded = true;
    const raw = await storage.getItem(key).catch(() => null);
    seen = new Set([...parseSeen(raw), ...seen]);
    emit();
  }
  return function useSeen() {
    useEffect(() => {
      void load();
    }, []);
    const value = useSyncExternalStore(
      (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      () => seen,
      () => seen,
    );
    const markSeen = useCallback((ids: readonly string[]) => {
      const next = addSeen(seen, ids);
      seen = new Set(next);
      emit();
      void storage.setItem(key, JSON.stringify(next)).catch(() => undefined);
    }, []);
    return { seen: value, markSeen };
  };
}

/** Which missed orders this device has acknowledged ("تمام"). */
export const useMissedSeen = seenStore(MISSED_SEEN_KEY);
/** Which red «انلغى» cards this device has tapped away. */
export const useCancelledSeen = seenStore(CANCELLED_SEEN_KEY);
