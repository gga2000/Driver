import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api';

/** Zone outlines change only when ops re-draws them in the Console; ten minutes old at most when the app is next in front. */
export const ZONE_MAP_FRESH_MS = 10 * 60 * 1000;

/**
 * The city's zone outlines (speed d2): fetched when the app starts and again when it comes to the front after ten minutes,
 * shared by the zone names, the busy-zone fill and the web map. Busy levels stay live on their own
 * (`partner.demandMap`); only the shapes stop polling every 30 s.
 */
export function useZoneMap() {
  const api = useApi();
  return useQuery(
    api.ops.zones.map.queryOptions(
      { cityId: 'aziziyah' },
      { staleTime: ZONE_MAP_FRESH_MS, gcTime: 24 * 60 * 60 * 1000, refetchOnWindowFocus: true, refetchOnReconnect: true },
    ),
  );
}
