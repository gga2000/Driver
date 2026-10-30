import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { DeliveryPoint, ParcelDoorPage, ParcelSize, ParcelView } from '@driver/contracts';
import { useApi, useApiClient } from '@/lib/api';
import { publicPageFailure, shouldRetryQuery } from '@/lib/errors';
import { useSignedIn } from '@/lib/session';
import { useHousehold, useMe } from '@/features/account/queries';
import { fetchOptions } from '@/features/rajaa/fetch';
import type { RiderOption } from '@/features/ride/rider';
import { pollMs } from './logic';

export const PARCEL_CITY_ID = 'aziziyah';

/**
 * The receiver's link comes back only from `parcels.send` and `parcels.newDoorLink` (the server keeps its
 * hash, never the link). The page remembers it here for this app session, so «دز الرابط» works right after
 * sending; after a restart the sender asks for a new one.
 */
const doorLinks = new Map<string, string>();
export function rememberDoorLink(view: Pick<ParcelView, 'id' | 'doorLink'>): void {
  if (view.doorLink) doorLinks.set(view.id, view.doorLink);
}
export function rememberedDoorLink(parcelId: string): string | null {
  return doorLinks.get(parcelId) ?? null;
}

/**
 * The people «لمنو الطرد؟» offers: his trusted people and his household. Whatever has not loaded (or failed)
 * is simply not offered; «شخص ثاني» always works.
 */
export function useReceiverOptions(): RiderOption[] {
  const me = useMe();
  const household = useHousehold();
  return useMemo(() => fetchOptions(me.data?.trustedContacts, household.data), [me.data, household.data]);
}

/** «دزّه»'s fare from the server for this parcel to the receiver's area; nothing until both ends are known. */
export function useParcelQuote(pickup: DeliveryPoint | null, dropZoneKey: string | null, size: ParcelSize) {
  const api = useApi();
  const signedIn = useSignedIn();
  const input = { cityId: PARCEL_CITY_ID, pickup: pickup ?? { zoneKey: 'none' }, dropZoneKey: dropZoneKey ?? 'none', size };
  return useQuery({
    ...api.parcels.quote.queryOptions(input),
    enabled: signedIn && Boolean(pickup && dropZoneKey),
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
    staleTime: 60_000,
  });
}

/** One parcel's page; refreshed while something is still to happen (the courier part also streams on its order). */
export function useParcel(parcelId: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.parcels.get.queryOptions({ parcelId }),
    enabled: signedIn && Boolean(parcelId),
    retry: shouldRetryQuery,
    refetchInterval: (q) => pollMs(q.state.data?.state),
  });
}

/** Puts a fresh view (after send, cancel or a new link) on the page without another read. */
export function useParcelCache() {
  const api = useApi();
  const qc = useQueryClient();
  return (view: ParcelView) => {
    rememberDoorLink(view);
    qc.setQueryData(api.parcels.get.queryKey({ parcelId: view.id }), view);
    void qc.invalidateQueries({ queryKey: api.parcels.mine.queryKey() });
  };
}

/**
 * The receiver's page (public, by the link's token). Keeps asking every 20 s while the door is not set, so a
 * page left open turns into «الدليفري جاي» by itself; a closed link stops.
 */
export function useDoorPage(token: string) {
  const api = useApi();
  return useQuery({
    ...api.parcels.door.get.queryOptions({ token }),
    enabled: token.length >= 16,
    retry: shouldRetryQuery,
    refetchInterval: (q) => {
      if (q.state.status === 'error') return publicPageFailure(q.state.error) === 'transient' ? 30_000 : false;
      const d = q.state.data;
      return d && d.state !== 'delivered' && d.state !== 'cancelled' && d.state !== 'returned' ? 20_000 : false;
    },
  });
}

/** `parcels.door.set` for the receiver's page; the answer replaces the page's data. */
export function useSetDoor(token: string) {
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  return async (input: { pin: { lat: number; lng: number }; doorNote?: string }): Promise<ParcelDoorPage> => {
    const page = await client.parcels.door.set.mutate({ token, pin: input.pin, ...(input.doorNote ? { doorNote: input.doorNote } : {}) });
    qc.setQueryData(api.parcels.door.get.queryKey({ token }), page);
    return page;
  };
}
