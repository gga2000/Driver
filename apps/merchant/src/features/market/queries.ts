import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BakeryOwnerView, StallOwnerView } from '@driver/contracts/shopping';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** Is this store a produce stall or a bakery (السوق)? Asked only for a grocer (`on`); it never changes. */
export function useShopMode(merchantOrgId: string | null, on = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.shopping.owner.mode.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: on && signedIn && !!merchantOrgId,
    staleTime: Infinity,
  });
}

/** «أسعار اليوم»: every item with today's or yesterday's price and photo. */
export function useStallPrices(merchantOrgId: string | null, on = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.shopping.owner.stall.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: on && signedIn && !!merchantOrgId });
}

/** The baker's oven: open, paused or closed, and today's «صمون كل يوم». Polled so a pause ends on screen. */
export function useOven(merchantOrgId: string | null, on = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.shopping.owner.bakery.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: on && signedIn && !!merchantOrgId, refetchInterval: 30_000 });
}

/** Each answer is the fresh view, which replaces the cached one. */
export function useMarketActions() {
  const api = useApi();
  const qc = useQueryClient();
  return {
    post: useMutation({
      ...api.shopping.owner.postPrices.mutationOptions(),
      onSuccess: (v: StallOwnerView) => qc.setQueryData(api.shopping.owner.stall.queryKey({ merchantOrgId: v.orgId }), v),
    }),
    oven: useMutation({
      ...api.shopping.owner.setBakeryState.mutationOptions(),
      onSuccess: (v: BakeryOwnerView) => {
        qc.setQueryData(api.shopping.owner.bakery.queryKey({ merchantOrgId: v.orgId }), v);
        // The board's open/closed pill reads the same switch: refresh it now, not on its next poll.
        void qc.invalidateQueries(api.merchant.storeStatus.pathFilter());
      },
    }),
  };
}
