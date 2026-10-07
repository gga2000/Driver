import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { liteInterval, useLiteMode } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** How often the searching screen re-reads who was sent the ride (ride idea n3). */
const OFFERS_MS = 3_000;

/**
 * Ride idea n3: the drivers who were sent this ride while it searches (`dispatch.myRideOffers`):
 * nearest first, with their state; empty before the first wave. Read every few seconds while
 * searching, less often in low-data mode.
 */
export function useRideOffers(orderId: string, searching: boolean) {
  const api = useApi();
  const lite = useLiteMode();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.dispatch.myRideOffers.queryOptions({ orderId }),
    enabled: signedIn && searching,
    staleTime: 0,
    refetchInterval: searching ? liteInterval(OFFERS_MS, lite) : false,
  });
}

/** Ride idea n4 «نبّهه»: a soft «راكب ينتظرك» to one driver who was sent this ride; once per driver. */
export function useNudgeOffer(orderId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.dispatch.nudgeOffer.mutationOptions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: api.dispatch.myRideOffers.queryKey({ orderId }) }),
  });
}

/** Ride idea n5: a driver's profile — one offered this ride (`offerId`), or the one driving it. */
export function useDriverProfile(orderId: string, offerId: string | null, enabled: boolean) {
  const api = useApi();
  return useQuery({ ...api.tracking.driverProfile.queryOptions(offerId ? { orderId, offerId } : { orderId }), enabled, staleTime: 60_000 });
}

/** Ride idea s5: the drivers this rider never wants again. */
export function useAvoidedDrivers(enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.rideHabits.avoided.queryOptions(), enabled: signedIn && enabled, staleTime: 60_000 });
}

function useAvoidRefresh() {
  const api = useApi();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: api.rideHabits.avoided.queryKey() });
    // Avoiding a favourite removes the favourite.
    void qc.invalidateQueries({ queryKey: api.rideHabits.favourites.queryKey() });
    void qc.invalidateQueries({ queryKey: api.rideHabits.recentGood.queryKey() });
  };
}

/** «ما أريده مرة ثانية»: the driver of this ride never gets this rider's rides again. */
export function useAvoidDriver() {
  const api = useApi();
  const refresh = useAvoidRefresh();
  return useMutation({ ...api.rideHabits.avoid.mutationOptions(), onSuccess: refresh });
}

export function useUnavoidDriver() {
  const api = useApi();
  const refresh = useAvoidRefresh();
  return useMutation({ ...api.rideHabits.unavoid.mutationOptions(), onSuccess: refresh });
}
