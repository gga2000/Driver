import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { projectionKey, type ProposeInput } from './logic';

export function useDeals(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.merchantAdmin.deals.list.queryOptions({ merchantOrgId: merchantOrgId ?? '' }), enabled: signedIn && !!merchantOrgId, refetchInterval: 60_000 });
}

/** Holds a value until it has been still for `ms` (the projection waits for the owner to stop tapping). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  const json = JSON.stringify(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
    // The JSON form is the dependency: a fresh object with the same content is the same draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, ms]);
  return settled;
}

/** Server-side projected cost of the draft (owner only); the last answer stays while a new one loads. */
export function useDealProjection(input: ProposeInput | null, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  const settled = useSettled(input ? projectionKey(input) : null, 350);
  return useQuery({
    ...api.merchantAdmin.deals.project.queryOptions(settled ?? { merchantOrgId: '', type: 'free_delivery', nameAr: '--', schedule: { startsAt: new Date(0), endsAt: new Date(0) } }),
    enabled: signedIn && enabled && settled !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

export function useDealActions() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries(api.merchantAdmin.deals.list.pathFilter());
  return {
    propose: useMutation({ ...api.merchantAdmin.deals.propose.mutationOptions(), onSettled: refresh }),
    setActive: useMutation({ ...api.merchantAdmin.deals.setActive.mutationOptions(), onSettled: refresh }),
  };
}
