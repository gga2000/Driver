import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** Staff (owners only): list, invite by phone, change role, remove. */
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
    invite: useMutation({ ...api.merchantAdmin.staff.invite.mutationOptions(), onSettled: refresh }),
    setRole: useMutation({ ...api.merchantAdmin.staff.setRole.mutationOptions(), onSettled: refresh }),
    remove: useMutation({ ...api.merchantAdmin.staff.remove.mutationOptions(), onSettled: refresh }),
  };
}
