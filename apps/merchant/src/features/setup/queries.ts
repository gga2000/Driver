import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MenuCards, MerchantSetupView } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * «جهّز محلك» reads and writes (`merchant.setup.*`, owner only). Every write puts the fresh view in
 * place and refreshes what it touches: the board's status line (the ring, the setup card), the menu.
 */

/** This app session's own memory: setup opened once by itself, and a practice order started from it. */
export const setupSession = { landed: false, practiceFromSetup: false, welcomed: false };

export function useSetup(merchantOrgId: string | null, enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchant.setup.get.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && enabled && !!merchantOrgId, staleTime: 5_000 });
}

/** The read dishes as cards; polled while Driver's team is still writing them. */
export function useMenuCards(merchantOrgId: string | null, enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchant.setup.menuCards.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && enabled && !!merchantOrgId,
    refetchInterval: (q) => (q.state.data?.state === 'reading' ? 15_000 : false),
  });
}

/** The person signed in (his name comes from the vault through `identity.me`, nowhere else). */
export function useMe() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.identity.me.queryOptions(), enabled: signedIn, staleTime: 5 * 60_000 });
}

export function useSetupActions() {
  const api = useApi();
  const qc = useQueryClient();
  const touched = () => {
    void qc.invalidateQueries(api.merchant.storeStatus.pathFilter());
    void qc.invalidateQueries(api.merchantAdmin.menu.get.pathFilter());
    void qc.invalidateQueries(api.merchant.hours.pathFilter());
  };
  const put = (v: MerchantSetupView) => {
    qc.setQueryData(api.merchant.setup.get.queryKey({ merchantOrgId: v.merchantOrgId }), v);
    touched();
  };
  const putCards = (c: MenuCards) => {
    qc.setQueryData(api.merchant.setup.menuCards.queryKey({ merchantOrgId: c.merchantOrgId }), c);
    void qc.invalidateQueries(api.merchant.setup.get.pathFilter());
    touched();
  };
  return {
    confirmKinds: useMutation({ ...api.merchant.setup.confirmKinds.mutationOptions(), onSuccess: put }),
    check: useMutation({ ...api.merchant.setup.check.mutationOptions(), onSuccess: put }),
    seePayout: useMutation({ ...api.merchant.setup.seePayout.mutationOptions(), onSuccess: put }),
    shopPhoto: useMutation({ ...api.merchant.setup.shopPhoto.mutationOptions(), onSuccess: put }),
    dishPhoto: useMutation({ ...api.merchant.setup.dishPhoto.mutationOptions(), onSuccess: put }),
    startMenu: useMutation({ ...api.merchant.setup.startMenu.mutationOptions(), onSuccess: putCards }),
    menuDraft: useMutation({ ...api.merchant.setup.menuDraft.mutationOptions(), onSuccess: putCards }),
    answer: useMutation({ ...api.merchant.setup.answer.mutationOptions(), onSuccess: putCards }),
    goLive: useMutation({ ...api.merchant.setup.goLive.mutationOptions(), onSuccess: put }),
    firstOrderSeen: useMutation({ ...api.merchant.setup.firstOrderSeen.mutationOptions(), onSuccess: put }),
  };
}
