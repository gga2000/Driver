import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** أكل بيت: her dishes, today's plates and the reservations coming (refreshed every minute). */
export function useHomeKitchen(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.home.get.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: 60_000,
  });
}

/** Save a dish or today's plates; the kitchen view is read again after. */
export function useHomeKitchenActions(merchantOrgId: string | null) {
  const api = useApi();
  const qc = useQueryClient();
  const onSuccess = () =>
    qc.invalidateQueries({
      queryKey: api.merchantAdmin.home.get.queryKey({ merchantOrgId: merchantOrgId ?? '' }),
    });
  return {
    save: useMutation({ ...api.merchantAdmin.home.saveDish.mutationOptions(), onSuccess }),
    today: useMutation({ ...api.merchantAdmin.home.setToday.mutationOptions(), onSuccess }),
  };
}
