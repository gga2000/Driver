import type { IntercityVehicle, RequestDetails, RequestPostView } from '@driver/contracts';
import type { IconName } from '@driver/ui';

/**
 * The private-car market (Baghdad/Kut ideas y2, y5, y6, Ali 2026-10-07): the places most requests go
 * to, how an offer's car meets what the rider asked, and the three ways to sort offers with the winner
 * of each named on its card.
 */

/** y2: where most private trips from Aziziyah go, one tap instead of typing. */
export const REQUEST_PLACES = [
  { id: 'baghdad_airport', icon: 'flag' },
  { id: 'karbala', icon: 'map-pin' },
  { id: 'najaf', icon: 'map-pin' },
  { id: 'kut', icon: 'map-pin' },
  { id: 'medical_city', icon: 'heart' },
] as const satisfies readonly { id: string; icon: IconName }[];
export type RequestPlaceId = (typeof REQUEST_PLACES)[number]['id'];

export type RequestOffer = RequestPostView['offers'][number];

/** What the rider asked that this car doesn't say it has (the driver's own word on his latest run). */
export type Mismatch = 'ac' | 'car_kind' | 'big_bags';

export function offerMismatches(d: RequestDetails, vehicle: IntercityVehicle | null | undefined): Mismatch[] {
  if (!vehicle) return [];
  const out: Mismatch[] = [];
  if (d.ac && !vehicle.ac) out.push('ac');
  if (d.carKind && vehicle.kind !== d.carKind) out.push('car_kind');
  if (d.bigBags > 0 && !vehicle.bigBags) out.push('big_bags');
  return out;
}

export type OfferSort = 'best' | 'cheapest' | 'top_rated';
export const OFFER_SORTS: readonly OfferSort[] = ['best', 'cheapest', 'top_rated'];

/** A good rating is 4.5 and up; a new driver (too few ratings to show) sits between good and lower. */
export const GOOD_RATING = 4.5;

function ratingTier(o: RequestOffer): number {
  const avg = o.driver?.stats?.ratingAvg ?? null;
  if (avg === null) return 1;
  return avg >= GOOD_RATING ? 0 : 2;
}

function ratingValue(o: RequestOffer): number {
  return o.driver?.stats?.ratingAvg ?? -1;
}

/**
 * The three orders (y6). «الأنسب»: the car has what he asked for, then a good rating (a new driver
 * next, a lower rating last), then the price. «الأرخص»: price. «الأعلى تقييم»: rating, then how many
 * rated him. Ties fall to the earlier offer, so the order never jumps while he reads.
 */
export function sortOffers(offers: readonly RequestOffer[], d: RequestDetails, by: OfferSort): RequestOffer[] {
  const key = (o: RequestOffer): number[] => {
    switch (by) {
      case 'best':
        return [offerMismatches(d, o.driver?.vehicle).length, ratingTier(o), o.priceIqd];
      case 'cheapest':
        return [o.priceIqd, ratingTier(o)];
      case 'top_rated':
        return [-ratingValue(o), -(o.driver?.stats?.ratingCount ?? 0), o.priceIqd];
    }
  };
  return [...offers]
    .map((o, i) => ({ o, k: [...key(o), o.at.getTime(), i] }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j]! - b.k[j]!;
      return 0;
    })
    .map((x) => x.o);
}

/**
 * The winner of each order, named on its card. Only with two offers or more; «الأعلى تقييم» only for
 * a driver whose rating shows; one offer may win more than one.
 */
export function offerWinners(offers: readonly RequestOffer[], d: RequestDetails): Map<string, OfferSort[]> {
  const out = new Map<string, OfferSort[]>();
  if (offers.length < 2) return out;
  for (const by of OFFER_SORTS) {
    const top = sortOffers(offers, d, by)[0]!;
    if (by === 'top_rated' && ratingValue(top) < 0) continue;
    out.set(top.id, [...(out.get(top.id) ?? []), by]);
  }
  return out;
}
