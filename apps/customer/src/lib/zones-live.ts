import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AziziyahZoneSeed } from '@driver/contracts';
import { ZONE_SHAPES_QUERY } from '@/features/track/map/zone-query';
import { useApi } from '@/lib/api';
import { liveZones, setLiveZones, subscribeZones } from './zones-state';

let wanted = false;
const wantListeners = new Set<() => void>();
const subscribeWanted = (cb: () => void) => {
  wantListeners.add(cb);
  return () => void wantListeners.delete(cb);
};

/**
 * The areas for a screen: it redraws when the server's list arrives or changes. The list is only fetched
 * once a screen that shows areas asks for it, so home, food, menu and orders don't pay its download
 * (speed budgets; `fetch = false` for the home cards, which only read what is already there) while the place and ride pickers always see the Console's areas.
 */
export function useLiveZones(fetch = true): readonly AziziyahZoneSeed[] {
  useEffect(() => {
    if (!fetch || wanted) return;
    wanted = true;
    wantListeners.forEach((cb) => cb());
  }, [fetch]);
  return useSyncExternalStore(subscribeZones, liveZones, liveZones);
}

/** Mounted once under the API provider: keeps `liveZones()` in step with `ops.zones.map` (the map shares the query). */
export function ZoneSync(): null {
  const api = useApi();
  const enabled = useSyncExternalStore(subscribeWanted, () => wanted, () => false);
  const zones = useQuery({ ...api.ops.zones.map.queryOptions({ cityId: 'aziziyah' }, ZONE_SHAPES_QUERY), enabled });
  useEffect(() => setLiveZones(zones.data), [zones.data]);
  return null;
}
