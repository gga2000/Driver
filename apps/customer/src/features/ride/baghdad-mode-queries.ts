import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { awayCityAt } from '@driver/contracts';
import { useMyBookings, useNetwork } from '@/features/rajaa/queries';
import { useNow } from '@/features/rajaa/useNow';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { BAGHDAD_MODE_POLL_MS, baghdadModeState, boardUntil, corridorBack, type BaghdadModeState } from './baghdad-mode';
import { useGrantedPosition } from './phone-position';

/**
 * Ride idea n9 «Baghdad mode» data: the phone's position (only when already allowed), the far city it
 * is in, that city's board of cars back to Aziziyah (`routes.board`, re-read every 30 s) and his own
 * seats (`routes.myBookings`). Signed out, or with no position, nothing is read beyond the network.
 */
export function useBaghdadMode(online: boolean): { state: BaghdadModeState; now: Date; refetch: () => void } {
  const api = useApi();
  const signedIn = useSignedIn();
  const now = useNow(30_000);
  const position = useGrantedPosition(signedIn);
  const network = useNetwork();
  const cityId = signedIn ? awayCityAt(position.data ?? null, network.data?.garages ?? []) : null;
  const corridorId = corridorBack(network.data, cityId);
  const board = useQuery({
    ...api.routes.board.queryOptions({ corridorId: corridorId ?? 'none', direction: 'to_aziziyah', to: boardUntil(now) }),
    enabled: signedIn && !!corridorId,
    staleTime: 10_000,
    refetchInterval: BAGHDAD_MODE_POLL_MS,
    placeholderData: keepPreviousData,
  });
  const bookings = useMyBookings();
  const state = signedIn
    ? baghdadModeState({
        cityId,
        network: network.data,
        board: { data: board.data?.departures, isError: board.isError || network.isError },
        bookings: bookings.data,
        online,
        now,
      })
    : ({ kind: 'hidden' } as const);
  return {
    state,
    now,
    refetch: () => {
      if (network.isError) void network.refetch();
      void board.refetch();
      void bookings.refetch();
    },
  };
}
