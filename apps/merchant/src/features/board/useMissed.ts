import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { storage } from '@/lib/storage';
import { addSeen, MISSED_SEEN_KEY, parseSeen } from './missed';

/** Which missed orders this device has acknowledged ("تمام"), kept across reloads. */
let seen: ReadonlySet<string> = new Set();
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

async function load() {
  if (loaded) return;
  loaded = true;
  const raw = await storage.getItem(MISSED_SEEN_KEY).catch(() => null);
  seen = new Set([...parseSeen(raw), ...seen]);
  emit();
}

export function useMissedSeen(): { seen: ReadonlySet<string>; markSeen: (ids: readonly string[]) => void } {
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
    void storage.setItem(MISSED_SEEN_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);
  return { seen: value, markSeen };
}
