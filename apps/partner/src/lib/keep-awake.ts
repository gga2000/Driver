import { useEffect } from 'react';

/**
 * Keeps the screen on while `active` (online or on a job, UI/UX audit P-01): a phone in a handlebar
 * mount must not lock between offers. Web: the Screen Wake Lock API where the browser has it (asked
 * again when the tab comes back). Native: keep-awake.native.ts (expo-keep-awake).
 */

interface Sentinel {
  released: boolean;
  release(): Promise<void>;
}
type WakeNav = { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

export function useKeepAwakeWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const wl = (globalThis as { navigator?: WakeNav }).navigator?.wakeLock;
    if (!wl || typeof document === 'undefined') return;
    let sentinel: Sentinel | null = null;
    let alive = true;
    const acquire = () => {
      wl.request('screen').then(
        (s) => {
          if (alive) sentinel = s;
          else void s.release();
        },
        () => undefined,
      );
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
