import { keepPreviousData, useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { NEARBY_RULES, type LatLng, type NearbyVehicles, type Quote } from '@driver/contracts';
import { liteInterval, useLiteMode } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { CITY_ID, quoteMinute, rideQuoteRequest, RIDE_VERTICALS, spotPoint, type RideVertical, type Spot } from './logic';

/** Landmarks for "وين رايح؟" (`places.landmarks`): seeded garages and meeting points + verified places. */
export function useLandmarks() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.places.landmarks.queryOptions({ cityId: CITY_ID }), enabled: signedIn, staleTime: 10 * 60_000 });
}

/** Restaurants as ride destinations (ride idea w7): the same public list food shows, names and pickup points only. */
export function useShopPlaces() {
  const api = useApi();
  return useQuery({ ...api.catalog.restaurants.queryOptions({ cityId: CITY_ID, filters: {} }), staleTime: 10 * 60_000 });
}

/**
 * One taxi quote (street pickup, now) for a smart pick on «وين رايح؟» (ride idea w2): the same engine
 * as the choose screen, so the price shown there is the price the rider then sees.
 */
export function usePickQuote(pickup: Spot | null, dropoff: Spot | null) {
  const api = useApi();
  const minute = quoteMinute().getTime();
  const input = pickup && dropoff ? rideQuoteRequest({ vertical: 'taxi', pickup: spotPoint(pickup), dropoff: spotPoint(dropoff), doorPickup: false, at: new Date(minute) }) : null;
  return useQuery({ ...api.pricing.quote.queryOptions(input ?? rideQuoteRequest({ vertical: 'taxi', pickup: { zoneKey: 'x' }, dropoff: { zoneKey: 'x' }, doorPickup: false, at: new Date(minute) })), enabled: input !== null, staleTime: 60_000, placeholderData: keepPreviousData });
}

/** The city config (night/peak hours for the reason lines, dispatch waves for the search copy). */
export function useCityConfig() {
  const api = useApi();
  return useQuery({ ...api.config.city.queryOptions({ cityId: CITY_ID }), staleTime: 30 * 60_000 });
}

/** The zone under a pin, server side (`places.zoneFor`): the pin screen shows it before the rider confirms. */
export function useZoneFor(pin: LatLng | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  const key = pin ? { cityId: CITY_ID, pin: { lat: Math.round(pin.lat * 1e5) / 1e5, lng: Math.round(pin.lng * 1e5) / 1e5 } } : { cityId: CITY_ID, pin: { lat: 0, lng: 0 } };
  return useQuery({ ...api.places.zoneFor.queryOptions(key), enabled: signedIn && pin !== null, placeholderData: keepPreviousData, staleTime: 60_000 });
}

/**
 * Free vehicles of one kind around the pickup (`dispatch.nearby`, maps program c10): blurred, no ids,
 * every 10 s while the choose screen is open. Keeps the last set while a refresh is in flight.
 */
export function useNearbyVehicles(pin: LatLng | null, vertical: RideVertical) {
  const api = useApi();
  // Low-data mode (maps program q2): free vehicles every 30 s instead of 10.
  const lite = useLiteMode();
  const signedIn = useSignedIn();
  const key = { cityId: CITY_ID, pin: pin ? { lat: Math.round(pin.lat * 1e5) / 1e5, lng: Math.round(pin.lng * 1e5) / 1e5 } : { lat: 0, lng: 0 }, vertical };
  return useQuery({
    ...api.dispatch.nearby.queryOptions(key),
    enabled: signedIn && pin !== null,
    staleTime: NEARBY_RULES.refreshMs,
    refetchInterval: liteInterval(NEARBY_RULES.refreshMs, lite),
    placeholderData: (prev: NearbyVehicles | undefined) => prev,
  });
}

export type QuoteGrid = Record<RideVertical, { door: Quote | undefined; street: Quote | undefined }>;

/**
 * `pricing.quote` for both vehicles × door / street pickup at this minute — the engine `orders.place`
 * locks the fare with, so every price on the choose screen is the price charged. Four tiny pure
 * computations on the server; re-asked each minute so night/peak flip on time.
 */
export function useRideQuotes(pickup: Spot | null, dropoff: Spot | null, bookedAt: Date | null = null) {
  const api = useApi();
  // A ride booked for later (joy J7d) is quoted for its own time (night and peak follow it).
  const at = bookedAt ?? quoteMinute();
  const minute = at.getTime();
  const combos = useMemo(
    () => (pickup && dropoff ? RIDE_VERTICALS.flatMap((vertical) => [true, false].map((doorPickup) => ({ vertical, doorPickup, input: rideQuoteRequest({ vertical, pickup: spotPoint(pickup), dropoff: spotPoint(dropoff), doorPickup, at: new Date(minute) }) }))) : []),
    [pickup, dropoff, minute],
  );
  const results = useQueries({
    queries: combos.map((c) => ({ ...api.pricing.quote.queryOptions(c.input), placeholderData: keepPreviousData, refetchInterval: 60_000 })),
  });
  const grid: QuoteGrid = { taxi: { door: undefined, street: undefined }, tuktuk: { door: undefined, street: undefined } };
  combos.forEach((c, i) => {
    grid[c.vertical][c.doorPickup ? 'door' : 'street'] = results[i]?.data as Quote | undefined;
  });
  return {
    grid,
    loading: combos.length > 0 && results.some((r) => r.isPending),
    error: results.find((r) => r.isError)?.error ?? null,
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}

export function usePlaceRide() {
  const api = useApi();
  return useMutation(api.orders.place.mutationOptions());
}

/**
 * J-D7: the other vehicle's server quote for a ride still searching at the free-cancel time. Asked
 * once the offer is due, re-asked each minute (night/peak flips); an answer the server refuses
 * (driver found meanwhile, zone not served) leaves only "keep searching" and "cancel".
 */
export function useRideSwitchQuote(orderId: string, doorPickup: boolean, enabled: boolean) {
  const api = useApi();
  return useQuery({ ...api.orders.rideSwitchQuote.queryOptions({ orderId, doorPickup }), enabled, retry: false, refetchInterval: 60_000 });
}

/** J-D7: confirm the switch; the server cancels the search for free and books the other vehicle. */
export function useSwitchRideVehicle() {
  const api = useApi();
  return useMutation(api.orders.switchRideVehicle.mutationOptions());
}

export function useConfirmRideArrived() {
  const api = useApi();
  return useMutation(api.orders.confirmRideArrived.mutationOptions());
}
