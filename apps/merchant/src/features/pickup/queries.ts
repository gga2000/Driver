import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** The store's pickup spot (maps program r7): note, photos as signed links, whether he may edit. */
export function usePickupSpot(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchant.pickupSpot.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
  });
}

/** Owner only: replaces the note and photos; the saved view replaces the cached one. */
export function useSavePickupSpot() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.merchant.setPickupSpot.mutationOptions(),
    onSuccess: (view) => qc.setQueryData(api.merchant.pickupSpot.queryKey({ merchantOrgId: view.merchantOrgId }), view),
  });
}
