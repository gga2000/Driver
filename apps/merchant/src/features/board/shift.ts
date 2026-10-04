import { useSyncExternalStore } from 'react';
import { testChime } from '@/lib/alert-sound';
import { requestWakeLock, type WakeState } from '@/lib/keep-awake';

/**
 * "ابدأ الشغل" — the start-of-shift gate (UI/UX audit M-04, signature S-M1). One big tap at the start
 * of the day, and after any reload: it is the tap the browser needs before it lets the alarm make a
 * sound, it keeps the screen on, and it plays the chime so the kitchen hears what a new order sounds
 * like. Kept in memory on purpose — a reload or a new day asks again.
 */

export interface ShiftResult {
  sound: boolean;
  wake: WakeState;
}

/** Local day (Asia/Baghdad) as YYYY-MM-DD. */
export function baghdadDay(now: number): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** The gate shows until the shift was started today. */
export function shiftGateNeeded(startedDay: string | null, now: number): boolean {
  return startedDay !== baghdadDay(now);
}

let startedDay: string | null = null;
let last: ShiftResult | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Called from the "ابدأ الشغل" tap: unlocks audio, keeps the screen on, plays the test chime. */
export async function startShift(now = Date.now()): Promise<ShiftResult> {
  const [sound, wake] = await Promise.all([testChime(), requestWakeLock()]);
  startedDay = baghdadDay(now);
  last = { sound, wake };
  emit();
  return last;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useShift(): { startedDay: string | null; result: ShiftResult | null } {
  const day = useSyncExternalStore(subscribe, () => startedDay, () => startedDay);
  const result = useSyncExternalStore(subscribe, () => last, () => last);
  return { startedDay: day, result };
}
