import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EarningsPeriod } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * Fleet owner hooks over `fleet.*`. The overview carries vehicles, drivers, documents and the week,
 * so most screens read it (polled every 30 s: who is online changes during the shift).
 */

export const FLEET_POLL_MS = 30_000;

export function useFleetOverview() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.fleet.overview.queryOptions({}), enabled: signedIn, refetchInterval: FLEET_POLL_MS });
}

export function useDriverEarnings(driverId: string, period: EarningsPeriod) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.fleet.driverEarnings.queryOptions({ driverId, period }), enabled: signedIn && driverId.length > 0 });
}

/** Refreshes the overview (and the lists derived from it) after a change. */
function useInvalidateFleet() {
  const api = useApi();
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: api.fleet.overview.queryKey() }),
      qc.invalidateQueries({ queryKey: api.fleet.vehicles.queryKey() }),
      qc.invalidateQueries({ queryKey: api.fleet.drivers.queryKey() }),
    ]);
}

export function useAddVehicle() {
  const api = useApi();
  const invalidate = useInvalidateFleet();
  return useMutation({ ...api.fleet.addVehicle.mutationOptions(), onSuccess: () => void invalidate() });
}

export function useAddDriver() {
  const api = useApi();
  const invalidate = useInvalidateFleet();
  return useMutation({ ...api.fleet.addDriver.mutationOptions(), onSuccess: () => void invalidate() });
}

export function useAssignDriver() {
  const api = useApi();
  const invalidate = useInvalidateFleet();
  return useMutation({ ...api.fleet.assignDriver.mutationOptions(), onSuccess: () => void invalidate() });
}
