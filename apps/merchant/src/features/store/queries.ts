import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MerchantStore } from '@driver/contracts';
import { pickStore, type StoreAccess } from '@/lib/guard';
import { useApi } from '@/lib/api';
import { usePrefs } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';

/** Stores this person works at (owner or staff). Empty = not activated yet. */
export function useMyStores() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchant.myStores.queryOptions(), enabled: signedIn, staleTime: 60_000 });
}

/**
 * The store this device works for and whether the person may see money (owners only — spec: "roles
 * gate money views"). `access` drives the route guard.
 */
export function useCurrentStore(): { access: StoreAccess; store: MerchantStore | null; stores: MerchantStore[]; canSeeMoney: boolean } {
  const prefs = usePrefs();
  const stores = useMyStores();
  const { access, store } = pickStore(stores.data, prefs.storeId);
  return { access: stores.isError && !stores.data ? 'loading' : access, store, stores: stores.data ?? [], canSeeMoney: store?.role === 'owner' };
}

/** Open/closed, pause window, busy mode, printer marker. Polled so busy mode's end shows up by itself. */
export function useStoreStatus(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchant.storeStatus.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: 30_000,
  });
}

export function useStoreSwitches() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries(api.merchant.storeStatus.pathFilter());
  };
  return {
    setOpen: useMutation({ ...api.merchant.setOpen.mutationOptions(), onSuccess: (s) => qc.setQueryData(api.merchant.storeStatus.queryKey({ merchantOrgId: s.merchantOrgId }), s), onSettled: refresh }),
    setBusy: useMutation({ ...api.merchant.setBusy.mutationOptions(), onSuccess: (s) => qc.setQueryData(api.merchant.storeStatus.queryKey({ merchantOrgId: s.merchantOrgId }), s), onSettled: refresh }),
    setPrinterStatus: useMutation({ ...api.merchant.setPrinterStatus.mutationOptions(), onSettled: refresh }),
  };
}

/** Live cash balance (decisions §3): owners only. */
export function useBalance(merchantOrgId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.ledger.merchantBalance.queryOptions({ merchantId: merchantOrgId ?? '' }),
    enabled: signedIn && enabled && !!merchantOrgId,
    refetchInterval: 60_000,
  });
}

/** "اطلب فلوسك". */
export function useRequestSettlement() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.ledger.requestSettlement.mutationOptions(),
    onSettled: () => {
      void qc.invalidateQueries(api.ledger.merchantBalance.pathFilter());
      // S-M5: the header pill turns into "فلوسك جاية قبل …".
      void qc.invalidateQueries(api.merchantAdmin.money.cash.pathFilter());
    },
  });
}
