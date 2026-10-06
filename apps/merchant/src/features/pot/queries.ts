import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MerchantPotView } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** «قدر اليوم» (joy h2): today's pot, last week's same day, the recent ones and follower counts. */
export function usePot(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.pot.get.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && !!merchantOrgId, staleTime: 30_000 });
}

/** Post or clear today's pot; the answer replaces the cached view. */
export function usePotActions() {
  const api = useApi();
  const qc = useQueryClient();
  const put = (view: MerchantPotView) => qc.setQueryData(api.merchantAdmin.pot.get.queryKey({ merchantOrgId: view.merchantOrgId }), view);
  return {
    set: useMutation({ ...api.merchantAdmin.pot.set.mutationOptions(), onSuccess: put }),
    clear: useMutation({ ...api.merchantAdmin.pot.clear.mutationOptions(), onSuccess: put }),
  };
}

/** «مطاعمنا» (joy h5): the kitchen's story (the owner edits). */
export function useStory(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.story.get.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && !!merchantOrgId });
}

export function useSaveStory() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.merchantAdmin.story.set.mutationOptions(),
    onSuccess: (view) => qc.setQueryData(api.merchantAdmin.story.get.queryKey({ merchantOrgId: view.merchantOrgId }), view),
  });
}
