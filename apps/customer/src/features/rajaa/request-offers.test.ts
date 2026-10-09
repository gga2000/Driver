import { DEFAULT_REQUEST_DETAILS, type IntercityVehicle, type RequestDetails } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { offerMismatches, offerWinners, placeIdFor, sortOffers, type RequestOffer } from './request-offers';

const car = (over: Partial<IntercityVehicle> = {}): IntercityVehicle => ({ kind: 'saloon', layout: 4, plate: '1234', modelKey: 'elantra', model: null, color: null, noSmoking: false, bigBags: false, ac: true, ...over });

let at = 0;
function offer(id: string, priceIqd: number, rating: number | null, vehicle: IntercityVehicle | null = car(), ratingCount = 10): RequestOffer {
  return {
    id,
    driverId: `d_${id}`,
    priceIqd,
    wait: null,
    at: new Date(1_000 + at++),
    state: 'open',
    cash: null,
    driver: {
      firstName: id,
      verifiedTodayAt: null,
      photoUrl: null,
      vehicle,
      privateTrips: 0,
      stats: { trips: 20, ratingAvg: rating, ratingCount: rating === null ? 1 : ratingCount, onTimeShare: null, topTags: [], badges: [], ridesWithYou: 0 },
    },
  };
}

const asks = (over: Partial<RequestDetails> = {}): RequestDetails => ({ ...DEFAULT_REQUEST_DETAILS, ...over });

describe('the car against the request (y5)', () => {
  it('names only what was asked and is missing', () => {
    expect(offerMismatches(asks(), car({ ac: false }))).toEqual([]);
    expect(offerMismatches(asks({ ac: true, carKind: 'suv', bigBags: 2 }), car({ ac: false }))).toEqual(['ac', 'car_kind', 'big_bags']);
    expect(offerMismatches(asks({ ac: true, carKind: 'saloon' }), car())).toEqual([]);
  });
  it('an offer with no car on record is not marked down', () => {
    expect(offerMismatches(asks({ ac: true }), null)).toEqual([]);
  });
});

describe('sorting offers (y6)', () => {
  const cheapLow = offer('cheapLow', 80_000, 3.9);
  const fitGood = offer('fitGood', 95_000, 4.8);
  const noAc = offer('noAc', 85_000, 4.9, car({ ac: false }));
  const fresh = offer('fresh', 90_000, null);
  const all = [cheapLow, fitGood, noAc, fresh];

  it('«الأنسب»: what he asked for, then a good rating (new before lower), then price', () => {
    expect(sortOffers(all, asks({ ac: true }), 'best').map((o) => o.id)).toEqual(['fitGood', 'fresh', 'cheapLow', 'noAc']);
  });
  it('«الأرخص» and «الأعلى تقييم»', () => {
    expect(sortOffers(all, asks(), 'cheapest').map((o) => o.id)).toEqual(['cheapLow', 'noAc', 'fresh', 'fitGood']);
    expect(sortOffers(all, asks(), 'top_rated').map((o) => o.id)).toEqual(['noAc', 'fitGood', 'cheapLow', 'fresh']);
  });
  it('ties keep the order the offers came in', () => {
    const a = offer('a', 90_000, 4.6);
    const b = offer('b', 90_000, 4.6);
    expect(sortOffers([b, a], asks(), 'cheapest').map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('names the winners only with two offers or more', () => {
    expect(offerWinners([fitGood], asks()).size).toBe(0);
    const w = offerWinners(all, asks({ ac: true }));
    expect(w.get('fitGood')).toEqual(['best']);
    expect(w.get('cheapLow')).toEqual(['cheapest']);
    expect(w.get('noAc')).toEqual(['top_rated']);
  });
  it('no «الأعلى تقييم» when nobody has a rating yet', () => {
    const w = offerWinners([offer('x', 90_000, null), offer('y', 95_000, null)], asks());
    expect([...w.values()].flat()).not.toContain('top_rated');
  });
});

describe('a destination chip names a known place (p1)', () => {
  const label = (id: string) => ({ karbala: 'كربلاء', kut: 'الكوت' })[id] ?? id;
  it('matches the chip label, ignoring spaces around it; a typed place has none', () => {
    expect(placeIdFor(' كربلاء ', label)).toBe('karbala');
    expect(placeIdFor('كربلاء المقدسة', label)).toBeNull();
    expect(placeIdFor('', label)).toBeNull();
  });
});
