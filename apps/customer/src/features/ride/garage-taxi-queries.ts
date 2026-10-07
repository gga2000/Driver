import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { GarageArmView, GarageTaxiPayment, ToGaragePlan } from '@driver/contracts';
import { useNetwork } from '@driver/ui';
import { newRequestKey } from '@/features/food/place-attempt';
import { useApi, useApiClient } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { GARAGE_TAXI_POLL_MS, LATE_NOTICE_POLL_MS } from './garage-taxi';

/**
 * Taxi ideas x2 / x3 / x4 queries (`garageTaxi.*`). Each card reads its own seat's plan and keeps it
 * fresh while it shows (the car's minutes move, a booked ride changes state); mutations refresh the
 * card and the rider's orders.
 */

/** x2: the taxi timed to the car of this seat, from `placeId` (his home by default). */
export function useToGaragePlan(bookingId: string, placeId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.garageTaxi.toGarage.queryOptions({ bookingId, ...(placeId ? { from: { placeId } } : {}) }),
    enabled: signedIn,
    staleTime: 30_000,
    refetchInterval: GARAGE_TAXI_POLL_MS,
    placeholderData: keepPreviousData,
  });
}

/** x2: book (or order now) the taxi the plan shows, at the fare it showed. */
export function useBookToGarage(bookingId: string) {
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  const net = useNetwork();
  // One key per attempt, kept across retries so a lost answer never books twice.
  const [key, setKey] = useState(() => newRequestKey('gtx'));
  const [busy, setBusy] = useState(false);
  const book = async (plan: ToGaragePlan, payment?: GarageTaxiPayment): Promise<ToGaragePlan> => {
    setBusy(true);
    try {
      const out = await client.garageTaxi.bookToGarage.mutate({
        bookingId,
        ...(plan.fromPlaceId ? { from: { placeId: plan.fromPlaceId } } : {}),
        fareIqd: plan.fareIqd ?? 0,
        ...(payment ? { paymentMethod: payment } : {}),
        clientRequestId: key,
      });
      setKey(newRequestKey('gtx'));
      void qc.invalidateQueries({ queryKey: api.garageTaxi.toGarage.queryKey() });
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      return out;
    } finally {
      setBusy(false);
    }
  };
  return { book, busy, online: net.online };
}

/** x3: the late notice for this ride (null for any ride that is not a taxi to a الرجعة car). */
export function useGarageLate(orderId: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.garageTaxi.forOrder.queryOptions({ orderId }), enabled: signedIn, staleTime: 15_000, refetchInterval: LATE_NOTICE_POLL_MS });
}

/** x4: the waiting taxi for this seat on the way back. */
export function useGarageArm(bookingId: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.garageTaxi.arrival.queryOptions({ bookingId }), enabled: signedIn, staleTime: 30_000, refetchInterval: GARAGE_TAXI_POLL_MS, placeholderData: keepPreviousData });
}

/** x4: arm (to a saved place) or disarm; the card shows the server's answer at once. */
export function useArmGarageTaxi(bookingId: string) {
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const settle = (view: GarageArmView) => {
    qc.setQueryData(api.garageTaxi.arrival.queryKey({ bookingId }), view);
    void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
    return view;
  };
  const run = async (fn: () => Promise<GarageArmView>) => {
    setBusy(true);
    try {
      return settle(await fn());
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    arm: (placeId: string) => run(() => client.garageTaxi.arm.mutate({ bookingId, to: { placeId } })),
    disarm: () => run(() => client.garageTaxi.disarm.mutate({ bookingId })),
  };
}
