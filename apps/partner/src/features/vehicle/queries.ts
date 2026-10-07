import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * The vehicle he drives (`fleet.myVehicle`: model, colour, claimed and confirmed features) and
 * «مميزات سيارتك» (`fleet.setMyVehicleFeatures`). Only people with a driving role ask.
 */
export function useMyVehicle(canDrive: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.fleet.myVehicle.queryOptions(), enabled: signedIn && canDrive, staleTime: 30_000 });
}

/** Saves his ticks; the vehicle comes back with them (new ones wait for the car check). */
export function useSetVehicleFeatures() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.fleet.setMyVehicleFeatures.mutationOptions(),
    onSuccess: (v) => qc.setQueryData(api.fleet.myVehicle.queryKey(), v),
  });
}
