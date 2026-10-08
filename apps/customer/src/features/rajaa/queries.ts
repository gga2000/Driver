import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgreementView, BookingView, DemandPostView, IntercityDirection, IntercityNetwork, RajaaDriverCard, RequestPlaceId, RequestPostView, RequestTripKind, TravellingAs } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { activeBooking, boardSummary, DEFAULT_DIRECTION, isLiveBooking, PRIMARY_CORRIDOR, RAJAA_RULES, publicPlaceName } from './logic';

/**
 * الرجعة queries (routes router). The board polls every 5 s while a screen shows it; bookings and the
 * boarding pass poll while something is live. Mutations invalidate the whole `routes` namespace so
 * every board, pass and banner catches up at once.
 */

export interface BoardKey {
  corridorId: string;
  direction: IntercityDirection;
  travellingAs?: TravellingAs;
  /** A preset window («احجز رجعتك», r2) instead of "from now". */
  window?: { from: Date; to: Date } | null;
}

/** Garages, corridors (seat prices) and meeting points. Changes rarely. */
export function useNetwork() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.routes.network.queryOptions(), enabled: signedIn, staleTime: 10 * 60_000 });
}

export function garageName(network: IntercityNetwork | undefined, id: string): string {
  const name = network?.garages.find((g) => g.id === id)?.nameAr;
  return name ? publicPlaceName(name) : '';
}

/** Live departure board for one corridor and direction, polled every 5 s. */
export function useBoard(key: BoardKey, opts: { poll?: boolean } = {}) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.board.queryOptions({
      corridorId: key.corridorId,
      direction: key.direction,
      ...(key.travellingAs ? { travellingAs: key.travellingAs } : {}),
      ...(key.window ? { from: key.window.from, to: key.window.to } : {}),
    }),
    enabled: signedIn,
    staleTime: 2_000,
    refetchInterval: opts.poll === false ? false : RAJAA_RULES.pollMs,
    placeholderData: (prev) => prev,
  });
}

/**
 * Today's cars on every line, for the «بغداد» / «الكوت» cards (s1): one read per corridor, the same
 * span as the board, not polled (the picked line's own board polls).
 */
export function useCorridorBoards(corridorIds: readonly string[], direction: IntercityDirection, span: { from: Date; to: Date }) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQueries({
    queries: corridorIds.map((corridorId) => ({
      ...api.routes.board.queryOptions({ corridorId, direction, from: span.from, to: span.to }),
      enabled: signedIn,
      staleTime: 30_000,
    })),
  });
}

/**
 * Who drives each departure (`routes.driverCards`, audit C-19): first name, today's check-in, photo.
 * One read for a whole board (ids sorted so the key is stable); cards change rarely.
 */
export function useDriverCards(departureIds: readonly string[]) {
  const api = useApi();
  const signedIn = useSignedIn();
  const ids = [...new Set(departureIds)].sort().slice(0, 30);
  return useQuery({
    ...api.routes.driverCards.queryOptions({ departureIds: ids.length > 0 ? ids : ['none'] }),
    enabled: signedIn && ids.length > 0,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    select: (cards: RajaaDriverCard[]) => new Map(cards.map((c) => [c.departureId, c])),
  });
}

/** «ملفه» (x12–x17): the driver of a departure the rider can see. Not polled; a minute fresh is plenty. */
export function useDriverProfile(departureId: string | undefined) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.driverProfile.queryOptions({ departureId: departureId ?? 'none' }),
    enabled: signedIn && !!departureId,
    staleTime: 60_000,
  });
}

export function useMyBookings() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.myBookings.queryOptions(),
    enabled: signedIn,
    refetchInterval: (q) => (q.state.data?.some((b) => isLiveBooking(b, new Date())) ? RAJAA_RULES.pollMs : false),
  });
}

export function useBooking(id: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.myBookings.queryOptions(),
    enabled: signedIn && !!id,
    select: (all: BookingView[]) => all.find((b) => b.id === id) ?? null,
    refetchInterval: RAJAA_RULES.pollMs,
  });
}

/** Live hold or next booked trip, for the pinned pill on the board and the home card. */
export function useActiveBooking() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.myBookings.queryOptions(),
    enabled: signedIn,
    select: (all: BookingView[]) => activeBooking(all, new Date()),
    refetchInterval: (q) => (q.state.data?.some((b) => isLiveBooking(b, new Date())) ? 15_000 : false),
  });
}

export function useBoardingPass(bookingId: string, enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.boardingPass.queryOptions({ bookingId }),
    enabled: signedIn && enabled && !!bookingId,
    refetchInterval: RAJAA_RULES.pollMs,
    retry: false,
  });
}

function useInvalidateRoutes() {
  const api = useApi();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: api.routes.pathKey() });
}

export function useHoldSeat() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.holdSeat.mutationOptions({ onSettled: () => void invalidate() }));
}

export function useBookSeat() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.bookSeat.mutationOptions({ onSettled: () => void invalidate() }));
}

export function useCancelSeat() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.cancelSeat.mutationOptions({ onSettled: () => void invalidate() }));
}

/**
 * Step 4: the rider's agreed-price asks on one departure. Polls every 5 s while one waits on the
 * driver (asked) or on him (priced), so the driver's price shows up without a refresh.
 */
export function useMyAgreements(departureId: string | undefined) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.agreements.mine.queryOptions({ departureId: departureId ?? '' }),
    enabled: signedIn && !!departureId,
    refetchInterval: (q) => (q.state.data?.some((a: AgreementView) => a.state === 'asked' || a.state === 'proposed') ? RAJAA_RULES.pollMs : false),
  });
}

export function useAskAgreement() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.agreements.ask.mutationOptions({ onSettled: () => void invalidate() }));
}

export function useRespondAgreement() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.agreements.respond.mutationOptions({ onSettled: () => void invalidate() }));
}

export function useWithdrawAgreement() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.agreements.withdraw.mutationOptions({ onSettled: () => void invalidate() }));
}

/** «شلون كانت الرجعة؟» (r2): stars and chips once; the bookings list picks up the rating. */
export function useRateBooking() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.rateBooking.mutationOptions({ onSettled: () => void invalidate() }));
}

export function useImHere() {
  const api = useApi();
  return useMutation(api.routes.imHere.mutationOptions());
}

// ── demand board ──

export function useMyDemand() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.myDemand.queryOptions(),
    enabled: signedIn,
    // An open post can be claimed by a driver's announcement at any moment.
    refetchInterval: (q) => (q.state.data?.some((p: DemandPostView) => p.state === 'open') ? RAJAA_RULES.pollMs : false),
  });
}

export function usePostDemand() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.postDemand.mutationOptions({ onSettled: () => void invalidate() }));
}

export function useCancelDemand() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.cancelDemand.mutationOptions({ onSettled: () => void invalidate() }));
}

// ── request board ──

export function useMyRequests() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.requestBoard.mine.queryOptions(),
    enabled: signedIn,
    refetchInterval: (q) => (q.state.data?.some((r: RequestPostView) => r.state === 'open') ? RAJAA_RULES.pollMs : false),
  });
}

/** p1: what a private trip to a known place usually costs; off until a chip names the place. */
export function useUsualRange(placeId: RequestPlaceId | null, trip: RequestTripKind) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.routes.requestBoard.usualRange.queryOptions({ placeId: placeId ?? 'kut', trip }),
    enabled: signedIn && placeId !== null,
    staleTime: 10 * 60_000,
  });
}

export function usePostRequest() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.requestBoard.post.mutationOptions({ onSettled: () => void invalidate() }));
}

export function usePickOffer() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.requestBoard.pick.mutationOptions({ onSettled: () => void invalidate() }));
}

export function useCancelRequest() {
  const api = useApi();
  const invalidate = useInvalidateRoutes();
  return useMutation(api.routes.requestBoard.cancel.mutationOptions({ onSettled: () => void invalidate() }));
}

// ── home card ──

/** Home's الرجعة card: the live primary corridor board (way back to Aziziyah) and the rider's own trip. */
export function useRajaaHome(direction: IntercityDirection = DEFAULT_DIRECTION) {
  const board = useBoard({ corridorId: PRIMARY_CORRIDOR, direction }, { poll: false });
  const network = useNetwork();
  const trip = useActiveBooking();
  const summary = board.data ? boardSummary(board.data.departures, new Date()) : null;
  return {
    loading: board.isPending,
    error: board.isError,
    count: summary?.count ?? 0,
    next: summary?.next ?? null,
    garage: garageName(network.data, trip.data?.departure.garageId ?? summary?.next?.garageId ?? 'mp_garage_nahdha'),
    trip: trip.data ?? null,
    /** Far city of the trip's corridor (the card names the rider's own route when there is a trip). */
    tripCityId: trip.data ? (network.data?.corridors.find((c) => c.id === trip.data!.departure.corridorId)?.cityId ?? 'baghdad') : null,
  };
}
