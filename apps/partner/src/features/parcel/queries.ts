import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourierParcelView } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * طرود, the courier's side (`parcels.courier.*`): the parcel on his order, the receipt code check, what
 * the trip back costs, and «رفضت تستلم». Only the courier carrying the order may call them (server).
 */

export function useCourierParcel(orderId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.parcels.courier.job.queryOptions({ orderId: orderId ?? '' }), enabled: signedIn && Boolean(orderId), staleTime: 15_000 });
}

/** «رفضت تستلم» before the second tap: the server's amount for the trip back (asked only when he opens it). */
export function useRefusalPreview(orderId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.parcels.courier.refusalPreview.queryOptions({ orderId: orderId ?? '' }), enabled: signedIn && enabled && Boolean(orderId), staleTime: 0 });
}

export function useParcelActions(orderId: string | null) {
  const api = useApi();
  const qc = useQueryClient();
  // The answer is the fresh view: written straight into the job query so the panel moves on at once.
  const store = (view: CourierParcelView) => qc.setQueryData(api.parcels.courier.job.queryKey({ orderId: orderId ?? '' }), view);
  return {
    checkPin: useMutation({ ...api.parcels.courier.checkPin.mutationOptions(), onSuccess: store }),
    refuse: useMutation({ ...api.parcels.courier.refuse.mutationOptions(), onSuccess: store }),
    pickupPhoto: useMutation({ ...api.parcels.courier.pickupPhoto.mutationOptions(), onSuccess: store }),
    refetch: () => qc.invalidateQueries({ queryKey: api.parcels.courier.job.queryKey({ orderId: orderId ?? '' }) }),
  };
}
