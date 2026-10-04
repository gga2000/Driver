import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

/**
 * "الشاشة تبقى شاعلة" (native): expo-keep-awake while the kitchen is working the board, so a tablet on
 * the counter never sleeps through a new order. Same API as keep-awake.ts.
 */

export type WakeState = 'on' | 'off' | 'unsupported';

const TAG = 'driver-merchant-board';
let state: WakeState = 'off';
const listeners = new Set<() => void>();
const set = (next: WakeState) => {
  if (state === next) return;
  state = next;
  for (const l of listeners) l();
};

export async function requestWakeLock(): Promise<WakeState> {
  try {
    await activateKeepAwakeAsync(TAG);
    set('on');
  } catch {
    set('off');
  }
  return state;
}

export function releaseWakeLock(): void {
  void deactivateKeepAwake(TAG);
  set('off');
}

export function getWakeState(): WakeState {
  return state;
}

export function useWakeState(): WakeState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
    () => state,
  );
}
