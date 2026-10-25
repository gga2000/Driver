import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AziziyahZoneSeed } from '@driver/contracts';
import { ZONE_SHAPES_QUERY } from '@/features/track/map/zone-query';
import { useApi } from '@/lib/api';
import { liveZones, setLiveZones, subscribeZones } from './zones-state';

/** The areas for a screen: it redraws when the server's list arrives or changes. */
export function useLiveZones(): readonly AziziyahZoneSeed[] {
  return useSyncExternalStore(subscribeZones, liveZones, liveZones);
}

/** Mounted once under the API provider: keeps `liveZones()` in step with `ops.zones.map` (the map shares the query). */
export function ZoneSync(): null {
  const api = useApi();
  const zones = useQuery(api.ops.zones.map.queryOptions({ cityId: 'aziziyah' }, ZONE_SHAPES_QUERY));
  useEffect(() => setLiveZones(zones.data), [zones.data]);
  return null;
}
