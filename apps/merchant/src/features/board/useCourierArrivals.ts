import { useEffect, useRef } from 'react';
import type { BoardOrder } from '@driver/contracts';
import { useTheme } from '@driver/ui';
import { courierChime } from '@/lib/alert-sound';
import { newArrivals } from './radar';

/**
 * The arriving chime (maps program SP7a, r2): once per courier as he comes inside 250 m or a minute
 * (or reaches the counter) — two soft notes and a buzz, so the food is on the counter when he walks
 * in. Follows the kitchen's sound switch; nothing for couriers already there when the board opened.
 */
export function useCourierArrivals(orders: readonly BoardOrder[] | undefined, soundOn: boolean): void {
  const theme = useTheme();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders) return;
    const r = newArrivals(seen.current, orders);
    seen.current = r.seen;
    if (r.chime.length === 0) return;
    theme.haptic('success');
    if (soundOn) courierChime();
    // `theme` is stable for the screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, soundOn]);
}
