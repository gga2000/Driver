import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * Account data (customer spec §9–10): saved places, profile, wallet, household. Every mutation
 * invalidates the reads it changes so screens refresh themselves.
 */

export function useMe() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.identity.me.queryOptions(), enabled: signedIn });
}

export function useMyPlaces() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.places.mine.queryOptions(), enabled: signedIn });
}

/** Invalidates everything a place change can touch. */
function usePlacesInvalidation() {
  const api = useApi();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: api.places.mine.queryKey() });
}

export function useSavePlace() {
  const api = useApi();
  const invalidate = usePlacesInvalidation();
  return useMutation(api.places.save.mutationOptions({ onSuccess: () => void invalidate() }));
}

export function useUpdatePlace() {
  const api = useApi();
  const invalidate = usePlacesInvalidation();
  return useMutation(api.places.update.mutationOptions({ onSuccess: () => void invalidate() }));
}

export function useRemovePlace() {
  const api = useApi();
  const invalidate = usePlacesInvalidation();
  return useMutation(api.places.remove.mutationOptions({ onSuccess: () => void invalidate() }));
}

export function useConfirmPlace() {
  const api = useApi();
  const invalidate = usePlacesInvalidation();
  return useMutation(api.places.confirm.mutationOptions({ onSuccess: () => void invalidate() }));
}

export function useUpdateProfile() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation(
    api.identity.updateProfile.mutationOptions({
      onSuccess: (me) => qc.setQueryData(api.identity.me.queryKey(), me),
    }),
  );
}

export function useWalletBalance() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.wallet.balance.queryOptions(), enabled: signedIn });
}

export function useWalletLines(limit = 30) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.wallet.transactions.queryOptions({ limit }), enabled: signedIn });
}

export function useTopupOptions() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.wallet.topupOptions.queryOptions(), enabled: signedIn, staleTime: 10 * 60_000 });
}

export function useClaimPoints() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation(
    api.wallet.claimPoints.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: api.wallet.balance.queryKey() });
        void qc.invalidateQueries({ queryKey: api.wallet.transactions.queryKey() });
      },
    }),
  );
}

export function useHousehold() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.household.mine.queryOptions(), enabled: signedIn });
}

/** Household writes refresh the household and the wallet (its household balance line). */
function useHouseholdInvalidation() {
  const api = useApi();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: api.household.mine.queryKey() });
    void qc.invalidateQueries({ queryKey: api.wallet.balance.queryKey() });
    void qc.invalidateQueries({ queryKey: api.places.mine.queryKey() });
  };
}

export function useCreateHousehold() {
  const api = useApi();
  const invalidate = useHouseholdInvalidation();
  return useMutation(api.household.create.mutationOptions({ onSuccess: invalidate }));
}

export function useInviteMember() {
  const api = useApi();
  const invalidate = useHouseholdInvalidation();
  return useMutation(api.household.inviteMember.mutationOptions({ onSuccess: invalidate }));
}

export function useSetLimit() {
  const api = useApi();
  const invalidate = useHouseholdInvalidation();
  return useMutation(api.household.setLimit.mutationOptions({ onSuccess: invalidate }));
}

export function useResolveApproval() {
  const api = useApi();
  const invalidate = useHouseholdInvalidation();
  const approve = useMutation(api.household.approve.mutationOptions({ onSuccess: invalidate }));
  const decline = useMutation(api.household.decline.mutationOptions({ onSuccess: invalidate }));
  return { approve, decline };
}

/** People the customer ordered for (order participants with a name), newest first. */
export function useSavedPeople() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.mine.queryOptions(),
    enabled: signedIn,
    select: (orders) => {
      const seen = new Map<string, { key: string; name: string; role: string; lastAt: Date }>();
      for (const o of [...orders].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())) {
        for (const p of o.participants) {
          const name = p.label?.trim();
          if (!name) continue;
          const key = p.personId ?? `label:${name}`;
          if (!seen.has(key)) seen.set(key, { key, name, role: p.role, lastAt: o.placedAt });
        }
      }
      return [...seen.values()];
    },
  });
}
