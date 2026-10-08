import type React from 'react';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '@driver/ui';

type ToastApi = ReturnType<typeof useToast>;

/**
 * a7 · nothing opens over a ringing order. While an order rings, the counter's quiet toasts (done,
 * saved) wait; only the newest is kept, and it shows when the ringing stops if it is still fresh.
 * Problems (danger, warning) show at once, at the bottom, away from the ribbon at the top.
 */
let held = false;
let waiting: { show: () => void; at: number } | null = null;

/**
 * Toasts on the counter drop from the top, just under the dark status bar (redesign ideas o8/b2): at
 * the bottom they sat on «صار جاهز», «سلّمته» and the phone's sticky accept button, and over the bar
 * they hid its switch and chips. A caller can still pass `placement: 'bottom'` for a screen whose top
 * is the thing to watch.
 */
export function useCounterToast(): ToastApi {
  const toast = useToast();
  return useMemo<ToastApi>(
    () => ({
      hide: toast.hide,
      show: (data, durationMs) => {
        const urgent = data.tone === 'danger' || data.tone === 'warning';
        if (!held) {
          toast.show({ placement: 'top', ...data }, durationMs);
        } else if (urgent) {
          // A failed tap or "no net" can't wait: it shows at once, at the bottom, off the ribbon.
          toast.show({ ...data, placement: 'bottom' }, durationMs);
        } else {
          waiting = { show: () => toast.show({ placement: 'top', ...data }, durationMs), at: Date.now() };
        }
      },
    }),
    [toast],
  );
}

/** A waited toast older than this is stale by the time the ringing stops: it is dropped. */
export const TOAST_WAIT_MAX_MS = 15_000;

export function holdToasts(on: boolean, now = Date.now()): void {
  held = on;
  if (on || !waiting) return;
  const w = waiting;
  waiting = null;
  if (now - w.at <= TOAST_WAIT_MAX_MS) w.show();
}

/** Where the status bar ends, px below the safe area (null on screens without it). */
let barBottom: number | null = null;
const listeners = new Set<() => void>();
const setBarBottom = (v: number | null) => {
  if (v === barBottom) return;
  barBottom = v;
  for (const l of listeners) l();
};

/** The toast host's top offset: under the status bar when one is showing, else the default. */
export function useToastTop(): number | undefined {
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => barBottom,
    () => barBottom,
  );
  return v === null ? undefined : v + 8;
}

/**
 * For the status bar: a ref and an onLayout that report where the bar ends, so toasts open under it.
 * Call `release` when the bar unmounts.
 */
export function useReportBarBottom(): { ref: React.RefObject<View | null>; onLayout: () => void; release: () => void } {
  const ref = useRef<View | null>(null);
  const insets = useSafeAreaInsets();
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _w, h) => setBarBottom(Math.max(0, Math.round(y + h - insets.top))));
  }, [insets.top]);
  const release = useCallback(() => setBarBottom(null), []);
  return { ref, onLayout, release };
}
