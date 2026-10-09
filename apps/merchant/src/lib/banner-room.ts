import { useEffect, useSyncExternalStore } from 'react';

/**
 * Day-one d07: while the board shows «الزباين ما يشوفون محلك هسة…» it is the one banner on screen, so
 * the app's own connection strip on top («ما نگدر نوصل لدرايفر») steps aside instead of stacking.
 */
let boardSaysOffline = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === boardSaysOffline) return;
  boardSaysOffline = next;
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const read = () => boardSaysOffline;

/** The board claims the connection message while `on` (and gives it back when it goes away). */
export function useClaimOfflineBanner(on: boolean): void {
  useEffect(() => {
    set(on);
    return () => set(false);
  }, [on]);
}

/** True while the board is saying it itself. */
export function useBoardSaysOffline(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}
