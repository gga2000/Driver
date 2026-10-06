import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { LatLng } from '@driver/contracts';
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

/** Saved places are Aziziyah's for now (`toSaveInput` saves them there). */
export const PLACE_CITY_ID = 'aziziyah';

/**
 * "قرب شنو؟" (`places.landmarksNear`, maps program a2): the landmarks near the pin being saved. The
 * pin is keyed to ~1 m so a settled map asks once; the last list stays on screen while the next loads.
 */
export function useLandmarksNear(pin: LatLng | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  const key = { cityId: PLACE_CITY_ID, pin: pin ? { lat: Math.round(pin.lat * 1e5) / 1e5, lng: Math.round(pin.lng * 1e5) / 1e5 } : { lat: 0, lng: 0 } };
  return useQuery({ ...api.places.landmarksNear.queryOptions(key), enabled: signedIn && pin !== null, placeholderData: keepPreviousData, staleTime: 10 * 60_000 });
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

/** "شحن المحفظة": asks for a 6-digit cash top-up code. */
export function useRequestTopUp() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation(
    api.wallet.requestTopUp.mutationOptions({
      onSuccess: (view) => {
        // The code screen polls this request by id: start it from the answer, not a blank fetch.
        qc.setQueryData(api.wallet.topUpStatus.queryKey({ topUpId: view.topUpId }), view);
        void qc.invalidateQueries({ queryKey: api.wallet.topUpStatus.queryKey({}) });
      },
    }),
  );
}

/**
 * A top-up request (by id, else the latest), polled every 3 s while it waits for the agent or courier;
 * when it lands the balance and lines refresh.
 */
export function useTopUpStatus(topUpId?: string) {
  const api = useApi();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const q = useQuery({
    ...api.wallet.topUpStatus.queryOptions(topUpId ? { topUpId } : {}),
    enabled: signedIn,
    refetchInterval: (query) => (query.state.data?.state === 'pending' ? 3000 : false),
  });
  const landed = q.data?.state === 'confirmed' ? q.data.topUpId : null;
  useEffect(() => {
    if (!landed) return;
    void qc.invalidateQueries({ queryKey: api.wallet.balance.queryKey() });
    void qc.invalidateQueries({ queryKey: api.wallet.transactions.queryKey() });
  }, [landed, qc, api]);
  return q;
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

/** Joy w4: a member's monthly budget on the household wallet (payer only). */
export function useSetBudget() {
  const api = useApi();
  const invalidate = useHouseholdInvalidation();
  return useMutation(api.household.setBudget.mutationOptions({ onSuccess: invalidate }));
}

/** Joy w6 «شهرك»: the caller's month (the current one when `month` is undefined). */
export function useMonth(month: string | undefined, opts: { enabled?: boolean } = {}) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.wallet.month.queryOptions(month ? { month } : {}), enabled: signedIn && (opts.enabled ?? true), placeholderData: keepPreviousData });
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

// ── خطوط children's photos (Ali, 2026-10-06) ──

/** The guardian's own خطوط children with the photo of each (only their run's driver ever sees it). */
export function useGuardianChildren() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.khat.guardian.children.queryOptions(), enabled: signedIn });
}

/** Add / replace and remove a child's photo; the list re-reads. */
export function useChildPhotoMutations() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: api.khat.guardian.children.queryKey() });
  return {
    set: useMutation({ ...api.khat.guardian.setPhoto.mutationOptions(), onSuccess: refresh }),
    remove: useMutation({ ...api.khat.guardian.removePhoto.mutationOptions(), onSuccess: refresh }),
  };
}
