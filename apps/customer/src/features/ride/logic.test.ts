import { describe, expect, it } from 'vitest';
import { PlaceOrderInput, PriceRequest, type LandmarkView, type Quote, type QuoteComponent } from '@driver/contracts';
import {
  destinationPinKind,
  searchStageIndex,
  switchOfferDue,
  buildRidePlaceInput,
  doorExtra,
  fareLines,
  hour12,
  landmarkSpot,
  matchScore,
  mmss,
  normalizeArabic,
  pushRecent,
  rideEstimate,
  rideProblem,
  rideQuoteRequest,
  ruleHours,
  sameSpot,
  searchSpots,
  spotForEnd,
  searchStage,
  surchargesOf,
  tooClose,
  tuktukAvailability,
  walletCovers,
  westernDigits,
  zoneSpots,
  zoneTitle,
  type Spot,
} from './logic';
import { createRideStore, EMPTY_DRAFT } from './store';
import { createMemoryStorage } from '@/lib/storage';

const home: Spot = { id: 'saved:p1', kind: 'saved', title: 'البيت', subtitle: 'شارع 30', zoneId: 'street_30', pin: { lat: 32.9095, lng: 45.0635 }, savedLabel: 'home' };
const park: LandmarkView = { id: 'lm_mp_hadiqat_shasha', name_ar: 'حديقة الشاشة', name_en: 'Al-Shasha park', pin: { lat: 32.9122, lng: 45.0552 }, zoneId: 'mahdood_1', kind: 'meeting_point', category: 'other', aliases_ar: ['الحديقة'], photoUrl: null };
const garage: LandmarkView = { id: 'lm_garage_bab2', name_ar: 'كراج البوابة ٢', name_en: 'Gate 2 garage', pin: { lat: 32.9088, lng: 45.0648 }, zoneId: 'street_30', kind: 'garage', category: 'garage', aliases_ar: ['كراج الكوت'], photoUrl: null };

const c = (key: QuoteComponent['key'], amount: number): QuoteComponent => ({ key, amount, label_ar: key, label_en: key, driverShareRule: 'driver_full', visibility: 'shown' });
const quote = (total: number, components: QuoteComponent[] = [c('base', total)]): Quote => ({
  id: `q${total}`,
  cityId: 'aziziyah',
  vertical: 'taxi',
  currency: 'IQD',
  components,
  shadowComponents: [],
  subtotal: total,
  total,
  shadowTotal: total,
  rounding: { step: 250, applied: 0 },
  bounds: { clamped: false },
  createdAt: new Date('2026-10-04T10:00:00Z'),
});

describe('search normal form', () => {
  it('folds what people type onto what the seed spells', () => {
    expect(normalizeArabic('الشاشه')).toBe(normalizeArabic('حديقة الشاشة').split(' ')[1]);
    expect(normalizeArabic('شارع ٣٠')).toBe('شارع 30');
    expect(normalizeArabic('إعدادية')).toBe('اعداديه');
    expect(normalizeArabic('گراج')).toBe('كراج');
    expect(normalizeArabic('الهاشمي')).toBe(normalizeArabic('هاشمي'));
    expect(westernDigits('كراج البوابة ٢')).toBe('كراج البوابة 2');
  });

  it('scores exact, word-prefix and inside matches; every word has to match', () => {
    expect(matchScore('حديقة الشاشة', ['حديقة الشاشة'])).toBe(3);
    expect(matchScore('حدي', ['حديقة الشاشة'])).toBe(2);
    expect(matchScore('اشة', ['حديقة الشاشة'])).toBe(1);
    expect(matchScore('حديقة الكوت', ['حديقة الشاشة'])).toBe(0);
    expect(matchScore('   ', ['حديقة الشاشة'])).toBe(0);
  });
});

describe('searchSpots', () => {
  const zones = zoneSpots('ar-IQ', 'وسط المنطقة');
  const sources = { saved: [home], recent: [], landmarks: [landmarkSpot(park, 'ar-IQ', 'نقطة لقاء'), landmarkSpot(garage, 'ar-IQ', 'كراج')], zones };

  it('covers the 34 zones with Western digits', () => {
    expect(zones).toHaveLength(34);
    expect(zones.find((z) => z.zoneId === 'street_30')?.title).toBe('شارع 30');
  });

  it('finds landmarks by name or alias and zones by name', () => {
    expect(searchSpots('الشاشه', sources)[0]?.title).toBe('حديقة الشاشة');
    expect(searchSpots('كراج الكوت', sources)[0]?.title).toBe('كراج البوابة 2');
    expect(searchSpots('حواس', sources).map((s) => s.zoneId)).toEqual(['hawas_tujjar', 'hawas_abbas', 'hawas_umm_banin', 'hawas_sabb', 'hawas_bridge']);
    expect(searchSpots('', sources)).toEqual([]);
  });

  it('puts saved places first on a tie and drops a duplicate of the same spot', () => {
    const z30 = zones.find((z) => z.zoneId === 'street_30')!;
    const sameAsHome: Spot = { ...z30, pin: home.pin };
    const out = searchSpots('شارع', { ...sources, saved: [{ ...home, title: 'شارع البيت' }], zones: [sameAsHome] });
    expect(out.map((s) => s.kind)).toEqual(['saved']);
  });
});

describe('places', () => {
  it('same spot = same zone within 60 m; too close to ride under 150 m', () => {
    const near = { ...home, pin: { lat: 32.9099, lng: 45.0636 } };
    expect(sameSpot(home, near)).toBe(true);
    expect(sameSpot(home, { ...near, zoneId: 'fidaa' })).toBe(false);
    expect(tooClose(home, near)).toBe(true);
    expect(tooClose(home, landmarkSpot(park, 'ar-IQ', ''))).toBe(false);
  });

  it('keeps recent destinations newest first, once each, at most six', () => {
    let list: Spot[] = [];
    for (let i = 0; i < 8; i++) list = pushRecent(list, { ...home, zoneId: zoneSpots('ar-IQ', '')[i]!.zoneId, pin: { lat: 32.9 + i * 0.01, lng: 45.06 } });
    expect(list).toHaveLength(6);
    list = pushRecent(list, { ...home, zoneId: list[3]!.zoneId, pin: list[3]!.pin });
    expect(list).toHaveLength(6);
    expect(list[0]!.kind).toBe('recent');
    expect(new Set(list.map((s) => s.id)).size).toBe(6);
  });

  it('names zones in either language', () => {
    expect(zoneTitle('street_30')).toBe('شارع 30');
    expect(zoneTitle('street_30', 'en')).toBe('Street 30');
    expect(zoneTitle('nowhere')).toBe('nowhere');
  });

  it('turns a «نفس مشوار البارحة؟» end into the spot the rider knows (o4)', () => {
    const gate = landmarkSpot(garage, 'ar-IQ', 'كراج');
    const sources = { saved: [home], recent: [], landmarks: [gate] };
    expect(spotForEnd({ zoneKey: 'street_30', pin: { lat: 32.95, lng: 45.1 }, placeId: 'p1' }, sources)).toBe(home);
    expect(spotForEnd({ zoneKey: 'street_30', pin: { lat: 32.9097, lng: 45.0636 } }, sources)).toBe(home);
    expect(spotForEnd({ zoneKey: 'street_30', pin: { lat: 32.9089, lng: 45.0648 } }, sources)).toBe(gate);
    const pin = spotForEnd({ zoneKey: 'fidaa', pin: { lat: 32.92, lng: 45.07 } }, sources);
    expect(pin).toMatchObject({ kind: 'pin', zoneId: 'fidaa', title: zoneTitle('fidaa'), pin: { lat: 32.92, lng: 45.07 } });
  });
});

describe('quotes', () => {
  it('asks exactly what orders.place re-prices with (pins, door option, no street hand-over)', () => {
    const req = PriceRequest.parse(rideQuoteRequest({ vertical: 'tuktuk', pickup: { zoneKey: 'hashimi', pin: { lat: 32.8968, lng: 45.0662 } }, dropoff: { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } }, doorPickup: true, at: new Date('2026-10-04T10:00:00Z') }));
    expect(req.vertical).toBe('tuktuk');
    expect(req.stops.map((s) => [s.zoneId, s.type])).toEqual([
      ['hashimi', 'pickup'],
      ['mahdood_2', 'dropoff'],
    ]);
    expect(req.options).toMatchObject({ doorPickup: true, streetHandover: false, frontSeat: false });
  });

  it('door pickup extra, surcharges and the breakdown lines', () => {
    expect(doorExtra(quote(5000), quote(4000))).toBe(1000);
    expect(doorExtra(undefined, quote(4000))).toBeNull();
    const night = quote(5000, [c('base', 4000), c('street_pickup', 0), c('night', 1000)]);
    expect(surchargesOf(night)).toEqual([{ key: 'night', amount: 1000 }]);
    expect(surchargesOf(quote(3000))).toEqual([]);
    expect(fareLines(night).map((l) => l.key)).toEqual(['base', 'night']);
  });

  it('reads night hours from the city config for the reason line', () => {
    const city = { verticals: [{ vertical: 'taxi' as const, zoneFares: [], defaultFare: 0, floor: 0, ceiling: 1, components: [{ key: 'night' as const, label_ar: '', label_en: '', driverShareRule: 'driver_full' as const, visibility: 'shown' as const, amount: 1000, hours: [23, 5] as [number, number] }] }] };
    expect(ruleHours(city, 'taxi', 'night')).toEqual([23, 5]);
    expect(ruleHours(city, 'tuktuk', 'night')).toBeNull();
    expect([hour12(23), hour12(5), hour12(0), hour12(12)]).toEqual(['11', '5', '12', '12']);
  });
});

describe('ride options', () => {
  it('turns the tuktuk off to and from edge zones unless the rider tries anyway', () => {
    expect(tuktukAvailability('street_30', 'mahdood_1')).toEqual({ ok: true, edgeZoneId: null });
    expect(tuktukAvailability('street_30', 'mashrou_owaid')).toEqual({ ok: false, edgeZoneId: 'mashrou_owaid' });
    expect(tuktukAvailability('bazl_hallata', 'centre')).toEqual({ ok: false, edgeZoneId: 'bazl_hallata' });
    expect(tuktukAvailability('street_30', 'mashrou_owaid', true).ok).toBe(true);
  });

  it('estimates the ride by vehicle (the car is a little faster)', () => {
    const now = new Date('2026-10-04T10:00:00Z');
    const car = rideEstimate(home.pin, { lat: 32.8485, lng: 45.0885 }, 'taxi', now);
    const tuk = rideEstimate(home.pin, { lat: 32.8485, lng: 45.0885 }, 'tuktuk', now);
    expect(car.minutes).toBeGreaterThan(5);
    expect(tuk.minutes).toBeGreaterThan(car.minutes);
    expect(car.arriveAt.getTime() - now.getTime()).toBe(car.minutes * 60_000);
  });

  it('wallet covers only a known balance at or above the fare', () => {
    expect(walletCovers(5000, 4000)).toBe(true);
    expect(walletCovers(4000, 4000)).toBe(true);
    expect(walletCovers(3000, 4000)).toBe(false);
    expect(walletCovers(null, 4000)).toBe(false);
  });
});

describe('placing', () => {
  it('builds the orders.place ride payload the e2e walk sends, plus the options', () => {
    const input = buildRidePlaceInput({ vertical: 'tuktuk', pickup: home, dropoff: landmarkSpot(park, 'ar-IQ', ''), doorPickup: false, fareIqd: 2000, quoteId: 'q1', paymentMethod: 'cash', note: '  يم الصيدلية ' });
    expect(PlaceOrderInput.parse(input)).toMatchObject({
      cityId: 'aziziyah',
      type: 'ride',
      rideVertical: 'tuktuk',
      fareIqd: 2000,
      quoteId: 'q1',
      paymentMethod: 'cash',
      options: { doorPickup: false },
      pickup: { zoneKey: 'street_30', pin: home.pin },
      dropoff: { zoneKey: 'mahdood_1', pin: park.pin },
      note: 'يم الصيدلية',
    });
    expect(buildRidePlaceInput({ vertical: 'taxi', pickup: home, dropoff: home, doorPickup: true, fareIqd: 3000, paymentMethod: 'wallet', note: '  ' })).not.toHaveProperty('note');
  });

  it('maps refusals to what the screen says', () => {
    expect(rideProblem('price_changed')).toBe('price_changed');
    expect(rideProblem('new_customer_cash_cap')).toBe('cash_cap');
    expect(rideProblem('quote_location_required')).toBe('location');
    expect(rideProblem('wallet_insufficient')).toBe('wallet');
    expect(rideProblem(undefined)).toBe('other');
  });
});

describe('searching', () => {
  const waves = { waves: [{ size: 3, radiusKm: 1.5, seconds: 15 }, { size: 5, radiusKm: 3, seconds: 15 }, { size: 'all' as const, seconds: 30 }] };
  it('follows the broadcast waves honestly', () => {
    expect(searchStage(0, waves)).toBe('nearest');
    expect(searchStage(14, waves)).toBe('nearest');
    expect(searchStage(15, waves)).toBe('wider');
    expect(searchStage(29, waves)).toBe('wider');
    expect(searchStage(30, waves)).toBe('everyone');
    expect(searchStage(400, undefined)).toBe('everyone');
  });
  it('formats the counter', () => {
    expect([mmss(0), mmss(9), mmss(75), mmss(-3)]).toEqual(['0:00', '0:09', '1:15', '0:00']);
  });
});

describe('ride store', () => {
  it('starts fresh per booking, keeps the payment choice, remembers trips and destinations', async () => {
    const storage = createMemoryStorage();
    const store = createRideStore(storage);
    await store.load();
    store.update({ payment: 'wallet', note: 'x', dropoff: home });
    store.start('tuktuk');
    expect(store.getSnapshot().draft).toEqual({ ...EMPTY_DRAFT, vertical: 'tuktuk', payment: 'wallet' });
    store.placed('o1', { vertical: 'tuktuk', from: 'البيت', to: 'حديقة الشاشة' }, landmarkSpot(park, 'ar-IQ', ''), 1000);
    expect(store.getSnapshot().memos['o1']).toEqual({ vertical: 'tuktuk', from: 'البيت', to: 'حديقة الشاشة', at: 1000 });
    expect(store.getSnapshot().recent[0]?.title).toBe('حديقة الشاشة');
    await Promise.resolve();
    const again = createRideStore(storage);
    await again.load();
    expect(again.getSnapshot().recent).toHaveLength(1);
    expect(again.getSnapshot().memos['o1']?.vertical).toBe('tuktuk');
    again.reset();
    expect(again.getSnapshot().recent).toEqual([]);
  });
  it('a switched ride keeps the names and choices under its new order, without a new recent destination', async () => {
    const store = createRideStore(createMemoryStorage());
    await store.load();
    store.placed('o1', { vertical: 'taxi', from: 'البيت', to: 'حديقة الشاشة', doorPickup: true }, landmarkSpot(park, 'ar-IQ', ''), 1000);
    store.remember('o2', { vertical: 'tuktuk', from: 'البيت', to: 'حديقة الشاشة', doorPickup: true }, 2000);
    expect(store.getSnapshot().memos['o2']).toEqual({ vertical: 'tuktuk', from: 'البيت', to: 'حديقة الشاشة', doorPickup: true, at: 2000 });
    expect(store.getSnapshot().recent).toHaveLength(1);
  });
});

describe('ride search finish line and the 3-minute offer (L-03, J-D7)', () => {
  it('three visible stages', () => {
    expect(searchStageIndex('nearest')).toBe(1);
    expect(searchStageIndex('wider')).toBe(2);
    expect(searchStageIndex('everyone')).toBe(3);
  });
  it('the offer shows from the free-cancel time until the customer says keep searching', () => {
    expect(switchOfferDue(179, 180, false)).toBe(false);
    expect(switchOfferDue(180, 180, false)).toBe(true);
    expect(switchOfferDue(400, 180, true)).toBe(false);
  });
  it('a flag for where the ride goes; the house only for the saved home (L-15)', () => {
    expect(destinationPinKind({ savedLabel: 'home' })).toBe('home');
    expect(destinationPinKind({ savedLabel: 'work' })).toBe('destination');
    expect(destinationPinKind({})).toBe('destination');
    expect(destinationPinKind(null)).toBe('destination');
  });
});
