import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarDate, DinnerSource } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * Joy J7d reads and writes (`rideHabits.*`). Every write refreshes what it changes: favourites, the
 * regular trips, the occurrence, and the orders list when a ride was booked.
 */

export function useFavourites() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.rideHabits.favourites.queryOptions(), enabled: signedIn, staleTime: 60_000 });
}

export function useRecentGoodDriver() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.rideHabits.recentGood.queryOptions(), enabled: signedIn, staleTime: 60_000 });
}

function useFavouritesRefresh() {
  const api = useApi();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: api.rideHabits.favourites.queryKey() });
    void qc.invalidateQueries({ queryKey: api.rideHabits.recentGood.queryKey() });
    void qc.invalidateQueries({ queryKey: api.rideHabits.regular.list.queryKey() });
  };
}

export function useSetFavourite() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = useFavouritesRefresh();
  return useMutation({
    ...api.rideHabits.favourite.mutationOptions(),
    onSuccess: (list) => {
      qc.setQueryData(api.rideHabits.favourites.queryKey(), list);
      refresh();
    },
  });
}

export function useUnfavourite() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = useFavouritesRefresh();
  return useMutation({
    ...api.rideHabits.unfavourite.mutationOptions(),
    onSuccess: (list) => {
      qc.setQueryData(api.rideHabits.favourites.queryKey(), list);
      refresh();
    },
  });
}

export function useRegularTrips() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.rideHabits.regular.list.queryOptions(), enabled: signedIn, staleTime: 30_000, refetchInterval: 60_000 });
}

export function useSaveRegularTrip() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ ...api.rideHabits.regular.save.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: api.rideHabits.regular.list.queryKey() }) });
}

export function useRemoveRegularTrip() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ ...api.rideHabits.regular.remove.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: api.rideHabits.regular.list.queryKey() }) });
}

export function useOccurrence(id: string | undefined, date: CalendarDate | undefined) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.rideHabits.regular.occurrence.queryOptions({ id: id ?? '', date: date ?? '2026-01-01' }), enabled: signedIn && Boolean(id && date), placeholderData: keepPreviousData });
}

function useOccurrenceRefresh() {
  const api = useApi();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: api.rideHabits.regular.list.queryKey() });
    void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
    void qc.invalidateQueries({ queryKey: api.routes.myBookings.queryKey() });
  };
}

export function useConfirmOccurrence() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = useOccurrenceRefresh();
  return useMutation({
    ...api.rideHabits.regular.confirm.mutationOptions(),
    onSuccess: (view) => {
      qc.setQueryData(api.rideHabits.regular.occurrence.queryKey({ id: view.trip.id, date: view.occurrence.date }), view);
      refresh();
    },
  });
}

export function useSkipOccurrence() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = useOccurrenceRefresh();
  return useMutation({
    ...api.rideHabits.regular.skip.mutationOptions(),
    onSuccess: (view) => {
      qc.setQueryData(api.rideHabits.regular.occurrence.queryKey({ id: view.trip.id, date: view.occurrence.date }), view);
      refresh();
    },
  });
}

/** A ride home or a الرجعة to Aziziyah on now (polled while the app is open; cheap on the server). */
export function useDinnerChance(enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.rideHabits.dinnerChance.queryOptions(), enabled: signedIn && enabled, refetchInterval: 60_000, staleTime: 30_000 });
}

export function useDinnerTime(source: DinnerSource | null, merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  const input = source && merchantOrgId ? { source, merchantOrgId } : { source: { kind: 'ride' as const, orderId: '-' }, merchantOrgId: '-' };
  return useQuery({ ...api.rideHabits.dinnerTime.queryOptions(input), enabled: signedIn && Boolean(source && merchantOrgId), refetchInterval: 60_000, retry: false });
}
