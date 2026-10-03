'use client';

import { useQuery } from '@tanstack/react-query';
import { useSignedIn } from './session';
import { useTRPC } from './trpc';

/** The one city at launch. */
export const CITY_ID = 'aziziyah';
export const CITY_TZ = 'Asia/Baghdad';

/** Plan decision 3: console live updates by 2-s polling in M2. */
export const LIVE_POLL_MS = 2_000;
export const SLOW_POLL_MS = 5_000;

/** Don't retry auth failures; poll only while signed in and the tab is visible (react-query default). */
const retry = (count: number, err: unknown) => {
  const status = (err as { data?: { httpStatus?: number } | null })?.data?.httpStatus;
  if (status === 401 || status === 403) return false;
  return count < 1;
};

export function useDispatchBoard() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(trpc.dispatch.board.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: LIVE_POLL_MS, retry, staleTime: 0 }));
}

export function useActiveTrips() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(trpc.trips.board.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: LIVE_POLL_MS, retry, staleTime: 0 }));
}

export function useActiveOrders() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(trpc.orders.listActive.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: SLOW_POLL_MS, retry }));
}

/** Live driver pins from presence (`dispatch.drivers`): positions, states, cash vs cap. */
export function useDriverPins() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(trpc.dispatch.drivers.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: LIVE_POLL_MS, retry, staleTime: 0 }));
}

/** The dispatch board's right-now bar (`console.rightNow`). */
export function useRightNow() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(trpc.console.rightNow.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: LIVE_POLL_MS, retry, staleTime: 0 }));
}

/** Merchant orgs with live balances (`merchants.list`) for pickers. */
export function useMerchants() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(trpc.merchants.list.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: 10_000, retry }));
}

export { retry as queryRetry };
