import { describe, expect, it } from 'vitest';
import { PlaceOrderInput, PriceRequest, type LandmarkView, type Quote, type QuoteComponent } from '@driver/contracts';
import {
  addNoteChip,
  surchargeEndsInMin,
  memberSpan,
  rideNearDue,
  standsAwayM,
  tripProgress,
  freeCancelLeftSec,
  rideBackOffer,
  searchProgress,
  shopSpot,
  smartPicks,
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
    expect(store.getSnapshot().memos['o1']).toEqual({ vertical: 'tuktuk', from: 'البيت', to: 'حديقة الشاشة', dest: landmarkSpot(park, 'ar-IQ', ''), at: 1000 });
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

describe('step 2 (ride ideas w2, w7, a4, m2, m4, p4)', () => {
  const at = (id: string, lat: number, extra: Partial<Spot> = {}): Spot => ({ id, kind: 'saved', title: id, zoneId: 'street_30', pin: { lat, lng: 45.06 }, ...extra });
  const home = at('home', 32.9, { savedLabel: 'home' });
  const work = at('work', 32.92, { savedLabel: 'work' });
  const market = at('market', 32.91, { kind: 'recent' });

  it('smart picks: work first in the morning, home first later, never where he is', () => {
    expect(smartPicks({ hour: 8, saved: [home, work], recent: [market], pickup: null }).map((s) => s.id)).toEqual(['work', 'home', 'market']);
    expect(smartPicks({ hour: 18, saved: [home, work], recent: [market], pickup: null }).map((s) => s.id)).toEqual(['home', 'work', 'market']);
    expect(smartPicks({ hour: 18, saved: [home, work], recent: [market], pickup: home }).map((s) => s.id)).toEqual(['work', 'market']);
  });

  it('a restaurant becomes a destination at its pickup point; none without one', () => {
    const s = shopSpot({ id: 'org_1', name: 'مطعم خالد', pickup: { zoneKey: 'street_30', pin: { lat: 32.9, lng: 45.06 } } }, 'ar-IQ', 'مطعم');
    expect(s).toMatchObject({ id: 'shop:org_1', kind: 'shop', zoneId: 'street_30' });
    expect(shopSpot({ id: 'org_2', name: 'x', pickup: null }, 'ar-IQ', 'مطعم')).toBeNull();
    expect(searchSpots('خالد', { saved: [], recent: [], landmarks: [], shops: [s!], zones: [] })[0]?.id).toBe('shop:org_1');
  });

  it('ride back: same day, 20 min to 10 h after a ride that did not end at home', () => {
    const t0 = new Date(2026, 9, 7, 9, 0).getTime();
    const base = { lastAt: t0, lastToHome: false, lastPlace: market, home };
    expect(rideBackOffer({ ...base, now: t0 + 10 * 60_000 })).toBeNull();
    expect(rideBackOffer({ ...base, now: t0 + 2 * 3_600_000 })).toEqual({ from: market, to: home });
    expect(rideBackOffer({ ...base, now: t0 + 11 * 3_600_000 })).toBeNull();
    expect(rideBackOffer({ ...base, lastToHome: true, now: t0 + 2 * 3_600_000 })).toBeNull();
    expect(rideBackOffer({ ...base, home: null, now: t0 + 2 * 3_600_000 })).toBeNull();
  });

  it('the free minute after acceptance counts down, then is gone', () => {
    const acc = new Date(1_000_000);
    expect(freeCancelLeftSec(acc, 1_000_000 + 18_000)).toBe(42);
    expect(freeCancelLeftSec(acc, 1_000_000 + 61_000)).toBeNull();
    expect(freeCancelLeftSec(null, 0)).toBeNull();
  });

  it('search bar: 3 asked, then 8, then everyone up to the free-cancel time', () => {
    expect(searchProgress(5, undefined)).toEqual({ part: 1, fill: 5 / 15, asked: 3 });
    expect(searchProgress(20, undefined)).toEqual({ part: 2, fill: 5 / 15, asked: 8 });
    expect(searchProgress(30, undefined)).toMatchObject({ part: 3, fill: 0, asked: 'all' });
    expect(searchProgress(400, undefined)).toMatchObject({ part: 3, fill: 1 });
  });

  it('note chips add once, after what he wrote', () => {
    expect(addNoteChip('', 'يم الصيدلية')).toBe('يم الصيدلية');
    expect(addNoteChip('الباب الأخضر', 'يم الصيدلية')).toBe('الباب الأخضر، يم الصيدلية');
    expect(addNoteChip('الباب الأخضر، يم الصيدلية', 'يم الصيدلية')).toBe('الباب الأخضر، يم الصيدلية');
  });
  it('he is a minute away: only while coming to the pickup, from the one ETA', () => {
    expect(rideNearDue({ comingToPickup: true, eta: new Date(70_000), now: 10_000 })).toBe(true);
    expect(rideNearDue({ comingToPickup: true, eta: new Date(80_000), now: 10_000 })).toBe(false);
    expect(rideNearDue({ comingToPickup: false, eta: new Date(20_000), now: 10_000 })).toBe(false);
    expect(rideNearDue({ comingToPickup: true, eta: null, now: 10_000 })).toBe(false);
  });

  it('trip progress: by time to the ETA, never backwards, never full before the end', () => {
    const start = new Date(0);
    expect(tripProgress({ startedAt: start, eta: new Date(600_000), now: 150_000 })).toEqual({ fraction: 0.25, leftMin: 8 });
    // The ETA grew: the line holds where it was.
    expect(tripProgress({ startedAt: start, eta: new Date(900_000), now: 150_000, floor: 0.25 })?.fraction).toBe(0.25);
    expect(tripProgress({ startedAt: start, eta: new Date(600_000), now: 700_000 })).toEqual({ fraction: 0.97, leftMin: 1 });
    expect(tripProgress({ startedAt: null, eta: new Date(600_000), now: 0 })).toBeNull();
    // Still the pickup leg's ETA: nothing to draw yet.
    expect(tripProgress({ startedAt: new Date(600_000), eta: new Date(500_000), now: 610_000 })).toBeNull();
  });

  it('where he stands: on the pin, in 5 m then 10 m steps, nothing for a bad fix', () => {
    const pin = { lat: 32.9, lng: 45.06 };
    expect(standsAwayM({ lat: 32.9, lng: 45.0601 }, pin)).toBe(0);
    expect(standsAwayM({ lat: 32.9003, lng: 45.06 }, pin)).toBe(35);
    expect(standsAwayM({ lat: 32.9011, lng: 45.06 }, pin)).toBe(120);
    expect(standsAwayM({ lat: 32.95, lng: 45.06 }, pin)).toBeNull();
    expect(standsAwayM(null, pin)).toBeNull();
  });
  it('member since: new under a month, then months, then whole years', () => {
    const now = Date.UTC(2026, 9, 7);
    expect(memberSpan(new Date(Date.UTC(2026, 8, 20)), now)).toEqual({ unit: 'new', n: 0 });
    expect(memberSpan(new Date(Date.UTC(2026, 1, 1)), now)).toEqual({ unit: 'months', n: 8 });
    expect(memberSpan(new Date(Date.UTC(2024, 5, 1)), now)).toEqual({ unit: 'years', n: 2 });
    expect(memberSpan(null, now)).toBeNull();
  });
  it('timing tip: minutes until a surcharge window ends, only in its last half hour', () => {
    // 16:45 Baghdad = 13:45 UTC.
    const at = (h: number, m: number) => new Date(Date.UTC(2026, 9, 7, h - 3, m));
    expect(surchargeEndsInMin([14, 17], at(16, 45))).toBe(15);
    expect(surchargeEndsInMin([14, 17], at(16, 0))).toBeNull();
    expect(surchargeEndsInMin([14, 17], at(17, 5))).toBeNull();
    // A window over midnight (night 23–5): 04:50 is 10 minutes from its end.
    expect(surchargeEndsInMin([23, 5], at(4, 50))).toBe(10);
    expect(surchargeEndsInMin(null, at(4, 50))).toBeNull();
  });
});
