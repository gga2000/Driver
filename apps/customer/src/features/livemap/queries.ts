import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LatLng } from '@driver/contracts';
import type { CustomerTownNow } from '@driver/contracts/town-pulse';
import { liteInterval, useLiteMode } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** The server builds one town picture every 20 s; the map reads it at the same pace (three times slower in low-data mode). */
export const TOWN_POLL_MS = 20_000;

/**
 * `catalog.townNow`: kitchens cooking near their place and how many drivers are around (cells of 3 or
 * more). Signed-in only; a guest's map shows open kitchens without it. Only while the screen is open.
 */
export function useTownNow(at: LatLng, enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  const lite = useLiteMode();
  // Rounded to ~100 m so a small move of the pin reuses the same read.
  const near = { lat: Math.round(at.lat * 1000) / 1000, lng: Math.round(at.lng * 1000) / 1000 };
  return useQuery({
    ...api.catalog.townNow.queryOptions({ at: near }),
    enabled: signedIn && enabled,
    staleTime: TOWN_POLL_MS / 2,
    refetchInterval: enabled ? liteInterval(TOWN_POLL_MS, lite) : false,
    placeholderData: keepPreviousData as (prev: CustomerTownNow | undefined) => CustomerTownNow | undefined,
  });
}
