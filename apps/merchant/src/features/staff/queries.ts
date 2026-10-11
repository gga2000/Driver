import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** Staff (owners only): list, invite by phone, resend or cancel a waiting invite, change role, remove. */
export function useStaff(merchantOrgId: string | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.staff.list.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && enabled && !!merchantOrgId });
}

export function useStaffActions() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries(api.merchantAdmin.staff.list.pathFilter());
    // A role change can move the signed-in owner out of money views.
    void qc.invalidateQueries(api.merchant.myStores.pathFilter());
  };
  return {
    invite: useMutation({
      ...api.merchantAdmin.staff.invite.mutationOptions(),
      onSettled: refresh,
    }),
    setRole: useMutation({
      ...api.merchantAdmin.staff.setRole.mutationOptions(),
      onSettled: refresh,
    }),
    remove: useMutation({
      ...api.merchantAdmin.staff.remove.mutationOptions(),
      onSettled: refresh,
    }),
    resend: useMutation({
      ...api.merchantAdmin.staff.resendInvite.mutationOptions(),
      onSettled: refresh,
    }),
  };
}

/**
 * PRV-08: invites waiting for the signed-in person (any store; he may hold no role anywhere yet).
 * Shown on the store picker and on the "not activated" gate.
 */
export function useMyInvites() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.staff.myInvites.queryOptions(), enabled: signedIn, staleTime: 30_000 });
}

/** Accept (joins the store with the invite's role) or decline; the stores and invites read again after. */
export function useRespondInvite() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.merchantAdmin.staff.respondInvite.mutationOptions(),
    onSuccess: (left) => qc.setQueryData(api.merchantAdmin.staff.myInvites.queryKey(), left),
    onSettled: () => Promise.all([qc.invalidateQueries(api.merchant.myStores.pathFilter()), qc.invalidateQueries(api.merchantAdmin.staff.myInvites.pathFilter())]),
  });
}
