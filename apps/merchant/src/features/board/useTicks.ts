import { useCallback, useSyncExternalStore } from 'react';
import { tickKey } from './logic';

/**
 * Dish lines the kitchen ticked off on a cooking ticket (o10): «×4 تكة» struck through once it's on
 * the plate, so two cooks don't make it twice. Kept on this tablet for the life of the app — it is a
 * kitchen note, not an order state, and nothing on the server changes.
 */
let ticked: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTicks(): { ticked: ReadonlySet<string>; toggle: (orderId: string, lineId: string) => void } {
  const value = useSyncExternalStore(subscribe, () => ticked, () => ticked);
  const toggle = useCallback((orderId: string, lineId: string) => {
    const key = tickKey(orderId, lineId);
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    ticked = next;
    for (const l of listeners) l();
  }, []);
  return { ticked: value, toggle };
}
