import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** The store's weekly schedule, closures and Friday-prayer pause, and whether it is open now. */
export function useStoreHours(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchant.hours.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: 60_000,
  });
}

/** Owner only: saves the whole schedule; the status header (board strip) follows. */
export function useSaveHours() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.merchant.setHours.mutationOptions(),
    onSuccess: (view) =>
      qc.setQueryData(api.merchant.hours.queryKey({ merchantOrgId: view.merchantOrgId }), view),
    onSettled: () => void qc.invalidateQueries(api.merchant.storeStatus.pathFilter()),
  });
}
