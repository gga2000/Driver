import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * Money (owners only — the API answers FORBIDDEN to staff): today's sales, the cash account with the
 * open "اطلب فلوسك", the weekly statement and disputes. `enabled` carries `canSeeMoney`.
 */
export function useMoneyToday(merchantOrgId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.money.today.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && enabled && !!merchantOrgId, refetchInterval: 60_000 });
}

/** «منو سوّى شنو»: the day's kitchen actions with who did each (owner only; `enabled` carries `canSeeMoney`). */
export function useActivityToday(merchantOrgId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.activity.today.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && enabled && !!merchantOrgId, refetchInterval: 60_000 });
}

/** One order's who-line for the order sheet (owner only), read when the sheet opens. */
export function useOrderWho(merchantOrgId: string | null, orderId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.activity.order.queryOptions({ merchantOrgId: merchantOrgId ?? '', orderId: orderId ?? '' }),
    enabled: signedIn && enabled && !!merchantOrgId && !!orderId,
    staleTime: 15_000,
  });
}

/** Polled faster while a request is on its way, so "استلمتها" shows up by itself. */
export function useCashAccount(merchantOrgId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.money.cash.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && enabled && !!merchantOrgId,
    refetchInterval: (q) => (q.state.data?.request && q.state.data.request.state !== 'handed_over' ? 10_000 : 60_000),
  });
}

export function useStatement(merchantOrgId: string | null, weekOf: Date, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.money.statement.queryOptions({ merchantOrgId: merchantOrgId ?? '', weekOf }),
    enabled: signedIn && enabled && !!merchantOrgId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useDisputes(merchantOrgId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.money.disputes.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && enabled && !!merchantOrgId, refetchInterval: 120_000 });
}

export function useRespondDispute() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ ...api.merchantAdmin.money.respondDispute.mutationOptions(), onSettled: () => void qc.invalidateQueries(api.merchantAdmin.money.disputes.pathFilter()) });
}

/** "اطلب فلوسك" from the Money screen: refreshes the cash account and the header balance. */
export function useRequestMoney() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.ledger.requestSettlement.mutationOptions(),
    onSettled: () => {
      void qc.invalidateQueries(api.merchantAdmin.money.cash.pathFilter());
      void qc.invalidateQueries(api.ledger.merchantBalance.pathFilter());
    },
  });
}

/** Signed upload ticket for an evidence photo (`places.photoUpload`). */
export function usePhotoTicket() {
  const api = useApi();
  return useMutation(api.places.photoUpload.mutationOptions());
}
