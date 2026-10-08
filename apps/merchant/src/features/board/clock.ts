import { useSyncExternalStore } from 'react';

/**
 * The counter's one server clock (speed h3). A single 1-s timer for the whole app; each screen part
 * asks only for the slice of time it shows (`useServerSelect`) and re-draws only when that slice
 * changes: a ring every second, a ticket's «من 4 د» every 10 s, the board itself once a minute. Before
 * this the whole board re-rendered every second while it sat idle.
 */

let offset = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const serverClock = {
  /** Server time: device time plus the offset the last board read measured. */
  now: (): number => Date.now() + offset,
  setOffset(next: number) {
    if (next === offset) return;
    offset = next;
    emit();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    timer ??= setInterval(emit, 1000);
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  },
};

/** A slice of server time; the component re-renders only when `select` returns something new. */
export function useServerSelect<T extends string | number | boolean | null>(select: (now: number) => T): T {
  const get = () => select(serverClock.now());
  return useSyncExternalStore(serverClock.subscribe, get, get);
}

/** Server time floored to `ms`: e.g. 60_000 for a value that changes once a minute. */
export function useServerTime(ms: number): number {
  return useServerSelect((now) => Math.floor(now / ms) * ms);
}
