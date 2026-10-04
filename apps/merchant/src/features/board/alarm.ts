import { useEffect, useSyncExternalStore } from 'react';
import type { BoardOrder } from '@driver/contracts';
import { canPlay, onUnlock, playNewOrder } from '@/lib/alert-sound';
import { unacknowledged } from './logic';

/**
 * The new-order alarm, app-wide: it keeps ringing on any screen (menu, money…) until every new order
 * is accepted, rejected or silenced. Acknowledged order ids live here (device memory, not persisted:
 * after a restart an unanswered order rings again, which is what a kitchen wants).
 */

/** Seconds between chimes while something is unanswered. */
export const ALARM_REPEAT_MS = 4_000;

let acked = new Set<string>();
let soundReady = canPlay();
/** When the chime last played: the board's own alarm skips its first chime right after a live ring. */
let lastRingAt = 0;
function chime() {
  lastRingAt = Date.now();
  playNewOrder();
}
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
onUnlock(() => {
  soundReady = true;
  emit();
});

export const alarm = {
  acknowledge(ids: readonly string[]) {
    if (ids.every((id) => acked.has(id))) return;
    acked = new Set([...acked, ...ids]);
    emit();
  },
  acknowledged: () => acked,
  /**
   * A new order arrived on the live channel: ring now, before the board is re-read (it then keeps
   * ringing through `useNewOrderAlarm` until answered).
   */
  ringNow(orderId: string, soundOn: boolean) {
    if (!soundOn || !soundReady || acked.has(orderId)) return;
    chime();
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};

export function useAcknowledged(): ReadonlySet<string> {
  return useSyncExternalStore(alarm.subscribe, alarm.acknowledged, alarm.acknowledged);
}

/** Whether the browser lets us play sound yet (always true on native). */
export function useSoundReady(): boolean {
  return useSyncExternalStore(alarm.subscribe, () => soundReady, () => soundReady);
}

/** Rings now and every few seconds while there are unanswered new orders and the sound is on. */
export function useNewOrderAlarm(orders: readonly BoardOrder[] | undefined, soundOn: boolean): string[] {
  const ackd = useAcknowledged();
  const ready = useSoundReady();
  const pending = orders ? unacknowledged(orders, ackd) : [];
  const ringing = soundOn && ready && pending.length > 0;
  const key = pending.join(',');
  useEffect(() => {
    if (!ringing) return;
    if (Date.now() - lastRingAt > 1_500) chime();
    const id = setInterval(chime, ALARM_REPEAT_MS);
    return () => clearInterval(id);
  }, [ringing, key]);
  return pending;
}
