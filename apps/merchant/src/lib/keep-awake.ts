import { useSyncExternalStore } from 'react';

/**
 * "الشاشة تبقى شاعلة" (web): the Screen Wake Lock API, asked for on "ابدأ الشغل" (it needs a tap) and
 * asked for again whenever the tab comes back to the front (browsers drop it when hidden). Browsers
 * without the API report `unsupported`, and the board keeps a chip asking the kitchen to keep the
 * tablet's screen on from its own settings. Native: keep-awake.native.ts (expo-keep-awake).
 */

export type WakeState = 'on' | 'off' | 'unsupported';

interface Sentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}
type WakeNav = { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

let state: WakeState = 'off';
let wanted = false;
let sentinel: Sentinel | null = null;
const listeners = new Set<() => void>();
const set = (next: WakeState) => {
  if (state === next) return;
  state = next;
  for (const l of listeners) l();
};

function api(): WakeNav['wakeLock'] | null {
  const nav = (globalThis as { navigator?: WakeNav }).navigator;
  return nav?.wakeLock ?? null;
}

async function acquire(): Promise<WakeState> {
  const wl = api();
  if (!wl) {
    set('unsupported');
    return state;
  }
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
      set('off');
    });
    set('on');
  } catch {
    set('off');
  }
  return state;
}

/** Keep the screen on from now (call from a tap). */
export function requestWakeLock(): Promise<WakeState> {
  wanted = true;
  if (sentinel && !sentinel.released) return Promise.resolve(state);
  return acquire();
}

export function releaseWakeLock(): void {
  wanted = false;
  void sentinel?.release().catch(() => undefined);
  sentinel = null;
  set('off');
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible' && !sentinel) void acquire();
  });
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
