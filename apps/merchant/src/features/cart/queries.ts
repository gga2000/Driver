import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CartOwnerView } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** Is this store a food cart («عربانة»)? Decides the orders tab (cart mode or the board); it never changes. */
export function useCartMode(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.foodCarts.owner.mode.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    staleTime: Infinity,
  });
}

/** The cart tonight: open or not, where, the walk-over tickets and tonight's cash. Polled every 5 s, so a new ticket rings soon. */
export function useCartOwner(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.foodCarts.owner.get.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: 5_000,
  });
}

/** Every owner action answers with the fresh view, which replaces the cached one. */
export function useCartActions() {
  const api = useApi();
  const qc = useQueryClient();
  const put = (view: CartOwnerView) => qc.setQueryData(api.foodCarts.owner.get.queryKey({ merchantOrgId: view.cart.merchantOrgId }), view);
  const refresh = () => void qc.invalidateQueries(api.foodCarts.owner.get.pathFilter());
  return {
    openHere: useMutation({ ...api.foodCarts.owner.openHere.mutationOptions(), onSuccess: put }),
    close: useMutation({ ...api.foodCarts.owner.close.mutationOptions(), onSuccess: put }),
    settings: useMutation({ ...api.foodCarts.owner.settings.mutationOptions(), onSuccess: put }),
    ready: useMutation({ ...api.foodCarts.owner.ready.mutationOptions(), onSuccess: put, onError: refresh }),
    reject: useMutation({ ...api.foodCarts.owner.reject.mutationOptions(), onSuccess: put, onError: refresh }),
    collect: useMutation({ ...api.foodCarts.owner.collect.mutationOptions(), onSuccess: put, onError: refresh }),
    /** «شنو عندك الليلة؟»: a dish on or off (the menu's own switch), then the cart re-read. */
    dish: useMutation({ ...api.merchantAdmin.menu.setAvailability.mutationOptions(), onSettled: refresh }),
  };
}
