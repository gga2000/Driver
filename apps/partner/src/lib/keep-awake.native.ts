import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

/** Keeps the screen on while `active` (online or on a job) — expo-keep-awake. Same API as keep-awake.ts. */
const TAG = 'driver-partner-work';

export function useKeepAwakeWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(TAG).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(TAG);
    };
  }, [active]);
}
