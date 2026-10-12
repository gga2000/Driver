import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** Her «اطبخي ويانا» application: none yet, waiting, approved or not (read again every minute while she waits). */
export function useMyKitchenApplication() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.ops.myHomeKitchenApplication.queryOptions(),
    enabled: signedIn,
    refetchInterval: (q) => (q.state.data?.state === 'submitted' ? 60_000 : false),
  });
}

/** Send it; her application is read again after (and her stores, in case staff already approved). */
export function useApplyKitchen() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.ops.homeKitchenApply.mutationOptions(),
    onSuccess: (view) => qc.setQueryData(api.ops.myHomeKitchenApplication.queryKey(), view),
  });
}
