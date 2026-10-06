'use client';

import { useQuery } from '@tanstack/react-query';
import { DEMAND_MAP_RULES } from '@driver/contracts';
import { CITY_ID, queryRetry } from './live';
import { useSignedIn } from './session';
import { useTRPC } from './trpc';

/** Busy zones for the Console map (maps program o5), re-read every minute like the drivers' map. */
export function useZoneDemand() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(trpc.dispatch.zoneDemand.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: queryRetry, refetchInterval: DEMAND_MAP_RULES.refreshMs }));
}
