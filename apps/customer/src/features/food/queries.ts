import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { TERMINAL_ORDER_STATES, type DeliveryPoint, type Order, type RestaurantsInput } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { deliveryPointOf, selectedPlace, useProfile, type SavedPlace } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import type { CartState } from './cart';
import { cartQuoteRequest } from './checkout';

export const CITY_ID = 'aziziyah';

/** The selected deliver-to place and its delivery point (zone + pin), or nulls before one is saved. */
export function useDeliverTo(): { place: SavedPlace | null; dropoff: DeliveryPoint | null } {
  const prof = useProfile();
  const place = selectedPlace(prof);
  return useMemo(() => ({ place, dropoff: place ? deliveryPointOf(place) : null }), [place]);
}

/** `catalog.restaurants` for the deliver-to zone (fee preview + ETA). */
export function useCatalogRestaurants(filters: RestaurantsInput['filters'] = {}) {
  const api = useApi();
  const signedIn = useSignedIn();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.catalog.restaurants.queryOptions({ cityId: CITY_ID, ...(dropoff ? { dropoff } : {}), filters }),
    enabled: signedIn,
    placeholderData: keepPreviousData,
  });
}

/** A restaurant's card + sectioned menu (`catalog.menu`), priced for the deliver-to zone. */
export function useMenu(merchantId: string | undefined) {
  const api = useApi();
  const signedIn = useSignedIn();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.catalog.menu.queryOptions({ merchantId: merchantId ?? '', ...(dropoff ? { dropoff } : {}) }),
    enabled: signedIn && Boolean(merchantId),
    placeholderData: keepPreviousData,
  });
}

/** The quote time, to the minute, so the query key is stable between renders. */
function quoteMinute(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

/**
 * Live delivery + fees for the cart (`pricing.quote`, the engine `orders.place` locks fees with).
 * Re-quotes each minute so night/peak rules match what the server will charge.
 */
export function useCartQuote(cart: CartState, dropoff: DeliveryPoint | null, streetHandover: boolean) {
  const api = useApi();
  const pickup = cart.merchant?.pickup ?? null;
  const at = quoteMinute();
  const minuteKey = at.getTime();
  const input = useMemo(
    () => (pickup && dropoff && cart.merchant ? cartQuoteRequest({ cityId: cart.merchant.cityId, pickup, dropoff, streetHandover, at: new Date(minuteKey) }) : null),
    [pickup, dropoff, streetHandover, minuteKey, cart.merchant],
  );
  return useQuery({
    ...api.pricing.quote.queryOptions(input ?? cartQuoteRequest({ cityId: CITY_ID, pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'centre' }, streetHandover: false, at })),
    enabled: input !== null && cart.lines.length > 0,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function usePlaceOrder() {
  const api = useApi();
  return useMutation(api.orders.place.mutationOptions());
}

export function useCancelOrder() {
  const api = useApi();
  return useMutation(api.orders.cancel.mutationOptions());
}

const DONE = new Set<string>(TERMINAL_ORDER_STATES);

/** Polls an order every 2 s while the kitchen hasn't answered ("finding your kitchen"). */
export function useKitchenAnswer(orderId: string | undefined) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.get.queryOptions({ orderId: orderId ?? '' }),
    enabled: signedIn && Boolean(orderId),
    refetchInterval: (q) => {
      const o = q.state.data as Order | undefined;
      return !o || o.state === 'placed' ? 2000 : false;
    },
  });
}

export function isKitchenRejection(o: Pick<Order, 'state'>): boolean {
  return o.state === 'merchant_rejected' || o.state === 'platform_cancelled';
}

export function isKitchenAccepted(o: Pick<Order, 'state'>): boolean {
  return o.state !== 'placed' && !DONE.has(o.state);
}
