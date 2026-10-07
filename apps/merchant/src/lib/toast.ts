import { useMemo } from 'react';
import { useToast } from '@driver/ui';

type ToastApi = ReturnType<typeof useToast>;

/**
 * Toasts on the counter drop from the top, under the status bar (redesign step 1, ideas o8/b2): at the
 * bottom they sat on «صار جاهز», «سلّمته» and the phone's sticky accept button. A caller can still
 * pass `placement: 'bottom'` for a screen whose top is the thing to watch.
 */
export function useCounterToast(): ToastApi {
  const toast = useToast();
  return useMemo<ToastApi>(() => ({ hide: toast.hide, show: (data, durationMs) => toast.show({ placement: 'top', ...data }, durationMs) }), [toast]);
}
