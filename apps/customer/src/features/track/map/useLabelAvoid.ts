import { useMemo } from 'react';
import type { LabelObstacle } from '@driver/map';
import type { LngLat } from '../geo';

/**
 * The markers a map draws (pins, the courier's last fix) as obstacles the zone names keep clear of.
 * Keyed by the points themselves, so a re-render with the same places does not redraw the names.
 */
export function useLabelAvoid(points: ReadonlyArray<LngLat | null | undefined>): readonly LabelObstacle[] {
  const present = points.filter((p): p is LngLat => Boolean(p));
  const key = present.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
  // The key is the content of `present`; the array itself is new on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => present.map((at) => ({ at })), [key]);
}
