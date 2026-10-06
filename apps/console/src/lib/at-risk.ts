'use client';

import { useQuery } from '@tanstack/react-query';
import type { Trip } from '@driver/contracts';
import { useMemo } from 'react';
import { atRiskDrivers } from './fleet-motion';
import { CITY_ID, queryRetry } from './live';
import { useSignedIn } from './session';
import { useTRPC } from './trpc';

/** How often the at-risk list is re-read (the server keeps one prediction per order for 30 s). */
const AT_RISK_POLL_MS = 30_000;

/** The couriers to ring on the live map (maps program o4): those holding an order predicted late. */
export function useAtRiskDrivers(trips: readonly Trip[]): Set<string> {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const q = useQuery(trpc.orders.atRisk.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: queryRetry, refetchInterval: AT_RISK_POLL_MS }));
  return useMemo(() => atRiskDrivers((q.data ?? []).map((r) => r.orderId), trips), [q.data, trips]);
}
