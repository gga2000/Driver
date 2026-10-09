import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { IntercityDirection } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * الرجعة, driver side (`routes.driver.*`, `routes.requestBoard.*`). The garage board polls every 10 s,
 * an open departure every 5 s (riders check in, the meter runs, door pickups arrive). Every mutation
 * invalidates the whole `routes` namespace so the board, the departure and the manifest catch up.
 */

export const BOARD_POLL_MS = 10_000;
export const DEPARTURE_POLL_MS = 5_000;

export function useNetwork() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.routes.network.queryOptions(), enabled: signedIn, staleTime: 10 * 60_000 });
}

export function useMyDepartures() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.routes.driver.mine.queryOptions(), enabled: signedIn, refetchInterval: BOARD_POLL_MS });
}

export function useDemand(corridorId: string, direction: IntercityDirection) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.driver.demand.queryOptions({ corridorId, direction }),
    enabled: signedIn,
    refetchInterval: BOARD_POLL_MS,
    placeholderData: (prev) => prev,
  });
}

/** Open request-board posts (all cities: posts without a garage carry no city). */
export function useOpenRequests() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.routes.requestBoard.list.queryOptions({}), enabled: signedIn, refetchInterval: BOARD_POLL_MS });
}

export function useMyRides() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.routes.requestBoard.myRides.queryOptions(), enabled: signedIn, refetchInterval: BOARD_POLL_MS });
}

export function useDeparture(departureId: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.driver.departure.queryOptions({ departureId }),
    enabled: signedIn && !!departureId,
    refetchInterval: (q) => (q.state.data && ['arrived', 'closed', 'cancelled_by_driver', 'cancelled_low_fill'].includes(q.state.data.state) ? false : DEPARTURE_POLL_MS),
  });
}

/**
 * Riders by first name for the seat map. Every read is a logged vault read on the server, so this is
 * fetched once and again only when a booking appears that the list does not name yet.
 */
export function useRiderNames(departureId: string, bookingIds: readonly string[]) {
  const api = useApi();
  const signedIn = useSignedIn();
  const q = useQuery({
    ...api.routes.driver.riders.queryOptions({ departureId }),
    enabled: signedIn && !!departureId,
    staleTime: Infinity,
  });
  const known = new Set((q.data ?? []).map((r) => r.bookingId));
  const missing = q.isSuccess && !q.isFetching && bookingIds.some((id) => !known.has(id));
  useEffect(() => {
    if (missing) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);
  return q;
}

/**
 * Step 4: riders' price asks on his open departure (pin on the road, door drop). Each read names the
 * riders from the vault (logged), so this polls slower than the departure: every 20 s while open.
 */
export const AGREEMENTS_POLL_MS = 20_000;
export function useDepartureAgreements(departureId: string, open: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.agreements.onDeparture.queryOptions({ departureId }),
    enabled: signedIn && !!departureId && open,
    refetchInterval: open ? AGREEMENTS_POLL_MS : false,
  });
}

function useInvalidateRoutes() {
  const api = useApi();
  const qc = useQueryClient();
  // The manifest names are left alone: they refetch only when a new booking appears (vault reads).
  return () => qc.invalidateQueries({ queryKey: api.routes.pathKey(), predicate: (q) => !JSON.stringify(q.queryKey).includes('"riders"') });
}

export function useDriverActions() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  const opts = { onSettled: () => void invalidate() };
  return {
    announce: useMutation({ ...api.routes.driver.announce.mutationOptions(), ...opts }),
    selfie: useMutation({ ...api.routes.driver.selfie.mutationOptions(), ...opts }),
    position: useMutation({ ...api.routes.driver.position.mutationOptions(), ...opts }),
    walkUp: useMutation({ ...api.routes.driver.markWalkUp.mutationOptions(), ...opts }),
    checkIn: useMutation({ ...api.routes.driver.checkIn.mutationOptions(), ...opts }),
    noShow: useMutation({ ...api.routes.driver.markNoShow.mutationOptions(), ...opts }),
    respondPickup: useMutation({ ...api.routes.driver.respondPickup.mutationOptions(), ...opts }),
    depart: useMutation({ ...api.routes.driver.depart.mutationOptions(), ...opts }),
    arrive: useMutation({ ...api.routes.driver.arrive.mutationOptions(), ...opts }),
    propose: useMutation({ ...api.routes.agreements.propose.mutationOptions(), ...opts }),
  };
}

export function useRequestActions() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  const opts = { onSettled: () => void invalidate() };
  return {
    // No invalidate: nothing on the driver's screens changes when he is counted as having seen it.
    seen: useMutation(api.routes.requestBoard.seen.mutationOptions()),
    offer: useMutation({ ...api.routes.requestBoard.offer.mutationOptions(), ...opts }),
    /** 4b a6: his answer to a rider's «احجز وادفع كاش». */
    answerCash: useMutation({ ...api.routes.requestBoard.answerCash.mutationOptions(), ...opts }),
    arrived: useMutation({ ...api.routes.requestBoard.arrived.mutationOptions(), ...opts }),
    waitStart: useMutation({ ...api.routes.requestBoard.waitStart.mutationOptions(), ...opts }),
    waitEnd: useMutation({ ...api.routes.requestBoard.waitEnd.mutationOptions(), ...opts }),
    complete: useMutation({ ...api.routes.requestBoard.complete.mutationOptions(), ...opts }),
    riderNoShow: useMutation({ ...api.routes.requestBoard.riderNoShow.mutationOptions(), ...opts }),
    /** Way C: his «أكّد الصعود» for a shared car's friend whose phone can't. */
    boardFor: useMutation({ ...api.routes.requestBoard.shareBoardFor.mutationOptions(), ...opts }),
  };
}
