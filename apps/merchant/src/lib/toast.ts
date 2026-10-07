import type React from 'react';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '@driver/ui';

type ToastApi = ReturnType<typeof useToast>;

/**
 * Toasts on the counter drop from the top, just under the dark status bar (redesign ideas o8/b2): at
 * the bottom they sat on «صار جاهز», «سلّمته» and the phone's sticky accept button, and over the bar
 * they hid its switch and chips. A caller can still pass `placement: 'bottom'` for a screen whose top
 * is the thing to watch.
 */
export function useCounterToast(): ToastApi {
  const toast = useToast();
  return useMemo<ToastApi>(() => ({ hide: toast.hide, show: (data, durationMs) => toast.show({ placement: 'top', ...data }, durationMs) }), [toast]);
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
