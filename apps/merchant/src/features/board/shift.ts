import { useSyncExternalStore } from 'react';
import { testChime } from '@/lib/alert-sound';
import { requestWakeLock, type WakeState } from '@/lib/keep-awake';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * "ابدأ الشغل" — the start-of-shift gate (UI/UX audit M-04, signature S-M1). One big tap at the start
 * of the day, and after any reload: it is the tap the browser needs before it lets the alarm make a
 * sound, it keeps the screen on, and it plays the chime so the kitchen hears what a new order sounds
 * like. Kept in memory on purpose — a reload or a new day asks again.
 *
 * Step 6 (y3, «رجعت الكهرباء؟»): the day and the last moment the app was alive are also kept on the
 * device. When it comes back mid-shift (a power cut, a restart) the gate says how long the tablet was
 * off and checks the sound, the net and the printer before the next order rings.
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

/** The shift as kept on the device: which day it started, and when the app was last seen alive. */
export interface StoredShift {
  day: string;
  aliveAt: number;
}

export function parseShift(raw: string | null): StoredShift | null {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<StoredShift>) : null;
    return v && typeof v.day === 'string' && typeof v.aliveAt === 'number' ? { day: v.day, aliveAt: v.aliveAt } : null;
  } catch {
    return null;
  }
}

/** The app came back during today's shift: how many whole minutes it was off (0 = a quick reload). */
export function powerBack(stored: StoredShift | null, now: number): { offMinutes: number } | null {
  if (!stored || stored.day !== baghdadDay(now)) return null;
  return { offMinutes: Math.max(0, Math.floor((now - stored.aliveAt) / 60_000)) };
}

const SHIFT_KEY = 'driver.merchant.shift';
/** How often the running app notes it is alive (MerchantRuntime). */
export const ALIVE_MS = 30_000;
let kv: KeyValueStorage = platformStorage;
let back: { offMinutes: number } | null = null;
let loading: Promise<void> | null = null;

/** Reads the kept shift once per app start; `back` is set when this start is a return mid-shift. */
export function loadShift(now = Date.now(), store: KeyValueStorage = kv): Promise<void> {
  kv = store;
  loading ??= store
    .getItem(SHIFT_KEY)
    .then((raw) => {
      back = startedDay ? null : powerBack(parseShift(raw), now);
      emit();
    })
    .catch(() => {});
  return loading;
}

/** Notes that the app is alive on today's shift (every 30 s while it runs, and at the start tap). */
export function markAlive(now = Date.now()): void {
  if (!startedDay) return;
  void kv.setItem(SHIFT_KEY, JSON.stringify({ day: startedDay, aliveAt: now } satisfies StoredShift)).catch(() => {});
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
  back = null;
  markAlive(now);
  emit();
  return last;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useShift(): { startedDay: string | null; result: ShiftResult | null; back: { offMinutes: number } | null } {
  const day = useSyncExternalStore(subscribe, () => startedDay, () => startedDay);
  const result = useSyncExternalStore(subscribe, () => last, () => last);
  const powered = useSyncExternalStore(subscribe, () => back, () => back);
  return { startedDay: day, result, back: powered };
}
